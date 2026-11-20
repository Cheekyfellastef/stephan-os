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
    existingBranch: true,
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

test('existing PR escrow cannot fail over to an app limited to create-branch authority', () => {
  const createOnly = receipt(SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
    ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT', 'CREATE_BRANCH_REF']);
  const result = buildSourceArtifactPublicationRecoveryV1({
    nowUtc: NOW, escrow, canonicalRemote: remote, workspace,
    failedRoutes: [SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT],
    capabilities: { [SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP]: createOnly },
  });
  assert.equal(result.selectedRoute, SOURCE_PUBLICATION_ROUTE.NONE);
  assert.equal(result.finalVerdict, 'SOURCE_PUBLICATION_CAPABILITY_PROBES_PENDING');
  assert.equal(result.preserveEscrow, true);
  assert.equal(result.rebuildRequired, false);
  assert.equal(result.duplicateBranchAllowed, false);
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

test('escrow publication requires byte-exact canonical branch across escrow, remote and publication receipts', () => {
  const verified = {
    proven: true, repository: escrow.repository, canonicalPr: escrow.canonicalPr,
    canonicalBranch: escrow.canonicalBranch, previousHead: escrow.exactParentHead,
    newHead: '2'.repeat(40), newTree: escrow.exactResultTree,
    fastForward: true, route: SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
  };
  const base = {
    nowUtc: NOW, escrow, canonicalRemote: remote, workspace,
    publicationEvidence: verified, capabilities: {},
  };
  assert.equal(buildSourceArtifactPublicationRecoveryV1(base).finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN);

  for (const altered of [
    ' ' + escrow.canonicalBranch,
    escrow.canonicalBranch + ' ',
    '\t' + escrow.canonicalBranch,
    escrow.canonicalBranch + '\n',
    '\u00a0' + escrow.canonicalBranch,
  ]) {
    const invalid = buildSourceArtifactPublicationRecoveryV1({
      ...base, escrow: { ...escrow, canonicalBranch: altered },
    });
    assert.equal(invalid.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE, JSON.stringify(altered));
    assert.notEqual(invalid.retireEscrowAllowed, true);
  }

  for (const altered of [
    ' ' + escrow.canonicalBranch,
    escrow.canonicalBranch + ' ',
    escrow.canonicalBranch + '\t',
    '\u00a0' + escrow.canonicalBranch,
  ]) {
    const drifted = buildSourceArtifactPublicationRecoveryV1({
      ...base, canonicalRemote: { ...remote, canonicalBranch: altered },
    });
    assert.equal(drifted.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED, JSON.stringify(altered));
    assert.notEqual(drifted.retireEscrowAllowed, true);
  }

  for (const altered of [' ' + escrow.canonicalBranch, escrow.canonicalBranch + ' ']) {
    const unproved = buildSourceArtifactPublicationRecoveryV1({
      ...base, publicationEvidence: { ...verified, canonicalBranch: altered },
    });
    assert.notEqual(unproved.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN, JSON.stringify(altered));
    assert.notEqual(unproved.retireEscrowAllowed, true);
  }
  const nonString = buildSourceArtifactPublicationRecoveryV1({
    ...base, escrow: { ...escrow, canonicalBranch: 123 },
  });
  assert.equal(nonString.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE);
});

test('canonical owner identity rejects partial, padded and fractional number aliases', () => {
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);
  for (const canonicalPr of ['2090junk', ' 2090 ', '02090', '2090.0', '2.09e3', 2090.5, true, {}, '9007199254740992']) {
    const malformed = { ...escrow, canonicalPr };
    const validation = validateSourceArtifactEscrowV1(malformed, NOW);
    assert.equal(validation.valid, false, JSON.stringify(canonicalPr));
    assert.ok(validation.errors.includes('invalid-canonical-pr'));
    const recovered = buildSourceArtifactPublicationRecoveryV1({
      nowUtc: NOW, escrow: malformed, canonicalRemote: remote, workspace,
      publicationEvidence: {
        proven: true, repository: escrow.repository, canonicalPr: 2090,
        canonicalBranch: escrow.canonicalBranch, previousHead: escrow.exactParentHead,
        newHead: '2'.repeat(40), newTree: escrow.exactResultTree,
        fastForward: true, route: SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
      },
    });
    assert.equal(recovered.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE);
    assert.notEqual(recovered.retireEscrowAllowed, true);
  }
  assert.equal(validateSourceArtifactEscrowV1({ ...escrow, canonicalPr: '2090' }, NOW).valid, true);
  for (const canonicalPr of ['2090junk', ' 2090 ', 2090.5, '02090']) {
    const mismatched = buildSourceArtifactPublicationRecoveryV1({
      nowUtc: NOW, escrow, canonicalRemote: { ...remote, canonicalPr }, workspace,
    });
    assert.equal(mismatched.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED, JSON.stringify(canonicalPr));
  }
});

test('escrow owner identity, optional issue and SHA evidence remain byte-exact and fail closed', () => {
  const accepted = {
    proven: true, repository: escrow.repository, canonicalPr: 2090,
    canonicalBranch: escrow.canonicalBranch, previousHead: escrow.exactParentHead,
    newHead: '2'.repeat(40), newTree: escrow.exactResultTree,
    fastForward: true, route: SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
  };
  const base = { nowUtc: NOW, escrow, canonicalRemote: remote, workspace, publicationEvidence: accepted, capabilities: {} };
  const recover = (overrides = {}) => buildSourceArtifactPublicationRecoveryV1({ ...base, ...overrides });
  assert.equal(recover().finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN);
  assert.equal(recover({ escrow: { ...escrow, canonicalPr: '2090' } }).finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN);
  for (const canonicalIssue of ['2090junk', ' 2090 ', '02090', '2090.5', 0, -1, '', true]) {
    assert.equal(recover({ escrow: { ...escrow, canonicalIssue } }).finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE);
    assert.equal(recover({ canonicalRemote: { ...remote, canonicalIssue } }).finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED);
    const unproved = recover({ publicationEvidence: { ...accepted, canonicalIssue } });
    assert.notEqual(unproved.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN);
    assert.notEqual(unproved.retireEscrowAllowed, true);
  }
  for (const field of ['exactParentHead', 'exactParentTree', 'exactResultTree']) {
    for (const extra of [' ', '\t']) {
      assert.equal(recover({ escrow: { ...escrow, [field]: extra + escrow[field] } }).finalVerdict,
        SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE, field);
    }
  }
  assert.equal(recover({ escrow: { ...escrow, localCommitSha: ' ' + '3'.repeat(40) } }).finalVerdict,
    SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE);
  for (const extra of [' ', '\t']) {
    assert.equal(recover({ canonicalRemote: { ...remote, head: remote.head + extra } }).finalVerdict,
      SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED);
  }
  for (const field of ['previousHead', 'newHead', 'newTree']) {
    for (const extra of [' ', '\t']) {
      const unproved = recover({ publicationEvidence: { ...accepted, [field]: extra + accepted[field] } });
      assert.notEqual(unproved.finalVerdict, SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN, field);
      assert.notEqual(unproved.retireEscrowAllowed, true);
    }
  }
});


test('artifact and per-file digest authority requires byte-exact raw strings', () => {
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);
  for (const extra of [' ', '\\t']) {
    const alteredArtifact = validateSourceArtifactEscrowV1({ ...escrow, completeArtifactSha256: extra + escrow.completeArtifactSha256 }, NOW);
    assert.equal(alteredArtifact.valid, false);
    assert.ok(alteredArtifact.errors.includes('invalid-artifact-sha256'));
    for (const field of ['beforeBlobSha', 'afterBlobSha', 'sha256']) {
      const altered = validateSourceArtifactEscrowV1({ ...escrow, changedFiles: [{ ...escrow.changedFiles[0], [field]: extra + escrow.changedFiles[0][field] }] }, NOW);
      assert.equal(altered.valid, false, field);
      assert.ok(altered.errors.some((error) => error.startsWith(field === 'sha256' ? 'invalid-file-sha256' : 'invalid-blob-identity')), field);
    }
  }
});

test('escrow test-proof manifests preserve exact raw entries and fail closed for missing or forged tests', () => {
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);
  const altered = [
    { testsRun: [...escrow.testsRun, ''], testVerdicts: [...escrow.testVerdicts] },
    { testsRun: [...escrow.testsRun, '  '], testVerdicts: [...escrow.testVerdicts] },
    { testsRun: [9], testVerdicts: ['PASS'] },
    { testsRun: [' ' + escrow.testsRun[0]], testVerdicts: ['PASS'] },
    { testsRun: [escrow.testsRun[0]], testVerdicts: [true] },
    { testsRun: [escrow.testsRun[0]], testVerdicts: [' PASS '] },
    { testsRun: [escrow.testsRun[0]], testVerdicts: ['UNPROVEN'] },
    { testsRun: undefined, testVerdicts: ['PASS'] },
    { testsRun: [escrow.testsRun[0]], testVerdicts: undefined },
  ];
  for (const fields of altered) {
    const checked = validateSourceArtifactEscrowV1({ ...escrow, ...fields }, NOW);
    assert.equal(checked.valid, false, JSON.stringify(fields));
    assert.ok(checked.errors.includes('tests-not-proven'), JSON.stringify(fields));
  }
  assert.equal(validateSourceArtifactEscrowV1({
    ...escrow, testsRun: [...escrow.testsRun], testVerdicts: ['pass'],
  }, NOW).valid, true);
});

test('raw escrow path authority cannot be normalized to a different Git path', () => {
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);
  const original = escrow.changedFiles[0];
  const paths = [
    './' + original.path,
    original.path.replaceAll('/', '\\\\'),
    original.path.replace('scripts/', 'scripts/./'),
    original.path + ' ',
    'scripts /' + original.path.slice('scripts/'.length),
    original.path.replace('/windows/', '/windows /'),
  ];
  for (const path of paths) {
    const result = validateSourceArtifactEscrowV1({ ...escrow,
      changedFiles: [{ ...original, path }] }, NOW);
    assert.equal(result.valid, false, path);
    assert.ok(result.errors.some((error) => error.startsWith('unsafe-path:')), path);
  }
});
test('raw escrow diff-verdict authority rejects padded proof but retains exact lowercase PASS', () => {
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);
  assert.equal(validateSourceArtifactEscrowV1({ ...escrow, diffCheckVerdict: 'pass' }, NOW).valid, true);
  for (const diffCheckVerdict of [' PASS ', 'PASS\\n', '\\tPASS', 'PASS\\t']) {
    const result = validateSourceArtifactEscrowV1({ ...escrow, diffCheckVerdict }, NOW);
    assert.equal(result.valid, false, JSON.stringify(diffCheckVerdict));
    assert.ok(result.errors.includes('diff-check-not-proven'));
  }
});