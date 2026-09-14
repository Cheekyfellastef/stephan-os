import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePersonalRepositoryCheckRuns } from './operatorPersonalRepositoryMergeV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 2091;
const branch = 'agent/source-artifact-escrow-failover-v1';
const sourceHead = '043b62c3f9e6075caa9a098f2f46b03c0e16b483';
const baseSha = '88946c2805a8000c0f2e2239a80ffedd8d1591fe';

function reviewRun(overrides = {}) {
  return {
    id: 33618887572,
    run_attempt: 1,
    check_suite_id: 91100492492,
    name: 'Stephanos Exact-Head Review',
    path: `${repository}/.github/workflows/stephanos-exact-head-review.yml@refs/heads/main`,
    event: 'pull_request_target',
    repository: { full_name: repository },
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'skipped',
    pull_requests: [{
      number: prNumber,
      head: { sha: sourceHead, ref: branch },
      base: { sha: baseSha, ref: 'main' },
    }],
    ...overrides,
  };
}

function reviewCheck(run = reviewRun(), overrides = {}) {
  const id = 100211045175;
  return {
    id,
    name: 'exact-head-review',
    head_sha: sourceHead,
    status: 'completed',
    conclusion: 'skipped',
    details_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${id}`,
    app: { id: 15368, slug: 'github-actions' },
    check_suite: { id: run.check_suite_id },
    ...overrides,
  };
}

const expected = Object.freeze({
  repository,
  prNumber,
  branch,
  sourceHead,
  baseSha,
  mergeStateStatus: 'CLEAN',
});

test('exact clean independent assurance supersedes only the draft-era skipped exact-head review', () => {
  const run = reviewRun();
  const result = validatePersonalRepositoryCheckRuns(
    [reviewCheck(run)],
    [run],
    [],
    expected,
    { cleanIndependentReviewProved: true },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.admittedReviewEscalations, 0);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].workflow, 'Stephanos Exact-Head Review');
  assert.equal(result.evidence[0].name, 'exact-head-review');
  assert.equal(result.evidence[0].conclusion, 'skipped');
  assert.equal(result.evidence[0].disposition, 'clean-independent-review-superseded-draft-skip');
});

test('the same skipped exact-head review remains blocked without exact clean independent assurance', () => {
  const run = reviewRun();
  const result = validatePersonalRepositoryCheckRuns(
    [reviewCheck(run)],
    [run],
    [],
    expected,
    { cleanIndependentReviewProved: false },
  );

  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('personal-repository-check-run-not-exact-green'));
});

test('clean independent assurance does not whitelist an unrelated skipped check', () => {
  const run = reviewRun({
    id: 33618887573,
    check_suite_id: 91100492493,
    name: 'Unrelated Workflow',
    path: `${repository}/.github/workflows/unrelated.yml@refs/heads/main`,
    event: 'pull_request_target',
  });
  const check = reviewCheck(run, { name: 'unrelated-check' });
  const result = validatePersonalRepositoryCheckRuns(
    [check],
    [run],
    [],
    expected,
    { cleanIndependentReviewProved: true },
  );

  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('personal-repository-check-run-not-exact-green'));
});

test('wrong-head skipped review cannot inherit exact clean assurance', () => {
  const wrongHead = '1111111111111111111111111111111111111111';
  const run = reviewRun({ head_sha: wrongHead });
  const check = reviewCheck(run, { head_sha: wrongHead });
  const result = validatePersonalRepositoryCheckRuns(
    [check],
    [run],
    [],
    expected,
    { cleanIndependentReviewProved: true },
  );

  assert.equal(result.valid, false);
  assert.ok(result.blockers.some((blocker) => (
    blocker === 'personal-repository-check-run-identity-invalid'
      || blocker === 'personal-repository-check-workflow-run-missing'
  )));
});
