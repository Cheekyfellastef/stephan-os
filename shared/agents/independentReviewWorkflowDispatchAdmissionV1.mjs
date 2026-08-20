import { createHash } from 'node:crypto';

import {
  CANONICAL_COORDINATOR_JOB,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
  INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
  validateIndependentReviewHandoffProvenanceV1,
} from './independentReviewHandoffProvenanceV1.mjs';
import {
  validateIndependentReviewHandoffRunReceiptV1,
} from './independentReviewHandoffRunReceiptV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMISSION_SCHEMA = 'stephanos.independent-review-workflow-dispatch-admission.v1';
export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_SCHEMA = 'stephanos.independent-review-workflow-dispatch-run.v1';
export const INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA = 'stephanos.independent-review-handoff-identity.v1';
export const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const CANONICAL_REVIEW_WORKFLOW_NAME = 'Independent Merge Security Review';
export const CANONICAL_REVIEW_WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';
export const CANONICAL_REVIEW_JOB = 'independent-security-review';
export const CANONICAL_BASE_BRANCH = 'main';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;

const INPUT_KEYS = Object.freeze([
  'repository',
  'workflowDefinition',
  'currentMainSha',
  'pullRequest',
  'handoffIdentity',
  'handoffRunReceipt',
]);
const RUN_INPUT_KEYS = Object.freeze([
  'environment',
  'workflowDefinition',
  'currentMainSha',
  'pullRequest',
  'handoffIdentity',
  'handoffRunReceipt',
  'workflowDispatchInputs',
]);

const WORKFLOW_KEYS = Object.freeze(['id', 'name', 'path', 'state']);
const HANDOFF_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'prNumber',
  'sourceHead',
  'baseSha',
  'branch',
  'baseBranch',
  'marker',
  'coordinatorProvenance',
  'authority',
]);
const HANDOFF_AUTHORITY_KEYS = Object.freeze([
  'reviewExecutionAllowed',
  'sourceMutationAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerQualificationAllowed',
  'leaseSeizureAllowed',
]);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
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

function exactFalse(value) {
  return value === false;
}

function validateHandoffAuthority(authority) {
  if (!hasExactKeys(authority, HANDOFF_AUTHORITY_KEYS)) return false;
  return authority.reviewExecutionAllowed === true
    && exactFalse(authority.sourceMutationAllowed)
    && exactFalse(authority.approvalAllowed)
    && exactFalse(authority.mergeAllowed)
    && exactFalse(authority.deploymentAllowed)
    && exactFalse(authority.runtimeMutationAllowed)
    && exactFalse(authority.providerQualificationAllowed)
    && exactFalse(authority.leaseSeizureAllowed);
}

function bindingSha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function admitIndependentReviewWorkflowDispatchV1(input = {}) {
  if (!hasExactKeys(input, INPUT_KEYS)) {
    throw new Error('dispatch admission input must use the exact closed-world schema');
  }

  const repository = text(input.repository);
  const workflow = input.workflowDefinition;
  const pullRequest = input.pullRequest;
  const handoff = input.handoffIdentity;
  const currentMainSha = sha(input.currentMainSha);

  if (repository !== CANONICAL_REPOSITORY || !currentMainSha) {
    throw new Error('canonical repository and current main identity are required');
  }
  if (!hasExactKeys(workflow, WORKFLOW_KEYS)
    || !positiveInteger(workflow.id)
    || text(workflow.name) !== CANONICAL_REVIEW_WORKFLOW_NAME
    || text(workflow.path) !== CANONICAL_REVIEW_WORKFLOW_PATH
    || text(workflow.state).toLowerCase() !== 'active') {
    throw new Error('independent review workflow identity is not canonical and active');
  }
  if (!hasExactKeys(handoff, HANDOFF_KEYS)
    || text(handoff.schemaVersion) !== INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA
    || text(handoff.repository) !== repository
    || !positiveInteger(handoff.prNumber)
    || !sha(handoff.sourceHead)
    || !sha(handoff.baseSha)
    || text(handoff.baseBranch) !== CANONICAL_BASE_BRANCH
    || !SAFE_BRANCH.test(text(handoff.branch))
    || !text(handoff.marker)
    || !validateHandoffAuthority(handoff.authority)) {
    throw new Error('authenticated provider-neutral handoff identity is incomplete or unsafe');
  }

  const coordinatorProvenance = validateIndependentReviewHandoffProvenanceV1(
    handoff.coordinatorProvenance,
    {
      repository,
      currentMainSha,
      handoffCommentId: handoff.coordinatorProvenance?.handoffCommentId,
    },
  );
  if (text(coordinatorProvenance.schemaVersion) !== INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA
    || text(coordinatorProvenance.coordinatorWorkflowName) !== CANONICAL_COORDINATOR_WORKFLOW_NAME
    || text(coordinatorProvenance.coordinatorWorkflowPath) !== CANONICAL_COORDINATOR_WORKFLOW_PATH
    || text(coordinatorProvenance.coordinatorJobIdentity) !== CANONICAL_COORDINATOR_JOB) {
    throw new Error('authenticated provider-neutral handoff coordinator provenance is not canonical');
  }

  if (sha(handoff.baseSha) !== currentMainSha) {
    throw new Error('handoff base is not exact current canonical main');
  }
  if (!isPlainRecord(pullRequest)
    || text(pullRequest.state).toLowerCase() !== 'open'
    || positiveInteger(pullRequest.number) !== handoff.prNumber
    || text(pullRequest.base?.ref) !== CANONICAL_BASE_BRANCH
    || sha(pullRequest.base?.sha) !== currentMainSha
    || text(pullRequest.head?.ref) !== text(handoff.branch)
    || sha(pullRequest.head?.sha) !== sha(handoff.sourceHead)
    || text(pullRequest.head?.repo?.full_name) !== repository
    || text(pullRequest.base?.repo?.full_name) !== repository) {
    throw new Error('pull request no longer matches the exact authenticated handoff');
  }

  const handoffRunReceipt = validateIndependentReviewHandoffRunReceiptV1(input.handoffRunReceipt, {
    repository,
    currentMainSha,
    prNumber: handoff.prNumber,
    sourceHead: handoff.sourceHead,
    baseSha: currentMainSha,
    handoffCommentId: coordinatorProvenance.handoffCommentId,
    coordinatorWorkflowRunId: coordinatorProvenance.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: coordinatorProvenance.coordinatorWorkflowRunAttempt,
  });

  const binding = Object.freeze({
    repository,
    workflowId: workflow.id,
    workflowName: CANONICAL_REVIEW_WORKFLOW_NAME,
    workflowPath: CANONICAL_REVIEW_WORKFLOW_PATH,
    prNumber: handoff.prNumber,
    sourceHead: sha(handoff.sourceHead),
    baseSha: currentMainSha,
    branch: text(handoff.branch),
    baseBranch: CANONICAL_BASE_BRANCH,
    handoffMarker: text(handoff.marker),
    coordinatorWorkflowId: coordinatorProvenance.coordinatorWorkflowId,
    coordinatorWorkflowName: coordinatorProvenance.coordinatorWorkflowName,
    coordinatorWorkflowPath: coordinatorProvenance.coordinatorWorkflowPath,
    coordinatorWorkflowRunId: coordinatorProvenance.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: coordinatorProvenance.coordinatorWorkflowRunAttempt,
    coordinatorEvent: coordinatorProvenance.coordinatorEvent,
    coordinatorRepository: coordinatorProvenance.coordinatorRepository,
    coordinatorSourceSha: coordinatorProvenance.coordinatorSourceSha,
    coordinatorWorkflowRef: coordinatorProvenance.coordinatorWorkflowRef,
    coordinatorJobIdentity: coordinatorProvenance.coordinatorJobIdentity,
    handoffCommentId: coordinatorProvenance.handoffCommentId,
    handoffRunReceiptSha256: handoffRunReceipt.bindingSha256,
  });
  const handoffBindingSha256 = bindingSha256(binding);

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMISSION_SCHEMA,
    verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMITTED',
    binding,
    handoffBindingSha256,
    workflowDispatchInputs: Object.freeze({
      pr_number: String(handoff.prNumber),
      source_head: binding.sourceHead,
      base_sha: binding.baseSha,
      head_branch: binding.branch,
      handoff_binding_sha256: handoffBindingSha256,
      handoff_run_receipt_sha256: handoffRunReceipt.bindingSha256,
    }),
    requiredRevalidation: Object.freeze({
      currentMain: true,
      pullRequestIdentity: true,
      workflowIdentity: true,
      coordinatorWorkflowRun: true,
      handoffComment: true,
      coordinatorHandoffRunReceipt: true,
      exactRunAbsence: true,
    }),
    authority: Object.freeze({
      reviewWorkflowDispatchAllowed: true,
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
      arbitraryCommandAllowed: false,
    }),
  });
}

export function validateIndependentReviewWorkflowDispatchRunV1(input = {}) {
  if (!hasExactKeys(input, RUN_INPUT_KEYS)) {
    throw new Error('workflow dispatch run validation must use the exact closed-world schema');
  }
  if (!isPlainRecord(input.environment)) {
    throw new Error('workflow dispatch run environment is required');
  }

  const admission = admitIndependentReviewWorkflowDispatchV1({
    repository: CANONICAL_REPOSITORY,
    workflowDefinition: input.workflowDefinition,
    currentMainSha: input.currentMainSha,
    pullRequest: input.pullRequest,
    handoffIdentity: input.handoffIdentity,
    handoffRunReceipt: input.handoffRunReceipt,
  });
  const environment = input.environment;
  const currentMainSha = sha(input.currentMainSha);
  const expectedWorkflowRef = `${CANONICAL_REPOSITORY}/${CANONICAL_REVIEW_WORKFLOW_PATH}@refs/heads/${CANONICAL_BASE_BRANCH}`;
  const blockers = [];

  if (text(environment.GITHUB_ACTIONS) !== 'true') blockers.push('not-github-actions');
  if (text(environment.GITHUB_EVENT_NAME) !== 'workflow_dispatch') blockers.push('wrong-event');
  if (text(environment.GITHUB_REPOSITORY) !== CANONICAL_REPOSITORY) blockers.push('wrong-repository');
  if (text(environment.GITHUB_WORKFLOW) !== CANONICAL_REVIEW_WORKFLOW_NAME) blockers.push('wrong-workflow');
  if (text(environment.GITHUB_JOB) !== CANONICAL_REVIEW_JOB) blockers.push('wrong-job');
  if (text(environment.GITHUB_REF) !== `refs/heads/${CANONICAL_BASE_BRANCH}`) blockers.push('wrong-ref');
  if (sha(environment.GITHUB_SHA) !== currentMainSha) blockers.push('wrong-workflow-source-sha');
  if (text(environment.GITHUB_WORKFLOW_REF) !== expectedWorkflowRef) blockers.push('untrusted-workflow-ref');

  const observedInputs = input.workflowDispatchInputs;
  const expectedInputs = admission.workflowDispatchInputs;
  if (!hasExactKeys(observedInputs, Object.keys(expectedInputs))) {
    blockers.push('workflow-dispatch-input-schema-mismatch');
  } else {
    for (const [key, expected] of Object.entries(expectedInputs)) {
      if (text(observedInputs[key]) !== expected) blockers.push(`workflow-dispatch-input-mismatch:${key}`);
    }
  }

  if (blockers.length) {
    throw new Error(`workflow dispatch run identity is not canonical: ${blockers.join(', ')}`);
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_SCHEMA,
    verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_TRUSTED',
    repository: CANONICAL_REPOSITORY,
    workflowName: CANONICAL_REVIEW_WORKFLOW_NAME,
    workflowPath: CANONICAL_REVIEW_WORKFLOW_PATH,
    job: CANONICAL_REVIEW_JOB,
    prNumber: admission.binding.prNumber,
    sourceHead: admission.binding.sourceHead,
    baseSha: admission.binding.baseSha,
    branch: admission.binding.branch,
    handoffBindingSha256: admission.handoffBindingSha256,
    handoffRunReceiptSha256: admission.binding.handoffRunReceiptSha256,
    coordinatorWorkflowRunId: admission.binding.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: admission.binding.coordinatorWorkflowRunAttempt,
    handoffCommentId: admission.binding.handoffCommentId,
    authority: Object.freeze({
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
      arbitraryCommandAllowed: false,
    }),
  });
}
