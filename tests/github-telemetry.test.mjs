import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLiveTelemetryQuestion, classifyGithubNotification, normalizeGithubTelemetry, readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { fetchGithubPrEvidence } from '../stephanos-server/services/githubPrEvidenceService.js';
import { buildLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrokeredGithubRateLimitHold } from '../shared/agents/githubObservationBrokerV1.mjs';

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

test('node:test sandbox never inherits implicit Battle Bridge GitHub auth', async () => {
  const auth = await resolveGithubAuth({});
  assert.equal(auth.configured, false);
  assert.equal(auth.authority, 'unavailable');
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

test('GitHub telemetry reuses one bounded backend observation inside the cache window', async () => {
  const calls = [];
  const options = {
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'cache-token' },
    secretStoreToken: '',
    fetchImpl: telemetryFetchRecorder(calls),
    cacheEnabled: true,
    cacheTtlMs: 60_000,
    now: new Date('2026-09-28T12:00:00.000Z'),
  };
  const first = await readGithubTelemetry(options);
  const second = await readGithubTelemetry(options);
  assert.equal(first.status, 'live');
  assert.equal(second.status, 'live');
  assert.equal(calls.length, 3);
});

test('GitHub telemetry reuses the successful gh CLI fallback after a primary 403', async () => {
  const calls = [];
  const options = {
    env: { GITHUB_REPOSITORY: 'owner/fallback-cache-repo', GITHUB_TOKEN: 'rate-limited-primary-token' },
    secretStoreToken: '',
    ghTokenProvider: async () => 'healthy-gh-fallback-token',
    fetchImpl: telemetryFetchRecorder(calls, { forbiddenToken: 'rate-limited-primary-token' }),
    cacheEnabled: true,
    cacheTtlMs: 60_000,
    now: new Date('2026-09-28T12:02:00.000Z'),
  };
  const first = await readGithubTelemetry(options);
  const second = await readGithubTelemetry(options);
  assert.equal(first.status, 'live');
  assert.equal(first.authAuthority, 'gh-cli');
  assert.equal(second.status, 'live');
  assert.equal(calls.length, 6);
});

test('GitHub telemetry cache is partitioned by non-secret credential fingerprint', async () => {
  const calls = [];
  const common = {
    secretStoreToken: '',
    fetchImpl: telemetryFetchRecorder(calls),
    cacheEnabled: true,
    cacheTtlMs: 60_000,
    now: new Date('2026-09-28T12:03:00.000Z'),
  };
  await readGithubTelemetry({ ...common, env: { GITHUB_REPOSITORY: 'owner/credential-partition-repo', GITHUB_TOKEN: 'credential-a' } });
  await readGithubTelemetry({ ...common, env: { GITHUB_REPOSITORY: 'owner/credential-partition-repo', GITHUB_TOKEN: 'credential-a' } });
  await readGithubTelemetry({ ...common, env: { GITHUB_REPOSITORY: 'owner/credential-partition-repo', GITHUB_TOKEN: 'credential-b' } });
  assert.equal(calls.length, 6);
});

test('GitHub telemetry fails closed within a bounded time when the optional adapter stalls', async () => {
  const startedAt = Date.now();
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'bounded-token' },
    secretStoreToken: '',
    fetchImpl: async () => new Promise(() => {}),
    requestTimeoutMs: 20,
  });

  assert.equal(telemetry.status, 'adapter_error');
  assert.match(telemetry.blockers[0], /GitHub telemetry request timed out/);
  assert.equal(Date.now() - startedAt < 500, true);
  assert.equal(JSON.stringify(telemetry).includes('bounded-token'), false);
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
      if (url.includes('/pulls/7') && !url.includes('/files')) return okJson({
        number: 7,
        html_url: 'https://github.com/owner/repo/pull/7',
        title: 'PR',
        state: 'open',
        merged: false,
        merged_at: null,
        closed_at: null,
        merge_commit_sha: null,
        head: { ref: 'feature/exact-head', sha: 'a'.repeat(40), repo: { full_name: 'owner/repo' } },
        base: { ref: 'main', sha: 'b'.repeat(40) },
      });
      if (url.includes('/files')) return okJson([{ filename: 'README.md' }]);
      if (url.includes('/check-runs')) return okJson({ check_runs: [{ name: 'build', conclusion: 'success' }] });
      if (url.includes('/issues/7/comments')) return okJson([{
        user: { login: 'github-actions[bot]' },
        body: `<!-- stephanos-protected-operator-approval -->
\`\`\`json
${JSON.stringify({
  schemaVersion: 'stephanos.protected-operator-approval.v1',
  kind: 'stephanos.protected-operator-approval',
  repository: 'owner/repo',
  prNumber: 7,
  sourceHead: 'a'.repeat(40),
  branch: 'feature/exact-head',
  environment: 'operator-merge-approval',
  protectionBoundary: 'github-protected-environment:operator-merge-approval',
  requiredReviewer: 'Cheekyfellastef',
  workflowPath: '.github/workflows/operator-merge-approval-gate.yml',
  workflowRunId: 123,
  workflowRunAttempt: 1,
  approvedAtUtc: '2026-07-30T09:00:00.000Z',
  mergeExecutionAuthority: 'github-actions-protected-environment-only',
  reusableAcrossHeads: false,
})}
\`\`\``,
      }]);
      return okJson({});
    },
  });
  assert.equal(payload.status, 'fetched');
  assert.equal(payload.authAuthority, 'gh-cli');
  assert.equal(payload.checksStatus, 'passed');
  assert.equal(payload.repository, 'owner/repo');
  assert.equal(payload.baseRepository, 'owner/repo');
  assert.equal(payload.headRepository, 'owner/repo');
  assert.equal(payload.headRepositoryMatchesBase, true);
  assert.equal(payload.headBranch, 'feature/exact-head');
  assert.equal(payload.baseSha, 'b'.repeat(40));
  assert.equal(payload.mergedAt, '');
  assert.equal(payload.closedAt, '');
  assert.equal(payload.mergeCommitSha, '');
  assert.equal(payload.trustedOperatorApprovalReceipts.length, 1);
  assert.equal(payload.trustedOperatorApprovalReceipts[0].prNumber, 7);
  assert.equal(Object.hasOwn(payload.trustedOperatorApprovalReceipts[0], 'environment'), false);
  assert.equal(JSON.stringify(payload).includes('gh-token'), false);
  assert.equal(calls.some((call) => call.authorization === 'Bearer bad-env-token'), true);
  assert.equal(calls.some((call) => call.authorization === 'Bearer gh-token'), true);
});

test('PR evidence preserves a fork head repository so lease identity cannot be bound to the base repository', async () => {
  const payload = await fetchGithubPrEvidence({
    owner: 'owner',
    repo: 'repo',
    prNumber: 8,
    auth: { token: 'token', authority: 'test', configured: true },
    fetchImpl: async (url) => {
      if (url.includes('/pulls/8') && !url.includes('/files')) return okJson({
        number: 8,
        html_url: 'https://github.com/owner/repo/pull/8',
        title: 'Fork PR',
        state: 'open',
        merged: false,
        head: {
          ref: 'feature/fork-head',
          sha: 'c'.repeat(40),
          repo: { full_name: 'contributor/repo' },
        },
        base: { ref: 'main', sha: 'd'.repeat(40) },
      });
      if (url.includes('/files')) return okJson([{ filename: 'README.md' }]);
      if (url.includes('/check-runs')) return okJson({ check_runs: [{ name: 'build', conclusion: 'success' }] });
      return okJson({});
    },
  });
  assert.equal(payload.status, 'fetched');
  assert.equal(payload.repository, 'contributor/repo');
  assert.equal(payload.baseRepository, 'owner/repo');
  assert.equal(payload.headRepositoryMatchesBase, false);
});


test('PR evidence holds on GitHub API rate limit without multiplying requests or inventing PR truth', async () => {
  const calls = [];
  let fallbackAttempts = 0;
  const auth = { configured: true, token: 'rate-limited-auth-token', authority: 'environment' };
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: false,
      status: 403,
      headers: { get: (name) => name === 'x-ratelimit-remaining' ? '0' : null },
      json: async () => ({ message: 'API rate limit exceeded for user ID 123' }),
    };
  };
  const args = {
    owner: 'rate-limit-test-owner',
    repo: 'rate-limit-test-repo',
    prNumber: 1645,
    auth,
    fetchImpl,
    ghTokenProvider: async () => { fallbackAttempts += 1; return 'unused-fallback-token'; },
  };
  const first = await fetchGithubPrEvidence(args);
  const second = await fetchGithubPrEvidence(args);
  assert.equal(first.status, 'error');
  assert.equal(first.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
  assert.equal(second.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
  assert.equal(first.retryAfterUtc, second.retryAfterUtc);
  assert.equal(calls.length, 1);
  assert.equal(fallbackAttempts, 0);
  assert.equal(Object.hasOwn(first, 'headSha'), false);
  assert.equal(JSON.stringify([first, second]).includes('rate-limited-auth-token'), false);
});

test('PR evidence respects retry-after for 429 and leaves other repositories independently observable', async () => {
  const args = {
    owner: 'rate-limit-other-owner',
    repo: 'rate-limit-retry-after-repo',
    prNumber: 55,
    auth: { configured: true, token: '429-token', authority: 'environment' },
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name === 'retry-after' ? '120' : null },
      json: async () => ({ message: 'Too many requests' }),
    }),
  };
  const hold = await fetchGithubPrEvidence(args);
  assert.equal(hold.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
  const retryDelay = Date.parse(hold.retryAfterUtc) - Date.now();
  assert.ok(retryDelay > 100_000 && retryDelay <= 125_000);
  const unrelated = await fetchGithubPrEvidence({
    owner: 'rate-limit-unrelated-owner',
    repo: 'rate-limit-unrelated-repo',
    prNumber: 56,
    auth: { configured: true, token: 'another-token', authority: 'environment' },
    fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } }),
  });
  assert.equal(unrelated.status, 'error');
  assert.notEqual(unrelated.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
});


test('PR evidence shares rate-limit hold with disk broker, and rejects secondary 403 as PR proof', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-pr-shared-hold-'));
  const calls = [];
  const opts = {
    owner: 'cross-process-owner', repo: 'cross-process-repo', prNumber: 89,
    auth: { configured: true, token: 'synthetic-test-secret', authority: 'environment' },
    workspaceRoot,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/pulls/89')) return okJson({ number: 89, head: { sha: 'a'.repeat(40), ref: 'branch' } });
      return { status: 403, ok: false, headers: { get: name => name === 'x-ratelimit-remaining' ? '0' : null }, json: async () => ({ message: 'API rate limit exceeded' }) };
    },
  };
  try {
    const result = await fetchGithubPrEvidence(opts);
    assert.equal(result.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
    assert.equal(calls.length, 2, 'must stop before checks and comments after files response is rate-limited');
    assert.equal(Object.hasOwn(result, 'headSha'), false);
    const shared = readBrokeredGithubRateLimitHold({ repository: 'cross-process-owner/cross-process-repo', workspaceRoot });
    assert.ok(shared?.untilMs > Date.now());
    assert.equal(shared.retryAfterUtc, result.retryAfterUtc);
    const broker = await import('../shared/agents/githubObservationBrokerV1.mjs');
    let cliCalls = 0;
    const blocked = broker.readBrokeredGithubJson({
      key: 'pr-89-other-worker', endpoint: 'repos/cross-process-owner/cross-process-repo/issues/89',
      workspaceRoot, spawnSyncFn: () => { cliCalls++; return { status: 0, stdout: '{}', stderr: '' }; },
    });
    assert.equal(blocked.reason, 'GITHUB_RATE_LIMIT_BACKOFF');
    assert.equal(cliCalls, 0);
    const receipt = JSON.stringify(shared);
    assert.equal(receipt.includes('synthetic-test-secret'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
