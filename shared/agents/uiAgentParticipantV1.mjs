import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createAgentCapabilityRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const UI_AGENT_PARTICIPANT_SCHEMA_VERSION = 'stephanos.ui-agent-participant.v1';
export const UI_AGENT_ID = 'user-interface-agent';
export const UI_AGENT_CLASS = 'USER_INTERFACE_AND_EXPERIENCE_SPECIALIST';
export const UI_AGENT_QA_CAPABILITY = 'CAN_ASK_AND_ANSWER';

export const UI_AGENT_KNOWLEDGE_DOMAINS = Object.freeze([
  'ui',
  'ux',
  'visual-language',
  'interaction-design',
  'responsive-design',
  'accessibility',
  'motion',
  'spatial-ui',
]);

export const UI_AGENT_ADVISORY_TASK_TYPES = Object.freeze([
  'UI_RESEARCH',
  'UI_AUDIT',
  'UI_DESIGN',
  'UI_REVIEW',
  'EXPERIENCE_PROOF_PLANNING',
]);

export const UI_AGENT_LIFECYCLE_STATES = Object.freeze([
  'DISCOVERED',
  'READ_ONLY_CANDIDATE',
  'EVALUATED',
  'ADVISORY_TRUSTED',
  'BOUNDED_EXECUTOR',
  'PRODUCTION_ELIGIBLE',
  'SUSPENDED_OR_REVOKED',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function safeId(value, fallback = '') {
  const output = text(value);
  return SAFE_ID.test(output) ? output : fallback;
}

export function createUiAgentCapabilityRecord(input = {}) {
  const base = createAgentCapabilityRecord({
    agentId: UI_AGENT_ID,
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    mode: 'read_first',
    boundedWritePath: 'shared-workspace/ui/proposals',
    trustedBuilder: false,
    proofRefs: list(input.proofRefs),
  });

  return Object.freeze({
    ...base,
    participantSchemaVersion: UI_AGENT_PARTICIPANT_SCHEMA_VERSION,
    agentClass: UI_AGENT_CLASS,
    qaCapability: UI_AGENT_QA_CAPABILITY,
    knowledgeDomains: UI_AGENT_KNOWLEDGE_DOMAINS,
    acceptedTaskTypes: UI_AGENT_ADVISORY_TASK_TYPES,
    lifecycleState: 'READ_ONLY_CANDIDATE',
    mutationAuthority: 'NONE_BY_PARTICIPATION',
    implementationAuthority: 'GOVERNED_TASK_CONTRACT_REQUIRED',
    productAuthority: false,
    deploymentAuthority: false,
    personalDataAuthority: false,
    selfPromotionAllowed: false,
  });
}

export function buildUiAgentReadiness(input = {}) {
  const capability = input.capability || createUiAgentCapabilityRecord(input);
  const validation = validateSharedWorkspaceRecord(capability, input.validationOptions);
  const blockers = [];

  if (!validation.valid) blockers.push(`capability-invalid:${validation.refusalReason || 'unknown'}`);
  if (capability.agentId !== UI_AGENT_ID) blockers.push('participant-id-mismatch');
  if (capability.qaCapability !== UI_AGENT_QA_CAPABILITY) blockers.push('qa-capability-missing');
  if (capability.lifecycleState !== 'READ_ONLY_CANDIDATE') blockers.push('unexpected-lifecycle-state');
  if (capability.mergeAuthority === true || capability.arbitraryShellAllowed === true) blockers.push('unsafe-authority');
  if (capability.mutationAuthority !== 'NONE_BY_PARTICIPATION') blockers.push('mutation-authority-widened');
  if (capability.selfPromotionAllowed !== false) blockers.push('self-promotion-widened');

  return Object.freeze({
    schemaVersion: UI_AGENT_PARTICIPANT_SCHEMA_VERSION,
    participantId: UI_AGENT_ID,
    lifecycleState: capability.lifecycleState,
    qaCapability: capability.qaCapability,
    readyForSharedWorkspaceRegistration: blockers.length === 0,
    productionEligible: false,
    implementationEligible: false,
    blockers: Object.freeze(blockers),
    nextMilestone: blockers.length === 0
      ? 'M2_INVENTORY_USER_FACING_SURFACES_AND_SHARED_VISUAL_PRIMITIVES'
      : 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT',
  });
}

export function createUiAgentParticipantStatusRecord(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const correlationId = safeId(input.correlationId, 'ui-agent-participant-v1');
  const proofRefs = list(input.proofRefs).length > 0
    ? list(input.proofRefs)
    : ['evidence/receipts/ui-agent-participant-v1'];
  const readiness = input.readiness || buildUiAgentReadiness({ ...input, timestampUtc, proofRefs });

  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS,
    participantStatusId: safeId(input.participantStatusId, 'ui-agent-participant-v1'),
    participantId: UI_AGENT_ID,
    timestampUtc,
    correlationId,
    relatedIssue: '#1722',
    status: readiness.readyForSharedWorkspaceRegistration
      ? 'UI_AGENT_READ_ONLY_CANDIDATE_READY'
      : 'UI_AGENT_PARTICIPANT_BLOCKED',
    summary: readiness.readyForSharedWorkspaceRegistration
      ? 'UI Agent capability card and Shared Workspace participant contract are ready for governed registration.'
      : 'UI Agent participant contract requires repair before registration.',
    body: JSON.stringify({
      participantSchemaVersion: UI_AGENT_PARTICIPANT_SCHEMA_VERSION,
      agentClass: UI_AGENT_CLASS,
      qaCapability: readiness.qaCapability,
      lifecycleState: readiness.lifecycleState,
      productionEligible: readiness.productionEligible,
      implementationEligible: readiness.implementationEligible,
      nextMilestone: readiness.nextMilestone,
      mutationAuthority: 'NONE_BY_PARTICIPATION',
      mergeAuthority: false,
      deploymentAuthority: false,
    }),
    proofRefs,
  });
}

export function createUiAgentWorkspaceRecords(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const proofRefs = list(input.proofRefs).length > 0
    ? list(input.proofRefs)
    : ['evidence/receipts/ui-agent-participant-v1'];
  const capability = createUiAgentCapabilityRecord({ ...input, timestampUtc, proofRefs });
  const readiness = buildUiAgentReadiness({ ...input, capability, timestampUtc, proofRefs });
  const status = createUiAgentParticipantStatusRecord({ ...input, readiness, timestampUtc, proofRefs });

  return Object.freeze({
    schemaVersion: UI_AGENT_PARTICIPANT_SCHEMA_VERSION,
    capability,
    status,
    readiness,
    validations: Object.freeze({
      capability: validateSharedWorkspaceRecord(capability, input.validationOptions),
      status: validateSharedWorkspaceRecord(status, input.validationOptions),
    }),
  });
}
