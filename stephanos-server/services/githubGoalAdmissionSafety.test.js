import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function response(issues) {
  return { ok: true, status: 200, headers: { get: () => '' }, json: async () => issues };
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

async function observe(issue) {
  return fetchGithubGoalIssues({
    owner: OWNER,
    repo: REPO,
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    fetchImpl: async () => response([issue]),
    maxPages: 1,
  });
}

function admissionBody(overrides = {}) {
  const admission = {
    schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 2314, repository: REPOSITORY,
    state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], sourceImplementationAllowed: true,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false,
    ...overrides,
  };
  return `Durable goal.\n\n\`\`\`stephanos-goal-admission-v1\n${JSON.stringify(admission)}\n\`\`\``;
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

test('trusted owner-created closed-world admission can make a discovered goal scheduler eligible', async () => {
  const result = await observe(canonicalGoal({ body: admissionBody() }));
  assert.equal(result.issues.length, 1);
  const admitted = result.issues[0];
  assert.equal(admitted.admissionState, 'ADMISSION_PROVEN');
  assert.equal(admitted.schedulerEligible, true);
  assert.equal(admitted.admission.state, 'READY');
  assert.equal(admitted.admission.route, 'OPENCLAW_LOCAL');
  assert.equal(admitted.admission.sourceImplementationAllowed, true);
  assert.equal(admitted.admission.mergeAuthority, false);
  assert.equal(admitted.admission.deploymentAuthority, false);
  assert.equal(admitted.admission.runtimeMutationAuthority, false);
  assert.equal(admitted.admission.arbitraryShellAllowed, false);
});

test('issue-body text cannot elevate admission into protected authority', async () => {
  const result = await observe(canonicalGoal({ body: admissionBody({ mergeAuthority: true, deploymentAuthority: true, runtimeMutationAuthority: true, arbitraryShellAllowed: true }) }));
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});

test('trusted-app admission edited after creation remains discovery-only', async () => {
  const result = await observe(canonicalGoal({ body: admissionBody(), updated_at: '2026-09-21T00:05:00Z' }));
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});

test('same-second mutable issue-body admission remains discovery-only without an independently authenticated receipt', async () => {
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

test('owner association without trusted app provenance remains discovery-only', async () => {
  const result = await observe(canonicalGoal({ body: admissionBody(), performed_via_github_app: null }));
  assert.equal(result.discoveredIssues.length, 1);
  assert.equal(result.discoveredIssues[0].schedulerEligible, false);
  assert.deepEqual(result.issues, []);
});
