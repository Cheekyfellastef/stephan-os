import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SOURCE_PUBLICATION_BLOCKER, SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA, SOURCE_PUBLICATION_ROUTE, buildSourcePublicationContinuityV1 } from './sourcePublicationContinuityV1.mjs';

const NOW = '2026-08-08T18:00:00Z';
const artifact = Object.freeze({ exactBase: 'a'.repeat(40), exactTree: 'b'.repeat(40), exactCommit: 'c'.repeat(40), branch: 'agent/review-throughput-v1' });
const workspace = Object.freeze({ discoveryCompleted: true, repository: 'Cheekyfellastef/stephan-os', checkoutFound: true });

function receipt(route, overrides = {}) {
  return { schemaVersion: SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA, route, repository: 'Cheekyfellastef/stephan-os', exactBase: artifact.exactBase, exactTree: artifact.exactTree, exactCommit: artifact.exactCommit, branch: artifact.branch, state: 'ready', observedAtUtc: '2026-08-08T17:55:00Z', expiresAtUtc: '2026-08-08T18:25:00Z', operations: [], ...overrides };
}
function githubApp(overrides = {}) { return { receipt: receipt(SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP, { operations: ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT', 'CREATE_BRANCH_REF', 'OPEN_DRAFT_PR'], ...overrides }) }; }
function localGit(overrides = {}) { return { receipt: receipt(SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT, { operations: ['PUSH_EXACT_SOURCE_COMMIT'], ...overrides }) }; }
function unavailable(route) { return { receipt: receipt(route, { state: 'unavailable', operations: [] }) }; }
function allUnavailable() { return Object.fromEntries(Object.values(SOURCE_PUBLICATION_ROUTE).filter((route) => route !== SOURCE_PUBLICATION_ROUTE.NONE).map((route) => [route, unavailable(route)])); }

test('requires bounded nested-checkout discovery before publication denial', () => {
  const result = buildSourcePublicationContinuityV1({ artifact, nowUtc: NOW, capabilities: {} });
  assert.equal(result.blocker, SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED);
  assert.equal(result.preserveVerifiedArtifact, true);
  assert.equal(result.rebuildRequired, false);
});

test('selects authenticated Git first when a fresh artifact-bound receipt proves exact commit push', () => {
  const result = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: { [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]: localGit(), [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() } });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT);
  assert.equal(result.capabilityReceipt.exactTree, artifact.exactTree);
  assert.equal(result.mutationAllowed, false);
});

test('fails over to the connected GitHub App without rebuilding when Git credentials fail', () => {
  const result = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, failedRoutes: [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT], capabilities: { [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]: localGit(), [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() } });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
  assert.equal(result.preserveVerifiedArtifact, true);
  assert.equal(result.rebuildRequired, false);
});

test('a missing gh binary is not a global blocker when GitHub App primitives are proven', () => {
  const result = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, failedRoutes: ['GH_CLI_MISSING'], capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() } });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
});

test('stale, cross-repository and wrong-tree receipts never prove route readiness', () => {
  for (const app of [githubApp({ expiresAtUtc: '2026-08-08T17:59:59Z' }), githubApp({ repository: 'other/repository' }), githubApp({ exactTree: 'd'.repeat(40) })]) {
    const result = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: app } });
    assert.equal(result.blocker, SOURCE_PUBLICATION_BLOCKER.PROBES_PENDING);
  }
});

test('skips authenticated Git without an exact commit and selects an app that can create it', () => {
  const diffArtifact = { ...artifact, exactCommit: '' };
  const result = buildSourcePublicationContinuityV1({ workspace, artifact: diffArtifact, nowUtc: NOW, capabilities: { [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]: localGit({ exactCommit: '' }), [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp({ exactCommit: '' }) } });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
});

test('Forge is selectable only with fresh M2, M3 and publication operations bound to the artifact', () => {
  const route = SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR;
  const blocked = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: { [route]: { receipt: receipt(route, { operations: ['M2_READY', 'M3_RUNNER_READY'] }) } } });
  assert.equal(blocked.blocker, SOURCE_PUBLICATION_BLOCKER.PROBES_PENDING);
  const ready = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: { [route]: { receipt: receipt(route, { operations: ['M2_READY', 'M3_RUNNER_READY', 'PUBLISH_SOURCE_BRANCH'] }) } } });
  assert.equal(ready.selectedRoute, route);
});

test('global denial remains pending until every route has terminal artifact-bound evidence', () => {
  const pending = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: {} });
  assert.equal(pending.blocker, SOURCE_PUBLICATION_BLOCKER.PROBES_PENDING);
  assert.equal(pending.unresolvedRoutes.length, 5);
  const denied = buildSourcePublicationContinuityV1({ workspace, artifact, nowUtc: NOW, capabilities: allUnavailable() });
  assert.equal(denied.blocker, SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE);
  assert.equal(denied.duplicateBranchAllowed, false);
  assert.equal(denied.duplicatePullRequestAllowed, false);
});

test('repository instructions make route discovery mandatory and gh absence route-specific', () => {
  const instructions = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  assert.match(instructions, /Publication capability continuity/);
  assert.match(instructions, /bounded nested checkouts/);
  assert.match(instructions, /connected GitHub App blob\/tree\/commit\/ref API/);
  assert.match(instructions, /missing `gh` binary.*route-specific observation/);
  assert.match(instructions, /Fail over without rebuilding the source change/);
  assert.match(instructions, /SOURCE_PUBLICATION_CAPACITY_UNAVAILABLE/);
});
