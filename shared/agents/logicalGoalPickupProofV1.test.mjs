import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLogicalGoalBuildTruthV1,
  signLogicalGoalBuildTruthV1,
  loadControllerActivityProofRecordsV1,
  loadPinnedWorkerPickupVerifierV1,
  distinctPhysicalWorkerSigningIdentityV1,
  verifyCleanCanonicalTrackedMainV1,
} from './logicalGoalPickupProofV1.mjs';
import { mkdir, mkdtemp, writeFile, utimes, readFile, readdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

// Exercise the real source gate and shared broker. Only the fixed installed
// GitHub CLI boundary is simulated; real disposable Git repositories provide
// the local refs, commits, tracked bytes, index and hostile configuration.
async function authenticatedMainFixture(t, reply) {
  const workspace = await mkdtemp(join(tmpdir(), 'logical-main-broker-'));
  const priorWorkspace = process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  process.env.STEPHANOS_SHARED_AGENT_WORKSPACE = workspace;
  const originalSpawn = childProcess.spawnSync;
  let calls = 0;
  const gh = process.platform === 'win32' ? BATTLE_BRIDGE_WINDOWS_HOST.githubCli : '/usr/bin/gh';
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    if (command !== gh) return originalSpawn(command, args, options);
    calls += 1;
    assert.deepEqual(args, ['api', 'repos/Cheekyfellastef/stephan-os/git/ref/heads/main',
      '--hostname', 'github.com', '--jq', '{ref,url,object:{sha:.object.sha,type:.object.type}}']);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 10000);
    for (const key of ['GH_HOST', 'GH_CONFIG_DIR', 'STEPHANOS_GH_COMMAND',
      'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'SSL_CERT_FILE']) {
      assert.equal(options.env[key], undefined, key + ' must not select source authority');
    }
    const value = reply();
    return value?.error || value?.status !== undefined ? value
      : { status: 0, stdout: JSON.stringify(value), stderr: '' };
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (priorWorkspace === undefined) delete process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
    else process.env.STEPHANOS_SHARED_AGENT_WORKSPACE = priorWorkspace;
  });
  const cacheRoot = join(workspace, 'status', 'github-observation-broker');
  const cacheFiles = async () => (await readdir(cacheRoot).catch(() => []))
    .filter(name => /^read-[a-f0-9]{64}\.json$/.test(name))
    .map(name => join(cacheRoot, name));
  return { workspace, calls: () => calls, cacheFiles,
    fresh: async () => Promise.all((await cacheFiles()).map(file => rm(file, { force: true }))) };
}

function canonicalMainResponse(sha) {
  return { ref: 'refs/heads/main',
    url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/git/refs/heads/main',
    object: { sha, type: 'commit' } };
}

async function cleanCanonicalSourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'logical-source-authority-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 12000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  git('init', '--initial-branch=main');
  git('remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  git('add', 'proof-module.mjs');
  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'independent source fixture');
  const protectedHead = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', protectedHead);
  return { root, git, protectedHead };
}

const nowMs = Date.parse('2026-10-18T17:00:00.000Z');
const head = 'a'.repeat(40);
const goal = Object.freeze({
  issue: '#3050', logicalLaneId: 'logical-goal-3050',
  controllerId: 'controller-zero', selectedForAdmission: true,
  state: 'BUILDING',
  lastMaterialProgressAtUtc: new Date(nowMs).toISOString(),
  proofRefs: ['proof/claimed-physical-work'],
});
const truth = Object.freeze({
  schemaVersion: 'stephanos.sovereign-build-truth.v1',
  observedAtUtc: new Date(nowMs).toISOString(),
  goals: [goal],
});
test('uncommissioned public key or missing proof can never authenticate a BUILDING goal', () => {
  const forged = {
    schemaVersion: 'stephanos.logical-goal-pickup-attestation.v1',
    publisherId: 'stephanos-core',
    sourceHead: head,
    signatureBase64: 'a'.repeat(88),
    claims: [{ issue: '#3050', proofRecords: [{ proofRef: 'proof/claimed-physical-work' }] }],
  };
  const result = verifyLogicalGoalBuildTruthV1({
    buildTruth: truth, attestation: forged, proofRecords: [],
    expectedSourceHead: head, nowMs,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOGICAL_GOAL_PINNED_VERIFIER_UNAVAILABLE');
  assert.deepEqual(result.verifiedGoalIds, []);
});
test('a guessed digest or self-described Core identity supplies no independent trust', () => {
  for (const attestation of [null, {}, { sourceHead: head }]) {
    const result = verifyLogicalGoalBuildTruthV1({
      buildTruth: truth, attestation, proofRecords: [],
      expectedSourceHead: head, nowMs,
      trustedPublicKeyPem: 'not-a-public-key',
      trustedPublicKeySha256: 'f'.repeat(64),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.verifiedGoalIds, []);
  }
});

test('the reader finds the derived controller proof, not a fabricated original receipt filename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logical-proof-'));
  await mkdir(join(root, 'proof'));
  const proofId = 'controller-abcdef123456-run-run123';
  const record = {
    kind: 'stephanos.shared_workspace.proof',
    proofId,
    status: 'PASS',
    refs: ['receipts/work-3050-material.json'],
    controllerActivityProof: {
      schemaVersion: 'stephanos.controller-activity-proof.v1',
      controllerId: 'controller-zero', runId: 'run123', materialActionsSucceeded: 1,
    },
  };
  await writeFile(join(root, 'proof', proofId + '.json'), JSON.stringify(record));
  const result = await loadControllerActivityProofRecordsV1({ workspaceRoot: root });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].refs, ['receipts/work-3050-material.json']);
  assert.equal(result.records[0].proofId, proofId);
});
test('uncommissioned separate physical-worker public key fails closed', async () => {
  const result = await loadPinnedWorkerPickupVerifierV1({
    localStateRoot: '/nonexistent',
    env: { STEPHANOS_PHYSICAL_WORKER_TRUSTED_PUBLIC_KEY_SHA256: '',
      STEPHANOS_GOAL_BUILD_GATES_TRUSTED_PUBLIC_KEY_SHA256: '' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WORKER_PICKUP_DISTINCT_PIN_NOT_COMMISSIONED');
});

test('same Ed25519 public key with different PEM line endings is not a distinct worker', () => {
  const key = [
    '-----BEGIN PUBLIC KEY-----',
    'MCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
    '-----END PUBLIC KEY-----',
    '',
  ].join('\n');
  const differentlyEncoded = key.replace(/\n/g, '\r\n') + '\r\n';
  assert.notEqual(key, differentlyEncoded);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, differentlyEncoded), false);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, key), false);
  assert.equal(distinctPhysicalWorkerSigningIdentityV1(key, 'not-an-ed25519-key'), false);
});

test('unrelated and historical proof-file growth cannot veto current controller pickups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'controller-history-'));
  const dir = join(root, 'proof');
  await mkdir(dir);
  // Over the previous hard global 1024-file limit, including over 512
  // historical controller records. Only current controller proofs count.
  for (let offset = 0; offset < 1300; offset += 50) {
    await Promise.all(Array.from({ length: Math.min(50, 1300 - offset) }, async (_, index) => {
      const n = offset + index;
      const name = n < 600 ? `controller-old-run-${n}.json` : `unrelated-${n}.json`;
      const filename = join(dir, name);
      await writeFile(filename, '{}');
      if (n < 600) {
        const yesterday = new Date(Date.now() - 86400000);
        await utimes(filename, yesterday, yesterday);
      }
    }));
  }
  const currentId = 'controller-current-run-test';
  await writeFile(join(dir, currentId + '.json'), JSON.stringify({
    kind: 'stephanos.shared_workspace.proof',
    proofId: currentId,
    controllerActivityProof: { schemaVersion: 'stephanos.controller-activity-proof.v1' },
  }));
  const result = await loadControllerActivityProofRecordsV1({ workspaceRoot: root });
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].proofId, currentId);
});

test('canonical pickup proof rejects dirty tracked files, staged edits and stale origin/main', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'logical-clean-main-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 12000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  git('init', '--initial-branch=main');
  git('remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  await writeFile(join(root, 'second-tracked.mjs'), 'export const second = true;\n');
  git('add', 'proof-module.mjs', 'second-tracked.mjs');
  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'clean fixture');
  const protectedHead = git('rev-parse', 'HEAD');
  const remote = await authenticatedMainFixture(t, () => canonicalMainResponse(protectedHead));
  git('update-ref', 'refs/remotes/origin/main', protectedHead);
  const clean = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(clean.ok, true);
  assert.equal(clean.sourceHead, git('rev-parse', 'HEAD'));

  // The claimed source tree must never be selected using inherited GIT_CONFIG
  // or GIT_WORK_TREE environment variables. A second *clean* directory has
  // the exact indexed files; the real checkout is modified during the probe.
  const mirror = await mkdtemp(join(tmpdir(), 'logical-git-env-mirror-'));
  await writeFile(join(mirror, 'proof-module.mjs'), 'export const attested = true;\n');
  await writeFile(join(mirror, 'second-tracked.mjs'), 'export const second = true;\n');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  const poison = {
    GIT_WORK_TREE: mirror, GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: mirror,
  };
  const original = Object.fromEntries(Object.keys(poison).map(key =>
    [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null]));
  try {
    Object.assign(process.env, poison);
    assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
      'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === null) delete process.env[key]; else process.env[key] = value;
    }
    await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  }
  // Local repository config is also mutable and must not redirect signing
  // even with a fully isolated child environment.
  git('config', 'core.worktree', mirror);
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_GIT_CONFIGURATION_UNTRUSTED');
  git('config', '--unset', 'core.worktree');
  await remote.fresh();
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).ok, true);

  // Put the hidden edit in the SECOND indexed path. A parser accidentally
  // treating the complete NUL-delimited output as a single first entry must
  // fail this regression rather than laundering a later unsafe flag.
  git('update-index', '--assume-unchanged', 'second-tracked.mjs');
  await writeFile(join(root, 'second-tracked.mjs'), 'export const second = false;\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE');
  git('update-index', '--no-assume-unchanged', 'second-tracked.mjs');
  await writeFile(join(root, 'second-tracked.mjs'), 'export const second = true;\n');

  // These index flags bypass porcelain status, even when tracked source is
  // physically modified. They must not bypass the signing/readback gate.
  git('update-index', '--assume-unchanged', 'proof-module.mjs');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE');
  git('update-index', '--no-assume-unchanged', 'proof-module.mjs');

  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = true;\n');
  git('update-index', '--skip-worktree', 'proof-module.mjs');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
    'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE');
  git('update-index', '--no-skip-worktree', 'proof-module.mjs');

  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  const modified = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(modified.ok, false);
  assert.equal(modified.blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');
  git('add', 'proof-module.mjs');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');

  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'unfetched change');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_CANONICAL_MAIN_UNVERIFIED');
  // Forge the formerly trusted remote-tracking ref after a clean local commit.
  // Matching local labels cannot replace the independently observed GitHub SHA.
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  await remote.fresh();
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_AUTHENTICATED_MAIN_MISMATCH');
});

test('a tracked edit during the authenticated main read cannot borrow the earlier clean observation', async (t) => {
  const { root, protectedHead } = await cleanCanonicalSourceFixture();
  await authenticatedMainFixture(t, () => {
    writeFileSync(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
    return canonicalMainResponse(protectedHead);
  });
  const result = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');
});

test('producer and consumer may reuse only a private immediate upstream observation', async (t) => {
  const { root, protectedHead } = await cleanCanonicalSourceFixture();
  const remote = await authenticatedMainFixture(t, () => canonicalMainResponse(protectedHead));
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(remote.calls(), 1, 'the second source check must not spend another upstream read');
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY');
  assert.equal(remote.calls(), 1, 'private remote freshness never replaces fresh local source checks');
});

test('a forged fresh Shared Workspace broker cache cannot authenticate matching local refs', async (t) => {
  const { root, git, protectedHead } = await cleanCanonicalSourceFixture();
  const remote = await authenticatedMainFixture(t, () => canonicalMainResponse(protectedHead));
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).ok, true);
  const [cachePath] = await remote.cacheFiles();
  const cached = JSON.parse(await readFile(cachePath, 'utf8'));
  await writeFile(join(root, 'proof-module.mjs'), 'export const attested = false;\n');
  git('add', 'proof-module.mjs');
  git('-c', 'user.name=Stephanos Test', '-c', 'user.email=ci@example.invalid',
    'commit', '-m', 'forge local source authority');
  const forgedHead = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', forgedHead);
  await writeFile(cachePath, JSON.stringify({ ...cached,
    observedAtUtc: new Date(Date.now() + 60000).toISOString(),
    payload: canonicalMainResponse(forgedHead),
  }));
  const realMonotonicNow = process.hrtime.bigint;
  t.mock.method(process.hrtime, 'bigint', () => realMonotonicNow() + 2_000_000_000n);
  const result = verifyCleanCanonicalTrackedMainV1(root);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOGICAL_GOAL_AUTHENTICATED_MAIN_UNAVAILABLE');
  assert.equal(remote.calls(), 1, 'a forged cache must hold, never masquerade as upstream authority');
});

test('independent source readers cannot starve each other through an untrusted shared payload cache', async (t) => {
  const { root, protectedHead } = await cleanCanonicalSourceFixture();
  const remote = await authenticatedMainFixture(t, () => canonicalMainResponse(protectedHead));
  // Separate module instances represent independently loaded Core and monitor
  // readers while exercising the same real repository-wide broker directory.
  const first = await import('./logicalGoalPickupProofV1.mjs?first-reader');
  const second = await import('./logicalGoalPickupProofV1.mjs?second-reader');
  assert.equal(first.verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(second.verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(first.verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(second.verifyCleanCanonicalTrackedMainV1(root).ok, true);
  assert.equal(remote.calls(), 2, 'each reader needs one own upstream proof, not a shared cache label');
  assert.equal((await remote.cacheFiles()).length, 2);
});

for (const [name, reply] of [
  ['wrong ref', sha => ({ ...canonicalMainResponse(sha), ref: 'refs/heads/attacker' })],
  ['redirected repository', sha => ({ ...canonicalMainResponse(sha),
    url: 'https://api.github.com/repos/attacker/stephan-os/git/refs/heads/main' })],
  ['wrong object type', sha => ({ ...canonicalMainResponse(sha), object: { sha, type: 'tree' } })],
  ['malformed JSON', () => ({ status: 0, stdout: '{not-json', stderr: '' })],
  ['transport timeout', () => ({ status: null, error: Object.assign(new Error('ETIMEDOUT'),
    { code: 'ETIMEDOUT' }), stdout: '', stderr: '' })],
]) {
  test('authenticated main failure stays held: ' + name, async (t) => {
    const { root, protectedHead } = await cleanCanonicalSourceFixture();
    const remote = await authenticatedMainFixture(t, () => reply(protectedHead));
    assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker,
      'LOGICAL_GOAL_AUTHENTICATED_MAIN_UNAVAILABLE');
    assert.equal(remote.calls(), 1);
  });
}

test('a GitHub rate-limit response keeps the canonical source held without a second upstream read', async (t) => {
  const { root } = await cleanCanonicalSourceFixture();
  const remote = await authenticatedMainFixture(t, () => ({
    status: 1, stdout: '', stderr: 'API rate limit exceeded (HTTP 403)',
  }));
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_GITHUB_RATE_LIMIT_HOLD');
  assert.equal(verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_GITHUB_RATE_LIMIT_HOLD');
  const otherReader = await import('./logicalGoalPickupProofV1.mjs?rate-limited-reader');
  assert.equal(otherReader.verifyCleanCanonicalTrackedMainV1(root).blocker, 'LOGICAL_GOAL_GITHUB_RATE_LIMIT_HOLD');
  assert.equal(remote.calls(), 1);
});

test('signed physical worker identity must match Build Truth builder', () => {
  const core = generateKeyPairSync('ed25519');
  const worker = generateKeyPairSync('ed25519');
  const corePublicKeyPem = core.publicKey.export({ format: 'pem', type: 'spki' });
  const workerPublicKeyPem = worker.publicKey.export({ format: 'pem', type: 'spki' });
  const workerPublicKeySha256 = createHash('sha256').update(workerPublicKeyPem).digest('hex');
  const sourceHead = 'a'.repeat(40);
  const observedAtUtc = new Date(nowMs).toISOString();
  const runId = 'worker-identity-regression';
  const proofId = 'controller-worker-identity-run-regression';
  const proofRef = 'receipts/work-3050-material.json';
  const goodGoal = {
    issue: '#3050',
    logicalLaneId: 'logical-goal-3050',
    controllerId: 'controller-zero',
    builder: 'worker-A',
    selectedForAdmission: true,
    state: 'BUILDING',
    lastMaterialProgressAtUtc: observedAtUtc,
    proofRefs: [proofRef],
  };
  const physicalBody = {
    schemaVersion: 'stephanos.physical-worker-goal-pickup.v1',
    publisherId: 'stephanos-physical-worker',
    sourceHead, goalIssue: goodGoal.issue,
    logicalLaneId: goodGoal.logicalLaneId, controllerId: goodGoal.controllerId,
    runId, proofId, proofRef, observedAtUtc, workerId: 'worker-A',
  };
  const workerSignature = sign(null,
    Buffer.from('stephanos.physical-worker-goal-pickup.v1\\0' + JSON.stringify(physicalBody)),
    worker.privateKey).toString('base64');
  const record = {
    kind: 'stephanos.shared_workspace.proof',
    status: 'PASS', proofId, refs: [proofRef],
    timestampUtc: observedAtUtc, correlationId: runId,
    controllerActivityProof: {
      schemaVersion: 'stephanos.controller-activity-proof.v1',
      controllerId: goodGoal.controllerId, runId, materialActionsSucceeded: 1,
    },
    workerPickupAttestation: { ...physicalBody, signatureBase64: workerSignature },
  };
  const signTruth = builder => signLogicalGoalBuildTruthV1({
    buildTruth: {
      schemaVersion: 'stephanos.sovereign-build-truth.v1',
      observedAtUtc, goals: [{ ...goodGoal, builder }],
    },
    sourceHead, proofRecords: [record], nowMs,
    signingPrivateKeyPem: core.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    trustedWorkerPublicKeyPem: workerPublicKeyPem, trustedWorkerPublicKeySha256: workerPublicKeySha256,
    corePublicKeyPem,
    corePublicKeySha256: createHash('sha256').update(corePublicKeyPem).digest('hex'),
  });
  assert.equal(signTruth('worker-A').ok, true, 'matching signed worker must remain admissible');
  const mismatched = signTruth('worker-B');
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.blocker, 'LOGICAL_GOAL_SIGNING_SOURCE_OR_PROOF_UNVERIFIED');
  assert.equal(signTruth('').ok, false, 'an unnamed builder cannot inherit a signed pickup');
});
