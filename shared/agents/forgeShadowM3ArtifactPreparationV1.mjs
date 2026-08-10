import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY,
  FORGE_SHADOW_M3_ARTIFACT_SOURCE,
  resolveForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3RunnerArtifactResolverV1.mjs';

export const FORGE_SHADOW_M3_ARTIFACT_PREPARATION_SCHEMA =
  'stephanos.forge-shadow-m3-artifact-preparation.v1';
export const FORGE_SHADOW_M3_ARTIFACT_CACHE_RECEIPT_SCHEMA =
  'stephanos.forge-shadow-m3-artifact-cache-receipt.v1';
export const FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY =
  'FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY';
export const FORGE_SHADOW_M3_ARTIFACT_PREPARATION_BLOCKED =
  'FORGE_SHADOW_M3_ARTIFACT_PREPARATION_BLOCKED';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const RELEASE_API = 'https://data.forgejo.org/api/v1/repos/forgejo/runner/releases/latest';
const RELEASE_BASE = 'https://code.forgejo.org/forgejo/runner/releases/download';
const SOURCE_BASE = 'https://code.forgejo.org/forgejo/runner/archive';
const TAG_REF_API = 'https://code.forgejo.org/api/v1/repos/forgejo/runner/git/refs/tags';
const SIGNING_KEY = 'https://keys.openpgp.org/vks/v1/by-fingerprint/EB114F5E6C0DC2BCDD183550A4B61A2DC5923710';
const SIGNING_FINGERPRINT = 'EB114F5E6C0DC2BCDD183550A4B61A2DC5923710';
const SCRIPT_RELATIVE_PATH = 'shared/agents/forgeShadowM3ArtifactPreparationV1.mjs';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/i;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const MIN_BINARY_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_KEY_BYTES = 512 * 1024;
const INPUT_KEYS = [
  'repository', 'expectedHead', 'expectedTree', 'requestId', 'observationId',
  'requestedAtUtc', 'operatorApproved', 'm3Only',
];
const CONTRACTS = Object.freeze([
  Object.freeze({
    runnerClass: 'linux-isolated', platform: 'linux/amd64', assetId: 'forge-m3-linux-runner-artifact-v1',
    logicalId: 'forgejo-runner-linux-amd64', cacheName: 'forgejo-runner-linux-amd64',
    executableFormat: 'elf', derivation: 'official-signed-release-binary', magic: Object.freeze([0x7f, 0x45, 0x4c, 0x46]),
  }),
  Object.freeze({
    runnerClass: 'windows-proof-isolated', platform: 'windows/amd64', assetId: 'forge-m3-windows-proof-runner-artifact-v1',
    logicalId: 'forgejo-runner-windows-amd64', cacheName: 'forgejo-runner-windows-amd64.exe',
    executableFormat: 'pe', derivation: 'fixed-cross-build-from-official-release-source', magic: Object.freeze([0x4d, 0x5a]),
  }),
]);

const text = (value) => String(value ?? '').trim();
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const sha256 = (value) => `sha256:${sha256Hex(value)}`;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function authority() {
  return Object.freeze({
    futureNetworkAccess: false, futureFilesystemWrite: false, runnerInstallation: false,
    runnerRegistration: false, runnerExecution: false, workflowExecution: false,
    sourceMutation: false, gitRefWrite: false, githubCredentialAccess: false,
    secretAccess: false, merge: false, deployment: false, arbitraryCommand: false,
  });
}

function blocked(blockers = []) {
  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_SCHEMA,
    ok: false,
    finalVerdict: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_BLOCKED,
    blockers: Object.freeze([...new Set(blockers)]),
    artifactResolutions: Object.freeze([]),
    cacheReceipt: null,
    resolution: null,
    authority: authority(),
  });
}

function validateInput(input, nowMs) {
  const blockers = [];
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');
  if (input?.repository !== REPOSITORY) blockers.push('repository-mismatch');
  if (!SHA40.test(text(input?.expectedHead).toLowerCase())) blockers.push('expected-head-invalid');
  if (!SHA40.test(text(input?.expectedTree).toLowerCase())) blockers.push('expected-tree-invalid');
  if (!SAFE_ID.test(text(input?.requestId))) blockers.push('request-id-invalid');
  if (!SAFE_ID.test(text(input?.observationId))) blockers.push('observation-id-invalid');
  if (text(input?.requestId) === text(input?.observationId)) blockers.push('request-and-observation-id-must-differ');
  const requestedMs = Date.parse(text(input?.requestedAtUtc));
  if (!Number.isFinite(requestedMs) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text(input?.requestedAtUtc))) blockers.push('requested-at-invalid');
  else if (requestedMs > nowMs || nowMs - requestedMs > 15 * 60 * 1000) blockers.push('request-time-out-of-bounds');
  if (input?.operatorApproved !== true) blockers.push('operator-approval-required');
  if (input?.m3Only !== true) blockers.push('m3-only-required');
  return blockers;
}

function runExact(runCommand, executable, args, options = {}) {
  const result = runCommand(executable, args, {
    cwd: options.cwd, env: options.env, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: options.timeout || 120_000, maxBuffer: options.maxBuffer || MAX_METADATA_BYTES,
  });
  return Object.freeze({ ok: !result?.error && result?.status === 0, stdout: text(result?.stdout), stderr: text(result?.stderr) });
}

function defaultRun(executable, args, options) { return spawnSync(executable, args, options); }

function readSourceIdentity(runCommand, repositoryRoot, head, modulePath) {
  const branch = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot });
  const observedHead = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  const tree = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${head}^{tree}`], { cwd: repositoryRoot });
  const committed = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${head}:${SCRIPT_RELATIVE_PATH}`], { cwd: repositoryRoot });
  const working = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['hash-object', `--path=${SCRIPT_RELATIVE_PATH}`, modulePath], { cwd: repositoryRoot });
  return Object.freeze({
    ok: branch.ok && observedHead.ok && tree.ok && committed.ok && working.ok,
    branch: branch.stdout, head: observedHead.stdout.toLowerCase(), tree: tree.stdout.toLowerCase(),
    committed: committed.stdout.toLowerCase(), working: working.stdout.toLowerCase(),
  });
}

function sourceMatches(source, head, tree) {
  return Boolean(source?.ok && source.branch === 'main' && source.head === head && source.tree === tree
    && SHA40.test(source.committed) && source.working === source.committed);
}

async function defaultFetch(url, { maximumBytes, binary = false } = {}) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Accept: binary ? 'application/octet-stream' : 'application/json' } });
  if (!response.ok) throw new Error('fixed-fetch-failed');
  const final = new URL(response.url);
  if (!['data.forgejo.org', 'code.forgejo.org', 'keys.openpgp.org'].includes(final.hostname)) throw new Error('fixed-fetch-host-drift');
  const declaredHeader = response.headers.get('content-length');
  const declaredLength = declaredHeader === null ? Number.NaN : Number(declaredHeader);
  if (Number.isFinite(declaredLength) && (declaredLength < 1 || declaredLength > maximumBytes)) throw new Error('fixed-fetch-size-invalid');
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > maximumBytes) throw new Error('fixed-fetch-size-invalid');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, received);
  if (bytes.length < 1 || bytes.length > maximumBytes) throw new Error('fixed-fetch-size-invalid');
  return bytes;
}

function defaultVerifySignature({ binary, signature, publicKey, fingerprint, gpgPath }) {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-forge-m3-gpg-'));
  try {
    const binaryPath = join(root, 'runner.bin');
    const signaturePath = join(root, 'runner.asc');
    const keyPath = join(root, 'forgejo-release.asc');
    writeFileSync(binaryPath, binary, { mode: 0o600 });
    writeFileSync(signaturePath, signature, { mode: 0o600 });
    writeFileSync(keyPath, publicKey, { mode: 0o600 });
    const imported = runExact(defaultRun, gpgPath, ['--batch', '--homedir', root, '--import', keyPath]);
    if (!imported.ok) return false;
    const verified = runExact(defaultRun, gpgPath, ['--batch', '--homedir', root, '--status-fd=1', '--verify', signaturePath, binaryPath]);
    return verified.ok && verified.stdout.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[0] === '[GNUPG:]' && fields[1] === 'VALIDSIG' && fields.includes(fingerprint);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validateArchiveList(value) {
  const entries = value.split(/\r?\n/).map(text).filter(Boolean);
  return entries.length > 10 && entries.every((entry) => {
    const normalized = entry.replaceAll('\\', '/');
    return normalized.startsWith('runner/') && !normalized.startsWith('/')
      && !normalized.split('/').includes('..') && !normalized.includes('\0');
  });
}

function minimalBuildEnvironment(root, goPath) {
  const systemRoot = text(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows');
  return Object.freeze({
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    ComSpec: join(systemRoot, 'System32', 'cmd.exe'),
    PATH: `${dirname(goPath)};${join(systemRoot, 'System32')}`,
    TEMP: join(root, 'tmp'),
    TMP: join(root, 'tmp'),
    GOOS: 'windows',
    GOARCH: 'amd64',
    CGO_ENABLED: '0',
    GOFLAGS: '-mod=readonly',
    GOTOOLCHAIN: 'local',
    GOENV: 'off',
    GOPROXY: 'https://proxy.golang.org',
    GOSUMDB: 'sum.golang.org',
    GOPATH: join(root, 'gopath'),
    GOCACHE: join(root, 'gocache'),
    GOMODCACHE: join(root, 'gomodcache'),
  });
}

function defaultBuildWindows({ sourceArchive, version, sourceCommit, runCommand, goPath, tarPath }) {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-forge-m3-windows-build-'));
  try {
    const archivePath = join(root, 'runner-source.tar.gz');
    const outputPath = join(root, 'forgejo-runner-windows-amd64.exe');
    writeFileSync(archivePath, sourceArchive, { mode: 0o600, flag: 'wx' });
    const listed = runExact(runCommand, tarPath, ['-tzf', archivePath], { maxBuffer: 16 * 1024 * 1024 });
    if (!listed.ok || !validateArchiveList(listed.stdout)) throw new Error('source-archive-layout-invalid');
    const extracted = runExact(runCommand, tarPath, ['-xzf', archivePath, '-C', root]);
    if (!extracted.ok) throw new Error('source-archive-extract-failed');
    const sourceRoot = join(root, 'runner');
    const versionPath = join(sourceRoot, 'VERSION');
    const goModPath = join(sourceRoot, 'go.mod');
    const goSumPath = join(sourceRoot, 'go.sum');
    for (const required of [sourceRoot, versionPath, goModPath, goSumPath]) {
      if (!existsSync(required) || lstatSync(required).isSymbolicLink()) throw new Error('source-required-file-invalid');
    }
    if (text(readFileSync(versionPath, 'utf8')) !== version) throw new Error('source-version-mismatch');
    const goMod = readFileSync(goModPath, 'utf8');
    const major = version.split('.')[0];
    const expectedModule = `code.forgejo.org/forgejo/runner/v${major}`;
    const moduleMatch = goMod.match(/^module\s+(\S+)$/m);
    const toolchainMatch = goMod.match(/^toolchain\s+(go\d+\.\d+\.\d+)$/m);
    if (moduleMatch?.[1] !== expectedModule || !toolchainMatch) throw new Error('source-module-contract-invalid');
    mkdirSync(join(root, 'tmp'), { recursive: true });
    const env = minimalBuildEnvironment(root, goPath);
    const toolchain = runExact(runCommand, goPath, ['version'], { env, maxBuffer: 16 * 1024 });
    if (!toolchain.ok || !toolchain.stdout.includes(`go version ${toolchainMatch[1]} windows/amd64`)) {
      throw new Error('go-toolchain-version-mismatch');
    }
    const ldflags = `-extldflags "-static" -s -w -X "${expectedModule}/internal/pkg/ver.version=v${version}"`;
    const buildArgs = ['build', '-trimpath', '-buildvcs=false', '-tags', 'netgo osusergo', '-ldflags', ldflags, '-o', outputPath, '.'];
    const built = runExact(runCommand, goPath, buildArgs, { cwd: sourceRoot, env, timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
    if (!built.ok || !existsSync(outputPath)) throw new Error('windows-build-failed');
    const binary = readFileSync(outputPath);
    if (binary.length < MIN_BINARY_BYTES || binary.length > MAX_BINARY_BYTES || binary[0] !== 0x4d || binary[1] !== 0x5a) {
      throw new Error('windows-build-format-invalid');
    }
    const inspected = runExact(runCommand, goPath, ['version', '-m', outputPath], { env, maxBuffer: MAX_METADATA_BYTES });
    if (!inspected.ok || !inspected.stdout.includes(expectedModule) || !inspected.stdout.includes(`GOOS=windows`)
        || !inspected.stdout.includes(`GOARCH=amd64`)) throw new Error('windows-build-inspection-failed');
    return Object.freeze({
      binary,
      sourceCommit,
      sourceArchiveDigest: sha256(sourceArchive),
      sourceGoSumDigest: sha256(readFileSync(goSumPath)),
      sourceModuleDigest: sha256(goMod),
      toolchainVersion: toolchainMatch[1],
      buildRecipeDigest: sha256(Buffer.from(stable({ buildArgs, env: {
        GOOS: env.GOOS, GOARCH: env.GOARCH, CGO_ENABLED: env.CGO_ENABLED, GOFLAGS: env.GOFLAGS,
        GOTOOLCHAIN: env.GOTOOLCHAIN, GOPROXY: env.GOPROXY, GOSUMDB: env.GOSUMDB,
      } }), 'utf8')),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function findReleaseAsset(release, name) {
  return Array.isArray(release?.assets) ? release.assets.find((item) => item?.name === name) : null;
}

function declaredSizeMatches(asset, bytes) {
  return !Number.isSafeInteger(asset?.size) || asset.size === bytes.length;
}

function cacheArtifact(cacheRoot, name, bytes, digest) {
  mkdirSync(cacheRoot, { recursive: true });
  const target = join(cacheRoot, name);
  if (existsSync(target)) {
    if (sha256(readFileSync(target)) !== digest) throw new Error('existing-cache-digest-mismatch');
    return;
  }
  const temporary = join(cacheRoot, `.${basename(name)}.${process.pid}.tmp`);
  writeFileSync(temporary, bytes, { mode: 0o700, flag: 'wx' });
  if (sha256(readFileSync(temporary)) !== digest) throw new Error('temporary-cache-digest-mismatch');
  renameSync(temporary, target);
}

export async function prepareForgeShadowM3RunnerArtifacts(input = {}, {
  platform = process.platform,
  now = () => new Date(),
  repositoryRoot,
  userProfile,
  runCommand = defaultRun,
  fetchFixed = defaultFetch,
  verifySignature = defaultVerifySignature,
  buildWindows = defaultBuildWindows,
  gpgPath = 'C:\\Program Files\\Git\\usr\\bin\\gpg.exe',
  goPath = 'C:\\Program Files\\Go\\bin\\go.exe',
  tarPath = 'C:\\Windows\\System32\\tar.exe',
} = {}) {
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(nowValue);
  const blockers = Number.isFinite(nowMs) ? validateInput(input, nowMs) : ['now-invalid'];
  if (platform !== 'win32') blockers.push('connected-windows-battle-bridge-required');
  if (blockers.length) return blocked(blockers);
  const profile = resolve(userProfile || process.env.USERPROFILE || homedir());
  const root = resolve(repositoryRoot || join(profile, 'Documents', 'GitHub', 'stephan-os'));
  const modulePath = resolve(root, ...SCRIPT_RELATIVE_PATH.split('/'));
  if (!existsSync(root) || !existsSync(modulePath)) return blocked(['canonical-source-missing']);
  const head = text(input.expectedHead).toLowerCase();
  const tree = text(input.expectedTree).toLowerCase();
  const sourceBefore = readSourceIdentity(runCommand, root, head, modulePath);
  if (!sourceMatches(sourceBefore, head, tree)) return blocked(['canonical-source-identity-mismatch']);

  try {
    const releaseBytes = await fetchFixed(RELEASE_API, { maximumBytes: MAX_METADATA_BYTES, binary: false });
    const release = JSON.parse(releaseBytes.toString('utf8'));
    const version = text(release?.tag_name || release?.name).replace(/^v/, '');
    if (!SEMVER.test(version) || release?.draft === true || release?.prerelease === true) return blocked(['stable-release-invalid']);
    const tagRefBytes = await fetchFixed(`${TAG_REF_API}/v${version}`, { maximumBytes: MAX_METADATA_BYTES, binary: false });
    const tagRefs = JSON.parse(tagRefBytes.toString('utf8'));
    const tagRef = Array.isArray(tagRefs) ? tagRefs.find((item) => item?.ref === `refs/tags/v${version}`) : tagRefs;
    const sourceCommit = text(tagRef?.object?.sha).toLowerCase();
    if (tagRef?.object?.type !== 'commit' || !SHA40.test(sourceCommit)) return blocked(['release-source-commit-invalid']);

    const linuxName = `forgejo-runner-${version}-linux-amd64`;
    const linuxAsset = findReleaseAsset(release, linuxName);
    const signatureAsset = findReleaseAsset(release, `${linuxName}.asc`);
    const checksumAsset = findReleaseAsset(release, `${linuxName}.sha256`);
    if (!linuxAsset || !signatureAsset || !checksumAsset) return blocked(['official-linux-release-estate-incomplete']);
    const linuxUrl = `${RELEASE_BASE}/v${version}/${linuxName}`;
    const [linux, signature, checksumBytes, publicKey, sourceArchive] = await Promise.all([
      fetchFixed(linuxUrl, { maximumBytes: MAX_BINARY_BYTES, binary: true }),
      fetchFixed(`${linuxUrl}.asc`, { maximumBytes: MAX_SIGNATURE_BYTES, binary: true }),
      fetchFixed(`${linuxUrl}.sha256`, { maximumBytes: MAX_METADATA_BYTES, binary: false }),
      fetchFixed(SIGNING_KEY, { maximumBytes: MAX_KEY_BYTES, binary: true }),
      fetchFixed(`${SOURCE_BASE}/${sourceCommit}.tar.gz`, { maximumBytes: MAX_SOURCE_BYTES, binary: true }),
    ]);
    if (!declaredSizeMatches(linuxAsset, linux) || !declaredSizeMatches(signatureAsset, signature)
        || !declaredSizeMatches(checksumAsset, checksumBytes)) return blocked(['official-linux-release-size-mismatch']);
    if (linux.length < MIN_BINARY_BYTES || linux[0] !== 0x7f || linux[1] !== 0x45 || linux[2] !== 0x4c || linux[3] !== 0x46) {
      return blocked(['official-linux-release-format-invalid']);
    }
    const linuxDigest = sha256(linux);
    const checksumMatch = checksumBytes.toString('utf8').trim().match(/^([0-9a-f]{64})\s{2}(\S+)$/);
    if (!checksumMatch || checksumMatch[1] !== linuxDigest.slice(7) || checksumMatch[2] !== linuxName) {
      return blocked(['official-linux-checksum-invalid']);
    }
    if (await verifySignature({ binary: linux, signature, publicKey, fingerprint: SIGNING_FINGERPRINT, gpgPath }) !== true) {
      return blocked(['official-linux-signature-invalid']);
    }

    const windowsBuild = await buildWindows({ sourceArchive, version, sourceCommit, runCommand, goPath, tarPath });
    const windows = windowsBuild?.binary;
    if (!Buffer.isBuffer(windows) || windows.length < MIN_BINARY_BYTES || windows.length > MAX_BINARY_BYTES
        || windows[0] !== 0x4d || windows[1] !== 0x5a || windowsBuild.sourceCommit !== sourceCommit
        || !DIGEST.test(text(windowsBuild.sourceArchiveDigest)) || !DIGEST.test(text(windowsBuild.sourceGoSumDigest))
        || !DIGEST.test(text(windowsBuild.sourceModuleDigest)) || !DIGEST.test(text(windowsBuild.buildRecipeDigest))) {
      return blocked(['fixed-windows-source-build-invalid']);
    }
    const windowsDigest = sha256(windows);
    const requestBindingDigest = sha256(Buffer.from(stable({
      schemaVersion: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_SCHEMA,
      repository: REPOSITORY, expectedHead: head, expectedTree: tree, requestId: input.requestId,
      observationId: input.observationId, requestedAtUtc: input.requestedAtUtc,
    }), 'utf8'));
    const proofRefs = Object.freeze([`receipts/github-command-mailbox/${input.requestId}.json`]);
    const releaseManifestDigest = sha256(releaseBytes);
    const checksumManifestDigest = sha256(checksumBytes);
    const provenanceDigest = sha256(Buffer.from(stable({
      signingFingerprint: SIGNING_FINGERPRINT,
      linuxSignatureDigest: sha256(signature),
      sourceCommit,
      sourceArchiveDigest: windowsBuild.sourceArchiveDigest,
      sourceGoSumDigest: windowsBuild.sourceGoSumDigest,
      sourceModuleDigest: windowsBuild.sourceModuleDigest,
      toolchainVersion: windowsBuild.toolchainVersion,
      buildRecipeDigest: windowsBuild.buildRecipeDigest,
    }), 'utf8'));
    const prepared = [
      { contract: CONTRACTS[0], binary: linux, digest: linuxDigest, bytes: linux.length, signatureVerified: true },
      { contract: CONTRACTS[1], binary: windows, digest: windowsDigest, bytes: windows.length, signatureVerified: false },
    ];
    const releaseObservation = Object.freeze({
      sourceIdentity: FORGE_SHADOW_M3_ARTIFACT_SOURCE,
      releaseChannel: 'stable',
      version,
      observedAtUtc: new Date(nowMs).toISOString(),
      releaseManifestDigest,
      checksumManifestDigest,
      provenanceDigest,
      proofRefs,
      tlsVerified: true,
      releaseManifestVerified: true,
      checksumManifestVerified: true,
      mutableReferenceAccepted: false,
      credentialUsed: false,
      assets: Object.freeze(prepared.map(({ contract, digest, bytes: artifactBytes }) => Object.freeze({
        assetId: contract.assetId,
        platform: contract.platform,
        artifactLogicalId: contract.logicalId,
        artifactDigest: digest,
        checksumDigest: digest,
        manifestEntryDigest: sha256(Buffer.from(stable({
          assetId: contract.assetId, digest, artifactBytes, derivation: contract.derivation,
          sourceCommit: contract.runnerClass === 'windows-proof-isolated' ? sourceCommit : null,
        }), 'utf8')),
        artifactBytes,
        contentType: 'application/octet-stream',
        executableFormat: contract.executableFormat,
        proofRefs,
      }))),
    });
    const resolution = resolveForgeShadowM3RunnerArtifacts({
      repository: REPOSITORY,
      canonicalMainHead: head,
      canonicalMainTree: tree,
      nowUtc: new Date(nowMs).toISOString(),
      releaseObservation,
    });
    if (resolution?.valid !== true || resolution?.finalVerdict !== FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY) {
      return blocked(['canonical-artifact-resolution-rejected']);
    }
    const cacheRoot = join(profile, 'AppData', 'Local', 'Stephanos', 'forge-shadow', 'artifacts', version);
    for (const item of prepared) cacheArtifact(cacheRoot, item.contract.cacheName, item.binary, item.digest);
    const sourceAfter = readSourceIdentity(runCommand, root, head, modulePath);
    if (!sourceMatches(sourceAfter, head, tree) || sourceAfter.committed !== sourceBefore.committed) {
      return blocked(['post-cache-source-identity-changed']);
    }
    const cacheReceipt = Object.freeze({
      schemaVersion: FORGE_SHADOW_M3_ARTIFACT_CACHE_RECEIPT_SCHEMA,
      valid: true,
      repository: REPOSITORY,
      sourceHead: head,
      sourceTree: tree,
      requestBindingDigest,
      version,
      sourceCommit,
      signingFingerprint: SIGNING_FINGERPRINT,
      artifactCount: prepared.length,
      artifacts: Object.freeze(prepared.map((item) => Object.freeze({
        runnerClass: item.contract.runnerClass,
        artifactLogicalId: item.contract.logicalId,
        artifactDigest: item.digest,
        artifactBytes: item.bytes,
        cacheIdentity: `forge-shadow/artifacts/${version}/${item.contract.cacheName}`,
        derivation: item.contract.derivation,
        signatureVerified: item.signatureVerified,
        sourceBuildVerified: item.contract.runnerClass === 'windows-proof-isolated',
      }))),
      sourceArchiveDigest: windowsBuild.sourceArchiveDigest,
      sourceGoSumDigest: windowsBuild.sourceGoSumDigest,
      sourceModuleDigest: windowsBuild.sourceModuleDigest,
      toolchainVersion: windowsBuild.toolchainVersion,
      buildRecipeDigest: windowsBuild.buildRecipeDigest,
      proofRefs,
      networkFetchPerformed: true,
      artifactDownloadPerformed: true,
      sourceBuildPerformed: true,
      immutableCacheWritePerformed: true,
      callerLocationAccepted: false,
      credentialUsed: false,
      completedAtUtc: new Date(nowMs).toISOString(),
    });
    return Object.freeze({
      schemaVersion: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_SCHEMA,
      ok: true,
      finalVerdict: FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY,
      repository: REPOSITORY,
      sourceHead: head,
      sourceTree: tree,
      requestBindingDigest,
      artifactResolutions: resolution.artifactResolutions,
      artifactSetDigest: resolution.artifactSetDigest,
      cacheReceipt,
      resolution,
      proofRefs,
      authority: authority(),
    });
  } catch {
    return blocked(['fixed-artifact-preparation-failed']);
  }
}
