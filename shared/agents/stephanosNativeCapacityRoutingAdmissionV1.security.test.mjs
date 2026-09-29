import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createStephanosNativeCapacityReceipt,
  createStephanosNativeSourceAuthority,
} from './stephanosNativeCapacityReceiptV1.mjs';
import {
  STEPHANOS_NATIVE_CAPACITY_KEY_ID,
  readVerifiedStephanosNativeRoutingCandidate,
} from './stephanosNativeCapacityRoutingAdmissionV1.mjs';

const NOW = '2026-08-10T12:00:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);
const WORKER_ID = 'stephanos-native-battle-bridge';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function buildStatus(keys) {
  const payload = {
    schemaVersion: 'stephanos.native-capacity-payload.v1',
    receiptId: 'native-capacity-aaaaaaaaaaaa-20260810115900',
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
    observedAtUtc: '2026-08-10T11:59:00.000Z',
    expiresAtUtc: '2026-08-10T12:04:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 2,
    loadState: 'READY',
    requestSha256: '2'.repeat(64),
    responseSha256: '3'.repeat(64),
    proofRefs: ['proof/native-capacity-runtime-test.json'],
  };
  const capacityReceipt = createStephanosNativeCapacityReceipt(payload, {
    privateKeyPem: keys.privateKeyPem,
    keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID,
  });
  const expected = {
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: WORKER_ID,
    nowUtc: NOW,
    keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID,
  };
  const sourceAuthority = createStephanosNativeSourceAuthority(capacityReceipt, {
    publicKeyPem: keys.publicKeyPem,
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
      keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID,
      receiptSha256,
      sourceHead: SOURCE_HEAD,
      proofRef: payload.proofRefs[0],
    },
    sourceMutationAllowed: true,
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  };
}

async function fixture(mutator = (status) => status) {
  const parent = await mkdtemp(join(tmpdir(), 'native-routing-security-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  const missionRunnerRoot = join(parent, 'mission-runner');
  const keyDir = join(missionRunnerRoot, 'keys');
  await mkdir(join(root, 'status'), { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await mkdir(keyDir, { recursive: true });
  const keys = keyPair();
  const status = mutator(structuredClone(buildStatus(keys)));
  await writeFile(join(root, 'status', 'stephanos-native-capacity-current.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await writeFile(join(keyDir, 'stephanos-native-capacity-public.pem'), keys.publicKeyPem, 'utf8');
  return {
    root,
    repoRoot,
    env: { STEPHANOS_MISSION_RUNNER_ROOT: missionRunnerRoot },
  };
}

async function admit(mutator) {
  return readVerifiedStephanosNativeRoutingCandidate({
    ...(await fixture(mutator)),
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  });
}

test('admits the canonical protected-key identity and derived authority identity', async () => {
  const result = await admit();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.candidate.authorityReceiptIds.length, 1);
  assert.match(result.candidate.authorityReceiptIds[0], /^native-authority-[0-9a-f]{24}$/);
});

test('rejects a relabelled receipt key ID even when the payload signature stays valid', async () => {
  const result = await admit((status) => {
    status.capacityReceipt.keyId = 'attacker-selected-key-id';
    status.publisherAttestation.keyId = 'attacker-selected-key-id';
    status.publisherAttestation.receiptSha256 = createHash('sha256')
      .update(JSON.stringify(status.capacityReceipt))
      .digest('hex');
    return status;
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:verification-key-id-mismatch');
});

test('rejects a substituted authority ID that is not derived from the signed receipt', async () => {
  const result = await admit((status) => {
    status.sourceAuthority.authorityId = 'native-authority-attacker-selected';
    return status;
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STEPHANOS_NATIVE_SOURCE_AUTHORITY_INVALID:authority-id-binding-mismatch');
});
