import { createHash } from 'node:crypto';
import {
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_CHANNEL,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_REQUEST_SCHEMA,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_RECEIPT_SCHEMA,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY,
  FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
  parseForgeShadowM3StrictExplicitTimezoneInstant,
  planForgeShadowM3OfficialReleaseObservationExecutionContract,
} from './forgeShadowM3OfficialReleaseObservationExecutionContractV1.mjs';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const MAX_PREPARATION_DELAY_MS = 15 * 60 * 1000;

export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_SCHEMA =
  'stephanos.forge-shadow-m3-official-release-metadata-observer-adapter-plan.v1';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_READY =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_READY';
export const FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_BLOCKED =
  'FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_BLOCKED';

const INPUT_KEYS = Object.freeze(['adapterId', 'preparedAtUtc', 'executionRequest']);

const STEPS = Object.freeze([
  Object.freeze({
    stepId: 'validate-exact-execution-request',
    operationClass: 'local-contract-validation',
    networkAccess: false,
    artifactPayloadAccess: false,
  }),
  Object.freeze({
    stepId: 'observe-fixed-official-stable-release-metadata',
    operationClass: 'future-readonly-fixed-route-observation',
    networkAccess: false,
    artifactPayloadAccess: false,
  }),
  Object.freeze({
    stepId: 'verify-release-checksum-and-provenance-manifest-metadata',
    operationClass: 'future-metadata-verification',
    networkAccess: false,
    artifactPayloadAccess: false,
  }),
  Object.freeze({
    stepId: 'project-bound-observation-receipt',
    operationClass: 'local-receipt-projection',
    networkAccess: false,
    artifactPayloadAccess: false,
  }),
]);

const text = (value) => String(value ?? '').trim();
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const sha256 = (value) => 'sha256:' + createHash('sha256').update(stable(value), 'utf8').digest('hex');

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

function expectedExecutionRequest(request) {
  return planForgeShadowM3OfficialReleaseObservationExecutionContract({
    repository: request?.repository,
    canonicalMainHead: request?.canonicalMainHead,
    canonicalMainTree: request?.canonicalMainTree,
    requestedAtUtc: request?.requestedAtUtc,
    requestId: request?.requestId,
    observationId: request?.observationId,
  });
}

export function planForgeShadowM3OfficialReleaseMetadataObserverAdapter(input = {}) {
  const blockers = [];
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-shape-invalid');

  const adapterId = text(input?.adapterId);
  const preparedAtUtc = text(input?.preparedAtUtc);
  const preparedAtMs = parseForgeShadowM3StrictExplicitTimezoneInstant(preparedAtUtc);
  const request = input?.executionRequest;
  const plannedRequest = expectedExecutionRequest(request);
  const requestedAtMs = parseForgeShadowM3StrictExplicitTimezoneInstant(request?.requestedAtUtc);

  if (!SAFE_ID.test(adapterId)) blockers.push('adapter-id-invalid');
  if (!Number.isFinite(preparedAtMs)) blockers.push('prepared-at-invalid');
  if (!plannedRequest.valid || !plannedRequest.executionRequest) {
    blockers.push('execution-request-invalid');
  } else if (stable(request) !== stable(plannedRequest.executionRequest)) {
    blockers.push('execution-request-contract-mismatch');
  }
  if (request?.schemaVersion !== FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_REQUEST_SCHEMA) {
    blockers.push('execution-request-schema-mismatch');
  }
  if (Number.isFinite(preparedAtMs) && Number.isFinite(requestedAtMs)
      && (preparedAtMs < requestedAtMs || preparedAtMs - requestedAtMs > MAX_PREPARATION_DELAY_MS)) {
    blockers.push('adapter-preparation-time-out-of-bounds');
  }

  const normalizedBlockers = uniqueSorted(blockers);
  const valid = normalizedBlockers.length === 0;
  const requestIdentity = valid
    ? Object.freeze({
      repository: request.repository,
      canonicalMainHead: request.canonicalMainHead,
      canonicalMainTree: request.canonicalMainTree,
      requestId: request.requestId,
      observationId: request.observationId,
      requestedAtUtc: request.requestedAtUtc,
      requestBindingDigest: request.requestBindingDigest,
    })
    : null;
  const adapterPlan = valid
    ? Object.freeze({
      adapterId,
      preparedAtUtc,
      requestIdentity,
      observerClass: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVER_CLASS,
      discoveryRoute: FORGE_SHADOW_M3_OFFICIAL_RELEASE_DISCOVERY_ROUTE,
      sourceIdentity: FORGE_SHADOW_M3_OFFICIAL_RELEASE_SOURCE,
      releaseChannel: FORGE_SHADOW_M3_OFFICIAL_RELEASE_CHANNEL,
      sourceSelection: 'source-controlled-fixed-route-only',
      stableSelectionPolicy: 'highest-stable-semver-only',
      metadataScope: 'official-runner-release-and-verification-manifests-only',
      expectedReceiptSchema: FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_RECEIPT_SCHEMA,
      steps: STEPS,
      constraints: Object.freeze({
        callerEndpointAccepted: false,
        callerLocationAccepted: false,
        callerVersionAccepted: false,
        mutableReferenceAccepted: false,
        credentialUseAccepted: false,
        redirectsAccepted: false,
        artifactPayloadAccepted: false,
        binaryContentAccepted: false,
        filesystemMutationAccepted: false,
        observationPerformedByThisPlan: false,
        separateObservationExecutionAuthorizationRequired: true,
      }),
    })
    : null;
  const planDigest = valid ? sha256(adapterPlan) : '';

  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_SCHEMA,
    valid,
    adapterId,
    preparedAtUtc,
    repository: valid ? FORGE_SHADOW_M3_OFFICIAL_RELEASE_REPOSITORY : text(request?.repository),
    blockers: Object.freeze(normalizedBlockers),
    adapterPlan,
    planDigest,
    authority: authorityProjection(),
    finalVerdict: valid
      ? FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_READY
      : FORGE_SHADOW_M3_OFFICIAL_RELEASE_METADATA_OBSERVER_ADAPTER_PLAN_BLOCKED,
  });
}
