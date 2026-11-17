import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostSyncRefreshProjection, classifyPostSyncRefresh, executePostSyncRefreshPlan,
} from './postSyncRuntimeRefreshCoordinator.mjs';
import {
  collectPostSyncRefreshDebt, inspectPendingPostSyncRefreshDebt,
  inspectPostSyncRefreshCompletion, pendingPostSyncRefreshDebt, resolvePostSyncRefreshDebt,
} from '../../scripts/battle-bridge-github-sync-policy.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), D = 'd'.repeat(40);
const spatial = ['scripts/spatial-window-host.mjs', 'shared/vr/spatialDesktopSurfaceContractV1.mjs'];
const mailbox = 'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs';
const ancestor = (before, after) => ({ ok: true, ancestor: [A, B, C, D].indexOf(before) <= [A, B, C, D].indexOf(after) });
const pass = (sourceHead = B) => ({ ok: true, blocker: '', exactHeadProofOk: true, sourceHead });
function adapters(calls, overrides = {}) {
  return {
    restartGitHubMailbox: async () => { calls.push('mailbox'); return pass(); },
    confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
    // These traps document that the new path grants no Spatial lifecycle or
    // apparent absence/health verification capability to a caller adapter.
    refreshSpatial: async () => { throw new Error('Spatial must not be invoked'); },
    verifySpatialAbsence: async () => { throw new Error('Absence must not be inferred'); },
    ...overrides,
  };
}
function record(result, beforeHead = A, afterHead = B) {
  return {
    ...buildPostSyncRefreshProjection(result, { beforeHead, afterHead }),
    schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
    statusId: 'post-sync-runtime-refresh-current', phase: 'blocked',
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED',
  };
}
const syncRecord = pendingRefresh => ({
  schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
  statusId: 'battle-bridge-github-sync-current', classification: 'SYNC_NO_CHANGE', pendingRefresh,
});

test('only the two audited Spatial components become a separate held adoption obligation', () => {
  for (const path of spatial) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
    assert.equal(plan.spatialAdoptionRequired, true);
    assert.equal(plan.spatialAdoptionPathCount, 1);
    assert.equal(plan.unknownPathCount, 0);
    assert.equal(plan.noRuntimePathCount, 0);
    assert.deepEqual(plan.internal.spatialAdoptionPaths, [path]);
    assert.deepEqual(plan.targetIds, []);
  }
});

test('existing mailbox and natural-reload targets can finish while Spatial remains explicitly unproven', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...spatial, mailbox], adapters: adapters(calls) });
  assert.deepEqual(calls, ['mailbox', 'natural']);
  assert.deepEqual(result.results.map(row => row.targetId), ['github-command-mailbox', 'natural-reload']);
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
  assert.equal(result.blocker, 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN');
  assert.equal(result.exactHeadProofOk, false);
  assert.equal(result.safeRefreshesCompleted, true);
  const projected = record(result);
  assert.equal(projected.spatialAdoptionRequired, true);
  assert.equal(projected.spatialAdoptionPathCount, 2);
  assert.equal(projected.exactHeadProofOk, false);
  assert.equal(projected.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_BLOCKED');
  assert.equal(inspectPostSyncRefreshCompletion(projected).ok, false);
});

test('Spatial-only source and exact stored receipts cannot create a Spatial success', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: spatial, adapters: adapters(calls), completedResults: [
      { targetId: 'spatial-window', ...pass(), absent: true, residentVerified: true },
    ] });
  assert.deepEqual(calls, []);
  assert.deepEqual(result.results, []);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN');
});

test('stored disjoint target successes do not discharge the Spatial hold', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...spatial, mailbox], adapters: adapters(calls),
    completedResults: ['github-command-mailbox', 'natural-reload'].map(targetId => ({ targetId, ...pass() })),
  });
  assert.deepEqual(calls, []);
  assert.ok(result.results.every(row => row.resumed === true));
  assert.equal(result.ok, false);
  assert.equal(result.plan.spatialAdoptionRequired, true);
});

test('the original first-failure boundary still stops later refresh targets', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...spatial, mailbox], adapters: adapters(calls, {
      restartGitHubMailbox: async () => { calls.push('mailbox'); return { ...pass(), ok: false, blocker: 'FIXTURE_CUSTODY_HELD' }; },
    }) });
  assert.deepEqual(calls, ['mailbox']);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'FIXTURE_CUSTODY_HELD');
  assert.equal(result.plan.spatialAdoptionRequired, true);
  assert.equal(collectPostSyncRefreshDebt({ refreshRecord: record(result) }).spatialAdoptionRequired, true);
});

test('unknown siblings, versions, case variants and unsafe paths still stop every adapter', async () => {
  for (const path of [
    'scripts/spatial-window-host-v2.mjs', 'scripts/Spatial-window-host.mjs',
    'shared/vr/spatialDesktopSurfaceContractV2.mjs', 'shared/vr/other-resident.mjs',
    '../scripts/spatial-window-host.mjs',
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
      changedPaths: [...spatial, mailbox, path], adapters: adapters(calls) });
    assert.equal(result.ok, false, path);
    assert.equal(result.plan.automaticExecutionAllowed, false, path);
    assert.deepEqual(calls, [], path);
    assert.equal(result.plan.spatialAdoptionRequired, true, path);
  }
});

test('OpenClaw approval remains a separate hold while Spatial debt is retained', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...spatial, mailbox, 'integrations/openclaw/stephanos-ignite-command/index.mjs'],
    adapters: adapters(calls) });
  assert.deepEqual(calls, ['mailbox', 'natural']);
  assert.equal(result.classification, 'APPROVAL_REQUIRED_OPENCLAW');
  assert.equal(result.plan.openClawApprovalRequired, true);
  assert.equal(result.plan.spatialAdoptionRequired, true);
  assert.equal(collectPostSyncRefreshDebt({ refreshRecord: record(result) }).spatialAdoptionRequired, true);
});

test('Spatial debt survives serialization, accumulated spans and a revert removing both net-diff paths', async () => {
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: [...spatial, mailbox], adapters: adapters([]) });
  const collected = collectPostSyncRefreshDebt({ refreshRecord: record(result) });
  assert.equal(collected.ok, true);
  const serialized = JSON.parse(JSON.stringify(pendingPostSyncRefreshDebt(
    collected.spans, collected.requiredTargetIds, '', collected)));
  const recovered = inspectPendingPostSyncRefreshDebt(serialized);
  assert.equal(recovered.spatialAdoptionRequired, true);
  const reconciled = collectPostSyncRefreshDebt({ syncRecord: syncRecord(serialized) });
  const resolved = resolvePostSyncRefreshDebt({ ...reconciled,
    requestedSpans: [{ beforeHead: B, afterHead: C }, { beforeHead: C, afterHead: D }],
    currentHead: D, isAncestor: ancestor });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.discharged, false);
  assert.equal(resolved.debt.beforeHead, A);
  assert.equal(resolved.debt.afterHead, D);
  assert.equal(resolved.debt.spatialAdoptionRequired, true);
  const current = classifyPostSyncRefresh([mailbox], resolved.debt);
  assert.equal(current.spatialAdoptionPathCount, 0);
  assert.equal(current.spatialAdoptionRequired, true);
  assert.equal(current.classification, 'BLOCKED_SPATIAL_ADOPTION_REQUIRED');
  const final = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: D,
    changedPaths: [], spatialAdoptionRequired: resolved.debt.spatialAdoptionRequired });
  assert.equal(final.ok, false);
  assert.equal(final.blocker, 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN');
});

test('a valid generic target completion cannot retire independently retained Spatial debt', () => {
  const generic = { beforeHead: A, afterHead: C, phase: 'complete',
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS', exactHeadProofOk: true, blocker: '',
    targetIds: ['github-command-mailbox'], resultTargets: [{ targetId: 'github-command-mailbox', ...pass(C) }],
    classification: 'REFRESH_COMPLETE', changedPathCount: 1, noRuntimePathCount: 0,
    unknownPathCount: 0, unsafePathCount: 0, openClawPathCount: 0,
    pluginHostActivationRequired: false, sovereignRelayRefreshRequired: false,
    spatialAdoptionRequired: false, spatialAdoptionPathCount: 0 };
  const completion = inspectPostSyncRefreshCompletion(generic);
  assert.equal(completion.ok, true);
  const resolved = resolvePostSyncRefreshDebt({ spans: [{ beforeHead: A, afterHead: B }],
    requiredTargetIds: ['github-command-mailbox'], spatialAdoptionRequired: true,
    sovereignRelayRefreshRequired: false, completion, currentHead: C, isAncestor: ancestor });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.discharged, false);
  assert.equal(resolved.debt.beforeHead, A);
  assert.equal(resolved.debt.afterHead, C);
  assert.equal(resolved.debt.spatialAdoptionRequired, true);
  for (const forged of [
    { spatialAdoptionRequired: true }, { spatialAdoptionRequired: 'false' },
    { spatialAdoptionRequired: null }, { spatialAdoptionPathCount: 2 },
    { spatialAdoptionPathCount: '0' }, { spatialAdoptionPathCount: null },
  ]) assert.equal(inspectPostSyncRefreshCompletion({ ...generic, ...forged }).ok, false);
});

test('missing or malformed Spatial evidence cannot become a positive held-record admission', async () => {
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: spatial });
  const valid = record(result);
  for (const value of [null, 'true', 1, {}, []]) {
    assert.equal(collectPostSyncRefreshDebt({ refreshRecord: { ...valid, spatialAdoptionRequired: value } }).ok, false);
    assert.equal(inspectPendingPostSyncRefreshDebt({ ...pendingPostSyncRefreshDebt([{ beforeHead: A, afterHead: B }]),
      spatialAdoptionRequired: value }).ok, false);
  }
  const missing = { ...valid }; delete missing.spatialAdoptionRequired;
  assert.equal(collectPostSyncRefreshDebt({ refreshRecord: missing }).ok, false);
  assert.equal(collectPostSyncRefreshDebt({ refreshRecord: { ...valid, spatialAdoptionRequired: false } }).ok, false);
  assert.equal(pendingPostSyncRefreshDebt([], [], '', { spatialAdoptionRequired: true }).state, 'HELD');
});
