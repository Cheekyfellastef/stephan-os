import { createHash } from 'node:crypto';

import {
  validateIndependentReviewHandoffProvenanceV1,
} from './independentReviewHandoffProvenanceV1.mjs';

export const INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA = 'stephanos.independent-review-handoff-run-receipt.v1';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'prNumber',
  'sourceHead',
  'baseSha',
  'branch',
  'coordinatorProvenance',
  'handoffCommentId',
  'bindingSha256',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'evidenceOnly',
  'reviewWorkflowDispatchAllowed',
  'sourceMutationAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerQualificationAllowed',
  'leaseSeizureAllowed',
  'arbitraryCommandAllowed',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : '';
}

function bindingSha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function evidenceOnlyAuthority() {
  return Object.freeze({
    evidenceOnly: true,
    reviewWorkflowDispatchAllowed: false,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function validateAuthority(value) {
  return hasExactKeys(value, AUTHORITY_KEYS)
    && value.evidenceOnly === true
    && value.reviewWorkflowDispatchAllowed === false
    && value.sourceMutationAllowed === false
    && value.approvalAllowed === false
    && value.mergeAllowed === false
    && value.deploymentAllowed === false
    && value.runtimeMutationAllowed === false
    && value.providerQualificationAllowed === false
    && value.leaseSeizureAllowed === false
    && value.arbitraryCommandAllowed === false;
}

function bindingMaterial({ repository, prNumber, sourceHead, baseSha, branch, coordinatorProvenance, handoffCommentId }) {
  return Object.freeze({
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    coordinatorWorkflowId: coordinatorProvenance.coordinatorWorkflowId,
    coordinatorWorkflowRunId: coordinatorProvenance.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: coordinatorProvenance.coordinatorWorkflowRunAttempt,
    coordinatorSourceSha: coordinatorProvenance.coordinatorSourceSha,
    coordinatorWorkflowRef: coordinatorProvenance.coordinatorWorkflowRef,
    coordinatorJobIdentity: coordinatorProvenance.coordinatorJobIdentity,
    handoffCommentId,
  });
}

export function buildIndependentReviewHandoffRunReceiptV1({
  repository,
  currentMainSha,
  pullRequest,
  provenance,
} = {}) {
  const normalizedRepository = text(repository);
  const normalizedMainSha = sha(currentMainSha);
  if (!normalizedRepository || !normalizedMainSha || !isPlainRecord(pullRequest)) {
    throw new Error('repository, exact current main and pull request are required');
  }

  const validatedProvenance = validateIndependentReviewHandoffProvenanceV1(provenance, {
    repository: normalizedRepository,
    currentMainSha: normalizedMainSha,
    handoffCommentId: provenance?.handoffCommentId,
  });
  const prNumber = positiveInteger(pullRequest.number);
  const sourceHead = sha(pullRequest?.head?.sha);
  const baseSha = sha(pullRequest?.base?.sha);
  const branch = text(pullRequest?.head?.ref);
  const handoffCommentId = positiveInteger(validatedProvenance.handoffCommentId);

  if (!prNumber
    || !sourceHead
    || !baseSha
    || !SAFE_BRANCH.test(branch)
    || text(pullRequest.state).toLowerCase() !== 'open'
    || text(pullRequest?.base?.ref) !== 'main'
    || baseSha !== normalizedMainSha
    || text(pullRequest?.head?.repo?.full_name) !== normalizedRepository
    || text(pullRequest?.base?.repo?.full_name) !== normalizedRepository) {
    throw new Error('pull request is not exact current same-repository review scope');
  }

  const material = bindingMaterial({
    repository: normalizedRepository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    coordinatorProvenance: validatedProvenance,
    handoffCommentId,
  });

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA,
    repository: normalizedRepository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    coordinatorProvenance: validatedProvenance,
    handoffCommentId,
    bindingSha256: bindingSha256(material),
    authority: evidenceOnlyAuthority(),
  });
}

export function validateIndependentReviewHandoffRunReceiptV1(receipt, expected = {}) {
  if (!hasExactKeys(receipt, RECEIPT_KEYS)) {
    throw new Error('handoff run receipt must use the exact closed-world schema');
  }
  if (text(receipt.schemaVersion) !== INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA
    || !validateAuthority(receipt.authority)) {
    throw new Error('handoff run receipt schema or authority is invalid');
  }

  const repository = text(receipt.repository);
  const prNumber = positiveInteger(receipt.prNumber);
  const sourceHead = sha(receipt.sourceHead);
  const baseSha = sha(receipt.baseSha);
  const branch = text(receipt.branch);
  const handoffCommentId = positiveInteger(receipt.handoffCommentId);
  if (!repository || !prNumber || !sourceHead || !baseSha || !SAFE_BRANCH.test(branch) || !handoffCommentId) {
    throw new Error('handoff run receipt identity is incomplete');
  }

  const provenance = validateIndependentReviewHandoffProvenanceV1(receipt.coordinatorProvenance, {
    repository,
    currentMainSha: baseSha,
    handoffCommentId,
  });
  const material = bindingMaterial({
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    coordinatorProvenance: provenance,
    handoffCommentId,
  });
  const expectedBinding = bindingSha256(material);
  if (text(receipt.bindingSha256).toLowerCase() !== expectedBinding) {
    throw new Error('handoff run receipt binding hash mismatch');
  }

  if (expected.repository && repository !== text(expected.repository)) throw new Error('handoff run receipt repository mismatch');
  if (expected.currentMainSha && baseSha !== sha(expected.currentMainSha)) throw new Error('handoff run receipt current main mismatch');
  if (expected.prNumber && prNumber !== positiveInteger(expected.prNumber)) throw new Error('handoff run receipt PR mismatch');
  if (expected.sourceHead && sourceHead !== sha(expected.sourceHead)) throw new Error('handoff run receipt source head mismatch');
  if (expected.baseSha && baseSha !== sha(expected.baseSha)) throw new Error('handoff run receipt base mismatch');
  if (expected.handoffCommentId && handoffCommentId !== positiveInteger(expected.handoffCommentId)) throw new Error('handoff run receipt comment mismatch');
  if (expected.coordinatorWorkflowRunId
    && provenance.coordinatorWorkflowRunId !== positiveInteger(expected.coordinatorWorkflowRunId)) {
    throw new Error('handoff run receipt coordinator run mismatch');
  }
  if (expected.coordinatorWorkflowRunAttempt
    && provenance.coordinatorWorkflowRunAttempt !== positiveInteger(expected.coordinatorWorkflowRunAttempt)) {
    throw new Error('handoff run receipt coordinator run attempt mismatch');
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA,
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    coordinatorProvenance: provenance,
    handoffCommentId,
    bindingSha256: expectedBinding,
    authority: evidenceOnlyAuthority(),
  });
}
