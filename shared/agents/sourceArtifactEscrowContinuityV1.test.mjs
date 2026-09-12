import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA,
  SOURCE_PUBLICATION_ROUTE,
  buildSourcePublicationContinuityV1,
} from './sourcePublicationContinuityV1.mjs';
import {
  SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  SOURCE_ARTIFACT_KIND,
  SOURCE_ARTIFACT_RECOVERY_STATE,
  buildSourceArtifactPublicationRecoveryV1,
  validateSourceArtifactEscrowV1,
} from './sourceArtifactEscrowContinuityV1.mjs';

const NOW = '2026-09-02T10:15:00Z';
const escrow = Object.freeze({
  schemaVersion: SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  artifactKind: SOURCE_ARTIFACT_KIND.COMPLETE_FILE_BUNDLE,
  repository: 'Cheekyfellastef/stephan-os',
  canonicalPr: 2090,
  canonicalBranch: 'fix/mission-worker-runtime-dirt-source-proof-v1',
  exactParentHead: 'a'.repeat(40),
  exactParentTree: 'b'.repeat(40),
  exactResultTree: 'c'.repeat(40),
  changedFiles: Object.freeze([
    Object.freeze({ path: 'scripts/windows/start-mission-orchestrator-worker.ps1', beforeBlobSha: 'd'.repeat(40), afterBlobSha: 'e'.repeat(40), sha256: 'f'.repeat(64) }),
  ]),
  completeArtifactSha256: '1'.repeat(64),
  artifactRef: 'shared-workspace:source-artifacts/pr-2090/1',
  externallyReadable: true,
  commitMessage: 'Align Mission Worker start guards with canonical runtime dirt',
  localCommitSha: '',
  testsRun: Object.freeze(['node --test scripts/mission-worker-git-stderr-isolation.test.mjs']),
  testVerdicts: Object.freeze(['PASS']),
  diffCheckVerdict: 'PASS',
  executorIdentity: 'bounded-source-worker-2090-a1',
  createdAtUtc: '2026-09-02T10:00:00Z',
  expiresAtUtc: '2026-09-03T10:00:00Z',
});
const workspace = Object.freeze({ discoveryCompleted: true, repository: 'Cheekyfellastef/stephan-os', checkoutFound: true });
const remote = Object.freeze({ repository: 'Cheekyfellastef/stephan-os', canonicalPr: 2090, canonicalBranch: escrow.canonicalBranch, head: escrow.exactParentHead });

function receipt(route, operations, overrides = {}) {
  return {
    receipt: {
      schemaVersion: SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA,
      route,
      repository: 'Cheekyfellastef/stephan-os',
      exactBase: escrow.exactParentHead,
      exactTree: escrow.exactResultTree,
      exactCommit: escrow.localCommitSha,
      branch: escrow.canonicalBranch,
      state: 'ready',
      observedAtUtc: '2026-09-02T10:10:00Z',
      expiresAtUtc: '2026-09-02T10:45:00Z',
      operations,
      ...overrides,
    },
  };
}
function unavailable(route) { return receipt(route, [], { state: 'unavailable' }); }

const githubApp = () => receipt(SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP, ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT', 'UPDATE_BRANCH_REF']);

test('escrow must be independently readable before any publication attempt', () => {
  const result = buildSourceArtifactPublicationRecoveryV1({ nowUtc: NOW, escrow: { ...escrow, externallyReadable: false }, canonicalRemote: remote, workspace, capabilities: {} });
  assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.ESCROW_REQUIRED);
  assert.equal(result.rebuildRequired, false);
  assert.equal(result.duplicatePullRequestAllowed, false);
});

test('generalized escrow validates the exact canonical parent, result tree and per-file integrity pins', () => {
  const validation = validateSourceArtifactEscrowV1(escrow, NOW);
  assert.equal(validation.valid, true);
  assert.equal(validation.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.ESCROW_PROVEN);
});

test('existing publication router accepts an existing fix branch and connected-app UPDATE_BRANCH_REF capability', () => {
  const result = buildSourcePublicationContinuityV1({
    workspace,
    artifact: { exactBase: escrow.exactParentHead, exactTree: escrow.exactResultTree, exactCommit: '', branch: escrow.canonicalBranch },
    nowUtc: NOW,
    capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() },
  });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
  assert.equal(result.fastForwardOnly, true);
});

test('primary publisher failure immediately selects the next proven route without rebuilding', () => {
  const result = buildSourceArtifactPublicationRecoveryV1({
    nowUtc: NOW,
    escrow,
    canonicalRemote: remote,
    workspace,
    failedRoutes: [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT],
    capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() },
    executorAvailable: false,
  });
  assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_IN_PROGRESS);
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP);
  assert.equal(result.rebuildRequired, false);
  assert.equal(result.preserveEscrow, true);
});

test('canonical branch drift fails closed before publisher mutation', () => {
  const result = buildSourceArtifactPublicationRecoveryV1({ nowUtc: NOW, escrow, canonicalRemote: { ...remote, head: '9'.repeat(40) }, workspace, capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: githubApp() } });
  assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED);
  assert.equal(result.forceAllowed, false);
});

test('publication is proven only by exact parent, exact result tree and fast-forward evidence on the same PR branch', () => {
  const result = buildSourceArtifactPublicationRecoveryV1({
    nowUtc: NOW,
    escrow,
    canonicalRemote: remote,
    workspace,
    publicationEvidence: {
      proven: true,
      repository: 'Cheekyfellastef/stephan-os',
      canonicalPr: 2090,
      canonicalBranch: escrow.canonicalBranch,
      previousHead: escrow.exactParentHead,
      newHead: '2'.repeat(40),
      newTree: escrow.exactResultTree,
      fastForward: true,
      route: SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
    },
  });
  assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN);
  assert.equal(result.retireEscrowAllowed, true);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.runtimeMutationAllowed, false);
});

test('route exhaustion preserves escrow and never authorizes a duplicate lane', () => {
  const routes = Object.values(SOURCE_PUBLICATION_ROUTE).filter((route) => route !== SOURCE_PUBLICATION_ROUTE.NONE);
  const capabilities = Object.fromEntries(routes.map((route) => [route, unavailable(route)]));
  const result = buildSourceArtifactPublicationRecoveryV1({ nowUtc: NOW, escrow, canonicalRemote: remote, workspace, capabilities });
  assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.ALL_ROUTES_UNAVAILABLE);
  assert.equal(result.preserveEscrow, true);
  assert.equal(result.duplicateBranchAllowed, false);
  assert.equal(result.duplicatePullRequestAllowed, false);
});

test('corrupt or expired escrow is unrecoverable rather than silently rebuilt', () => {
  for (const invalid of [
    { ...escrow, exactResultTree: 'not-a-tree' },
    { ...escrow, changedFiles: [{ ...escrow.changedFiles[0], sha256: 'bad' }] },
    { ...escrow, expiresAtUtc: '2026-09-02T10:14:59Z' },
  ]) {
    const result = buildSourceArtifactPublicationRecoveryV1({ nowUtc: NOW, escrow: invalid, canonicalRemote: remote, workspace, capabilities: {} });
    assert.equal(result.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE);
    assert.equal(result.rebuildRequired, false);
  }
});
