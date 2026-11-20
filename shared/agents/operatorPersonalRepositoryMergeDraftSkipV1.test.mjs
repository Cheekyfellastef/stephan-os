import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePersonalRepositoryCheckRuns } from './operatorPersonalRepositoryMergeV1.mjs';
import { readyLifecycleFixture, clock } from './fixtures/protectedReadyReviewLifecycleV1.fixture.mjs';

function estate(f) {
  const run = { id: 50, run_attempt: 1, name: 'Stephanos Exact-Head Review',
    path: '.github/workflows/stephanos-exact-head-review.yml', event: 'pull_request_target',
    repository: { full_name: f.identity.repository }, head_sha: f.identity.sourceHead, head_branch: f.identity.branch,
    check_suite_id: 2050, status: 'completed', conclusion: 'skipped', created_at: clock(-120),
    pull_requests: [{ number: f.identity.prNumber, head: { sha: f.identity.sourceHead, ref: f.identity.branch },
      base: { sha: f.identity.baseSha, ref: 'main' } }] };
  const check = { id: 51, name: 'exact-head-review', head_sha: f.identity.sourceHead,
    status: 'completed', conclusion: 'skipped', app: { id: 15368, slug: 'github-actions' },
    check_suite: { id: 2050 }, details_url: `https://github.com/${f.identity.repository}/actions/runs/50/job/51` };
  return { run, check, expected: { ...f.identity, mergeStateStatus: 'CLEAN' } };
}

test('obsolete #2094 clean-boolean draft-skip waiver remains rejected in every merge state', () => {
  const f = readyLifecycleFixture(), e = estate(f);
  for (const mergeStateStatus of ['CLEAN', 'BLOCKED', 'UNSTABLE']) {
    const result = validatePersonalRepositoryCheckRuns([e.check], [e.run], [], { ...e.expected, mergeStateStatus },
      { cleanIndependentReviewProved: true });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('personal-repository-check-run-not-exact-green'));
  }
});

test('a real artifact-bound lifecycle proof supersedes only the precise historical canonical draft skip', () => {
  const f = readyLifecycleFixture(), e = estate(f), before = JSON.stringify(e);
  const result = validatePersonalRepositoryCheckRuns([e.check], [e.run], [], e.expected,
    { cleanIndependentReviewProved: true, readyReviewLifecycleEvidence: f.proof });
  assert.equal(result.valid, true, result.blockers.join(','));
  assert.equal(result.evidence[0].disposition, 'reviewed-ready-lifecycle');
  assert.equal(result.evidence[0].conclusion, 'skipped');
  assert.equal(result.evidence[0].workflowRunId, 50);
  assert.equal(result.evidence[0].readyReviewLifecycle.workflowRunId, 200);
  assert.equal(JSON.stringify(e), before);
  for (const altered of [{ ...e.run, event: 'issue_comment' }, { ...e.run, path: '.github/workflows/other.yml' },
    { ...e.run, created_at: clock(99) }, { ...e.run, name: 'Other Review' }]) {
    assert.equal(validatePersonalRepositoryCheckRuns([e.check], [altered], [], e.expected,
      { readyReviewLifecycleEvidence: f.proof }).valid, false);
  }
});

test('lifecycle proof cannot suppress unrelated pending, failed, skipped checks or failed commit statuses', () => {
  const f = readyLifecycleFixture(), e = estate(f);
  for (const [status, conclusion] of [['in_progress', null], ['completed', 'failure'], ['completed', 'skipped']]) {
    const extra = { ...e.check, id: 52, name: 'some-other-required-proof', status, conclusion,
      details_url: `https://github.com/${f.identity.repository}/actions/runs/50/job/52` };
    assert.equal(validatePersonalRepositoryCheckRuns([e.check, extra], [e.run], [], e.expected,
      { readyReviewLifecycleEvidence: f.proof }).valid, false);
  }
  assert.equal(validatePersonalRepositoryCheckRuns([e.check], [e.run], [{ sha: f.identity.sourceHead, state: 'failure' }],
    e.expected, { readyReviewLifecycleEvidence: f.proof }).valid, false);
});

test('missing tree, failed producer, forged clean result and changed source still block the original skip', () => {
  const cases = [
    f => { f.proof.handoff.run.conclusion = 'failure'; },
    f => { f.proof.review.artifact.payload = { ...f.proof.review.artifact.payload, qualification: { ok: true } }; },
    f => { f.proof.review.run.head_sha = f.identity.sourceHead; },
    f => { f.identity = { ...f.identity, sourceTree: '' }; },
  ];
  for (const mutate of cases) {
    const f = readyLifecycleFixture(); mutate(f); const e = estate(f);
    assert.equal(validatePersonalRepositoryCheckRuns([e.check], [e.run], [], e.expected,
      { cleanIndependentReviewProved: true, readyReviewLifecycleEvidence: f.proof }).valid, false);
  }
});
