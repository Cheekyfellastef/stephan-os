export const STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA = 'stephanos.core-persistent-flywheel.v1';
export const DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS = 60_000;
export const DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS = 5 * 60_000;
export const OCTOPUS_CONTROLLER_FABRIC_REPAIR_BLOCKERS = Object.freeze([
  'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
  'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
  'CONTROLLER_FLEET_ATTENTION_REQUIRED',
  'LOGICAL_GOAL_CONTROLLER_FABRIC_INVALID',
  // A parked critical backlog must not hide an unproven elastic admission path.
  // Run the existing bounded control-plane repair before retrying admission.
  'ELASTIC_GOAL_ADMISSION_NOT_PROVEN',
  // Admission is proven but every selected goal needs existing mission-owner repair.
  'ELASTIC_GOALS_ALL_HELD_REPAIR_REQUIRED',
]);

export function projectOctopusRepairEscalation(blocker = '') {
  const normalized = String(blocker ?? '').trim().toUpperCase();
  const shouldRepairControlPlane = OCTOPUS_CONTROLLER_FABRIC_REPAIR_BLOCKERS.includes(normalized);
  return Object.freeze({
    shouldRepairControlPlane,
    blocker: normalized,
    repairActionId: shouldRepairControlPlane ? 'repair-control-plane' : '',
    retryGoalBuilderAfterRepair: shouldRepairControlPlane,
    duplicateControllerAllowed: false,
    authorityWideningAllowed: false,
  });
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function finiteMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function boundedText(value, max = 120) {
  return text(value).slice(0, max);
}

export function projectPersistentFlywheelTrigger(input = {}) {
  const nowMs = finiteMs(input.nowMs) ?? Date.now();
  const fallbackMs = finiteMs(input.fallbackMs) ?? DEFAULT_PERSISTENT_FLYWHEEL_FALLBACK_MS;
  const lastCycleAtMs = finiteMs(input.lastCycleAtMs);
  const currentFingerprint = text(input.eventFingerprint);
  const previousFingerprint = text(input.lastEventFingerprint);
  const cycleRunning = input.cycleRunning === true;
  const eventChanged = Boolean(currentFingerprint) && currentFingerprint !== previousFingerprint;
  const fallbackDue = lastCycleAtMs === null || nowMs - lastCycleAtMs >= fallbackMs;

  if (cycleRunning) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: false,
      reason: 'PERSISTENT_FLYWHEEL_SINGLE_FLIGHT_ACTIVE',
      eventChanged,
      fallbackDue,
      fallbackMs,
    });
  }
  if (eventChanged) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: true,
      reason: 'PERSISTENT_FLYWHEEL_DURABLE_STATE_CHANGED',
      eventChanged: true,
      fallbackDue,
      fallbackMs,
    });
  }
  if (fallbackDue) {
    return Object.freeze({
      schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
      shouldRun: true,
      reason: 'PERSISTENT_FLYWHEEL_FALLBACK_RECONCILIATION_DUE',
      eventChanged: false,
      fallbackDue: true,
      fallbackMs,
    });
  }
  return Object.freeze({
    schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
    shouldRun: false,
    reason: 'PERSISTENT_FLYWHEEL_WAITING_FOR_EVENT_OR_FALLBACK',
    eventChanged: false,
    fallbackDue: false,
    fallbackMs,
  });
}

export function projectOctopusSelfHealDecision(octopusSummary = {}, {
  nowMs = Date.now(),
  lastAttemptAtMs = null,
  cooldownMs = DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS,
} = {}) {
  const now = finiteMs(nowMs) ?? Date.now();
  const lastAttempt = lastAttemptAtMs === null || lastAttemptAtMs === undefined
    ? null
    : finiteMs(lastAttemptAtMs);
  const cooldown = finiteMs(cooldownMs) ?? DEFAULT_OCTOPUS_SELF_HEAL_COOLDOWN_MS;
  const needsRepair = octopusSummary?.octopusNeedsRepair === true;

  if (!needsRepair) {
    return Object.freeze({
      shouldRepair: false,
      reason: 'OCTOPUS_SELF_HEAL_NOT_REQUIRED',
      retryAfterMs: 0,
    });
  }

  if (lastAttempt !== null && now - lastAttempt < cooldown) {
    return Object.freeze({
      shouldRepair: false,
      reason: 'OCTOPUS_SELF_HEAL_COOLDOWN_ACTIVE',
      retryAfterMs: Math.max(0, cooldown - (now - lastAttempt)),
    });
  }

  return Object.freeze({
    shouldRepair: true,
    reason: 'OCTOPUS_SELF_HEAL_REQUIRED',
    retryAfterMs: 0,
  });
}

export function summarizePersistentFlywheelResult(result = {}) {
  const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
  const idleGrantWait = result?.status === 'HOLD'
    && !result?.authoritativeProjection?.lane
    && result?.allowWorkerTick === false
    && Number(result?.boundedMutationSteps) === 0
    && blockers.length === 1
    && blockers[0] === 'mission-worker:exact-action-grant-unavailable';
  return Object.freeze({
    idleGrantWait,
    schemaVersion: STEPHANOS_CORE_PERSISTENT_FLYWHEEL_SCHEMA,
    status: boundedText(result?.status, 40) || 'UNKNOWN',
    action: boundedText(result?.action, 100) || 'NONE',
    blockerCount: blockers.length,
    allowWorkerTick: result?.allowWorkerTick === true,
    boundedMutationSteps: Number.isSafeInteger(result?.boundedMutationSteps)
      ? Math.max(0, result.boundedMutationSteps)
      : 0,
    sourceRevision: /^[0-9a-f]{40}$/i.test(text(result?.sourceRevision))
      ? text(result.sourceRevision).toLowerCase()
      : '',
    safeSummaryOnly: true,
  });
}

export function summarizeLogicalGoalControllerFabric(result = {}, targetMaterialLanes = 15) {
  const fabric = result?.authoritativeProjection?.logicalGoalControllerFabric;
  const controllers = Array.isArray(fabric?.controllers)
    ? fabric.controllers.filter((controller) => controller?.retired !== true)
    : [];
  const valid = fabric?.valid === true;
  const active = valid ? controllers.filter((controller) => controller?.continuityState === 'ACTIVE').length : 0;
  const tracking = valid ? controllers.filter((controller) => controller?.continuityState === 'TRACKING').length : 0;
  const parked = valid ? controllers.filter((controller) => controller?.continuityState === 'PARKED').length : 0;
  const selected = valid ? controllers.filter((controller) => controller?.selectedForAdmission === true).length : 0;
  const target = Number.isSafeInteger(Number(targetMaterialLanes))
    ? Math.max(1, Number(targetMaterialLanes))
    : 15;
  return Object.freeze({
    logicalLaneTruth: valid ? 'CURRENT' : 'UNKNOWN',
    logicalControllerCount: valid ? controllers.length : 0,
    logicalActiveLaneCount: active,
    logicalTrackingLaneCount: tracking,
    logicalParkedLaneCount: parked,
    logicalSelectedForAdmissionCount: selected,
    targetMaterialLanes: target,
    logicalLaneDeficitToTarget: valid ? Math.max(0, target - active) : null,
  });
}

export function summarizePersistentRefillSweep(result = {}) {
  const cycleDecision = result?.cycleDecision || {};
  return Object.freeze({
    refillStatus: result?.ok === true ? 'READY' : 'DEGRADED',
    refillMaterialActionsSucceeded: Number.isSafeInteger(Number(result?.materialActionsSucceeded))
      ? Math.max(0, Number(result.materialActionsSucceeded))
      : 0,
    refillSweepAttemptCount: Number.isSafeInteger(Number(result?.sweepAttemptCount))
      ? Math.max(0, Number(result.sweepAttemptCount))
      : 0,
    refillSafeEligibleWorkRemaining: Number.isSafeInteger(Number(cycleDecision?.safeEligibleWorkRemaining))
      ? Math.max(0, Number(cycleDecision.safeEligibleWorkRemaining))
      : 0,
    refillProvenSafeFreeLanes: Number.isSafeInteger(Number(cycleDecision?.provenSafeFreeLanes))
      ? Math.max(0, Number(cycleDecision.provenSafeFreeLanes))
      : 0,
    refillNoRunnableSourceWorkProven: result?.noRunnableSourceWorkProven === true,
    refillWorkConservingSweepExhausted: result?.workConservingSweepExhausted === true,
    refillParkedLaneCount: Array.isArray(result?.parkedLaneBlockers) ? result.parkedLaneBlockers.length : 0,
    // A canonical programme HOLD can have no runnable goals and no parked worker
    // receipts. That is not proved idle: route it to the existing bounded repair.
    refillCanonicalProgrammeHeld: text(result?.conveyorResult?.programmeStatus).toUpperCase() === 'HOLD'
      || result?.controllerContinuity === 'RECONCILE_CANONICAL_PROGRAMME_HOLD'
      || result?.finalVerdict === 'GOAL_DISCOVERY_HEARTBEAT_CANONICAL_PROGRAMME_HOLD',
    refillFinalVerdict: boundedText(result?.finalVerdict, 120) || 'UNKNOWN',
  });
}

// An existing goal owner is not proof that the goal was picked up.
// Retain the canonical Flywheel reconciliation truth without adding authority.
export function summarizePersistentGapClosure(reconciliation = null) {
  const observed = reconciliation !== null && typeof reconciliation === 'object' && !Array.isArray(reconciliation);
  const attachments = observed && Array.isArray(reconciliation.attachments)
    ? reconciliation.attachments : [];
  const owners = new Set();
  for (const attachment of attachments) {
    if (!['ATTACH_TO_EXISTING_GOAL', 'CANONICAL_GOAL_CREATED_AND_ADMITTED',
      'DEDUPED_CANONICAL_GOAL_ADMITTED'].includes(attachment?.disposition)) continue;
    for (const owner of Array.isArray(attachment?.ownerGoals) ? attachment.ownerGoals : []) {
      if (/^#[1-9]\d*$/.test(String(owner))) owners.add(String(owner));
    }
  }
  const heldCount = observed && Number.isSafeInteger(reconciliation.canonicalGoalAdmissionHeldCount)
    ? Math.max(0, reconciliation.canonicalGoalAdmissionHeldCount) : 0;
  return Object.freeze({
    gapClosureObserved: observed,
    gapClosureStatus: !observed ? 'UNKNOWN'
      : reconciliation.ok !== true ? 'DEGRADED'
        : owners.size || heldCount ? 'PENDING_PROOF' : 'NO_UNRESOLVED_OWNED_GAPS_OBSERVED',
    gapClosureUnresolvedOwnerCount: owners.size,
    gapClosureAdmissionHeldCount: heldCount,
    gapClosureOwnerRefs: Object.freeze([...owners].sort().slice(0, 20)),
    gapClosureCompletionProven: false,
    gapClosureSchedulerAuthority: false,
    gapClosureMergeAuthority: false,
  });
}

export function summarizeOctopusBuildProductivity(refillSummary = {}, {
  lastMaterialBuildAtUtc = '',
  gapClosureSummary = {},
} = {}) {
  const materialActions = Number.isSafeInteger(Number(refillSummary?.refillMaterialActionsSucceeded))
    ? Math.max(0, Number(refillSummary.refillMaterialActionsSucceeded))
    : 0;
  const sweepAttempts = Number.isSafeInteger(Number(refillSummary?.refillSweepAttemptCount))
    ? Math.max(0, Number(refillSummary.refillSweepAttemptCount))
    : 0;
  const eligibleWorkRemaining = Number.isSafeInteger(Number(refillSummary?.refillSafeEligibleWorkRemaining))
    ? Math.max(0, Number(refillSummary.refillSafeEligibleWorkRemaining))
    : 0;
  const provenSafeFreeLanes = Number.isSafeInteger(Number(refillSummary?.refillProvenSafeFreeLanes))
    ? Math.max(0, Number(refillSummary.refillProvenSafeFreeLanes))
    : 0;
  const parkedLanes = Number.isSafeInteger(Number(refillSummary?.refillParkedLaneCount))
    ? Math.max(0, Number(refillSummary.refillParkedLaneCount))
    : 0;
  const degraded = text(refillSummary?.refillStatus).toUpperCase() === 'DEGRADED';
  const noRunnableWorkProven = refillSummary?.refillNoRunnableSourceWorkProven === true;
  const programmeHeld = refillSummary?.refillCanonicalProgrammeHeld === true;
  const sweepExhausted = refillSummary?.refillWorkConservingSweepExhausted === true;
  const unresolvedOwnedGaps = Number.isSafeInteger(gapClosureSummary?.gapClosureUnresolvedOwnerCount)
    ? Math.max(0, gapClosureSummary.gapClosureUnresolvedOwnerCount) : 0;

  let verdict = 'WAITING';
  if (materialActions > 0) verdict = 'BUILDING';
  else if (degraded) verdict = 'DEGRADED';
  // HOLD and stranded parked lanes must wake the existing guarded Sovereign
  // repair flow. Checking idle first suppressed repair when the goal conveyor
  // truthfully reported zero runnable work because everything was blocked.
  else if (programmeHeld) verdict = 'PROGRAMME_HOLD';
  else if (parkedLanes > 0 && eligibleWorkRemaining === 0 && provenSafeFreeLanes === 0) verdict = 'PARKED';
  else if (noRunnableWorkProven && unresolvedOwnedGaps > 0) verdict = 'OWNED_GAP_PICKUP_MISSING';
  else if (noRunnableWorkProven) verdict = 'IDLE_PROVEN';
  else if (eligibleWorkRemaining > 0 || provenSafeFreeLanes > 0 || sweepExhausted) verdict = 'STALLED_WITH_CAPACITY';

  return Object.freeze({
    octopusBuildVerdict: verdict,
    octopusBuildStallDetected: ['STALLED_WITH_CAPACITY', 'PROGRAMME_HOLD', 'PARKED', 'OWNED_GAP_PICKUP_MISSING'].includes(verdict),
    octopusNeedsRepair: ['STALLED_WITH_CAPACITY', 'PROGRAMME_HOLD', 'PARKED', 'OWNED_GAP_PICKUP_MISSING', 'DEGRADED'].includes(verdict),
    octopusProgrammeHeld: programmeHeld,
    octopusUnresolvedOwnedGapCount: unresolvedOwnedGaps,
    octopusMaterialActionsLastCycle: materialActions,
    octopusSweepAttemptsLastCycle: sweepAttempts,
    octopusEligibleWorkRemaining: eligibleWorkRemaining,
    octopusProvenSafeFreeLanes: provenSafeFreeLanes,
    octopusParkedLaneCount: parkedLanes,
    octopusNoRunnableWorkProven: noRunnableWorkProven,
    octopusLastMaterialBuildAtUtc: text(lastMaterialBuildAtUtc),
    octopusProofSource: 'CANONICAL_GOAL_BUILD_REFILL',
  });
}


// A read-only meta-check on the existing Core Daemon heartbeat. It deliberately
// distinguishes a live controller from a proven, closed goal-to-live loop.
// Missing producer evidence stays UNKNOWN and can never turn the dashboard green.
export const STEPHANOS_CORE_LOOP_CLOSURE_AUDIT_SCHEMA_V1 = 'stephanos.core-loop-closure-audit.v1';

export function auditCoreLoopClosureV1({
  coreState = {}, flywheel = {}, worker = {}, lease = {},
  observedAtUtc = new Date().toISOString(),
} = {}) {
  const now = Date.parse(observedAtUtc);
  const head = String(coreState?.sourceHead || '').trim().toLowerCase();
  const headValid = /^[0-9a-f]{40}$/.test(head);
  const maxAge = Math.max(180_000, Number(flywheel?.flywheelFallbackIntervalMs) * 3 || 180_000);
  const timestamp = (value) => {
    const ms = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(ms) && Number.isFinite(now) && ms <= now + 30_000 ? ms : null;
  };
  const recent = (value, age = maxAge) => {
    const ms = timestamp(value);
    return ms !== null && now >= ms && now - ms <= age;
  };
  const edges = [];
  const add = (id, state, reason, ownerIssue, proofRef = '') => {
    edges.push(Object.freeze({ id, state, reason, ownerIssue, proofRefs: proofRef ? [proofRef] : [] }));
  };

  const coreHealthy = coreState?.sovereignCommanderHealthy === true
    && coreState?.backendHealthy === true
    && coreState?.missionWorkerHealthy === true;
  add('DEPENDENCIES_TO_WATCH', !headValid ? 'GAP' : coreHealthy ? 'CLOSED' : 'GAP',
    !headValid ? 'SOURCE_HEAD_UNPROVEN' : coreHealthy ? 'CORE_DEPENDENCIES_OBSERVED_HEALTHY' : 'CORE_DEPENDENCY_UNHEALTHY',
    '#2593', headValid ? 'status/stephanos-core-daemon-current.json' : '');

  const cycleAt = flywheel?.flywheelLastCycleFinishedAtUtc;
  const cycleFresh = recent(cycleAt);
  const cycleFailed = Boolean(flywheel?.flywheelLastError || flywheel?.octopusLastError);
  const cycleRunning = flywheel?.flywheelCycleRunning === true;
  const gaming = coreState?.gamingActive === true;
  add('WATCH_TO_RECONCILIATION',
    gaming ? 'PAUSED' : cycleFailed ? 'GAP' : cycleFresh ? 'CLOSED' : cycleRunning ? 'IN_PROGRESS' : 'GAP',
    gaming ? 'GAMING_PROTECTED' : cycleFailed ? 'PERSISTENT_CYCLE_FAILED'
      : cycleFresh ? 'FRESH_PERSISTENT_CYCLE_OBSERVED' : cycleRunning ? 'PERSISTENT_CYCLE_IN_PROGRESS' : 'PERSISTENT_CYCLE_MISSING_OR_STALE',
    '#2593', cycleFresh ? 'status/stephanos-core-daemon-current.json' : '');

  const refillActions = Number(flywheel?.refillMaterialActionsSucceeded) || 0;
  const eligible = Number(flywheel?.refillSafeEligibleWorkRemaining) || 0;
  const free = Number(flywheel?.refillProvenSafeFreeLanes) || 0;
  const stranded = eligible > 0 && free > 0 && refillActions === 0;
  const octopus = String(flywheel?.octopusBuildVerdict || '');
  const contradictoryBuild = octopus === 'BUILDING' && refillActions === 0;
  add('RECONCILIATION_TO_GOAL_ADMISSION',
    gaming ? 'PAUSED' : cycleFailed || stranded || contradictoryBuild || flywheel?.refillCanonicalProgrammeHeld === true
      ? 'GAP' : cycleFresh && flywheel?.refillStatus === 'READY' ? 'CLOSED' : 'UNKNOWN',
    stranded ? 'RUNNABLE_WORK_WITH_FREE_CAPACITY_STRANDED'
      : contradictoryBuild ? 'BUILDING_CLAIM_WITHOUT_MATERIAL_ACTION'
        : flywheel?.refillCanonicalProgrammeHeld === true ? 'CANONICAL_PROGRAMME_HELD'
          : cycleFailed ? 'REFILL_CYCLE_FAILED' : gaming ? 'GAMING_PROTECTED'
            : cycleFresh && flywheel?.refillStatus === 'READY' ? 'REFILL_CYCLE_ATTEMPT_PROVEN_NOT_GOAL_PICKUP'
              : 'FRESH_REFILL_EVIDENCE_MISSING',
    '#2002', cycleFresh ? 'status/stephanos-core-daemon-current.json' : '');

  // This read-only daemon has no proof that a particular candidate passed
  // admission, SELECT and CLAIM: aggregate refill/dispatch counters do NOT count.
  add('ADMISSION_TO_SELECT', 'UNKNOWN', 'CANONICAL_GOAL_SELECTION_RECEIPT_NOT_OBSERVED', '#1622');
  add('SELECT_TO_CLAIM', 'UNKNOWN', 'EXACT_GOAL_CLAIM_RECEIPT_NOT_OBSERVED', '#1622');

  const task = String(worker?.activeTaskId || '').trim();
  const receipt = String(worker?.activeReceiptId || '').trim();
  const workerHead = String(worker?.headSha || '').trim().toLowerCase();
  const workerAt = worker?.heartbeatAtUtc || worker?.timestampUtc || worker?.observedAtUtc;
  const workerFresh = recent(workerAt, 180_000);
  const mismatchedHead = Boolean(task && workerHead && workerHead !== head);
  const partialClaim = Boolean(task) !== Boolean(receipt);
  const claimed = Boolean(task && receipt);
  const physicalPickup = claimed && !receipt.startsWith('claim:')
    && Boolean(String(worker?.executionPhase || '').trim())
    && workerFresh && !mismatchedHead && workerHead === head;
  add('CLAIM_TO_PHYSICAL_PICKUP',
    mismatchedHead || partialClaim || (claimed && !workerFresh) ? 'GAP'
      : physicalPickup ? 'CLOSED' : 'UNKNOWN',
    mismatchedHead ? 'WORKER_SOURCE_HEAD_MISMATCH' : partialClaim ? 'PARTIAL_CLAIM_OR_RECEIPT'
      : claimed && !workerFresh ? 'WORKER_HEARTBEAT_STALE'
        : physicalPickup ? 'FRESH_EXACT_HEAD_WORKER_EXECUTION_RECEIPT' : 'PHYSICAL_PICKUP_NOT_PROVEN',
    '#2961', physicalPickup ? 'status/mission-orchestrator-worker-heartbeat.json' : '');

  const leaseActive = lease?.active === true;
  const leaseExpired = leaseActive && timestamp(lease?.expiresAtUtc) !== null && Date.parse(lease.expiresAtUtc) < now;
  add('PICKUP_TO_EXECUTION',
    leaseExpired ? 'GAP' : physicalPickup ? 'IN_PROGRESS' : 'UNKNOWN',
    leaseExpired ? 'ACTIVE_SOURCE_MUTATION_LEASE_EXPIRED'
      : physicalPickup ? 'WORKER_RUNNING_EXECUTION_COMPLETION_NOT_PROVEN' : 'EXECUTION_NOT_PROVEN',
    '#2961');

  // No fabricated proof, merge, deployment, lesson or regression truth. Exact
  // typed receipts must be wired from their canonical producers in follow-up work.
  add('EXECUTION_TO_DETERMINISTIC_PROOF', 'UNKNOWN', 'GOAL_SPECIFIC_TEST_AND_PROOF_RECEIPT_NOT_OBSERVED', '#2670');
  add('PROOF_TO_PROTECTED_MERGE', 'UNKNOWN', 'EXACT_HEAD_APPROVAL_AND_MERGE_RECEIPT_NOT_OBSERVED', '#2670');
  add('MERGE_TO_LIVE_ACCEPTANCE', 'UNKNOWN', 'POST_MERGE_RUNTIME_ACCEPTANCE_NOT_OBSERVED', '#2972');
  add('LIVE_TO_REGRESSION_RESCAN', 'UNKNOWN', 'UNATTENDED_REGRESSION_RESCAN_NOT_OBSERVED', '#2972');
  add('GAP_TO_GOAL_AND_RETRY', 'UNKNOWN', 'EVIDENCED_GAP_DEDUPE_ADMISSION_AND_RETRY_NOT_OBSERVED', '#2670');

  const gaps = edges.filter((edge) => edge.state === 'GAP');
  const unproven = edges.filter((edge) => edge.state === 'UNKNOWN');
  const closed = edges.filter((edge) => edge.state === 'CLOSED');
  const allClosed = gaps.length === 0 && unproven.length === 0
    && edges.every((edge) => edge.state === 'CLOSED');
  const priority = gaps[0] || unproven[0] || edges.find((edge) => edge.state !== 'CLOSED');
  return Object.freeze({
    schemaVersion: STEPHANOS_CORE_LOOP_CLOSURE_AUDIT_SCHEMA_V1,
    observedAtUtc,
    sourceHead: headValid ? head : '',
    classification: allClosed ? 'ALL_LOOPS_PROVEN_CLOSED'
      : gaps.length ? 'LOOP_GAPS_DETECTED' : 'LOOP_CLOSURE_EVIDENCE_INCOMPLETE',
    allLoopsProvenClosed: allClosed,
    totalEdgeCount: edges.length,
    closedEdgeCount: closed.length,
    gapCount: gaps.length,
    unprovenCount: unproven.length,
    pausedCount: edges.filter((edge) => edge.state === 'PAUSED').length,
    edges: Object.freeze(edges),
    nextAction: priority ? Object.freeze({
      ownerIssue: priority.ownerIssue, edgeId: priority.id, reason: priority.reason,
      route: 'EXISTING_CANONICAL_GOAL_AND_REPAIR_MACHINERY',
    }) : null,
    noNewScheduler: true,
    noNewMutationAuthority: true,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}
