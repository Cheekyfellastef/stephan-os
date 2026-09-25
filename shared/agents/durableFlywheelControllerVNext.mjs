import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  closeCanonicalGoalFromProgrammeProjection,
  finalizeTerminalImplementationLane,
  publishProgrammeControllerHeartbeat,
  readAuthoritativeProgrammeProjection,
  readMissionControllerCapacityRoutingInput,
  resolveProgrammeAuthorityPaths,
} from '../../stephanos-server/services/programmeAuthorityService.js';
import {
  ensureCriticalBacklogMission,
  recoverOrphanedLegacyCriticalMission,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from './missionOrchestratorWorker.mjs';

export const DURABLE_FLYWHEEL_CONTROLLER_SCHEMA = 'stephanos.durable-flywheel-controller.vnext';
export const DURABLE_FLYWHEEL_CYCLE_RECEIPT_SCHEMA = 'stephanos.durable-flywheel-cycle-receipt.vnext';
export const DURABLE_FLYWHEEL_CONTROLLER_ID = 'durable-flywheel-controller';
export const DURABLE_FLYWHEEL_CONTROLLER_ISSUE = 1497;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const WORKER_SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const KNOWN_PROJECTION_STATES = new Set([
  'HOLD',
  'TERMINAL_RECONCILIATION_REQUIRED',
  'ACTIVE',
  'READY',
  'IDLE',
]);
const ORPHAN_DEADLOCK_BLOCKERS = new Set([
  'critical-backlog-idle-selection-identity-mismatch',
  'critical-backlog-idle-selection-mission-mismatch',
  'critical-backlog-did-not-authorize-idle-selection',
]);

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function safeNow(value) {
  const normalized = text(value);
  return EXPLICIT_TIMEZONE.test(normalized) && Number.isFinite(Date.parse(normalized))
    ? new Date(Date.parse(normalized)).toISOString()
    : '';
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return SHA_40.test(normalized) ? normalized : '';
}

function positiveInteger(value) {
  const normalized = typeof value === 'string'
    ? Number(value.replace(/^#/, ''))
    : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function receiptId(nowUtc) {
  const timestamp = nowUtc.replace(/[^0-9]/g, '').slice(0, 17);
  return `durable-flywheel-${timestamp || 'invalid'}`;
}

function projectionIdentity(projection = {}) {
  const lane = projection?.lane;
  const issueNumber = positiveInteger(
    lane?.issueNumber
      ?? projection?.scheduler?.decisionReceipt?.selectedIssue
      ?? projection?.scheduler?.selectedGoal,
  ) ?? DURABLE_FLYWHEEL_CONTROLLER_ISSUE;
  const prNumber = positiveInteger(lane?.prNumber);
  return freeze({
    laneId: text(lane?.laneId),
    repository: text(lane?.repository),
    issueNumber,
    prNumber,
    branch: text(lane?.branch),
    headSha: sha(lane?.headSha),
    leaseId: text(projection?.mutationLease?.leaseId),
    ownerId: text(projection?.mutationLease?.ownerId),
  });
}

function encodedMissionIdentity(missionId = '') {
  const normalized = text(missionId).toLowerCase();
  const goalLane = /^goal-([1-9]\d*)-pr-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  if (goalLane) {
    return freeze({
      issueNumber: positiveInteger(goalLane[1]),
      prNumber: positiveInteger(goalLane[2]),
    });
  }
  const criticalGoal = /^critical-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  return freeze({
    issueNumber: positiveInteger(criticalGoal?.[1]),
    prNumber: null,
  });
}

export function resolveMissionWorkerGrantIdentity(state = {}, fallback = {}) {
  const missionId = text(state?.missionId).toLowerCase();
  const encoded = encodedMissionIdentity(missionId);
  const explicitIssueNumber = positiveInteger(state?.issueNumber ?? state?.relatedIssue);
  const explicitPrNumber = positiveInteger(
    state?.pullRequest?.number ?? state?.prNumber ?? state?.relatedPr,
  );
  if (
    explicitIssueNumber
    && encoded.issueNumber
    && explicitIssueNumber !== encoded.issueNumber
  ) return null;
  if (
    explicitPrNumber
    && encoded.prNumber
    && explicitPrNumber !== encoded.prNumber
  ) return null;
  const missionBound = Boolean(encoded.issueNumber);
  return freeze({
    laneId: missionId || text(fallback?.laneId),
    repository: text(state?.repository) || text(fallback?.repository),
    issueNumber: explicitIssueNumber ?? encoded.issueNumber ?? positiveInteger(fallback?.issueNumber),
    prNumber: explicitPrNumber ?? encoded.prNumber ?? (missionBound ? null : positiveInteger(fallback?.prNumber)),
    branch: text(state?.git?.branch ?? state?.branch) || (missionBound ? '' : text(fallback?.branch)),
    headSha: sha(state?.pullRequest?.headSha ?? state?.headSha ?? state?.git?.headSha)
      || (missionBound ? '' : sha(fallback?.headSha)),
  });
}

function workerAdapter(action = {}) {
  if (action.actionKind === 'signed-openclaw-operation') return 'openclaw-signed';
  if (action.actionKind === 'github-inspection') return 'openclaw-github-readonly';
  if (action.actionKind === 'agent-handoff') return text(action.adapter);
  if (action.actionKind === 'local-deployment') return 'openclaw-local-deployment';
  if (action.actionKind === 'evidence-judgment') return 'verification';
  return '';
}

function createExactWorkerActionGrant(projection = {}, sourceRevision = '', capacityRouting = null) {
  const activeMission = projection?.criticalBacklog?.activeMission;
  const actionState = projectMissionWorkerActionState(activeMission, {
    now: new Date(safeNow(projection?.observedAtUtc) || new Date().toISOString()),
  });
  const missionId = text(actionState?.missionId).toLowerCase();
  const missionRevision = Number(actionState?.revision);
  const currentPhase = text(actionState?.currentPhase).toUpperCase();
  if (
    !WORKER_SAFE_ID.test(missionId)
    || !Number.isSafeInteger(missionRevision)
    || missionRevision < 0
    || !currentPhase
  ) {
    return null;
  }
  const action = buildMissionWorkerAction(actionState, {
    now: new Date(safeNow(projection?.observedAtUtc) || new Date().toISOString()),
    capacityRouting,
  });
  const actionId = text(action?.actionId).toLowerCase();
  const adapter = workerAdapter(action);
  if (action?.executable !== true || !WORKER_SAFE_ID.test(actionId) || !adapter) return null;
  const identity = resolveMissionWorkerGrantIdentity(actionState, projectionIdentity(projection));
  if (!identity?.laneId || !identity?.repository || !identity?.issueNumber || !identity?.branch) return null;
  return freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${actionId}`.slice(0, 80),
    controllerId: DURABLE_FLYWHEEL_CONTROLLER_ID,
    sourceRevision,
    missionId,
    missionRevision,
    currentPhase,
    actionId,
    actionKind: text(action.actionKind),
    adapter,
    operation: text(action.operation),
    capacityRoute: text(action.capacityRoute),
    capacityReceiptId: text(action.capacityReceiptId) || null,
    capacityProofRefs: freeze(list(action.capacityProofRefs)),
    workerId: text(action.owner) || null,
    laneId: identity.laneId,
    repository: identity.repository,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch,
    headSha: identity.headSha || null,
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export const CONTROLLER_LIVENESS_DECISION_SCHEMA = 'stephanos.controller-liveness-decision.v1';

export function evaluateControllerLivenessDecision(input = {}) {
  const safeEligibleWorkRemaining = input?.safeEligibleWorkRemaining === true;
  const operatorDisableRequested = input?.operatorDisableRequested === true;
  const terminalCompletion = input?.terminalCompletion === true && !safeEligibleWorkRemaining;
  const scopedActions = [...new Set(list(input?.scopedActions).map(text).filter(Boolean))].sort();
  const unsafeScopedActions = [...new Set(list(input?.unsafeScopedActions).map(text).filter(Boolean))].sort();
  const controllerLevelUnsafe = input?.controllerLevelUnsafe === true
    && scopedActions.length > 0
    && scopedActions.length === unsafeScopedActions.length
    && scopedActions.every((action, index) => action === unsafeScopedActions[index]);

  const failureCounts = new Map();
  for (const failure of list(input?.surfaceFailures)) {
    const surfaceId = text(failure?.surfaceId);
    const failureClass = text(failure?.failureClass);
    if (!surfaceId || !failureClass) continue;
    const key = `${surfaceId}::${failureClass}`;
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
  }
  const blockedSurfaceIds = [...new Set(
    [...failureCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key]) => key.split('::')[0]),
  )].sort();
  const qualifiedSurfaces = [...new Set(list(input?.qualifiedSurfaces).map(text).filter(Boolean))];
  const alternateQualifiedSurfaces = qualifiedSurfaces.filter(
    (surfaceId) => !blockedSurfaceIds.includes(surfaceId),
  );

  const disableAllowed = operatorDisableRequested || terminalCompletion || controllerLevelUnsafe;
  const reason = operatorDisableRequested
    ? 'EXPLICIT_OPERATOR_DISABLE'
    : terminalCompletion
      ? 'TERMINAL_SCOPE_COMPLETE'
      : controllerLevelUnsafe
        ? 'CONTROLLER_LEVEL_UNSAFE'
        : blockedSurfaceIds.length
          ? 'SURFACE_BLOCKED_CONTROLLER_LIVE'
          : 'CONTROLLER_LIVE';

  return freeze({
    schemaVersion: CONTROLLER_LIVENESS_DECISION_SCHEMA,
    decision: disableAllowed ? 'DISABLE_ALLOWED' : 'REMAIN_ENABLED',
    reason,
    disableAllowed,
    controllerShouldRemainEnabled: !disableAllowed,
    blockedSurfaceIds: freeze(blockedSurfaceIds),
    qualifiedSurfaces: freeze(qualifiedSurfaces),
    alternateQualifiedSurfaces: freeze(alternateQualifiedSurfaces),
    selectedAlternateSurface: alternateQualifiedSurfaces[0] ?? null,
    retryNextScheduledRun: !disableAllowed && alternateQualifiedSurfaces.length === 0,
    safeEligibleWorkRemaining,
    controllerLevelUnsafeProven: controllerLevelUnsafe,
    surfaceBlockScope: 'SURFACE_OR_LANE_ONLY',
  });
}

function controllerLivenessBlockDecision(options = {}) {
  const evidence = options?.controllerLivenessEvidence && typeof options.controllerLivenessEvidence === 'object'
    ? options.controllerLivenessEvidence
    : {};
  return evaluateControllerLivenessDecision({
    ...evidence,
    qualifiedSurfaces: [],
  });
}

function controllerLivenessDecisionForAdjudicatedGrant(options = {}, blockDecision = null, workerActionGrant = null) {
  const evidence = options?.controllerLivenessEvidence && typeof options.controllerLivenessEvidence === 'object'
    ? options.controllerLivenessEvidence
    : {};
  const blockedSurfaceIds = list(blockDecision?.blockedSurfaceIds);
  const admittedAdapter = text(workerActionGrant?.adapter);
  return evaluateControllerLivenessDecision({
    ...evidence,
    qualifiedSurfaces: blockedSurfaceIds.length && admittedAdapter
      ? [admittedAdapter]
      : [],
  });
}

function capacityRoutingWithLiveness(capacityRouting, decision) {
  if (!capacityRouting || typeof capacityRouting !== 'object' || Array.isArray(capacityRouting)) return capacityRouting;
  return freeze({
    ...capacityRouting,
    blockedAdapters: freeze([...list(decision?.blockedSurfaceIds)]),
  });
}

function holdResult(reason, additions = {}) {
  const blockers = [...new Set([
    reason,
    ...list(additions.blockers),
  ].map((item) => text(item)).filter(Boolean))];
  return freeze({
    schemaVersion: DURABLE_FLYWHEEL_CONTROLLER_SCHEMA,
    status: 'HOLD',
    finalVerdict: 'DURABLE_FLYWHEEL_CONTROLLER_HOLD',
    observedAtUtc: additions.observedAtUtc ?? null,
    sourceRevision: additions.sourceRevision ?? null,
    projectionStatus: additions.projectionStatus ?? null,
    activeLane: additions.activeLane ?? null,
    blockers,
    allowWorkerTick: false,
    boundedMutationSteps: 0,
    chatMemoryAuthoritative: false,
    productionContractsOnly: true,
    createsReplacementMachinery: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    controllerDisableAllowed: false,
    controllerShouldRemainEnabled: true,
    surfaceBlockScope: 'SURFACE_OR_LANE_ONLY',
    nextAction: 'Publish the exact blocker, park only that surface or lane, and keep the controller live.',
  });
}

export function reconcileDurableFlywheelController(projection = {}, options = {}) {
  const observedAtUtc = safeNow(options.nowUtc ?? projection?.observedAtUtc);
  const sourceRevision = sha(options.sourceRevision);
  const blockers = [];
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    blockers.push('authoritative-programme-projection-invalid');
  }
  if (projection?.schemaVersion !== AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA) {
    blockers.push('authoritative-programme-projection-schema-mismatch');
  }
  if (projection?.sourceConstructionMode !== 'production-contracts') {
    blockers.push('authoritative-programme-projection-not-production-constructed');
  }
  if (projection?.chatMemoryAuthoritative !== false) {
    blockers.push('chat-memory-authority-not-explicitly-disabled');
  }
  if (!observedAtUtc) blockers.push('controller-observation-time-invalid');
  if (!sourceRevision) blockers.push('controller-source-revision-invalid');
  const status = text(projection?.status).toUpperCase();
  if (!KNOWN_PROJECTION_STATES.has(status)) blockers.push('authoritative-programme-status-invalid');
  if (status === 'HOLD') blockers.push(...list(projection?.blockers).map((blocker) => `authority:${text(blocker)}`));
  if (blockers.length) {
    return holdResult('authoritative-programme-reconciliation-blocked', {
      blockers,
      observedAtUtc: observedAtUtc || null,
      sourceRevision: sourceRevision || null,
      projectionStatus: status || null,
      activeLane: projection?.lane ?? null,
    });
  }

  const identity = projectionIdentity(projection);
  const common = {
    schemaVersion: DURABLE_FLYWHEEL_CONTROLLER_SCHEMA,
    status,
    finalVerdict: 'DURABLE_FLYWHEEL_CONTROLLER_READY',
    observedAtUtc,
    sourceRevision,
    projectionStatus: status,
    activeLane: projection?.lane ?? null,
    laneIdentity: identity,
    blockers: [],
    boundedMutationSteps: 1,
    chatMemoryAuthoritative: false,
    productionContractsOnly: true,
    createsReplacementMachinery: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    controllerDisableAllowed: false,
    controllerShouldRemainEnabled: true,
    surfaceBlockScope: 'SURFACE_OR_LANE_ONLY',
  };
  if (status === 'TERMINAL_RECONCILIATION_REQUIRED') {
    return freeze({
      ...common,
      action: 'FINALIZE_EXACT_TERMINAL_LANE',
      allowWorkerTick: false,
      nextAction: 'Publish exact terminal evidence, release only the matching lease, then reconcile again.',
    });
  }
  if (status === 'ACTIVE') {
    return freeze({
      ...common,
      action: 'ADVANCE_EXISTING_ACTIVE_LANE',
      allowWorkerTick: true,
      nextAction: 'Allow the existing Mission Worker to advance one bounded action under the current lease.',
    });
  }
  if (status === 'READY') {
    return freeze({
      ...common,
      action: 'CREATE_CANONICAL_CONVEYOR_MISSION',
      allowWorkerTick: false,
      nextAction: 'Ask the Critical Backlog Conveyor to create the scheduler-authorized mission.',
    });
  }
  return freeze({
    ...common,
    action: 'WAIT_FOR_DURABLE_GOAL_EVIDENCE',
    allowWorkerTick: false,
    boundedMutationSteps: 0,
    nextAction: 'Remain idle until canonical durable sources expose buildable work.',
  });
}

function createCycleReceipt(result, projection, nowUtc, options = {}) {
  const identity = result.laneIdentity ?? projectionIdentity(projection);
  const id = text(options.receiptId, receiptId(nowUtc));
  const proofRef = `receipts/${id}.json`;
  return freeze({
    ...createSharedWorkspaceReceiptRecord({
      receiptId: id,
      participantId: DURABLE_FLYWHEEL_CONTROLLER_ID,
      timestampUtc: nowUtc,
      correlationId: identity.laneId || id,
      relatedIssue: `#${identity.issueNumber || DURABLE_FLYWHEEL_CONTROLLER_ISSUE}`,
      relatedPr: identity.prNumber ? `#${identity.prNumber}` : '',
      receivedRecordId: text(projection?.projectionReceipt?.receiptId, id),
      disposition: text(result.status, 'HOLD').toLowerCase(),
      summary: `${text(result.action, 'HOLD')}: ${text(result.nextAction, 'Stopped without mutation.')}`,
      proofRefs: [proofRef],
    }),
    schema: DURABLE_FLYWHEEL_CYCLE_RECEIPT_SCHEMA,
    controllerId: DURABLE_FLYWHEEL_CONTROLLER_ID,
    sourceRevision: result.sourceRevision,
    programmeStatus: text(result.projectionStatus, 'UNKNOWN'),
    action: text(result.action, 'HOLD'),
    laneId: identity.laneId || null,
    repository: identity.repository || null,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch || null,
    headSha: identity.headSha || null,
    blockers: list(result.blockers),
    allowWorkerTick: result.allowWorkerTick === true,
    boundedMutationSteps: result.boundedMutationSteps === 1 ? 1 : 0,
    workerActionGrantId: text(result.workerActionGrant?.grantId) || null,
    workerMissionId: text(result.workerActionGrant?.missionId) || null,
    workerActionId: text(result.workerActionGrant?.actionId) || null,
    goalClosureState: text(result.goalClosureResult?.state) || null,
    goalClosureStateReason: text(result.goalClosureResult?.stateReason) || null,
    goalClosureRepository: text(result.goalClosureResult?.repository) || null,
    goalClosureIssueNumber: positiveInteger(result.goalClosureResult?.issueNumber),
    goalClosureResultProofRefs: freeze(list(result.goalClosureResult?.resultProofRefs)),
    goalClosureReusableCapabilityId: text(result.goalClosureResult?.reusableCapabilityId) || null,
    goalClosureSharedLessonId: text(result.goalClosureResult?.sharedLessonId) || null,
    controllerDisableAllowed: result.controllerLivenessDecision?.disableAllowed === true,
    controllerShouldRemainEnabled: result.controllerLivenessDecision
      ? result.controllerLivenessDecision.controllerShouldRemainEnabled === true
      : result.controllerShouldRemainEnabled !== false,
    blockedSurfaceIds: freeze(list(result.controllerLivenessDecision?.blockedSurfaceIds)),
    selectedAlternateSurface: text(result.controllerLivenessDecision?.selectedAlternateSurface) || null,
    retryNextScheduledRun: result.controllerLivenessDecision?.retryNextScheduledRun === true,
    chatMemoryAuthoritative: false,
    createsReplacementMachinery: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function transitionAuthorityResult(projection, sourceRevision, nowUtc, transitionState) {
  const terminal = transitionState === 'FINALIZING';
  const identity = projectionIdentity(projection);
  return freeze({
    schemaVersion: DURABLE_FLYWHEEL_CONTROLLER_SCHEMA,
    status: terminal ? 'TERMINAL_RECONCILIATION_REQUIRED' : 'ACTIVE',
    finalVerdict: 'DURABLE_FLYWHEEL_TRANSITION_RECONCILED',
    observedAtUtc: nowUtc,
    sourceRevision,
    projectionStatus: terminal ? 'TERMINAL_RECONCILIATION_REQUIRED' : 'ACTIVE',
    activeLane: projection?.lane ?? null,
    laneIdentity: identity,
    action: terminal
      ? 'ESTABLISH_EXACT_TERMINAL_RECONCILIATION_AUTHORITY'
      : 'ESTABLISH_EXACT_ACTIVE_LANE_AUTHORITY',
    blockers: [],
    allowWorkerTick: false,
    boundedMutationSteps: 0,
    chatMemoryAuthoritative: false,
    productionContractsOnly: true,
    createsReplacementMachinery: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    nextAction: 'Publish durable reconciliation evidence before exposing one bounded mutation step.',
  });
}

function hasOnlyTransitionAuthorityBlocker(projection, transitionState) {
  const expected = transitionState === 'FINALIZING'
    ? 'controller-heartbeat-terminal-lane-authority-unproven'
    : 'controller-heartbeat-active-lane-authority-unproven';
  return projection?.status === 'HOLD'
    && list(projection?.blockers).length === 1
    && projection.blockers[0] === expected;
}

function hasExactTerminalLaneIdentity(projection) {
  const identity = projectionIdentity(projection);
  return Boolean(
    projection?.lane?.valid === true
    && projection?.lane?.terminal === true
    && projection?.lane?.mergeEvidence?.affirmativelyMerged === true
    && projection?.mutationLease
    && identity.laneId
    && identity.repository
    && identity.issueNumber
    && identity.prNumber
    && identity.branch
    && identity.headSha
    && identity.leaseId
    && identity.ownerId
  );
}

function canBootstrapExactTerminalCleanupAuthority(projection) {
  if (!hasExactTerminalLaneIdentity(projection)) return false;
  const heartbeat = projection?.controllerHeartbeat;
  return projection?.status === 'HOLD'
    && list(projection?.blockers).includes('controller-heartbeat-terminal-lane-authority-unproven')
    && heartbeat?.valid === true
    && heartbeat?.fresh === true
    && heartbeat?.cycleState === 'FINALIZING'
    && heartbeat?.activeLaneId === projection.lane.laneId;
}

function hasExactTerminalCleanupAuthority(projection) {
  if (!hasExactTerminalLaneIdentity(projection)) return false;
  const heartbeat = projection?.controllerHeartbeat;
  return heartbeat?.valid === true
    && heartbeat?.fresh === true
    && heartbeat?.cycleState === 'FINALIZING'
    && heartbeat?.activeLaneId === projection.lane.laneId
    && heartbeat?.reconciliationSucceeded === true
    && heartbeat?.boundedMutationSteps === 1;
}

export async function publishDurableFlywheelCycleReceipt(receipt, options = {}) {
  const paths = resolveProgrammeAuthorityPaths({
    root: options.root,
    repoRoot: options.repoRoot,
  });
  if (!paths.ok) return freeze({ ok: false, reason: paths.reason, receipt });
  const write = await writeAtomicJson(
    paths.root,
    ['receipts', `${receipt.receiptId}.json`],
    receipt,
    { repoRoot: options.repoRoot, nowMs: Date.parse(receipt.timestampUtc) },
  );
  return freeze({
    ok: write.ok === true,
    reason: write.ok ? 'DURABLE_FLYWHEEL_CYCLE_RECEIPT_PUBLISHED' : write.reason,
    receipt,
    write,
  });
}

function heartbeatInput({
  state,
  sourceRevision,
  activeLaneId = '',
  nowUtc,
  boundedMutationSteps = 0,
  successful = false,
  cycleReceiptId = '',
}) {
  return freeze({
    controllerId: DURABLE_FLYWHEEL_CONTROLLER_ID,
    sourceRevision,
    cycleState: state,
    activeLaneId,
    lastSuccessfulReconciliationUtc: successful ? nowUtc : '',
    lastPublishedReceiptId: successful ? cycleReceiptId : '',
    timestampUtc: nowUtc,
    boundedMutationSteps,
    proofRefs: successful ? [`receipts/${cycleReceiptId}.json`] : [],
  });
}

function productionMachinery(overrides = {}) {
  return freeze({
    publishControllerHeartbeat: overrides.publishControllerHeartbeat ?? publishProgrammeControllerHeartbeat,
    loadAuthoritativeProjection: overrides.loadAuthoritativeProjection ?? readAuthoritativeProgrammeProjection,
    closeReadyGoal: overrides.closeReadyGoal ?? closeCanonicalGoalFromProgrammeProjection,
    finalizeTerminalLane: overrides.finalizeTerminalLane ?? finalizeTerminalImplementationLane,
    ensureBacklogMission: overrides.ensureBacklogMission ?? ensureCriticalBacklogMission,
    recoverOrphanedBacklogMission: overrides.recoverOrphanedBacklogMission ?? recoverOrphanedLegacyCriticalMission,
    publishReceipt: overrides.publishReceipt ?? publishDurableFlywheelCycleReceipt,
    loadCapacityRoutingInput: overrides.loadCapacityRoutingInput ?? readMissionControllerCapacityRoutingInput,
  });
}

function shouldAttemptOrphanRecovery(projection = {}) {
  const blockers = list(projection?.blockers).map((blocker) => text(blocker));
  return projection?.status === 'HOLD'
    && !projection?.lane
    && Boolean(projection?.scheduler?.selectedGoal)
    && projection?.criticalBacklog?.decision === 'WAIT_ACTIVE_MISSION'
    && text(projection?.criticalBacklog?.activeMission?.currentPhase).toUpperCase() === 'CREATE_WORKTREE'
    && blockers.some((blocker) => ORPHAN_DEADLOCK_BLOCKERS.has(blocker));
}

export async function runDurableFlywheelStartupCycle(machinery = {}, options = {}) {
  const deps = productionMachinery(machinery);
  const nowUtc = safeNow(options.nowUtc) || new Date().toISOString();
  const env = options.env ?? process.env;
  const sourceRevision = sha(options.sourceRevision ?? env.STEPHANOS_MISSION_WORKER_HEAD_SHA);
  const cycleReceiptId = receiptId(nowUtc);
  const serviceOptions = {
    ...options,
    env,
    nowUtc,
    sourceRevision,
  };
  let controllerLivenessDecision = controllerLivenessBlockDecision(options);
  if (!sourceRevision) {
    const result = holdResult('controller-source-revision-invalid', { observedAtUtc: nowUtc });
    const receipt = createCycleReceipt(result, null, nowUtc);
    const publication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
    return freeze({ ...result, cycleReceipt: receipt, receiptPublication: publication });
  }

  const publishHeartbeat = requiredFunction(deps.publishControllerHeartbeat, 'publishControllerHeartbeat');
  const initialHeartbeat = await publishHeartbeat(heartbeatInput({
    state: 'STARTING',
    sourceRevision,
    nowUtc,
  }), serviceOptions);
  if (initialHeartbeat?.ok !== true) {
    const result = holdResult(`controller-heartbeat:${text(initialHeartbeat?.reason, 'publication-failed')}`, {
      observedAtUtc: nowUtc,
      sourceRevision,
    });
    const receipt = createCycleReceipt(result, null, nowUtc);
    const publication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
    return freeze({ ...result, heartbeatPublication: initialHeartbeat, cycleReceipt: receipt, receiptPublication: publication });
  }

  const loadProjection = requiredFunction(deps.loadAuthoritativeProjection, 'loadAuthoritativeProjection');
  let transitionAuthorityReceipt = null;
  let transitionAuthorityReceiptPublication = null;
  let transitionAuthorityHeartbeatPublication = null;
  let missionAdmissionReceipt = null;
  let missionAdmissionReceiptPublication = null;
  let projection = await loadProjection(serviceOptions);
  const transitionState = projection?.lane?.active === true
    ? 'ACTIVE_LANE'
    : projection?.lane?.terminal === true
      ? 'FINALIZING'
      : !projection?.lane && projection?.scheduler?.selectedGoal
        ? 'RECONCILING'
        : '';
  if (transitionState) {
    const transitionHeartbeat = await publishHeartbeat(heartbeatInput({
      state: transitionState,
      sourceRevision,
      activeLaneId: projection?.lane?.laneId ?? '',
      nowUtc,
      boundedMutationSteps: 0,
    }), serviceOptions);
    if (transitionHeartbeat?.ok !== true) {
      const result = holdResult(`controller-heartbeat:${text(transitionHeartbeat?.reason, 'transition-publication-failed')}`, {
        observedAtUtc: nowUtc,
        sourceRevision,
        activeLane: projection.lane,
      });
      const receipt = createCycleReceipt(result, projection, nowUtc);
      const publication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
      const holdHeartbeat = await publishHeartbeat(heartbeatInput({
        state: 'HOLD',
        sourceRevision,
        nowUtc,
        cycleReceiptId: receipt.receiptId,
        successful: publication?.ok === true,
      }), serviceOptions);
      return freeze({
        ...result,
        transitionHeartbeatPublication: transitionHeartbeat,
        heartbeatPublication: holdHeartbeat,
        cycleReceipt: receipt,
        receiptPublication: publication,
      });
    }
    projection = await loadProjection(serviceOptions);
    if (
      ['ACTIVE_LANE', 'FINALIZING'].includes(transitionState)
      && (
        hasOnlyTransitionAuthorityBlocker(projection, transitionState)
        || (transitionState === 'FINALIZING' && canBootstrapExactTerminalCleanupAuthority(projection))
      )
    ) {
      const authorityResult = transitionAuthorityResult(
        projection,
        sourceRevision,
        nowUtc,
        transitionState,
      );
      transitionAuthorityReceipt = createCycleReceipt(
        authorityResult,
        projection,
        nowUtc,
        { receiptId: `${receiptId(nowUtc)}-authority` },
      );
      transitionAuthorityReceiptPublication = await requiredFunction(
        deps.publishReceipt,
        'publishReceipt',
      )(transitionAuthorityReceipt, serviceOptions);
      if (transitionAuthorityReceiptPublication?.ok === true) {
        transitionAuthorityHeartbeatPublication = await publishHeartbeat(heartbeatInput({
          state: transitionState,
          sourceRevision,
          activeLaneId: projection?.lane?.laneId ?? '',
          nowUtc,
          boundedMutationSteps: 1,
          successful: true,
          cycleReceiptId: transitionAuthorityReceipt.receiptId,
        }), serviceOptions);
        if (transitionAuthorityHeartbeatPublication?.ok === true) {
          projection = await loadProjection(serviceOptions);
        } else {
          projection = {
            ...projection,
            status: 'HOLD',
            blockers: [
              ...list(projection.blockers),
              `controller-heartbeat:${text(
                transitionAuthorityHeartbeatPublication?.reason,
                'authority-publication-failed',
              )}`,
            ],
          };
        }
      } else {
        projection = {
          ...projection,
          status: 'HOLD',
          blockers: [
            ...list(projection.blockers),
            `transition-authority-receipt:${text(
              transitionAuthorityReceiptPublication?.reason,
              'publication-failed',
            )}`,
          ],
        };
      }
    }
  }

  let orphanRecovery = null;
  let orphanRecoveryRefresh = null;
  if (shouldAttemptOrphanRecovery(projection)) {
    orphanRecovery = await requiredFunction(
      deps.recoverOrphanedBacklogMission,
      'recoverOrphanedBacklogMission',
    )({
      env,
      now: new Date(nowUtc),
    });
    if (orphanRecovery?.ok === false) {
      projection = {
        ...projection,
        status: 'HOLD',
        blockers: [
          ...list(projection.blockers),
          `orphan-recovery:${text(orphanRecovery?.classification || orphanRecovery?.reason, 'failed')}`,
        ],
      };
    } else if (orphanRecovery?.recovered === true) {
      orphanRecoveryRefresh = await requiredFunction(
        deps.ensureBacklogMission,
        'ensureBacklogMission',
      )({
        env,
        now: new Date(nowUtc),
        allowLegacyMissionCreation: false,
        admissionOwner: 'durable-flywheel-controller-orphan-recovery',
      });
      if (orphanRecoveryRefresh?.ok !== true) {
        projection = {
          ...projection,
          status: 'HOLD',
          blockers: [
            ...list(projection.blockers),
            `orphan-recovery-refresh:${text(orphanRecoveryRefresh?.classification || orphanRecoveryRefresh?.reason, 'failed')}`,
          ],
        };
      } else {
        projection = await loadProjection(serviceOptions);
      }
    }
  }

  const terminalCleanupAuthorized = transitionState === 'FINALIZING'
    && hasExactTerminalCleanupAuthority(projection);
  let result = terminalCleanupAuthorized
    ? freeze({
      ...transitionAuthorityResult(projection, sourceRevision, nowUtc, 'FINALIZING'),
      action: 'FINALIZE_EXACT_TERMINAL_LANE',
      boundedMutationSteps: 1,
      nextAction: 'Publish exact terminal evidence, release only the matching merged lease, then reconcile unrelated programme blockers independently.',
    })
    : reconcileDurableFlywheelController(projection, { nowUtc, sourceRevision });
  let goalClosureResult = null;
  const closurePlanReady = projection?.goalClosurePlan?.state === 'READY';
  if (closurePlanReady && ['ACTIVE', 'IDLE'].includes(result.status)) {
    goalClosureResult = await requiredFunction(deps.closeReadyGoal, 'closeReadyGoal')(
      projection,
      serviceOptions,
    );
    if (['CLOSED_COMPLETED', 'ALREADY_CLOSED'].includes(text(goalClosureResult?.state))) {
      const closureMutated = goalClosureResult.state === 'CLOSED_COMPLETED';
      projection = await loadProjection(serviceOptions);
      const refreshed = reconcileDurableFlywheelController(projection, { nowUtc, sourceRevision });
      if (closureMutated && refreshed.status !== 'ACTIVE') {
        result = freeze({
          ...refreshed,
          status: 'IDLE',
          action: 'CLOSE_CANONICAL_GOAL',
          allowWorkerTick: false,
          boundedMutationSteps: 1,
          goalClosureResult,
          nextAction: 'Refresh canonical goal truth and immediately continue the work-conserving controller cycle.',
        });
      } else {
        result = freeze({
          ...refreshed,
          goalClosureResult,
          ...(closureMutated && refreshed.status === 'ACTIVE'
            ? {
                action: 'ADVANCE_ACTIVE_LANE_AND_CLOSE_COMPLETED_GOAL',
                boundedMutationSteps: 1,
                nextAction: 'Keep the active worker moving while the retired goal releases capacity for the next scheduler refill.',
              }
            : {}),
        });
      }
    } else {
      result = freeze({ ...result, goalClosureResult });
    }
  }

  let actionResult = null;
  if (result.status === 'TERMINAL_RECONCILIATION_REQUIRED') {
    const identity = result.laneIdentity;
    actionResult = await requiredFunction(deps.finalizeTerminalLane, 'finalizeTerminalLane')({
      leaseId: identity.leaseId,
      laneId: identity.laneId,
      repository: identity.repository,
      issueNumber: identity.issueNumber,
      prNumber: identity.prNumber,
      branch: identity.branch,
      headSha: identity.headSha,
      ownerId: identity.ownerId,
      nowUtc,
    }, serviceOptions);
    if (actionResult?.ok !== true) {
      result = holdResult(`terminal-finalization:${text(actionResult?.reason, 'failed')}`, {
        observedAtUtc: nowUtc,
        sourceRevision,
        activeLane: projection.lane,
      });
    }
  } else if (result.status === 'ACTIVE') {
    const capacityRouting = await requiredFunction(
      deps.loadCapacityRoutingInput,
      'loadCapacityRoutingInput',
    )(serviceOptions);
    const blockDecision = controllerLivenessBlockDecision(options);
    const routedCapacity = capacityRoutingWithLiveness(capacityRouting, blockDecision);
    const workerActionGrant = createExactWorkerActionGrant(projection, sourceRevision, routedCapacity);
    controllerLivenessDecision = controllerLivenessDecisionForAdjudicatedGrant(
      options,
      blockDecision,
      workerActionGrant,
    );
    if (!workerActionGrant) {
      result = freeze({
        ...holdResult('mission-worker:exact-action-grant-unavailable', {
          observedAtUtc: nowUtc,
          sourceRevision,
          activeLane: projection.lane,
        }),
        controllerLivenessDecision,
      });
    } else {
      result = freeze({ ...result, workerActionGrant, controllerLivenessDecision });
    }
  } else if (result.status === 'READY') {
    missionAdmissionReceipt = createCycleReceipt(
      result,
      projection,
      nowUtc,
      { receiptId: `${receiptId(nowUtc)}-admission` },
    );
    missionAdmissionReceiptPublication = await requiredFunction(
      deps.publishReceipt,
      'publishReceipt',
    )(missionAdmissionReceipt, serviceOptions);
    if (missionAdmissionReceiptPublication?.ok !== true) {
      result = holdResult(`mission-admission-receipt:${text(
        missionAdmissionReceiptPublication?.reason,
        'publication-failed',
      )}`, {
        observedAtUtc: nowUtc,
        sourceRevision,
      });
    } else {
      actionResult = await requiredFunction(deps.ensureBacklogMission, 'ensureBacklogMission')({
        env,
        now: new Date(nowUtc),
      });
      if (actionResult?.ok !== true) {
        result = holdResult(`critical-backlog:${text(actionResult?.classification ?? actionResult?.reason, 'mission-create-failed')}`, {
          observedAtUtc: nowUtc,
          sourceRevision,
        });
      } else {
        const grantProjection = {
          ...projection,
          criticalBacklog: actionResult.projection,
        };
        const capacityRouting = await requiredFunction(
          deps.loadCapacityRoutingInput,
          'loadCapacityRoutingInput',
        )(serviceOptions);
        const blockDecision = controllerLivenessBlockDecision(options);
        const routedCapacity = capacityRoutingWithLiveness(capacityRouting, blockDecision);
        const workerActionGrant = createExactWorkerActionGrant(grantProjection, sourceRevision, routedCapacity);
        controllerLivenessDecision = controllerLivenessDecisionForAdjudicatedGrant(
          options,
          blockDecision,
          workerActionGrant,
        );
        if (!workerActionGrant) {
          result = freeze({
            ...holdResult('mission-worker:exact-action-grant-unavailable', {
              observedAtUtc: nowUtc,
              sourceRevision,
            }),
            controllerLivenessDecision,
          });
        } else {
          result = freeze({
            ...result,
            workerActionGrant,
            controllerLivenessDecision,
            allowWorkerTick: true,
            nextAction: actionResult.createdMission
              ? 'Allow the existing Mission Worker to process the newly created canonical mission.'
              : 'Allow the existing Mission Worker to continue the conveyor-authorized mission.',
          });
        }
      }
    }
  }

  const receipt = createCycleReceipt(result, projection, nowUtc);
  const receiptPublication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
  if (receiptPublication?.ok !== true) {
    result = holdResult(`cycle-receipt:${text(receiptPublication?.reason, 'publication-failed')}`, {
      observedAtUtc: nowUtc,
      sourceRevision,
      activeLane: projection?.lane,
      blockers: result.blockers,
    });
  }
  const finalState = result.status === 'HOLD'
    ? 'HOLD'
    : result.status === 'ACTIVE'
      ? 'ACTIVE_LANE'
      : 'IDLE';
  const finalHeartbeat = await publishHeartbeat(heartbeatInput({
    state: finalState,
    sourceRevision,
    activeLaneId: finalState === 'ACTIVE_LANE' ? text(projection?.lane?.laneId) : '',
    nowUtc,
    cycleReceiptId: receipt.receiptId,
    boundedMutationSteps: result.boundedMutationSteps,
    successful: receiptPublication?.ok === true,
  }), serviceOptions);
  if (finalHeartbeat?.ok !== true) {
    result = holdResult(`controller-heartbeat:${text(finalHeartbeat?.reason, 'final-publication-failed')}`, {
      observedAtUtc: nowUtc,
      sourceRevision,
      activeLane: projection?.lane,
    });
  }
  return freeze({
    ...result,
    authoritativeProjection: projection,
    actionResult,
    transitionAuthorityReceipt,
    transitionAuthorityReceiptPublication,
    transitionAuthorityHeartbeatPublication,
    missionAdmissionReceipt,
    missionAdmissionReceiptPublication,
    orphanRecovery,
    orphanRecoveryRefresh,
    cycleReceipt: receipt,
    receiptPublication,
    heartbeatPublication: finalHeartbeat,
    controllerLivenessDecision,
  });
}

export function renderDurableFlywheelReceipt(result) {
  if (!result || typeof result !== 'object') throw new TypeError('result is required');
  return [
    'Durable Flywheel Reconciliation Receipt VNext',
    `Status: ${text(result.status, 'HOLD')}`,
    `Observed-At: ${text(result.observedAtUtc, 'unproven')}`,
    `Source-Revision: ${text(result.sourceRevision, 'unproven')}`,
    `Projection-Status: ${text(result.projectionStatus, 'unproven')}`,
    `Action: ${text(result.action, 'none')}`,
    `Worker-Tick-Allowed: ${result.allowWorkerTick === true}`,
    'Chat-Memory-Authoritative: false',
    'Creates-Replacement-Machinery: false',
    'Merge-Authority: false',
    'Lease-Seizure-Allowed: false',
    `Next-Action: ${text(result.nextAction, 'none')}`,
    `Blockers: ${list(result.blockers).length ? result.blockers.join(', ') : 'none'}`,
  ].join('\n');
}