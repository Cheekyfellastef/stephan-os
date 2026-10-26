import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoalBuildConveyorOverviewV1 as project } from './goalBuildConveyorOverviewV1.mjs';
const NOW = Date.parse('2026-10-26T15:00:00Z');
const at = offset => new Date(NOW + offset).toISOString();
const options = { nowMs: NOW };
function input() {
  return {
    goalBuildGateObservatory: { schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
      diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
      sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000), observationStatus: 'EVIDENCE_AVAILABLE',
      gates: [4, 5, 6, 7, 18, 19, 20, 21, 22].map(id => ({ id, title: 'Checkpoint '+id,
        owner: 'Existing owner', status: 'PASS', observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-'+id })),
      exactNextAction: 'Continue through the existing owner.' },
    stephanosBuildTruth: { schemaVersion: 'stephanos.sovereign-build-truth.v1', truth: 'CURRENT',
      observedAtUtc: at(-1000), state: 'BUILDING', activeMaterialLaneCount: 2, targetMaterialLaneCount: 15,
      lastMaterialProgressAtUtc: at(-3000), blockers: [], nextAction: 'Continue bounded build.',
      goals: [1, 2].map(n => ({ issue: '#'+n, title: 'Goal '+n, state: 'BUILDING', builder: 'worker-one',
        lastMaterialProgressAtUtc: at(-3000), proofRefs: ['proof/material-'+n] })) },
    goalEstate: { schemaVersion: 'stephanos.goal-dashboard-estate-summary.v1', totalOpenGoals: 9,
      stateCounts: { eligible: 3, active: 2, parked: 2, waitingDependency: 1, operatorReady: 1 },
      goals: [{ statusTruth: 'CURRENT', observedAtUtc: at(-1000) }, { statusTruth: 'STALE', observedAtUtc: at(-900000) }] },
    controllerFleet: { controllers: [{ controllerId: 'controller-one', title: 'Controller one', freshness: 'CURRENT',
      activityState: 'BUILDING', timestampUtc: at(-1000), lastMaterialActionAtUtc: at(-3000), proofRefs: ['proof/material'] }] },
  };
}
test('reuses signed gates, keeps commit unknown, distinguishes workers, goals and slots', () => {
  const original = input(), snapshot = structuredClone(original), result = project(original, options);
  assert.equal(result.state, 'BUILDING');
  assert.equal(result.workers.length, 1);
  assert.equal(result.buildingGoalCount, 2);
  assert.equal(result.materialLanes, 2);
  assert.equal(result.targetMaterialLanes, 15);
  assert.equal(result.stages.find(s => s.id === 'commit').state, 'UNKNOWN');
  assert.equal(result.stages.find(s => s.id === 'pickup').state, 'PROVEN');
  assert.equal(result.stages.find(s => s.id === 'edit').proofRefs[0], result.stages.find(s => s.id === 'test').proofRefs[0]);
  assert.equal(result.queueCounts.open, 9);
  assert.equal(result.uncertainGoalCount, 1);
  assert.equal(result.lastActivity.atUtc, at(-3000));
  assert.deepEqual(original, snapshot);
});
test('empty input has unknown counts and no invented zero workers or green stages', () => {
  const result = project({}, options);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.buildingGoalCount, null);
  assert.equal(result.queueCounts.open, null);
  assert.equal(result.lastActivity, null);
  assert.ok(result.stages.every(s => s.state === 'UNKNOWN'));
});
test('fresh HTTP/build observation cannot renew expired material proof or signed gate', () => {
  const data = input();
  data.stephanosBuildTruth.goals.forEach(g => g.lastMaterialProgressAtUtc = at(-600001));
  data.goalBuildGateObservatory.gates.find(g => g.id === 19).observedAtUtc = at(-600001);
  const result = project(data, options);
  assert.equal(result.workers.length, 0);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.stages.find(s => s.id === 'pickup').state, 'STALE');
});
test('expired and future build sources never report live building', () => {
  for (const offset of [-600001, 1]) {
    const data = input();data.stephanosBuildTruth.observedAtUtc = at(offset);
    const result = project(data, options);
    assert.equal(result.buildLive, false);
    assert.equal(result.buildingGoalCount, null);
    assert.equal(result.workers.length, 0);
  }
});
test('unsigned, stale, future or authority-bearing checkpoint objects cannot green physical pickup', () => {
  for (const change of [ledger => ledger.schemaVersion = 'raw-observation', ledger => ledger.observationStatus = 'UNVERIFIED',
    ledger => ledger.observedAtUtc = at(1), ledger => ledger.observedAtUtc = at(-600001),
    ledger => ledger.approvalAuthority = true, ledger => ledger.sourceHead = '']) {
    const data = input();change(data.goalBuildGateObservatory);
    const result = project(data, options);
    assert.notEqual(result.stages.find(s => s.id === 'pickup').state, 'PROVEN');
  }
});
test('selection, running controllers and forged summary counts never prove a material builder', () => {
  const data = input();data.stephanosBuildTruth.goals = [{ state: 'QUEUED', builder: 'claimed-worker' },
    { state: 'BUILDING', builder: 'no-proof', lastMaterialProgressAtUtc: at(-1) }];
  data.stephanosBuildTruth.buildingGoalCount = 15;
  const result = project(data, options);
  assert.equal(result.workers.length, 0);assert.equal(result.buildingGoalCount, 0);
});
test('first real veto retains owner and proof even outside the nine display stages; stale veto clears', () => {
  const data = input();
  data.goalBuildGateObservatory.gates.unshift({ id: 8, title: 'Source custody', status: 'FAIL',
    owner: 'Original lease owner', typedBlocker: 'CUSTODY_UNPROVEN', observedAtUtc: at(-2000), proofRef: 'workspace:proof/custody' });
  let result = project(data, options);
  assert.equal(result.state, 'BLOCKED');assert.equal(result.bottleneck.owner, 'Original lease owner');
  assert.equal(result.bottleneck.proofRef, 'workspace:proof/custody');
  data.goalBuildGateObservatory.gates[0].observedAtUtc = at(-600001);
  result = project(data, options);assert.equal(result.bottleneck, null);
});
test('zero is a known empty estate and future heartbeat is never last material movement', () => {
  const data = input();data.goalEstate.totalOpenGoals = 0;
  data.controllerFleet.controllers[0].lastMaterialActionAtUtc = at(1000);
  data.stephanosBuildTruth.lastMaterialProgressAtUtc = '';
  const result = project(data, options);assert.equal(result.queueCounts.open, 0);assert.equal(result.lastActivity, null);
});
test('fresh wrapper does not make an upstream STALE build state live', () => {
  const data = input();data.stephanosBuildTruth.state = 'STALE';
  data.stephanosBuildTruth.blockers = ['SOURCE_CUSTODY_UNPROVEN'];
  const result = project(data, options);
  assert.equal(result.state, 'STALE');assert.equal(result.buildLive, false);
  assert.equal(result.buildingGoalCount, null);assert.equal(result.bottleneck, null);
  assert.equal(result.lastReportedBlocker, 'SOURCE_CUSTODY_UNPROVEN');
});
test('canonical mission trace remains visible without being promoted to physical pickup proof', () => {
  const data = input();delete data.goalBuildGateObservatory;
  data.goals = [{ issue: '#42', title: 'Exact canonical goal title', controllerTitle: 'Existing controller' }];
  data.autonomyBuildTrack = { schemaVersion: 'stephanos.autonomy-build-track.v1', sourceHead: 'b'.repeat(40),
    issueNumber: 42, missionId: 'mission-42', timestampUtc: at(-1000), currentGate: 'CLAIM', currentState: 'WAITING',
    gates: [{ id: 'SELECT', state: 'PASS' }, { id: 'CLAIM', state: 'WAITING' }, { id: 'WORKER', state: 'PASS' }] };
  const result = project(data, options);
  assert.equal(result.trace.title, 'Exact canonical goal title');
  assert.equal(result.trace.truth, 'CURRENT');
  assert.equal(result.stages.find(s => s.id === 'select').traceState, 'PASS');
  assert.equal(result.stages.find(s => s.id === 'pickup').traceState, 'PASS');
  assert.equal(result.stages.find(s => s.id === 'pickup').state, 'UNKNOWN');
  assert.equal(result.stages.find(s => s.id === 'merge').state, 'UNKNOWN');
  for (const timestampUtc of [at(-600001), at(1)]) {
    data.autonomyBuildTrack.timestampUtc=timestampUtc;
    assert.equal(project(data, options).stages.find(s => s.id === 'select').traceState, '');
  }
});
test('a trace with a different source head cannot annotate the signed ledger', () => {
  const data = input();data.autonomyBuildTrack = { schemaVersion: 'stephanos.autonomy-build-track.v1',
    sourceHead: 'b'.repeat(40), issueNumber: 42, missionId: 'mission-42', timestampUtc: at(-1),
    gates: [{ id: 'SELECT', state: 'PASS' }] };
  const result = project(data, options);
  assert.equal(result.trace.truth, 'STALE');assert.equal(result.stages.find(s => s.id === 'select').traceState, '');
});
