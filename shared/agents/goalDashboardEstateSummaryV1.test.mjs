import { projectGoalBuildConveyorOverviewV1 as project } from './goalBuildConveyorOverviewV1.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGoalDashboardEstateSummary } from './goalDashboardEstateSummaryV1.mjs';

const NOW = Date.parse('2026-09-22T06:30:00.000Z');

function goals(count, status = 'ACTIVE') {
  return Array.from({ length: count }, (_, index) => ({
    goalId: `goal-${1200 + index}`,
    title: `Durable goal ${index + 1}`,
    status,
    timestampUtc: '2026-09-22T06:29:00.000Z',
  }));
}

test('the complete 86-goal estate is preserved without portfolio truncation', () => {
  const goalRecords = goals(86);
  const proofRecords = goalRecords.map((goal) => ({
    goalId: goal.goalId,
    status: 'PASS',
    timestampUtc: '2026-09-22T06:29:30.000Z',
  }));
  const summary = buildGoalDashboardEstateSummary({ goalRecords, proofRecords, nowMs: NOW });

  assert.equal(summary.totalOpenGoals, 86);
  assert.equal(summary.goals.length, 86);
  assert.equal(summary.stateCounts.active, 86);
  assert.equal(summary.proofCounts.current, 86);
  assert.equal(summary.goals[0].goalId, '#1200');
  assert.equal(summary.goals.at(-1).goalId, '#1285');
});

test('latest terminal state removes a goal while old active history cannot resurrect it', () => {
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    goalRecords: [
      { goalId: 'goal-1219', title: 'Old active state', status: 'ACTIVE', timestampUtc: '2026-09-22T06:00:00Z' },
      { goalId: 'goal-1219', title: 'Closed state', status: 'COMPLETED', timestampUtc: '2026-09-22T06:20:00Z' },
      { goalId: 'goal-1622', title: 'Still active', status: 'ACTIVE', timestampUtc: '2026-09-22T06:25:00Z' },
    ],
  });

  assert.equal(summary.totalOpenGoals, 1);
  assert.deepEqual(summary.goals.map((goal) => goal.goalId), ['#1622']);
});

test('estate state buckets remain explicit rather than collapsing into one green status', () => {
  const states = [
    ['goal-1', 'ELIGIBLE'],
    ['goal-2', 'BUILDING'],
    ['goal-3', 'PARKED_EXACT_BLOCKER'],
    ['goal-4', 'WAITING_DEPENDENCY'],
    ['goal-5', 'OPERATOR_READY_PARKED'],
    ['goal-6', 'SOMETHING_NEW'],
  ];
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    goalRecords: states.map(([goalId, status]) => ({ goalId, title: goalId, status, timestampUtc: '2026-09-22T06:29:00Z' })),
  });

  assert.deepEqual(summary.stateCounts, {
    eligible: 1,
    active: 1,
    parked: 1,
    waitingDependency: 1,
    operatorReady: 1,
    unknown: 1,
  });
  assert.equal(summary.proofCounts.unknown, 6);
});

test('proof freshness is tracked independently from open-goal state', () => {
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    staleAfterMs: 60_000,
    goalRecords: [
      { goalId: 'goal-10', title: 'Fresh proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
      { goalId: 'goal-11', title: 'Stale proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
      { goalId: 'goal-12', title: 'No proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
    ],
    proofRecords: [
      { goalId: 'goal-10', timestampUtc: '2026-09-22T06:29:30Z' },
      { goalId: 'goal-11', timestampUtc: '2026-09-22T06:00:00Z' },
    ],
  });

  assert.deepEqual(summary.proofCounts, { current: 1, stale: 1, unknown: 1 });
});

// The overview consumes this same estate and preserves its truth boundaries.
{
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

}
