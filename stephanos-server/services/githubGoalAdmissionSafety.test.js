import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(issues) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => '' },
    json: async () => issues,
  };
}

test('ordinary goal and priority labels remain discovery-only and cannot manufacture scheduler READY authority', async () => {
  const issue = {
    number: 2314,
    title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
    state: 'open',
    author_association: 'OWNER',
    labels: [{ name: 'goal' }, { name: 'priority:high' }],
    body: 'Ordinary goal text without a closed-world admission envelope.',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314',
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
  };

  const result = await fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async () => response([issue]),
    maxPages: 1,
  });

  assert.equal(result.status, 'fetched');
  assert.equal(result.repository, REPOSITORY);
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].issueNumber, 2314);
  assert.equal(result.discoveredIssues[0].admissionState, 'DISCOVERED_CANDIDATE');
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.equal(result.discoveredIssues[0].sourceMutationAuthority, false);
  assert.equal(result.discoveredIssues[0].mergeAuthority, false);
  assert.equal(result.discoveredIssues[0].deploymentAuthority, false);
  assert.equal(result.discoveredIssues[0].runtimeMutationAuthority, false);
  assert.equal(result.discoveredIssues[0].arbitraryShellAllowed, false);
  assert.deepEqual(result.issues, []);
});
