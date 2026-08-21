import { createHash } from 'node:crypto';

import {
  toSharedWorkspaceExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
import { createSharedWorkspaceReceiptRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
} from './openClawProviderPoolQualificationV1.mjs';

export const OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA = 'stephanos.openclaw-task-class-promotion-candidate.v1';
export const OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION = 'OPENCLAW_TASK_CLASS_PRODUCTION_ELIGIBLE_CANDIDATE';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const ISSUE_NUMBER = 1725;
const MAX_QUALIFICATION_LIFETIME_MS = 15 * 60 * 1000;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SAFE_PROVIDER_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;

const TASK_CLASS_POLICY = Object.freeze({
  OC1_REPOSITORY_SCOUT: Object.freeze({
    finalVerdict: 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED',
  }),
  OC2_DETERMINISTIC_TEST_BUILD: Object.freeze({
    finalVerdict: 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED',
  }),
});

const EVIDENCE_KEYS = Object.freeze([
  'taskClass',
  'taskId',
  'sourceHead',
  'workerId',
  'providerVersion',
  'finalVerdict',
  'proofRefs',
  'changedFiles',
  'sourceMutationPerformed',
  'selfQualificationAllowed',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) return false;
  const sorted = actual.sort();
  const wanted = [...expected].sort();
  if (sorted.length !== wanted.length) return false;
  return sorted.every((key, index) => key === wanted[index]);
}

function plainDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const snapshot = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function uniqueProofRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return null;
  const refs = value.map(text);
  if (refs.some((ref) => !SAFE_PROOF_REF.test(ref) || ref.includes('..'))) return null;
  return refs.length === new Set(refs).size ? Object.freeze(refs) : null;
}

function qualificationSummary(receipt) {
  return `Stephanos qualifies ${receipt.providerInstance} ${receipt.providerVersion} for ${receipt.taskClass} at ${receipt.sourceHead} from OpenClaw execution ${receipt.realWorkReceiptId}.`;
}

function blocked(reason) {
  return Object.freeze({
    schemaVersion: OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA,
    ok: false,
    disposition: 'BLOCKED',
    reason,
    qualificationReceipt: null,
    qualificationAuthorityReceipt: null,
    realWorkWorkspaceReceipt: null,
    providerPoolAdmissionAllowed: false,
    providerQualificationAuthority: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}

export function adjudicateOpenClawTaskClassPromotionCandidateV1(input = {}) {
  const execution = input.executionReceipt;
  const evidence = plainDataRecord(input.providerEvidence);
  const observedAtUtc = text(input.observedAtUtc);
  const observedAtMs = Date.parse(observedAtUtc);

  if (!evidence || !exactKeys(evidence, EVIDENCE_KEYS)) return blocked('OPENCLAW_PROMOTION_PROVIDER_EVIDENCE_INVALID');
  const policy = TASK_CLASS_POLICY[text(evidence.taskClass)];
  if (!policy) return blocked('OPENCLAW_PROMOTION_TASK_CLASS_UNSUPPORTED');

  const executionValidation = validateExecutionReceipt(execution, {
    repository: REPOSITORY,
    issueNumber: ISSUE_NUMBER,
    expectedHead: text(evidence.sourceHead).toLowerCase(),
    executionId: text(evidence.taskId),
  });
  if (!executionValidation.valid
    || execution?.state !== 'completed'
    || execution?.workerType !== 'openclaw'
    || execution?.operatorActionRequired !== false
    || text(execution?.blocker) !== ''
    || text(execution?.phase) !== text(evidence.taskClass)) {
    return blocked('OPENCLAW_PROMOTION_REAL_WORK_EXECUTION_INVALID');
  }

  const evidenceProofRefs = uniqueProofRefs(evidence.proofRefs);
  const executionProofRefs = uniqueProofRefs(execution.proofRefs);
  if (!evidenceProofRefs || !executionProofRefs) return blocked('OPENCLAW_PROMOTION_PROOF_REFS_INVALID');
  if (!FULL_SHA.test(text(evidence.sourceHead))
    || text(execution.sourceHead).toLowerCase() !== text(evidence.sourceHead).toLowerCase()
    || text(execution.workerId) !== text(evidence.workerId)
    || !SAFE_WORKER_ID.test(text(evidence.workerId))
    || !SAFE_PROVIDER_VERSION.test(text(evidence.providerVersion))
    || text(evidence.finalVerdict) !== policy.finalVerdict
    || !Array.isArray(evidence.changedFiles)
    || evidence.changedFiles.length !== 0
    || evidence.sourceMutationPerformed !== false
    || evidence.selfQualificationAllowed !== false) {
    return blocked('OPENCLAW_PROMOTION_PROVIDER_EVIDENCE_NOT_QUALIFYING');
  }
  if (!Number.isFinite(observedAtMs)) return blocked('OPENCLAW_PROMOTION_OBSERVED_TIME_INVALID');
  const executionAtMs = Date.parse(text(execution.timestampUtc));
  if (!Number.isFinite(executionAtMs)
    || observedAtMs < executionAtMs
    || observedAtMs - executionAtMs > 10 * 60 * 1000) {
    return blocked('OPENCLAW_PROMOTION_TIME_BINDING_INVALID');
  }

  const combinedProofRefs = Object.freeze([...new Set([...executionProofRefs, ...evidenceProofRefs])]);
  const identitySeed = [
    execution.receiptId,
    execution.executionId,
    execution.sourceHead,
    evidence.taskClass,
    evidence.workerId,
    evidence.providerVersion,
  ].join('\n');
  const identity = sha256(identitySeed).slice(0, 32);
  const qualificationId = `openclaw-qualification-${identity}`;
  const authorityReceiptId = `openclaw-authority-${identity}`;
  const expiresAtUtc = new Date(observedAtMs + MAX_QUALIFICATION_LIFETIME_MS).toISOString();

  const qualificationReceipt = Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
    qualificationId,
    authorityReceiptId,
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    taskClass: evidence.taskClass,
    state: 'PRODUCTION_ELIGIBLE',
    providerInstance: evidence.workerId,
    providerVersion: evidence.providerVersion,
    sourceHead: text(evidence.sourceHead).toLowerCase(),
    realWorkTaskId: execution.executionId,
    realWorkReceiptId: execution.receiptId,
    observedAtUtc,
    expiresAtUtc,
    codexRequired: false,
    proofRefs: combinedProofRefs,
  });

  const workspaceProjection = toSharedWorkspaceExecutionReceipt(execution);
  if (!workspaceProjection.ok) return blocked('OPENCLAW_PROMOTION_WORKSPACE_PROJECTION_INVALID');

  const qualificationAuthorityReceipt = createSharedWorkspaceReceiptRecord({
    receiptId: authorityReceiptId,
    participantId: 'stephanos',
    timestampUtc: observedAtUtc,
    correlationId: qualificationId,
    relatedIssue: String(ISSUE_NUMBER),
    relatedPr: '',
    proofRefs: combinedProofRefs,
    receivedRecordId: execution.receiptId,
    disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
    summary: qualificationSummary(qualificationReceipt),
  });

  return Object.freeze({
    schemaVersion: OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA,
    ok: true,
    disposition: OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION,
    qualificationReceipt,
    qualificationAuthorityReceipt,
    realWorkWorkspaceReceipt: workspaceProjection.record,
    providerPoolAdmissionAllowed: false,
    providerQualificationAuthority: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}
