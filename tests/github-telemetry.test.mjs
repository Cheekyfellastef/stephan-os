import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLiveTelemetryQuestion, buildExecutionChains, classifyGithubNotification, normalizeGithubTelemetry, readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { fetchGithubPrEvidence } from '../stephanos-server/services/githubPrEvidenceService.js';
import { buildLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';
import { REQUIRED_EXACT_HEAD_WORKFLOWS } from '../shared/agents/exactHeadReviewDispatchCoordinator.mjs';

function requiredChecks(headSha, conclusion = 'success') {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    name,
    headSha,
    status: 'completed',
    conclusion,
    updatedAt: `2026-07-30T10:0${index}:00.000Z`,
  }));
}

test('GitHub notifications classify into required categories and count unread state', () => {
  const telemetry = normalizeGithubTelemetry({ available: true, notifications: [
    { id: 'n1', reason: 'review_requested', subject: { title: 'Review PR 10', type: 'PullRequest' } },
    { id: 'n2', reason: 'mention', subject: { title: 'Need you here' } },
    { id: 'n3', reason: 'subscribed', subject: { title: 'CI failure on branch' } },
    { id: 'n4', reason: 'subscribed', subject: { title: 'Workflow failure: verify' } },
    { id: 'n5', reason: 'subscribed', subject: { title: 'Merge completed for PR 8' } },
    { id: 'n6', reason: 'subscribed', subject: { title: 'Goal related Mission Control' } },
    { id: 'n7', reason: 'subscribed', unread: false, subject: { title: 'Archived thread' } },
  ] }, { now: new Date('2026-07-02T00:00:00.000Z') });
  assert.equal(classifyGithubNotification({ reason: 'subscribed', subject: { type: 'PullRequest', title: 'PR' } }), 'Actionable PR');
  assert.equal(telemetry.notificationCounts['Review requested'], 1);
  assert.equal(telemetry.notificationCounts.Mention, 1);
  assert.equal(telemetry.notificationCounts['CI failure'], 1);
  assert.equal(telemetry.notificationCounts['Workflow failure'], 1);
  assert.equal(telemetry.notificationCounts['Merge completed'], 1);
  assert.equal(telemetry.notificationCounts['Goal related'], 1);
  assert.equal(telemetry.notificationCounts['Historical/no-action'], 1);
});

test('GitHub telemetry projects complete PR and issue inventories, workflows, unavailable state, and no fabricated truth', () => {
  const headSha = 'a'.repeat(40);
  const live = normalizeGithubTelemetry({ available: true, repository: { owner: 'owner', repo: 'repo', defaultBranch: 'main' }, issues: [{ number: 1497, title: 'Goal: continuous repair', state: 'open', labels: [{ name: 'goal' }], assignees: [{ login: 'codex' }], updated_at: '2026-07-29T12:00:00Z' }, { number: 7, title: 'PR-shaped issue', pull_request: {} }], issueInventoryComplete: true, pullRequests: [{ number: 42, title: 'Goal API for #1497', body: 'Fixes #1497.', base: { ref: 'main' }, branch: 'work', headSha, checks: requiredChecks(headSha), approvalStatus: 'approved' }], pullRequestInventoryComplete: true, workflows: [{ id: 1, name: 'verify', conclusion: 'failure', prNumber: 42 }, { id: 2, name: 'build', conclusion: 'success', prNumber: 42 }, { id: 3, name: 'deploy', conclusion: 'cancelled' }] });
  assert.equal(live.pullRequests[0].checksStatus, 'passed');
  assert.deepEqual(live.pullRequests[0].relatedIssues, [1497]);
  assert.equal(live.issues[0].number, 1497);
  assert.deepEqual(live.issues[0].labels, ['goal']);
  assert.equal(live.issueCount, 1);
  assert.equal(live.issueInventoryObserved, true);
  assert.equal(live.workflowCounts.failed, 1);
  assert.equal(live.workflowCounts.passed, 1);
  assert.equal(live.workflowCounts.cancelled, 1);
  const unavailable = normalizeGithubTelemetry({ available: false });
  assert.equal(unavailable.status, 'adapter_unavailable');
  assert.deepEqual(unavailable.pullRequests, []);
  assert.equal(unavailable.blockers.includes('github_adapter_unavailable'), true);
  assert.equal(unavailable.issueInventoryObserved, false);
});

test('live projection correlates goals to PR workflow chain and command deck answers from telemetry', () => {
  const headSha = 'b'.repeat(40);
  const githubTelemetry = normalizeGithubTelemetry({ available: true, notifications: [{ id: 'n1', reason: 'review_requested', subject: { title: 'Review PR 42', type: 'PullRequest' } }], pullRequests: [{ number: 42, title: 'Historical Mission Control API', branch: 'work', headSha, checks: requiredChecks(headSha), approvalStatus: 'approved' }], workflows: [{ id: 1, name: 'verify', conclusion: 'failure', head_sha: headSha, prNumber: 42 }] });
  const projection = buildLiveGoalProjection({ backendStatus: { status: 'live', ok: true }, missionOperationsFeed: { status: 'ready', missions: [], errors: [] }, createdGoalCandidates: [{ candidateId: 'goal-42', title: 'Current Mission Control API', intent: 'API', lastKnownPR: '#42', status: 'open' }], githubTelemetry });
  assert.equal(projection.githubTelemetry.notificationCounts['Review requested'], 1);
  assert.equal(projection.executionChains[0].pr.number, 42);
  assert.equal(projection.executionChains[0].workflows[0].status, 'failed');
  assert.match(answerLiveTelemetryQuestion('Which workflows failed?', projection), /verify#1/);
  assert.match(answerLiveTelemetryQuestion('What GitHub notifications need my attention?', projection), /Review requested/);
  assert.match(answerLiveTelemetryQuestion('Which PR is safest to merge?', projection), /#42/);
});

test('PR readiness requires the complete canonical workflow set on the unchanged exact head', () => {
  const currentHead = 'c'.repeat(40);
  const staleHead = 'd'.repeat(40);
  assert.equal(REQUIRED_EXACT_HEAD_WORKFLOWS.includes('Exact-Head Review Dispatch'), false);
  assert.equal(REQUIRED_EXACT_HEAD_WORKFLOWS.includes('Protected Operator Merge Source Proof'), false);
  const incomplete = normalizeGithubTelemetry({
    available: true,
    issues: [],
    pullRequests: [{ number: 50, headSha: currentHead, body: 'Fixes #1497', mergeReadiness: 'merge_ready' }],
    workflows: [
      ...requiredChecks(staleHead).map((run, index) => ({ ...run, id: `stale-${index}`, prNumber: 50 })),
      ...requiredChecks(currentHead).slice(0, -1).map((run, index) => ({ ...run, id: `current-${index}`, prNumber: 50 })),
    ],
  });
  assert.equal(incomplete.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(incomplete.pullRequests[0].missingRequiredChecks, [REQUIRED_EXACT_HEAD_WORKFLOWS.at(-1)]);
  assert.equal(incomplete.pullRequests[0].mergeReadiness, 'blocked_or_unknown');

  const complete = normalizeGithubTelemetry({
    available: true,
    issues: [],
    pullRequests: [{ number: 50, headSha: currentHead, body: 'Fixes #1497' }],
    workflows: requiredChecks(currentHead).map((run, index) => ({ ...run, id: `current-${index}`, prNumber: 50 })),
  });
  assert.equal(complete.pullRequests[0].checksStatus, 'passed');
  assert.deepEqual(complete.pullRequests[0].missingRequiredChecks, []);
});

test('neutral and skipped exact-head workflows never count as successful proof', () => {
  const headSha = '9'.repeat(40);
  for (const conclusion of ['neutral', 'skipped']) {
    const telemetry = normalizeGithubTelemetry({
      available: true,
      issues: [],
      issueInventoryComplete: true,
      pullRequests: [{ number: 51, headSha, body: 'Fixes #1497' }],
      pullRequestInventoryComplete: true,
      workflows: requiredChecks(headSha, conclusion).map((run, index) => ({ ...run, id: `${conclusion}-${index}`, prNumber: 51 })),
    });
    assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
    assert.deepEqual(telemetry.pullRequests[0].missingRequiredChecks, []);
    assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
    assert.equal(telemetry.pullRequests[0].blockers.includes('checks_not_passed_or_unknown'), true);
  }
});

test('synthetic passed statuses without completed-success conclusions never satisfy exact-head proof', () => {
  const headSha = '8'.repeat(40);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{
      number: 52,
      headSha,
      checks: requiredChecks(headSha).map(({ name, updatedAt }) => ({ name, headSha, status: 'passed', updatedAt })),
    }],
    pullRequestInventoryComplete: true,
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('newer workflow evidence overrides stale embedded checks for the same exact head', () => {
  const headSha = '7'.repeat(40);
  const staleChecks = requiredChecks(headSha).map((check) => ({ ...check, updatedAt: '2026-07-30T09:00:00.000Z' }));
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 53, headSha, checks: staleChecks }],
    pullRequestInventoryComplete: true,
    workflows: [{
      id: 'new-failure',
      workflow_id: 101,
      name: REQUIRED_EXACT_HEAD_WORKFLOWS[0],
      headSha,
      prNumber: 53,
      status: 'completed',
      conclusion: 'failure',
      updatedAt: '2026-07-30T11:00:00.000Z',
    }],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [REQUIRED_EXACT_HEAD_WORKFLOWS[0]]);
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('conflicting exact-head evidence with unreconcilable freshness fails closed', () => {
  const headSha = '6'.repeat(40);
  const checks = requiredChecks(headSha).map(({ updatedAt, ...check }) => check);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 54, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [{
      id: 'undated-failure',
      name: REQUIRED_EXACT_HEAD_WORKFLOWS[0],
      headSha,
      prNumber: 54,
      status: 'completed',
      conclusion: 'failure',
    }],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [REQUIRED_EXACT_HEAD_WORKFLOWS[0]]);
  assert.equal(telemetry.pullRequests[0].blockers.some((blocker) => blocker.startsWith('required_exact_head_checks_conflict:')), true);
});

test('older workflow history cannot clear an equal-time exact-head conflict', () => {
  const headSha = '4'.repeat(40);
  const checks = requiredChecks(headSha).map((check) => ({ ...check, updatedAt: '2026-07-30T11:00:00.000Z' }));
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 55, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 'equal-time-failure', name: workflowName, headSha, prNumber: 55, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T11:00:00.000Z' },
      { id: 'older-success', name: workflowName, headSha, prNumber: 55, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T10:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [workflowName]);
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('canonical workflow rerun sequence outranks completion timestamps', () => {
  const headSha = '7'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).filter((check) => check.name !== workflowName);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 56, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 7001, workflow_id: 102, run_number: 41, name: workflowName, headSha, prNumber: 56, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T10:00:00.000Z' },
      { id: 6999, workflow_id: 102, run_number: 40, name: workflowName, headSha, prNumber: 56, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T11:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'failed');
  assert.equal(telemetry.pullRequests[0].checks.find((check) => check.name === workflowName).runNumber, 41);
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('check-run run numbers cannot compete with workflow-run sequence metadata', () => {
  const headSha = '6'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha)
    .filter((check) => check.name !== workflowName)
    .concat({
      id: 9999,
      run_number: 999,
      name: workflowName,
      headSha,
      status: 'completed',
      conclusion: 'success',
      updatedAt: '2026-07-30T10:00:00.000Z',
    });
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 59, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 6001, workflow_id: 103, run_number: 10, name: workflowName, headSha, prNumber: 59, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T11:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('canonical workflow run ID breaks rerun order when run numbers are unavailable', () => {
  const headSha = '8'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).filter((check) => check.name !== workflowName);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 57, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 8002, workflow_id: 104, name: workflowName, headSha, prNumber: 57, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T10:00:00.000Z' },
      { id: 8001, workflow_id: 104, name: workflowName, headSha, prNumber: 57, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T11:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'failed');
  assert.equal(telemetry.pullRequests[0].checks.find((check) => check.name === workflowName).runId, 8002);
});

test('mixed sequenced and unsequenced workflow evidence reconciles by freshness instead of metadata presence', () => {
  const headSha = '9'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).map((check) => check.name === workflowName
    ? { ...check, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T11:00:00.000Z' }
    : check);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 58, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 9001, workflow_id: 105, run_number: 40, name: workflowName, headSha, prNumber: 58, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T10:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('check-run IDs never compete with workflow-run IDs as one sequence domain', () => {
  const headSha = 'a'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).map((check) => check.name === workflowName
    ? { ...check, id: 999999999999, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T11:00:00.000Z' }
    : check);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 59, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 1000000000000, workflow_id: 106, name: workflowName, headSha, prNumber: 59, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T10:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.equal(telemetry.pullRequests[0].mergeReadiness, 'blocked_or_unknown');
});

test('workflow rerun sequence fails closed across workflow definitions sharing one display name', () => {
  const headSha = 'b'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).filter((check) => check.name !== workflowName);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 64, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 6401, workflow_id: 201, run_number: 100, name: workflowName, headSha, prNumber: 64, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T10:00:00.000Z' },
      { id: 6402, workflow_id: 202, run_number: 1, name: workflowName, headSha, prNumber: 64, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T11:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [workflowName]);
});

test('a third workflow observation cannot erase a conflict between workflow definitions', () => {
  const headSha = 'd'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).filter((check) => check.name !== workflowName);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 67, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 6701, workflow_id: 301, run_number: 100, name: workflowName, headSha, prNumber: 67, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T10:00:00.000Z' },
      { id: 6702, workflow_id: 302, run_number: 2, name: workflowName, headSha, prNumber: 67, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T10:30:00.000Z' },
      { id: 6703, workflow_id: 302, run_number: 1, name: workflowName, headSha, prNumber: 67, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T11:00:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [workflowName]);
});

test('partial rerun-attempt metadata cannot reconcile conflicting outcomes by timestamp', () => {
  const headSha = 'f'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).filter((check) => check.name !== workflowName);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 68, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 6801, workflow_id: 303, run_number: 9, name: workflowName, headSha, prNumber: 68, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T11:00:00.000Z' },
      { id: 6802, workflow_id: 303, run_number: 9, run_attempt: 2, name: workflowName, headSha, prNumber: 68, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T10:30:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [workflowName]);
});

test('later check-run success cannot override an incomparable workflow-run failure', () => {
  const headSha = 'c'.repeat(40);
  const workflowName = REQUIRED_EXACT_HEAD_WORKFLOWS[0];
  const checks = requiredChecks(headSha).map((check) => check.name === workflowName
    ? { ...check, status: 'completed', conclusion: 'success', updatedAt: '2026-07-30T11:00:00.000Z' }
    : check);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [],
    issueInventoryComplete: true,
    pullRequests: [{ number: 65, headSha, checks }],
    pullRequestInventoryComplete: true,
    workflows: [
      { id: 6501, workflow_id: 203, run_number: 8, name: workflowName, headSha, prNumber: 65, status: 'completed', conclusion: 'failure', updatedAt: '2026-07-30T10:30:00.000Z' },
    ],
  });
  assert.equal(telemetry.pullRequests[0].checksStatus, 'unknown');
  assert.deepEqual(telemetry.pullRequests[0].conflictingRequiredChecks, [workflowName]);
});

test('PR issue correlation accepts explicit closing references and rejects incidental mentions', () => {
  const headSha = 'e'.repeat(40);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    repository: { owner: 'owner', repo: 'repo', defaultBranch: 'main' },
    issues: [],
    pullRequests: [
      { number: 60, title: 'Supersedes #123', body: 'Background context from #456.', branch: 'issue-789', headSha, checks: requiredChecks(headSha) },
      { number: 61, title: 'Durable link', body: 'Fixes #1497 and resolves owner/repo#1619.', base: { ref: 'main' }, headSha, checks: requiredChecks(headSha) },
      { number: 62, title: 'Adapter-provided link', relatedIssues: [1282], headSha, checks: requiredChecks(headSha) },
      { number: 63, title: 'Foreign durable link', body: 'Fixes other/repo#1497.', closingIssueReferences: [{ number: 1619, repository: 'other/repo' }], headSha, checks: requiredChecks(headSha) },
    ],
  });
  assert.deepEqual(telemetry.pullRequests[0].relatedIssues, []);
  assert.deepEqual(telemetry.pullRequests[1].relatedIssues, [1497, 1619]);
  assert.deepEqual(telemetry.pullRequests[2].relatedIssues, [1282]);
  assert.deepEqual(telemetry.pullRequests[3].relatedIssues, []);
});

test('closing keywords bind only default-base PRs while canonical relations remain authoritative', () => {
  const headSha = '5'.repeat(40);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    repository: { owner: 'owner', repo: 'repo', default_branch: 'main' },
    issues: [],
    pullRequests: [
      { number: 64, body: 'Fixes #1497.', base: { ref: 'feature/prerequisite' }, headSha, checks: requiredChecks(headSha) },
      { number: 65, body: 'Fixes #1497.', base: { ref: 'main' }, headSha, checks: requiredChecks(headSha) },
      { number: 66, body: 'Fixes #1497.', base: { ref: 'feature/prerequisite' }, closingIssues: [{ number: 1619, repository: 'owner/repo' }], headSha, checks: requiredChecks(headSha) },
    ],
  });
  assert.deepEqual(telemetry.pullRequests[0].relatedIssues, []);
  assert.deepEqual(telemetry.pullRequests[1].relatedIssues, [1497]);
  assert.deepEqual(telemetry.pullRequests[2].relatedIssues, [1619]);
});

test('execution chains use only explicit PR or durable issue identity, never matching title text', () => {
  const chains = buildExecutionChains({
    goals: [
      { candidateId: 'goal-a', title: 'Retrospective 42' },
      { candidateId: 'goal-b', title: 'Explicit PR', lastKnownPR: '#42' },
      { candidateId: 'goal-c', title: 'Durable issue', issueNumber: 1497 },
    ],
    githubTelemetry: {
      pullRequests: [
        { number: 42, headSha: 'a'.repeat(40), relatedIssues: [] },
        { number: 43, headSha: 'b'.repeat(40), relatedIssues: [1497] },
      ],
      workflows: [],
    },
  });
  assert.equal(chains[0].pr, null);
  assert.equal(chains[1].pr.number, 42);
  assert.equal(chains[2].pr.number, 43);
});


function okJson(payload) { return { ok: true, status: 200, json: async () => payload }; }
function forbidden() { return { ok: false, status: 403, json: async () => ({ message: 'forbidden' }) }; }
function telemetryFetchRecorder(calls, { forbiddenToken = '' } = {}) {
  return async (url, init = {}) => {
    const auth = String(init.headers?.Authorization || '');
    calls.push({ url, auth });
    if (forbiddenToken && auth === `Bearer ${forbiddenToken}`) return forbidden();
    if (url.includes('/notifications')) return okJson([]);
    if (url.includes('/pulls?')) return okJson([]);
    if (url.includes('/issues?')) return okJson([]);
    if (url.includes('/actions/runs')) return okJson({ workflow_runs: [] });
    if (/\/repos\/owner\/repo(?:\?|$)/.test(url)) return okJson({ default_branch: 'main' });
    return okJson({});
  };
}

test('GitHub auth resolver uses environment token before gh CLI fallback', async () => {
  const auth = await resolveGithubAuth({ env: { STEPHANOS_GITHUB_TOKEN: 'env-token' }, secretStoreToken: '', ghTokenProvider: async () => 'gh-token' });
  assert.equal(auth.authority, 'environment');
  assert.equal(auth.token, 'env-token');
});

test('GitHub auth resolver uses gh CLI fallback when environment and secret store are missing', async () => {
  const auth = await resolveGithubAuth({ env: {}, secretStoreToken: '', ghTokenProvider: async () => 'gh-token' });
  assert.equal(auth.authority, 'gh-cli');
  assert.equal(auth.token, 'gh-token');
});

test('GitHub telemetry retries once with gh CLI token after explicit 403', async () => {
  const calls = [];
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'bad-env-token' },
    secretStoreToken: '',
    ghTokenProvider: async () => 'gh-token',
    fetchImpl: telemetryFetchRecorder(calls, { forbiddenToken: 'bad-env-token' }),
  });
  assert.equal(telemetry.status, 'live');
  assert.equal(telemetry.authAuthority, 'gh-cli');
  assert.equal(calls.some((call) => call.auth === 'Bearer bad-env-token'), true);
  assert.equal(calls.some((call) => call.auth === 'Bearer gh-token'), true);
});

test('GitHub telemetry reports adapter_unavailable when gh CLI fallback is missing', async () => {
  const telemetry = await readGithubTelemetry({ env: { GITHUB_REPOSITORY: 'owner/repo' }, secretStoreToken: '', ghTokenProvider: async () => '' });
  assert.equal(telemetry.status, 'adapter_unavailable');
  assert.equal(telemetry.authAuthority, 'unavailable');
});

test('GitHub telemetry output does not leak explicit or gh tokens', async () => {
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'bad-env-token' },
    secretStoreToken: '',
    ghTokenProvider: async () => 'gh-secret-token',
    fetchImpl: telemetryFetchRecorder([], { forbiddenToken: 'bad-env-token' }),
  });
  const serialized = JSON.stringify(telemetry);
  assert.equal(serialized.includes('bad-env-token'), false);
  assert.equal(serialized.includes('gh-secret-token'), false);
});

test('GitHub telemetry reports authority=gh-cli when fallback succeeds', async () => {
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo' },
    secretStoreToken: '',
    ghTokenProvider: async () => 'gh-token',
    fetchImpl: telemetryFetchRecorder([]),
  });
  assert.equal(telemetry.status, 'live');
  assert.equal(telemetry.authAuthority, 'gh-cli');
  assert.equal(telemetry.mutationAllowed, false);
  assert.equal(telemetry.mergeAllowed, false);
});

test('notification permission failure degrades advisory counts without discarding repository truth', async () => {
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'repo-token' },
    secretStoreToken: '',
    fetchImpl: async (url) => {
      if (url.includes('/notifications')) return forbidden();
      if (url.includes('/pulls?')) return okJson([]);
      if (url.includes('/issues?')) return okJson([{ number: 1, title: 'Current goal', state: 'open' }]);
      if (url.includes('/actions/runs')) return okJson({ workflow_runs: [] });
      if (/\/repos\/owner\/repo(?:\?|$)/.test(url)) return okJson({ default_branch: 'main' });
      return okJson({});
    },
  });
  assert.equal(telemetry.status, 'live');
  assert.equal(telemetry.issueInventoryComplete, true);
  assert.equal(telemetry.issueCount, 1);
  assert.equal(telemetry.notificationStatus, 'unavailable');
  assert.equal(telemetry.blockers.includes('github_notifications_unavailable'), false);
  assert.equal(telemetry.warnings.includes('github_notifications_unavailable'), true);
  const projection = buildLiveGoalProjection({
    backendStatus: { status: 'live', ok: true },
    missionOperationsFeed: { status: 'empty', missions: [], errors: [] },
    githubTelemetry: telemetry,
  });
  assert.equal(projection.blockers.includes('github_notifications_unavailable'), false);
});

test('GitHub telemetry fetches workflow evidence by each open PR exact head', async () => {
  const calls = [];
  const firstHead = 'a'.repeat(40);
  const secondHead = 'b'.repeat(40);
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'repo-token' },
    secretStoreToken: '',
    fetchImpl: async (url) => {
      calls.push(url);
      const parsed = new URL(url);
      if (url.includes('/notifications')) return okJson([]);
      if (url.includes('/pulls?')) return okJson([
        { number: 10, head: { sha: firstHead } },
        { number: 11, head: { sha: secondHead } },
      ]);
      if (url.includes('/issues?')) return okJson([]);
      if (url.includes('/actions/runs')) {
        const headSha = parsed.searchParams.get('head_sha');
        return okJson({
          total_count: 1,
          workflow_runs: [{
            id: headSha === firstHead ? 101 : 102,
            name: REQUIRED_EXACT_HEAD_WORKFLOWS[0],
            status: 'completed',
            conclusion: 'success',
            head_sha: headSha,
          }],
        });
      }
      if (/\/repos\/owner\/repo(?:\?|$)/.test(url)) return okJson({ default_branch: 'main' });
      return okJson({});
    },
  });
  assert.equal(telemetry.workflows.length, 2);
  assert.deepEqual(telemetry.workflows.map((run) => run.prNumber), [10, 11]);
  assert.equal(telemetry.workflowInventoryComplete, true);
  assert.equal(calls.filter((url) => url.includes('/actions/runs')).length, 2);
  assert.equal(calls.every((url) => !url.includes('/actions/runs') || (url.includes('head_sha=') && url.includes('event=pull_request'))), true);
});

test('per-head workflow cap degrades only workflow evidence without scanning repository history', async () => {
  const headSha = 'a'.repeat(40);
  const fullPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `Historical workflow ${index + 1}`,
    status: 'completed',
    conclusion: 'success',
    head_sha: 'a'.repeat(40),
  }));
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'repo-token' },
    secretStoreToken: '',
    fetchImpl: async (url) => {
      if (url.includes('/notifications')) return okJson([]);
      if (url.includes('/pulls?')) return okJson([{ number: 10, head: { sha: headSha } }]);
      if (url.includes('/issues?')) return okJson([{ number: 1, title: 'Current goal', state: 'open' }]);
      if (url.includes('/actions/runs')) return okJson({ total_count: 101, workflow_runs: fullPage });
      if (/\/repos\/owner\/repo(?:\?|$)/.test(url)) return okJson({ default_branch: 'main' });
      return okJson({});
    },
  });
  assert.equal(telemetry.status, 'live');
  assert.equal(telemetry.adapterAvailable, true);
  assert.equal(telemetry.issueInventoryComplete, true);
  assert.equal(telemetry.workflowInventoryComplete, false);
  assert.equal(telemetry.workflows.length, 100);
  assert.equal(telemetry.blockers.some((blocker) => blocker.startsWith('github_adapter_error:')), false);
  assert.equal(telemetry.warnings.includes('github_workflow_inventory_incomplete'), true);
  const projection = buildLiveGoalProjection({
    backendStatus: { status: 'live', ok: true },
    missionOperationsFeed: { status: 'empty', missions: [], errors: [] },
    githubTelemetry: telemetry,
  });
  assert.equal(projection.blockers.includes('github_workflow_inventory_incomplete'), false);
});

test('GitHub telemetry paginates open issue inventory to exhaustion before claiming completeness', async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ number: index + 1, title: `Goal ${index + 1}`, state: 'open' }));
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'env-token' },
    secretStoreToken: '',
    fetchImpl: async (url) => {
      calls.push(url);
      const parsed = new URL(url);
      if (url.includes('/notifications')) return okJson([]);
      if (url.includes('/pulls?')) return okJson([]);
      if (url.includes('/issues?') && parsed.searchParams.get('page') === '1') return okJson(firstPage);
      if (url.includes('/issues?') && parsed.searchParams.get('page') === '2') return okJson([{ number: 101, title: 'Goal 101', state: 'open' }]);
      if (url.includes('/actions/runs')) return okJson({ workflow_runs: [] });
      return okJson([]);
    },
  });
  assert.equal(telemetry.issueCount, 101);
  assert.equal(telemetry.issueInventoryComplete, true);
  assert.equal(calls.some((url) => url.includes('/issues?') && url.includes('page=2')), true);
});

test('explicitly incomplete inventories remain visible as blockers but cannot claim complete truth', () => {
  const telemetry = normalizeGithubTelemetry({
    available: true,
    issues: [{ number: 1, title: 'Partial goal', state: 'open' }],
    issueInventoryComplete: false,
    pullRequests: [],
    pullRequestInventoryComplete: true,
  });
  assert.equal(telemetry.issueInventoryObserved, true);
  assert.equal(telemetry.issueInventoryComplete, false);
  assert.equal(telemetry.blockers.includes('github_issue_inventory_incomplete'), true);
  assert.match(telemetry.nextOperatorAction, /Restore complete GitHub/);
});

test('array presence without explicit completion receipts fails closed', async () => {
  const telemetry = await readGithubTelemetry({
    adapterData: {
      available: true,
      issues: [{ number: 1, title: 'Possibly truncated goal', state: 'open' }],
      pullRequests: [],
    },
  });
  assert.equal(telemetry.issueInventoryObserved, true);
  assert.equal(telemetry.pullRequestInventoryObserved, true);
  assert.equal(telemetry.issueInventoryComplete, false);
  assert.equal(telemetry.pullRequestInventoryComplete, false);
  assert.equal(telemetry.blockers.includes('github_issue_inventory_incomplete'), true);
  assert.equal(telemetry.blockers.includes('github_pull_request_inventory_incomplete'), true);
});

test('PR evidence uses shared resolver authority and gh CLI fallback after explicit 403', async () => {
  const calls = [];
  const auth = await resolveGithubAuth({ env: { GITHUB_TOKEN: 'bad-env-token' }, secretStoreToken: '', ghTokenProvider: async () => 'unused-gh-token' });
  const payload = await fetchGithubPrEvidence({
    owner: 'owner', repo: 'repo', prNumber: 7, auth, ghTokenProvider: async () => 'gh-token',
    fetchImpl: async (url, init = {}) => {
      const authorization = String(init.headers?.Authorization || '');
      calls.push({ url, authorization });
      if (url.includes('/pulls/7') && !url.includes('/files') && authorization === 'Bearer bad-env-token') return forbidden();
      if (url.includes('/pulls/7') && !url.includes('/files')) return okJson({ number: 7, html_url: 'https://github.com/owner/repo/pull/7', title: 'PR', state: 'open', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } });
      if (url.includes('/files')) return okJson([{ filename: 'README.md' }]);
      if (url.includes('/check-runs')) return okJson({ check_runs: [{ name: 'build', conclusion: 'success' }] });
      return okJson({});
    },
  });
  assert.equal(payload.status, 'fetched');
  assert.equal(payload.authAuthority, 'gh-cli');
  assert.equal(payload.checksStatus, 'passed');
  assert.equal(JSON.stringify(payload).includes('gh-token'), false);
  assert.equal(calls.some((call) => call.authorization === 'Bearer bad-env-token'), true);
  assert.equal(calls.some((call) => call.authorization === 'Bearer gh-token'), true);
});
