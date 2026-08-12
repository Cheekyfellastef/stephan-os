import { createHash } from 'node:crypto';

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA =
  'stephanos.operator-protected-merge-configuration-activation.v1';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
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

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export const OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION = deepFreeze({
  schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
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
  sha256(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION);

export function createOperatorProtectedMergeConfigurationActivationEvidence() {
  return deepFreeze(clone(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION));
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

  const expected = OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION;
  const topLevelKeys = Object.keys(expected).sort();
  if (!exactClosedWorldValue(Object.keys(evidence).sort(), topLevelKeys)) {
    block('activation-evidence-keys-invalid');
  }
  if (evidence.schema !== expected.schema) block('activation-schema-mismatch');
  if (!exactClosedWorldValue(evidence.repository, expected.repository)) {
    block('activation-repository-mismatch');
  }
  if (!exactClosedWorldValue(evidence.app, expected.app)) {
    block('activation-app-mismatch');
  }
  if (!exactClosedWorldValue(evidence.admissionBase, expected.admissionBase)) {
    block('activation-main-identity-mismatch');
  }
  if (!exactClosedWorldValue(evidence.ruleset, expected.ruleset)) {
    block('activation-ruleset-mismatch');
  }
  if (!exactClosedWorldValue(evidence.failedDispatch, expected.failedDispatch)) {
    block('activation-failed-dispatch-mismatch');
  }
  if (!exactClosedWorldValue(evidence.transportBoundary, expected.transportBoundary)) {
    block('activation-transport-boundary-mismatch');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    evidenceSha256: blockers.length === 0
      ? OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256
      : null,
  });
}
