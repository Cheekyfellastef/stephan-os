import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLiveTelemetryQuestion, classifyGithubNotification, normalizeGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { buildLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';

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

test('GitHub telemetry projects PRs workflows unavailable state and no fabricated truth', () => {
  const live = normalizeGithubTelemetry({ available: true, pullRequests: [{ number: 42, title: 'Goal API', branch: 'work', headSha: 'a'.repeat(40), checks: [{ conclusion: 'success' }], approvalStatus: 'approved' }], workflows: [{ id: 1, name: 'verify', conclusion: 'failure', prNumber: 42 }, { id: 2, name: 'build', conclusion: 'success', prNumber: 42 }, { id: 3, name: 'deploy', conclusion: 'cancelled' }] });
  assert.equal(live.pullRequests[0].checksStatus, 'passed');
  assert.equal(live.workflowCounts.failed, 1);
  assert.equal(live.workflowCounts.passed, 1);
  assert.equal(live.workflowCounts.cancelled, 1);
  const unavailable = normalizeGithubTelemetry({ available: false });
  assert.equal(unavailable.status, 'adapter_unavailable');
  assert.deepEqual(unavailable.pullRequests, []);
  assert.equal(unavailable.blockers.includes('github_adapter_unavailable'), true);
});

test('live projection correlates goals to PR workflow chain and command deck answers from telemetry', () => {
  const githubTelemetry = normalizeGithubTelemetry({ available: true, notifications: [{ id: 'n1', reason: 'review_requested', subject: { title: 'Review PR 42', type: 'PullRequest' } }], pullRequests: [{ number: 42, title: 'Historical Mission Control API', branch: 'work', headSha: 'b'.repeat(40), checks: [{ conclusion: 'success' }], approvalStatus: 'approved' }], workflows: [{ id: 1, name: 'verify', conclusion: 'failure', prNumber: 42 }] });
  const projection = buildLiveGoalProjection({ backendStatus: { status: 'live', ok: true }, missionOperationsFeed: { status: 'ready', missions: [], errors: [] }, importedGoals: { receipts: [], candidates: [{ candidateId: 'goal-42', title: 'Historical Mission Control API', intent: 'API', lastKnownPR: '#42', status: 'open' }] }, githubTelemetry });
  assert.equal(projection.githubTelemetry.notificationCounts['Review requested'], 1);
  assert.equal(projection.executionChains[0].pr.number, 42);
  assert.equal(projection.executionChains[0].workflows[0].status, 'failed');
  assert.match(answerLiveTelemetryQuestion('Which workflows failed?', projection), /verify#1/);
  assert.match(answerLiveTelemetryQuestion('What GitHub notifications need my attention?', projection), /Review requested/);
  assert.match(answerLiveTelemetryQuestion('Which PR is safest to merge?', projection), /#42/);
});
