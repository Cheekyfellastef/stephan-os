import test from 'node:test';
import assert from 'node:assert/strict';
import { readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { overlayGoalDashboardWithLivePortfolio } from '../shared/agents/liveGoalDashboardPortfolioOverlay.mjs';

const HEAD = 'a'.repeat(40);
const now = new Date('2026-10-12T10:00:00Z');
const pr = n => ({ number: n, title: `PR ${n}`, state: 'open', draft: n === 2, head: { sha: HEAD, ref: `branch-${n}` } });
const row = (checks, extra = {}) => ({ number: 2, headRefOid: HEAD, commits: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: { contexts: { totalCount: checks.length, pageInfo: { hasNextPage: false }, nodes: checks } } } }] }, ...extra });
async function observe(repository, { prs = [pr(2)], fail = false, cacheEnabled = false } = {}) {
  const calls = [];
  const options = { env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'test-secret' }, secretStoreToken: '', now, cacheEnabled,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const payload = url.endsWith('/graphql') ? { data: { repository } } : url.includes('/pulls?') ? prs : url.includes('/actions/runs') ? { workflow_runs: [] } : [];
      return { ok: !(fail && url.endsWith('/graphql')), status: fail && url.endsWith('/graphql') ? 403 : 200, json: async () => payload };
    } };
  return { result: await readGithubTelemetry(options), calls, options };
}

test('one bounded exact-head batch preserves drafts, full count and completed conclusions without inventing protected approval', async () => {
  const { result, calls } = await observe({ nameWithOwner: 'owner/repo', pullRequests: { totalCount: 140 }, pr2: row([{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }]) });
  assert.equal(calls.length, 4);
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(result.pullRequests[0].checksStatus, 'passed');
  assert.equal(result.pullRequests[0].draft, true);
  assert.equal(result.pullRequests[0].approvalStatus, 'unknown');
  assert.equal(result.pullRequests[0].mergeReadiness, 'protected_gates_unproven');
  assert.equal(result.totalOpenPullRequestCount, 140);
  const projection = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: result }, nowMs: now.getTime() });
  assert.equal(projection.goals[0].state, 'BUILDING');
  assert.equal(projection.liveGithubPrCount, 140);
  assert.equal(projection.operatorAttention.approvals.length, 0);
  assert.equal(result.mergeAllowed, false);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('failed and cancelled completed checks are failed, while an empty rollup remains unknown', async () => {
  for (const conclusion of ['FAILURE', 'CANCELLED']) {
    const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: row([{ name: 'build', status: 'COMPLETED', conclusion }]) });
    assert.equal(result.pullRequests[0].checksStatus, 'failed');
  }
  const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: row([]) });
  assert.equal(result.pullRequests[0].checksStatus, 'unknown');
});

test('moved PR/commit head, wrong repository and truncated check pages cannot upgrade proof', async () => {
  const good = row([{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
  const variants = [
    { ...good, headRefOid: 'b'.repeat(40) },
    { ...good, number: 3 },
    { ...good, commits: { nodes: [{ commit: { ...good.commits.nodes[0].commit, oid: 'b'.repeat(40) } }] } },
    row([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]),
  ];
  variants[3].commits.nodes[0].commit.statusCheckRollup.contexts.pageInfo.hasNextPage = true;
  for (const candidate of variants) {
    const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: candidate });
    assert.equal(result.pullRequests[0].checksStatus, 'unknown');
  }
  const { result } = await observe({ nameWithOwner: 'wrong/repo', pr2: good });
  assert.equal(result.pullRequests[0].checksStatus, 'unknown');
});

test('batch targets only 24 latest heads and caches optional failure without losing the PR feed', async () => {
  const { result, calls, options } = await observe(null, { prs: Array.from({ length: 30 }, (_, i) => pr(i + 1)), fail: true, cacheEnabled: true });
  const query = JSON.parse(calls[3].init.body).query;
  assert.equal((query.match(/:pullRequest\(/g) || []).length, 24);
  assert.match(query, /pr30:pullRequest/);
  assert.doesNotMatch(query, /pr6:pullRequest/);
  assert.equal(result.status, 'live');
  assert.equal(result.pullRequests.length, 30);
  assert.equal(result.pullRequests.every(p => p.checksStatus === 'unknown'), true);
  await readGithubTelemetry(options);
  assert.equal(calls.length, 4);
});

test('passed ordinary checks do not claim independent review or request merge approval', async () => {
  const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: row([{ status: 'COMPLETED', conclusion: 'SUCCESS' }]) }, { prs: [{ ...pr(2), draft: false }] });
  const projection = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: result }, nowMs: now.getTime() });
  assert.equal(projection.goals[0].state, 'VERIFYING');
  assert.equal(projection.operatorAttention.approvals.length, 0);
});
