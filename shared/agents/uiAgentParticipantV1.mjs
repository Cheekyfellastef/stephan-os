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
const UI_AGENT_READ_ONLY_MODE = 'read_first';
const UI_AGENT_PROPOSAL_PATH = 'shared-workspace/ui/proposals';
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const UI_AGENT_CAPABILITY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'agentId',
  'timestampUtc',
  'mode',
  'boundedWritePath',
  'trustedBuilder',
  'mergeAuthority',
  'arbitraryShellAllowed',
  'proofRefs',
  'participantSchemaVersion',
  'agentClass',
  'qaCapability',
  'knowledgeDomains',
  'acceptedTaskTypes',
  'lifecycleState',
  'mutationAuthority',
  'implementationAuthority',
  'productAuthority',
  'deploymentAuthority',
  'personalDataAuthority',
  'selfPromotionAllowed',
]);

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

function sameStringSet(value, expected) {
  const actual = list(value);
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((item) => actual.includes(item));
}

function capabilityShapeBlockers(capability) {
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return ['capability-record-not-object'];
  const blockers = [];
  for (const key of Reflect.ownKeys(capability)) {
    if (typeof key !== 'string') blockers.push('capability-symbol-field-forbidden');
    else if (!UI_AGENT_CAPABILITY_KEYS.has(key)) blockers.push(`capability-unknown-field:${key}`);
  }
  return blockers;
}

function timestampFutureDated(timestampUtc, validationOptions = {}) {
  const observedMs = Date.parse(text(timestampUtc));
  if (!Number.isFinite(observedMs)) return false;
  const nowMs = Number.isFinite(validationOptions.nowMs) ? validationOptions.nowMs : Date.now();
  const maxFutureSkewMs = Number.isFinite(validationOptions.maxFutureSkewMs) && validationOptions.maxFutureSkewMs >= 0
    ? validationOptions.maxFutureSkewMs
    : DEFAULT_MAX_FUTURE_SKEW_MS;
  return observedMs > nowMs + maxFutureSkewMs;
}

function statusTimestampFutureDated(timestampUtc, validationOptions = {}) {
  const observedMs = Date.parse(text(timestampUtc));
  if (!Number.isFinite(observedMs)) return false;
  const nowMs = Number.isFinite(validationOptions.nowMs) ? validationOptions.nowMs : Date.now();
  return observedMs > nowMs;
}

function capabilityFutureDated(capability, validationOptions = {}) {
  return timestampFutureDated(capability?.timestampUtc, validationOptions);
}

export function createUiAgentCapabilityRecord(input = {}) {
  const base = createAgentCapabilityRecord({
    agentId: UI_AGENT_ID,
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    mode: UI_AGENT_READ_ONLY_MODE,
    boundedWritePath: UI_AGENT_PROPOSAL_PATH,
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
  const validationOptions = input.validationOptions || {};
  const validation = validateSharedWorkspaceRecord(capability, validationOptions);
  const blockers = [...capabilityShapeBlockers(capability)];

  if (!validation.valid) blockers.push(`capability-invalid:${validation.refusalReason || 'unknown'}`);
  if (validation.stale === true) blockers.push('capability-stale');
  if (capabilityFutureDated(capability, validationOptions)) blockers.push('capability-future-dated');
  if (capability.agentId !== UI_AGENT_ID) blockers.push('participant-id-mismatch');
  if (capability.participantSchemaVersion !== UI_AGENT_PARTICIPANT_SCHEMA_VERSION) blockers.push('participant-schema-version-mismatch');
  if (capability.agentClass !== UI_AGENT_CLASS) blockers.push('agent-class-mismatch');
  if (capability.qaCapability !== UI_AGENT_QA_CAPABILITY) blockers.push('qa-capability-missing');
  if (!sameStringSet(capability.knowledgeDomains, UI_AGENT_KNOWLEDGE_DOMAINS)) blockers.push('knowledge-domains-mismatch');
  if (!sameStringSet(capability.acceptedTaskTypes, UI_AGENT_ADVISORY_TASK_TYPES)) blockers.push('advisory-task-set-mismatch');
  if (capability.lifecycleState !== 'READ_ONLY_CANDIDATE') blockers.push('unexpected-lifecycle-state');
  if (capability.mode !== UI_AGENT_READ_ONLY_MODE) blockers.push('mode-not-read-first');
  if (capability.boundedWritePath !== UI_AGENT_PROPOSAL_PATH) blockers.push('proposal-path-mismatch');
  if (capability.trustedBuilder !== false) blockers.push('trusted-builder-widened');
  if (capability.mergeAuthority !== false) blockers.push('merge-authority-widened');
  if (capability.arbitraryShellAllowed !== false) blockers.push('arbitrary-shell-widened');
  if (capability.mutationAuthority !== 'NONE_BY_PARTICIPATION') blockers.push('mutation-authority-widened');
  if (capability.implementationAuthority !== 'GOVERNED_TASK_CONTRACT_REQUIRED') blockers.push('implementation-authority-widened');
  if (capability.productAuthority !== false) blockers.push('product-authority-widened');
  if (capability.deploymentAuthority !== false) blockers.push('deployment-authority-widened');
  if (capability.personalDataAuthority !== false) blockers.push('personal-data-authority-widened');
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
  const capability = input.capability || createUiAgentCapabilityRecord({ ...input, timestampUtc, proofRefs });
  const readiness = buildUiAgentReadiness({ ...input, capability, timestampUtc, proofRefs });
  const statusTimestampFuture = statusTimestampFutureDated(timestampUtc, input.validationOptions || {});
  const statusReady = readiness.readyForSharedWorkspaceRegistration && !statusTimestampFuture;
  const nextMilestone = statusReady
    ? readiness.nextMilestone
    : 'M1_REPAIR_UI_AGENT_PARTICIPANT_CONTRACT';

  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS,
    participantStatusId: safeId(input.participantStatusId, 'ui-agent-participant-v1'),
    participantId: UI_AGENT_ID,
    timestampUtc,
    correlationId,
    relatedIssue: '#1722',
    status: statusReady
      ? 'UI_AGENT_READ_ONLY_CANDIDATE_READY'
      : 'UI_AGENT_PARTICIPANT_BLOCKED',
    summary: statusReady
      ? 'UI Agent capability card and Shared Workspace participant contract are ready for governed registration.'
      : statusTimestampFuture
        ? 'UI Agent participant status timestamp is future-dated relative to the trusted evaluation clock.'
        : 'UI Agent participant contract requires repair before registration.',
    body: JSON.stringify({
      participantSchemaVersion: UI_AGENT_PARTICIPANT_SCHEMA_VERSION,
      agentClass: UI_AGENT_CLASS,
      qaCapability: readiness.qaCapability,
      lifecycleState: readiness.lifecycleState,
      productionEligible: readiness.productionEligible,
      implementationEligible: readiness.implementationEligible,
      nextMilestone,
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
  const status = createUiAgentParticipantStatusRecord({ ...input, capability, timestampUtc, proofRefs });

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
