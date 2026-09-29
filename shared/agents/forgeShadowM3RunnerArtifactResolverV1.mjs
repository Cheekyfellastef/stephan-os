import { createHash } from 'node:crypto';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_OBSERVATION_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export const FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_SCHEMA = 'stephanos.forge-shadow-m3-runner-artifact-resolution.v1';
export const FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY = 'FORGE_SHADOW_M3_RUNNER_ARTIFACT_RESOLUTION_READY';
export const FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_BLOCKED = 'FORGE_SHADOW_M3_RUNNER_ARTIFACT_RESOLUTION_BLOCKED';
export const FORGE_SHADOW_M3_ARTIFACT_SOURCE = 'forgejo-official-runner-release';
export const FORGE_SHADOW_M3_ARTIFACT_REPOSITORY = 'Cheekyfellastef/stephan-os';

const INPUT_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'canonicalMainTree',
  'nowUtc',
  'releaseObservation',
]);
const RELEASE_KEYS = Object.freeze([
  'sourceIdentity',
  'releaseChannel',
  'version',
  'observedAtUtc',
  'releaseManifestDigest',
  'checksumManifestDigest',
  'provenanceDigest',
  'proofRefs',
  'tlsVerified',
  'releaseManifestVerified',
  'checksumManifestVerified',
  'mutableReferenceAccepted',
  'credentialUsed',
  'assets',
]);
const ASSET_KEYS = Object.freeze([
  'assetId',
  'platform',
  'artifactLogicalId',
  'artifactDigest',
  'checksumDigest',
  'manifestEntryDigest',
  'artifactBytes',
  'contentType',
  'executableFormat',
  'proofRefs',
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'credentials', 'cookie', 'session', 'privatekey', 'publickey', 'selector',
  'javascript', 'password', 'secret', 'secrets', 'dockerhost', 'podmansocket',
  'dockersocket', 'registrationtoken', 'registrationkey',
]);
const CONTRACTS = Object.freeze({
  'linux/amd64': Object.freeze({
    runnerClass: 'linux-isolated',
    artifactId: 'forge-m3-linux-runner-artifact-v1',
    logicalId: 'forgejo-runner-linux-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'elf',
  }),
  'windows/amd64': Object.freeze({
    runnerClass: 'windows-proof-isolated',
    artifactId: 'forge-m3-windows-proof-runner-artifact-v1',
    logicalId: 'forgejo-runner-windows-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'pe',
  }),
});

const text = (value) => String(value ?? '').trim();
const integer = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN);
const unique = (values) => [...new Set(values)];

function instant(value) {
  const normalized = text(value);
  if (!EXPLICIT_TIMEZONE.test(normalized)) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function findForbiddenField(value, trail = []) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], [...trail, String(index)]);
      if (found) return found;
    }
    return '';
  }
  for (const [key, nested] of Object.entries(value)) {
    const next = [...trail, key];
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) return next.join('.');
    const found = findForbiddenField(nested, next);
    if (found) return found;
  }
  return '';
}

function safeProofRefs(value, maximum = 12) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null;
  const refs = unique(value.map(text).filter(Boolean)).sort();
  return refs.length === value.length
    && refs.every((ref) => SAFE_PROOF_REF.test(ref) && !ref.includes('..'))
    ? Object.freeze(refs)
    : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (value) => createHash('sha256').update(stable(value), 'utf8').digest('hex');

function authorityProjection() {
  return Object.freeze({
    networkFetch: false,
    artifactDownload: false,
    filesystemWrite: false,
    runnerInstallation: false,
    runnerRegistration: false,
    runnerConnection: false,
    runnerExecution: false,
    workflowExecution: false,
    sourceMutation: false,
    gitRefWrite: false,
    canonicalCheckoutAccess: false,
    hostProcessAccess: false,
    containerSocketAccess: false,
    githubCredentialAccess: false,
    secretAccess: false,
    publicExposure: false,
    tailscaleExposure: false,
    merge: false,
    deployment: false,
    arbitraryCommand: false,
  });
}

function normalizeAsset(asset, release, blockers) {
  const platform = text(asset?.platform).toLowerCase();
  const contract = CONTRACTS[platform];
  const id = text(asset?.assetId) || platform || 'unknown';
  const digest = text(asset?.artifactDigest).toLowerCase();
  const checksumDigest = text(asset?.checksumDigest).toLowerCase();
  const manifestEntryDigest = text(asset?.manifestEntryDigest).toLowerCase();
  const artifactBytes = integer(asset?.artifactBytes);
  const assetProofRefs = safeProofRefs(asset?.proofRefs);

  if (!exactKeys(asset, ASSET_KEYS)) blockers.push(`asset-fields-invalid:${id}`);
  if (!contract) blockers.push(`asset-platform-invalid:${id}`);
  if (!SAFE_ID.test(text(asset?.assetId))) blockers.push(`asset-id-invalid:${id}`);
  if (contract && asset?.assetId !== contract.artifactId) blockers.push(`asset-id-mismatch:${id}`);
  if (contract && asset?.artifactLogicalId !== contract.logicalId) blockers.push(`asset-logical-id-mismatch:${id}`);
  if (!DIGEST.test(digest)) blockers.push(`asset-digest-invalid:${id}`);
  if (!DIGEST.test(checksumDigest) || checksumDigest !== digest) blockers.push(`asset-checksum-mismatch:${id}`);
  if (!DIGEST.test(manifestEntryDigest)) blockers.push(`asset-manifest-entry-digest-invalid:${id}`);
  if (!Number.isSafeInteger(artifactBytes)
      || artifactBytes < MIN_ARTIFACT_BYTES
      || artifactBytes > MAX_ARTIFACT_BYTES) blockers.push(`asset-size-invalid:${id}`);
  if (contract && asset?.contentType !== contract.contentType) blockers.push(`asset-content-type-mismatch:${id}`);
  if (contract && asset?.executableFormat !== contract.executableFormat) blockers.push(`asset-executable-format-mismatch:${id}`);
  if (!assetProofRefs) blockers.push(`asset-proof-refs-invalid:${id}`);

  const combinedRefs = release.proofRefs && assetProofRefs
    ? Object.freeze(unique([...release.proofRefs, ...assetProofRefs]).sort())
    : Object.freeze([]);

  return Object.freeze({
    artifactId: contract?.artifactId || text(asset?.assetId),
    runnerClass: contract?.runnerClass || '',
    sourceIdentity: FORGE_SHADOW_M3_ARTIFACT_SOURCE,
    releaseChannel: 'stable',
    version: release.version,
    platform,
    artifactLogicalId: contract?.logicalId || text(asset?.artifactLogicalId),
    artifactDigest: digest,
    artifactBytes,
    releaseManifestDigest: release.releaseManifestDigest,
    checksumManifestDigest: release.checksumManifestDigest,
    provenanceDigest: release.provenanceDigest,
    resolvedAtUtc: release.observedAtUtc,
    proofRefs: combinedRefs,
    tlsVerified: true,
    releaseManifestVerified: true,
    checksumVerified: true,
    mutableReferenceAccepted: false,
    credentialUsed: false,
  });
}

export function resolveForgeShadowM3RunnerArtifacts(input = {}) {
  const blockers = [];
  const unsafeField = findForbiddenField(input);
  if (unsafeField) blockers.push(`unsafe-field:${unsafeField}`);
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');

  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(input.canonicalMainTree).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = instant(nowUtc);
  const release = input.releaseObservation;

  if (repository !== FORGE_SHADOW_M3_ARTIFACT_REPOSITORY) blockers.push('repository-mismatch');
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA40.test(canonicalMainTree)) blockers.push('canonical-main-tree-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');

  if (!exactKeys(release, RELEASE_KEYS)) blockers.push('release-fields-invalid');
  const sourceIdentity = text(release?.sourceIdentity);
  const releaseChannel = text(release?.releaseChannel).toLowerCase();
  const version = text(release?.version);
  const observedAtUtc = text(release?.observedAtUtc);
  const observedMs = instant(observedAtUtc);
  const releaseManifestDigest = text(release?.releaseManifestDigest).toLowerCase();
  const checksumManifestDigest = text(release?.checksumManifestDigest).toLowerCase();
  const provenanceDigest = text(release?.provenanceDigest).toLowerCase();
  const releaseProofRefs = safeProofRefs(release?.proofRefs);

  if (sourceIdentity !== FORGE_SHADOW_M3_ARTIFACT_SOURCE) blockers.push('release-source-identity-mismatch');
  if (releaseChannel !== 'stable' || !SEMVER.test(version)) blockers.push('release-version-invalid');
  if (!Number.isFinite(observedMs)) blockers.push('release-observation-time-invalid');
  else if (observedMs > nowMs || nowMs - observedMs > MAX_OBSERVATION_AGE_MS) blockers.push('release-observation-time-out-of-bounds');
  if (!DIGEST.test(releaseManifestDigest)) blockers.push('release-manifest-digest-invalid');
  if (!DIGEST.test(checksumManifestDigest)) blockers.push('checksum-manifest-digest-invalid');
  if (!DIGEST.test(provenanceDigest)) blockers.push('provenance-digest-invalid');
  if (!releaseProofRefs) blockers.push('release-proof-refs-invalid');
  if (release?.tlsVerified !== true) blockers.push('release-tls-proof-required');
  if (release?.releaseManifestVerified !== true) blockers.push('release-manifest-proof-required');
  if (release?.checksumManifestVerified !== true) blockers.push('checksum-manifest-proof-required');
  if (release?.mutableReferenceAccepted !== false) blockers.push('mutable-release-reference-forbidden');
  if (release?.credentialUsed !== false) blockers.push('release-credential-use-forbidden');

  const releaseIdentity = Object.freeze({
    version,
    observedAtUtc: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : '',
    releaseManifestDigest,
    checksumManifestDigest,
    provenanceDigest,
    proofRefs: releaseProofRefs || Object.freeze([]),
  });

  const rawAssets = Array.isArray(release?.assets) ? release.assets : null;
  if (!rawAssets || rawAssets.length !== 2) blockers.push('artifact-estate-must-be-exactly-two');
  const artifactResolutions = (rawAssets || [])
    .map((asset) => normalizeAsset(asset, releaseIdentity, blockers))
    .sort((left, right) => left.runnerClass.localeCompare(right.runnerClass));

  const runnerClasses = artifactResolutions.map((artifact) => artifact.runnerClass);
  if (new Set(runnerClasses).size !== runnerClasses.length) blockers.push('artifact-runner-class-duplicate');
  for (const runnerClass of ['linux-isolated', 'windows-proof-isolated']) {
    if (!runnerClasses.includes(runnerClass)) blockers.push(`artifact-runner-class-required:${runnerClass}`);
  }
  const artifactIds = artifactResolutions.map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) blockers.push('artifact-id-duplicate');
  const digests = artifactResolutions.map((artifact) => artifact.artifactDigest);
  if (new Set(digests).size !== digests.length) blockers.push('artifact-digest-duplicate');

  const valid = blockers.length === 0;
  const artifactSetDigest = valid ? sha256(artifactResolutions) : '';

  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_SCHEMA,
    valid,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    sourceIdentity,
    releaseChannel,
    version,
    observedAtUtc: releaseIdentity.observedAtUtc,
    decision: valid
      ? FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY
      : FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_BLOCKED,
    blockers: Object.freeze(unique(blockers)),
    artifactResolutions: Object.freeze(artifactResolutions),
    artifactSetDigest,
    authority: authorityProjection(),
    finalVerdict: valid
      ? FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY
      : FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_BLOCKED,
  });
}
