export const UNATTENDED_READINESS_SCHEMA_VERSION = 'stephanos.unattended-readiness.v1';

export const UNATTENDED_READINESS_STATE = Object.freeze({
  READY: 'UNATTENDED_READY',
  DEGRADED: 'UNATTENDED_DEGRADED',
  NOT_READY: 'UNATTENDED_NOT_READY',
  SAFE_HOLD: 'SAFE_HOLD',
});

export const UNATTENDED_REQUIRED_PROOFS = Object.freeze([
  'SCHEDULER_CONTINUITY',
  'QUEUE_LEASE_INTEGRITY',
  'QUALIFIED_EXECUTION_CAPACITY',
  'PROOF_ROUTE',
  'INDEPENDENT_REVIEW_ROUTE',
  'DURABLE_RESUME_CHECKPOINT',
  'NATIVE_GOAL_CYCLE',
  'EVENT_DRIVEN_REFILL',
  'STALL_ORPHAN_RECOVERY',
  'PROVIDER_FAILOVER',
  'APPROVAL_LANE_ISOLATION',
  'OPERATOR_STOP_PROPAGATION',
  'BATTLE_BRIDGE_RECOVERY',
  'BATTLE_BRIDGE_CLEANLINESS',
  'OPERATOR_ATTENTION',
]);

const CORE_PROOFS = new Set([
  'SCHEDULER_CONTINUITY',
  'QUEUE_LEASE_INTEGRITY',
  'QUALIFIED_EXECUTION_CAPACITY',
  'PROOF_ROUTE',
  'INDEPENDENT_REVIEW_ROUTE',
  'DURABLE_RESUME_CHECKPOINT',
  'NATIVE_GOAL_CYCLE',
  'EVENT_DRIVEN_REFILL',
]);

const PROOF_MAX_AGE_MS = Object.freeze({
  SCHEDULER_CONTINUITY: 10 * 60 * 1000,
  QUEUE_LEASE_INTEGRITY: 10 * 60 * 1000,
  QUALIFIED_EXECUTION_CAPACITY: 15 * 60 * 1000,
  PROOF_ROUTE: 60 * 60 * 1000,
  INDEPENDENT_REVIEW_ROUTE: 60 * 60 * 1000,
  DURABLE_RESUME_CHECKPOINT: 30 * 60 * 1000,
  NATIVE_GOAL_CYCLE: 6 * 60 * 60 * 1000,
  EVENT_DRIVEN_REFILL: 6 * 60 * 60 * 1000,
  STALL_ORPHAN_RECOVERY: 24 * 60 * 60 * 1000,
  PROVIDER_FAILOVER: 24 * 60 * 60 * 1000,
  APPROVAL_LANE_ISOLATION: 24 * 60 * 60 * 1000,
  OPERATOR_STOP_PROPAGATION: 24 * 60 * 60 * 1000,
  BATTLE_BRIDGE_RECOVERY: 15 * 60 * 1000,
  BATTLE_BRIDGE_CLEANLINESS: 15 * 60 * 1000,
  OPERATOR_ATTENTION: 60 * 60 * 1000,
});

const SHA40 = /^[0-9a-f]{40}$/;
const ACTIVE_CONTROLLER_STATES = new Set(['RUNNING', 'ACTIVE']);
const ZERO_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  controllerMutationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  credentialMutationAllowed: false,
  spendingAllowed: false,
  leaseSeizureAllowed: false,
});

function text(value, limit = 240) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeController(controller = {}) {
  return Object.freeze({
    controllerId: text(controller.controllerId, 120),
    controlState: text(controller.controlState, 40).toUpperCase(),
    unattendedState: text(controller.unattendedState, 40).toUpperCase(),
    sourceHead: text(controller.sourceHead, 40).toLowerCase(),
    heartbeatAtUtc: text(controller.heartbeatAtUtc, 80),
    requiredForReadiness: controller.requiredForReadiness !== false,
    resourceIds: Object.freeze(
      Array.isArray(controller.resourceIds)
        ? unique(controller.resourceIds.map((item) => text(item, 180)).filter(Boolean)).sort()
        : [],
    ),
  });
}

function proofVerdict(proof, proofType, sourceHead, nowMs) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return 'MISSING';
  if (!text(proof.receiptId, 180)) return 'RECEIPT_MISSING';
  if (text(proof.state, 40).toUpperCase() !== 'PROVEN' || proof.verified !== true) return 'NOT_PROVEN';
  if (text(proof.sourceHead, 40).toLowerCase() !== sourceHead) return 'SOURCE_HEAD_MISMATCH';
  const observedMs = timestampMs(proof.observedAtUtc);
  if (!Number.isFinite(observedMs)) return 'TIMESTAMP_INVALID';
  if (observedMs > nowMs + 30 * 1000) return 'TIMESTAMP_FUTURE';
  if (nowMs - observedMs > PROOF_MAX_AGE_MS[proofType]) return 'STALE';
  return 'CURRENT';
}

function stateResult(state, sourceHead, controllers, blockers, proofStatus, reasonCodes, exactNextAction) {
  return Object.freeze({
    schemaVersion: UNATTENDED_READINESS_SCHEMA_VERSION,
    state,
    sourceHead,
    controllers: Object.freeze(controllers),
    proofStatus: Object.freeze({ ...proofStatus }),
    blockers: Object.freeze(blockers),
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(unique(reasonCodes)),
    exactNextAction,
    finalVerdict: state,
  });
}

export function projectUnattendedReadinessV1(input = {}) {
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const controllers = (Array.isArray(input.controllers) ? input.controllers : []).map(normalizeController);
  const proofStatus = {};
  const blockers = [];
  const reasonCodes = [];

  if (!SHA40.test(sourceHead)) {
    blockers.push('EXACT_SOURCE_HEAD_UNPROVEN');
    return stateResult(
      UNATTENDED_READINESS_STATE.NOT_READY,
      sourceHead,
      controllers,
      blockers,
      proofStatus,
      blockers,
      'Publish the exact current protected-main source head before evaluating unattended readiness.',
    );
  }

  if (input.authorityContradiction === true) blockers.push('AUTHORITY_CONTRADICTION');
  if (input.stopContainmentViolation === true) blockers.push('OPERATOR_STOP_PROPAGATION_VIOLATION');
  if (input.duplicateMutationWriter === true) blockers.push('DUPLICATE_MUTATION_WRITER');

  const operatorDesiredState = text(input.operatorDesiredState, 40).toUpperCase();
  if (operatorDesiredState !== 'RUNNING') blockers.push(
    operatorDesiredState ? 'OPERATOR_POLICY_NOT_RUNNING' : 'OPERATOR_POLICY_MISSING',
  );

  const requiredControllers = controllers.filter((controller) => controller.requiredForReadiness);
  if (requiredControllers.length === 0) blockers.push('REQUIRED_CONTROLLER_SET_MISSING');

  const controllerIds = new Set();
  const writerByResource = new Map();
  let degradedController = false;
  let notReadyController = requiredControllers.length === 0;

  // Duplicate active mutation ownership is an authority contradiction regardless
  // of whether a controller is itself required to satisfy the readiness quorum.
  for (const controller of controllers) {
    if (!controller.controllerId) {
      if (controller.requiredForReadiness) {
        notReadyController = true;
        blockers.push('CONTROLLER_IDENTITY_MISSING');
      } else if (controller.resourceIds.length > 0 && ACTIVE_CONTROLLER_STATES.has(controller.controlState)) {
        blockers.push('ACTIVE_RESOURCE_OWNER_IDENTITY_MISSING');
      }
      continue;
    }
    if (controllerIds.has(controller.controllerId)) blockers.push('DUPLICATE_CONTROLLER_ID:' + controller.controllerId);
    controllerIds.add(controller.controllerId);

    if (!ACTIVE_CONTROLLER_STATES.has(controller.controlState)) continue;
    for (const resourceId of controller.resourceIds) {
      const existing = writerByResource.get(resourceId);
      if (existing && existing !== controller.controllerId) {
        blockers.push('MULTIPLE_CONTROLLERS_FOR_RESOURCE:' + resourceId);
      } else {
        writerByResource.set(resourceId, controller.controllerId);
      }
    }
  }

  for (const controller of requiredControllers) {
    if (!controller.controllerId) continue;

    if (!ACTIVE_CONTROLLER_STATES.has(controller.controlState)) {
      notReadyController = true;
      blockers.push('CONTROLLER_NOT_ACTIVE:' + controller.controllerId);
    }
    if (controller.sourceHead !== sourceHead) {
      notReadyController = true;
      blockers.push('CONTROLLER_SOURCE_HEAD_MISMATCH:' + controller.controllerId);
    }

    const heartbeatMs = timestampMs(controller.heartbeatAtUtc);
    if (!Number.isFinite(heartbeatMs) || heartbeatMs > nowMs + 30 * 1000 || nowMs - heartbeatMs > 10 * 60 * 1000) {
      notReadyController = true;
      blockers.push('CONTROLLER_HEARTBEAT_NOT_FRESH:' + controller.controllerId);
    }

    if (controller.unattendedState === UNATTENDED_READINESS_STATE.SAFE_HOLD) {
      blockers.push('CONTROLLER_SAFE_HOLD:' + controller.controllerId);
    } else if (controller.unattendedState === UNATTENDED_READINESS_STATE.NOT_READY) {
      notReadyController = true;
      blockers.push('CONTROLLER_NOT_READY:' + controller.controllerId);
    } else if (controller.unattendedState === UNATTENDED_READINESS_STATE.DEGRADED) {
      degradedController = true;
      reasonCodes.push('CONTROLLER_EXPLICITLY_DEGRADED:' + controller.controllerId);
    } else if (controller.unattendedState !== UNATTENDED_READINESS_STATE.READY) {
      notReadyController = true;
      blockers.push('CONTROLLER_UNATTENDED_STATE_UNKNOWN:' + controller.controllerId);
    }
  }
  const safeHoldReasons = blockers.filter((item) =>
    item === 'AUTHORITY_CONTRADICTION'
    || item === 'OPERATOR_STOP_PROPAGATION_VIOLATION'
    || item === 'DUPLICATE_MUTATION_WRITER'
    || item === 'ACTIVE_RESOURCE_OWNER_IDENTITY_MISSING'
    || item.startsWith('MULTIPLE_CONTROLLERS_FOR_RESOURCE:')
    || item.startsWith('DUPLICATE_CONTROLLER_ID:')
    || item.startsWith('CONTROLLER_SAFE_HOLD:'),
  );
  if (safeHoldReasons.length > 0) {
    return stateResult(
      UNATTENDED_READINESS_STATE.SAFE_HOLD,
      sourceHead,
      controllers,
      blockers,
      proofStatus,
      safeHoldReasons,
      'Resolve the contradictory authority or duplicate ownership evidence before unattended continuation.',
    );
  }

  const proofs = Array.isArray(input.proofs) ? input.proofs : [];
  const proofByType = new Map();
  const proofTypeByReceiptId = new Map();
  for (const proof of proofs) {
    const proofType = text(proof?.proofType, 80).toUpperCase();
    if (!UNATTENDED_REQUIRED_PROOFS.includes(proofType)) continue;
    if (proofByType.has(proofType)) {
      blockers.push('DUPLICATE_PROOF:' + proofType);
      continue;
    }
    const receiptId = text(proof?.receiptId, 180);
    if (receiptId) {
      const existingProofType = proofTypeByReceiptId.get(receiptId);
      if (existingProofType && existingProofType !== proofType) {
        blockers.push('DUPLICATE_RECEIPT_ID:' + receiptId);
      } else {
        proofTypeByReceiptId.set(receiptId, proofType);
      }
    }
    proofByType.set(proofType, proof);
  }
  let coreProofMissing = false;
  let resilienceProofMissing = false;
  for (const proofType of UNATTENDED_REQUIRED_PROOFS) {
    const verdict = proofVerdict(proofByType.get(proofType), proofType, sourceHead, nowMs);
    proofStatus[proofType] = verdict;
    if (verdict !== 'CURRENT') {
      blockers.push(proofType + ':' + verdict);
      if (CORE_PROOFS.has(proofType)) coreProofMissing = true;
      else resilienceProofMissing = true;
    }
  }

  if (blockers.some((item) => item.startsWith('DUPLICATE_PROOF:') || item.startsWith('DUPLICATE_RECEIPT_ID:'))) {
    return stateResult(
      UNATTENDED_READINESS_STATE.SAFE_HOLD,
      sourceHead,
      controllers,
      blockers,
      proofStatus,
      ['DUPLICATE_READINESS_EVIDENCE'],
      'Deduplicate the readiness evidence set before continuing.',
    );
  }

  if (notReadyController
    || coreProofMissing
    || blockers.includes('OPERATOR_POLICY_NOT_RUNNING')
    || blockers.includes('OPERATOR_POLICY_MISSING')) {
    return stateResult(
      UNATTENDED_READINESS_STATE.NOT_READY,
      sourceHead,
      controllers,
      blockers,
      proofStatus,
      ['CORE_UNATTENDED_READINESS_INCOMPLETE'],
      'Repair the first missing core readiness predicate and rerun the certificate from fresh durable evidence.',
    );
  }

  if (degradedController || resilienceProofMissing) {
    return stateResult(
      UNATTENDED_READINESS_STATE.DEGRADED,
      sourceHead,
      controllers,
      blockers,
      proofStatus,
      ['CORE_CONTINUATION_AVAILABLE_BUT_RESILIENCE_INCOMPLETE', ...reasonCodes],
      'Continue safe independent work while the missing resilience proof is recovered.',
    );
  }

  return stateResult(
    UNATTENDED_READINESS_STATE.READY,
    sourceHead,
    controllers,
    [],
    proofStatus,
    [
      'ALL_REQUIRED_CONTROLLERS_FRESH_AND_READY',
      'ALL_REQUIRED_READINESS_PROOFS_CURRENT',
      'NO_DUPLICATE_MUTATION_OWNERSHIP',
      'OPERATOR_POLICY_RUNNING',
    ],
    'Continue selecting and completing eligible goals; wake the operator only for genuine authority or judgment.',
  );
}
