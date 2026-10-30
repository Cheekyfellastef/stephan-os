import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFixedSyncAndRefreshAdapter,
  SYNC_AND_REFRESH_CHILD_BUDGET_MS,
  SYNC_AND_REFRESH_MIN_REMAINING_MS,
  SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS,
  projectSyncAndRefreshStatus,
  readPendingPostSyncRefresh,
  runBattleBridgeSyncAndRefresh as runSyncAndRefreshWithRealAncestry,
} from './battle-bridge-github-sync-and-refresh.mjs';
import { validateSharedWorkspaceRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { pendingPostSyncRefreshDebt } from './battle-bridge-github-sync-policy.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const paths = { repoRoot: '/canonical/repo', workspaceRoot: '/canonical/workspace' };
const linearAncestry = (before, after) => ({ ok: true, ancestor: before <= after });
const runBattleBridgeSyncAndRefresh = options => runSyncAndRefreshWithRealAncestry({
  ...options, adapter: { isAncestor: linearAncestry, ...options.adapter },
});

function completedRefresh(beforeHead = A, afterHead = B) {
  return { ok: true, phase: 'complete', beforeHead, afterHead, sourceHead: afterHead,
    classification: 'NO_RUNTIME_REFRESH_REQUIRED', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
    exactHeadProofOk: true, blocker: '', targetIds: [], resultTargets: [],
    changedPathCount: 1, noRuntimePathCount: 1, unknownPathCount: 0, unsafePathCount: 0,
    openClawPathCount: 0, pluginHostActivationRequired: false };
}

// Child processes use the real source/refresh writers with fixture Git/native
// adapters. This preserves the production synchronous child boundary and the
// on-disk handoff between separate invocations.
const debtChildProgram = `
const { readFile, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const input = JSON.parse(process.argv[1]);
const state = JSON.parse(await readFile(input.paths.sourceState, 'utf8'));
const ancestor = (before, after) => ({ ok: true, ancestor: before <= after });
let result;
if (input.mode === 'sync') {
  const { runBattleBridgeGitHubSync, FIXED_SYNC_GIT_COMMANDS: ids } = await import(input.syncModule);
  const outputs = {
    [ids.currentBranch.id]: () => 'main', [ids.originUrl.id]: () => 'https://github.com/Cheekyfellastef/stephan-os.git',
    [ids.statusPorcelain.id]: () => '', [ids.localHead.id]: () => state.local, [ids.remoteHead.id]: () => state.remote,
    [ids.mergeBase.id]: () => state.local, [ids.fetchOriginMain.id]: () => '',
    [ids.mergeFfOnlyOriginMain.id]: () => { state.local = state.remote; return ''; },
  };
  result = await runBattleBridgeGitHubSync({ paths: input.paths, expectedPaths: input.paths,
    git: { isAncestor: ancestor, run(id) { if (!outputs[id]) throw Error('unexpected fixture Git command'); return { ok: true, stdout: outputs[id](), stderr: '' }; } },
    rotationPreflightFn: () => ({ ok: true, required: false }) });
  await writeFile(input.paths.sourceState, JSON.stringify(state));
  if (input.legacyWriter) {
    // Exact old-writer record/return shape after source-forward: no retained
    // pendingRefresh field. The prior refresh report remains untouched.
    const filename = join(input.paths.workspaceRoot, 'status', 'battle-bridge-github-sync-current.json');
    const status = JSON.parse(await readFile(filename, 'utf8')); delete status.pendingRefresh;
    await writeFile(filename, JSON.stringify(status));
    if (result.facts) delete result.facts.pendingRefresh;
  }
} else {
  const { runBattleBridgePostSyncRefresh } = await import(input.refreshModule);
  const pass = () => ({ ok: true, exactHeadProofOk: true, sourceHead: input.afterHead });
  result = await runBattleBridgePostSyncRefresh({ paths: input.paths, expectedPaths: input.paths,
    beforeHead: input.beforeHead, afterHead: input.afterHead,
    adapter: {
      isAncestor: ancestor,
      inspectHeads: () => ({ ...pass(), ok: state.local === input.afterHead }),
      changedPaths: ({ beforeHead, afterHead }) => ({ ok: true, paths: [
        ...(beforeHead === input.originalBefore ? ['scripts/launcher-readiness-live-facts.mjs', 'stephanos-server/server.js', 'scripts/mission-orchestrator-worker.mjs'] : []),
        ...(afterHead === input.repairAfter ? ['shared/agents/postSyncRuntimeRefreshCoordinator.mjs', 'shared/agents/postSyncRuntimeRefreshCoordinator.test.mjs'] : []),
      ] }),
      refreshUi: () => input.failUi ? { ok: false, exactHeadProofOk: false, sourceHead: input.beforeHead, blocker: 'UI_4173_EXACT_HEAD_PROOF_FAILED' } : pass(),
      restartApprovedTarget: pass, restartGitHubMailbox: pass, confirmNaturalReload: pass, reconcileControlPlane: pass,
    } });
}
process.stdout.write(JSON.stringify(result));
`;

async function productionDebtFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sync-refresh-debt-composition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixturePaths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace'), sourceState: join(root, 'source-state.json') };
  await mkdir(fixturePaths.repoRoot);
  await writeFile(fixturePaths.sourceState, JSON.stringify({ local: A, remote: B }));
  const child = (mode, extra = {}) => {
    const input = { mode, paths: fixturePaths, originalBefore: A, repairAfter: C,
      syncModule: new URL('./battle-bridge-github-sync-executor.mjs', import.meta.url).href,
      refreshModule: new URL('./battle-bridge-post-sync-refresh.mjs', import.meta.url).href, ...extra };
    const executed = spawnSync(process.execPath, ['--input-type=module', '-e', debtChildProgram, JSON.stringify(input)], { encoding: 'utf8', timeout: 10_000, shell: false });
    assert.ifError(executed.error);
    assert.equal(executed.status, 0, executed.stderr);
    return { ok: true, result: JSON.parse(executed.stdout) };
  };
  assert.equal(child('sync').result.sourceUpdated, true);
  const calls = [];
  const invoke = (failUi, legacyCaller = false) => runSyncAndRefreshWithRealAncestry({
    paths: fixturePaths, expectedPaths: fixturePaths, platform: 'linux', ...safeGoalDiscoveryArgs(),
    ...(legacyCaller ? { pendingReader: async () => null } : {}),
    adapter: {
      isAncestor: linearAncestry,
      runSync: () => child('sync', { legacyWriter: legacyCaller }),
      runRefresh: ({ beforeHead, afterHead }) => { calls.push({ beforeHead, afterHead }); return child('refresh', { beforeHead, afterHead, failUi }); },
    },
  });
  return { paths: fixturePaths, calls, invoke, child };
}

test('production writers retain failed refresh across no-change retries and pay the original range after repair adoption', async t => {
  const fx = await productionDebtFixture(t);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const failed = await fx.invoke(true);
    assert.equal(failed.ok, false);
    assert.equal(failed.blocker, 'UI_4173_EXACT_HEAD_PROOF_FAILED');
    assert.equal((await readPendingPostSyncRefresh(fx.paths)).spans[0].beforeHead, A);
  }
  assert.deepEqual(fx.calls, [{ beforeHead: A, afterHead: B }, { beforeHead: A, afterHead: B }]);
  const oldReceipt = join(fx.paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${B}-blocked.json`);
  const historical = await readFile(oldReceipt);
  await writeFile(fx.paths.sourceState, JSON.stringify({ local: B, remote: C }));
  const adopted = await fx.invoke(false);
  assert.equal(adopted.ok, true);
  assert.deepEqual(fx.calls.at(-1), { beforeHead: A, afterHead: C });
  assert.deepEqual(adopted.refreshes[0].result.targetIds, ['stephanos-ui-4173', 'stephanos-backend-8787', 'mission-orchestrator-worker', 'github-command-mailbox', 'natural-reload']);
  assert.deepEqual(await readFile(oldReceipt), historical);
  const sync = JSON.parse(await readFile(join(fx.paths.workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'), 'utf8'));
  assert.equal(sync.pendingRefresh, null);
  assert.deepEqual((await readPendingPostSyncRefresh(fx.paths)).spans, []);
});

test('fresh refresh child recovers old debt when the already-loaded old caller supplies only the repair delta', async t => {
  const fx = await productionDebtFixture(t);
  assert.equal((await fx.invoke(true)).ok, false);
  await writeFile(fx.paths.sourceState, JSON.stringify({ local: B, remote: C }));
  const adopted = await fx.invoke(false, true);
  assert.equal(adopted.ok, true);
  assert.deepEqual(fx.calls.at(-1), { beforeHead: B, afterHead: C });
  assert.equal(adopted.refreshes[0].result.beforeHead, A);
  assert.equal(adopted.refreshes[0].result.afterHead, C);
  assert.ok(adopted.refreshes[0].result.targetIds.includes('stephanos-ui-4173'));
  assert.ok(adopted.refreshes[0].result.targetIds.includes('stephanos-backend-8787'));
  assert.ok(adopted.refreshes[0].result.targetIds.includes('mission-orchestrator-worker'));
});

test('no-change sync incorporates debt retained by a competing original sync invocation', async () => {
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({ paths, expectedPaths: paths, ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync: () => ({ ok: true, result: { ...noChange(C), facts: { ...noChange(C).facts, pendingRefresh: pendingPostSyncRefreshDebt([{ beforeHead: B, afterHead: C }]) } } }),
      runRefresh: input => { calls.push(input); return { ok: true, result: { ok: false, blocker: 'FIXTURE_REFRESH_HELD' } }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FIXTURE_REFRESH_HELD');
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].beforeHead, B);
  assert.equal(calls[0].afterHead, C);
});

function noChange(head = B) {
  return { ok: true, evaluation: { classification: 'SYNC_NO_CHANGE' }, facts: { localHead: head, remoteHead: head } };
}

function updated(before = A, after = B) {
  return {
    ok: false,
    sourceUpdated: true,
    evaluation: { classification: 'BLOCKED_POST_SYNC_REFRESH_REQUIRED' },
    facts: { localHead: before, localHeadBefore: before, localHeadAfter: after, remoteHead: after },
  };
}

function blocked(classification = 'BLOCKED_DIRTY_SOURCE', head = A) {
  return {
    ok: false,
    sourceUpdated: false,
    evaluation: { classification },
    facts: { localHead: head, remoteHead: head },
  };
}

function safeGoalDiscoveryArgs() {
  return { goalDiscoveryHeartbeat: async () => ({ ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' }) };
}

function nonWindowsRepairArgs() {
  return {
    platform: 'linux',
    controlPlaneReconciler() { throw new Error('must not run on non-Windows'); },
    ...safeGoalDiscoveryArgs(),
  };
}

test('pending old-executor refresh is paid after a safe source observation and then reconverges', async () => {
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runRefresh(input) { calls.push(['refresh', input.beforeHead, input.afterHead]); return { ok: true, result: completedRefresh(input.beforeHead, input.afterHead) }; },
      runSync() { calls.push(['sync']); return { ok: true, result: noChange(B) }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['sync'], ['refresh', A, B], ['sync']]);
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(result.sourceForwardedBeforeRefresh, false);
  assert.equal(result.refreshDebtCoalesced, false);
  assert.equal(result.freshCoordinatorProcessUsed, true);
  assert.equal(result.controlPlaneRepair.classification, 'CONTROL_PLANE_REPAIR_SKIPPED_NON_WINDOWS');
  assert.equal(result.goalDiscoveryObserved, true);
});

test('stale refresh debt cannot strand delivery of its own repair and is coalesced to newest exact head', async () => {
  const calls = [];
  const syncResults = [updated(B, C), noChange(C)];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runSync() { calls.push('sync'); return { ok: true, result: syncResults.shift() }; },
      runRefresh(input) {
        calls.push(`refresh:${input.beforeHead}:${input.afterHead}`);
        return { ok: true, result: completedRefresh(input.beforeHead, input.afterHead) };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sync', `refresh:${A}:${C}`, 'sync']);
  assert.equal(result.sourceHead, C);
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(result.sourceForwardedBeforeRefresh, true);
  assert.equal(result.refreshDebtCoalesced, true);
  assert.equal(result.refreshes[0].pendingAfterHead, B);
  assert.equal(result.refreshes[0].debtCoalesced, true);
});

test('new source update without old debt refreshes and then runs a second sync for current-state convergence', async () => {
  const calls = [];
  const syncResults = [updated(), noChange()];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { calls.push('sync'); return { ok: true, result: syncResults.shift() }; },
      runRefresh(input) { calls.push(`refresh:${input.beforeHead}:${input.afterHead}`); return { ok: true, result: completedRefresh(input.beforeHead, input.afterHead) }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sync', `refresh:${A}:${B}`, 'sync']);
  assert.equal(result.sourceForwardedBeforeRefresh, false);
  assert.equal(result.refreshDebtCoalesced, false);
});

test('converged Windows sync wakes goal discovery and reconciles the fixed recovery mesh', async () => {
  const repairs = [];
  const wakeups = [];
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    controlPlaneReconciler(input) {
      calls.push('repair');
      repairs.push(input);
      return {
        ok: true,
        finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED',
        arbitraryTaskNameAllowed: false,
        arbitraryShellAllowed: false,
        sourceMutationAllowed: false,
        gitMutationAllowed: false,
        pcRestartAllowed: false,
      };
    },
    goalDiscoveryHeartbeat: async () => {
      calls.push('goal-discovery');
      wakeups.push('goal-discovery');
      return { ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.controlPlaneRepair.classification, 'CONTROL_PLANE_RECONCILED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
  assert.deepEqual(repairs, [{ repoRoot: paths.repoRoot, expectedHead: B, platform: 'win32' }]);
  assert.deepEqual(wakeups, ['goal-discovery']);
  assert.deepEqual(calls, ['goal-discovery', 'repair']);
  assert.equal(result.goalDiscoveryObserved, true);
  assert.equal(result.workConservingGoalDiscoveryPreserved, true);
});

test('converged Windows sync pulses the bounded mailbox even when Recovery Mesh repair remains blocked', async () => {
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
      runMailboxPulse() {
        calls.push('mailbox-pulse');
        return {
          ok: true,
          blocker: '',
          result: {
            ok: true,
            finalVerdict: 'MAILBOX_WITH_RECEIPT_INDEX_READY',
          },
        };
      },
    },
    controlPlaneReconciler() {
      calls.push('repair');
      return { ok: false, blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED' };
    },
    goalDiscoveryHeartbeat: async () => {
      calls.push('goal-discovery');
      return { ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.deepEqual(calls, ['goal-discovery', 'mailbox-pulse', 'repair']);
  assert.equal(result.mailboxPulseObserved, true);
  assert.equal(result.mailboxPulse.ok, true);
  assert.equal(result.mailboxPulse.classification, 'MAILBOX_PULSE_READY');
  assert.equal(result.workConservingMailboxPulsePreserved, true);
});

test('mailbox pulse preserves the child guard blocker even when the child exits nonzero', () => {
  const adapter = createFixedSyncAndRefreshAdapter({
    spawnSyncFn: () => ({
      status: 1,
      stdout: JSON.stringify({
        ok: false,
        blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
        error: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
        finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      }),
      stderr: '',
    }),
  });
  const pulse = adapter.runMailboxPulse({ repoRoot: '/canonical/repo', mailboxRunner: '/canonical/repo/mailbox.mjs' });
  assert.equal(pulse.ok, false);
  assert.equal(pulse.blocker, 'MAILBOX_OUTBOX_GUARD_FAILED');
  assert.equal(pulse.result.error, 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING');
  assert.equal(pulse.result.finalVerdict, 'MAILBOX_OUTBOX_GUARD_BLOCKED');
});

test('sync status projection exposes bounded mailbox pulse truth without secrets or arbitrary authority', () => {
  const record = projectSyncAndRefreshStatus({
    ok: false,
    sourceHead: B,
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh',
    finalVerdict: 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED',
    mailboxPulseObserved: true,
    mailboxPulse: {
      ok: false,
      classification: 'MAILBOX_PULSE_BLOCKED',
      blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
      detailCode: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
      finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
      pulseAttempted: true,
      secret: 'must-not-leak',
    },
    controlPlaneRepair: {
      ok: false,
      classification: 'CONTROL_PLANE_REPAIR_BLOCKED',
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh',
      repairAttempted: true,
      privatePath: 'C:/private',
    },
  }, { observedAtUtc: '2026-10-02T17:40:00.000Z' });

  assert.equal(record.schemaVersion, 'shared-agent-workspace-record.v1');
  assert.equal(record.kind, 'stephanos.shared_workspace.status');
  assert.equal(record.statusId, 'battle-bridge-sync-and-refresh-current');
  assert.equal(record.schema, 'stephanos.battle-bridge-sync-and-refresh-status.v1');
  assert.equal(record.sourceHead, B);
  assert.equal(record.mailboxPulseObserved, true);
  assert.deepEqual(record.mailboxPulse, {
    ok: false,
    classification: 'MAILBOX_PULSE_BLOCKED',
    blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
    detailCode: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
    finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
    pulseAttempted: true,
  });
  assert.equal(record.controlPlaneRepair.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh');
  assert.equal(record.arbitraryShellAllowed, false);
  assert.equal(record.sourceMutationAllowed, false);
  assert.equal(Object.hasOwn(record, 'secretValuesPublished'), false);
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs: Date.parse('2026-10-02T17:40:00.000Z'),
  });
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.doesNotMatch(JSON.stringify(record), /must-not-leak|C:\/private/);
});

test('control-plane repair failure still blocks wrapper completion after one work-conserving goal-discovery tick', async () => {
  let wakeups = 0;
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    controlPlaneReconciler() {
      calls.push('repair');
      return { ok: false, blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED' };
    },
    goalDiscoveryHeartbeat: async () => {
      calls.push('goal-discovery');
      wakeups += 1;
      return { ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
  assert.equal(wakeups, 1);
  assert.deepEqual(calls, ['goal-discovery', 'repair']);
  assert.equal(result.goalDiscoveryObserved, true);
  assert.equal(result.workConservingGoalDiscoveryPreserved, true);
});

test('goal discovery failure blocks otherwise converged completion', async () => {
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    goalDiscoveryHeartbeat: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY', finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'NO_QUALIFIED_CAPACITY');
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_GOAL_DISCOVERY_BLOCKED');
});

test('refresh blocker stops without starting another sync cycle', async () => {
  let syncCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { syncCalls += 1; return { ok: true, result: updated() }; },
      runRefresh() { return { ok: true, result: { ok: false, blocker: 'OPENCLAW_REFRESH_APPROVAL_REQUIRED' } }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_REFRESH_APPROVAL_REQUIRED');
  assert.equal(syncCalls, 1);
});

test('malformed refresh debt cannot block a safe source-forward but still blocks runtime completion', async () => {
  let refreshCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: false, blocker: 'PENDING_POST_SYNC_HEADS_INVALID' }),
    adapter: {
      runSync() { return { ok: true, result: updated(A, B) }; },
      runRefresh() { refreshCalls += 1; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PENDING_POST_SYNC_HEADS_INVALID');
  assert.equal(result.sourceHead, B);
  assert.equal(result.sourceForwardedBeforeRefresh, true);
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED');
  assert.equal(refreshCalls, 0);
});

test('unsafe source state still fails closed before any pending refresh execution', async () => {
  let refreshCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runSync() { return { ok: true, result: blocked('BLOCKED_DIRTY_SOURCE', B) }; },
      runRefresh() { refreshCalls += 1; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BLOCKED_DIRTY_SOURCE');
  assert.equal(refreshCalls, 0);
});

test('default transport launches only fixed Node scripts without a shell and uses fixed control-plane and goal-discovery owners', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  assert.match(source, /battle-bridge-github-sync-executor\.mjs/);
  assert.match(source, /battle-bridge-post-sync-refresh\.mjs/);
  assert.match(source, /battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
  assert.doesNotMatch(source, /mailboxRunner: path\.resolve\(repoRoot, 'scripts', 'battle-bridge-github-command-mailbox-with-receipt-index\.mjs'\)/);
  assert.match(source, /runMailboxPulse/);
  assert.match(source, /battleBridgeControlPlaneSelfRepairV1\.mjs/);
  assert.match(source, /battle-bridge-goal-discovery-heartbeat\.mjs/);
  assert.match(source, /reconcileBattleBridgeControlPlane/);
  assert.match(source, /runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /platform !== 'win32'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression|cmd\.exe/i);
});

test('fixed Windows sync task and coordinator leave a positive bounded cleanup window', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('./windows/install-battle-bridge-github-sync.ps1', import.meta.url), 'utf8');
  const match = script.match(/-ExecutionTimeLimit \(New-TimeSpan -Minutes (\d+)\)/);
  assert.ok(match, 'scheduled-task outer deadline must remain explicit');
  assert.ok(Number(match[1]) * 60_000 - SYNC_AND_REFRESH_CHILD_BUDGET_MS >= 120_000,
    'the cumulative child budget must preserve two minutes for status/cleanup and other host work');
  assert.equal(SYNC_AND_REFRESH_MIN_REMAINING_MS, 5_000);
});

test('default adapter caps every fixed child and treats a timed-out refresh as failure even with forged success stdout', () => {
  const observed = [];
  const adapter = createFixedSyncAndRefreshAdapter({
    spawnSyncFn: (_node, args, options) => {
      observed.push({ script: args[0], timeout: options.timeout });
      if (args[0] === 'refresh-script') {
        return { status: null, error: { code: 'ETIMEDOUT' },
          stdout: 'POST_SYNC_REFRESH_RESULT=' + JSON.stringify({ ok: true }) };
      }
      return { status: 0, stdout: JSON.stringify({ ok: true, evaluation: { classification: 'SYNC_NO_CHANGE' }, facts: { localHead: B, remoteHead: B } }) };
    },
  });
  const p = { repoRoot: '/canonical/repo', syncExecutor: 'sync-script', refreshCoordinator: 'refresh-script', mailboxRunner: 'mailbox-script' };
  assert.equal(adapter.runSync(p, { timeoutMs: 900_000 }).ok, true);
  assert.equal(adapter.runRefresh({ paths: p, beforeHead: A, afterHead: B, timeoutMs: 900_000 }).blocker, 'POST_SYNC_REFRESH_TIMEOUT');
  adapter.runMailboxPulse(p, { timeoutMs: 900_000 });
  assert.deepEqual(observed.map(x => x.timeout), [
    SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.sync,
    SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.refresh,
    SYNC_AND_REFRESH_CHILD_TIMEOUTS_MS.mailbox,
  ]);
  assert.equal(adapter.runSync(p, { timeoutMs: 0 }).blocker, 'SYNC_AND_REFRESH_CHILD_BUDGET_MISSING');
  assert.equal(adapter.runMailboxPulse(p, { timeoutMs: 0 }).blocker, 'SYNC_AND_REFRESH_CHILD_BUDGET_MISSING');
});

test('a slow sync does not launch a 15-minute post-sync refresh after the parent budget is exhausted', async () => {
  let clock = 0, refreshCalls = 0, syncCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths, expectedPaths: paths, nowMs: () => clock, ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync(_paths, { timeoutMs }) {
        syncCalls += 1;
        assert.ok(timeoutMs <= SYNC_AND_REFRESH_CHILD_BUDGET_MS);
        clock = SYNC_AND_REFRESH_CHILD_BUDGET_MS;
        return { ok: true, result: updated() };
      },
      runRefresh() { refreshCalls += 1; throw Error('must not run after budget'); },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SYNC_AND_REFRESH_PARENT_BUDGET_EXHAUSTED');
  assert.equal(result.budgetPhase, 'POST_SYNC');
  assert.equal(syncCalls, 1);
  assert.equal(refreshCalls, 0);
});

test('an over-budget goal-discovery callback does not trigger mailbox or maintenance writes or claim READY', async () => {
  let clock = 0, repairCalls = 0, pulseCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths, expectedPaths: paths, nowMs: () => clock, platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runMailboxPulse() { pulseCalls += 1; },
      runRefresh() { throw Error('unexpected refresh'); },
    },
    controlPlaneReconciler() { repairCalls += 1; },
    goalDiscoveryHeartbeat: async () => {
      clock = SYNC_AND_REFRESH_CHILD_BUDGET_MS;
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SYNC_AND_REFRESH_PARENT_BUDGET_EXHAUSTED');
  assert.equal(result.budgetPhase, 'POST_GOAL_DISCOVERY');
  assert.equal(repairCalls, 0);
  assert.equal(pulseCalls, 0);
});
