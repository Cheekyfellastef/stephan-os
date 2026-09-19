import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  captureFixedAuthorityGitStep,
  createSupervisorHousekeepRunStep,
  ensureBackend8787ConvergedBeforeSupervisor,
  ensureLiveUiConvergedBeforeSupervisor,
  main,
  probeCanonicalBackendHealth,
  runSupervisorHousekeepPreservingLiveDist,
  runSupervisorHousekeepPreservingLiveRuntime,
  writePreSupervisorFailureStatus,
} from './run-battle-bridge-ignition.mjs';
import {
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE,
  battleBridgeCanonicalRepositoryArgs,
  battleBridgeGitFixedConfigArgs,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';

function backendHealthResponse(sourceHead, {
  status = 200,
  schemaVersion = 'stephanos.backend-health.v1',
  runtimeId = 'stephanos-battle-bridge-backend',
} = {}) {
  return {
    status,
    async json() {
      return {
        schemaVersion,
        backendIdentity: { runtimeId, sourceHead },
      };
    },
  };
}

function canonicalSourceTruth(head) {
  return {
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head,
    originHead: head,
  };
}

test('supervisor housekeeping preserves exact-head dist and all runtime-owned data', () => {
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

  assert.deepEqual(delegated, []);
});

test('supervisor housekeeping injects the live-runtime-preserving run step into the existing housekeeper', () => {
  const delegated = [];
  const captures = [];
  let receivedOptions = null;
  const housekeepFn = (options) => {
    receivedOptions = options;
    options.captureStepFn('source-status', 'git', ['status', '--porcelain=v1']);
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
      captureStepFn: (label, command, args) => {
        captures.push({ label, command, args });
        return { stdout: '', stderr: '' };
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(receivedOptions.dryRun, false);
  assert.equal(receivedOptions.compact, true);
  assert.equal(receivedOptions.preserveRuntimeDirt, true);
  assert.deepEqual(delegated, []);
  assert.deepEqual(captures, [{
    label: 'source-status',
    command: 'git',
    args: ['status', '--porcelain=v1'],
  }]);
  assert.equal(runSupervisorHousekeepPreservingLiveDist, runSupervisorHousekeepPreservingLiveRuntime);
});

test('fixed authority Git capture prepends the canonical isolation config', () => {
  const calls = [];
  const result = captureFixedAuthorityGitStep('source-status', 'git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ], {
    cwd: 'C:\\repo',
    env: { GIT_CONFIG_NOSYSTEM: '1' },
    platform: 'win32',
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.stdout, '');
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.git);
  assert.deepEqual(calls[0].args, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    ...battleBridgeCanonicalRepositoryArgs('C:\\repo'),
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ]);
  assert.equal(calls[0].options.shell, false);
});

test('wrapper housekeeping routes capture and delegated Git through the fixed POSIX bundle', () => {
  for (const platform of ['linux', 'darwin']) {
    const calls = [];
    const cwd = '/canonical/repo';
    const result = runSupervisorHousekeepPreservingLiveRuntime(
      { dryRun: false, compact: true },
      {
        cwd,
        platform,
        env: { PATH: '/attacker', NODE_OPTIONS: '--require=/attacker/inject.cjs' },
        spawnSyncFn: (command, args, options) => {
          calls.push({ command, args, options });
          return { status: 0, stdout: '', stderr: '' };
        },
        housekeepFn: (options) => {
          options.captureStepFn('source-status', 'git', ['status', '--porcelain=v1']);
          options.runStepFn('git-current-head', 'git', ['rev-parse', 'HEAD']);
          return { ok: true };
        },
      },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.command === BATTLE_BRIDGE_POSIX_GIT_EXECUTABLE), true);
    assert.equal(calls.every((call) => call.options.env.PATH === '/usr/bin:/bin'), true);
    assert.equal(calls.every((call) => call.options.env.NODE_OPTIONS === undefined), true);
    assert.equal(calls.every((call) => call.options.env.GIT_CONFIG_GLOBAL === '/dev/null'), true);
    assert.equal(calls.every((call) => call.options.shell === false), true);
    assert.deepEqual(calls[0].args, [
      ...battleBridgeGitFixedConfigArgs(platform),
      ...battleBridgeCanonicalRepositoryArgs(cwd),
      'status', '--porcelain=v1',
    ]);
    assert.deepEqual(calls[1].args, [
      ...battleBridgeGitFixedConfigArgs(platform),
      ...battleBridgeCanonicalRepositoryArgs(cwd),
      'rev-parse', 'HEAD',
    ]);
  }
});

test('wrapper housekeeping rejects unsupported fixed-Git platforms before spawn', () => {
  let spawnCalls = 0;
  assert.throws(
    () => runSupervisorHousekeepPreservingLiveRuntime(
      { dryRun: false },
      {
        platform: 'freebsd',
        spawnSyncFn: () => {
          spawnCalls += 1;
          return { status: 0, stdout: '', stderr: '' };
        },
        housekeepFn: (options) => options.captureStepFn('source-status', 'git', ['status', '--porcelain=v1']),
      },
    ),
    /BATTLE_BRIDGE_GIT_PLATFORM_UNSUPPORTED:freebsd/,
  );
  assert.equal(spawnCalls, 0);
});

test('backend startup source tolerates exact runtime memory plus unstaged modified/deleted generated dist with fixed Node command forms', async () => {
  const starter = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  assert.match(starter, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(starter, /\$runtimeDistPrefix = 'apps\/stephanos\/dist\/'/);
  assert.match(starter, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(starter, /function Test-RuntimeUiDistStatus[\s\S]*\$Status -eq ' M' -or \$Status -eq ' D'/);
  assert.match(starter, /Test-RuntimeUiDistStatus -Status \$status[\s\S]*\$path\.StartsWith\(\$runtimeDistPrefix, \[System\.StringComparison\]::Ordinal\)/);
  assert.match(starter, /Backend startup requires source-tracked files to be unmodified at exact head/);
  assert.match(starter, /runtimeMemoryDirtTolerated = \$RuntimeMemoryDirty/);
  assert.match(starter, /runtimeDistDirtTolerated = \$RuntimeDistDirty/);
  assert.match(starter, /trackedWorktreeClean = -not \(\$RuntimeMemoryDirty -or \$RuntimeDistDirty\)/);
  assert.match(starter, /sourceWorktreeClean = \$true/);
  assert.match(starter, /-replace '\\s\+', ' '/);
  assert.match(starter, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(starter, /Get-ExactHeadBackendBootstrapBase64/);
  assert.match(starter, /--input-type=module', '--eval'/);
  assert.match(starter, /function Convert-ProcessCreationDateToUtcText[\s\S]*CreationDate -is \[DateTime\][\s\S]*ManagementDateTimeConverter\]::ToDateTime/);
  assert.match(starter, /Convert-ProcessCreationDateToUtcText -CreationDate \$process\.CreationDate/);
  assert.doesNotMatch(starter, /ManagementDateTimeConverter\]::ToDateTime\(\[string\]\$process\.CreationDate\)/);
  assert.doesNotMatch(starter, /CommandLine -match|Invoke-Expression|Start-Process[^\n]*-ArgumentList[^\n]*\$CommandLine/i);
  assert.doesNotMatch(starter, /Stop-Process|taskkill|wmic\s+process/i);
});

test('canonical backend health probe accepts only the fixed runtime identity with a valid source head', async () => {
  const head = 'a'.repeat(40);
  const clean = await probeCanonicalBackendHealth({ fetchFn: async () => backendHealthResponse(head) });
  assert.equal(clean.canonical, true);
  assert.equal(clean.sourceHead, head);

  const foreign = await probeCanonicalBackendHealth({
    fetchFn: async () => backendHealthResponse(head, { runtimeId: 'other-backend' }),
  });
  assert.equal(foreign.canonical, false);
  assert.equal(foreign.sourceHead, '');

  const malformed = await probeCanonicalBackendHealth({ fetchFn: async () => backendHealthResponse('not-a-sha') });
  assert.equal(malformed.canonical, false);
});

test('backend preflight success never invokes approved restart or health fallback', async () => {
  const calls = [];
  let fetchCalls = 0;
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: 'b'.repeat(40),
    runStepFn: (label, command, args) => {
      calls.push({ label, command, args });
      return true;
    },
    currentHeadFn: () => 'b'.repeat(40),
    fetchFn: async () => {
      fetchCalls += 1;
      return backendHealthResponse('a'.repeat(40));
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'backend-preflight-pass');
  assert.equal(result.restartAttempted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'backend-8787-preflight');
  assert.equal(fetchCalls, 0);
});

test('failed preflight delegates a proven stale canonical backend only to the approved exact-head restart primitive', async () => {
  const oldHead = 'a'.repeat(40);
  const currentHead = 'b'.repeat(40);
  const calls = [];
  const health = [backendHealthResponse(oldHead), backendHealthResponse(currentHead)];
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: currentHead,
    currentHeadFn: () => currentHead,
    fetchFn: async () => health.shift(),
    runStepFn: (label, command, args) => {
      calls.push({ label, command, args });
      return label === 'backend-8787-approved-stale-restart';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'backend-approved-stale-restart-pass');
  assert.equal(result.replacedSourceHead, oldHead);
  assert.equal(result.currentHead, currentHead);
  assert.equal(result.restartAttempted, true);
  assert.deepEqual(calls.map((entry) => entry.label), [
    'backend-8787-preflight',
    'backend-8787-approved-stale-restart',
  ]);
  assert.equal(calls[1].command, 'powershell.exe');
  assert.ok(calls[1].args.some((arg) => String(arg).replace(/\\/g, '/').endsWith('/scripts/windows/restart-approved-stephanos-runtime.ps1')));
  assert.deepEqual(calls[1].args.slice(-6), ['-Target', 'backend', '-ExpectedHead', currentHead, '-TimeoutSeconds', '90']);
});

test('same-head or noncanonical 8787 failures remain fail closed without restart authority', async () => {
  const currentHead = 'b'.repeat(40);
  for (const fixture of [
    {
      response: backendHealthResponse(currentHead),
      blocker: 'BACKEND_8787_SAME_HEAD_PREFLIGHT_FAILED',
    },
    {
      response: backendHealthResponse('a'.repeat(40), { runtimeId: 'foreign-runtime' }),
      blocker: 'BACKEND_8787_STALE_LISTENER_NOT_QUALIFIED',
    },
  ]) {
    const calls = [];
    const result = await ensureBackend8787ConvergedBeforeSupervisor({
      platform: 'win32',
      expectedHead: currentHead,
      currentHeadFn: () => currentHead,
      fetchFn: async () => fixture.response,
      runStepFn: (label, command, args) => {
        calls.push({ label, command, args });
        return false;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.blocker);
    assert.equal(result.restartAttempted, false);
    assert.deepEqual(calls.map((entry) => entry.label), ['backend-8787-preflight']);
  }
});

test('approved restart must produce exact-current backend health before Ignition proceeds', async () => {
  const oldHead = 'a'.repeat(40);
  const currentHead = 'b'.repeat(40);
  const health = [backendHealthResponse(oldHead), backendHealthResponse(oldHead)];
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: currentHead,
    currentHeadFn: () => currentHead,
    fetchFn: async () => health.shift(),
    runStepFn: (label) => label === 'backend-8787-approved-stale-restart',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BACKEND_8787_APPROVED_RESTART_EXACT_HEAD_PROOF_FAILED');
  assert.equal(result.restartAttempted, true);
});

test('Recovery Mesh shares the exact runtime-memory, generated-dist and backend listener identity rules', async () => {
  const probe = await readFile(new URL('./windows/probe-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(probe, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(probe, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(probe, /function Test-RuntimeUiDistStatus[\s\S]*\$Status -eq ' M' -or \$Status -eq ' D'/);
  assert.match(probe, /Test-RuntimeUiDistStatus -Status \$status[\s\S]*\$path\.StartsWith\(\$runtimeUiDistPrefix/);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_SOURCE_WORKTREE_DIRTY/);
  assert.match(probe, /runtimeMemoryDirtTolerated = \[bool\]\$afterWorktree\.RuntimeMemoryDirty/);
  assert.match(probe, /sourceWorktreeClean = \$true/);
  assert.match(probe, /\$receiptSourceClean/);
  assert.match(probe, /\$receiptTrackedTruth/);
  assert.match(probe, /-replace '\\s\+', ' '/);
  assert.match(probe, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(probe, /--input-type=module --eval/);
  assert.match(probe, /Test-CanonicalBackendCommandLine -CommandLine \(\[string\]\$process\.CommandLine\) -ExpectedSourceHead \$ExpectedSourceHead/);
  assert.match(probe, /function Convert-ProcessCreationDateToUtcText[\s\S]*CreationDate -is \[DateTime\][\s\S]*ManagementDateTimeConverter\]::ToDateTime/);
  assert.match(probe, /Convert-ProcessCreationDateToUtcText -CreationDate \$process\.CreationDate/);
  assert.doesNotMatch(probe, /ManagementDateTimeConverter\]::ToDateTime\(\[string\]\$process\.CreationDate\)/);
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

test('canonical source truth blocks the click path before backend, UI, or supervisor mutation', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-ignition-source-gate-'));
  const previousArgs = process.argv;
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      sourceTruthFn: () => ({
        branch: 'main',
        detachedHead: false,
        hasUpstream: true,
        upstreamBranch: 'origin/main',
        workingTreeDirty: false,
        aheadCount: 1,
        behindCount: 1,
        headPublished: false,
        blockedForRemoteTruth: true,
        publicationState: 'diverged',
        head: 'a'.repeat(40),
        originHead: 'b'.repeat(40),
      }),
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(calls, []);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.phases['source truth'].state, 'blocked');
    assert.equal(status.blockerId, 'source-head-truth-unproven');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('source head drift before backend blocks every service mutator', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-ignition-head-drift-backend-'));
  const previousArgs = process.argv;
  const provenHead = 'a'.repeat(40);
  const driftedHead = 'b'.repeat(40);
  const sourceProofs = [canonicalSourceTruth(provenHead), canonicalSourceTruth(driftedHead)];
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      sourceTruthFn: () => sourceProofs.shift(),
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(calls, []);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.blockerId, 'ignition-exact-head-changed-before-service-mutation');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('source head drift between backend and UI blocks every later mutator', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-ignition-head-drift-ui-'));
  const previousArgs = process.argv;
  const provenHead = 'a'.repeat(40);
  const driftedHead = 'b'.repeat(40);
  const sourceProofs = [
    canonicalSourceTruth(provenHead),
    canonicalSourceTruth(provenHead),
    canonicalSourceTruth(driftedHead),
  ];
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      sourceTruthFn: () => sourceProofs.shift(),
      backendPreflightFn: async ({ expectedHead }) => {
        calls.push('backend');
        assert.equal(expectedHead, provenHead);
        return { ok: true };
      },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(calls, ['backend']);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.blockerId, 'ignition-exact-head-changed-before-service-mutation');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('default backend and UI entry preflights reject a changed fixed head before mutation', async () => {
  const provenHead = 'a'.repeat(40);
  const driftedHead = 'b'.repeat(40);
  const backendMutations = [];
  const backend = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: provenHead,
    currentHeadFn: () => driftedHead,
    runStepFn: (...args) => {
      backendMutations.push(args);
      return true;
    },
  });
  assert.equal(backend.ok, false);
  assert.equal(backend.blocker, 'BACKEND_8787_EXACT_HEAD_CHANGED');
  assert.deepEqual(backendMutations, []);

  const lateHeads = [provenHead, driftedHead];
  const lateBackendMutations = [];
  const lateBackend = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: provenHead,
    currentHeadFn: () => lateHeads.shift(),
    fetchFn: async () => backendHealthResponse('c'.repeat(40)),
    runStepFn: (label) => {
      lateBackendMutations.push(label);
      return false;
    },
  });
  assert.equal(lateBackend.ok, false);
  assert.equal(lateBackend.blocker, 'BACKEND_8787_EXACT_HEAD_CHANGED');
  assert.deepEqual(lateBackendMutations, ['backend-8787-preflight']);

  const uiMutations = [];
  await assert.rejects(
    ensureLiveUiConvergedBeforeSupervisor({
      platform: 'linux',
      expectedHead: provenHead,
      currentHeadFn: () => driftedHead,
      probeFn: async () => ({ reachable: true, ready: false, currentHead: provenHead }),
      runStepFn: (...args) => {
        uiMutations.push(args);
        return true;
      },
    }),
    /STEPHANOS_UI_4173_EXACT_HEAD_CHANGED/,
  );
  assert.deepEqual(uiMutations, []);
});

test('wrapper and standalone supervisor share the same canonical source collector', async () => {
  const sourceTruthFn = () => ({
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head: 'a'.repeat(40),
    originHead: 'a'.repeat(40),
  });
  let supervisorOptions = null;
  const exitCode = await main({
    platform: 'linux',
    sourceTruthFn,
    uiPreflightFn: async () => {},
    supervisorFn: async (options) => {
      supervisorOptions = options;
      return { ok: true };
    },
  });

  assert.equal(exitCode, 0);
  assert.notEqual(supervisorOptions.sourceTruthFn, sourceTruthFn);
  assert.deepEqual(supervisorOptions.sourceTruthFn(), sourceTruthFn());
  assert.equal(supervisorOptions.platform, 'linux');
  assert.equal(typeof supervisorOptions.housekeepFn, 'function');
});

test('canonical ignition pins repository-sensitive housekeeping to the source-derived repo root', async () => {
  const entry = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');
  assert.match(entry, /const repoRoot = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)/);
  assert.match(entry, /export async function main[\s\S]*process\.chdir\(repoRoot\)/);
  assert.match(entry, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(entry, /'-Target',[\s\S]*'backend',[\s\S]*'-ExpectedHead',[\s\S]*currentHead/);
  assert.doesNotMatch(entry, /Stop-Process|taskkill|wmic\s+process|Invoke-Expression/i);
  assert.doesNotMatch(entry, /process\.chdir\([^)]*process\.argv|process\.chdir\([^)]*env/i);
});

test('second press reuses an existing exact-head UI without spawning another refresh', async () => {
  const refreshCalls = [];
  const currentHead = 'a'.repeat(40);
  const proof = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    expectedHead: currentHead,
    currentHeadFn: () => currentHead,
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
  const currentHead = 'a'.repeat(40);
  const before = { reachable: true, ready: false, currentHead: 'abc1234', proof: { ready: false } };
  const after = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };

  const result = await ensureLiveUiConvergedBeforeSupervisor({
    platform: 'win32',
    expectedHead: currentHead,
    currentHeadFn: () => currentHead,
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
  assert.equal(refreshCalls[0].args.length, 3);
  assert.match(refreshCalls[0].args[0].replace(/\\/g, '/'), /scripts\/refresh-stephanos-ui-4173\.mjs$/);
  assert.deepEqual(refreshCalls[0].args.slice(1), ['--expected-head', currentHead]);
});

test('cold start remains delegated to the complete existing supervisor flow', async () => {
  const refreshCalls = [];
  const currentHead = 'a'.repeat(40);
  const before = { reachable: false, ready: false, currentHead: 'abc1234', error: 'connection refused' };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    expectedHead: currentHead,
    currentHeadFn: () => currentHead,
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
  const currentHead = 'a'.repeat(40);
  await assert.rejects(
    ensureLiveUiConvergedBeforeSupervisor({
      platform: 'win32',
      expectedHead: currentHead,
      currentHeadFn: () => currentHead,
      probeFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234' }),
      waitFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234', error: 'still stale' }),
      runStepFn: () => true,
    }),
    /without exact-head browser proof/,
  );
});
