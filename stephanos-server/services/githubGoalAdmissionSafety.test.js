import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, json: async () => payload };
}

function canonicalGoal(overrides = {}) {
  return {
    number: 2314,
    title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
    state: 'open',
    author_association: 'OWNER',
    performed_via_github_app: { slug: 'chatgpt' },
    labels: [{ name: 'goal' }, { name: 'priority:high' }],
    body: 'Ordinary durable goal text with no special admission envelope.',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314',
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
    ...overrides,
  };
}

function admissionBody(overrides = {}) {
  const admission = {
    schemaVersion: 'stephanos.github-goal-admission.v1',
    issueNumber: 2314,
    repository: REPOSITORY,
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    prerequisites: [],
    sourceImplementationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    ...overrides,
  };
  return `Durable admission.\n\n\`\`\`stephanos-goal-admission-v1\n${JSON.stringify(admission)}\n\`\`\``;
}

function ownerAdmissionComment(overrides = {}) {
  return {
    user: { login: OWNER },
    author_association: 'OWNER',
    body: admissionBody(),
    ...overrides,
  };
}

async function observe(issue, comments = [], commentStatus = 200) {
  return fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async (url) => url.includes('/comments?')
      ? response(comments, commentStatus)
      : response([issue]),
    maxPages: 1,
  });
}

test('ordinary goal and priority labels remain discovery-only and cannot manufacture scheduler READY authority', async () => {
  const result = await observe(canonicalGoal());
  assert.equal(result.status, 'fetched');
  assert.equal(result.admissionContractRequired, true);
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].issueNumber, 2314);
  assert.equal(result.discoveredIssues[0].admissionState, 'DISCOVERED_CANDIDATE');
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});

test('one owner-authenticated closed-world comment admission makes a discovered goal scheduler eligible', async () => {
  const result = await observe(canonicalGoal(), [ownerAdmissionComment()]);
  assert.equal(result.issues.length, 1);
  const admitted = result.issues[0];
  assert.equal(admitted.admissionState, 'ADMISSION_PROVEN');
  assert.equal(admitted.admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
  assert.equal(admitted.schedulerEligible, true);
  assert.equal(admitted.admission.state, 'READY');
  assert.equal(admitted.admission.route, 'OPENCLAW_LOCAL');
  assert.equal(admitted.admission.sourceImplementationAllowed, true);
  assert.equal(admitted.admission.mergeAuthority, false);
  assert.equal(admitted.admission.deploymentAuthority, false);
  assert.equal(admitted.admission.runtimeMutationAuthority, false);
  assert.equal(admitted.admission.arbitraryShellAllowed, false);
});

test('mutable issue body cannot grant admission even when timestamps and trusted creator metadata look unchanged', async () => {
  const result = await observe(canonicalGoal({
    body: admissionBody(),
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
    performed_via_github_app: { slug: 'chatgpt' },
  }));
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});

test('non-owner comment cannot grant admission', async () => {
  const result = await observe(canonicalGoal(), [ownerAdmissionComment({
    user: { login: 'collaborator' },
    author_association: 'COLLABORATOR',
  })]);
  assert.equal(result.discoveredIssues.length, 1);
  assert.deepEqual(result.issues, []);
});

test('owner comment cannot widen protected authority', async () => {
  const result = await observe(canonicalGoal(), [ownerAdmissionComment({
    body: admissionBody({
      mergeAuthority: true,
      deploymentAuthority: true,
      runtimeMutationAuthority: true,
      arbitraryShellAllowed: true,
    }),
  })]);
  assert.equal(result.discoveredIssues.length, 1);
  assert.deepEqual(result.issues, []);
});

test('multiple owner admission receipts fail closed as ambiguous', async () => {
  const result = await observe(canonicalGoal(), [ownerAdmissionComment(), ownerAdmissionComment()]);
  assert.equal(result.discoveredIssues.length, 1);
  assert.deepEqual(result.issues, []);
});

test('comment read failure remains discovery-only and does not become authority', async () => {
  const result = await observe(canonicalGoal(), [], 503);
  assert.equal(result.status, 'fetched');
  assert.equal(result.admissionReadFailureCount, 1);
  assert.equal(result.discoveredIssues.length, 1);
  assert.deepEqual(result.issues, []);
});
