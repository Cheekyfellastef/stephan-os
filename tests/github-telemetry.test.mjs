import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLiveTelemetryQuestion, buildExecutionChains, classifyGithubNotification, normalizeGithubTelemetry, readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { fetchGithubPrEvidence } from '../stephanos-server/services/githubPrEvidenceService.js';
import { buildLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';
import { REQUIRED_EXACT_HEAD_WORKFLOWS } from '../shared/agents/operatorMergeApprovalGate.mjs';

function requiredChecks(headSha, conclusion = 'success') {
  return REQUIRED_EXACT_HEAD_WORKFLOWS.map((name, index) => ({
    name,
    headSha,
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
  const live = normalizeGithubTelemetry({ available: true, issues: [{ number: 1497, title: 'Goal: continuous repair', state: 'open', labels: [{ name: 'goal' }], assignees: [{ login: 'codex' }], updated_at: '2026-07-29T12:00:00Z' }, { number: 7, title: 'PR-shaped issue', pull_request: {} }], issueInventoryComplete: true, pullRequests: [{ number: 42, title: 'Goal API for #1497', body: 'Fixes #1497.', branch: 'work', headSha, checks: requiredChecks(headSha), approvalStatus: 'approved' }], pullRequestInventoryComplete: true, workflows: [{ id: 1, name: 'verify', conclusion: 'failure', prNumber: 42 }, { id: 2, name: 'build', conclusion: 'success', prNumber: 42 }, { id: 3, name: 'deploy', conclusion: 'cancelled' }] });
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

test('PR issue correlation accepts explicit closing references and rejects incidental mentions', () => {
  const headSha = 'e'.repeat(40);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    repository: { owner: 'owner', repo: 'repo' },
    issues: [],
    pullRequests: [
      { number: 60, title: 'Supersedes #123', body: 'Background context from #456.', branch: 'issue-789', headSha, checks: requiredChecks(headSha) },
      { number: 61, title: 'Durable link', body: 'Fixes #1497 and resolves owner/repo#1619.', headSha, checks: requiredChecks(headSha) },
      { number: 62, title: 'Adapter-provided link', relatedIssues: [1282], headSha, checks: requiredChecks(headSha) },
      { number: 63, title: 'Foreign durable link', body: 'Fixes other/repo#1497.', closingIssueReferences: [{ number: 1619, repository: 'other/repo' }], headSha, checks: requiredChecks(headSha) },
    ],
  });
  assert.deepEqual(telemetry.pullRequests[0].relatedIssues, []);
  assert.deepEqual(telemetry.pullRequests[1].relatedIssues, [1497, 1619]);
  assert.deepEqual(telemetry.pullRequests[2].relatedIssues, [1282]);
  assert.deepEqual(telemetry.pullRequests[3].relatedIssues, []);
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
