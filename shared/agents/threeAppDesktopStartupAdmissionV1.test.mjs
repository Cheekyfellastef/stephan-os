import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostSyncRefreshProjection, classifyPostSyncRefresh, executePostSyncRefreshPlan, parseGitChangedPathStatus,
  projectPostSyncRemainingIgnitionObligationsV1, projectThreeAppDesktopStartupAdmissionV1,
  THREE_APP_DESKTOP_STARTUP_SCOPE_V1, THREE_APP_DESKTOP_STARTUP_ADMISSION_SCHEMA_V1,
} from './postSyncRuntimeRefreshCoordinator.mjs';
import { collectPostSyncRefreshDebt, inspectPostSyncRefreshCompletion, resolvePostSyncRefreshDebt }
  from '../../scripts/battle-bridge-github-sync-policy.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const OPTIONAL = ['spatial-resident', 'desktop-plugin-host'];
const TARGETS = ['stephanos-ui-4173', 'vr-capability-atlas-browser-proof', 'stephanos-backend-8787',
  'mission-orchestrator-worker', 'github-command-mailbox', 'sovereign-commander', 'natural-reload'];
const PATHS = ['style.css', 'apps/vr-capability-atlas/index.html', 'stephanos-server/server.js',
  'scripts/mission-orchestrator-worker.mjs', 'scripts/battle-bridge-github-command-mailbox.mjs',
  'scripts/windows/run-vr-resource-governor.ps1', 'scripts/battle-bridge-sovereign-relay-daemon.mjs',
  'scripts/stephanos-native-capacity-publisher.mjs'];
const pass = () => ({ ok: true, exactHeadProofOk: true, sourceHead: B, blocker: '' });
const relay = () => ({ schemaVersion: 'stephanos.post-sync-sovereign-relay-proof.v1', watchdogSucceeded: true,
  healthy: true, sourceHead: B, sourceHeadMatchesLive: true, processCount: 1, heartbeatAgeSeconds: 2, blocker: '' });
const governor = () => ({ schemaVersion: 'stephanos.post-sync-governor-proof.v1', watchdogSucceeded: true,
  normalOperatorObserved: true, healthy: true, inventoryComplete: true, processCount: 1,
  identityVerified: true, progressVerified: true, currentSourceVerified: true,
  sourceHead: B, sourceHeadMatchesLive: true, sourceSha256: 'd'.repeat(64), blocker: '' });
const clone = value => structuredClone(value);
const admitted = value => projectThreeAppDesktopStartupAdmissionV1(value, B)?.admitted === true;

test('one exact attended shortcut adapter is source-only natural adoption and never dispatches retargeting', async () => {
  const entry = 'scripts/windows/retarget-stephanos-local-shortcut.ps1';
  const plan = classifyPostSyncRefresh([entry]);
  assert.deepEqual(plan.targetIds, ['natural-reload']);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.pluginHostActivationRequired, false);
  assert.equal(plan.spatialAdoptionRequired, false);
  let calls = 0;
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [entry],
    adapters: { confirmNaturalReload: async () => { calls++; return pass(); } } });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  // This optional manual installer is not a mandatory resident source entry.
  assert.equal(parseGitChangedPathStatus('D\t' + entry).ok, true);
  for (const sibling of [entry + '.extra', 'scripts/windows/retarget-stephanos-other-shortcut.ps1',
    'scripts/windows/retarget-stephanos-local-shortcut-v2.ps1']) {
    const held = classifyPostSyncRefresh([sibling]);
    assert.ok(held.unknownPathCount > 0);
    assert.equal(held.automaticExecutionAllowed, false);
    assert.deepEqual(held.targetIds, []);
  }
});

// Offline actual executor calls with all service effects intercepted. This
// proves source/model behaviour; these rows are not native or live acceptance.
async function actualTerminal({ spatial = true, plugin = true } = {}) {
  const calls = [];
  const adapters = Object.fromEntries(['refreshUi', 'proveVrAtlas', 'restartBackend', 'restartMissionWorker',
    'restartGitHubMailbox', 'confirmNaturalReload'].map(name => [name, async () => { calls.push(name); return pass(); }]));
  adapters.refreshSovereignCommander = async () => {
    calls.push('refreshSovereignCommander'); return { ...pass(), governorProof: governor(), sovereignRelayProof: relay() };
  };
  adapters.verifySovereignPluginHost = async () => { calls.push('verifySovereignPluginHost'); return null; };
  const execution = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [...PATHS,
    ...(spatial ? ['scripts/spatial-window-host.mjs'] : []),
    ...(plugin ? ['plugins/sovereign-commander/plugin.json'] : [])], adapters });
  assert.deepEqual(execution.plan.targetIds, TARGETS);
  assert.equal(execution.plan.unknownPathCount, 0);
  assert.equal(execution.plan.unsafePathCount, 0);
  const record = { ...buildPostSyncRefreshProjection(execution, { beforeHead: A, afterHead: B }),
    phase: execution.ok ? 'complete' : 'blocked', sourceHead: B, ok: execution.ok };
  return { record, execution, calls };
}

test('actual executor admits four fixed optional subsets while global and native truth stay separate', async () => {
  for (const spatial of [false, true]) for (const plugin of [false, true]) {
    const { record, calls } = await actualTerminal({ spatial, plugin });
    const before = JSON.stringify(record);
    const global = projectPostSyncRemainingIgnitionObligationsV1(record, B);
    const view = projectThreeAppDesktopStartupAdmissionV1(record, B);
    const expected = OPTIONAL.filter(id => id === 'spatial-resident' ? spatial : plugin);
    assert.equal(view.schemaVersion, THREE_APP_DESKTOP_STARTUP_ADMISSION_SCHEMA_V1);
    assert.equal(view.scope, THREE_APP_DESKTOP_STARTUP_SCOPE_V1);
    assert.equal(view.sourceHead, B);
    assert.equal(view.admitted, true);
    assert.deepEqual(view.globalRemaining, global.remaining);
    assert.deepEqual(view.optionalRemaining, expected);
    assert.deepEqual(view.mandatoryRemaining, []);
    assert.equal(view.globalRefreshState, expected.length ? 'HELD' : 'COMPLETE');
    assert.equal(view.nativeCommissioningState, expected.length ? 'HELD_UNPROVEN' : 'NO_RECORDED_OPTIONAL_OBLIGATION');
    assert.equal(inspectPostSyncRefreshCompletion(record).ok, !expected.length);
    assert.equal(record.ok, !expected.length);
    assert.equal(record.exactHeadProofOk, !expected.length);
    assert.equal(Object.hasOwn(view, 'ok'), false);
    assert.equal(Object.hasOwn(view, 'nativeAcceptance'), false);
    assert.ok(Object.isFrozen(view) && Object.isFrozen(view.globalRemaining)
      && Object.isFrozen(view.optionalRemaining) && Object.isFrozen(view.mandatoryRemaining));
    assert.equal(JSON.stringify(record), before);
    assert.equal(calls.includes('verifySovereignPluginHost'), plugin);
  }
});

test('all 128 target failure subsets across four optional subsets keep every managed target mandatory', async () => {
  for (const spatial of [false, true]) for (const plugin of [false, true]) {
    const { record } = await actualTerminal({ spatial, plugin });
    for (let mask = 0; mask < 1 << TARGETS.length; mask++) {
      const row = clone(record);
      row.resultTargets.forEach((result, index) => {
        if (mask & (1 << index)) Object.assign(result, { ok: false, exactHeadProofOk: false, blocker: 'TARGET_HELD' });
      });
      const view = projectThreeAppDesktopStartupAdmissionV1(row, B);
      assert.equal(view?.admitted === true, mask === 0, `${spatial}/${plugin}/${mask}`);
      for (let index = 0; index < TARGETS.length; index++) if (mask & (1 << index)) {
        assert.ok(projectPostSyncRemainingIgnitionObligationsV1(row, B).remaining.includes('target:' + TARGETS[index]));
        if (view) assert.ok(view.mandatoryRemaining.includes('target:' + TARGETS[index]));
      }
    }
  }
});

test('missing or invalid Governor and relay receipts cannot hide behind the native first blocker', async () => {
  const { record } = await actualTerminal();
  for (const field of ['governorProof', 'sovereignRelayProof']) for (const change of ['missing', 'stale', 'malformed']) {
    const row = clone(record), commander = row.resultTargets.find(result => result.targetId === 'sovereign-commander');
    if (change === 'missing') delete commander[field];
    if (change === 'stale') commander[field].sourceHead = C;
    if (change === 'malformed') commander[field].healthy = 'true';
    assert.equal(admitted(row), false, `${field}/${change}`);
  }
  const custody = clone(record);
  Object.assign(custody.resultTargets.find(row => row.targetId === 'sovereign-commander'),
    { ok: false, exactHeadProofOk: false, blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' });
  assert.equal(admitted(custody), false);
});

test('source approval unknown unsafe and future obligations stay mandatory or invalid', async () => {
  const { record } = await actualTerminal();
  for (const field of ['unknownPathCount', 'unsafePathCount', 'openClawPathCount']) {
    const row = { ...clone(record), [field]: 1 };
    const view = projectThreeAppDesktopStartupAdmissionV1(row, B);
    assert.equal(view.admitted, false, field);
    assert.ok(view.mandatoryRemaining.length);
  }
  for (const patch of [{ futureAdoptionRequired: false }, { futurePathCount: 0 }, { spatialAdoptionRequired: false },
    { beforeHead: B }, { afterHead: C }, { sourceHead: C }, { unsafePathCount: -1 }, { changedPathCount: NaN }]) {
    assert.equal(admitted({ ...clone(record), ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(projectThreeAppDesktopStartupAdmissionV1(record, C), null);
  assert.equal(projectThreeAppDesktopStartupAdmissionV1({ remaining: [] }, B), null);
});

test('only actual current complete or typed optional terminal branches can admit', async () => {
  const { record } = await actualTerminal();
  for (const patch of [{ phase: 'plan' }, { phase: 'checkpoint-7' }, { phase: 'complete' }, { phase: undefined },
    { safeRefreshesCompleted: false }, { safeRefreshesCompleted: 'true' }, { classification: 'REFRESH_READY' },
    { classification: 'BLOCKED_SPATIAL_ADOPTION_REQUIRED', blocker: 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN' },
    { blocker: 'POST_SYNC_REFRESH_RECEIPT_WRITE_FAILED' }, { publication: { ok: false } },
    { exactHeadProofOk: true }, { ok: true }, { finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS' }]) {
    assert.equal(admitted({ ...clone(record), ...patch }), false, JSON.stringify(patch));
  }
  const { record: complete } = await actualTerminal({ spatial: false, plugin: false });
  for (const patch of [{ phase: 'blocked', classification: 'BLOCKED_REFRESH_FAILED', blocker: 'UNEXPLAINED_FAILURE',
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED', exactHeadProofOk: false, ok: false },
    { phase: undefined }, { publication: { ok: false } }, { classification: 'REFRESH_READY' }]) {
    assert.equal(admitted({ ...clone(complete), ...patch }), false);
  }
  // Actual writer's failed publication has no complete producer envelope.
  assert.equal(admitted({ ok: false, blocker: 'POST_SYNC_REFRESH_STATUS_WRITE_FAILED', exactHeadProofOk: false,
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' }), false);
});

test('ordered exact target coverage rejects omissions duplicates substitutions and wrong heads', async () => {
  const { record } = await actualTerminal();
  for (const mutate of [row => row.resultTargets.pop(), row => row.resultTargets.push(clone(row.resultTargets[0])),
    row => row.resultTargets.reverse(), row => { row.resultTargets[0].targetId = 'unregistered-owner'; },
    row => { row.resultTargets[0].sourceHead = C; }, row => { row.resultTargets[0].sourceHead = ''; },
    row => { row.targetIds[1] = row.targetIds[0]; }, row => { row.resultTargets[0].exactHeadProofOk = false; }]) {
    const row = clone(record); mutate(row); assert.equal(admitted(row), false);
  }
});

test('root and nested proxies accessors cycles sparse arrays and hidden future flags never execute', async () => {
  const { record } = await actualTerminal();
  let traps = 0;
  const proxy = value => new Proxy(value, { get() { traps++; throw Error('get'); }, ownKeys() { traps++; throw Error('keys'); },
    getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
  const getter = clone(record);
  Object.defineProperty(getter, 'safeRefreshesCompleted', { get() { traps++; return true; } });
  const nested = clone(record); nested.resultTargets[0] = proxy(nested.resultTargets[0]);
  const sparse = clone(record); delete sparse.resultTargets[0];
  const cycle = clone(record); cycle.extra = cycle;
  const hidden = clone(record); Object.defineProperty(hidden, 'newNativeRequired', { value: false });
  for (const row of [proxy(record), getter, nested, sparse, cycle, hidden]) assert.equal(admitted(row), false);
  assert.equal(traps, 0);
  assert.throws(() => projectThreeAppDesktopStartupAdmissionV1(record, B).optionalRemaining.push('target:sovereign-commander'));
});

test('actual blocked producer debt remains byte-identical and globally unpaid after scoped startup admission', async () => {
  const { record, execution } = await actualTerminal();
  const owned = { ...record, schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.status', statusId: 'post-sync-runtime-refresh-current' };
  const bytes = JSON.stringify(owned), before = collectPostSyncRefreshDebt({ refreshRecord: owned });
  assert.equal(before.ok, true);
  const resolve = evidence => resolvePostSyncRefreshDebt({ ...evidence, currentHead: B,
    isAncestor: (beforeHead, afterHead) => ({ ok: true, ancestor: beforeHead <= afterHead }) });
  const unpaid = resolve(before);
  assert.equal(unpaid.ok, true);
  assert.ok(unpaid.debt);
  assert.equal(unpaid.debt.spatialAdoptionRequired, true);
  assert.equal(projectThreeAppDesktopStartupAdmissionV1(owned, B).admitted, true);
  assert.equal(inspectPostSyncRefreshCompletion(owned).ok, false);
  assert.equal(execution.ok, false);
  assert.equal(JSON.stringify(owned), bytes);
  const after = collectPostSyncRefreshDebt({ refreshRecord: owned });
  assert.deepEqual(after, before);
  assert.deepEqual(resolve(after), unpaid);
  assert.deepEqual(projectPostSyncRemainingIgnitionObligationsV1(owned, B).remaining, OPTIONAL);
});
