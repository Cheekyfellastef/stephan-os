import { createHash } from 'node:crypto';

import {
  INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION,
  INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SCHEMA,
} from './independentReviewMissingRunLaunchV1.mjs';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_REVIEW_WORKFLOW_NAME,
  CANONICAL_REVIEW_WORKFLOW_PATH,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_RECEIPT_SCHEMA = 'stephanos.independent-review-workflow-dispatch-launch-receipt.v1';
export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER = 'stephanos:independent-review-workflow-dispatch-launch:v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'prNumber',
  'sourceHead',
  'baseSha',
  'branch',
  'workflowId',
  'workflowName',
  'workflowPath',
  'handoffBindingSha256',
  'handoffRunReceiptSha256',
  'launchKeySha256',
  'runName',
  'requestedAtUtc',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'reviewWorkflowDispatchAllowed',
  'reviewExecutionAllowed',
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

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function safeAuthority(value) {
  return exactKeys(value, AUTHORITY_KEYS)
    && value.reviewWorkflowDispatchAllowed === true
    && value.reviewExecutionAllowed === true
    && value.sourceMutationAllowed === false
    && value.approvalAllowed === false
    && value.mergeAllowed === false
    && value.deploymentAllowed === false
    && value.runtimeMutationAllowed === false
    && value.providerQualificationAllowed === false
    && value.leaseSeizureAllowed === false
    && value.arbitraryCommandAllowed === false;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function iso(value) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new Error('launch receipt requires canonical requestedAtUtc');
  }
  return normalized;
}

function bindingFromPlan(plan) {
  if (text(plan?.schemaVersion) !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SCHEMA
    || text(plan?.decision) !== INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN
    || plan?.mutationAllowed !== true
    || plan?.operation !== 'workflow-dispatch'
    || text(plan?.repository) !== CANONICAL_REPOSITORY
    || !Number.isSafeInteger(plan?.prNumber)
    || plan.prNumber <= 0
    || !SHA40.test(text(plan?.sourceHead).toLowerCase())
    || !SHA40.test(text(plan?.baseSha).toLowerCase())
    || !Number.isSafeInteger(plan?.workflowId)
    || plan.workflowId <= 0
    || !SAFE_BRANCH.test(text(plan?.branch ?? plan?.workflowDispatchInputs?.head_branch))
    || !SHA64.test(text(plan?.handoffBindingSha256).toLowerCase())
    || !SHA64.test(text(plan?.workflowDispatchInputs?.handoff_run_receipt_sha256).toLowerCase())
    || !safeAuthority(plan?.authority)) {
    throw new Error('exact admitted missing-run launch plan is required');
  }
  return Object.freeze({
    repository: CANONICAL_REPOSITORY,
    prNumber: plan.prNumber,
    sourceHead: text(plan.sourceHead).toLowerCase(),
    baseSha: text(plan.baseSha).toLowerCase(),
    branch: text(plan.workflowDispatchInputs.head_branch),
    workflowId: plan.workflowId,
    workflowName: CANONICAL_REVIEW_WORKFLOW_NAME,
    workflowPath: CANONICAL_REVIEW_WORKFLOW_PATH,
    handoffBindingSha256: text(plan.handoffBindingSha256).toLowerCase(),
    handoffRunReceiptSha256: text(plan.workflowDispatchInputs.handoff_run_receipt_sha256).toLowerCase(),
  });
}

export function independentReviewWorkflowDispatchRunNameV1(binding) {
  return `stephanos-independent-review-pr-${binding.prNumber}-head-${binding.sourceHead}-binding-${binding.handoffBindingSha256}`;
}

export function buildIndependentReviewWorkflowDispatchLaunchReceiptV1({ launchPlan, requestedAtUtc } = {}) {
  const binding = bindingFromPlan(launchPlan);
  const launchKeySha256 = digest(binding);
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_RECEIPT_SCHEMA,
    ...binding,
    launchKeySha256,
    runName: independentReviewWorkflowDispatchRunNameV1(binding),
    requestedAtUtc: iso(requestedAtUtc),
    authority: Object.freeze({ ...launchPlan.authority }),
  });
}

export function validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt = {}) {
  if (!exactKeys(receipt, RECEIPT_KEYS)
    || text(receipt.schemaVersion) !== INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_RECEIPT_SCHEMA
    || text(receipt.repository) !== CANONICAL_REPOSITORY
    || !Number.isSafeInteger(receipt.prNumber)
    || receipt.prNumber <= 0
    || !SHA40.test(text(receipt.sourceHead).toLowerCase())
    || !SHA40.test(text(receipt.baseSha).toLowerCase())
    || !SAFE_BRANCH.test(text(receipt.branch))
    || !Number.isSafeInteger(receipt.workflowId)
    || receipt.workflowId <= 0
    || text(receipt.workflowName) !== CANONICAL_REVIEW_WORKFLOW_NAME
    || text(receipt.workflowPath) !== CANONICAL_REVIEW_WORKFLOW_PATH
    || !SHA64.test(text(receipt.handoffBindingSha256).toLowerCase())
    || !SHA64.test(text(receipt.handoffRunReceiptSha256).toLowerCase())
    || !SHA64.test(text(receipt.launchKeySha256).toLowerCase())
    || !safeAuthority(receipt.authority)) {
    throw new Error('workflow-dispatch launch receipt is incomplete or unsafe');
  }
  const binding = Object.freeze({
    repository: receipt.repository,
    prNumber: receipt.prNumber,
    sourceHead: text(receipt.sourceHead).toLowerCase(),
    baseSha: text(receipt.baseSha).toLowerCase(),
    branch: receipt.branch,
    workflowId: receipt.workflowId,
    workflowName: receipt.workflowName,
    workflowPath: receipt.workflowPath,
    handoffBindingSha256: text(receipt.handoffBindingSha256).toLowerCase(),
    handoffRunReceiptSha256: text(receipt.handoffRunReceiptSha256).toLowerCase(),
  });
  if (digest(binding) !== text(receipt.launchKeySha256).toLowerCase()
    || independentReviewWorkflowDispatchRunNameV1(binding) !== receipt.runName) {
    throw new Error('workflow-dispatch launch receipt binding does not match');
  }
  iso(receipt.requestedAtUtc);
  return Object.freeze({ ...receipt, ...binding });
}

export function renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt) {
  const validated = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(receipt);
  return [
    `<!-- ${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER} key=${validated.launchKeySha256} -->`,
    '## Provider-neutral independent-review missing-run launch receipt',
    '',
    '```json',
    JSON.stringify(validated, null, 2),
    '```',
    '',
    'This content-addressed receipt records one bounded review-workflow dispatch request only. It grants no source, approval, merge, deployment, runtime, provider-qualification, lease or arbitrary-command authority.',
  ].join('\n');
}

export function parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(body) {
  const value = text(body);
  const marker = value.match(new RegExp(`^<!--\\s*${INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER}\\s+key=([0-9a-f]{64})\\s*-->`));
  if (!marker || !value.includes('## Provider-neutral independent-review missing-run launch receipt')) {
    throw new Error('workflow-dispatch launch receipt comment marker is missing');
  }
  const fenced = value.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!fenced) throw new Error('workflow-dispatch launch receipt JSON is missing');
  let parsed;
  try {
    parsed = JSON.parse(fenced[1]);
  } catch {
    throw new Error('workflow-dispatch launch receipt JSON is invalid');
  }
  const receipt = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(parsed);
  if (receipt.launchKeySha256 !== marker[1]) {
    throw new Error('workflow-dispatch launch receipt comment key does not match receipt');
  }
  return receipt;
}
