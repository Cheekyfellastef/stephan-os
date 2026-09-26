import { createHash } from 'node:crypto';

const SHA40 = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const STRICT_EXPLICIT_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/i;

export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-observation-execution-contract.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_REQUEST_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-observation-execution-request.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_RECEIPT_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-observation-receipt.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE = 'forgejo-official-runner-release';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_CHANNEL = 'stable';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS =
  'source-controlled-readonly-official-release-observer';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE =
  'forgejo-official-runner-stable-release-metadata-v1';

const INPUT_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'canonicalMainTree',
  'requestedAtUtc',
  'requestId',
  'observationId',
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'endpoint', 'host', 'hostname', 'environment',
  'env', 'token', 'credential', 'credentials', 'cookie', 'session', 'privatekey',
  'publickey', 'password', 'secret', 'secrets', 'selector', 'javascript',
  'dockerhost', 'dockersocket', 'podmansocket', 'registrationtoken',
  'registrationkey', 'binary', 'base64', 'blob', 'archive', 'file', 'filename',
  'filepath', 'download', 'downloadurl', 'sourceurl', 'sourcepath',
  'sourceendpoint', 'artifactlocation', 'selectedversion', 'releaseversion',
  'mutablereference', 'mutabletag', 'body', 'content', 'data', 'payload',
]);

const FIXED_ARTIFACT_OBSERVATIONS = Object.freeze([
  Object.freeze({
    runnerClass: 'linux-isolated',
    platform: 'linux/amd64',
    artifactId: 'forge-m3-linux-runner-artifact-v1',
    logicalIdentity: 'forgejo-runner-linux-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'elf',
    metadataOnly: true,
    artifactPayloadRequested: false,
    immutableArtifactDigestRequired: true,
    checksumDigestMatchRequired: true,
    immutableManifestEntryDigestRequired: true,
    minimumArtifactBytes: 1024 * 1024,
    maximumArtifactBytes: 512 * 1024 * 1024,
    boundedSafeProofReferencesRequired: true,
  }),
  Object.freeze({
    runnerClass: 'windows-proof-isolated',
    platform: 'windows/amd64',
    artifactId: 'forge-m3-windows-proof-runner-artifact-v1',
    logicalIdentity: 'forgejo-runner-windows-amd64',
    contentType: 'application/octet-stream',
    executableFormat: 'pe',
    metadataOnly: true,
    artifactPayloadRequested: false,
    immutableArtifactDigestRequired: true,
    checksumDigestMatchRequired: true,
    immutableManifestEntryDigestRequired: true,
    minimumArtifactBytes: 1024 * 1024,
    maximumArtifactBytes: 512 * 1024 * 1024,
    boundedSafeProofReferencesRequired: true,
  }),
]);

const text = (value) => String(value ?? '').trim();
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

function normalizedFieldName(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

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
    if (FORBIDDEN_FIELD_NAMES.has(normalizedFieldName(key))) return next.join('.');
    const found = findForbiddenField(nested, next);
    if (found) return found;
  }
  return '';
}

export function parseForgeShadowM3StrictExplicitTimezoneInstant(value) {
  const normalized = text(value);
  const match = normalized.match(STRICT_EXPLICIT_TIMEZONE);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] || '').slice(1).padEnd(3, '0'));
  const offsetHour = Number(match[10] || 0);
  const offsetMinute = Number(match[11] || 0);
  if (year < 1000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
      || offsetHour > 23 || offsetMinute > 59) return Number.NaN;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return Number.NaN;
  const offsetSign = match[9] === '-' ? -1 : 1;
  const offsetMs = match[8].toUpperCase() === 'Z'
    ? 0
    : offsetSign * ((offsetHour * 60) + offsetMinute) * 60 * 1000;
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMs;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

function discoveryContract() {
  return Object.freeze({
    routeIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE,
    sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
    releaseChannel: FORGE_SHADOW_M3_OFFICIAL_RELEASE_CHANNEL,
    metadataScope: 'official-runner-release-and-verification-manifests-only',
    selectionPolicy: 'highest-stable-semver-only',
    callerSourceSelectionAccepted: false,
    callerMutableReferenceAccepted: false,
    liveReleaseSelected: false,
    observationPerformed: false,
  });
}

function receiptContract() {
  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_RECEIPT_SCHEMA,
    explicitTimezoneRequired: true,
    maximumObservationAgeSeconds: 24 * 60 * 60,
    stableSemanticVersionRequired: true,
    tlsVerificationRequired: true,
    releaseManifestVerificationRequired: true,
    checksumManifestVerificationRequired: true,
    provenanceVerificationRequired: true,
    immutableReleaseManifestDigestRequired: true,
    immutableChecksumManifestDigestRequired: true,
    immutableProvenanceDigestRequired: true,
    mutableReferenceAccepted: false,
    credentialUseAccepted: false,
    callerSourceSelectionAccepted: false,
    artifactPayloadAccepted: false,
    filesystemMutationAccepted: false,
    boundedSafeProofReferencesRequired: true,
    requestIdEchoRequired: true,
    requestedAtUtcEchoRequired: true,
    requestBindingDigestRequired: true,
    requestBindingDigestMustEqualExecutionRequest: true,
  });
}

export function buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest({
  repository,
  canonicalMainHead,
  canonicalMainTree,
  requestedAtUtc,
  requestId,
  observationId,
} = {}) {
  return `sha256:${sha256({
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_REQUEST_SCHEMA,
    repository: text(repository),
    canonicalMainHead: text(canonicalMainHead).toLowerCase(),
    canonicalMainTree: text(canonicalMainTree).toLowerCase(),
    requestedAtUtc: text(requestedAtUtc),
    requestId: text(requestId),
    observationId: text(observationId),
    observerClass: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
    discoveryRoute: FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE,
    sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
    releaseChannel: FORGE_SHADOW_M3_OFFICIAL_RELEASE_CHANNEL,
  })}`;
}

export function planForgeShadowM3OfficialReleaseObservationExecutionContract(input = {}) {
  const blockers = [];
  const unsafeField = findForbiddenField(input);
  if (unsafeField) blockers.push(`unsafe-field:${unsafeField}`);
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-shape-invalid');

  const repository = text(input?.repository);
  const canonicalMainHead = text(input?.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(input?.canonicalMainTree).toLowerCase();
  const requestedAtUtc = text(input?.requestedAtUtc);
  const requestId = text(input?.requestId);
  const observationId = text(input?.observationId);

  if (repository !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY) {
    blockers.push('repository-mismatch');
  }
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA40.test(canonicalMainTree)) blockers.push('canonical-main-tree-invalid');
  if (!SAFE_ID.test(requestId)) blockers.push('request-id-invalid');
  if (!SAFE_ID.test(observationId)) blockers.push('observation-id-invalid');
  if (requestId && requestId === observationId) blockers.push('request-and-observation-id-must-differ');
  if (!Number.isFinite(parseForgeShadowM3StrictExplicitTimezoneInstant(requestedAtUtc))) {
    blockers.push('requested-at-strict-explicit-timezone-required');
  }

  const normalizedBlockers = uniqueSorted(blockers);
  const valid = normalizedBlockers.length === 0;
  const requestBindingDigest = valid
    ? buildForgeShadowM3OfficialReleaseObservationExecutionBindingDigest({
      repository,
      canonicalMainHead,
      canonicalMainTree,
      requestedAtUtc,
      requestId,
      observationId,
    })
    : '';

  const executionRequest = valid
    ? Object.freeze({
      schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_REQUEST_SCHEMA,
      requestId,
      observationId,
      repository,
      canonicalMainHead,
      canonicalMainTree,
      requestedAtUtc,
      observerClass: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
      executionMode: 'metadata-observation-request-only',
      discoveryContract: discoveryContract(),
      requiredArtifactObservations: FIXED_ARTIFACT_OBSERVATIONS,
      receiptContract: receiptContract(),
      requestBindingDigest,
    })
    : null;

  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_SCHEMA,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    valid,
    blockers: Object.freeze(normalizedBlockers),
    executionRequest,
    requestBindingDigest,
    authority: authorityProjection(),
    finalVerdict: valid
      ? FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY
      : FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED,
  });
}
