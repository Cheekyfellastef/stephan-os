import { createHash } from 'node:crypto';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA =
  'stephanos.operator-protected-merge-configuration-activation-evidence.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA =
  'stephanos.operator-protected-merge-configuration-activation.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_RECEIPT_SCHEMA =
  'stephanos.operator-protected-merge-configuration-provider-receipt.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_REQUIRED =
  'PROVIDER_PROOF_REQUIRED';

const MAX_CANONICAL_DEPTH = 32;
const MAX_CANONICAL_NODES = 4096;
const MAX_CANONICAL_BYTES = 262_144;
const MAX_CANONICAL_ARRAY_LENGTH = 2048;
const MAX_CANONICAL_OBJECT_KEYS = 512;
const CANONICAL_FAILURE_CODES = new WeakMap();

function throwCanonicalFailure(code) {
  const failure = Object.create(null);
  CANONICAL_FAILURE_CODES.set(failure, code);
  throw failure;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function safeCanonicalJson(value) {
  const state = {
    ancestors: new WeakSet(),
    bytes: 0,
    nodes: 0,
    parts: [],
  };

  const emit = (part) => {
    state.bytes += Buffer.byteLength(part, 'utf8');
    if (state.bytes > MAX_CANONICAL_BYTES) throwCanonicalFailure('canonical-json-too-large');
    state.parts.push(part);
  };

  const visit = (candidate, depth) => {
    if (depth > MAX_CANONICAL_DEPTH) throwCanonicalFailure('canonical-json-depth-exceeded');
    state.nodes += 1;
    if (state.nodes > MAX_CANONICAL_NODES) {
      throwCanonicalFailure('canonical-json-node-limit-exceeded');
    }

    if (candidate === null) {
      emit('null');
      return;
    }

    const type = typeof candidate;
    if (type === 'string') {
      emit(JSON.stringify(candidate));
      return;
    }
    if (type === 'boolean') {
      emit(candidate ? 'true' : 'false');
      return;
    }
    if (type === 'number') {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0)) {
        throwCanonicalFailure('canonical-json-number-invalid');
      }
      emit(JSON.stringify(candidate));
      return;
    }
    if (type !== 'object') throwCanonicalFailure('canonical-json-type-unsupported');
    if (state.ancestors.has(candidate)) throwCanonicalFailure('canonical-json-cycle');

    const prototype = Object.getPrototypeOf(candidate);
    const keys = Reflect.ownKeys(candidate);
    if (keys.some((key) => typeof key === 'symbol')) {
      throwCanonicalFailure('canonical-json-symbol-key-unsupported');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    state.ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        if (prototype !== Array.prototype) {
          throwCanonicalFailure('canonical-json-prototype-unsupported');
        }
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CANONICAL_ARRAY_LENGTH) {
          throwCanonicalFailure('canonical-json-array-length-invalid');
        }
        const expectedKeys = Array.from({ length }, (_, index) => String(index));
        const actualKeys = keys.filter((key) => key !== 'length');
        if (
          actualKeys.length !== expectedKeys.length
          || actualKeys.some((key, index) => key !== expectedKeys[index])
        ) {
          throwCanonicalFailure('canonical-json-array-not-dense');
        }
        emit('[');
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
            throwCanonicalFailure('canonical-json-property-invalid');
          }
          if (index > 0) emit(',');
          visit(descriptor.value, depth + 1);
        }
        emit(']');
        return;
      }

      if (prototype !== Object.prototype) {
        throwCanonicalFailure('canonical-json-prototype-unsupported');
      }
      if (keys.length > MAX_CANONICAL_OBJECT_KEYS) {
        throwCanonicalFailure('canonical-json-object-key-limit-exceeded');
      }
      const sortedKeys = [...keys].sort();
      emit('{');
      for (let index = 0; index < sortedKeys.length; index += 1) {
        const key = sortedKeys[index];
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
          throwCanonicalFailure('canonical-json-property-invalid');
        }
        if (index > 0) emit(',');
        emit(JSON.stringify(key));
        emit(':');
        visit(descriptor.value, depth + 1);
      }
      emit('}');
    } finally {
      state.ancestors.delete(candidate);
    }
  };

  try {
    visit(value, 0);
    return Object.freeze({ ok: true, json: state.parts.join(''), blocker: null });
  } catch (caught) {
    const caughtType = typeof caught;
    const blocker = caught !== null && (caughtType === 'object' || caughtType === 'function')
      ? CANONICAL_FAILURE_CODES.get(caught) ?? 'canonical-json-inspection-failed'
      : 'canonical-json-inspection-failed';
    return Object.freeze({
      ok: false,
      json: null,
      blocker,
    });
  }
}

function exactClosedWorldValue(actual, expected) {
  const actualJson = safeCanonicalJson(actual);
  if (!actualJson.ok) return false;
  const expectedJson = safeCanonicalJson(expected);
  return expectedJson.ok && actualJson.json === expectedJson.json;
}

function isPlainRecord(value) {
  try {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function canonicalSha256(value) {
  const serialized = safeCanonicalJson(value);
  if (!serialized.ok) return Object.freeze({ ok: false, sha256: null, blocker: serialized.blocker });
  return Object.freeze({
    ok: true,
    sha256: createHash('sha256').update(serialized.json, 'utf8').digest('hex'),
    blocker: null,
  });
}

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION = deepFreeze({
  schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA,
  repository: {
    owner: 'Cheekyfellastef',
    name: 'stephan-os',
    fullName: 'Cheekyfellastef/stephan-os',
    selectionMode: 'selected',
    selectedRepositories: ['Cheekyfellastef/stephan-os'],
  },
  app: {
    name: 'Stephanos Ruleset Proof Reader',
    slug: 'stephanos-ruleset-proof-reader',
    appId: 4547243,
    installationId: 152662199,
    permissions: {
      administration: 'write',
      metadata: 'read',
    },
    events: [],
    permissionUpdatePending: false,
  },
  admissionBase: {
    headSha: 'ba10365b0c873398ebccc397f64358c7a01fb8cf',
    treeSha: 'f14ed0410a57ba07ca96b1c2ff1a11fcc5b7513d',
  },
  ruleset: {
    id: 20640195,
    enforcement: 'active',
    bypassActors: [],
    requiredStatusChecks: [{
      context: 'protected-merge-source-proof',
      integrationId: 15368,
    }],
  },
  failedDispatch: {
    workflowRunId: 31583116255,
    runAttempt: 1,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    baseHeadSha: 'ba10365b0c873398ebccc397f64358c7a01fb8cf',
  },
  transportBoundary: {
    installationPermission: 'administration:write',
    allowedMethod: 'GET',
    requestBody: null,
    redirectMode: 'error',
    allowedRepository: 'Cheekyfellastef/stephan-os',
    allowedPathTemplates: [
      '/repos/{owner}/{repository}',
      '/repos/{owner}/{repository}/rules/branches/main?per_page=100&page={1..20}',
      '/repos/{owner}/{repository}/rulesets/{positive-integer}?includes_parents=true',
    ],
    environmentJobLocal: true,
    credentialPersistence: false,
    credentialLogging: false,
    credentialArtifacting: false,
    credentialCrossJobForwarding: false,
  },
});

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256 =
  canonicalSha256(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION).sha256;

// This pre-existing independent artifact is exact source-review evidence only. Its immutable
// identity is useful to reject forged provider metadata, but it does not attest the live App or
// ruleset observation and therefore cannot activate this contract.
const KNOWN_SOURCE_REVIEW_RECEIPT = deepFreeze({
  schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_RECEIPT_SCHEMA,
  provider: 'github-actions-immutable-artifact',
  repository: 'Cheekyfellastef/stephan-os',
  observer: 'Independent Merge Security Review',
  workflowRunId: 31592716405,
  workflowRunAttempt: 1,
  artifactId: 9139766493,
  artifactName: 'stephanos-independent-review-31592716405-attempt-1',
  artifactDigest: 'sha256:03984ddf408ca7a1a5eb559f748c16be43b905d59cda54193f6e6fc8d2d6e147',
  payloadSha256: '619c10ccf7aa18852737dfcc3a69c2c3f996cc1dbafcec02e07c4b1a2991c599',
  sourceHead: 'b1d7e9819dc975dc750fb0d7a41ccffb565ee95e',
  baseSha: 'ba10365b0c873398ebccc397f64358c7a01fb8cf',
  observationSha256: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
  attestationClass: 'source-review-only',
});

function result(blockers, finalVerdict = 'BLOCKED') {
  return Object.freeze({
    valid: false,
    finalVerdict,
    blockers: Object.freeze([...blockers]),
    evidenceSha256: null,
  });
}

export function validateOperatorProtectedMergeConfigurationActivation(evidence) {
  const canonicalEvidence = safeCanonicalJson(evidence);
  if (!canonicalEvidence.ok) {
    return result([
      'activation-evidence-noncanonical',
      canonicalEvidence.blocker,
    ]);
  }
  let normalizedEvidence;
  try {
    normalizedEvidence = JSON.parse(canonicalEvidence.json);
  } catch {
    return result(['activation-evidence-canonicalization-failed']);
  }
  if (!isPlainRecord(normalizedEvidence)) return result(['activation-evidence-malformed']);
  evidence = normalizedEvidence;

  const blockers = [];
  const block = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };

  if (!exactClosedWorldValue(Object.keys(evidence).sort(), ['observation', 'providerReceipt', 'schema'])) {
    block('activation-evidence-keys-invalid');
  }
  if (evidence.schema !== OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA) {
    block('activation-schema-mismatch');
  }

  const observation = isPlainRecord(evidence.observation) ? evidence.observation : {};
  if (!isPlainRecord(evidence.observation)) block('activation-observation-malformed');
  if (observation.schema !== OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA) {
    block('activation-observation-schema-mismatch');
  }
  if (!exactClosedWorldValue(observation.repository, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.repository)) {
    block('activation-repository-mismatch');
  }
  if (!exactClosedWorldValue(observation.app, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.app)) {
    block('activation-app-mismatch');
  }
  if (!exactClosedWorldValue(observation.admissionBase, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.admissionBase)) {
    block('activation-main-identity-mismatch');
  }
  if (!exactClosedWorldValue(observation.ruleset, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.ruleset)) {
    block('activation-ruleset-mismatch');
  }
  if (!exactClosedWorldValue(observation.failedDispatch, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.failedDispatch)) {
    block('activation-failed-dispatch-mismatch');
  }
  if (!exactClosedWorldValue(observation.transportBoundary, OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.transportBoundary)) {
    block('activation-transport-boundary-mismatch');
  }
  if (!exactClosedWorldValue(Object.keys(observation).sort(), Object.keys(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION).sort())) {
    block('activation-observation-keys-invalid');
  }

  const observationDigest = canonicalSha256(observation);
  if (!observationDigest.ok) block('activation-observation-noncanonical');

  const providerReceipt = evidence.providerReceipt;
  if (providerReceipt === null || providerReceipt === undefined) {
    block('activation-provider-proof-required');
  } else if (!isPlainRecord(providerReceipt)) {
    block('activation-provider-proof-malformed');
    block('activation-provider-proof-required');
  } else {
    if (!exactClosedWorldValue(Object.keys(providerReceipt).sort(), Object.keys(KNOWN_SOURCE_REVIEW_RECEIPT).sort())) {
      block('activation-provider-proof-keys-invalid');
    }
    if (providerReceipt.schema !== OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_RECEIPT_SCHEMA) {
      block('activation-provider-proof-schema-mismatch');
    }
    if (
      providerReceipt.provider !== KNOWN_SOURCE_REVIEW_RECEIPT.provider
      || providerReceipt.repository !== KNOWN_SOURCE_REVIEW_RECEIPT.repository
      || providerReceipt.observer !== KNOWN_SOURCE_REVIEW_RECEIPT.observer
    ) {
      block('activation-provider-proof-identity-mismatch');
    }
    if (
      providerReceipt.workflowRunId !== KNOWN_SOURCE_REVIEW_RECEIPT.workflowRunId
      || providerReceipt.workflowRunAttempt !== KNOWN_SOURCE_REVIEW_RECEIPT.workflowRunAttempt
    ) {
      block('activation-provider-proof-run-mismatch');
    }
    if (
      providerReceipt.artifactId !== KNOWN_SOURCE_REVIEW_RECEIPT.artifactId
      || providerReceipt.artifactName !== KNOWN_SOURCE_REVIEW_RECEIPT.artifactName
      || providerReceipt.artifactDigest !== KNOWN_SOURCE_REVIEW_RECEIPT.artifactDigest
      || providerReceipt.payloadSha256 !== KNOWN_SOURCE_REVIEW_RECEIPT.payloadSha256
    ) {
      block('activation-provider-proof-artifact-mismatch');
    }
    if (
      providerReceipt.sourceHead !== KNOWN_SOURCE_REVIEW_RECEIPT.sourceHead
      || providerReceipt.baseSha !== KNOWN_SOURCE_REVIEW_RECEIPT.baseSha
    ) {
      block('activation-provider-proof-source-identity-mismatch');
    }
    if (
      providerReceipt.observationSha256 !== KNOWN_SOURCE_REVIEW_RECEIPT.observationSha256
      || providerReceipt.observationSha256 !== observationDigest.sha256
    ) {
      block('activation-provider-proof-observation-mismatch');
    }
    if (providerReceipt.attestationClass !== 'source-review-only') {
      block('activation-provider-proof-attestation-mismatch');
    }

    // The only pre-existing immutable receipt reviewed here attests source, not live configuration.
    // Treating it as a configuration observation would recreate the self-issued trust bug.
    block('activation-provider-proof-not-live-observation');
    block('activation-provider-proof-required');
  }

  return result(
    blockers,
    blockers.includes('activation-provider-proof-required')
      ? OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_REQUIRED
      : 'BLOCKED',
  );
}
