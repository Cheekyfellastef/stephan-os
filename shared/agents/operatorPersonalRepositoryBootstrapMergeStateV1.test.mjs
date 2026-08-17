import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH,
  PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR,
  PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS,
  classifyPersonalRepositoryBootstrapMergeStateV1,
  validatePersonalRepositoryEvidence,
  validatePersonalRepositoryWorkflowRuns,
} from './operatorPersonalRepositoryMergeV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const sourceTree = 'c'.repeat(40);
const baseSha = 'b'.repeat(40);

function evidenceInput(overrides = {}) {
  return {
    repository,
    repositoryOwnerType: 'User',
    eventName: 'workflow_dispatch',
    triggeringActor: 'Cheekyfellastef',
    workflowRunId: 9001,
    workflowRunAttempt: 1,
    pullRequest: {
      number: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR,
      state: 'open',
      draft: false,
      head: { ref: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH, sha: sourceHead },
      base: { ref: 'main', sha: baseSha },
    },
    liveMainRef: { object: { sha: baseSha } },
    headCommit: { sha: sourceHead, tree: { sha: sourceTree } },
    comparison: {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      base_commit: { sha: baseSha },
      merge_base_commit: { sha: baseSha },
    },
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    unresolvedThreadCount: 0,
    ...overrides,
  };
}

const expected = Object.freeze({
  repository,
  prNumber: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR,
  branch: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH,
  sourceHead,
  sourceTree,
  baseSha,
  workflowRunId: 9001,
  workflowRunAttempt: 1,
});

test('bootstrap compatibility admits only the exact #1838 unstable merge-state blocker', () => {
  const classification = classifyPersonalRepositoryBootstrapMergeStateV1(evidenceInput(), expected);
  assert.equal(classification.target, true);
  assert.equal(classification.unstableCompatibilityAllowed, true);

  const admitted = validatePersonalRepositoryEvidence(evidenceInput(), expected);
  assert.equal(admitted.valid, true);
  assert.equal(admitted.finalVerdict, 'PERSONAL_REPOSITORY_EVIDENCE_READY');
  assert.deepEqual(admitted.blockers, []);

  const unrelated = validatePersonalRepositoryEvidence(evidenceInput({ unresolvedThreadCount: 1 }), expected);
  assert.equal(unrelated.valid, false);
  assert.ok(unrelated.blockers.includes('personal-repository-conversations-not-resolved'));

  const wrongState = validatePersonalRepositoryEvidence(evidenceInput({ mergeStateStatus: 'BLOCKED' }), expected);
  assert.equal(wrongState.valid, false);
  assert.ok(wrongState.blockers.includes('personal-repository-pr-not-clean'));

  const wrongBranchExpected = { ...expected, branch: 'fix/not-the-authorized-bootstrap-branch' };
  const wrongBranch = validatePersonalRepositoryEvidence(evidenceInput(), wrongBranchExpected);
  assert.equal(wrongBranch.valid, false);
});

function workflowEstate(extraRuns = [], stephanosConclusion = 'failure') {
  const definitions = PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((entry, index) => ({
    id: 1000 + index,
    name: entry.name,
    path: entry.path,
    state: 'active',
  }));
  const runs = PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.map((entry, index) => ({
    id: 2000 + index,
    run_number: 3000 + index,
    run_attempt: 1,
    workflow_id: 1000 + index,
    name: entry.name,
    path: entry.path,
    event: entry.event,
    status: 'completed',
    conclusion: 'success',
    head_sha: sourceHead,
    repository: { full_name: repository },
    check_suite_id: 4000 + index,
    pull_requests: [{
      number: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_PR,
      head: { ref: PERSONAL_REPOSITORY_BOOTSTRAP_COMPATIBILITY_BRANCH, sha: sourceHead },
      base: { ref: 'main', sha: baseSha },
    }],
  }));
  runs.push({
    id: 5001,
    run_number: 5001,
    name: 'Independent Merge Security Review',
    event: 'pull_request_target',
    status: 'completed',
    conclusion: 'success',
    head_sha: sourceHead,
    repository: { full_name: repository },
  });
  runs.push({
    id: 5002,
    run_number: 5002,
    name: 'Stephanos Exact-Head Review',
    event: 'pull_request_target',
    status: 'completed',
    conclusion: stephanosConclusion,
    head_sha: sourceHead,
    repository: { full_name: repository },
  });
  runs.push(...extraRuns);
  return { definitions, runs };
}

test('bootstrap workflow estate permits the deliberate Stephanos bootstrap failure but rejects any unrelated failed or pending workflow', () => {
  const clean = workflowEstate();
  const admitted = validatePersonalRepositoryWorkflowRuns(clean.definitions, clean.runs, expected);
  assert.equal(admitted.valid, true);

  const failedExtra = workflowEstate([{
    id: 6001,
    run_number: 6001,
    name: 'Unrelated Safety Check',
    status: 'completed',
    conclusion: 'failure',
    head_sha: sourceHead,
    repository: { full_name: repository },
  }]);
  const failed = validatePersonalRepositoryWorkflowRuns(failedExtra.definitions, failedExtra.runs, expected);
  assert.equal(failed.valid, false);
  assert.ok(failed.blockers.some((value) => value.includes('personal-repository-bootstrap-unrelated-workflow-not-clean')));

  const pendingExtra = workflowEstate([{
    id: 6002,
    run_number: 6002,
    name: 'Unrelated Pending Check',
    status: 'in_progress',
    conclusion: '',
    head_sha: sourceHead,
    repository: { full_name: repository },
  }]);
  const pending = validatePersonalRepositoryWorkflowRuns(pendingExtra.definitions, pendingExtra.runs, expected);
  assert.equal(pending.valid, false);
});
