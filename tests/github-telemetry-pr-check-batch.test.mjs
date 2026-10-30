import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';
import { overlayGoalDashboardWithLivePortfolio } from '../shared/agents/liveGoalDashboardPortfolioOverlay.mjs';
import { readBrokeredGithubRateLimitHold } from '../shared/agents/githubObservationBrokerV1.mjs';

const HEAD = 'a'.repeat(40);
const now = new Date('2026-10-12T10:00:00Z');
const pr = n => ({ number: n, title: `PR ${n}`, state: 'open', draft: n === 2, head: { sha: HEAD, ref: `branch-${n}` } });
const row = (checks, extra = {}) => ({ number: 2, headRefOid: HEAD, commits: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: { contexts: { totalCount: checks.length, pageInfo: { hasNextPage: false }, nodes: checks } } } }] }, ...extra });
async function observe(repository, { prs = [pr(2)], workflows = [], fail = false, cacheEnabled = false } = {}) {
  const calls = [];
  const options = { env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'test-secret' }, secretStoreToken: '', now, cacheEnabled,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const payload = url.endsWith('/graphql') ? { data: { repository } } : url.includes('/pulls?') ? prs : url.includes('/actions/runs') ? { workflow_runs: workflows } : [];
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
  assert.equal(projection.goals[0].state, 'VERIFYING');
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

const passingExactHeadWorkflows = () => [
  'OpenClaw GitHub Operator', 'Protected Operator Merge Source Proof',
  'Exact-Head Review Dispatch', 'PR Clean Guard', 'Build Stephanos UI',
  'Battle Bridge Publisher Proof', 'Codex Dispatch Queue Proof',
].map((name, index) => ({ id: index + 1, name, status: 'completed', conclusion: 'success', head_sha: HEAD, pull_requests: [{ number: 2 }] }));

for (const [name, check, expectedChecks, expectedState] of [
  ['StatusContext ERROR', { context: 'external-status', state: 'ERROR' }, 'failed', 'BLOCKED'],
  ['StatusContext EXPECTED', { context: 'external-status', state: 'EXPECTED' }, 'pending', 'VERIFYING'],
  ['CheckRun REQUESTED', { name: 'external-check', status: 'REQUESTED', conclusion: null }, 'pending', 'VERIFYING'],
]) {
  test(`${name} cannot become current proof through seven passing workflow summaries`, async () => {
    const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: row([check]) }, {
      prs: [{ ...pr(2), draft: false }], workflows: passingExactHeadWorkflows(),
    });
    assert.equal(result.workflows.length, 7);
    assert.equal(result.workflows.every(run => run.status === 'passed' && run.headSha === HEAD), true);
    const projection = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: result }, nowMs: now.getTime() });
    assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
    assert.equal(result.pullRequests[0].checksStatus, expectedChecks);
    assert.equal(projection.goals[0].state, expectedState);
    assert.equal(projection.operatorAttention.approvals.length, 0);
  });
}

const failedContext = { name: 'external-check', status: 'COMPLETED', conclusion: 'FAILURE' };
const rejectedBatchCases = [
  ['moved PR head', () => ({ pr2: row([failedContext], { headRefOid: 'b'.repeat(40) }) }), true],
  ['moved commit head', () => ({ pr2: { ...row([failedContext]), commits: { nodes: [{ commit: { oid: 'b'.repeat(40) } }] } } }), true],
  ['wrong PR number', () => ({ pr2: row([failedContext], { number: 3 }) }), false],
  ['wrong repository', () => ({ nameWithOwner: 'wrong/repo', pr2: row([failedContext]) }), false],
  ['truncated contexts', () => { const observed = row([failedContext]); const contexts = observed.commits.nodes[0].commit.statusCheckRollup.contexts; contexts.totalCount = 101; contexts.pageInfo.hasNextPage = true; return { pr2: observed }; }, false],
  ['missing rollup', () => ({ pr2: { ...row([]), commits: { nodes: [{ commit: { oid: HEAD } }] } } }), false],
  ['empty rollup', () => ({ pr2: row([]) }), false],
  ['STALE conclusion', () => ({ pr2: row([{ name: 'external-check', status: 'COMPLETED', conclusion: 'STALE' }]) }), false],
  ['null context', () => ({ pr2: row([null]) }), false],
  ['null context beside SUCCESS', () => ({ pr2: row([null, { name: 'external-check', status: 'COMPLETED', conclusion: 'SUCCESS' }]) }), false],
];
for (const [name, makeFields, clearsHead] of rejectedBatchCases) {
  test(`${name} retains non-passing batch provenance against positive workflow fallback`, async () => {
    const { result } = await observe({ nameWithOwner: 'owner/repo', ...makeFields() }, {
      prs: [{ ...pr(2), draft: false }], workflows: passingExactHeadWorkflows(),
    });
    assert.equal(result.status, 'live');
    assert.equal(result.pullRequests.length, 1);
    const projection = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: result }, nowMs: now.getTime() });
    assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
    assert.equal(result.pullRequests[0].checkBatchObserved, true);
    assert.equal(result.pullRequests[0].checksStatus, 'unknown');
    assert.match(projection.goals[0].summary, /checks unknown/);
    assert.ok(projection.goals[0].blockers.length > 0);
    assert.equal(projection.operatorAttention.approvals.length, 0);
    if (clearsHead) {
      assert.equal(result.pullRequests[0].headSha, '');
      assert.equal(projection.goals[0].exactHead, 'unknown');
    }
  });
}

test('draft PRs never claim BUILDING and their failed checks remain BLOCKED', async () => {
  for (const [conclusion, state] of [['SUCCESS', 'VERIFYING'], ['FAILURE', 'BLOCKED']]) {
    const { result } = await observe({ nameWithOwner: 'owner/repo', pr2: row([{ status: 'COMPLETED', conclusion }]) });
    const projection = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: result }, nowMs: now.getTime() });
    assert.equal(projection.goals[0].state, state);
    assert.equal(projection.operatorAttention.approvals.length, 0);
  }
});

test('a saturated REST page is a visible lower bound until the whole repository count is proven', async () => {
  const prs = Array.from({ length: 100 }, (_, i) => pr(i + 1));
  const { result: partial } = await observe(null, { prs, fail: true });
  const heldCount = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: partial }, nowMs: now.getTime() });
  assert.equal(heldCount.liveGithubPrCount, '100+');
  assert.equal(heldCount.githubPrCountIsExact, false);
  assert.equal(heldCount.observedGithubPrCount, 100);
  assert.equal(heldCount.renderedGithubPrCount, 24);
  const { result: complete } = await observe({ nameWithOwner: 'owner/repo', pullRequests: { totalCount: 178 } }, { prs });
  const fullCount = overlayGoalDashboardWithLivePortfolio({ liveProjection: { githubTelemetry: complete }, nowMs: now.getTime() });
  assert.equal(fullCount.liveGithubPrCount, 178);
  assert.equal(fullCount.githubPrCountIsExact, true);
  assert.equal(fullCount.observedGithubPrCount, 100);
  assert.equal(fullCount.renderedGithubPrCount, 24);
  assert.equal(fullCount.operatorAttention.approvals.length, 0);
});

test('optional check enrichment shares rate-limit HOLD and single-flight instead of retrying through another credential', async () => {
  for (const failure of ['http403', 'http429', 'graphql200']) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-pr-check-backoff-'));
    const calls = [];
    let fallbacks = 0;
    const repository = `owner/batch-backoff-${failure}`;
    const options = {
      env: { GITHUB_REPOSITORY: repository, GITHUB_TOKEN: 'private-test-token' },
      secretStoreToken: '', workspaceRoot, cacheEnabled: true,
      ghTokenProvider: async () => { fallbacks++; return 'never-used-fallback'; },
      fetchImpl: async (url) => {
        calls.push(url);
        if (!url.endsWith('/graphql')) return { ok: true, status: 200, json: async () => url.includes('/pulls?') ? [pr(2)] : url.includes('/actions/runs') ? { workflow_runs: [] } : [] };
        const status = failure === 'http403' ? 403 : failure === 'http429' ? 429 : 200;
        return {
          ok: status === 200, status,
          headers: { get: name => name === 'retry-after' ? '120' : name === 'x-ratelimit-remaining' ? '0' : null },
          json: async () => status === 200 ? { errors: [{ type: 'RATE_LIMITED', message: 'Rate limit exceeded' }] } : { message: 'API rate limit exceeded' },
        };
      },
    };
    try {
      const results = await Promise.all([readGithubTelemetry(options), readGithubTelemetry(options)]);
      for (const result of results) {
        assert.equal(result.status, 'adapter_error');
        assert.equal(result.adapterAvailable, false);
        assert.deepEqual(result.blockers, ['github_rate_limit_backoff']);
        assert.equal(result.mergeAllowed, false);
      }
      assert.equal(calls.length, 4, 'one serial REST sequence plus one shared GraphQL request');
      assert.equal(fallbacks, 0);
      assert.equal(readBrokeredGithubRateLimitHold({ repository, workspaceRoot })?.source, 'SHARED_GITHUB_RATE_LIMIT_HOLD');
      const held = await readGithubTelemetry(options);
      assert.equal(held.status, 'adapter_error');
      assert.equal(calls.length, 4, 'the next refresh does not contact GitHub during HOLD');
      assert.equal(JSON.stringify(results).includes('private-test-token'), false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }
});
