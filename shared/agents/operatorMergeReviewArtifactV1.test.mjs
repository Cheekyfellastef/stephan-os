import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  buildIndependentReviewArtifact,
  independentReviewArtifactName,
  validateIndependentReviewArtifact,
  validateIndependentReviewArtifactSet,
} from './operatorMergeReviewArtifactV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1623;
const branch = 'codex/provenance-proof';
const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const workflowRunId = 987654321;
const workflowRunAttempt = 2;
const artifactId = 123456789;
const archiveDigest = `sha256:${'c'.repeat(64)}`;

function cleanAnalysis() {
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: [],
    counts: { P0: 0, P1: 0, P2: 0 },
    verdict: 'clean',
    proofRefs: ['proofs/diff/complete'],
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
  };
}

function bootstrapAnalysis() {
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: [{
      severity: 'P0',
      code: 'approval-boundary-v2-self-change-requires-qualified-review',
      summary: 'The approval boundary changed and requires protected operator bootstrap.',
      path: 'shared/agents/operatorMergeApprovalGate.mjs',
    }],
    counts: { P0: 1, P1: 0, P2: 0 },
    verdict: 'findings',
    proofRefs: ['proofs/approval-boundary-v2/shared/agents/operatorMergeApprovalGate.mjs'],
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  };
}

function artifact(analysis = cleanAnalysis()) {
  return buildIndependentReviewArtifact({
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    createdAtUtc: '2026-07-31T00:00:00.000Z',
    analysis,
  });
}

function options(overrides = {}) {
  return {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    expectedBaseSha: baseSha,
    workflowRunId,
    workflowRunAttempt,
    ...overrides,
  };
}

function artifactList(overrides = {}) {
  return {
    total_count: 1,
    artifacts: [{
      id: artifactId,
      name: independentReviewArtifactName(workflowRunId, workflowRunAttempt),
      size_in_bytes: 4096,
      expired: false,
      digest: archiveDigest,
      workflow_run: { id: workflowRunId },
      ...overrides,
    }],
  };
}

test('builds and validates exact-run clean and bootstrap artifacts', () => {
  const clean = artifact();
  assert.equal(clean.artifactFile, INDEPENDENT_REVIEW_ARTIFACT_FILE);
  assert.equal(clean.reviewMode, 'clean-independent');
  assert.equal(validateIndependentReviewArtifact(clean, options()).finalVerdict, 'INDEPENDENT_REVIEW_ARTIFACT_READY');

  const bootstrap = artifact(bootstrapAnalysis());
  assert.equal(bootstrap.reviewMode, 'qualified-operator-bootstrap');
  const bootstrapValidation = validateIndependentReviewArtifact(bootstrap, options());
  assert.equal(bootstrapValidation.valid, true);
  assert.equal(bootstrapValidation.review.operatorBootstrapRequired, true);
});

test('artifact payload binds repository, PR, branch, head, base, run and attempt', () => {
  const valid = artifact();
  for (const [field, value, blocker] of [
    ['repository', 'other/repository', 'independent-review-artifact-repository-mismatch'],
    ['prNumber', prNumber + 1, 'independent-review-artifact-pr-mismatch'],
    ['branch', 'other/branch', 'independent-review-artifact-branch-mismatch'],
    ['sourceHead', 'c'.repeat(40), 'independent-review-artifact-head-mismatch'],
    ['baseSha', 'd'.repeat(40), 'independent-review-artifact-base-mismatch'],
    ['workflowRunId', workflowRunId + 1, 'independent-review-artifact-run-mismatch'],
    ['workflowRunAttempt', workflowRunAttempt + 1, 'independent-review-artifact-attempt-mismatch'],
  ]) {
    const tampered = { ...valid, [field]: value };
    const validation = validateIndependentReviewArtifact(tampered, options());
    assert.equal(validation.valid, false, field);
    assert.ok(validation.blockers.includes(blocker), `${field}: ${validation.blockers.join(', ')}`);
    assert.ok(validation.blockers.includes('independent-review-artifact-payload-digest-mismatch'));
  }
});

test('artifact payload rejects a forged clean receipt and unbounded fields', () => {
  const bootstrap = artifact(bootstrapAnalysis());
  const forged = {
    ...bootstrap,
    receipt: {
      ...artifact().receipt,
      timestampUtc: bootstrap.createdAtUtc,
    },
  };
  const validation = validateIndependentReviewArtifact(forged, options());
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('independent-review-artifact-payload-digest-mismatch'));
  assert.ok(validation.blockers.includes('independent-review-artifact-mode-mismatch'));

  const unbounded = validateIndependentReviewArtifact({ ...artifact(), attacker: true }, options());
  assert.ok(unbounded.blockers.includes('independent-review-artifact-unbounded-schema'));

  const staleDigest = validateIndependentReviewArtifact(artifact(), options({
    expectedPayloadSha256: 'd'.repeat(64),
  }));
  assert.ok(staleDigest.blockers.includes('independent-review-artifact-expected-payload-digest-mismatch'));
});

test('requires exactly one immutable artifact with the exact run identity and archive digest', () => {
  const ready = validateIndependentReviewArtifactSet(artifactList(), {
    workflowRunId,
    workflowRunAttempt,
    expectedArtifactId: artifactId,
    expectedArchiveDigest: archiveDigest,
  });
  assert.equal(ready.finalVerdict, 'INDEPENDENT_REVIEW_ARTIFACT_SET_READY');

  for (const [payload, blocker] of [
    [{ total_count: 0, artifacts: [] }, 'independent-review-artifact-count-not-one'],
    [{ total_count: 2, artifacts: [...artifactList().artifacts, { ...artifactList().artifacts[0], id: artifactId + 1 }] }, 'independent-review-artifact-count-not-one'],
    [artifactList({ name: 'forged-receipt' }), 'independent-review-artifact-name-mismatch'],
    [artifactList({ expired: true }), 'independent-review-artifact-expired'],
    [artifactList({ workflow_run: { id: workflowRunId + 1 } }), 'independent-review-artifact-workflow-run-mismatch'],
    [artifactList({ digest: `sha256:${'d'.repeat(64)}` }), 'independent-review-artifact-archive-digest-mismatch'],
    [artifactList({ id: artifactId + 1 }), 'independent-review-artifact-id-mismatch'],
  ]) {
    const validation = validateIndependentReviewArtifactSet(payload, {
      workflowRunId,
      workflowRunAttempt,
      expectedArtifactId: artifactId,
      expectedArchiveDigest: archiveDigest,
    });
    assert.equal(validation.valid, false, blocker);
    assert.ok(validation.blockers.includes(blocker), validation.blockers.join(', '));
  }

  const priorAttempt = {
    ...artifactList(),
    total_count: 2,
    artifacts: [
      {
        ...artifactList().artifacts[0],
        id: artifactId - 1,
        name: independentReviewArtifactName(workflowRunId, workflowRunAttempt - 1),
      },
      ...artifactList().artifacts,
    ],
  };
  assert.equal(validateIndependentReviewArtifactSet(priorAttempt, {
    workflowRunId,
    workflowRunAttempt,
    expectedArtifactId: artifactId,
    expectedArchiveDigest: archiveDigest,
  }).valid, true);

  const unexpected = {
    ...artifactList(),
    total_count: 2,
    artifacts: [
      ...artifactList().artifacts,
      { ...artifactList().artifacts[0], id: artifactId + 1, name: 'unrelated-output' },
    ],
  };
  assert.ok(validateIndependentReviewArtifactSet(unexpected, {
    workflowRunId,
    workflowRunAttempt,
  }).blockers.includes('independent-review-artifact-extra-unexpected'));
});
