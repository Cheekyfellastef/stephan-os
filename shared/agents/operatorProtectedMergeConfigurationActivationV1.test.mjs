import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as activationModule from './operatorProtectedMergeConfigurationActivationV1.mjs';

const {
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_RECEIPT_SCHEMA,
  OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_REQUIRED,
  validateOperatorProtectedMergeConfigurationActivation,
} = activationModule;

const SOURCE_REVIEW_RECEIPT = Object.freeze({
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

function clone(value) {
  return structuredClone(value);
}

function evidence(providerReceipt = null) {
  return {
    schema: OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA,
    observation: clone(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION),
    providerReceipt: providerReceipt === null ? null : clone(providerReceipt),
  };
}

function validateWithoutThrow(value) {
  let result;
  assert.doesNotThrow(() => {
    result = validateOperatorProtectedMergeConfigurationActivation(value);
  });
  assert.equal(result.valid, false);
  assert.equal(result.evidenceSha256, null);
  return result;
}

function assertBlocked(value, blocker) {
  const result = validateWithoutThrow(value);
  assert.ok(result.blockers.includes(blocker), `${blocker} not found in ${result.blockers.join(', ')}`);
  return result;
}

function assertProviderRequired(value) {
  const result = assertBlocked(value, 'activation-provider-proof-required');
  assert.equal(result.finalVerdict, OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_REQUIRED);
  return result;
}

test('source constants and missing external proof return explicit PROVIDER_PROOF_REQUIRED', () => {
  const result = assertProviderRequired(evidence());

  assert.equal(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION.schema,
    OPERATOR_PROTECTED_MERGE_CONFIGURATION_OBSERVATION_SCHEMA);
  assert.match(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(activationModule.createOperatorProtectedMergeConfigurationActivationEvidence, undefined);
  assert.equal(activationModule.OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_PUBLIC_KEY_PEM, undefined);
  assert.equal(result.valid, false);
});

test('a self-selected signing key and signature cannot manufacture activation proof', () => {
  const value = evidence();
  value.publicKey = 'source-authored-key';
  value.signature = 'source-authored-signature';
  const result = assertBlocked(value, 'activation-evidence-keys-invalid');
  assert.equal(result.valid, false);
  assert.equal(result.evidenceSha256, null);
});

test('the pre-existing immutable source-review artifact is not misrepresented as live observation proof', () => {
  const result = assertProviderRequired(evidence(SOURCE_REVIEW_RECEIPT));
  assert.ok(result.blockers.includes('activation-provider-proof-not-live-observation'));
  assert.deepEqual(result.blockers.filter((blocker) => blocker.endsWith('-mismatch')), []);
});

test('rejects forged provider, repository and observer identity', () => {
  const mutations = [
    (receipt) => { receipt.provider = 'source-authored-provider'; },
    (receipt) => { receipt.repository = 'Cheekyfellastef/other-repo'; },
    (receipt) => { receipt.observer = 'source-author'; },
  ];
  for (const mutate of mutations) {
    const receipt = clone(SOURCE_REVIEW_RECEIPT);
    mutate(receipt);
    const result = assertProviderRequired(evidence(receipt));
    assert.ok(result.blockers.includes('activation-provider-proof-identity-mismatch'));
  }
});

test('rejects forged provider workflow run and attempt', () => {
  for (const mutate of [
    (receipt) => { receipt.workflowRunId += 1; },
    (receipt) => { receipt.workflowRunAttempt = 2; },
  ]) {
    const receipt = clone(SOURCE_REVIEW_RECEIPT);
    mutate(receipt);
    assertBlocked(evidence(receipt), 'activation-provider-proof-run-mismatch');
  }
});

test('rejects forged provider artifact identity, digest and payload hash', () => {
  const mutations = [
    (receipt) => { receipt.artifactId += 1; },
    (receipt) => { receipt.artifactName = 'lookalike'; },
    (receipt) => { receipt.artifactDigest = `sha256:${'0'.repeat(64)}`; },
    (receipt) => { receipt.payloadSha256 = '1'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const receipt = clone(SOURCE_REVIEW_RECEIPT);
    mutate(receipt);
    assertBlocked(evidence(receipt), 'activation-provider-proof-artifact-mismatch');
  }
});

test('rejects forged provider head, base and observation identity', () => {
  const cases = [
    ['activation-provider-proof-source-identity-mismatch', (receipt) => { receipt.sourceHead = '2'.repeat(40); }],
    ['activation-provider-proof-source-identity-mismatch', (receipt) => { receipt.baseSha = '3'.repeat(40); }],
    ['activation-provider-proof-observation-mismatch', (receipt) => { receipt.observationSha256 = '4'.repeat(64); }],
  ];
  for (const [blocker, mutate] of cases) {
    const receipt = clone(SOURCE_REVIEW_RECEIPT);
    mutate(receipt);
    assertBlocked(evidence(receipt), blocker);
  }

  const changedObservation = evidence(SOURCE_REVIEW_RECEIPT);
  changedObservation.observation.app.installationId += 1;
  assertBlocked(changedObservation, 'activation-provider-proof-observation-mismatch');
});

test('rejects malformed, widened or falsely promoted provider receipts', () => {
  assertProviderRequired({
    ...evidence(),
    providerReceipt: [],
  });

  const widened = clone(SOURCE_REVIEW_RECEIPT);
  widened.activationAuthority = true;
  assertBlocked(evidence(widened), 'activation-provider-proof-keys-invalid');

  const promoted = clone(SOURCE_REVIEW_RECEIPT);
  promoted.attestationClass = 'live-configuration-observation';
  const result = assertProviderRequired(evidence(promoted));
  assert.ok(result.blockers.includes('activation-provider-proof-attestation-mismatch'));
  assert.ok(result.blockers.includes('activation-provider-proof-not-live-observation'));
});

test('rejects malformed, missing and widened top-level evidence', () => {
  for (const malformed of [null, undefined, [], 'evidence', 1, new Date()]) {
    validateWithoutThrow(malformed);
  }

  const missing = evidence();
  delete missing.providerReceipt;
  assertBlocked(missing, 'activation-evidence-keys-invalid');

  const widened = evidence();
  widened.runtimeAuthority = true;
  assertBlocked(widened, 'activation-evidence-keys-invalid');

  const wrongSchema = evidence();
  wrongSchema.schema = 'stephanos.operator-protected-merge-configuration-activation-evidence.v2';
  assertBlocked(wrongSchema, 'activation-schema-mismatch');
});

test('rejects wrong repository, App, installation, permissions, event and pending-update truth', () => {
  const cases = [
    ['activation-repository-mismatch', (value) => { value.observation.repository.owner = 'OtherOwner'; }],
    ['activation-repository-mismatch', (value) => { value.observation.repository.selectionMode = 'all'; }],
    ['activation-repository-mismatch', (value) => { value.observation.repository.selectedRepositories.push('Cheekyfellastef/other'); }],
    ['activation-app-mismatch', (value) => { value.observation.app.name = 'Lookalike'; }],
    ['activation-app-mismatch', (value) => { value.observation.app.appId += 1; }],
    ['activation-app-mismatch', (value) => { value.observation.app.installationId += 1; }],
    ['activation-app-mismatch', (value) => { value.observation.app.permissions.administration = 'read'; }],
    ['activation-app-mismatch', (value) => { delete value.observation.app.permissions.metadata; }],
    ['activation-app-mismatch', (value) => { value.observation.app.permissions.contents = 'read'; }],
    ['activation-app-mismatch', (value) => { value.observation.app.events.push('repository'); }],
    ['activation-app-mismatch', (value) => { value.observation.app.permissionUpdatePending = true; }],
  ];
  for (const [blocker, mutate] of cases) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
  }
});

test('rejects stale main, wrong ruleset, bypass, required-check or failed-run identity', () => {
  const cases = [
    ['activation-main-identity-mismatch', (value) => { value.observation.admissionBase.headSha = '0'.repeat(40); }],
    ['activation-main-identity-mismatch', (value) => { value.observation.admissionBase.treeSha = '1'.repeat(40); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.id += 1; }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.bypassActors.push({ actorId: 1 }); }],
    ['activation-ruleset-mismatch', (value) => { value.observation.ruleset.requiredStatusChecks[0].integrationId += 1; }],
    ['activation-failed-dispatch-mismatch', (value) => { value.observation.failedDispatch.workflowRunId += 1; }],
    ['activation-failed-dispatch-mismatch', (value) => { value.observation.failedDispatch.runAttempt = 2; }],
    ['activation-failed-dispatch-mismatch', (value) => { value.observation.failedDispatch.conclusion = 'success'; }],
  ];
  for (const [blocker, mutate] of cases) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, blocker);
  }
});

test('preserves the exact GET-only source transport and credential boundary', () => {
  const mutations = [
    (value) => { value.observation.transportBoundary.allowedMethod = 'POST'; },
    (value) => { value.observation.transportBoundary.requestBody = {}; },
    (value) => { value.observation.transportBoundary.redirectMode = 'follow'; },
    (value) => { value.observation.transportBoundary.allowedRepository = 'Cheekyfellastef/other'; },
    (value) => { value.observation.transportBoundary.allowedPathTemplates.push('/graphql'); },
    (value) => { value.observation.transportBoundary.installationPermission = 'administration:read'; },
    (value) => { value.observation.transportBoundary.environmentJobLocal = false; },
    (value) => { value.observation.transportBoundary.credentialPersistence = true; },
    (value) => { value.observation.transportBoundary.credentialLogging = true; },
    (value) => { value.observation.transportBoundary.credentialArtifacting = true; },
    (value) => { value.observation.transportBoundary.credentialCrossJobForwarding = true; },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    assertBlocked(value, 'activation-transport-boundary-mismatch');
  }
});

test('cyclic graphs and shared cycles are total and fail closed', () => {
  const direct = evidence();
  direct.self = direct;
  const directResult = assertBlocked(direct, 'activation-evidence-noncanonical');
  assert.ok(directResult.blockers.includes('canonical-json-cycle'));

  const nested = evidence();
  nested.observation.repository.loop = nested.observation;
  assertBlocked(nested, 'canonical-json-cycle');
});

test('BigInt, Symbol, functions, undefined and non-finite numbers are total and fail closed', () => {
  const cases = [1n, Symbol('authority'), () => true, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0];
  for (const unsupported of cases) {
    const value = evidence();
    value.providerReceipt = unsupported;
    assertBlocked(value, 'activation-evidence-noncanonical');
  }

  const symbolKey = evidence();
  symbolKey[Symbol('authority')] = true;
  assertBlocked(symbolKey, 'canonical-json-symbol-key-unsupported');
});

test('getters are rejected without execution and unsupported prototypes fail closed', () => {
  let getterCalls = 0;
  const withGetter = evidence();
  Object.defineProperty(withGetter, 'authority', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  assertBlocked(withGetter, 'canonical-json-property-invalid');
  assert.equal(getterCalls, 0);

  for (const unsupported of [new Date(), new Map(), new Set(), Object.create(null)]) {
    const value = evidence();
    value.providerReceipt = unsupported;
    assertBlocked(value, 'canonical-json-prototype-unsupported');
  }
});

test('sparse arrays and bounded-serializer expansion limits fail closed', () => {
  const sparse = evidence();
  sparse.observation.app.events = new Array(1);
  assertBlocked(sparse, 'canonical-json-array-not-dense');

  const oversized = evidence();
  oversized.providerReceipt = new Array(2049).fill(null);
  assertBlocked(oversized, 'canonical-json-array-length-invalid');

  const tooDeep = evidence();
  let cursor = tooDeep;
  for (let index = 0; index < 40; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assertBlocked(tooDeep, 'canonical-json-depth-exceeded');
});

test('hostile proxy inspection failures are caught without reading thrown values', () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error('do not inspect me');
    },
  });
  assertBlocked(hostile, 'canonical-json-inspection-failed');

  let thrownProxyPropertyReads = 0;
  const thrownProxy = new Proxy({}, {
    get() {
      thrownProxyPropertyReads += 1;
      throw new Error('do not read the thrown proxy');
    },
  });
  const throwsProxy = new Proxy({}, {
    ownKeys() {
      throw thrownProxy;
    },
  });
  assertBlocked(throwsProxy, 'canonical-json-inspection-failed');
  assert.equal(thrownProxyPropertyReads, 0);

  let messageGetterCalls = 0;
  const thrownWithGetter = {};
  Object.defineProperty(thrownWithGetter, 'message', {
    get() {
      messageGetterCalls += 1;
      throw new Error('do not read message');
    },
  });
  const throwsMessageGetter = new Proxy({}, {
    ownKeys() {
      throw thrownWithGetter;
    },
  });
  assertBlocked(throwsMessageGetter, 'canonical-json-inspection-failed');
  assert.equal(messageGetterCalls, 0);

  for (const primitive of [null, undefined, 'canonical-json-cycle', 1, true, Symbol('failure')]) {
    const throwsPrimitive = new Proxy({}, {
      ownKeys() {
        throw primitive;
      },
    });
    const result = assertBlocked(throwsPrimitive, 'canonical-json-inspection-failed');
    assert.ok(!result.blockers.includes('canonical-json-cycle'));
  }

  const forgedErrorLike = new Proxy({}, {
    ownKeys() {
      throw { message: 'canonical-json-cycle', code: 'canonical-json-cycle' };
    },
  });
  const forgedResult = assertBlocked(forgedErrorLike, 'canonical-json-inspection-failed');
  assert.ok(!forgedResult.blockers.includes('canonical-json-cycle'));

  const readHostile = new Proxy(evidence(), {
    get() {
      throw new Error('property reads are forbidden');
    },
  });
  assertProviderRequired(readHostile);
});

test('private source failures retain stable canonical blocker identities', () => {
  const cases = [
    ['canonical-json-cycle', () => {
      const value = evidence();
      value.self = value;
      return value;
    }],
    ['canonical-json-array-not-dense', () => {
      const value = evidence();
      value.observation.app.events = new Array(1);
      return value;
    }],
    ['canonical-json-type-unsupported', () => {
      const value = evidence();
      value.providerReceipt = 1n;
      return value;
    }],
    ['canonical-json-prototype-unsupported', () => {
      const value = evidence();
      value.providerReceipt = new Date();
      return value;
    }],
    ['canonical-json-array-length-invalid', () => {
      const value = evidence();
      value.providerReceipt = new Array(2049).fill(null);
      return value;
    }],
    ['canonical-json-depth-exceeded', () => {
      const value = evidence();
      let cursor = value;
      for (let index = 0; index < 40; index += 1) {
        cursor.next = {};
        cursor = cursor.next;
      }
      return value;
    }],
  ];

  for (const [blocker, build] of cases) assertBlocked(build(), blocker);
});

test('the required protected-merge command executes this activation suite exactly once', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const command = packageJson.scripts['stephanos:operator-merge-approval:test'];
  const testPath = 'shared/agents/operatorProtectedMergeConfigurationActivationV1.test.mjs';
  assert.equal(command.split(testPath).length - 1, 1);
  assert.match(command, /^node --test /);
});
