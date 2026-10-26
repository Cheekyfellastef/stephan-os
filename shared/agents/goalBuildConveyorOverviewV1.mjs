// Display adapter over canonical projections. No scheduler, receipt writer or authority.
export const CONVEYOR_OVERVIEW_SCHEMA = 'stephanos.goal-build-conveyor-overview.v1';
const MAX_AGE = 10 * 60_000;
const array = value => Array.isArray(value) ? value : [];
const time = value => Date.parse(String(value || ''));
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const fresh = (value, now, age) => Number.isFinite(time(value)) && time(value) <= now
  && now - time(value) <= age;

// Gate 20 is intentionally shared: the publisher proves diff + tests together.
// No existing distinct commit receipt exists in this projection. A PR, source SHA,
// terminal execution or merge must never be substituted for a builder commit.
const FLOW = [
  ['admission', 'Admission', [4, 5, 7]], ['select', 'Select', [6]],
  ['claim', 'Claim', [18]], ['pickup', 'Physical pickup', [19]],
  ['edit', 'Edit', [20]], ['test', 'Test', [20]],
  ['commit', 'Commit', []], ['proof', 'Proof / review', [21]],
  ['merge', 'Protected merge', [22]],
];

export function projectGoalBuildConveyorOverviewV1(projection = {}, { nowMs = Date.now(), staleAfterMs = MAX_AGE } = {}) {
  const maxAgeMs = Math.max(1000, Math.min(MAX_AGE, Number(staleAfterMs) || MAX_AGE));
  const ledger = projection.goalBuildGateObservatory;
  const admittedLedger = ledger?.schemaVersion === 'stephanos.goal-build-gate-observatory.v1'
    && ledger.diagnosticOnly === true && ledger.approvalAuthority === false && ledger.mergeAuthority === false
    && /^[a-f0-9]{40}$/.test(ledger.sourceHead || '')
    && ['EVIDENCE_AVAILABLE', 'STALE'].includes(ledger.observationStatus);
  const ledgerLive = admittedLedger && ledger.observationStatus === 'EVIDENCE_AVAILABLE'
    && fresh(ledger.observedAtUtc, nowMs, maxAgeMs);
  // Keep the existing logical handoff trace visible, but never elevate its
  // structural WORKER/CLAIM flags into signed physical execution proof.
  const track = projection.autonomyBuildTrack;
  const trackKnown = track?.schemaVersion === 'stephanos.autonomy-build-track.v1'
    && /^[a-f0-9]{40}$/.test(track.sourceHead || '') && track.missionId
    && Number.isInteger(track.issueNumber) && track.issueNumber > 0;
  const trackLive = trackKnown && fresh(track.timestampUtc, nowMs, maxAgeMs)
    && (!admittedLedger || ledger.sourceHead === track.sourceHead);
  const trackGoal = trackKnown ? array(projection.goals).find(goal => goal.issue === '#'+track.issueNumber) : null;
  const trace = trackKnown ? { truth: trackLive ? 'CURRENT' : 'STALE',
    issue: '#'+track.issueNumber, title: trackGoal?.title || 'title unavailable from current evidence',
    owner: trackGoal?.controllerTitle || '', missionId: track.missionId, sourceHead: track.sourceHead,
    observedAtUtc: track.timestampUtc, expiresAtUtc: trackLive ? new Date(time(track.timestampUtc)+maxAgeMs).toISOString() : '',
    currentGate: track.currentGate, currentState: track.currentState, diagnosis: track.diagnosis,
    nextAction: track.exactNextAction } : null;
  const traceGateByStage = { admission: 'ELIGIBLE_GOAL', select: 'SELECT', claim: 'CLAIM',
    pickup: 'WORKER', edit: 'SOURCE_CHANGED', test: 'TESTED', proof: 'REVIEW_HANDOFF' };
  const gates = admittedLedger ? array(ledger.gates) : [];
  const gateLive = gate => ledgerLive && fresh(gate?.observedAtUtc, nowMs, maxAgeMs)
    && Boolean(gate?.proofRef);
  const stages = FLOW.map(([id, label, gateIds]) => {
    const observations = gateIds.map(number => gates.find(gate => gate.id === number));
    const failure = observations.find(gate => gateLive(gate) && gate.status === 'FAIL');
    const passed = observations.length > 0 && observations.every(gate => gateLive(gate) && gate.status === 'PASS');
    const stale = observations.some(gate => gate && (gate.status === 'STALE' || !gateLive(gate)) && gate.proofRef);
    const waiting = ledgerLive && observations.some(gate => gate?.status === 'WAITING_FOR_PREREQUISITE');
    const state = failure ? 'BLOCKED' : passed ? 'PROVEN' : stale ? 'STALE' : waiting ? 'WAITING' : 'UNKNOWN';
    const traceGate = trackLive ? array(track.gates).find(gate => gate.id === traceGateByStage[id]) : null;
    return { id, label, state, trafficLight: failure ? 'RED' : passed ? 'GREEN' : stale || waiting ? 'AMBER' : 'GREY',
      traceState: traceGate?.state || '', traceReason: traceGate?.reason || '',
      gateIds, expiresAtUtc: passed || failure ? new Date(Math.min(time(ledger.observedAtUtc),
        ...observations.filter(gateLive).map(gate => time(gate.observedAtUtc))) + maxAgeMs).toISOString() : '',
      proofRefs: observations.flatMap(gate => gate?.proofRef ? [gate.proofRef] : []),
      reason: failure?.typedBlocker || (id === 'commit' ? 'No distinct commit receipt is published by the current feed.'
        : id === 'edit' || id === 'test' ? 'Gate 20 proves source diff and tests together.'
          : passed ? 'Current signed checkpoint proof.' : 'Awaiting current signed checkpoint proof.') };
  });
  const build = projection.stephanosBuildTruth;
  const buildKnown = build?.schemaVersion === 'stephanos.sovereign-build-truth.v1';
  const buildLive = buildKnown && build.truth === 'CURRENT'
    && ['BUILDING', 'BLOCKED', 'HELD', 'QUEUED', 'IDLE_GREEN'].includes(build.state)
    && fresh(build.observedAtUtc, nowMs, maxAgeMs);
  const buildingGoals = buildLive ? array(build.goals).filter(goal => goal.state === 'BUILDING'
    && goal.builder && array(goal.proofRefs).length && fresh(goal.lastMaterialProgressAtUtc, nowMs, maxAgeMs)) : [];
  const workers = [...new Map(buildingGoals.map(goal => [goal.builder, {
    id: goal.builder, goals: buildingGoals.filter(other => other.builder === goal.builder)
      .map(other => ({ issue: other.issue, title: other.title })),
  }])).values()];
  const controllers = array(projection.controllerFleet?.controllers).map(controller => ({
    id: controller.controllerId, title: controller.title || controller.controllerId,
    state: controller.activityState || 'UNKNOWN',
    truth: controller.freshness === 'CURRENT' && fresh(controller.timestampUtc, nowMs, maxAgeMs)
      ? 'CURRENT' : controller.freshness === 'UNKNOWN' ? 'UNKNOWN' : 'STALE',
    trafficLight: controller.trafficLight || 'GREY',
    expiresAtUtc: fresh(controller.timestampUtc, nowMs, maxAgeMs)
      ? new Date(time(controller.timestampUtc) + maxAgeMs).toISOString() : '',
  }));
  const estate = projection.goalEstate;
  const estateKnown = estate?.schemaVersion === 'stephanos.goal-dashboard-estate-summary.v1';
  const queueCounts = estateKnown ? {
    open: count(estate.totalOpenGoals), eligible: count(estate.stateCounts?.eligible),
    active: count(estate.stateCounts?.active), held: count(estate.stateCounts?.parked),
    dependency: count(estate.stateCounts?.waitingDependency), approval: count(estate.stateCounts?.operatorReady),
    unknown: count(estate.stateCounts?.unknown),
  } : { open: null, eligible: null, active: null, held: null, dependency: null, approval: null, unknown: null };
  // These are the latest durable goal classifications, not an instantaneous
  // worker queue. Count stale records explicitly rather than claiming freshness
  // because a different goal (or the HTTP response) was updated recently.
  const uncertainGoalCount = estateKnown ? array(estate.goals).filter(goal => goal.statusTruth !== 'CURRENT'
    || !fresh(goal.observedAtUtc, nowMs, maxAgeMs)).length : null;
  const veto = gates.find(gate => gateLive(gate) && gate.status === 'FAIL');
  const buildBlocker = buildLive ? array(build.blockers)[0] : '';
  const bottleneck = veto ? { title: veto.title, reason: veto.typedBlocker, owner: veto.owner,
    gateId: veto.id, proofRef: veto.proofRef,
    expiresAtUtc: new Date(Math.min(time(veto.observedAtUtc), time(ledger.observedAtUtc)) + maxAgeMs).toISOString() } : buildBlocker ? {
    title: 'Build flow held', reason: buildBlocker, owner: 'Existing canonical build owner', gateId: null, proofRef: '',
  } : null;
  const activity = [
    ...(buildKnown ? [{ atUtc: build.lastMaterialProgressAtUtc, source: 'Sovereign build truth' }] : []),
    ...array(projection.controllerFleet?.controllers).filter(controller => array(controller.proofRefs).length)
      .map(controller => ({ atUtc: controller.lastMaterialActionAtUtc, source: controller.title || controller.controllerId })),
  ].filter(item => Number.isFinite(time(item.atUtc)) && time(item.atUtc) <= nowMs)
    .sort((a, b) => time(b.atUtc) - time(a.atUtc))[0] || null;
  const buildState = !buildLive ? buildKnown && build.observedAtUtc ? 'STALE' : 'UNKNOWN'
    : build.state === 'BLOCKED' ? 'BLOCKED' : buildingGoals.length ? 'BUILDING' : ['IDLE_GREEN', 'HELD', 'QUEUED'].includes(build.state)
      ? build.state === 'IDLE_GREEN' ? 'IDLE' : build.state : 'UNKNOWN';
  const state = bottleneck ? 'BLOCKED' : buildState;
  return {
    schemaVersion: CONVEYOR_OVERVIEW_SCHEMA, readOnly: true, state, buildState,
    trafficLight: state === 'BLOCKED' ? 'RED' : state === 'BUILDING' ? 'GREEN'
      : ['HELD', 'QUEUED', 'STALE'].includes(state) ? 'AMBER' : 'GREY',
    generatedAtUtc: new Date(nowMs).toISOString(), maxAgeMs,
    buildExpiresAtUtc: buildLive ? new Date(Math.min(time(build.observedAtUtc),
      ...buildingGoals.map(goal => time(goal.lastMaterialProgressAtUtc))) + maxAgeMs).toISOString() : '',
    buildObservedAtUtc: buildKnown ? build.observedAtUtc || '' : '', buildLive,
    ledgerObservedAtUtc: admittedLedger ? ledger.observedAtUtc : '', ledgerLive,
    sourceHead: admittedLedger ? ledger.sourceHead : '', trace, stages, queueCounts, uncertainGoalCount,
    workers, buildingGoalCount: buildLive ? buildingGoals.length : null, controllers,
    materialLanes: buildLive ? count(build.activeMaterialLaneCount) : null,
    targetMaterialLanes: buildLive ? count(build.targetMaterialLaneCount) : null,
    bottleneck, lastActivity: activity,
    lastReportedBlocker: buildKnown ? String(array(build.blockers)[0] || '') : '',
    nextAction: veto ? ledger.exactNextAction : buildLive ? build.nextAction : 'Refresh canonical build evidence.',
    truthBoundary: 'Traffic lights show independent signed system checkpoints, not one goal’s completed journey. Trace annotations describe only the named canonical mission and cannot prove physical pickup. Queue counts are durable goal classifications. Controllers and capacity slots are not builders. Commit requires its own receipt. Seed Canopy and Rescue Island retain separate ownership.',
  };
}
