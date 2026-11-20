import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlywheelCanonicalGoalIssueV1 } from '../../stephanos-server/services/flywheelCanonicalGoalAdmissionService.js';
import { fetchGithubGoalIssues } from '../../stephanos-server/services/githubPrEvidenceService.js';

// Owner-selected functional acceptance. All GitHub reads are injected; no live writes.
const repository = 'Cheekyfellastef/stephan-os';
const owner = 'Cheekyfellastef';
const resourceIds = ['repo:cheekyfellastef/stephan-os:path:shared/agents/canonicalMissionWorkerEvidenceV1.mjs'];
const requiredTests = ['node --test scripts/sovereign-goal-builder-worker-evidence.test.mjs'];
function generatedIssue() {
  const generated = buildFlywheelCanonicalGoalIssueV1({
    capabilityId: 'seed-2972:gap:worker-pickup-reconciliation',
    eventId: 'scope-regression',
    evidenceRefs: ['shared/runtime/goalConveyorFleetCareSeedV1.mjs'],
    seedGrowthWork: {
      ownerIssueRef: '#2972', seedId: 'goal-conveyor-fleet-care',
      contractSource: 'shared/runtime/goalConveyorFleetCareSeedV1.mjs',
      pressureKey: 'seed-2972:gap:worker-pickup-reconciliation',
      targetRung: 'FLEET_OBSERVED', nextBestAction: 'Repair worker pickup and reconciliation.',
    },
  });
  return { number: 9001, title: generated.title, body: generated.body, state: 'open',
    user: { login: owner }, author_association: 'OWNER', labels: [{ name: 'goal' }],
    created_at: '2026-10-26T18:00:00Z', updated_at: '2026-10-26T18:00:00Z' };
}
function admissionComment(overrides = {}, contributor = false) {
  const contract = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 9001,
    repository, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [],
    sourceImplementationAllowed: true, resourceIds, requiredTests,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false,
    arbitraryShellAllowed: false, ...overrides };
  return { user: { login: contributor ? 'contributor' : owner },
    author_association: contributor ? 'CONTRIBUTOR' : 'OWNER',
    body: '```stephanos-goal-admission-v1\n' + JSON.stringify(contract) + '\n```' };
}
async function observe(comments = []) {
  const issue = { ...generatedIssue(), comments: comments.length };
  return fetchGithubGoalIssues({ owner, repo: 'stephan-os',
    auth: { configured: true, token: 'test-only', authority: 'test-only' },
    cacheEnabled: false, maxPages: 1,
    fetchImpl: async url => {
      const payload = url.includes('/events?')
        ? [{ event: 'labeled', label: { name: 'goal' }, actor: { login: owner } }]
        : url.includes('/comments?') ? comments : [issue];
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => payload };
    },
  });
}
test('generated functional goal: reference-only proposal cannot become an executable source task', async () => {
  const result = await observe();
  assert.equal(result.discoveredIssues.length, 1, 'retain discovery and goal identity');
  assert.equal(result.issues.length, 0, 'reference provenance supplies neither implementation scope nor functional acceptance');
});
test('generated functional goal: explicit authenticated scope and focused tests survive unchanged', async () => {
  const result = await observe([admissionComment()]);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].admission.resourceIds, resourceIds);
  assert.deepEqual(result.issues[0].admission.requiredTests, requiredTests);
  assert.equal(result.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
  assert.equal(result.issues[0].sourceMutationAuthority, false, 'admission is not a worker grant');
});
test('generated functional goal: contributor plan cannot rescue reference-only owner label', async () => {
  const result = await observe([admissionComment({}, true)]);
  assert.equal(result.issues.length, 0);
});
test('generated functional goal: malformed explicit acceptance never falls back to reference scope', async () => {
  const result = await observe([admissionComment({ requiredTests: [] })]);
  assert.equal(result.issues.length, 0);
});
