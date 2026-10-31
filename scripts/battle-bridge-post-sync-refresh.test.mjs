import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createFixedPostSyncRuntimeAdapter,
  projectControlPlaneFailureBlocker,
  runBattleBridgePostSyncRefresh,
} from './battle-bridge-post-sync-refresh.mjs';
import { buildBattleBridgeOutboundBeacon } from './battle-bridge-outbound-health-beacon.mjs';

const source = await readFile(new URL('./battle-bridge-post-sync-refresh.mjs', import.meta.url), 'utf8');

test('target failure remains observable while the same-head retry publishes its next plan', async t => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-target-outcome-continuity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const beforeHead = 'a'.repeat(40), afterHead = 'b'.repeat(40);
  const targetId = 'sovereign-commander';
  const blocker = 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN';
  const statusPath = join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  const blockedPath = join(paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${afterHead}-blocked.json`);
  const success = () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true });
  const adapter = {
    inspectHeads: success,
    isAncestor: () => ({ ok: true, ancestor: true }),
    changedPaths: () => ({ ok: true, paths: ['main.js', 'scripts/sovereign-commander-http.mjs'] }),
    refreshUi: success,
    refreshSovereignCommander: () => ({ ok: false, sourceHead: afterHead, exactHeadProofOk: true, blocker }),
    reconcileControlPlane: () => { throw new Error('Target failure must not reach reconciliation'); },
  };
  const first = await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter });
  assert.equal(first.blocker, blocker);
  assert.equal(first.resultTargets.find(row => row.targetId === targetId).ok, false);
  const originalBlockedReceipt = await readFile(blockedPath, 'utf8');
  let retryPlan, retryBeacon, blockedReceiptDuringRetry;
  await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter: {
    ...adapter,
    refreshUi: () => { throw new Error('The previous exact UI success must be resumed'); },
    refreshSovereignCommander: async () => {
      retryPlan = JSON.parse(await readFile(statusPath, 'utf8'));
      blockedReceiptDuringRetry = await readFile(blockedPath, 'utf8');
      retryBeacon = buildBattleBridgeOutboundBeacon({ sourceHead: afterHead,
        statusRecords: { postSyncRefresh: retryPlan }, now: new Date() });
      return { ok: false, sourceHead: afterHead, exactHeadProofOk: true, blocker };
    },
  } });
  const runtime = retryBeacon.surfaces.find(surface => surface.id === 'postSyncRefresh').runtimeRefresh;
  t.diagnostic(JSON.stringify({ firstClassification: first.classification, firstFailedTarget: first.resultTargets.find(row => row.targetId === targetId),
    retryClassification: retryPlan.classification, retryResultTargets: retryPlan.resultTargets,
    blockedReceiptRetainedDuringRetry: blockedReceiptDuringRetry === originalBlockedReceipt,
    currentStatusRetainsFailure: JSON.stringify(retryPlan).includes(blocker), publicBeaconRetainsFailure: JSON.stringify(runtime).includes(blocker) }));
  assert.equal(blockedReceiptDuringRetry, originalBlockedReceipt);
  assert.equal(retryPlan.classification, 'REFRESH_READY');
  assert.equal(retryPlan.resultTargets.some(row => row.targetId === targetId), false);
  assert.ok(JSON.stringify(runtime).includes(blocker), 'The current beacon must retain the previous observed target denial while the retry is unresolved');
  assert.deepEqual(retryPlan.targetFailureHistory, JSON.parse(originalBlockedReceipt).targetFailureHistory);
  assert.equal(runtime.targetFailureHistory.expectedSourceHead, afterHead);
  assert.equal(runtime.targetFailureHistory.sourceHeadMatchesExpected, true);
  assert.equal(runtime.targetFailureHistory.historical, true);
  const retriedFailure = JSON.parse(await readFile(statusPath, 'utf8')).targetFailureHistory;
  let thirdPlan;
  const completed = await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter: {
    ...adapter,
    refreshUi: () => { throw new Error('A diagnostic history must not replay proven work'); },
    refreshSovereignCommander: async () => {
      thirdPlan = JSON.parse(await readFile(statusPath, 'utf8'));
      return success();
    },
    reconcileControlPlane: success,
  } });
  assert.deepEqual(thirdPlan.targetFailureHistory, retriedFailure);
  assert.equal(completed.ok, true);
  assert.deepEqual(completed.targetFailureHistory.failures, []);
});

test('retry success checkpoint preserves another target refusal and its original time and head', async t => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-target-checkpoint-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const beforeHead = 'a'.repeat(40), afterHead = 'b'.repeat(40);
  const statusPath = join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  const success = () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true });
  const refusal = () => ({ ok: false, sourceHead: afterHead, exactHeadProofOk: false,
    blocker: 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED' });
  const adapter = { inspectHeads: success, isAncestor: () => ({ ok: true, ancestor: true }),
    changedPaths: () => ({ ok: true, paths: ['main.js', 'scripts/sovereign-commander-http.mjs'] }),
    refreshUi: success, refreshSovereignCommander: refusal, reconcileControlPlane: success };
  await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter });
  const previous = JSON.parse(await readFile(statusPath, 'utf8'));
  const originalHistory = previous.targetFailureHistory;
  // Absence of a usable earlier success requires re-observation, never a skip
  // authorized by diagnostic history. The canonical debt parser admits this
  // incomplete result set and still requires both selected targets.
  previous.resultTargets = previous.resultTargets.filter(row => row.targetId === 'sovereign-commander');
  await writeFile(statusPath, JSON.stringify(previous));
  let plan, checkpoint;
  const result = await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter: {
    ...adapter,
    refreshUi: async () => { plan = JSON.parse(await readFile(statusPath, 'utf8')); return success(); },
    refreshSovereignCommander: async () => { checkpoint = JSON.parse(await readFile(statusPath, 'utf8')); return refusal(); },
  } });
  assert.equal(result.ok, false);
  assert.deepEqual(plan.targetFailureHistory, originalHistory);
  assert.deepEqual(checkpoint.targetFailureHistory, originalHistory);
  assert.equal(checkpoint.classification, 'REFRESH_READY');
  assert.equal(checkpoint.phase, 'checkpoint-1');
  assert.deepEqual(checkpoint.resultTargets.map(row => row.targetId), ['stephanos-ui-4173']);
  const beacon = buildBattleBridgeOutboundBeacon({ sourceHead: afterHead,
    statusRecords: { postSyncRefresh: checkpoint }, now: new Date() });
  const historical = beacon.surfaces.find(row => row.id === 'postSyncRefresh').runtimeRefresh.targetFailureHistory;
  assert.equal(historical.failures[0].observedAtUtc, originalHistory.failures[0].observedAtUtc);
  assert.equal(historical.expectedSourceHead, originalHistory.expectedSourceHead);
});

test('legacy target refusal uses its validated original status timestamp during retry', async t => {
  const fx = await retainedRefreshFixture(t);
  const original = JSON.parse(await readFile(fx.statusPath, 'utf8'));
  delete original.targetFailureHistory;
  await writeFile(fx.statusPath, JSON.stringify(original));
  let plan;
  const result = await runBattleBridgePostSyncRefresh({ beforeHead: fx.A, afterHead: fx.B, paths: fx.paths, expectedPaths: fx.paths,
    adapter: fx.adapter(fx.B, ['main.js', 'scripts/mission-orchestrator-worker.mjs'], {
      restartApprovedTarget: async () => {
        plan = JSON.parse(await readFile(fx.statusPath, 'utf8'));
        return { ok: true, exactHeadProofOk: true, sourceHead: fx.B };
      },
    }) });
  assert.equal(plan.targetFailureHistory.failures[0].observedAtUtc, original.timestampUtc);
  assert.equal(plan.targetFailureHistory.expectedSourceHead, fx.B);
  assert.equal(plan.targetFailureHistory.failures[0].blocker, 'REFRESH_TARGET_PROOF_FAILED');
  assert.equal(result.ok, true);
  assert.deepEqual(result.targetFailureHistory.failures, []);
});

test('real checkpoint write failure preserves proven target success and creates no native refusal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-checkpoint-write-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const beforeHead = 'a'.repeat(40), afterHead = 'b'.repeat(40);
  const success = () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true });
  const adapter = { inspectHeads: success, isAncestor: () => ({ ok: true, ancestor: true }),
    changedPaths: () => ({ ok: true, paths: ['main.js'] }),
    refreshUi: () => ({ ok: false, sourceHead: afterHead, exactHeadProofOk: false }),
    reconcileControlPlane: () => { throw new Error('Publication failure must hold before reconciliation'); } };
  const first = await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths, adapter });
  assert.equal(first.targetFailureHistory.failures.length, 1);
  await mkdir(join(paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${afterHead}-checkpoint-1.json`));
  const result = await runBattleBridgePostSyncRefresh({ beforeHead, afterHead, paths, expectedPaths: paths,
    adapter: { ...adapter, refreshUi: success } });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REFRESH_CHECKPOINT_PUBLICATION_FAILED:stephanos-ui-4173');
  assert.equal(result.resultTargets[0].ok, true);
  assert.deepEqual(result.targetFailureHistory.failures, []);
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), 'utf8'));
  assert.equal(status.phase, 'blocked');
  assert.equal(status.classification, 'BLOCKED_REFRESH_FAILED');
  assert.equal(status.blocker, result.blocker);
});

async function retainedRefreshFixture(t, { complete = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-retained-debt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), D = 'd'.repeat(40);
  const calls = [];
  const adapter = (head, changedPaths, options = {}) => ({
    inspectHeads: () => ({ ok: true, exactHeadProofOk: true, sourceHead: head }),
    isAncestor: (before, after) => ({ ok: true, ancestor: before <= after }),
    changedPaths: input => { calls.push({ kind: 'diff', beforeHead: input.beforeHead, afterHead: input.afterHead }); return { ok: true, paths: changedPaths }; },
    refreshUi: () => { calls.push({ kind: 'ui' }); return { ok: true, exactHeadProofOk: true, sourceHead: head }; },
    restartApprovedTarget: () => { calls.push({ kind: 'worker' }); return { ok: complete, exactHeadProofOk: complete, sourceHead: head, blocker: complete ? '' : 'FIXTURE_WORKER_HELD' }; },
    reconcileControlPlane: () => ({ ok: true, exactHeadProofOk: true, sourceHead: head }),
    ...options,
  });
  const initial = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead: A, afterHead: B,
    adapter: adapter(B, ['main.js', 'scripts/mission-orchestrator-worker.mjs']) });
  assert.equal(initial.ok, complete);
  calls.length = 0;
  const statusPath = join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  return { paths, A, B, C, D, adapter, calls, statusPath };
}

test('a reverted or missing retained target holds before replacing the original failed report', async t => {
  const fx = await retainedRefreshFixture(t);
  const before = await readFile(fx.statusPath);
  // UI was proven, worker was not. Both original selected targets remain due.
  const result = await runBattleBridgePostSyncRefresh({ paths: fx.paths, expectedPaths: fx.paths, beforeHead: fx.B, afterHead: fx.C,
    adapter: fx.adapter(fx.C, ['main.js']) });
  assert.equal(result.blocker, 'POST_SYNC_RETAINED_TARGET_COVERAGE_UNPROVEN');
  assert.deepEqual(fx.calls, [{ kind: 'diff', beforeHead: fx.A, afterHead: fx.C }]);
  assert.deepEqual(await readFile(fx.statusPath), before);
});

test('unrelated, future or malformed retained refresh reports hold without replacing evidence', async t => {
  for (const scenario of ['unrelated', 'future', 'malformed']) {
    const fx = await retainedRefreshFixture(t);
    let adapter = fx.adapter(fx.C, ['main.js', 'scripts/mission-orchestrator-worker.mjs']);
    if (scenario === 'unrelated') adapter.isAncestor = () => ({ ok: true, ancestor: false });
    if (scenario === 'future') {
      const record = JSON.parse(await readFile(fx.statusPath, 'utf8')); record.afterHead = fx.D;
      await writeFile(fx.statusPath, JSON.stringify(record));
    }
    if (scenario === 'malformed') {
      const record = JSON.parse(await readFile(fx.statusPath, 'utf8')); delete record.classification;
      await writeFile(fx.statusPath, JSON.stringify(record));
    }
    const before = await readFile(fx.statusPath);
    const result = await runBattleBridgePostSyncRefresh({ paths: fx.paths, expectedPaths: fx.paths, beforeHead: fx.B, afterHead: fx.C, adapter });
    assert.equal(result.ok, false, scenario);
    assert.match(result.blocker, /^PENDING_POST_SYNC_/);
    assert.deepEqual(fx.calls, [], scenario);
    assert.deepEqual(await readFile(fx.statusPath), before, scenario);
  }
});

test('exact covered completed receipt is reused without replaying its native target handlers', async t => {
  const fx = await retainedRefreshFixture(t, { complete: true });
  const before = await readFile(fx.statusPath);
  const result = await runBattleBridgePostSyncRefresh({ paths: fx.paths, expectedPaths: fx.paths, beforeHead: fx.A, afterHead: fx.B,
    adapter: fx.adapter(fx.B, ['main.js', 'scripts/mission-orchestrator-worker.mjs']) });
  assert.equal(result.ok, true);
  assert.equal(result.retainedCompletionReused, true);
  assert.deepEqual(fx.calls, []);
  assert.deepEqual(await readFile(fx.statusPath), before);
});

test('fresh child uses the new delta after old completion so an intermediate UI revert cannot disappear', async t => {
  const fx = await retainedRefreshFixture(t, { complete: true });
  await writeFile(join(fx.paths.workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'), JSON.stringify({
    schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status', statusId: 'battle-bridge-github-sync-current',
    classification: 'BLOCKED_POST_SYNC_REFRESH_REQUIRED', localHeadBefore: fx.A, localHeadAfter: fx.B,
  }));
  const result = await runBattleBridgePostSyncRefresh({ paths: fx.paths, expectedPaths: fx.paths, beforeHead: fx.B, afterHead: fx.C,
    adapter: fx.adapter(fx.C, ['main.js']) });
  assert.equal(result.ok, true);
  assert.equal(result.beforeHead, fx.B);
  assert.deepEqual(fx.calls, [{ kind: 'diff', beforeHead: fx.B, afterHead: fx.C }, { kind: 'ui' }]);
});

test('fixed refresh ancestry is bounded, primitive-only and never treats probe errors as ancestry', () => {
  const A = 'a'.repeat(40), B = 'b'.repeat(40), calls = [];
  const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' }; } });
  assert.equal(adapter.isAncestor(A, B, '/fixture').ok, false);
  for (const value of [[A], A.toUpperCase(), ` ${A}`, 'main']) assert.equal(adapter.isAncestor(value, B, '/fixture').ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].options.timeout <= 1000);
  assert.equal(calls[0].options.maxBuffer, 64 * 1024);
});

test('fresh coordinator compares immutable heads through fixed shell-free git argv', () => {
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /diff', '--name-status', '--find-renames', '--diff-filter=ACDMRT'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression/);
});

test('runtime adapters are fixed to UI backend worker mailbox Sovereign Commander natural reload and bounded control-plane repair', () => {
  assert.match(source, /refreshStephanosUi4173/);
  assert.match(source, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(source, /target: 'backend'/);
  assert.match(source, /target: 'mission-worker'/);
  assert.match(source, /install-battle-bridge-github-command-mailbox\.ps1/);
  assert.match(source, /restartGitHubMailbox/);
  assert.match(source, /refreshSovereignCommander/);
  assert.match(source, /run-sovereign-commander-hidden\.ps1/);
  assert.match(source, /requiredCapabilityVersion/);
  assert.match(source, /capabilityVersionAfter/);
  assert.match(source, /'-StartNow'/);
  assert.match(source, /confirmNaturalReload/);
  assert.match(source, /reconcileBattleBridgeControlPlane/);
  assert.doesNotMatch(source, /reconcile-battle-bridge-control-plane\.ps1/);
  assert.doesNotMatch(source, /WAKE_BATTLE_BRIDGE_RECOVERY_MESH/);
  assert.match(source, /refreshUiFn\(\{ expectedHead: afterHead \}\)/);
});

test('mailbox restart proof accepts no-stale-instance and requires successful attempted quiesce', () => {
  const afterHead = 'e'.repeat(40);
  const calls = [];
  const mailboxPayloads = [
    {
      installed: true,
      startedNow: true,
      quiesceAttempted: false,
      staleRunningInstanceQuiesced: false,
    },
    {
      installed: true,
      startedNow: true,
      quiesceAttempted: true,
      staleRunningInstanceQuiesced: true,
    },
    {
      installed: true,
      startedNow: true,
      quiesceAttempted: true,
      staleRunningInstanceQuiesced: false,
    },
  ];
  let mailboxCall = 0;
  const spawnSyncFn = (command, args) => {
    calls.push({ command, args });
    if (String(command).toLowerCase().includes('powershell')) {
      const payload = mailboxPayloads[Math.min(mailboxCall, mailboxPayloads.length - 1)];
      mailboxCall += 1;
      return { status: 0, stdout: JSON.stringify(payload), stderr: '' };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: afterHead + '\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn });
  const paths = {
    repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
    mailboxInstaller: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os\\scripts\\windows\\install-battle-bridge-github-command-mailbox.ps1',
  };
  const noStale = adapter.restartGitHubMailbox({ afterHead, paths });
  assert.equal(noStale.ok, true);
  assert.equal(noStale.blocker, '');
  assert.equal(noStale.staleRunningInstanceQuiesced, false);

  const quiesced = adapter.restartGitHubMailbox({ afterHead, paths });
  assert.equal(quiesced.ok, true);
  assert.equal(quiesced.staleRunningInstanceQuiesced, true);

  const failedQuiesce = adapter.restartGitHubMailbox({ afterHead, paths });
  assert.equal(failedQuiesce.ok, false);
  assert.equal(failedQuiesce.blocker, 'GITHUB_MAILBOX_RESTART_PROOF_INVALID');
});

test('fixed Sovereign refresh proves current capability and exact source head without arbitrary shell', () => {
  const afterHead = 'f'.repeat(40);
  const calls = [];
  const spawnSyncFn = (command, args) => {
    calls.push({ command, args });
    if (String(command).toLowerCase().includes('powershell')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 'stephanos.sovereign-commander-watchdog.v1',
          taskName: 'Stephanos Sovereign Commander',
          daemonHealthy: true,
          healthyAfter: true,
          requiredCapabilityVersion: '2026-10-02-mailbox-rollover-v2',
          capabilityVersionAfter: '2026-10-02-mailbox-rollover-v2',
          staleCapabilityRecycleRequested: true,
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
          arbitraryShellAllowed: false,
          pcRestartAllowed: false,
          visiblePowerShellRequired: false,
          blocker: '',
        }),
        stderr: '',
      };
    }
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { status: 0, stdout: afterHead + '\n', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn });
  const result = adapter.refreshSovereignCommander({
    afterHead,
    paths: { repoRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.exactHeadProofOk, true);
  assert.equal(result.capabilityVersion, '2026-10-02-mailbox-rollover-v2');
  assert.equal(result.requiredCapabilityVersion, result.capabilityVersion);
  assert.equal(result.staleCapabilityRecycleRequested, true);
  const powershell = calls.find((entry) => String(entry.command).toLowerCase().includes('powershell'));
  assert.ok(powershell);
  assert.ok(powershell.args.some((value) => String(value).endsWith('run-sovereign-commander-hidden.ps1')));
  assert.equal(JSON.stringify(calls).includes('Invoke-Expression'), false);
});

test('control-plane repair runs only after normal exact-head refresh execution passes', () => {
  const executeIndex = source.indexOf('executePostSyncRefreshPlan({');
  const reconcileIndex = source.indexOf('adapter.reconcileControlPlane({ afterHead: normalizedAfter, paths })');
  assert.ok(executeIndex >= 0);
  assert.ok(reconcileIndex > executeIndex);
  assert.match(source, /execution\.ok === true\s*\? adapter\.reconcileControlPlane/);
  assert.match(source, /exactHeadProofOk: effectiveExecution\.exactHeadProofOk === true && controlPlaneReconcile\.ok === true/);
});

test('control-plane failure telemetry appends only canonical fixed task identities', () => {
  assert.equal(
    projectControlPlaneFailureBlocker({
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      failedTaskId: 'recoveryMesh',
    }),
    'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh',
  );
  assert.equal(
    projectControlPlaneFailureBlocker({
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      failedTaskId: '../../secrets',
    }),
    'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
  );
  assert.equal(projectControlPlaneFailureBlocker({ failedTaskId: 'recoveryMesh' }), '');
});

test('fixed control-plane failure identity is persisted into remote-readable post-sync status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-control-plane-failure-'));
  try {
    const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace'), restartScript: join(root, 'unused.ps1') };
    await mkdir(paths.repoRoot, { recursive: true });
    const beforeHead = 'c'.repeat(40);
    const afterHead = 'd'.repeat(40);
    const result = await runBattleBridgePostSyncRefresh({
      beforeHead,
      afterHead,
      paths,
      expectedPaths: paths,
      now: new Date('2026-08-26T14:00:00.000Z'),
      adapter: {
        inspectHeads: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
        changedPaths: () => ({ ok: true, paths: ['docs/runtime-proof.md'] }),
        reconcileControlPlane: () => ({
          ok: false,
          blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
          failedTaskId: 'recoveryMesh',
          sourceHead: afterHead,
          exactHeadProofOk: false,
        }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh');
    assert.equal(result.controlPlaneReconcile.failedTaskId, 'recoveryMesh');
    const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), 'utf8'));
    assert.equal(status.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh');
    assert.equal(status.classification, 'BLOCKED_REFRESH_FAILED');
    assert.equal(status.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_BLOCKED');
    assert.doesNotMatch(JSON.stringify(status), /\.\.\/|secrets/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('caretaker failure remains diagnosed during a same-head retry and clears only on actual reconciliation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-caretaker-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  const beforeHead = 'c'.repeat(40), afterHead = 'd'.repeat(40);
  const evidence = { schemaVersion: 'stephanos.sovereign-caretaker-execution.v1',
    expectedSourceHead: afterHead, observedAtUtc: '2026-10-31T00:06:31.000Z', exitStatus: 2,
    spawnErrorCode: '', terminationSignal: '', failureReceiptRecognized: true,
    reportedBlocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN',
    reportedVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED', diagnosticOnly: true };
  const pass = () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true });
  const adapter = {
    inspectHeads: pass,
    changedPaths: () => ({ ok: true, paths: ['main.js'] }),
    refreshUi: pass,
    reconcileControlPlane: () => ({ ok: false, blocker: 'SOVEREIGN_COMMANDER_WATCHDOG_EXECUTION_FAILED',
      sourceHead: afterHead, sovereignCaretakerExecution: { ...evidence, stdout: 'PRIVATE_OUTPUT' } }),
  };
  const first = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead, afterHead, adapter });
  assert.equal(first.ok, false);
  assert.equal(first.classification, 'BLOCKED_REFRESH_FAILED');
  assert.equal(first.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_BLOCKED');
  assert.deepEqual(first.lastSovereignCaretakerFailure, evidence);
  const statusPath = join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  const failed = JSON.parse(await readFile(statusPath, 'utf8'));
  assert.deepEqual(failed.sovereignCaretakerExecution, evidence);
  assert.deepEqual(failed.lastSovereignCaretakerFailure, evidence);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_/);
  const blockedReceiptPath = join(paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${afterHead}-blocked.json`);
  const blockedReceipt = await readFile(blockedReceiptPath);
  let observedPlan = false;
  const second = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead, afterHead,
    adapter: { ...adapter, reconcileControlPlane: () => {
      const plan = JSON.parse(readFileSync(statusPath, 'utf8'));
      assert.equal(plan.phase, 'plan');
      assert.equal(plan.classification, 'REFRESH_READY');
      assert.equal(plan.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_BLOCKED');
      assert.deepEqual(plan.lastSovereignCaretakerFailure, evidence);
      observedPlan = true;
      return pass();
    } } });
  assert.equal(observedPlan, true);
  assert.equal(second.ok, true);
  assert.equal(second.lastSovereignCaretakerFailure, null);
  const complete = JSON.parse(await readFile(statusPath, 'utf8'));
  assert.equal(complete.phase, 'complete');
  assert.equal(complete.lastSovereignCaretakerFailure, null);
  assert.deepEqual(await readFile(blockedReceiptPath), blockedReceipt);
});

test('workspace publication contains bounded projections and relative proof refs', () => {
  assert.match(source, /receipts', 'post-sync-runtime-refresh'/);
  assert.match(source, /post-sync-runtime-refresh-current\.json/);
  assert.match(source, /buildPostSyncRefreshProjection/);
  assert.doesNotMatch(source, /proofRefs:\s*\[[^\]]*repoRoot/);
});

test('runtime projection cannot overwrite required Shared Workspace record schemas', () => {
  const proofProjection = source.indexOf('...projection,', source.indexOf('const proof = Object.freeze'));
  const proofRecord = source.indexOf('...createSharedWorkspaceProofRecord', source.indexOf('const proof = Object.freeze'));
  const statusProjection = source.indexOf('...projection,', source.indexOf('const status = Object.freeze'));
  const statusRecord = source.indexOf('...createSharedWorkspaceStatusRecord', source.indexOf('const status = Object.freeze'));
  assert.ok(proofProjection >= 0 && proofRecord > proofProjection);
  assert.ok(statusProjection >= 0 && statusRecord > statusProjection);
});

test('real workspace publication preserves proof and status schemas when projection has its own schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-schema-regression-'));
  try {
    const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace'), restartScript: join(root, 'unused.ps1') };
    await mkdir(paths.repoRoot, { recursive: true });
    const beforeHead = 'a'.repeat(40);
    const afterHead = 'b'.repeat(40);
    const result = await runBattleBridgePostSyncRefresh({
      beforeHead,
      afterHead,
      paths,
      expectedPaths: paths,
      now: new Date('2026-08-09T01:00:00.000Z'),
      adapter: {
        inspectHeads: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
        changedPaths: () => ({ ok: true, paths: ['docs/runtime-proof.md'] }),
        reconcileControlPlane: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
      },
    });
    assert.equal(result.ok, true);
    const proof = JSON.parse(await readFile(join(paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${afterHead}-complete.json`), 'utf8'));
    const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), 'utf8'));
    assert.equal(proof.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(proof.kind, 'stephanos.shared_workspace.proof');
    assert.equal(status.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(status.kind, 'stephanos.shared_workspace.status');
    assert.equal(status.afterHead, afterHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('coordinator resumes exact-head target checkpoints without replaying completed work', () => {
  assert.match(source, /loadResumeResults/);
  assert.match(source, /completedResults/);
  assert.match(source, /checkpoint-\$\{results\.length\}/);
  assert.ok(
    source.indexOf('loadResumeResults(paths.workspaceRoot')
      < source.indexOf("phase: 'plan'"),
  );
});

test('CLI accepts only before and after SHAs and emits one result marker', () => {
  assert.match(source, /POST_SYNC_REFRESH_RESULT=/);
  assert.match(source, /POST_SYNC_REFRESH_ARGUMENT_NOT_ALLOWED/);
  assert.match(source, /POST_SYNC_HEADS_INVALID/);
});
