import { createPlatformLoopSnapshot } from './platformLoopIntegration.mjs';

export const MISSION_ORCHESTRATOR_SCHEMA_VERSION = 'mission-orchestrator.v1';

export const MISSION_ORCHESTRATOR_STATUS = Object.freeze({
  ACCEPT_INTENT: 'ACCEPT_INTENT',
  BUILDING: 'BUILDING',
  WAITING_FOR_PROOF: 'WAITING_FOR_PROOF',
  WAITING_FOR_OPERATOR_APPROVAL: 'WAITING_FOR_OPERATOR_APPROVAL',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
  DONE: 'DONE',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function hasIntent(input = {}) {
  return Boolean(text(input.operatorIntent) || text(input.missionTitle));
}

function missionIdFrom(title) {
  return `mission-${text(title, 'untitled').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
}

function mapLoopStatus(status) {
  if (status === 'DONE') return MISSION_ORCHESTRATOR_STATUS.DONE;
  if (status === 'WAITING_FOR_OPERATOR_APPROVAL') return MISSION_ORCHESTRATOR_STATUS.WAITING_FOR_OPERATOR_APPROVAL;
  if (status === 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION') return MISSION_ORCHESTRATOR_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION;
  if (status === 'WAITING_FOR_PROOF') return MISSION_ORCHESTRATOR_STATUS.WAITING_FOR_PROOF;
  return MISSION_ORCHESTRATOR_STATUS.BUILDING;
}

export function buildMissionOrchestratorContract() {
  return {
    schemaVersion: MISSION_ORCHESTRATOR_SCHEMA_VERSION,
    contractKind: 'stephanos.mission_orchestrator.contract',
    statuses: Object.values(MISSION_ORCHESTRATOR_STATUS),
    finalVerdict: 'MISSION_ORCHESTRATOR_CONTRACT_READY',
  };
}

export function createMissionOrchestrationSnapshot(input = {}) {
  const operatorIntent = text(input.operatorIntent);
  const missionTitle = text(input.missionTitle, 'Untitled mission');
  const platformLoop = createPlatformLoopSnapshot({ ...input, goalId: input.goalId || '#1307' });
  const status = hasIntent(input) ? mapLoopStatus(platformLoop.status) : MISSION_ORCHESTRATOR_STATUS.ACCEPT_INTENT;
  const nextAction = status === MISSION_ORCHESTRATOR_STATUS.ACCEPT_INTENT
    ? 'Capture operator intent and create the active mission.'
    : status === MISSION_ORCHESTRATOR_STATUS.DONE
      ? 'Mark mission done or select the next mission.'
      : platformLoop.nextAction;

  return {
    schemaVersion: MISSION_ORCHESTRATOR_SCHEMA_VERSION,
    kind: 'stephanos.mission_orchestrator.snapshot',
    missionId: text(input.missionId, missionIdFrom(missionTitle)),
    missionTitle,
    operatorIntent,
    status,
    platformLoop,
    nextAction,
    approvalGated: true,
    mutationAllowed: false,
    mergeAllowedWithoutExactApproval: false,
    finalVerdict: status === MISSION_ORCHESTRATOR_STATUS.DONE
      ? 'MISSION_ORCHESTRATOR_DONE'
      : status === MISSION_ORCHESTRATOR_STATUS.ACCEPT_INTENT
        ? 'MISSION_ORCHESTRATOR_WAITING_FOR_INTENT'
        : 'MISSION_ORCHESTRATOR_ACTIVE',
  };
}

export function validateMissionOrchestrationSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schemaVersion !== MISSION_ORCHESTRATOR_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (snapshot.kind !== 'stephanos.mission_orchestrator.snapshot') errors.push('invalid-kind');
  if (!snapshot.missionId) errors.push('missing-mission-id');
  if (!Object.values(MISSION_ORCHESTRATOR_STATUS).includes(snapshot.status)) errors.push('invalid-status');
  if (!snapshot.platformLoop) errors.push('missing-platform-loop');
  if (snapshot.mutationAllowed === true) errors.push('mutation-must-remain-approval-gated');
  if (snapshot.mergeAllowedWithoutExactApproval === true) errors.push('merge-without-exact-approval');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'MISSION_ORCHESTRATOR_SNAPSHOT_PASS' : 'MISSION_ORCHESTRATOR_SNAPSHOT_BLOCKED',
  };
}
