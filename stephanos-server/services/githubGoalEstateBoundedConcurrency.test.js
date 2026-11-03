import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const owner = 'Cheekyfellastef';
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: name => name === 'retry-after' ? '60' : '' },
  json: async () => payload,
});
const goals = count => Array.from({ length: count }, (_, index) => ({
  number: 4000 + index, title: 'Goal ' + index, state: 'open',
  labels: [{ name: 'goal' }], user: { login: owner },
  author_association: 'OWNER', comments: 1,
}));
const event = { event: 'labeled', label: { name: 'goal' }, actor: { login: owner } };
const options = fetchImpl => ({
  owner, repo: 'stephan-os',
  auth: { configured: true, token: 'test-only', authority: 'test-only' },
  fetchImpl, cacheEnabled: false, requestTimeoutMs: 1000,
});
function untilAborted(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('independent goal authorities complete without serial head-of-line blocking', async () => {
  let started = 0, release;
  const allStarted = new Promise(resolve => { release = resolve; });
  const result = await fetchGithubGoalIssues(options(async (url, request) => {
    if (url.includes('/issues?')) return response(goals(4));
    if (url.includes('/events?')) {
      if (++started === 4) release();
      await Promise.race([allStarted, untilAborted(request.signal)]);
      return response([event]);
    }
    if (url.includes('/comments?')) return response([]);
    throw new Error('Unexpected URL');
  }));
  assert.equal(result.status, 'fetched', result.recommendedNextAction);
  assert.equal(started, 4);
  assert.deepEqual(result.issues.map(issue => issue.issueNumber), [4000, 4001, 4002, 4003]);
  assert.ok(result.issues.every(issue => issue.schedulerEligible
    && issue.admissionProofSource === 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT'));
});

test('a large goal page uses at most four concurrent authority reads', async () => {
  let active = 0, peak = 0, commentCount = 0;
  const result = await fetchGithubGoalIssues(options(async url => {
    if (url.includes('/issues?')) return response(goals(12));
    if (url.includes('/events?')) {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return response([event]);
    }
    if (url.includes('/comments?')) { commentCount++; return response([]); }
    throw new Error('Unexpected URL');
  }));
  assert.equal(result.status, 'fetched');
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(commentCount, 12);
  assert.equal(result.issues.length, 12);
});

test('quota failure stops admission and drains every in-flight read before returning', async () => {
  let eventCount = 0, active = 0, commentCount = 0;
  const result = await fetchGithubGoalIssues(options(async (url, request) => {
    if (url.includes('/issues?')) return response(goals(12));
    if (url.includes('/events?')) {
      eventCount++;
      if (eventCount === 1) return response({ message: 'rate limit exceeded' }, 429);
      active++;
      try { await untilAborted(request.signal); }
      finally { active--; }
    }
    if (url.includes('/comments?')) { commentCount++; return response([]); }
    throw new Error('Unexpected URL');
  }));
  assert.equal(result.status, 'error');
  assert.equal(result.reasonCode, 'GITHUB_GOAL_ESTATE_RATE_LIMIT_BACKOFF');
  assert.deepEqual(result.issues, []);
  assert.ok(eventCount <= 4);
  assert.equal(active, 0);
  assert.equal(commentCount, 0);
});
