export const ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-closed-chat-cutover-shadow.v1';

export const ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1 = Object.freeze([
  'CLOSED_CHAT_RECOVERY',
  'BLOCKED_LANE_ISOLATION',
  'FLEET_CONTROL_PROPAGATION',
  'ROLLBACK_READINESS',
]);

const SHA40 = /^[0-9a-f]{40}$/;
const HASH64 = /^[0-9a-f]{64}$/;

const ZERO_AUTHORITY = Object.freeze({
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  controllerAuthorityTransferAllowed: false,
  fiveLaneCutoverAllowed: false,
  rollbackExecutionAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
});

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function controllerIdentity(value = {}) {
  return Object.freeze({
    controllerId: text(value.controllerId, 120),
    sourceHead: text(value.sourceHead, 40).toLowerCase(),
    leaseId: text(value.leaseId, 160),
    state: text(value.state, 40).toUpperCase(),
  });
}

function safeHold({ currentController, candidate, reasons }) {
  const controller = controllerIdentity(currentController);
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SAFE_HOLD',
    currentController: controller,
    currentControllerRemainsCanonical: true,
    candidateFabricId: text(candidate?.fabricId, 120),
    candidateSourceHead: text(candidate?.sourceHead, 40).toLowerCase(),
    closedChatRecoveryShadowProven: false,
    rollbackShadowProven: false,
    cutoverEligibleInShadow: false,
    rollbackTarget: controller,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasons)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_SAFE_HOLD',
  });
}

function validateCurrentController(currentController, sourceHead) {
  const controller = controllerIdentity(currentController);
  if (!controller.controllerId || !controller.leaseId) return 'CURRENT_CONTROLLER_IDENTITY_INCOMPLETE';
  if (!SHA40.test(controller.sourceHead) || controller.sourceHead !== sourceHead) {
    return 'CURRENT_CONTROLLER_NOT_EXACT_SOURCE';
  }
  if (!['RUNNING', 'ACTIVE'].includes(controller.state)) return 'CURRENT_CONTROLLER_NOT_ACTIVE';
  return '';
}

function validateCandidate(candidate, sourceHead) {
  if (!text(candidate?.fabricId, 120) || !text(candidate?.checkpointId, 160)) {
    return 'CANDIDATE_CHECKPOINT_IDENTITY_INCOMPLETE';
  }
  if (text(candidate?.sourceHead, 40).toLowerCase() !== sourceHead) return 'CANDIDATE_NOT_EXACT_SOURCE';
  if (!HASH64.test(text(candidate?.checkpointSha256, 64).toLowerCase())) {
    return 'CANDIDATE_CHECKPOINT_DIGEST_INVALID';
  }
  const lanes = Array.isArray(candidate?.lanes) ? candidate.lanes : [];
  if (lanes.length < 5) return 'FIVE_LANE_MINIMUM_NOT_PROVEN';
  const laneIds = new Set();
  const writerByResource = new Map();
  for (const lane of lanes) {
    const laneId = text(lane?.laneId, 100);
    const resourceId = text(lane?.resourceId, 180);
    const writer = text(lane?.writerLeaseOwner, 140);
    if (!laneId || !resourceId) return 'LANE_IDENTITY_INCOMPLETE';
    if (laneIds.has(laneId)) return 'DUPLICATE_LANE_ID';
    laneIds.add(laneId);
    if (!writer) continue;
    const existing = writerByResource.get(resourceId);
    if (existing && existing !== writer) return 'MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE';
    writerByResource.set(resourceId, writer);
  }
  return '';
}

function validateRollback(rollback, currentController, sourceHead) {
  if (text(rollback?.controllerId, 120) !== text(currentController?.controllerId, 120)) {
    return 'ROLLBACK_CONTROLLER_IDENTITY_MISMATCH';
  }
  if (text(rollback?.sourceHead, 40).toLowerCase() !== sourceHead) return 'ROLLBACK_SOURCE_HEAD_MISMATCH';
  if (text(rollback?.leaseId, 160) !== text(currentController?.leaseId, 160)) {
    return 'ROLLBACK_LEASE_IDENTITY_MISMATCH';
  }
  return '';
}

function validateProofs(proofs, sourceHead, candidate) {
  if (!Array.isArray(proofs)) return 'CLOSED_CHAT_PROOF_SET_MISSING';
  const byType = new Map();
  for (const proof of proofs) {
    const proofType = text(proof?.proofType, 80).toUpperCase();
    if (!ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1.includes(proofType)) continue;
    if (byType.has(proofType)) return `DUPLICATE_${proofType}_PROOF`;
    byType.set(proofType, proof);
  }
  for (const proofType of ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1) {
    const proof = byType.get(proofType);
    if (!proof) return `MISSING_${proofType}_PROOF`;
    if (!text(proof.receiptId, 160)) return `${proofType}_RECEIPT_ID_MISSING`;
    if (text(proof.sourceHead, 40).toLowerCase() !== sourceHead) return `${proofType}_SOURCE_HEAD_MISMATCH`;
    if (text(proof.checkpointId, 160) !== text(candidate?.checkpointId, 160)) {
      return `${proofType}_CHECKPOINT_MISMATCH`;
    }
    if (proof.verified !== true || text(proof.state, 40).toUpperCase() !== 'PROVEN') {
      return `${proofType}_NOT_PROVEN`;
    }
  }
  return '';
}

export function projectElasticFiveLaneClosedChatCutoverShadowV1(input = {}) {
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const currentController = input.currentController || {};
  const candidate = input.candidate || {};
  const reasons = [];

  if (!SHA40.test(sourceHead)) reasons.push('EXACT_SOURCE_HEAD_UNPROVEN');
  if (reasons.length === 0) {
    const controllerBlocker = validateCurrentController(currentController, sourceHead);
    if (controllerBlocker) reasons.push(controllerBlocker);
    const candidateBlocker = validateCandidate(candidate, sourceHead);
    if (candidateBlocker) reasons.push(candidateBlocker);
    const rollbackBlocker = validateRollback(input.rollbackTarget || {}, currentController, sourceHead);
    if (rollbackBlocker) reasons.push(rollbackBlocker);
    const proofBlocker = validateProofs(input.proofs, sourceHead, candidate);
    if (proofBlocker) reasons.push(proofBlocker);
  }
  if (reasons.length > 0) return safeHold({ currentController, candidate, reasons });

  const controller = controllerIdentity(currentController);
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SHADOW_READY',
    sourceHead,
    currentController: controller,
    currentControllerRemainsCanonical: true,
    candidateFabricId: text(candidate.fabricId, 120),
    candidateSourceHead: sourceHead,
    candidateCheckpointId: text(candidate.checkpointId, 160),
    candidateCheckpointSha256: text(candidate.checkpointSha256, 64).toLowerCase(),
    laneCount: candidate.lanes.length,
    closedChatRecoveryShadowProven: true,
    rollbackShadowProven: true,
    cutoverEligibleInShadow: true,
    rollbackTarget: controller,
    authority: ZERO_AUTHORITY,
    requiredProofTypes: ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1,
    reasonCodes: Object.freeze([
      'CLOSED_CHAT_CHECKPOINT_RECONSTRUCTION_SHADOW_PROVEN',
      'CURRENT_NATIVE_CONTROLLER_RETENTION_SHADOW_PROVEN',
      'ROLLBACK_TARGET_IDENTITY_SHADOW_PROVEN',
      'CUTOVER_AUTHORITY_REMAINS_SEPARATE',
    ]),
    finalVerdict: 'ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_READY_NO_AUTHORITY',
  });
}
