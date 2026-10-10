import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSovereignReviewSnapshot, evaluateSovereignReviewSnapshot } from './sovereignReviewerV1.mjs';
import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';

const sample = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 1574,
  prNumber: 3003,
  branch: 'goal/1574-sovereign-reviewer-local-v1',
  sourceHead: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
  changedFiles: ['src/sample.js'],
  diff: 'diff --git a/src/sample.js b/src/sample.js\nindex 000..111\n--- a/src/sample.js\n+++ b/src/sample.js\n@@ -1 +1 @@\n-old\n+new\n',
  implementerProvider: 'github-builder',
  implementerSessionId: 'implementation-1',
  reviewerSessionId: 'review-session-2',
  modelClass: 'qwen-14b',
  timestampUtc: '2026-10-10T13:30:00.000Z',
});
const clean = JSON.stringify({ verdict: 'clean', reviewedPaths: ['src/sample.js'], findings: [] });

test('local sovereign reviewer emits a valid exact-head candidate but grants no merge authority', async () => {
  let calls = 0;
  const result = await evaluateSovereignReviewSnapshot(sample, { invokeModel: async prompt => {
    calls += 1;
    assert.match(prompt, /<UNTRUSTED_DIFF>/);
    return clean;
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(result.qualification, 'PENDING_INDEPENDENT_ATTESTATION');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.approvalAuthority, false);
  assert.equal(result.specialistAuthority, false);
  assert.equal(result.runtimeDeploymentProven, false);
  assert.equal(result.reviewReceipt.sourceHead, sample.sourceHead);
  assert.equal(result.reviewReceipt.reviewerClass, 'openclaw-local-readonly');
  assert.equal(result.reviewReceipt.verdict, 'clean');
  assert.equal(validateProviderNeutralReviewReceipt(result.reviewReceipt, { expectedHead: sample.sourceHead }).valid, true);
  assert.equal(result.executionReceipt.sourceHead, sample.sourceHead);
});

test('blocks specialist/high-risk changes before calling model', async () => {
  let calls = 0;
  const result = await evaluateSovereignReviewSnapshot({
    ...sample, changedFiles: ['.github/workflows/independent-merge-security-review.yml'],
  }, { invokeModel: async () => { calls++; return clean; } });
  assert.equal(result.reason, 'QUALIFIED_HIGH_RISK_SPECIALIST_REQUIRED');
  assert.equal(result.riskTier, 'high');
  assert.equal(calls, 0);
  assert.equal(result.mergeAuthority, false);
});

test('fails closed on an unreviewed path, contradictory model answer and invalid finding', async () => {
  for (const raw of [
    JSON.stringify({ verdict:'clean', reviewedPaths: [], findings: [] }),
    JSON.stringify({ verdict:'clean', reviewedPaths: sample.changedFiles, findings: [{ severity:'P1', code:'regression', path:'src/sample.js', summary:'This change has a major regression' }] }),
    JSON.stringify({ verdict:'findings', reviewedPaths: sample.changedFiles, findings: [{ severity:'P1', code:'regression', path:'src/else.js', summary:'This change has a major regression' }] }),
    '{"verdict":"clean"}',
  ]) {
    const result = await evaluateSovereignReviewSnapshot(sample, { invokeModel: async () => raw });
    assert.equal(result.status, 'SOVEREIGN_REVIEW_HELD', raw);
    assert.equal(result.mergeAuthority, false);
  }
});

test('keeps actual model findings with path and severity in the candidate receipt', async () => {
  const result = await evaluateSovereignReviewSnapshot(sample, { invokeModel: async () => JSON.stringify({
    verdict: 'findings', reviewedPaths: sample.changedFiles,
    findings: [{ severity: 'P1', code: 'unhandled-error', path: 'src/sample.js', summary: 'Uncaught errors escape the normal boundary.' }],
  }) });
  assert.equal(result.status, 'LOCAL_REVIEW_EVIDENCE_READY');
  assert.equal(result.reviewReceipt.verdict, 'findings');
  assert.equal(result.reviewReceipt.findings[0].severity, 'P1');
  assert.equal(result.mergeAuthority, false);
});

test('blocks same-session reviews, unbounded diffs, binary changes and incomplete identity', async () => {
  const cases = [
    { implementerProvider:'sovereign-local-ollama', implementerSessionId: sample.reviewerSessionId },
    { diff: 'diff --git a/a b/a\n' + 'x'.repeat(100_000) },
    { diff: 'diff --git a/a b/a\nBinary files differ' },
    { sourceHead: 'invalid' },
    { reviewerSessionId: '' },
    { changedFiles: ['src/sample.js', 'src/sample.js'] },
  ];
  for (const change of cases) {
    const result = inspectSovereignReviewSnapshot({ ...sample, ...change });
    assert.equal(result.status, 'SOVEREIGN_REVIEW_HELD', JSON.stringify(change).slice(0, 80));
    assert.equal(result.mergeAuthority, false);
  }
});

test('holds absent model and never mistakes it for a clean review', async () => {
  const result = await evaluateSovereignReviewSnapshot(sample, { invokeModel: async () => { throw new Error('offline'); } });
  assert.equal(result.reason, 'LOCAL_MODEL_UNAVAILABLE');
  assert.equal(result.mergeAuthority, false);
});

test('blocks local clearance for OpenClaw authority and exact-head review engine edits', () => {
  for (const file of [
    'shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs',
    'shared/agents/exactHeadReviewDispatchCoordinator.mjs',
    'shared/agents/sovereignCommanderV1.mjs',
    'scripts/exact-head-review-dispatch.mjs',
  ]) {
    const result = inspectSovereignReviewSnapshot({ ...sample, changedFiles: [file] });
    assert.equal(result.reason, 'QUALIFIED_HIGH_RISK_SPECIALIST_REQUIRED', file);
  }
});
