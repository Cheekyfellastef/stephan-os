import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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


function autoAdmissionComment(issue, overrides = {}) {
  const contentHash = 'sha256:' + createHash('sha256')
    .update(String(issue.title || '').trim() + '\n' + String(issue.body || ''), 'utf8')
    .digest('hex');
  const payload = {
    schemaVersion: 'stephanos.github-goal-auto-admission.v1',
    issueNumber: issue.number,
    repository: OWNER + '/' + REPO,
    creatorLogin: OWNER,
    contentHash,
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    sourceImplementationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    ...overrides,
  };
  return {
    user: { login: 'github-actions[bot]' },
    body: ['```stephanos-goal-auto-admission-v1', JSON.stringify(payload), '```'].join('\n'),
  };
}

test('trusted workflow auto-admits an unchanged owner-created durable goal without a manual owner label event', async () => {
  const issue = ownerIssue();
  issue.labels = [{ name: 'goal' }, { name: 'priority-high' }];
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false,
    maxPages: 1,
    fetchImpl: async (url) => {
      if (url.includes('/events?')) return response([]);
      if (url.includes('/comments?')) return response([autoAdmissionComment(issue)]);
      return response([issue]);
    },
  });

  assert.equal(result.status, 'fetched');
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].schedulerEligible, true);
  assert.equal(result.issues[0].admissionProofSource, 'GITHUB_ACTIONS_OWNER_GOAL_AUTO_ADMISSION');
  assert.equal(result.issues[0].priority, 750);
  assert.equal(result.trustedWorkflowAutoAdmissionEnabled, true);
});

test('workflow auto-admission fails closed after goal title or body changes', async () => {
  const issue = ownerIssue();
  const comment = autoAdmissionComment(issue);
  issue.body += '\nA later edit changes the admitted content.';
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false,
    maxPages: 1,
    fetchImpl: async (url) => {
      if (url.includes('/events?')) return response([]);
      if (url.includes('/comments?')) return response([comment]);
      return response([issue]);
    },
  });

  assert.equal(result.status, 'fetched');
  assert.deepEqual(result.issues, []);
  assert.equal(result.discoveredIssues.length, 1);
});

test('identical admitted goal titles deduplicate to one canonical scheduler issue', async () => {
  const first = ownerIssue();
  const second = { ...ownerIssue(), number: 2315, html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2315' };
  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false,
    maxPages: 1,
    fetchImpl: async (url) => {
      if (url.includes('/events?')) return response([{ event: 'labeled', label: { name: 'goal' }, actor: { login: OWNER } }]);
      if (url.includes('/comments?')) return response([]);
      return response([first, second]);
    },
  });

  assert.equal(result.status, 'fetched');
  assert.deepEqual(result.issues.map(({ issueNumber }) => issueNumber), [2314]);
  assert.deepEqual(result.duplicateSuppressed, [{ issueNumber: 2315, duplicateOf: 2314 }]);
});
