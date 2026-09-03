import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUALIFIED_SPECIALIST_ARTIFACT_SCHEMA_VERSION,
  adjudicateQualifiedSpecialistReview,
  validateQualifiedSpecialistReviewArtifact,
} from './qualifiedSpecialistReviewV1.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION,
  buildIndependentReviewArtifact,
  validateIndependentReviewArtifact,
} from './operatorMergeReviewArtifactV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1919;
const branch = 'fix/ignition-canonical-convergence-gate-v1';
const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const paths = Object.freeze([
  'scripts/windows/repair-stephanos-battle-bridge.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
]);

function analysis() {
  const findings = paths.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    summary: 'Separate qualified specialist review required.',
    path,
  }));
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings,
    counts: { P0: findings.length, P1: 0, P2: 0 },
    verdict: 'findings',
    proofRefs: paths.map((path) => `proofs/changed-file/${path}`),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  };
}

function request(overrides = {}) {
  return {
    id: 1001,
    user: { login: 'repository-owner', id: 71, type: 'User' },
    author_association: 'OWNER',
    created_at: '2026-08-20T18:46:20Z',
    updated_at: '2026-08-20T18:46:20Z',
    body: [
      '@codex Perform exactly one read-only qualified Windows-authority specialist review.',
      `Exact head ${sourceHead} against exact base ${baseSha}.`,
      'Review the complete exact-head diff with fixed executable identity.',
      ...paths,
    ].join('\n'),
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    id: 1002,
    user: { login: 'chatgpt-codex-connector[bot]', id: 199175422, type: 'Bot' },
    performed_via_github_app: { slug: 'chatgpt-codex-connector', id: 1144995 },
    created_at: '2026-08-20T18:49:15Z',
    updated_at: '2026-08-20T18:49:15Z',
    body: `Codex Review: Didn't find any major issues. Nice work!\n\n**Reviewed commit:** \`${sourceHead.slice(0, 10)}\``,
    resolved_commit_id: sourceHead,
    ...overrides,
  };
}

function adjudicate(comments) {
  return adjudicateQualifiedSpecialistReview({
    analysis: analysis(),
    reviews: [],
    comments,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
  });
}

test('authenticated scoped request and app response mint one provider-neutral specialist artifact', () => {
  const result = adjudicate([request(), response()]);
  assert.equal(result.required, true);
  assert.equal(result.valid, true);
  assert.equal(result.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');
  assert.equal(result.artifact.schemaVersion, QUALIFIED_SPECIALIST_ARTIFACT_SCHEMA_VERSION);
  assert.equal(result.artifact.response.resolvedCommitId, sourceHead);
  assert.equal(result.artifact.receipt.reviewerClass, 'external-qualified');
  assert.equal(result.artifact.receipt.provider, 'github-app-chatgpt-codex-connector');
  assert.equal(result.artifact.receipt.modelClass, 'provider-managed-specialist');
  assert.match(result.analysis.proofRefs.join('\n'), new RegExp(result.artifact.payloadSha256));

  const validation = validateQualifiedSpecialistReviewArtifact(result.artifact, {
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    paths,
  });
  assert.equal(validation.valid, true, validation.blockers.join(', '));
});

test('real GitHub issue-comment response binds reviewed commit when resolved_commit_id is absent', () => {
  const result = adjudicate([request(), response({ resolved_commit_id: undefined })]);
  assert.equal(result.required, true);
  assert.equal(result.valid, true, result.blockers.join(', '));
  assert.equal(result.analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_CLEAN');
  assert.equal(result.artifact.response.reviewedCommitRef, sourceHead.slice(0, 10));
  assert.equal(result.artifact.response.resolvedCommitId, '');

  const validation = validateQualifiedSpecialistReviewArtifact(result.artifact, {
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    paths,
  });
  assert.equal(validation.valid, true, validation.blockers.join(', '));
});

test('specialist artifact path fails closed on forged provenance, stale head, edits and incomplete scope', () => {
  const cases = [
    [request(), response({ resolved_commit_id: 'c'.repeat(40) })],
    [request(), response({
      resolved_commit_id: undefined,
      body: `Codex Review: Didn't find any major issues. Nice work!\n\n**Reviewed commit:** \`${'c'.repeat(10)}\``,
    })],
    [request(), response({ performed_via_github_app: null })],
    [request(), response({ user: { login: 'foreign-bot[bot]', id: 199175422, type: 'Bot' } })],
    [request(), response({ updated_at: '2026-08-20T18:50:15Z' })],
    [request({ author_association: 'NONE' }), response()],
    [request({ body: request().body.replace(paths[0], '') }), response()],
    [request(), response({ body: `Codex Review: Found an issue.\n\n**Reviewed commit:** \`${sourceHead.slice(0, 10)}\`` })],
  ];
  for (const comments of cases) {
    const result = adjudicate(comments);
    assert.equal(result.valid, false);
    assert.deepEqual(result.blockers, ['qualified-specialist-review-missing']);
  }
});

test('a later operator invocation closes the original request response window', () => {
  const retry = request({
    id: 1002,
    created_at: '2026-08-20T18:47:00Z',
    updated_at: '2026-08-20T18:47:00Z',
    body: '@codex retry this review',
  });
  const late = response({ id: 1003 });
  const result = adjudicate([request(), retry, late]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.blockers, ['qualified-specialist-review-missing']);
});

test('a same-second higher-ID operator invocation closes the request response window', () => {
  const original = request();
  const retry = request({
    id: 1002,
    created_at: original.created_at,
    updated_at: original.updated_at,
    body: '@codex cancel and replace this review',
  });
  const late = response({
    id: 1003,
    created_at: original.created_at,
    updated_at: original.updated_at,
  });
  const result = adjudicate([original, retry, late]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.blockers, ['qualified-specialist-review-missing']);
});

test('a same-second provider response is ordered by its higher immutable comment ID', () => {
  const original = request();
  const sameSecond = response({
    id: 1002,
    created_at: original.created_at,
    updated_at: original.updated_at,
  });
  const result = adjudicate([sameSecond, original]);
  assert.equal(result.valid, true, result.blockers.join(', '));

  const forgedArtifact = structuredClone(result.artifact);
  forgedArtifact.response.id = original.id - 1;
  forgedArtifact.payloadSha256 = result.artifact.payloadSha256;
  const validation = validateQualifiedSpecialistReviewArtifact(forgedArtifact, {
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    paths,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.blockers.includes('specialist-artifact-causality-invalid'), true);
});

test('tampering with normalized request or response evidence breaks the artifact digest and validation', () => {
  const artifact = adjudicate([request(), response()]).artifact;
  const tampered = structuredClone(artifact);
  tampered.response.body = `${tampered.response.body}\nforged`;
  const validation = validateQualifiedSpecialistReviewArtifact(tampered, {
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    paths,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.blockers.includes('specialist-artifact-payload-digest-mismatch'), true);
});

test('immutable independent review artifact embeds and revalidates the full specialist artifact', () => {
  const specialist = adjudicate([request(), response()]);
  const artifact = buildIndependentReviewArtifact({
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId: 991,
    workflowRunAttempt: 1,
    createdAtUtc: '2026-08-20T18:51:00Z',
    analysis: specialist.analysis,
    specialistReviewArtifact: specialist.artifact,
  });
  assert.equal(artifact.schemaVersion, INDEPENDENT_REVIEW_ARTIFACT_SPECIALIST_SCHEMA_VERSION);
  assert.equal(artifact.specialistReviewArtifact.payloadSha256, specialist.artifact.payloadSha256);
  const validation = validateIndependentReviewArtifact(artifact, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    expectedBaseSha: baseSha,
    workflowRunId: 991,
    workflowRunAttempt: 1,
    expectedPayloadSha256: artifact.payloadSha256,
  });
  assert.equal(validation.valid, true, validation.blockers.join(', '));

  const forged = structuredClone(artifact);
  forged.specialistReviewArtifact.response.appId = 9;
  const rejected = validateIndependentReviewArtifact(forged, {
    repository,
    prNumber,
    branch,
    expectedHead: sourceHead,
    expectedBaseSha: baseSha,
    workflowRunId: 991,
    workflowRunAttempt: 1,
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.blockers.includes('independent-review-artifact-payload-digest-mismatch'), true);
});
