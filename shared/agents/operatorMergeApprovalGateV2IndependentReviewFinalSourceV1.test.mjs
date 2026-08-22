import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
  migrateIndependentReviewWorkflowFinalPolicyAnalysisV1,
  validateIndependentReviewWorkflowFinalSourcePolicyV1,
} from './operatorMergeApprovalGateV2IndependentReviewFinalSourceV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function workflowContent() {
  return `name: Independent Merge Security Review

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

function source(content = workflowContent(), overrides = {}) {
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
    ...overrides,
  };
}

function input(content = workflowContent(), overrides = {}) {
  return {
    repository: REPOSITORY,
    sourceHead: HEAD,
    changedFiles: [{ filename: INDEPENDENT_REVIEW_WORKFLOW_PATH, status: 'modified' }],
    protectedWorkflowSources: [source(content)],
    ...overrides,
  };
}

function analysis(findings) {
  return Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze(findings),
    counts: Object.freeze({ P0: findings.length, P1: 0, P2: 0 }),
    verdict: findings.length ? 'findings' : 'clean',
    proofRefs: Object.freeze(['proofs/legacy']),
    finalVerdict: findings.length ? 'INDEPENDENT_SECURITY_REVIEW_FINDINGS' : 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
  });
}

const TRUST_FINDING = Object.freeze({
  severity: 'P0',
  code: 'independent-review-workflow-not-trusted',
  summary: 'legacy policy mismatch',
  path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
});
const BOOTSTRAP_FINDING = Object.freeze({
  severity: 'P0',
  code: 'approval-boundary-v2-self-change-requires-qualified-review',
  summary: 'bootstrap review still required',
  path: INDEPENDENT_REVIEW_WORKFLOW_PATH,
});

test('validates the exact Stage-2 two-event workflow final-source policy', () => {
  const result = validateIndependentReviewWorkflowFinalSourcePolicyV1(input());
  assert.equal(result.valid, true, result.blockers.join(','));
  assert.match(result.proofRef, /^proofs\/independent-review-workflow-final-policy-v1\//);
});

test('migrates only the legacy trust-policy finding and preserves bootstrap review', () => {
  const result = migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(
    analysis([TRUST_FINDING, BOOTSTRAP_FINDING]),
    input(),
  );
  assert.deepEqual(result.findings, [BOOTSTRAP_FINDING]);
  assert.deepEqual(result.counts, { P0: 1, P1: 0, P2: 0 });
  assert.equal(result.verdict, 'findings');
  assert.ok(result.proofRefs.some((ref) => ref.startsWith('proofs/independent-review-workflow-final-policy-v1/')));
});

test('fails closed on trigger, input, checkout, permission and source-binding drift', () => {
  const mutations = [
    (content) => content.replace('  workflow_dispatch:\n', '  schedule:\n    - cron: "0 * * * *"\n  workflow_dispatch:\n'),
    (content) => content.replace('      pr_number:\n', '      command:\n        required: true\n        type: string\n      pr_number:\n'),
    (content) => content.replace('ref: ${{ github.sha }}', 'ref: ${{ github.event.pull_request.head.sha }}'),
    (content) => content.replace('      actions: read', '      actions: write'),
    (content) => content.replace('persist-credentials: false', 'persist-credentials: true'),
  ];
  for (const mutate of mutations) {
    const mutated = mutate(workflowContent());
    const result = validateIndependentReviewWorkflowFinalSourcePolicyV1(input(mutated));
    assert.equal(result.valid, false);
    const migrated = migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(
      analysis([TRUST_FINDING, BOOTSTRAP_FINDING]),
      input(mutated),
    );
    assert.deepEqual(migrated.findings, [TRUST_FINDING, BOOTSTRAP_FINDING]);
  }

  const wrongBinding = input(workflowContent(), {
    protectedWorkflowSources: [source(workflowContent(), { ref: 'b'.repeat(40) })],
  });
  assert.equal(validateIndependentReviewWorkflowFinalSourcePolicyV1(wrongBinding).valid, false);
});

test('never suppresses unrelated authority findings or ambiguous legacy trust findings', () => {
  const authority = Object.freeze({
    severity: 'P0',
    code: 'independent-reviewer-v2-gained-mutation-authority',
    summary: 'mutation authority detected',
    path: 'scripts/independent-merge-security-review-v2.mjs',
  });
  const preserved = migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(
    analysis([TRUST_FINDING, BOOTSTRAP_FINDING, authority]),
    input(),
  );
  assert.deepEqual(preserved.findings, [BOOTSTRAP_FINDING, authority]);

  const ambiguous = migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(
    analysis([TRUST_FINDING, { ...TRUST_FINDING }]),
    input(),
  );
  assert.equal(ambiguous.findings.length, 2);
});
