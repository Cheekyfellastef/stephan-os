import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SOURCE_PUBLICATION_BLOCKER,
  SOURCE_PUBLICATION_ROUTE,
  buildSourcePublicationContinuityV1,
} from './sourcePublicationContinuityV1.mjs';

const artifact = Object.freeze({
  exactBase: 'a'.repeat(40),
  exactTree: 'b'.repeat(40),
  exactCommit: 'c'.repeat(40),
  branch: 'agent/review-throughput-v1',
});
const workspace = Object.freeze({
  discoveryCompleted: true,
  repository: 'Cheekyfellastef/stephan-os',
  checkoutFound: true,
});

function githubApp(overrides = {}) {
  return {
    discovered: true,
    ready: true,
    receipt: 'github-app-permission-receipt-1',
    repositoryPushPermission: true,
    operations: ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT', 'CREATE_BRANCH_REF', 'OPEN_DRAFT_PR'],
    ...overrides,
  };
}

function localGit(overrides = {}) {
  return {
    discovered: true,
    ready: true,
    receipt: 'authenticated-git-receipt-1',
    remoteWriteAllowed: true,
    exactCommitPushAllowed: true,
    ...overrides,
  };
}

test('requires bounded nested-checkout discovery before publication denial', () => {
  const result = buildSourcePublicationContinuityV1({ artifact, capabilities: {} });
  assert.equal(result.routeReady, false);
  assert.equal(result.blocker, SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED);
  assert.equal(result.preserveVerifiedArtifact, true);
  assert.equal(result.rebuildRequired, false);
});

test('selects authenticated Git first when exact remote write capability is proven', () => {
  const result = buildSourcePublicationContinuityV1({
    workspace,
    artifact,
    capabilities: {
      [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]: localGit(),
      [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp(),
    },
  });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT);
  assert.equal(result.routeReady, true);
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.forceAllowed, false);
});

test('fails over to the connected GitHub App without rebuilding when Git credentials fail', () => {
  const result = buildSourcePublicationContinuityV1({
    workspace,
    artifact,
    failedRoutes: [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT],
    capabilities: {
      [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]: localGit(),
      [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp(),
    },
  });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
  assert.equal(result.routeReady, true);
  assert.equal(result.preserveVerifiedArtifact, true);
  assert.equal(result.rebuildRequired, false);
  assert.deepEqual(result.failedRoutes, [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT]);
});

test('a missing gh binary is not a global blocker when GitHub App primitives are proven', () => {
  const result = buildSourcePublicationContinuityV1({
    workspace,
    artifact,
    failedRoutes: ['GH_CLI_MISSING'],
    capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() },
  });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
  assert.equal(result.finalVerdict, 'SOURCE_PUBLICATION_ROUTE_READY');
});

test('Forge is selectable only with M2, M3 and explicit source-publication proof', () => {
  const baseForge = {
    discovered: true,
    ready: true,
    receipt: 'forge-runtime-receipt-1',
    m2Ready: true,
    m3RunnerReady: true,
  };
  const blocked = buildSourcePublicationContinuityV1({
    workspace,
    artifact,
    capabilities: { [SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR]: baseForge },
  });
  assert.equal(blocked.blocker, SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE);

  const ready = buildSourcePublicationContinuityV1({
    workspace,
    artifact,
    capabilities: {
      [SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR]: { ...baseForge, sourcePublicationAllowed: true },
    },
  });
  assert.equal(ready.selectedRoute, SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR);
});

test('global capacity denial is allowed only after discovery and all registered routes are unavailable', () => {
  const result = buildSourcePublicationContinuityV1({ workspace, artifact, capabilities: {} });
  assert.equal(result.blocker, SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE);
  assert.equal(result.evaluatedRoutes.length, 5);
  assert.equal(result.duplicateBranchAllowed, false);
  assert.equal(result.duplicatePullRequestAllowed, false);
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
