import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLiveTelemetryQuestion, classifyGithubNotification, normalizeGithubTelemetry, readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { fetchGithubPrEvidence } from '../stephanos-server/services/githubPrEvidenceService.js';
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


function okJson(payload) { return { ok: true, status: 200, json: async () => payload }; }
function forbidden() { return { ok: false, status: 403, json: async () => ({ message: 'forbidden' }) }; }
function telemetryFetchRecorder(calls, { forbiddenToken = '' } = {}) {
  return async (url, init = {}) => {
    const auth = String(init.headers?.Authorization || '');
    calls.push({ url, auth });
    if (forbiddenToken && auth === `Bearer ${forbiddenToken}`) return forbidden();
    if (url.includes('/notifications')) return okJson([]);
    if (url.includes('/pulls?')) return okJson([]);
    if (url.includes('/actions/runs')) return okJson({ workflow_runs: [] });
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
