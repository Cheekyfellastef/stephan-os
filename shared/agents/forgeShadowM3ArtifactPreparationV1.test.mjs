import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FORGE_SHADOW_M3_ARTIFACT_PREPARATION_BLOCKED,
  FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY,
  prepareForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3ArtifactPreparationV1.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const MODULE_BLOB = 'c'.repeat(40);
const SOURCE_COMMIT = 'd'.repeat(40);
const NOW = '2026-08-10T14:00:00.000Z';
const REQUESTED_AT = '2026-08-10T13:55:00.000Z';
const VERSION = '13.0.0';
const RELEASE_API = 'https://data.forgejo.org/api/v1/repos/forgejo/runner/releases/latest';
const RELEASE_BASE = `https://code.forgejo.org/forgejo/runner/releases/download/v${VERSION}`;
const TAG_REF_API = `https://code.forgejo.org/api/v1/repos/forgejo/runner/git/refs/tags/v${VERSION}`;
const SOURCE_URL = `https://code.forgejo.org/forgejo/runner/archive/${SOURCE_COMMIT}.tar.gz`;
const SIGNING_KEY = 'https://keys.openpgp.org/vks/v1/by-fingerprint/EB114F5E6C0DC2BCDD183550A4B61A2DC5923710';
const REPOSITORY_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const LINUX_NAME = `forgejo-runner-${VERSION}-linux-amd64`;
const LINUX = Buffer.alloc((1024 * 1024) + 37, 0x31);
const WINDOWS = Buffer.alloc((1024 * 1024) + 73, 0x32);
const SIGNATURE = Buffer.from('linux-detached-signature', 'utf8');
const SOURCE = Buffer.from('official-source-archive-fixture', 'utf8');
LINUX.set([0x7f, 0x45, 0x4c, 0x46], 0);
WINDOWS.set([0x4d, 0x5a], 0);

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function input(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    expectedHead: HEAD,
    expectedTree: TREE,
    requestId: 'forge-m3-artifact-preparation-request-001',
    observationId: 'forge-m3-artifact-observation-001',
    requestedAtUtc: REQUESTED_AT,
    operatorApproved: true,
    m3Only: true,
    ...patch,
  };
}

function release() {
  const checksum = Buffer.from(`${digest(LINUX).slice(7)}  ${LINUX_NAME}\n`, 'utf8');
  return {
    value: {
      id: 1300,
      tag_name: `v${VERSION}`,
      draft: false,
      prerelease: false,
      published_at: '2026-08-09T11:00:00Z',
      assets: [
        { name: LINUX_NAME, size: LINUX.length },
        { name: `${LINUX_NAME}.asc`, size: SIGNATURE.length },
        { name: `${LINUX_NAME}.sha256`, size: checksum.length },
      ],
    },
    checksum,
  };
}

function runCommand(_executable, args) {
  if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
  if (args.includes('hash-object')) return { status: 0, stdout: `${MODULE_BLOB}\n`, stderr: '' };
  if (args.some((value) => String(value).includes(':shared/agents/'))) return { status: 0, stdout: `${MODULE_BLOB}\n`, stderr: '' };
  if (args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
  return { status: 0, stdout: `${TREE}\n`, stderr: '' };
}

function fetchFixed(url) {
  const current = release();
  const values = new Map([
    [RELEASE_API, Buffer.from(JSON.stringify(current.value), 'utf8')],
    [TAG_REF_API, Buffer.from(JSON.stringify([{ ref: `refs/tags/v${VERSION}`, object: { type: 'commit', sha: SOURCE_COMMIT } }]), 'utf8')],
    [SIGNING_KEY, Buffer.from('fixed-forgejo-signing-key', 'utf8')],
    [`${RELEASE_BASE}/${LINUX_NAME}`, LINUX],
    [`${RELEASE_BASE}/${LINUX_NAME}.asc`, SIGNATURE],
    [`${RELEASE_BASE}/${LINUX_NAME}.sha256`, current.checksum],
    [SOURCE_URL, SOURCE],
  ]);
  if (!values.has(url)) throw new Error(`unexpected-fixed-url:${url}`);
  return values.get(url);
}

function buildWindows({ sourceArchive, version, sourceCommit }) {
  assert.deepEqual(sourceArchive, SOURCE);
  assert.equal(version, VERSION);
  assert.equal(sourceCommit, SOURCE_COMMIT);
  return {
    binary: WINDOWS,
    sourceCommit,
    sourceArchiveDigest: digest(sourceArchive),
    sourceGoSumDigest: digest('go.sum'),
    sourceModuleDigest: digest('go.mod'),
    toolchainVersion: 'go1.25.12',
    buildRecipeDigest: digest('fixed-windows-build-recipe'),
  };
}

async function withProfile(callback) {
  const userProfile = mkdtempSync(join(tmpdir(), 'stephanos-forge-m3-artifacts-test-'));
  try {
    return await callback(userProfile);
  } finally {
    rmSync(userProfile, { recursive: true, force: true });
  }
}

function options(userProfile, patch = {}) {
  return {
    platform: 'win32',
    now: () => new Date(NOW),
    repositoryRoot: REPOSITORY_ROOT,
    userProfile,
    runCommand,
    fetchFixed,
    verifySignature: async () => true,
    buildWindows,
    ...patch,
  };
}

function containsForbiddenLocationKey(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    if (['url', 'uri', 'path', 'filename', 'binary', 'payload', 'token', 'credential'].includes(key.toLowerCase())) return true;
    if (containsForbiddenLocationKey(nested)) return true;
  }
  return false;
}

test('prepares the signed official Linux binary and fixed Windows source build into the immutable cache', async () => withProfile(async (userProfile) => {
  const result = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile));
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY);
  assert.equal(result.resolution.valid, true);
  assert.equal(result.artifactResolutions.length, 2);
  assert.deepEqual(result.cacheReceipt.artifacts.map((item) => [item.runnerClass, item.derivation]), [
    ['linux-isolated', 'official-signed-release-binary'],
    ['windows-proof-isolated', 'fixed-cross-build-from-official-release-source'],
  ]);
  assert.equal(result.cacheReceipt.artifacts[0].signatureVerified, true);
  assert.equal(result.cacheReceipt.artifacts[1].signatureVerified, false);
  assert.equal(result.cacheReceipt.artifacts[1].sourceBuildVerified, true);
  const cacheRoot = join(userProfile, 'AppData', 'Local', 'Stephanos', 'forge-shadow', 'artifacts', VERSION);
  assert.deepEqual(readFileSync(join(cacheRoot, 'forgejo-runner-linux-amd64')), LINUX);
  assert.deepEqual(readFileSync(join(cacheRoot, 'forgejo-runner-windows-amd64.exe')), WINDOWS);
  assert.equal(containsForbiddenLocationKey(result), false);
}));

test('requires no nonexistent official Windows release asset', async () => withProfile(async (userProfile) => {
  assert.equal(release().value.assets.some((asset) => /windows/i.test(asset.name)), false);
  const result = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile));
  assert.equal(result.ok, true);
}));

test('reuses only byte-identical immutable cache entries', async () => withProfile(async (userProfile) => {
  const first = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile));
  const second = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.cacheReceipt.artifacts, second.cacheReceipt.artifacts);
}));

test('fails closed on non-Windows execution, widened input, or canonical source drift', async () => withProfile(async (userProfile) => {
  const nonWindows = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile, { platform: 'linux' }));
  assert.equal(nonWindows.finalVerdict, FORGE_SHADOW_M3_ARTIFACT_PREPARATION_BLOCKED);
  assert.ok(nonWindows.blockers.includes('connected-windows-battle-bridge-required'));
  const widened = await prepareForgeShadowM3RunnerArtifacts(input({ url: 'https://example.invalid' }), options(userProfile));
  assert.ok(widened.blockers.includes('input-fields-invalid'));
  const driftedRun = (_executable, args) => (args.includes('branch')
    ? { status: 0, stdout: 'feature\n', stderr: '' }
    : runCommand(_executable, args));
  const drifted = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile, { runCommand: driftedRun }));
  assert.ok(drifted.blockers.includes('canonical-source-identity-mismatch'));
}));

test('rejects bad Linux signature, checksum, or Windows source-build evidence before caching', async () => withProfile(async (userProfile) => {
  const badSignature = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile, { verifySignature: async () => false }));
  assert.ok(badSignature.blockers.includes('official-linux-signature-invalid'));
  const badChecksumFetch = (url, fetchOptions) => (url.endsWith('.sha256')
    ? Buffer.from(`${'0'.repeat(64)}  ${LINUX_NAME}\n`, 'utf8')
    : fetchFixed(url, fetchOptions));
  const badChecksum = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile, { fetchFixed: badChecksumFetch }));
  assert.ok(badChecksum.blockers.includes('official-linux-checksum-invalid'));
  const badBuild = await prepareForgeShadowM3RunnerArtifacts(input(), options(userProfile, {
    buildWindows: () => ({ ...buildWindows({ sourceArchive: SOURCE, version: VERSION, sourceCommit: SOURCE_COMMIT }), sourceCommit: '0'.repeat(40) }),
  }));
  assert.ok(badBuild.blockers.includes('fixed-windows-source-build-invalid'));
  assert.equal(existsSync(join(userProfile, 'AppData', 'Local', 'Stephanos', 'forge-shadow', 'artifacts', VERSION)), false);
}));

test('the request has no caller-controlled network, path, command, build, or credential surface', () => {
  assert.deepEqual(Object.keys(input()).sort(), [
    'expectedHead', 'expectedTree', 'm3Only', 'observationId', 'operatorApproved',
    'repository', 'requestId', 'requestedAtUtc',
  ]);
  const source = readFileSync(new URL('./forgeShadowM3ArtifactPreparationV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /https:\/\/data\.forgejo\.org\/api\/v1\/repos\/forgejo\/runner\/releases\/latest/);
  assert.match(source, /https:\/\/code\.forgejo\.org\/forgejo\/runner\/archive/);
  assert.match(source, /GOPROXY: 'https:\/\/proxy\.golang\.org'/);
  assert.match(source, /GOTOOLCHAIN: 'local'/);
  assert.match(source, /EB114F5E6C0DC2BCDD183550A4B61A2DC5923710/);
  assert.doesNotMatch(source, /input\.(?:url|path|command|token|credential|build)/i);
});

test('proof references use the canonical Windows-safe mailbox filename', async () => withProfile(async (userProfile) => {
  const requestId = 'CON.proof:forge-m3-artifact-001';
  const result = await prepareForgeShadowM3RunnerArtifacts(input({ requestId }), options(userProfile));
  assert.equal(result.ok, true);
  assert.match(result.proofRefs[0], /^receipts\/github-command-mailbox\/_request-[0-9a-f]{32}\.json$/);
  assert.doesNotMatch(result.proofRefs[0], /CON\.proof/i);
}));
