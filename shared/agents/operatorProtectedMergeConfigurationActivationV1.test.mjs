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

function canonicalJson(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (type === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return String(value);
  if (type !== 'object') throw new TypeError('test value is not canonical JSON');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('test array is sparse');
    }
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('test value has an unsupported prototype');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function validateCanonicalWithoutThrow(canonicalEvidenceJson) {
  let result;
  assert.doesNotThrow(() => {
    result = validateOperatorProtectedMergeConfigurationActivation(canonicalEvidenceJson);
  });
  assert.equal(result.valid, false);
  assert.equal(result.evidenceSha256, null);
  return result;
}

function validateWithoutThrow(value) {
  return validateCanonicalWithoutThrow(canonicalJson(value));
}

function assertBlocked(value, blocker) {
  const result = validateWithoutThrow(value);
  assert.ok(result.blockers.includes(blocker), `${blocker} not found in ${result.blockers.join(', ')}`);
  return result;
}

function assertInputBlocked(value, blocker) {
  const result = validateCanonicalWithoutThrow(value);
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

test('the exported boundary accepts only bounded primitive canonical JSON', () => {
  const encoded = canonicalJson(evidence());
  const result = validateCanonicalWithoutThrow(encoded);
  assert.ok(result.blockers.includes('activation-provider-proof-required'));
  assert.equal(result.finalVerdict, OPERATOR_PROTECTED_MERGE_CONFIGURATION_PROVIDER_REQUIRED);

  for (const nonPrimitive of [evidence(), new String(encoded), Buffer.from(encoded)]) {
    assertInputBlocked(nonPrimitive, 'activation-evidence-encoding-required');
  }
});

test('large caller objects and every Proxy inspection surface are refused without access', () => {
  const calls = {
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
  };
  const target = Object.fromEntries(
    Array.from({ length: 4096 }, (_, index) => [`key-${index}`, null]),
  );
  const hostile = new Proxy(target, {
    get() {
      calls.get += 1;
      throw new Error('caller properties must not be read');
    },
    getOwnPropertyDescriptor() {
      calls.getOwnPropertyDescriptor += 1;
      throw new Error('caller descriptors must not be read');
    },
    getPrototypeOf() {
      calls.getPrototypeOf += 1;
      throw new Error('caller prototypes must not be read');
    },
    ownKeys() {
      calls.ownKeys += 1;
      throw new Error('caller keys must not be read');
    },
  });

  assertInputBlocked(hostile, 'activation-evidence-encoding-required');
  assert.deepEqual(calls, {
    get: 0,
    getOwnPropertyDescriptor: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
  });
});

test('noncanonical, duplicate, malformed and unsupported JSON encodings fail closed', () => {
  const exact = canonicalJson(evidence());
  const observation = canonicalJson(evidence().observation);
  const schema = JSON.stringify(OPERATOR_PROTECTED_MERGE_CONFIGURATION_ACTIVATION_SCHEMA);
  const duplicateKey = `{"observation":${observation},"providerReceipt":null,"providerReceipt":null,"schema":${schema}}`;
  const unsupportedEscape = exact.replace('"schema"', '"\\u0073chema"');
  const insertionOrdered = JSON.stringify(evidence());

  for (const widenedEncoding of [
    ` ${exact}`,
    `${exact}\n`,
    duplicateKey,
    unsupportedEscape,
    insertionOrdered,
  ]) {
    assertInputBlocked(widenedEncoding, 'activation-evidence-canonical-json-mismatch');
  }
  for (const malformed of ['{', '', 'not-json']) {
    assertInputBlocked(malformed, 'activation-evidence-json-invalid');
  }

  const widenedRecord = evidence();
  widenedRecord.runtimeAuthority = true;
  assertBlocked(widenedRecord, 'activation-evidence-keys-invalid');
});

test('primitive JSON size is bounded before parsing by code units and UTF-8 bytes', () => {
  assertInputBlocked('x'.repeat(262_145), 'canonical-json-too-large');
  assertInputBlocked(`"${'\u00e9'.repeat(131_072)}"`, 'canonical-json-too-large');

  const exactBoundary = canonicalJson({ x: 'a'.repeat(262_136) });
  assert.equal(Buffer.byteLength(exactBoundary, 'utf8'), 262_144);
  const exactResult = validateCanonicalWithoutThrow(exactBoundary);
  assert.ok(!exactResult.blockers.includes('canonical-json-too-large'));
  assert.ok(!exactResult.blockers.includes('activation-evidence-json-invalid'));
  assert.ok(!exactResult.blockers.includes('activation-evidence-canonical-json-mismatch'));

  const boundaryPlusOne = canonicalJson({ x: 'a'.repeat(262_137) });
  assert.equal(Buffer.byteLength(boundaryPlusOne, 'utf8'), 262_145);
  assertInputBlocked(boundaryPlusOne, 'canonical-json-too-large');
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
  for (const malformed of [null, [], 'evidence', 1]) {
    validateWithoutThrow(malformed);
  }
  for (const nonEncoded of [undefined, new Date()]) {
    assertInputBlocked(nonEncoded, 'activation-evidence-encoding-required');
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

test('caller-owned cyclic graphs are rejected without canonical inspection', () => {
  const direct = evidence();
  direct.self = direct;
  assertInputBlocked(direct, 'activation-evidence-encoding-required');

  const nested = evidence();
  nested.observation.repository.loop = nested.observation;
  assertInputBlocked(nested, 'activation-evidence-encoding-required');
});

test('non-JSON caller values are rejected at the primitive encoding boundary', () => {
  const cases = [1n, Symbol('authority'), () => true, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0];
  for (const unsupported of cases) {
    const value = evidence();
    value.providerReceipt = unsupported;
    assertInputBlocked(value, 'activation-evidence-encoding-required');
  }

  const symbolKey = evidence();
  symbolKey[Symbol('authority')] = true;
  assertInputBlocked(symbolKey, 'activation-evidence-encoding-required');
});

test('getters and unsupported prototypes are rejected without inspection', () => {
  let getterCalls = 0;
  const withGetter = evidence();
  Object.defineProperty(withGetter, 'authority', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  assertInputBlocked(withGetter, 'activation-evidence-encoding-required');
  assert.equal(getterCalls, 0);

  for (const unsupported of [new Date(), new Map(), new Set(), Object.create(null)]) {
    assertInputBlocked(unsupported, 'activation-evidence-encoding-required');
  }
});

test('sparse arrays and bounded-serializer expansion limits fail closed', () => {
  const sparse = evidence();
  sparse.observation.app.events = new Array(1);
  assertInputBlocked(sparse, 'activation-evidence-encoding-required');

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

test('caller-owned arrays are rejected before own keys or element descriptors are inspected', () => {
  let ownKeyCalls = 0;
  let elementDescriptorCalls = 0;
  const oversized = new Proxy(new Array(2049).fill(null), {
    ownKeys() {
      ownKeyCalls += 1;
      throw new Error('oversized arrays must be rejected before ownKeys');
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'length') return Reflect.getOwnPropertyDescriptor(target, property);
      elementDescriptorCalls += 1;
      throw new Error('oversized arrays must be rejected before element descriptors');
    },
  });

  assertInputBlocked(oversized, 'activation-evidence-encoding-required');
  assert.equal(ownKeyCalls, 0);
  assert.equal(elementDescriptorCalls, 0);
});

test('caller-owned objects are rejected before key collection or property descriptors', () => {
  let ownKeyCalls = 0;
  let descriptorCalls = 0;
  const target = Object.fromEntries(
    Array.from({ length: 513 }, (_, index) => [`key-${index}`, null]),
  );
  const oversized = new Proxy(target, {
    ownKeys(value) {
      ownKeyCalls += 1;
      return Reflect.ownKeys(value);
    },
    getOwnPropertyDescriptor() {
      descriptorCalls += 1;
      throw new Error('oversized objects must be rejected before property descriptors');
    },
  });

  assertInputBlocked(oversized, 'activation-evidence-encoding-required');
  assert.equal(ownKeyCalls, 0);
  assert.equal(descriptorCalls, 0);
});

test('exact array and object cardinality boundaries remain admissible to canonical inspection', () => {
  const exactArray = validateWithoutThrow(new Array(2048).fill(null));
  assert.ok(!exactArray.blockers.includes('canonical-json-array-length-invalid'));
  assert.ok(!exactArray.blockers.includes('canonical-json-node-limit-exceeded'));

  const exactObject = validateWithoutThrow(Object.fromEntries(
    Array.from({ length: 512 }, (_, index) => [`key-${index}`, null]),
  ));
  assert.ok(!exactObject.blockers.includes('canonical-json-object-key-limit-exceeded'));
  assert.ok(!exactObject.blockers.includes('canonical-json-node-limit-exceeded'));
});

test('array extras and malformed individual descriptors remain fail closed', () => {
  const withExtraProperty = [null];
  withExtraProperty.extra = true;
  assertInputBlocked(withExtraProperty, 'activation-evidence-encoding-required');

  let accessorCalls = 0;
  const malformedDescriptor = new Proxy({ value: null }, {
    getOwnPropertyDescriptor(target, property) {
      if (property !== 'value') return Reflect.getOwnPropertyDescriptor(target, property);
      return {
        configurable: true,
        enumerable: true,
        get() {
          accessorCalls += 1;
          return null;
        },
      };
    },
  });
  assertInputBlocked(malformedDescriptor, 'activation-evidence-encoding-required');
  assert.equal(accessorCalls, 0);

  const source = readFileSync(
    new URL('./operatorProtectedMergeConfigurationActivationV1.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /getOwnPropertyDescriptors/);
});

test('oversized string values and property names fail before unbounded JSON serialization', () => {
  const oversizedValue = { value: 'x'.repeat(262_145) };
  assertBlocked(oversizedValue, 'canonical-json-too-large');

  const oversizedKey = { ['k'.repeat(262_145)]: null };
  assertBlocked(oversizedKey, 'canonical-json-too-large');

  const source = readFileSync(
    new URL('./operatorProtectedMergeConfigurationActivationV1.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /JSON\.stringify/);
});

test('cumulative canonical byte accounting blocks many individually bounded strings', () => {
  const individuallySmall = new Array(2048).fill('x'.repeat(128));
  assert.ok(individuallySmall.every((value) => Buffer.byteLength(value, 'utf8') < 262_144));
  assertBlocked(individuallySmall, 'canonical-json-too-large');
});

test('canonical byte boundary is inclusive and boundary plus one fails closed', () => {
  const exactBoundary = { x: 'a'.repeat(262_136) };
  const exactResult = validateWithoutThrow(exactBoundary);
  assert.ok(!exactResult.blockers.includes('canonical-json-too-large'));

  const overBoundary = { x: 'a'.repeat(262_137) };
  assertBlocked(overBoundary, 'canonical-json-too-large');
});

test('escape-heavy strings use their encoded JSON bytes at the exact boundary', () => {
  const exactBoundary = { x: '\n'.repeat(131_068) };
  const exactResult = validateWithoutThrow(exactBoundary);
  assert.ok(!exactResult.blockers.includes('canonical-json-too-large'));

  const overBoundary = { x: `${'\n'.repeat(131_068)}a` };
  assertBlocked(overBoundary, 'canonical-json-too-large');
});

test('property names use the same inclusive encoded byte boundary', () => {
  const exactBoundary = { ['k'.repeat(262_135)]: null };
  const exactResult = validateWithoutThrow(exactBoundary);
  assert.ok(!exactResult.blockers.includes('canonical-json-too-large'));

  const overBoundary = { ['k'.repeat(262_136)]: null };
  assertBlocked(overBoundary, 'canonical-json-too-large');
});

test('hostile proxies are refused without invoking traps or reading thrown values', () => {
  let hostileOwnKeyCalls = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      hostileOwnKeyCalls += 1;
      throw new Error('do not inspect me');
    },
  });
  assertInputBlocked(hostile, 'activation-evidence-encoding-required');
  assert.equal(hostileOwnKeyCalls, 0);

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
  assertInputBlocked(throwsProxy, 'activation-evidence-encoding-required');
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
  assertInputBlocked(throwsMessageGetter, 'activation-evidence-encoding-required');
  assert.equal(messageGetterCalls, 0);

  for (const primitive of [null, undefined, 'canonical-json-cycle', 1, true, Symbol('failure')]) {
    const throwsPrimitive = new Proxy({}, {
      ownKeys() {
        throw primitive;
      },
    });
    const result = assertInputBlocked(throwsPrimitive, 'activation-evidence-encoding-required');
    assert.ok(!result.blockers.includes('canonical-json-cycle'));
  }

  const forgedErrorLike = new Proxy({}, {
    ownKeys() {
      throw { message: 'canonical-json-cycle', code: 'canonical-json-cycle' };
    },
  });
  const forgedResult = assertInputBlocked(forgedErrorLike, 'activation-evidence-encoding-required');
  assert.ok(!forgedResult.blockers.includes('canonical-json-cycle'));

  const readHostile = new Proxy(evidence(), {
    get() {
      throw new Error('property reads are forbidden');
    },
  });
  assertInputBlocked(readHostile, 'activation-evidence-encoding-required');
});

test('bounded parsed structures retain stable canonical blocker identities', () => {
  const cases = [
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
