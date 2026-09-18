import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createStephanosNativeCapacityReceipt,
  createStephanosNativeSourceAuthority,
} from '../../shared/agents/stephanosNativeCapacityReceiptV1.mjs';
import {
  isVerifiedStephanosNativeRoutingCandidate,
  readVerifiedStephanosNativeRoutingCandidate,
} from './stephanosNativeCapacityRoutingService.js';

const NOW = '2026-09-18T12:00:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);
const WORKER_ID = 'stephanos-native-battle-bridge';
const KEY_ID = 'stephanos-native-capacity-key-v1';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signedStatus(keyPair, overrides = {}) {
  const payload = {
    schemaVersion: 'stephanos.native-capacity-payload.v1',
    receiptId: 'native-capacity-aaaaaaaaaaaa-20260918115900',
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: WORKER_ID,
    provider: 'ollama-local',
    transport: 'http-loopback-fixed',
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen:14b',
    modelInventorySha256: '1'.repeat(64),
    qualificationId: 'native-source-qualification-v1',
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    observedAtUtc: '2026-09-18T11:59:00.000Z',
    expiresAtUtc: '2026-09-18T12:04:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 2,
    loadState: 'READY',
    requestSha256: '2'.repeat(64),
    responseSha256: '3'.repeat(64),
    proofRefs: ['proof/native-capacity-runtime-test.json'],
    ...(overrides.payload || {}),
  };
  const capacityReceipt = createStephanosNativeCapacityReceipt(payload, {
    privateKeyPem: keyPair.privateKeyPem,
    keyId: KEY_ID,
  });
  const expected = {
    repository: REPOSITORY,
    sourceHead: payload.sourceHead,
    workerId: WORKER_ID,
    nowUtc: NOW,
    keyId: KEY_ID,
  };
  const sourceAuthority = createStephanosNativeSourceAuthority(capacityReceipt, {
    publicKeyPem: keyPair.publicKeyPem,
    expected,
  });
  const receiptSha256 = createHash('sha256').update(JSON.stringify(capacityReceipt)).digest('hex');
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'stephanos-native-capacity-current',
    participantId: WORKER_ID,
    timestampUtc: payload.observedAtUtc,
    status: 'READY',
    capacityReceipt,
    sourceAuthority,
    publisherAttestation: {
      keyId: KEY_ID,
      receiptSha256,
      sourceHead: payload.sourceHead,
      proofRef: payload.proofRefs[0],
    },
    sourceMutationAllowed: true,
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    ...(overrides.status || {}),
  };
}

async function fixture(options = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'stephanos-native-routing-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  const missionRunnerRoot = join(parent, 'mission-runner');
  const keyDir = join(missionRunnerRoot, 'keys');
  await mkdir(join(root, 'status'), { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await mkdir(keyDir, { recursive: true });

  const signer = keys();
  const status = signedStatus(signer, options.statusOverrides);
  await writeFile(
    join(root, 'status', 'stephanos-native-capacity-current.json'),
    `${JSON.stringify(status, null, 2)}\n`,
    'utf8',
  );
  const publicKeyPem = options.publicKeyPem || signer.publicKeyPem;
  if (options.omitPublicKey !== true) {
    await writeFile(join(keyDir, 'stephanos-native-capacity-public.pem'), publicKeyPem, 'utf8');
  }

  return {
    root,
    repoRoot,
    env: { STEPHANOS_MISSION_RUNNER_ROOT: missionRunnerRoot },
    signer,
    status,
  };
}

async function admit(fx, overrides = {}) {
  return readVerifiedStephanosNativeRoutingCandidate({
    root: fx.root,
    repoRoot: fx.repoRoot,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
    env: fx.env,
    ...overrides,
  });
}

test('canonical signed native capacity becomes one verified source-routing candidate', async () => {
  const fx = await fixture();
  const result = await admit(fx);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_ROUTING_CANDIDATE_VERIFIED');
  assert.equal(result.candidate.route, 'STEPHANOS_NATIVE');
  assert.equal(result.candidate.adapter, 'stephanos-native');
  assert.equal(result.candidate.workerId, WORKER_ID);
  assert.equal(result.candidate.sourceHead, SOURCE_HEAD);
  assert.equal(result.candidate.taskClass, 'FOCUSED_REPAIR');
  assert.equal(result.candidate.sourceMutationAllowed, true);
  assert.equal(result.candidate.mergeAuthority, false);
  assert.equal(result.candidate.leaseSeizureAllowed, false);
  assert.equal(result.candidate.duplicateDispatchAllowed, false);
  assert.equal(isVerifiedStephanosNativeRoutingCandidate(result.candidate), true);
});

test('caller-shaped native candidate cannot manufacture verified admission', () => {
  const forged = Object.freeze({
    route: 'STEPHANOS_NATIVE',
    adapter: 'stephanos-native',
    workerId: WORKER_ID,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    taskClass: 'FOCUSED_REPAIR',
    sourceMutationAllowed: true,
    mergeAuthority: false,
  });
  assert.equal(isVerifiedStephanosNativeRoutingCandidate(forged), false);
});

test('native routing rejects a receipt when the protected verification key does not match', async () => {
  const wrong = keys();
  const fx = await fixture({ publicKeyPem: wrong.publicKeyPem });
  const result = await admit(fx);
  assert.equal(result.ok, false);
  assert.match(result.reason, /^STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:/);
  assert.equal(result.candidate, null);
});

test('native routing rejects exact-head drift', async () => {
  const fx = await fixture();
  const result = await admit(fx, { sourceHead: 'b'.repeat(40) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:/);
  assert.equal(result.candidate, null);
});

test('native routing rejects unsupported task classes without widening source authority', async () => {
  const fx = await fixture();
  const result = await admit(fx, { taskClass: 'MULTI_MODULE_IMPLEMENTATION' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_TASK_NOT_QUALIFIED');
  assert.equal(result.candidate, null);
});

test('native routing fails dark when the protected public key is missing', async () => {
  const fx = await fixture({ omitPublicKey: true });
  const result = await admit(fx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING');
  assert.equal(result.candidate, null);
});

test('native routing rejects status authority widening even when the signature is valid', async () => {
  const fx = await fixture({
    statusOverrides: { status: { mergeAuthority: true } },
  });
  const result = await admit(fx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_CAPACITY_STATUS_BINDING_INVALID');
  assert.equal(result.candidate, null);
});
