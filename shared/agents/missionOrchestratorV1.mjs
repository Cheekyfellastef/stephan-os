import { createPlatformLoopSnapshot } from './platformLoopIntegration.mjs';

export const MISSION_ORCHESTRATOR_SCHEMA_VERSION = 'mission-orchestrator.v1';

export const MISSION_STATUS = Object.freeze({
  ACCEPT_INTENT: 'ACCEPT_INTENT',
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

const SAFE_TEXT_PATTERN = /^[a-z0-9#][a-z0-9._:/#(), -]{0,300}$/i;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeText(value, fallback = '') {
  const text = asText(value, fallback);
  return text && SAFE_TEXT_PATTERN.test(text) ? text : fallback;
}

function hasOperatorIntent(input = {}) {
  return Boolean(asText(input.operatorIntent, '') || asText(input.missionTitle, ''));
}

function mapPlatformStatusToMissionStatus(platformStatus) {
  if (Object.values(MISSION_STATUS).includes(platformStatus)) return platformStatus;
  return MISSION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
}

function determineFinalVerdict(status) {
  if (status === MISSION_STATUS.ACCEPT_INTENT) return 'MISSION_ORCHESTRATOR_WAITING_FOR_INTENT';
  if (status === MISSION_STATUS.DONE) return 'MISSION_ORCHESTRATOR_DONE';
  return 'MISSION_ORCHESTRATOR_ACTIVE';
}

export function buildMissionOrchestratorContract() {
  return {
    schemaVersion: MISSION_ORCHESTRATOR_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_orchestrator.v1.contract',
    lifecycle: Object.values(MISSION_STATUS),
    requiredSnapshotFields: [
      'schemaVersion',
      'kind',
      'missionId',
      'missionTitle',
      'operatorIntent',
      'status',
      'platformLoop',
      'approvalGate',
      'mutationAllowed',
      'mergeAllowedWithoutExactApproval',
      'nextAction',
      'finalVerdict',
    ],
    sourceOfTruth: 'shared/agents/platformLoopIntegration.mjs',
    finalVerdict: 'MISSION_ORCHESTRATOR_CONTRACT_READY',
  };
}

export function createMissionOrchestrationSnapshot(input = {}) {
  const intentPresent = hasOperatorIntent(input);
  const missionTitle = safeText(input.missionTitle, safeText(input.operatorIntent, ''));
  const operatorIntent = safeText(input.operatorIntent, missionTitle);
  const missionId = safeText(input.missionId, safeText(input.goalId, '#1307'));

  const generatedPlatformLoop = createPlatformLoopSnapshot({
    ...input.platformLoopInput,
    goalId: safeText(input.goalId, missionId),
  });
  const platformLoop = input.platformLoopSnapshot
    ? { ...generatedPlatformLoop, ...input.platformLoopSnapshot }
    : generatedPlatformLoop;

  const exactOperatorApproval = input.exactOperatorApproval === true;
  const mutationAllowed = exactOperatorApproval && input.mutationRequested === true;
  const mergeAllowedWithoutExactApproval = input.mergeAllowedWithoutExactApproval === true;
  const status = intentPresent ? mapPlatformStatusToMissionStatus(platformLoop.status) : MISSION_STATUS.ACCEPT_INTENT;
  const approvalGate = {
    exactOperatorApproval,
    mutationAllowed,
    mergeAllowedWithoutExactApproval,
    mergeBlocked: !exactOperatorApproval,
    reason: exactOperatorApproval
      ? 'Exact operator approval is present for gated mutation.'
      : 'Merge is blocked until exact operator approval is recorded.',
  };
  const nextAction = status === MISSION_STATUS.ACCEPT_INTENT
    ? 'Capture operator intent or mission title before starting orchestration.'
    : !exactOperatorApproval
      ? 'Record exact operator approval before merge or mutation.'
      : platformLoop.nextAction;

  return {
    schemaVersion: MISSION_ORCHESTRATOR_SCHEMA_VERSION,
    kind: 'stephanos.mission_orchestrator.v1.snapshot',
    missionId,
    missionTitle,
    operatorIntent,
    status,
    platformLoop,
    approvalGate,
    mutationAllowed,
    mergeAllowedWithoutExactApproval,
    nextAction,
    finalVerdict: determineFinalVerdict(status),
  };
}

export function validateMissionOrchestrationSnapshot(snapshot = {}) {
  const errors = [];
  const requiredFields = buildMissionOrchestratorContract().requiredSnapshotFields;

  for (const field of requiredFields) {
    if (!(field in snapshot)) errors.push(`Missing required field: ${field}`);
  }

  if (!Object.values(MISSION_STATUS).includes(snapshot.status)) errors.push(`Unsupported mission status: ${snapshot.status}`);
  if (snapshot.mutationAllowed === true) errors.push('mutationAllowed must remain false without a downstream exact approval executor.');
  if (snapshot.mergeAllowedWithoutExactApproval === true) errors.push('mergeAllowedWithoutExactApproval must remain false.');
  if (snapshot.approvalGate?.mergeBlocked === false && snapshot.approvalGate?.exactOperatorApproval !== true) {
    errors.push('approvalGate cannot unblock merge without exactOperatorApproval true.');
  }
  if (snapshot.status === MISSION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION && !asText(snapshot.nextAction, '')) {
    errors.push('Blocked mission snapshots must include an exact nextAction.');
  }

  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0
      ? 'MISSION_ORCHESTRATOR_SNAPSHOT_VALID'
      : 'MISSION_ORCHESTRATOR_SNAPSHOT_INVALID',
  };
}
