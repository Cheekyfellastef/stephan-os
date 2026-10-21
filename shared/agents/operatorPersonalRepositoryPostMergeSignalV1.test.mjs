import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePersonalRepositoryCheckRuns } from './operatorPersonalRepositoryMergeV1.mjs';

// Reproduce the API shape that blocked PR #3192 after its unmerged close/reopen.
// The run name is GitHub's expanded run-name, not the YAML workflow name.
const repository = 'Cheekyfellastef/stephan-os';
const branch = 'repair/3109-rescue-write-custody-20261021';
const sourceHead = '86b71d906344d549c3546dbc49659e29dd56b318';
const baseSha = '7fa0693505a450470031a156714071cab41f383c';
const expected = { repository, prNumber: 3192, branch, sourceHead, baseSha, mergeStateStatus: 'CLEAN' };
function fixture() {
  const run = {
    id: 39635396593, run_attempt: 1, check_suite_id: 107414172106,
    name: 'Signal Battle Bridge main advance for PR 3192',
    path: '.github/workflows/battle-bridge-main-advance-express-sync-v1.yml',
    repository: { full_name: repository }, event: 'pull_request',
    head_sha: sourceHead, head_branch: branch, status: 'completed', conclusion: 'skipped',
    pull_requests: [{ number: 3192, head: { sha: sourceHead, ref: branch }, base: { sha: baseSha, ref: 'main' } }],
  };
  const check = {
    id: 119344362852, name: 'publish-main-advance', head_sha: sourceHead,
    status: 'completed', conclusion: 'skipped',
    details_url: `https://github.com/${repository}/actions/runs/${run.id}/job/119344362852`,
    app: { id: 15368, slug: 'github-actions' }, check_suite: { id: run.check_suite_id },
  };
  return { run, check };
}
const classify = ({ run, check }) => validatePersonalRepositoryCheckRuns([check], [run], [], expected);

test('exact skipped post-merge signal does not require the PR to merge before it can merge', () => {
  const result = classify(fixture());
  assert.equal(result.valid, true, JSON.stringify(result.blockers));
  assert.equal(result.evidence[0].disposition, 'post-merge-signal-not-requested');
  assert.equal(result.admittedReviewEscalations, 0);
});

test('post-merge signal assumption remains tied to the canonical merged-only job', () => {
  const source = readFileSync(new URL('../../.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', import.meta.url), 'utf8');
  assert.match(source, /run-name: Signal Battle Bridge main advance for PR \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(source, /pull_request:\s+types: \[closed\]/);
  assert.match(source, /publish-main-advance:\s+name: publish-main-advance\s+if: \$\{\{ github\.event\.pull_request\.merged == true && github\.event\.pull_request\.base\.ref == 'main' \}\}/);
});

test('no other trigger, workflow, branch or non-skipped run inherits signal neutrality', () => {
  for (const mutation of [
    { event: 'push' }, { event: 'workflow_dispatch' }, { event: 'pull_request_target' },
    { event: 'schedule' }, { event: 'issue_comment' },
    { path: '.github/workflows/other.yml' }, { name: 'Battle Bridge Main Advance Express Sync V1' },
    { name: 'Signal Battle Bridge main advance for PR 3193' },
    { head_branch: 'main' }, { head_branch: 'another-branch' },
    { status: 'queued' }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'success' },
    { repository: { full_name: 'another/repository' } },
  ]) {
    const facts = fixture(); Object.assign(facts.run, mutation);
    assert.equal(classify(facts).valid, false, JSON.stringify(mutation));
  }
});

test('failed, cancelled, nonterminal, foreign and unknown checks still block', () => {
  for (const mutation of [
    { name: 'build' }, { name: 'test' }, { name: 'unknown' },
    { status: 'queued' }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'timed_out' },
    { head_sha: 'f'.repeat(40) }, { app: { id: 123, slug: 'github-actions' } },
    { app: { id: 15368, slug: 'another-app' } }, { check_suite: { id: 123 } },
    { details_url: 'https://example.invalid/check' },
  ]) {
    const facts = fixture(); Object.assign(facts.check, mutation);
    assert.equal(classify(facts).valid, false, JSON.stringify(mutation));
  }
});

test('exact PR/head/base/check-suite identity is required before signal disposition', () => {
  for (const change of [
    f => { f.run.pull_requests = []; },
    f => { f.run.pull_requests.push(structuredClone(f.run.pull_requests[0])); },
    f => { f.run.pull_requests[0].number = 3193; },
    f => { f.run.pull_requests[0].head.sha = 'f'.repeat(40); },
    f => { f.run.pull_requests[0].head.ref = 'another-branch'; },
    f => { f.run.pull_requests[0].base.sha = 'f'.repeat(40); },
    f => { f.run.pull_requests[0].base.ref = 'another-base'; },
    f => { f.run.head_sha = 'f'.repeat(40); },
    f => { f.run.run_attempt = 0; },
  ]) {
    const facts = fixture(); change(facts);
    assert.equal(classify(facts).valid, false, String(change));
  }
  const facts = fixture();
  assert.equal(validatePersonalRepositoryCheckRuns([facts.check], [facts.run, structuredClone(facts.run)], [], expected).valid, false);
});

test('neutral operational signal cannot mask a failed CI check or commit status', () => {
  const { check, run } = fixture();
  const failed = { ...check, id: check.id + 1, name: 'build', conclusion: 'failure',
    details_url: `https://github.com/${repository}/actions/runs/${run.id}/job/${check.id + 1}` };
  assert.equal(validatePersonalRepositoryCheckRuns([check, failed], [run], [], expected).valid, false);
  assert.equal(validatePersonalRepositoryCheckRuns([check], [run], [{ sha: sourceHead, state: 'failure' }], expected).valid, false);
});
