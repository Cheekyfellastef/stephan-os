import { createHash, createPublicKey, verify } from 'node:crypto';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA =
  'stephanos.operator-protected-merge-configuration-activation-evidence.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA =
  'stephanos.operator-protected-merge-configuration-activation.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVENANCE_SCHEMA =
  'stephanos.operator-protected-merge-configuration-live-observation-provenance.v1';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_PUBLIC_KEY_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEASWlaPvT+AOVVcz5c18iF9NdOzx1ZerJpxekKjG7Jhm8=',
  '-----END PUBLIC KEY-----',
  '',
].join('\n');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isDenseArray(value) {
  return Array.isArray(value)
    && Array.from({ length: value.length }, (_, index) => index)
      .every((index) => Object.hasOwn(value, index));
}

function exactClosedWorldValue(actual, expected) {
  if (Array.isArray(expected)) {
    return isDenseArray(actual)
      && actual.length === expected.length
      && expected.every((child, index) => exactClosedWorldValue(actual[index], child));
  }
  if (isPlainRecord(expected)) {
    if (!isPlainRecord(actual)) return false;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    return exactClosedWorldValue(actualKeys, expectedKeys)
      && expectedKeys.every((key) => exactClosedWorldValue(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function insertionOrderedSha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== value) return null;
  return bytes;
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
  insertionOrderedSha256(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION);

const EXPECTED_PROVENANCE_CORE = deepFreeze({
  schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVENANCE_SCHEMA,
  receiptId: 'github-live-configuration-observation-pr1766-20260812T113058556Z',
  observer: {
    id: 'codex-desktop-battle-bridge',
    class: 'qualified-operator-authenticated-github-live-observer',
    independence: 'external-to-source-contract',
    authority: 'read-only',
  },
  observedAtUtc: '2026-08-12T11:30:58.556Z',
  capture: {
    repository: 'Cheekyfellastef/stephan-os',
    authenticated: true,
    tlsVerified: true,
    surfaces: [
      'github-rest-ruleset-20640195',
      'github-admin-installation-152662199',
      'github-admin-app-stephanos-ruleset-proof-reader',
      'github-admin-app-permissions-stephanos-ruleset-proof-reader',
    ],
  },
  observationSha256: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
  reviewArtifact: {
    workflow: 'Independent Merge Security Review',
    workflowRunId: 31591316347,
    workflowRunAttempt: 1,
    artifactId: 9139216442,
    artifactName: 'stephanos-independent-review-31591316347-attempt-1',
    artifactDigest: 'sha256:aec8620dc9e21a3cbf823bd641cede05a6872c341a2976c22cd1cc25eae3828f',
    payloadSha256: 'f65acf7914bd1da17320438b3ac9f99f9207d357f8ed98bfdec906bb71236075',
    sourceHead: '5ac8a414c38400f7ff631cc3842bb79150b1c400',
    baseSha: 'ba10365b0c873398ebccc397f64358c7a01fb8cf',
    createdAtUtc: '2026-08-12T11:19:26.603Z',
    expired: false,
  },
});

const EXPECTED_SIGNATURE = deepFreeze({
  algorithm: 'Ed25519',
  keyId: 'sha256:6facafd823e3d3274218bbe0c7f4228b08e5fca98e057db7ae959300424b559f',
  value: 'cNF+dYoICe1aERyaFbnbhy1g/gfKhB2B3XfOboQgTa/pyH41xTob+d31CSfFp7N1eTniNYiWFTFfVxKgrkISDA==',
});

const EXPECTED_EVIDENCE_SHA256 =
  '419b59c82679b0b5abe31606143c557413755d1a19d4f3232714f73e5aab6094';

function verifyLiveObservationSignature(evidence) {
  if (!exactClosedWorldValue(evidence?.provenance?.signature, EXPECTED_SIGNATURE)) return false;
  const signatureBytes = decodeCanonicalBase64(evidence?.provenance?.signature?.value);
  if (!signatureBytes) return false;
  const provenanceCore = Object.fromEntries(
    Object.entries(evidence.provenance).filter(([key]) => key !== 'signature'),
  );
  const payload = {
    schema: evidence.schema,
    observation: evidence.observation,
    provenance: provenanceCore,
  };
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      createPublicKey(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_PUBLIC_KEY_PEM),
      signatureBytes,
    );
  } catch {
    return false;
  }
}

export function validateOperatorProtectedMergeConfigurationActivation(evidence) {
  const blockers = [];
  const block = (code) => {
    if (!blockers.includes(code)) blockers.push(code);
  };

  if (!isPlainRecord(evidence)) {
    return Object.freeze({
      valid: false,
      blockers: Object.freeze(['activation-evidence-malformed']),
      evidenceSha256: null,
    });
  }

  if (!exactClosedWorldValue(Object.keys(evidence).sort(), ['observation', 'provenance', 'schema'])) {
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

  const provenance = isPlainRecord(evidence.provenance) ? evidence.provenance : {};
  if (!isPlainRecord(evidence.provenance)) block('activation-provenance-malformed');
  const expectedProvenanceKeys = [...Object.keys(EXPECTED_PROVENANCE_CORE), 'signature'].sort();
  if (!exactClosedWorldValue(Object.keys(provenance).sort(), expectedProvenanceKeys)) {
    block('activation-provenance-keys-invalid');
  }
  if (provenance.schema !== EXPECTED_PROVENANCE_CORE.schema) block('activation-provenance-schema-mismatch');
  if (provenance.receiptId !== EXPECTED_PROVENANCE_CORE.receiptId) block('activation-provenance-receipt-mismatch');
  if (!exactClosedWorldValue(provenance.observer, EXPECTED_PROVENANCE_CORE.observer)) {
    block('activation-provenance-observer-mismatch');
  }
  if (provenance.observedAtUtc !== EXPECTED_PROVENANCE_CORE.observedAtUtc) {
    block('activation-provenance-time-mismatch');
  }
  if (!exactClosedWorldValue(provenance.capture, EXPECTED_PROVENANCE_CORE.capture)) {
    block('activation-provenance-capture-mismatch');
  }
  if (
    provenance.observationSha256 !== EXPECTED_PROVENANCE_CORE.observationSha256
    || provenance.observationSha256 !== insertionOrderedSha256(observation)
  ) {
    block('activation-provenance-observation-digest-mismatch');
  }
  if (!exactClosedWorldValue(provenance.reviewArtifact, EXPECTED_PROVENANCE_CORE.reviewArtifact)) {
    block('activation-provenance-review-artifact-mismatch');
  }
  if (!exactClosedWorldValue(provenance.signature, EXPECTED_SIGNATURE)) {
    block('activation-provenance-signature-identity-mismatch');
  }
  if (!verifyLiveObservationSignature(evidence)) block('activation-provenance-signature-invalid');

  const evidenceSha256 = sha256(evidence);
  if (!blockers.length && evidenceSha256 !== EXPECTED_EVIDENCE_SHA256) {
    block('activation-evidence-digest-mismatch');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    evidenceSha256: blockers.length === 0 ? evidenceSha256 : null,
  });
}
