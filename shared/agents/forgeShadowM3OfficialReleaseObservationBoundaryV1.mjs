import { createHash } from 'node:crypto';
import {
  FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY,
  resolveForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3RunnerArtifactResolverV1.mjs';
import {
  buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest,
  parseForgeShadowM3StrictExplicitTimezoneInstant,
} from './forgeShadowM3OfficialReleaseObservationExecutionContractV1.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_OBSERVATION_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-observation-boundary.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_RECEIPT_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-observation-receipt.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE = 'forgejo-official-runner-release';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS =
  'source-controlled-readonly-official-release-observer';

const INPUT_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'canonicalMainTree',
  'requestId',
  'requestedAtUtc',
  'requestBindingDigest',
  'nowUtc',
  'observationReceipt',
]);

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'requestedAtUtc',
  'requestBindingDigest',
  'observationId',
  'observerClass',
  'sourceIdentity',
  'releaseChannel',
  'version',
  'observedAtUtc',
  'sourceBindingDigest',
  'releaseManifestDigest',
  'checksumManifestDigest',
  'provenanceDigest',
  'proofRefs',
  'tlsVerified',
  'releaseManifestVerified',
  'checksumManifestVerified',
  'provenanceVerified',
  'mutableReferenceAccepted',
  'credentialUsed',
  'callerEndpointAccepted',
  'artifactDownloadPerformed',
  'filesystemWritePerformed',
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
  'metadataOnly',
  'binaryContentPresent',
  'callerLocationAccepted',
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'endpoint', 'host', 'hostname', 'environment',
  'env', 'token', 'credential', 'credentials', 'cookie', 'session', 'privatekey',
  'publickey', 'selector', 'javascript', 'password', 'secret', 'secrets',
  'dockerhost', 'podmansocket', 'dockersocket', 'registrationtoken',
  'registrationkey', 'binary', 'base64', 'blob', 'archive', 'file', 'filename',
  'filepath', 'download', 'downloadurl', 'body', 'content', 'data', 'payload',
]);

const CONTRACTS = Object.freeze({
  'linux/amd64': Object.freeze({
    runnerClass: 'linux-isolated',
    assetId: 'forge-m3-linux-runner-artifact-v1',
    logicalId: 'forgejo-runner-linux-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'elf',
  }),
  'windows/amd64': Object.freeze({
    runnerClass: 'windows-proof-isolated',
    assetId: 'forge-m3-windows-proof-runner-artifact-v1',
    logicalId: 'forgejo-runner-windows-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'pe',
  }),
});

const text = (value) => String(value ?? '').trim();
const integer = (value) => (typeof value === 'number' && Number.isSafeInteger(value)
  ? value
  : Number.NaN);
const unique = (values) => [...new Set(values)];

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
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

function safeProofRefs(value, maximum = 16) {
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

function sha256(value) {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

export function buildForgeShadowM3OfficialReleaseSourceBindingDigest({
  repository,
  canonicalMainHead,
  canonicalMainTree,
  requestId,
  requestedAtUtc,
  requestBindingDigest,
  observationId,
} = {}) {
  return `sha256:${sha256({
    repository: text(repository),
    canonicalMainHead: text(canonicalMainHead).toLowerCase(),
    canonicalMainTree: text(canonicalMainTree).toLowerCase(),
    requestId: text(requestId),
    requestedAtUtc: text(requestedAtUtc),
    requestBindingDigest: text(requestBindingDigest).toLowerCase(),
    observationId: text(observationId),
    observerClass: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
    sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
  })}`;
}

function authorityProjection() {
  return Object.freeze({
    metadataObservation: false,
    networkFetch: false,
    artifactDownload: false,
    binaryContentAcceptance: false,
    filesystemRead: false,
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
    separateObservationExecutionAuthorizationRequired: true,
  });
}

function normalizeAsset(asset, blockers) {
  const platform = text(asset?.platform).toLowerCase();
  const contract = CONTRACTS[platform];
  const assetId = text(asset?.assetId);
  const label = assetId || platform || 'unknown';
  const artifactDigest = text(asset?.artifactDigest).toLowerCase();
  const checksumDigest = text(asset?.checksumDigest).toLowerCase();
  const manifestEntryDigest = text(asset?.manifestEntryDigest).toLowerCase();
  const artifactBytes = integer(asset?.artifactBytes);
  const proofRefs = safeProofRefs(asset?.proofRefs, 12);

  if (!exactKeys(asset, ASSET_KEYS)) blockers.push(`asset-fields-invalid:${label}`);
  if (!contract) blockers.push(`asset-platform-invalid:${label}`);
  if (!SAFE_ID.test(assetId)) blockers.push(`asset-id-invalid:${label}`);
  if (contract && assetId !== contract.assetId) blockers.push(`asset-id-mismatch:${label}`);
  if (contract && asset?.artifactLogicalId !== contract.logicalId) {
    blockers.push(`asset-logical-id-mismatch:${label}`);
  }
  if (!DIGEST.test(artifactDigest)) blockers.push(`asset-digest-invalid:${label}`);
  if (!DIGEST.test(checksumDigest) || checksumDigest !== artifactDigest) {
    blockers.push(`asset-checksum-mismatch:${label}`);
  }
  if (!DIGEST.test(manifestEntryDigest)) {
    blockers.push(`asset-manifest-entry-digest-invalid:${label}`);
  }
  if (!Number.isSafeInteger(artifactBytes)
      || artifactBytes < MIN_ARTIFACT_BYTES
      || artifactBytes > MAX_ARTIFACT_BYTES) {
    blockers.push(`asset-size-invalid:${label}`);
  }
  if (contract && asset?.contentType !== contract.contentType) {
    blockers.push(`asset-content-type-mismatch:${label}`);
  }
  if (contract && asset?.executableFormat !== contract.executableFormat) {
    blockers.push(`asset-executable-format-mismatch:${label}`);
  }
  if (!proofRefs) blockers.push(`asset-proof-refs-invalid:${label}`);
  if (asset?.metadataOnly !== true) blockers.push(`asset-metadata-only-required:${label}`);
  if (asset?.binaryContentPresent !== false) {
    blockers.push(`asset-binary-content-forbidden:${label}`);
  }
  if (asset?.callerLocationAccepted !== false) {
    blockers.push(`asset-caller-location-forbidden:${label}`);
  }

  return Object.freeze({
    assetId: contract?.assetId || assetId,
    runnerClass: contract?.runnerClass || '',
    platform,
    artifactLogicalId: contract?.logicalId || text(asset?.artifactLogicalId),
    artifactDigest,
    checksumDigest,
    manifestEntryDigest,
    artifactBytes,
    contentType: contract?.contentType || text(asset?.contentType),
    executableFormat: contract?.executableFormat || text(asset?.executableFormat),
    proofRefs: proofRefs || Object.freeze([]),
  });
}

export function planForgeShadowM3OfficialReleaseObservation(input = {}) {
  const blockers = [];
  const unsafeField = findForbiddenField(input);
  if (unsafeField) blockers.push(`unsafe-field:${unsafeField}`);
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');

  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(input.canonicalMainTree).toLowerCase();
  const requestId = text(input.requestId);
  const requestedAtUtc = text(input.requestedAtUtc);
  const requestedAtMs = parseForgeShadowM3StrictExplicitTimezoneInstant(requestedAtUtc);
  const requestBindingDigest = text(input.requestBindingDigest).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = parseForgeShadowM3StrictExplicitTimezoneInstant(nowUtc);
  const receipt = input.observationReceipt;

  if (repository !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY) {
    blockers.push('repository-mismatch');
  }
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA40.test(canonicalMainTree)) blockers.push('canonical-main-tree-invalid');
  if (!SAFE_ID.test(requestId)) blockers.push('request-id-invalid');
  if (!Number.isFinite(requestedAtMs)) blockers.push('requested-at-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');

  if (!exactKeys(receipt, RECEIPT_KEYS)) blockers.push('observation-receipt-fields-invalid');
  const observationId = text(receipt?.observationId);
  const receiptRequestId = text(receipt?.requestId);
  const receiptRequestedAtUtc = text(receipt?.requestedAtUtc);
  const receiptRequestBindingDigest = text(receipt?.requestBindingDigest).toLowerCase();
  const observerClass = text(receipt?.observerClass);
  const sourceIdentity = text(receipt?.sourceIdentity);
  const releaseChannel = text(receipt?.releaseChannel).toLowerCase();
  const version = text(receipt?.version);
  const observedAtUtc = text(receipt?.observedAtUtc);
  const observedMs = parseForgeShadowM3StrictExplicitTimezoneInstant(observedAtUtc);
  const sourceBindingDigest = text(receipt?.sourceBindingDigest).toLowerCase();
  const releaseManifestDigest = text(receipt?.releaseManifestDigest).toLowerCase();
  const checksumManifestDigest = text(receipt?.checksumManifestDigest).toLowerCase();
  const provenanceDigest = text(receipt?.provenanceDigest).toLowerCase();
  const releaseProofRefs = safeProofRefs(receipt?.proofRefs);

  if (receipt?.schemaVersion !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_RECEIPT_SCHEMA) {
    blockers.push('observation-receipt-schema-mismatch');
  }
  if (!SAFE_ID.test(observationId)) blockers.push('observation-id-invalid');
  const expectedRequestBindingDigest = buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest({
    repository,
    canonicalMainHead,
    canonicalMainTree,
    requestedAtUtc,
    requestId,
    observationId,
  });
  if (!DIGEST.test(requestBindingDigest) || requestBindingDigest !== expectedRequestBindingDigest) {
    blockers.push('request-binding-digest-mismatch');
  }
  if (receiptRequestId !== requestId) blockers.push('receipt-request-id-mismatch');
  if (receiptRequestedAtUtc !== requestedAtUtc) blockers.push('receipt-request-time-mismatch');
  if (!DIGEST.test(receiptRequestBindingDigest)
      || receiptRequestBindingDigest !== requestBindingDigest) {
    blockers.push('receipt-request-binding-digest-mismatch');
  }
  if (observerClass !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS) {
    blockers.push('observer-class-mismatch');
  }
  if (sourceIdentity !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE) {
    blockers.push('source-identity-mismatch');
  }
  if (releaseChannel !== 'stable' || !SEMVER.test(version)) {
    blockers.push('release-version-invalid');
  }
  if (!Number.isFinite(observedMs)) blockers.push('observation-time-invalid');
  else if (observedMs > nowMs || nowMs - observedMs > MAX_OBSERVATION_AGE_MS) {
    blockers.push('observation-time-out-of-bounds');
  }

  const expectedBindingDigest = buildForgeShadowM3OfficialReleaseSourceBindingDigest({
    repository,
    canonicalMainHead,
    canonicalMainTree,
    requestId,
    requestedAtUtc,
    requestBindingDigest,
    observationId,
  });
  if (!DIGEST.test(sourceBindingDigest) || sourceBindingDigest !== expectedBindingDigest) {
    blockers.push('source-binding-digest-mismatch');
  }
  if (!DIGEST.test(releaseManifestDigest)) blockers.push('release-manifest-digest-invalid');
  if (!DIGEST.test(checksumManifestDigest)) blockers.push('checksum-manifest-digest-invalid');
  if (!DIGEST.test(provenanceDigest)) blockers.push('provenance-digest-invalid');
  if (!releaseProofRefs) blockers.push('release-proof-refs-invalid');
  if (receipt?.tlsVerified !== true) blockers.push('tls-proof-required');
  if (receipt?.releaseManifestVerified !== true) blockers.push('release-manifest-proof-required');
  if (receipt?.checksumManifestVerified !== true) blockers.push('checksum-manifest-proof-required');
  if (receipt?.provenanceVerified !== true) blockers.push('provenance-proof-required');
  if (receipt?.mutableReferenceAccepted !== false) blockers.push('mutable-reference-forbidden');
  if (receipt?.credentialUsed !== false) blockers.push('credential-use-forbidden');
  if (receipt?.callerEndpointAccepted !== false) blockers.push('caller-endpoint-forbidden');
  if (receipt?.artifactDownloadPerformed !== false) blockers.push('artifact-download-forbidden');
  if (receipt?.filesystemWritePerformed !== false) blockers.push('filesystem-write-forbidden');

  const rawAssets = Array.isArray(receipt?.assets) ? receipt.assets : null;
  if (!rawAssets || rawAssets.length !== 2) blockers.push('asset-estate-must-be-exactly-two');
  const normalizedAssets = (rawAssets || [])
    .map((asset) => normalizeAsset(asset, blockers))
    .sort((left, right) => left.runnerClass.localeCompare(right.runnerClass));

  const runnerClasses = normalizedAssets.map((asset) => asset.runnerClass);
  if (new Set(runnerClasses).size !== runnerClasses.length) {
    blockers.push('asset-runner-class-duplicate');
  }
  for (const runnerClass of ['linux-isolated', 'windows-proof-isolated']) {
    if (!runnerClasses.includes(runnerClass)) blockers.push(`asset-runner-class-required:${runnerClass}`);
  }
  const assetIds = normalizedAssets.map((asset) => asset.assetId);
  if (new Set(assetIds).size !== assetIds.length) blockers.push('asset-id-duplicate');
  const artifactDigests = normalizedAssets.map((asset) => asset.artifactDigest);
  if (new Set(artifactDigests).size !== artifactDigests.length) blockers.push('artifact-digest-duplicate');

  const normalizedObservedAtUtc = Number.isFinite(observedMs)
    ? new Date(observedMs).toISOString()
    : '';
  const releaseObservation = Object.freeze({
    sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
    releaseChannel: 'stable',
    version,
    observedAtUtc: normalizedObservedAtUtc,
    releaseManifestDigest,
    checksumManifestDigest,
    provenanceDigest,
    proofRefs: releaseProofRefs || Object.freeze([]),
    tlsVerified: true,
    releaseManifestVerified: true,
    checksumManifestVerified: true,
    mutableReferenceAccepted: false,
    credentialUsed: false,
    assets: Object.freeze(normalizedAssets.map((asset) => Object.freeze({
      assetId: asset.assetId,
      platform: asset.platform,
      artifactLogicalId: asset.artifactLogicalId,
      artifactDigest: asset.artifactDigest,
      checksumDigest: asset.checksumDigest,
      manifestEntryDigest: asset.manifestEntryDigest,
      artifactBytes: asset.artifactBytes,
      contentType: asset.contentType,
      executableFormat: asset.executableFormat,
      proofRefs: asset.proofRefs,
    }))),
  });

  let artifactResolution = null;
  if (blockers.length === 0) {
    try {
      artifactResolution = resolveForgeShadowM3RunnerArtifacts({
        repository,
        canonicalMainHead,
        canonicalMainTree,
        nowUtc,
        releaseObservation,
      });
    } catch {
      blockers.push('artifact-resolver-threw');
    }
  }

  if (artifactResolution) {
    if (artifactResolution.valid !== true
        || artifactResolution.finalVerdict !== FORGE_SHADOW_M3_ARTIFACT_RESOLUTION_READY) {
      blockers.push('artifact-resolver-rejected-observation');
    }
    if (artifactResolution.repository !== repository) blockers.push('artifact-resolver-repository-mismatch');
    if (text(artifactResolution.canonicalMainHead).toLowerCase() !== canonicalMainHead) {
      blockers.push('artifact-resolver-head-mismatch');
    }
    if (text(artifactResolution.canonicalMainTree).toLowerCase() !== canonicalMainTree) {
      blockers.push('artifact-resolver-tree-mismatch');
    }
  }

  const valid = blockers.length === 0;
  const observationEvidenceDigest = valid
    ? `sha256:${sha256({
      repository,
      canonicalMainHead,
      canonicalMainTree,
      requestId,
      requestedAtUtc,
      requestBindingDigest,
      observationId,
      observerClass,
      sourceBindingDigest,
      releaseObservation,
    })}`
    : '';

  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_SCHEMA,
    valid,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    requestId,
    requestedAtUtc,
    requestBindingDigest: valid ? requestBindingDigest : '',
    observationId,
    observerClass,
    sourceIdentity,
    releaseChannel,
    version,
    observedAtUtc: normalizedObservedAtUtc,
    decision: valid
      ? FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY
      : FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED,
    blockers: Object.freeze(unique(blockers)),
    sourceBindingDigest: valid ? sourceBindingDigest : '',
    observationEvidenceDigest,
    releaseObservation: valid ? releaseObservation : null,
    artifactResolutionPreview: valid ? Object.freeze({
      schemaVersion: artifactResolution.schemaVersion,
      finalVerdict: artifactResolution.finalVerdict,
      artifactSetDigest: artifactResolution.artifactSetDigest,
      artifactResolutions: artifactResolution.artifactResolutions,
    }) : null,
    observationContract: Object.freeze({
      observerClass: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
      sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
      releaseChannel: 'stable',
      fixedPlatforms: Object.freeze(['linux/amd64', 'windows/amd64']),
      metadataOnly: true,
      callerEndpointAccepted: false,
      callerLocationAccepted: false,
      binaryContentAccepted: false,
      artifactDownloadPerformed: false,
      filesystemWritePerformed: false,
      requestBindingRequired: true,
      separateObservationExecutionAuthorizationRequired: true,
    }),
    authority: authorityProjection(),
    finalVerdict: valid
      ? FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY
      : FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED,
  });
}
