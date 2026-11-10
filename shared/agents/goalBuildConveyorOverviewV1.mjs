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

export function projectGoalBuildConveyorOverviewV1(projection = {}, { nowMs = Date.now(), staleAfterMs = MAX_AGE, statusRecords } = {}) {
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
  // A projected wrapper is refreshed by each HTTP read. In the backend only the
  // original publisher record may establish observation time (including absence).
  const latestStatus = id => array(statusRecords).filter(record => record.statusId === id)
    .sort((a, b) => time(b.timestampUtc) - time(a.timestampUtc))[0];
  const heartbeat = latestStatus('autonomy-build-track-current');
  const track = statusRecords ? heartbeat?.autonomyTrack : projection.autonomyBuildTrack;
  const originalTimes = [time(heartbeat?.timestampUtc), time(track?.timestampUtc)];
  const trackAt = statusRecords ? originalTimes.every(value => Number.isFinite(value) && value <= nowMs)
    ? new Date(Math.min(...originalTimes)).toISOString() : '' : track?.timestampUtc;
  const missionBound = Boolean(track?.missionId) && Number.isInteger(track?.issueNumber) && track.issueNumber > 0;
  const systemScoped = !track?.missionId && (track?.issueNumber === null || track?.issueNumber === undefined);
  const trackKnown = track?.schemaVersion === 'stephanos.autonomy-build-track.v1'
    && (/^[a-f0-9]{40}$/.test(track.sourceHead || '') || (statusRecords && !track.sourceHead))
    && (missionBound || systemScoped);
  const trackLive = trackKnown && fresh(trackAt, nowMs, maxAgeMs)
    && (!admittedLedger || systemScoped || ledger.sourceHead === track.sourceHead);
  const trackGoal = trackKnown ? array(projection.goals).find(goal => goal.issue === '#'+track.issueNumber) : null;
  const trace = trackKnown ? { truth: trackLive ? 'CURRENT' : 'STALE',
    scope: missionBound ? 'MISSION' : 'SYSTEM', cycleId: track.cycleId || '',
    sourceBinding: track.sourceHead ? 'SOURCE_BOUND' : 'SOURCE_HEAD_MISSING',
    readyWorkCount: count(track.cycleDecision?.safeEligibleWorkRemaining),
    materialActionsSucceeded: count(track.materialActionsSucceeded),
    issue: missionBound ? '#'+track.issueNumber : '', title: missionBound ? trackGoal?.title || 'title unavailable from current evidence' : 'No goal selected',
    owner: trackGoal?.controllerTitle || '', missionId: track.missionId, sourceHead: track.sourceHead,
    observedAtUtc: trackAt || '', expiresAtUtc: trackLive ? new Date(time(trackAt)+maxAgeMs).toISOString() : '',
    currentGate: track.currentGate, currentState: track.currentState, diagnosis: track.diagnosis,
    nextAction: track.exactNextAction } : null;
  const traceGateByStage = { admission: 'ELIGIBLE_GOAL', select: 'SELECT', claim: 'CLAIM',
    pickup: 'WORKER', edit: 'SOURCE_CHANGED', test: 'TESTED', proof: 'REVIEW_HANDOFF' };
  const gates = admittedLedger ? array(ledger.gates) : [];
  const gateLive = gate => ledgerLive && fresh(gate?.observedAtUtc, nowMs, maxAgeMs)
    && Boolean(gate?.proofRef);
  // Source-only BUILDING reports cannot certify a physical pickup.
  // This read-only adapter consumes only the upstream qualified signed gate.
  // A signed gate-19 status does not, by itself, establish a causally valid
  // pickup. Its signed prerequisite (gate 18) must be current and PASS, and
  // no current veto may contradict the admission. A diagnostic gate remains
  // different from a worker-scoped STARTED receipt.
  const currentVeto = gates.some(gate => gateLive(gate) && gate.status === 'FAIL');
  // A signed pickup cannot be operationally GREEN before its admission,
  // SELECT and CLAIM predecessors have their own distinct current proof.
  // A gate-19 diagnostic is still not a worker-scoped STARTED receipt.
  const pickupPrerequisites = [4, 5, 7, 6, 18, 19];
  // A shared proofRef does not independently prove multiple prerequisite gates.
  // This diagnostic is never a worker-scoped authenticated STARTED receipt.
  const pickupProofRefs = pickupPrerequisites.map(id => {
    const matching = gates.filter(gate => gate?.id === id);
    return matching.length === 1 && typeof matching[0].proofRef === 'string'
      ? matching[0].proofRef.trim() : '';
  });
  const distinctPickupProofRefs = pickupProofRefs.every(Boolean)
    && new Set(pickupProofRefs).size === pickupPrerequisites.length;
  const signedPickup = ledgerLive && !currentVeto && distinctPickupProofRefs
    && pickupPrerequisites.every(id => {
      const matching = gates.filter(gate => gate?.id === id);
      return matching.length === 1 && matching[0].status === 'PASS'
        && gateLive(matching[0]);
    }) ? gates.find(gate => gate?.id === 19) : null;
  const signedPickupRef = signedPickup?.proofRef || '';
  const stages = FLOW.map(([id, label, gateIds]) => {
    const observations = gateIds.map(number => gates.find(gate => gate.id === number));
    const failure = observations.find(gate => gateLive(gate) && gate.status === 'FAIL');
    const passed = observations.length > 0
      && observations.every(gate => gateLive(gate) && gate.status === 'PASS')
      && (id !== 'pickup' || Boolean(signedPickup));
    const stale = observations.some(gate => gate && (gate.status === 'STALE' || !gateLive(gate)) && gate.proofRef);
    const waiting = ledgerLive && observations.some(gate => gate?.status === 'WAITING_FOR_PREREQUISITE');
    const state = failure ? 'BLOCKED' : passed ? 'PROVEN' : stale ? 'STALE' : waiting ? 'WAITING' : 'UNKNOWN';
    const historicalGate = trackKnown && Number.isFinite(time(trackAt)) && time(trackAt) <= nowMs
      ? array(track.gates).find(gate => gate.id === traceGateByStage[id]) : null;
    const traceGate = trackLive ? historicalGate : null;
    const passedLabels = { admission: 'Admission reported', select: 'Selection reported', claim: 'Claim reported',
      pickup: 'Pickup reported', edit: 'Edit reported', test: 'Test run reported', proof: 'Review handoff reported' };
    const operationalLabels = { PASS: passedLabels[id] || 'Observed',
      WAITING: 'Waiting here', FAIL: 'Blocked here', BLOCKED: 'Blocked here', NOT_REACHED: 'Not reached' };
    // Logical PASS is an unqualified report, not a signed material gate receipt.
    // Only the separate independently verified checkpoint can display GREEN.
    const operational = historicalGate ? { state: historicalGate.state, truth: trackLive ? 'CURRENT' : 'STALE',
      label: operationalLabels[historicalGate.state] || 'No stage report',
      reason: historicalGate.reason || '', observedAtUtc: trackAt, expiresAtUtc: trace.expiresAtUtc,
      trafficLight: !trackLive ? 'AMBER' : ['FAIL', 'BLOCKED'].includes(historicalGate.state) ? 'RED'
        : historicalGate.state === 'WAITING' || (id === 'pickup' && historicalGate.state === 'PASS') ? 'AMBER'
          : historicalGate.state === 'PASS' ? 'AMBER' : 'GREY' } : null;
    return { id, label, state, trafficLight: failure ? 'RED' : passed ? 'GREEN' : stale || waiting ? 'AMBER' : 'GREY',
      operational,
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
  // The verified 23-gate public projection contains *no signed goal/worker
  // execution identity*. Its one gate-19 proofRef can be copied into arbitrary
  // goal, controller or lane reports; matching that string is NOT an authentic
  // worker-specific pickup. Fail closed on physical per-goal GREEN/count until
  // the existing original publisher exposes independently qualified, distinct
  // source/claim/goal/worker-bound pickup records. Preserve reported goals
  // separately in the Octopus inventory rather than manufacturing pickups.
  const buildingGoals = [];
  const workers = [...new Map(buildingGoals.map(goal => [goal.builder, {
    id: goal.builder, goals: buildingGoals.filter(other => other.builder === goal.builder)
      .map(other => ({ issue: other.issue, title: other.title })),
  }])).values()];
  // A controller cannot inherit a green light or a future expiry from an old
  // status report. Freshness and reported traffic light are separate facts.
  const controllers = array(projection.controllerFleet?.controllers).map(controller => {
    const current = controller.freshness === 'CURRENT'
      && fresh(controller.timestampUtc, nowMs, maxAgeMs);
    const reportedLight = String(controller.trafficLight || '').toUpperCase();
    return {
      id: controller.controllerId, title: controller.title || controller.controllerId,
      state: controller.activityState || 'UNKNOWN',
      truth: current ? 'CURRENT' : controller.freshness === 'UNKNOWN' ? 'UNKNOWN' : 'STALE',
      trafficLight: current && ['GREEN', 'AMBER', 'RED', 'GREY'].includes(reportedLight)
        ? reportedLight === 'GREEN' && controller.activityState === 'BUILDING'
          ? 'AMBER' : reportedLight : 'GREY',
      expiresAtUtc: current ? new Date(time(controller.timestampUtc) + maxAgeMs).toISOString() : '',
    };
  });
  // Read-only Octopus inventory, not an invented fleet of target-capacity slots.
  // A lane-specific verified receipt and fresh material timestamp are needed
  // before any *individual* lane can claim to be building.
  const sourceControllers = array(projection.controllerFleet?.controllers);
  const octopusControllers = sourceControllers.map(item => {
    const observedAtUtc = String(item.timestampUtc || '');
    const live = item.freshness === 'CURRENT' && fresh(observedAtUtc, nowMs, maxAgeMs);
    return {
      id: String(item.controllerId || ''), title: String(item.title || item.controllerId || ''),
      observedAtUtc, live, expiresAtUtc: live ? new Date(time(observedAtUtc) + maxAgeMs).toISOString() : '',
      state: live ? String(item.activityState || 'UNKNOWN') : observedAtUtc ? 'STALE' : 'UNKNOWN',
      blocker: live ? String(item.blocker || '') : '',
      // A shared diagnostic gate ref cannot credit material work to a
      // specific controller without a scoped independent execution receipt.
      materialActions: null,
      namedLanes: array(item.materialLanes).length + array(item.activeLanes).length + array(item.parkedLanes).length,
    };
  });
  const octopusLanes = sourceControllers.flatMap(controller => {
    const ownerId = String(controller.controllerId || '');
    const owner = String(controller.title || ownerId);
    const observedAtUtc = String(controller.timestampUtc || '');
    const live = controller.freshness === 'CURRENT' && fresh(observedAtUtc, nowMs, maxAgeMs);
    const verified = new Set(array(controller.proofRefs).map(String));
    const source = array(controller.materialLanes).map((lane, index) => {
      const laneId = String(lane?.laneId || ownerId + '-material-' + (index + 1));
      const proofRef = String(lane?.proofRef || '');
      const proven = live && controller.activityState === 'BUILDING'
        && Boolean(signedPickupRef) && proofRef === signedPickupRef
        && verified.has(proofRef) && fresh(lane?.lastMaterialActionAtUtc, nowMs, maxAgeMs)
        && buildingGoals.some(goal => goal.builder === lane?.workerId
          && String(goal.issue || '') === String(lane?.goalId || ''));
      return { id:ownerId + ':' + laneId, laneId, controller:owner,
        workerId:String(lane?.workerId || ''), goalId:String(lane?.goalId || ''),
        source:'material-lane observation', blocker:String(lane?.blocker || ''),
        state:!live ? observedAtUtc ? 'STALE' : 'UNKNOWN' : proven ? 'PROVEN_BUILD'
          : lane?.blocker ? 'BLOCKED_REPORTED' : 'REPORTED_UNVERIFIED',
        light:!live ? 'GREY' : proven ? 'GREEN' : lane?.blocker ? 'RED' : 'AMBER',
        proofVerified:Boolean(proven), observedAtUtc,
        expiresAtUtc:live ? new Date(time(observedAtUtc)+maxAgeMs).toISOString() : '' };
    });
    const names = new Set(source.map(lane => lane.laneId));
    const claims = [...array(controller.activeLanes).map(value=>({value,parked:false})),
      ...array(controller.parkedLanes).map(value=>({value,parked:true}))].flatMap(({value,parked})=>{
      const laneId=String(value||'');if(!laneId||names.has(laneId))return [];
      names.add(laneId);
      return [{id:ownerId+':'+laneId,laneId,controller:owner,workerId:'',goalId:'',
        source:'controller lane claim',blocker:'',proofVerified:false,observedAtUtc,
        state:!live ? observedAtUtc ? 'STALE':'UNKNOWN' : parked ? 'PARKED_CLAIM':'ACTIVE_CLAIM',
        light:live?'AMBER':'GREY',
        expiresAtUtc:live ? new Date(time(observedAtUtc)+maxAgeMs).toISOString() : ''}];
    });
    return [...source,...claims];
  });
  const observedBuilderIds=[...new Set((buildKnown ? array(build.goals):[])
    .map(goal=>String(goal?.builder||'')).filter(Boolean))];
  const octopusBuilders=observedBuilderIds.map(id=>{
    const goals=array(build.goals).filter(goal=>goal.builder===id);
    const proven=buildingGoals.some(goal=>goal.builder===id);
    const blocked=buildLive && (build.state==='BLOCKED' || goals.some(goal=>goal.state==='BLOCKED'));
    return {id,state:!buildLive?'STALE_OR_UNKNOWN':blocked?'BLOCKED_REPORTED'
      :proven?'PROVEN_BUILD':'REPORTED_UNVERIFIED',
      light:!buildLive?'GREY':blocked?'RED':proven?'GREEN':'AMBER',
      goals:goals.map(goal=>({issue:String(goal.issue||''),state:String(goal.state||'UNKNOWN')})),
      expiresAtUtc:buildLive?new Date(time(build.observedAtUtc)+maxAgeMs).toISOString():''};
  });
  const logical=projection.logicalGoalControllers;
  const logicalReady=logical?.schemaVersion==='stephanos.logical-goal-controller-dashboard.v1'
    && logical.truth==='CURRENT';
  const octopusLogicalLanes=logicalReady?array(logical.controllers).map(lane=>({
    id:String(lane.logicalControllerId||''),goalRef:String(lane.goalRef||''),
    title:String(lane.title||''),host:String(lane.hostControllerTitle||''),
    state:String(lane.continuityState||'UNKNOWN'),route:String(lane.route||''),
    selectedForAdmission:lane.selectedForAdmission===true,
    physicalBuildProven:false,
  })):[];
  // Previously published, source-validated Shared Workspace capacity receipts
  // disclose distinct named worker identities not necessarily bound to a
  // BUILDING goal. Availability is not physical pickup or edit/commit proof.
  const capacityRoutes = new Map([
    ['CHATGPT_GITHUB', 'chatgpt-github-build-capacity-current'],
    ['DESKTOP_COMMANDER', 'desktop-commander-build-capacity-current'],
    ['SOVEREIGN_COMMANDER', 'sovereign-commander-build-capacity-current'],
    ['FOUNDRY_FORGE', 'foundry-forge-build-capacity-current'],
  ]);
  const receiptCandidates = array(statusRecords).flatMap(record => {
    const receipt = record?.capacityReceipt;
    const route = String(receipt?.route || '');
    const workerId = String(receipt?.workerId || '');
    const expectedStatus = capacityRoutes.get(route);
    if (record?.kind !== 'stephanos.shared_workspace.status'
      || receipt?.schemaVersion !== 'stephanos.build-lane-capacity-receipt.v1'
      || !expectedStatus || !workerId || workerId.length > 120
      || record.participantId !== workerId
      || record.statusId !== expectedStatus
        && !(route === 'FOUNDRY_FORGE' && record.workerScopedCapacity === true
          && /^foundry-forge-worker-capacity-[a-f0-9]{24}$/.test(String(record.statusId || '')))
      || typeof record.timestampUtc !== 'string'
      || record.timestampUtc !== receipt.observedAtUtc
      || !Number.isFinite(time(record.timestampUtc))
      || !Number.isFinite(time(receipt.expiresAtUtc))
      || time(receipt.expiresAtUtc) <= time(record.timestampUtc)
      || time(receipt.expiresAtUtc) - time(record.timestampUtc) > 60 * 60_000
      || receipt.repository !== 'Cheekyfellastef/stephan-os'
      || !['READY','HELD','BLOCKED','UNAVAILABLE','UNKNOWN'].includes(String(receipt.state || ''))) return [];
    const live = fresh(record.timestampUtc, nowMs, maxAgeMs)
      && nowMs <= time(receipt.expiresAtUtc);
    return [{
      id: route + ':' + workerId, workerId, route,
      state: live ? String(receipt.state) : 'STALE',
      trafficLight: live && receipt.state === 'READY' ? 'AMBER' : 'GREY',
      receiptId: String(receipt.receiptId || ''),
      queueDepth: count(receipt.queueDepth),
      observedAtUtc: record.timestampUtc,
      expiresAtUtc: live ? new Date(Math.min(time(record.timestampUtc) + maxAgeMs,
        time(receipt.expiresAtUtc))).toISOString() : '',
      physicalBuildProven: false,
    }];
  });
  const byCapacityIdentity = new Map();
  for (const receipt of receiptCandidates) {
    const prior = byCapacityIdentity.get(receipt.id);
    if (!prior || time(receipt.observedAtUtc) > time(prior.observedAtUtc)) {
      byCapacityIdentity.set(receipt.id, receipt);
    }
  }
  const octopusCapacityBuilders = [...byCapacityIdentity.values()]
    .sort((a,b) => a.route.localeCompare(b.route) || a.workerId.localeCompare(b.workerId));
  const octopusFleet={
    schemaVersion:'stephanos.goal-conveyor-octopus-inventory.v1',readOnly:true,
    controllers:octopusControllers,lanes:octopusLanes,builders:octopusBuilders,
    capacityBuilders:octopusCapacityBuilders,capacityBuilderCount:octopusCapacityBuilders.length,
    logicalLanes:octopusLogicalLanes,
    logicalTruth:logicalReady?'REPORTED_NOT_PHYSICAL_PROOF':String(logical?.truth||'UNKNOWN'),
    controllerCount:octopusControllers.length,observedLaneCount:octopusLanes.length,
    provenMaterialLaneCount:octopusLanes.filter(lane=>lane.proofVerified).length,
    observedBuilderCount:buildKnown?octopusBuilders.length:null,
    logicalLaneCount:logicalReady?octopusLogicalLanes.length:null,
    targetMaterialLanes:buildLive?count(build.targetMaterialLaneCount):null,
    truthBoundary:'Five controller hosts, named execution lanes, worker identities, provider capacity and logical goal lanes are different layers. Active/parked lane claims are not physical pickup. Green requires fresh lane-specific verified material proof. Provider READY is never physical pickup or BUILDING. Capacity targets are not invented builders. Stale reports cannot remain green.',
  };
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
  const state = bottleneck ? 'BLOCKED' : buildLive ? buildState : trackLive
    ? ['FAIL', 'BLOCKED'].includes(track.currentState) ? 'BLOCKED' : 'WAITING' : buildState;
  const core = latestStatus('stephanos-core-daemon-current');
  const coreKnown = /^[a-f0-9]{40}$/.test(core?.sourceHead || '');
  const coreLive = coreKnown && fresh(core.timestampUtc, nowMs, maxAgeMs);
  // Each service must have an independently timestamped health observation.
  // A stopped Core publisher cannot make a still-live worker/backend appear
  // stopped, and an HTTP read must never renew an old observation.
  const runtimeServices = array(projection.captainsBridge?.runtimeHealth?.services);
  // This estate has no legacy runtime-health records on some deployed machines.
  // Reuse the existing *independent* canonical Windows watchdog and post-sync
  // target receipts instead of re-aging the expired Core daemon aggregate.
  // Both sources are bounded by their original publication time and exact head.
  const watchdog = latestStatus('battle-bridge-worker-watchdog-current');
  const workerProof = watchdog?.finalAssessment;
  const refresh = latestStatus('post-sync-runtime-refresh-current');
  const backendProof = array(refresh?.resultTargets).find(target =>
    target?.targetId === 'stephanos-backend-8787');
  const serviceProofAgeMs = Math.min(maxAgeMs, 2 * 60_000);
  const workerProofValid = watchdog?.status === 'WORKER_WATCHDOG_HEALTHY'
    && watchdog?.classification === 'WORKER_WATCHDOG_HEALTHY'
    && workerProof?.finalVerdict === 'WORKER_WATCHDOG_HEALTHY'
    && workerProof?.healthy === true && workerProof?.processHealthy === true
    && workerProof?.heartbeatFresh === true
    && workerProof?.heartbeatPidMatchesProcess === true
    && workerProof?.processLaunchIdentityValid === true
    && workerProof?.heartbeatLaunchIdentityMatchesProcess === true
    && workerProof?.repositoryFromCanonicalMain === true
    && workerProof?.heartbeatMatchesCanonicalRepositoryHead === true
    && workerProof?.remoteMainHeadProven === true
    && /^[a-f0-9]{40}$/.test(String(workerProof?.sourceHead || ''))
    && workerProof.sourceHead === workerProof.canonicalRepositoryHead
    && workerProof.sourceHead === workerProof.remoteMainHead
    && fresh(watchdog.timestampUtc, nowMs, serviceProofAgeMs);
  const backendProofValid = refresh?.safeRefreshesCompleted === true
    && refresh?.unknownPathCount === 0 && refresh?.unsafePathCount === 0
    && backendProof?.ok === true && backendProof?.exactHeadProofOk === true
    && /^[a-f0-9]{40}$/.test(String(backendProof?.sourceHead || ''))
    && backendProof.sourceHead === refresh.afterHead
    && fresh(refresh.timestampUtc, nowMs, serviceProofAgeMs);
  const health = ['daemonHealthy', 'missionWorkerHealthy', 'backendHealthy'].map((field, index) => {
    const serviceId = index === 1 ? 'mission-worker' : index === 2 ? 'backend' : '';
    const independent = serviceId ? runtimeServices.find(entry => entry?.serviceId === serviceId) : null;
    const independentLive = independent?.freshness === 'CURRENT'
      && fresh(independent?.observedAtUtc, nowMs, maxAgeMs);
    const independentLight = String(independent?.trafficLight || '').toUpperCase();
    if (independentLive && ['GREEN', 'RED', 'AMBER'].includes(independentLight)) {
      return {
        id: field, label: ['Core daemon', 'Mission worker', 'Backend'][index],
        state: independentLight === 'GREEN' ? 'HEALTHY'
          : independentLight === 'RED' ? 'UNHEALTHY' : 'DEGRADED',
        observedAtUtc: independent.observedAtUtc,
        expiresAtUtc: new Date(time(independent.observedAtUtc) + maxAgeMs).toISOString(),
        evidenceSource: 'INDEPENDENT_SERVICE_HEALTH',
      };
    }
    // The watchdog proves a real worker process, authenticated launch
    // identity, fresh PID-bound heartbeat and canonical source head. The
    // post-sync receipt proves the Backend's independently verified target,
    // even when desktop plugin-host activation remains separately blocked.
    const fallback = index === 1 && workerProofValid
      ? { observedAtUtc: watchdog.timestampUtc, evidenceSource: 'CANONICAL_WORKER_WATCHDOG' }
      : index === 2 && backendProofValid
        ? { observedAtUtc: refresh.timestampUtc, evidenceSource: 'EXACT_HEAD_BACKEND_REFRESH' }
        : null;
    if (fallback) return {
      id: field, label: ['Core daemon', 'Mission worker', 'Backend'][index],
      state: 'HEALTHY', observedAtUtc: fallback.observedAtUtc,
      expiresAtUtc: new Date(time(fallback.observedAtUtc) + serviceProofAgeMs).toISOString(),
      evidenceSource: fallback.evidenceSource,
    };
    return {
      id: field, label: ['Core daemon', 'Mission worker', 'Backend'][index],
      state: coreLive && typeof core[field] === 'boolean' ? core[field] ? 'HEALTHY' : 'UNHEALTHY' : 'UNKNOWN',
      observedAtUtc: coreKnown ? core.timestampUtc : '',
      expiresAtUtc: coreLive ? new Date(time(core.timestampUtc) + maxAgeMs).toISOString() : '',
      evidenceSource: coreKnown ? 'CORE_DAEMON_AGGREGATE' : 'UNAVAILABLE',
    };
  });
  return {
    schemaVersion: CONVEYOR_OVERVIEW_SCHEMA, readOnly: true, state, buildState,
    trafficLight: state === 'BLOCKED' ? 'RED' : state === 'BUILDING' ? 'GREEN'
      : ['HELD', 'QUEUED', 'STALE', 'WAITING'].includes(state) ? 'AMBER' : 'GREY',
    generatedAtUtc: new Date(nowMs).toISOString(), maxAgeMs,
    buildExpiresAtUtc: buildLive ? new Date(Math.min(time(build.observedAtUtc),
      ...buildingGoals.map(goal => time(goal.lastMaterialProgressAtUtc))) + maxAgeMs).toISOString() : '',
    buildObservedAtUtc: buildKnown ? build.observedAtUtc || '' : '', buildLive,
    ledgerObservedAtUtc: admittedLedger ? ledger.observedAtUtc : '', ledgerLive,
    sourceHead: admittedLedger ? ledger.sourceHead : '', trace, stages, queueCounts, uncertainGoalCount,
    health, signedProof: { live: ledgerLive,
      ledgerExpiresAtUtc: ledgerLive ? new Date(time(ledger.observedAtUtc) + maxAgeMs).toISOString() : '',
      publisherVerdict: coreLive ? String(core.goalBuildGateSignedPublisherVerdict || '') : '',
      expiresAtUtc: coreLive ? new Date(time(core.timestampUtc) + maxAgeMs).toISOString() : '' },
    workers, buildingGoalCount: buildLive ? buildingGoals.length : null, controllers, octopusFleet,
    materialLanes: buildLive ? count(build.activeMaterialLaneCount) : null,
    targetMaterialLanes: buildLive ? count(build.targetMaterialLaneCount) : null,
    bottleneck, lastActivity: activity,
    lastReportedBlocker: buildKnown ? String(array(build.blockers)[0] || '') : '',
    nextAction: veto ? ledger.exactNextAction : trackLive ? track.exactNextAction : buildLive ? build.nextAction : 'Refresh canonical build evidence.',
    truthBoundary: 'Flow reports come from the canonical autonomy cycle; a system cycle with no selected goal is not attributed to a mission. Operational reports do not grant signed execution, approval or merge authority. Physical pickup needs separate signed proof. Queue counts are durable goal classifications, not an admitted worker queue. Health and capacity do not prove building. Commit and merge require their own receipts. Existing owners and leases are unchanged.',
  };
}
