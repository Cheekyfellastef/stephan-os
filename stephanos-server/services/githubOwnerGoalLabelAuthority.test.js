import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, json: async () => payload };
}

function ownerIssue() {
  return {
    number: 2314,
    title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
    state: 'open',
    user: { login: OWNER },
    author_association: 'OWNER',
    labels: [{ name: 'goal' }],
    body: 'Owner-authored issue whose mutable goal label was added later by a collaborator.',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314',
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-23T00:00:00Z',
  };
}

test('collaborator-added goal label cannot manufacture source-mutation authority on an owner-authored issue', async () => {
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false,
    maxPages: 1,
    fetchImpl: async (url) => {
      if (url.includes('/events?')) {
        return response([{ event: 'labeled', label: { name: 'goal' }, actor: { login: 'collaborator' } }]);
      }
      if (url.includes('/comments?')) return response([]);
      return response([ownerIssue()]);
    },
  });

  assert.equal(result.status, 'fetched');
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});

test('owner-authenticated goal-label event is the required direct-admission proof for an owner-authored issue', async () => {
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false,
    maxPages: 1,
    fetchImpl: async (url) => {
      if (url.includes('/events?')) {
        return response([{ event: 'labeled', label: { name: 'goal' }, actor: { login: OWNER } }]);
      }
      if (url.includes('/comments?')) return response([]);
      return response([ownerIssue()]);
    },
  });

  assert.equal(result.status, 'fetched');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].schedulerEligible, true);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT');
  assert.equal(result.issues[0].sourceMutationAuthority, false);
  assert.equal(result.issues[0].admission.sourceImplementationAllowed, true);
  assert.equal(result.issues[0].admission.mergeAuthority, false);
  assert.equal(result.issues[0].admission.runtimeMutationAuthority, false);
});
