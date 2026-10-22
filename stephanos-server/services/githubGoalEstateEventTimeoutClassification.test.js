import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const ownerGoal = Object.freeze({
  number: 2330,
  title: 'Owner goal',
  state: 'open',
  labels: Object.freeze([{ name: 'goal' }]),
  user: Object.freeze({ login: 'Cheekyfellastef' }),
  author_association: 'OWNER',
});

test('owner-label event timeout retains typed 408 classification', async () => {
  let requestCount = 0;
  const fetchImpl = async (url, options = {}) => {
    requestCount += 1;
    if (String(url).includes('/issues?')) {
      return { ok: true, status: 200, json: async () => [ownerGoal] };
    }
    if (String(url).includes('/events?')) {
      await new Promise((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const result = await fetchGithubGoalIssues({
    owner: 'Cheekyfellastef',
    repo: 'stephan-os',
    auth: { configured: true, token: 'test-token', authority: 'test' },
    fetchImpl,
    cacheEnabled: false,
    requestTimeoutMs: 1000,
    maxPages: 1,
    maxEventPages: 1,
    maxCommentPages: 1,
  });

  assert.equal(result.status, 'error');
  assert.match(result.recommendedNextAction, /408/);
  assert.equal(requestCount, 2);
});
