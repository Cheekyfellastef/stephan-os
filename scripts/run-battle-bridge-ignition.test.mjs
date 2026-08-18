import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  createSupervisorHousekeepRunStep,
  ensureLiveUiConvergedBeforeSupervisor,
  runSupervisorHousekeepPreservingLiveDist,
  runSupervisorHousekeepPreservingLiveRuntime,
  writePreSupervisorFailureStatus,
} from './run-battle-bridge-ignition.mjs';

test('supervisor housekeeping preserves exact-head dist and runtime-owned durable memory', () => {
  const delegated = [];
  const runStepFn = (label, command, args) => {
    delegated.push({ label, command, args });
    return true;
  };

  const guarded = createSupervisorHousekeepRunStep({ runStepFn });
  guarded('git-restore-auto-generated', 'git', ['restore', '--', 'apps/stephanos/dist/index.html']);
  guarded('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
  guarded('git-restore-runtime-tracked', 'git', ['restore', '--', 'stephanos-server/data/memory/durable-memory.json']);
  guarded('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);

  assert.deepEqual(delegated.map((entry) => entry.label), ['git-clean-runtime-untracked']);
});

test('supervisor housekeeping injects the live-runtime-preserving run step into the existing housekeeper', () => {
  const delegated = [];
  let receivedOptions = null;
  const housekeepFn = (options) => {
    receivedOptions = options;
    options.runStepFn('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
    options.runStepFn('git-restore-runtime-tracked', 'git', ['restore', '--', 'stephanos-server/data/memory/durable-memory.json']);
    options.runStepFn('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);
    return { ok: true };
  };

  const result = runSupervisorHousekeepPreservingLiveRuntime(
    { dryRun: false, compact: true },
    {
      housekeepFn,
      runStepFn: (label) => {
        delegated.push(label);
        return true;
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(receivedOptions.dryRun, false);
  assert.equal(receivedOptions.compact, true);
  assert.deepEqual(delegated, ['git-clean-runtime-untracked']);
  assert.equal(runSupervisorHousekeepPreservingLiveDist, runSupervisorHousekeepPreservingLiveRuntime);
});

test('backend startup source tolerates only unstaged canonical durable-memory and UI-dist runtime dirt with fixed Node command forms', async () => {
  const starter = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  assert.match(starter, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(starter, /\$runtimeDistPrefix = 'apps\/stephanos\/dist\/'/);
  assert.match(starter, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(starter, /\$status -eq ' M' -and \$path\.StartsWith\(\$runtimeDistPrefix, \[System\.StringComparison\]::Ordinal\)/);
  assert.match(starter, /Backend startup requires source-tracked files to be unmodified at exact head/);
  assert.match(starter, /runtimeMemoryDirtTolerated = \$RuntimeMemoryDirty/);
  assert.match(starter, /runtimeDistDirtTolerated = \$RuntimeDistDirty/);
  assert.match(starter, /trackedWorktreeClean = -not \(\$RuntimeMemoryDirty -or \$RuntimeDistDirty\)/);
  assert.match(starter, /sourceWorktreeClean = \$true/);
  assert.match(starter, /-replace '\\s\+', ' '/);
  assert.match(starter, /'node stephanos-server\/server\.js'/);
  assert.match(starter, /'node\.exe stephanos-server\/server\.js'/);
  assert.doesNotMatch(starter, /CommandLine -match|Invoke-Expression|Start-Process[^\n]*-ArgumentList[^\n]*\$CommandLine/i);
});

test('backend starter replaces only a verified stale canonical 8787 listener after the source safety gate', async () => {
  const starter = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  const sourceGate = starter.indexOf('if ($trackedAssessment.SourceDirt.Count -ne 0)');
  const listenerGate = starter.indexOf('$listenerConnections = @(Get-NetTCPConnection -LocalPort 8787');
  const staleHeadGate = starter.indexOf('if ($healthObservation.SourceHead -eq $headSha)');
  const verifiedKill = starter.indexOf('Stop-Process -Id $staleListener.ProcessId -Force -ErrorAction Stop');
  const replacementStart = starter.indexOf('Start-Process -FilePath $canonicalNpm');

  assert.ok(sourceGate >= 0);
  assert.ok(listenerGate > sourceGate);
  assert.ok(staleHeadGate > listenerGate);
  assert.ok(verifiedKill > staleHeadGate);
  assert.ok(replacementStart > verifiedKill);

  assert.match(starter, /function Get-CanonicalBackendHealthObservation/);
  assert.match(starter, /backendIdentity\.runtimeId -ne 'stephanos-battle-bridge-backend'/);
  assert.match(starter, /sourceHead -notmatch '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(starter, /refusing duplicate backend start or process termination/);
  assert.match(starter, /staleCanonicalListenerReplaced = \$StaleCanonicalListenerReplaced/);
  assert.match(starter, /verifiedOwnedProcessTerminationOnly = \$true/);
  assert.match(starter, /arbitraryProcessKillAllowed = \$false/);

  const stopProcessCalls = [...starter.matchAll(/Stop-Process[^\r\n]*/g)].map((match) => match[0].trim());
  assert.deepEqual(stopProcessCalls, ['Stop-Process -Id $staleListener.ProcessId -Force -ErrorAction Stop']);
  assert.doesNotMatch(starter, /Stop-Process\s+-Name|taskkill|wmic\s+process|Invoke-Expression/i);
});

test('Recovery Mesh shares the exact runtime-memory and backend listener identity rules', async () => {
  const probe = await readFile(new URL('./windows/probe-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(probe, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(probe, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_SOURCE_WORKTREE_DIRTY/);
  assert.match(probe, /runtimeMemoryDirtTolerated = \[bool\]\$afterWorktree\.RuntimeMemoryDirty/);
  assert.match(probe, /sourceWorktreeClean = \$true/);
  assert.match(probe, /\$receiptSourceClean/);
  assert.match(probe, /\$receiptTrackedTruth/);
  assert.match(probe, /-replace '\\s\+', ' '/);
  assert.match(probe, /'node stephanos-server\/server\.js'/);
  assert.match(probe, /'node\.exe stephanos-server\/server\.js'/);
  assert.doesNotMatch(probe, /CommandLine -match|Invoke-Expression/i);
});

test('pre-supervisor failures publish a fresh terminal red ignition record instead of leaving the launcher blue', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'stephanos-pre-supervisor-'));
  try {
    const result = await writePreSupervisorFailureStatus({
      sharedWorkspace: workspace,
      phase: 'backend 8787',
      blockerId: 'backend-preflight-test-blocker',
      detail: 'backend preflight failed before supervisor start',
      nextOperatorAction: 'repair the backend preflight, then retry Ignition',
    });
    const status = JSON.parse(await readFile(result.statusPath, 'utf8'));
    assert.equal(status.trafficLight, 'red');
    assert.equal(status.currentPhase, 'backend 8787');
    assert.equal(status.blockerId, 'backend-preflight-test-blocker');
    assert.equal(status.phases['backend 8787'].state, 'blocked');
    assert.match(status.nextOperatorAction, /retry Ignition/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('canonical ignition pins repository-sensitive housekeeping to the source-derived repo root', async () => {
  const entry = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');
  assert.match(entry, /const repoRoot = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)/);
  assert.match(entry, /export async function main[\s\S]*process\.chdir\(repoRoot\)/);
  assert.doesNotMatch(entry, /process\.chdir\([^)]*process\.argv|process\.chdir\([^)]*env/i);
});

test('second press reuses an existing exact-head UI without spawning another refresh', async () => {
  const refreshCalls = [];
  const proof = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => proof,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'reuse-exact-head-ui');
  assert.equal(result.after, proof);
  assert.equal(refreshCalls.length, 0);
});

test('live stale UI uses the bounded refresh helper and must converge before supervisor starts', async () => {
  const refreshCalls = [];
  const before = { reachable: true, ready: false, currentHead: 'abc1234', proof: { ready: false } };
  const after = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };

  const result = await ensureLiveUiConvergedBeforeSupervisor({
    platform: 'win32',
    probeFn: async () => before,
    waitFn: async () => after,
    runStepFn: (label, command, args) => {
      refreshCalls.push({ label, command, args });
      return true;
    },
  });

  assert.equal(result.action, 'refreshed-stale-ui');
  assert.equal(result.after, after);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].label, 'refresh-stale-ui-4173');
  assert.equal(refreshCalls[0].command, process.execPath);
  assert.equal(refreshCalls[0].args.length, 1);
  assert.match(refreshCalls[0].args[0].replace(/\\/g, '/'), /scripts\/refresh-stephanos-ui-4173\.mjs$/);
});

test('cold start remains delegated to the complete existing supervisor flow', async () => {
  const refreshCalls = [];
  const before = { reachable: false, ready: false, currentHead: 'abc1234', error: 'connection refused' };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => before,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'defer-cold-start-to-supervisor');
  assert.equal(refreshCalls.length, 0);
});

test('stale refresh without exact-head convergence fails closed', async () => {
  await assert.rejects(
    ensureLiveUiConvergedBeforeSupervisor({
      platform: 'win32',
      probeFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234' }),
      waitFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234', error: 'still stale' }),
      runStepFn: () => true,
    }),
    /without exact-head browser proof/,
  );
});