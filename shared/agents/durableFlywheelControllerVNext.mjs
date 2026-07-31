import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  finalizeTerminalImplementationLane,
  publishProgrammeControllerHeartbeat,
  readAuthoritativeProgrammeProjection,
  resolveProgrammeAuthorityPaths,
} from '../../stephanos-server/services/programmeAuthorityService.js';
import {
  ensureCriticalBacklogMission,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';

export const DURABLE_FLYWHEEL_CONTROLLER_SCHEMA = 'stephanos.durable-flywheel-controller.vnext';
export const DURABLE_FLYWHEEL_CYCLE_RECEIPT_SCHEMA = 'stephanos.durable-flywheel-cycle-receipt.vnext';
export const DURABLE_FLYWHEEL_CONTROLLER_ID = 'durable-flywheel-controller';
export const DURABLE_FLYWHEEL_CONTROLLER_ISSUE = 1497;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const KNOWN_PROJECTION_STATES = new Set([
  'HOLD',
  'TERMINAL_RECONCILIATION_REQUIRED',
  'ACTIVE',
  'READY',
  'IDLE',
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

function createCycleReceipt(result, projection, nowUtc) {
  const identity = result.laneIdentity ?? projectionIdentity(projection);
  const id = receiptId(nowUtc);
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
    chatMemoryAuthoritative: false,
    createsReplacementMachinery: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
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
  cycleReceiptId,
  boundedMutationSteps = 0,
}) {
  return freeze({
    controllerId: DURABLE_FLYWHEEL_CONTROLLER_ID,
    sourceRevision,
    cycleState: state,
    activeLaneId,
    lastSuccessfulReconciliationUtc: nowUtc,
    lastPublishedReceiptId: cycleReceiptId,
    timestampUtc: nowUtc,
    boundedMutationSteps,
    proofRefs: [`receipts/${cycleReceiptId}.json`],
  });
}

function productionMachinery(overrides = {}) {
  return freeze({
    publishControllerHeartbeat: overrides.publishControllerHeartbeat ?? publishProgrammeControllerHeartbeat,
    loadAuthoritativeProjection: overrides.loadAuthoritativeProjection ?? readAuthoritativeProgrammeProjection,
    finalizeTerminalLane: overrides.finalizeTerminalLane ?? finalizeTerminalImplementationLane,
    ensureBacklogMission: overrides.ensureBacklogMission ?? ensureCriticalBacklogMission,
    publishReceipt: overrides.publishReceipt ?? publishDurableFlywheelCycleReceipt,
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
    state: 'RECONCILING',
    sourceRevision,
    nowUtc,
    cycleReceiptId,
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
  let projection = await loadProjection(serviceOptions);
  if (projection?.lane?.active === true) {
    const activeHeartbeat = await publishHeartbeat(heartbeatInput({
      state: 'ACTIVE_LANE',
      sourceRevision,
      activeLaneId: projection.lane.laneId,
      nowUtc,
      cycleReceiptId,
      boundedMutationSteps: 1,
    }), serviceOptions);
    if (activeHeartbeat?.ok !== true) {
      const result = holdResult(`controller-heartbeat:${text(activeHeartbeat?.reason, 'active-lane-publication-failed')}`, {
        observedAtUtc: nowUtc,
        sourceRevision,
        activeLane: projection.lane,
      });
      const receipt = createCycleReceipt(result, projection, nowUtc);
      const publication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
      return freeze({ ...result, heartbeatPublication: activeHeartbeat, cycleReceipt: receipt, receiptPublication: publication });
    }
    projection = await loadProjection(serviceOptions);
  }

  let result = reconcileDurableFlywheelController(projection, { nowUtc, sourceRevision });
  let actionResult = null;
  if (result.status === 'TERMINAL_RECONCILIATION_REQUIRED') {
    const identity = result.laneIdentity;
    const finalizingHeartbeat = await publishHeartbeat(heartbeatInput({
      state: 'FINALIZING',
      sourceRevision,
      activeLaneId: identity.laneId,
      nowUtc,
      cycleReceiptId,
      boundedMutationSteps: 1,
    }), serviceOptions);
    if (finalizingHeartbeat?.ok !== true) {
      result = holdResult(`controller-heartbeat:${text(finalizingHeartbeat?.reason, 'finalizing-publication-failed')}`, {
        observedAtUtc: nowUtc,
        sourceRevision,
        activeLane: projection.lane,
      });
    } else {
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
    }
  } else if (result.status === 'READY') {
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
      result = freeze({
        ...result,
        allowWorkerTick: true,
        nextAction: actionResult.createdMission
          ? 'Allow the existing Mission Worker to process the newly created canonical mission.'
          : 'Allow the existing Mission Worker to continue the conveyor-authorized mission.',
      });
    }
  }

  const receipt = createCycleReceipt(result, projection, nowUtc);
  const receiptPublication = await requiredFunction(deps.publishReceipt, 'publishReceipt')(receipt, serviceOptions);
  if (receiptPublication?.ok !== true) {
    result = holdResult(`cycle-receipt:${text(receiptPublication?.reason, 'publication-failed')}`, {
      observedAtUtc: nowUtc,
      sourceRevision,
      activeLane: projection?.lane,
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
    'Chat-Memory-Authoritative: false',
    'Creates-Replacement-Machinery: false',
    'Merge-Authority: false',
    'Lease-Seizure-Allowed: false',
    `Next-Action: ${text(result.nextAction, 'none')}`,
    `Blockers: ${list(result.blockers).length ? result.blockers.join(', ') : 'none'}`,
  ].join('\n');
}
