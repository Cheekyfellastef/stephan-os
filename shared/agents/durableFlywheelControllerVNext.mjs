import { createHash } from 'node:crypto';
import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  claimSourceMutationLease,
  finalizeTerminalImplementationLane,
  publishProgrammeControllerHeartbeat,
  readAuthoritativeProgrammeProjection,
  readMissionControllerCapacityRoutingInput,
  readSourceMutationLease,
  resolveProgrammeAuthorityPaths,
} from '../../stephanos-server/services/programmeAuthorityService.js';
import {
  ensureCriticalBacklogMission,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';
import {
  publishNextMissionWorkerAction,
} from '../../stephanos-server/services/missionOrchestratorWorkerService.js';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from './missionOrchestratorWorker.mjs';
import { MISSION_PROVIDER_ROUTE_INTENT } from './missionControllerCapacityRouterV1.mjs';

export const DURABLE_FLYWHEEL_CONTROLLER_SCHEMA = 'stephanos.durable-flywheel-controller.vnext';
export const DURABLE_FLYWHEEL_CYCLE_RECEIPT_SCHEMA = 'stephanos.durable-flywheel-cycle-receipt.vnext';
export const DURABLE_FLYWHEEL_CONTROLLER_ID = 'durable-flywheel-controller';
export const DURABLE_FLYWHEEL_CONTROLLER_ISSUE = 1497;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const WORKER_SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,159}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const KNOWN_PROJECTION_STATES = new Set([
  'HOLD',
  'TERMINAL_RECONCILIATION_REQUIRED',
  'ACTIVE',
  'READY',
  'IDLE',
]);
const SOURCE_MUTATION_ADAPTERS = new Set([
  'codex',
  'openclaw-local',
  'chatgpt-github',
  'foundry-forge',
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

function compactId(prefix, values = []) {
  const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
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

function conflictingIdentity(left, right) {
  return left !== null && left !== '' && right !== null && right !== '' && left !== right;
}

function exactWorkerGrantIdentity(projection = {}, actionState = {}) {
  const projected = projectionIdentity(projection);
  const mission = {
    laneId: text(actionState?.laneId),
    repository: text(actionState?.repository),
    issueNumber: positiveInteger(actionState?.issueNumber ?? actionState?.goalNumber),
    prNumber: positiveInteger(actionState?.prNumber ?? actionState?.pullRequest?.number),
    branch: text(actionState?.branch ?? actionState?.git?.branch),
    headSha: sha(actionState?.headSha ?? actionState?.git?.headSha ?? actionState?.pullRequest?.headSha),
  };
  if (
    conflictingIdentity(projected.laneId, mission.laneId)
    || conflictingIdentity(projected.repository, mission.repository)
    || conflictingIdentity(projected.issueNumber, mission.issueNumber)
    || conflictingIdentity(projected.prNumber, mission.prNumber)
  ) return null;
  const issueNumber = projected.issueNumber ?? mission.issueNumber;
  const prNumber = projected.prNumber ?? mission.prNumber;
  const laneId = projected.laneId || mission.laneId || (issueNumber && prNumber
    ? `goal-${issueNumber}-pr-${prNumber}`
    : '');
  if (laneId && !SAFE_ID.test(laneId)) return null;
  return freeze({
    laneId,
    repository: projected.repository || mission.repository,
    issueNumber,
    prNumber,
    branch: projected.branch || mission.branch,
    headSha: projected.headSha || mission.headSha,
    leaseId: projected.leaseId,
    ownerId: projected.ownerId,
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
  let providerRouteIntent = null;
  if (action.actionKind === 'agent-handoff' && ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED'].includes(currentPhase)) {
    const selectedMission = projection?.criticalBacklog?.selectedItem?.mission;
    providerRouteIntent = text(
      activeMission?.providerRouteIntent || selectedMission?.providerRouteIntent,
      'AUTO',
    ).toUpperCase();
    const selectedCapacityRoute = text(action.capacityRoute).toUpperCase();
    const validProviderRouteIntent = Object.values(MISSION_PROVIDER_ROUTE_INTENT).includes(providerRouteIntent);
    if (!validProviderRouteIntent
      || !selectedCapacityRoute
      || (providerRouteIntent !== 'AUTO' && providerRouteIntent !== selectedCapacityRoute)) return null;
  }
  const identity = exactWorkerGrantIdentity(projection, actionState);
  if (!identity) return null;
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
    providerRouteIntent,
    capacityRoute: text(action.capacityRoute),
    capacityReceiptId: text(action.capacityReceiptId) || null,
    capacityProofRefs: freeze(list(action.capacityProofRefs)),
    workerId: text(action.owner) || null,
    laneId: identity.laneId || null,
    repository: identity.repository || text(actionState?.repository) || null,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch || text(actionState?.git?.branch) || null,
    headSha: identity.headSha || null,
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function sourceMutationLeasePlan(grant, nowUtc, proofRefs = []) {
  const adapter = text(grant?.adapter).toLowerCase();
  const required = grant?.actionKind === 'agent-handoff' && SOURCE_MUTATION_ADAPTERS.has(adapter);
  if (!required) return freeze({ required: false, complete: true, expected: null, claimInput: null });
  const laneId = text(grant?.laneId);
  const repository = text(grant?.repository);
  const issueNumber = positiveInteger(grant?.issueNumber);
  const prNumber = positiveInteger(grant?.prNumber);
  const branch = text(grant?.branch);
  const headSha = sha(grant?.headSha);
  const ownerId = text(grant?.workerId);
  const complete = Boolean(
    SAFE_ID.test(laneId)
    && SAFE_REPOSITORY.test(repository)
    && issueNumber
    && prNumber
    && SAFE_BRANCH.test(branch)
    && !branch.includes('..')
    && headSha
    && SAFE_ID.test(ownerId)
  );
  if (!complete) return freeze({ required: true, complete: false, expected: null, claimInput: null });
  const leaseId = compactId('source-lease', [
    laneId,
    text(grant?.actionId),
    repository,
    prNumber,
    headSha,
  ]);
  const expected = freeze({
    leaseId,
    laneId,
    repository,
    issueNumber,
    prNumber,
    branch,
    headSha,
    ownerId,
  });
  return freeze({
    required: true,
    complete: true,
    expected,
    claimInput: freeze({ ...expected, nowUtc, proofRefs: freeze(list(proofRefs)) }),
  });
}

function exactActiveSourceMutationLease(read, expected) {
  if (
    read?.ok !== true
    || read?.present !== true
    || read?.validation?.valid !== true
    || read?.validation?.active !== true
    || !read?.record
    || !expected
  ) return false;
  for (const [field, normalize] of [
    ['leaseId', text],
    ['laneId', text],
    ['repository', text],
    ['issueNumber', positiveInteger],
    ['prNumber', positiveInteger],
    ['branch', text],
    ['headSha', sha],
    ['ownerId', text],
  ]) {
    if (normalize(read.record[field]) !== normalize(expected[field])) return false;
  }
  return read.record.mergeAuthority === false && read.record.leaseSeizureAllowed === false;
}

async function publishExactWorkerAction(deps, workerActionGrant, serviceOptions) {
  const dispatch = await requiredFunction(
    deps.publishWorkerAction,
    'publishWorkerAction',
  )({ ...serviceOptions, actionGrant: workerActionGrant });
  return freeze({
    published: dispatch?.published === true,
    actionGrantAccepted: dispatch?.actionGrantAccepted === true,
    reason: text(dispatch?.reason),
    actionId: text(dispatch?.action?.actionId),
    result: dispatch ?? null,
  });
}

function withWorkerDispatch(result, workerActionGrant, dispatch) {
  return freeze({
    ...result,
    workerActionGrant,
    workerActionDispatchPublished: dispatch?.published === true,
    workerActionDispatchAccepted: dispatch?.actionGrantAccepted === true,
    workerActionDispatchReason: text(dispatch?.reason) || null,
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
    nextAction: 'Publish the exact blocker and stop without mutation.',
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
      nextAction: 'Publish the exact Mission Worker action now; retain the supervised worker tick as an idempotent fallback.',
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
    workerActionDispatchPublished: result.workerActionDispatchPublished === true,
    workerActionDispatchAccepted: result.workerActionDispatchAccepted === true,
    workerActionDispatchReason: text(result.workerActionDispatchReason) || null,
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
    finalizeTerminalLane: overrides.finalizeTerminalLane ?? finalizeTerminalImplementationLane,
    ensureBacklogMission: overrides.ensureBacklogMission ?? ensureCriticalBacklogMission,
    publishReceipt: overrides.publishReceipt ?? publishDurableFlywheelCycleReceipt,
    loadCapacityRoutingInput: overrides.loadCapacityRoutingInput ?? readMissionControllerCapacityRoutingInput,
    claimSourceMutationLease: overrides.claimSourceMutationLease ?? claimSourceMutationLease,
    readSourceMutationLease: overrides.readSourceMutationLease ?? readSourceMutationLease,
    publishWorkerAction: overrides.publishWorkerAction ?? publishNextMissionWorkerAction,
  });
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
  let sourceMutationLeaseClaim = null;
  let sourceMutationLeaseRead = null;
  let verifiedSourceMutationLeaseIdentity = null;
  let workerDispatchResult = null;
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
      && hasOnlyTransitionAuthorityBlocker(projection, transitionState)
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

  let result = reconcileDurableFlywheelController(projection, { nowUtc, sourceRevision });
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
    const workerActionGrant = createExactWorkerActionGrant(projection, sourceRevision, capacityRouting);
    if (!workerActionGrant) {
      result = holdResult('mission-worker:exact-action-grant-unavailable', {
        observedAtUtc: nowUtc,
        sourceRevision,
        activeLane: projection.lane,
      });
    } else {
      workerDispatchResult = await publishExactWorkerAction(deps, workerActionGrant, serviceOptions);
      result = withWorkerDispatch(result, workerActionGrant, workerDispatchResult);
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
        const workerActionGrant = createExactWorkerActionGrant(grantProjection, sourceRevision, capacityRouting);
        if (!workerActionGrant) {
          result = holdResult('mission-worker:exact-action-grant-unavailable', {
            observedAtUtc: nowUtc,
            sourceRevision,
          });
        } else {
          const leasePlan = sourceMutationLeasePlan(
            workerActionGrant,
            nowUtc,
            [`receipts/${missionAdmissionReceipt.receiptId}.json`],
          );
          if (leasePlan.required && !leasePlan.complete) {
            result = holdResult('source-mutation-lease:grant-identity-incomplete', {
              observedAtUtc: nowUtc,
              sourceRevision,
            });
          } else if (leasePlan.required) {
            sourceMutationLeaseClaim = await requiredFunction(
              deps.claimSourceMutationLease,
              'claimSourceMutationLease',
            )(leasePlan.claimInput, serviceOptions);
            if (sourceMutationLeaseClaim?.ok !== true) {
              result = holdResult(`source-mutation-lease:${text(
                sourceMutationLeaseClaim?.reason,
                'claim-failed',
              )}`, {
                observedAtUtc: nowUtc,
                sourceRevision,
              });
            } else {
              sourceMutationLeaseRead = await requiredFunction(
                deps.readSourceMutationLease,
                'readSourceMutationLease',
              )(serviceOptions);
              if (!exactActiveSourceMutationLease(sourceMutationLeaseRead, leasePlan.expected)) {
                result = holdResult('source-mutation-lease:canonical-reread-mismatch', {
                  observedAtUtc: nowUtc,
                  sourceRevision,
                });
              } else {
                verifiedSourceMutationLeaseIdentity = leasePlan.expected;
                workerDispatchResult = await publishExactWorkerAction(
                  deps,
                  workerActionGrant,
                  serviceOptions,
                );
                result = withWorkerDispatch(freeze({
                  ...result,
                  action: 'LEASE_CANONICAL_CONVEYOR_MISSION',
                  allowWorkerTick: true,
                  nextAction: actionResult.createdMission
                    ? 'The controller published the newly created lease-bound mission; the supervised worker tick remains an idempotent fallback.'
                    : 'The controller published the lease-bound conveyor mission; the supervised worker tick remains an idempotent fallback.',
                }), workerActionGrant, workerDispatchResult);
              }
            }
          } else {
            workerDispatchResult = await publishExactWorkerAction(
              deps,
              workerActionGrant,
              serviceOptions,
            );
            result = withWorkerDispatch(freeze({
              ...result,
              allowWorkerTick: true,
              nextAction: actionResult.createdMission
                ? 'The controller published the newly created canonical mission; the supervised worker tick remains an idempotent fallback.'
                : 'The controller published the conveyor-authorized mission; the supervised worker tick remains an idempotent fallback.',
            }), workerActionGrant, workerDispatchResult);
          }
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
  const leasedReadyLaneId = text(verifiedSourceMutationLeaseIdentity?.laneId);
  const finalState = result.status === 'HOLD'
    ? 'HOLD'
    : result.status === 'ACTIVE' || leasedReadyLaneId
      ? 'ACTIVE_LANE'
      : 'IDLE';
  const finalHeartbeat = await publishHeartbeat(heartbeatInput({
    state: finalState,
    sourceRevision,
    activeLaneId: finalState === 'ACTIVE_LANE'
      ? text(projection?.lane?.laneId, leasedReadyLaneId)
      : '',
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
    sourceMutationLeaseClaim,
    sourceMutationLeaseRead,
    verifiedSourceMutationLeaseIdentity,
    workerDispatchResult,
    cycleReceipt: receipt,
    receiptPublication,
    heartbeatPublication: finalHeartbeat,
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
    `Worker-Action-Published: ${result.workerActionDispatchPublished === true}`,
    'Chat-Memory-Authoritative: false',
    'Creates-Replacement-Machinery: false',
    'Merge-Authority: false',
    'Lease-Seizure-Allowed: false',
    `Next-Action: ${text(result.nextAction, 'none')}`,
    `Blockers: ${list(result.blockers).length ? result.blockers.join(', ') : 'none'}`,
  ].join('\n');
}
