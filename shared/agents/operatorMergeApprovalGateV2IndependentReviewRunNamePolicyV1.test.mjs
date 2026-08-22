import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1,
  validateIndependentReviewWorkflowRunNameFinalSourceV1,
} from './operatorMergeApprovalGateV2IndependentReviewRunNamePolicyV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from './operatorMergeApprovalGateV2IndependentReviewFinalSourceV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function workflowContent(runName = INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1) {
  return `name: Independent Merge Security Review
run-name: ${runName}

on:
  pull_request_target:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:
    inputs:
      pr_number:
        required: true
        type: string
      source_head:
        required: true
        type: string
      base_sha:
        required: true
        type: string
      head_branch:
        required: true
        type: string
      handoff_binding_sha256:
        required: true
        type: string
      handoff_run_receipt_sha256:
        required: true
        type: string

permissions: {}

jobs:
  independent-security-review:
    permissions:
      actions: read
      contents: read
      issues: write
      pull-requests: read
    steps:
      - name: Check out trusted pull-request exact base reviewer
        if: github.event_name == 'pull_request_target'
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.base.sha }}
          persist-credentials: false
          fetch-depth: 1
      - name: Check out trusted workflow-dispatch exact main reviewer
        if: github.event_name == 'workflow_dispatch'
        uses: actions/checkout@v4
        with:
          ref: \${{ github.sha }}
          persist-credentials: false
          fetch-depth: 1
`;
}

function source(content = workflowContent()) {
  const size = Buffer.byteLength(content, 'utf8');
  const blobSha = createHash('sha1')
    .update(`blob ${size}\0`, 'utf8')
    .update(content)
    .digest('hex');
  return {
    schemaVersion: 'stephanos.protected-workflow-source.v1',
    repository: REPOSITORY,
    path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    ref: HEAD,
    exists: true,
    size,
    blobSha,
    content,
  };
}

function input(content = workflowContent()) {
  return {
    repository: REPOSITORY,
    sourceHead: HEAD,
    changedFiles: [{ filename: INDEPENDENT_REVIEW_WORKFLOW_PATH, status: 'modified' }],
    protectedWorkflowSources: [source(content)],
  };
}

test('accepts exactly one deterministic run-name only after the existing final-source policy passes', () => {
  const result = validateIndependentReviewWorkflowRunNameFinalSourceV1(input());
  assert.equal(result.applicable, true);
  assert.equal(result.valid, true, result.blockers.join(','));
  assert.equal(result.blockers.length, 0);
  assert.equal(result.proofRefs.length, 2);
});

test('fails closed on missing, duplicate, indented or altered run-name', () => {
  const variants = [
    workflowContent().replace(`run-name: ${INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1}\n`, ''),
    workflowContent().replace(
      `run-name: ${INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1}\n`,
      `run-name: ${INDEPENDENT_REVIEW_WORKFLOW_RUN_NAME_EXPRESSION_V1}\nrun-name: duplicate\n`,
    ),
    workflowContent().replace('run-name:', '  run-name:'),
    workflowContent('stephanos-independent-review-unbound'),
  ];
  for (const content of variants) {
    const result = validateIndependentReviewWorkflowRunNameFinalSourceV1(input(content));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.length > 0);
  }
});

test('does not allow an exact run-name to rescue an invalid underlying workflow policy', () => {
  const widened = workflowContent().replace('      actions: read', '      actions: write');
  const result = validateIndependentReviewWorkflowRunNameFinalSourceV1(input(widened));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('independent-review-final-source-policy-invalid'));
});
