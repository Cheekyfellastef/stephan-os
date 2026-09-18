import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  STEPHANOS_NATIVE_CAPACITY_STATUS_ID,
  probeStephanosNativeOllamaV1,
  publishStephanosNativeCapacityV1,
} from './stephanosNativeCapacityPublisherV1.mjs';
import { verifyStephanosNativeCapacityReceipt } from './stephanosNativeCapacityReceiptV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const OBSERVED = '2026-09-18T11:30:00.000Z';
const KEY_ID = 'stephanos-native-capacity-key-v1';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(value); },
  };
}

function fetchFixture(overrides = {}) {
  return async (url, init = {}) => {
    if (url.endsWith('/api/tags')) {
      return response(overrides.tags || { models: [{ name: 'qwen:14b' }, { name: 'qwen:32b' }] });
    }
    if (url.endsWith('/api/chat')) {
      const body = JSON.parse(init.body || '{}');
      assert.equal(body.model, 'qwen:14b');
      assert.equal(body.stream, false);
      return response(overrides.chat || {
        model: 'qwen:14b',
        message: {
          content: JSON.stringify({
            source: 'export const add=(a,b)=>a+b;',
            test: 'assert.equal(add(2,3),5);',
          }),
        },
      });
    }
    if (url.endsWith('/api/ps')) {
      return response(overrides.ps || { models: [{ name: 'qwen:14b', size: 9_000_000_000, size_vram: 8_000_000_000 }] });
    }
    return response({ error: 'unexpected-url' }, 404);
  };
}

async function withWorkspace(action) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-native-capacity-'));
  try { return await action(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function publicationOptions(workspaceRoot, overrides = {}) {
  let clock = 1_000;
  return {
    workspaceRoot,
    repoRoot: resolve('.'),
    repository: REPOSITORY,
    sourceHead: HEAD,
    workerId: 'stephanos-native-battle-bridge',
    keyId: KEY_ID,
    privateKeyPem,
    observedAtUtc: OBSERVED,
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen:14b',
    fetchImpl: fetchFixture(),
    readQueue: async () => [],
    nowMs: () => { clock += 1_250; return clock; },
    ...overrides,
  };
}

test('live local qualification publishes signed exact-head native capacity and bounded authority', async () => withWorkspace(async (workspaceRoot) => {
  const result = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.statusRecord.status, 'READY');
  assert.equal(result.statusRecord.sourceMutationAllowed, true);
  assert.equal(result.statusRecord.mergeAuthority, false);
  assert.equal(result.statusRecord.leaseSeizureAllowed, false);
  assert.equal(result.statusRecord.arbitraryCommandAllowed, false);
  assert.equal(result.statusRecord.capacityReceipt.payload.sourceHead, HEAD);
  assert.equal(result.statusRecord.capacityReceipt.payload.model, 'qwen:14b');
  assert.equal(result.statusRecord.capacityReceipt.payload.queueDepth, 0);
  assert.equal(result.statusRecord.sourceAuthority.allowedOperations[0], 'SOURCE_CONSTRUCTION');
  assert.equal(result.statusRecord.sourceAuthority.mergeAuthority, false);
  assert.equal(verifyStephanosNativeCapacityReceipt(result.statusRecord.capacityReceipt, {
    publicKeyPem,
    expected: {
      repository: REPOSITORY,
      sourceHead: HEAD,
      workerId: 'stephanos-native-battle-bridge',
      nowUtc: OBSERVED,
      keyId: KEY_ID,
    },
  }).valid, true);
  const persisted = JSON.parse(await readFile(join(workspaceRoot, 'status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`), 'utf8'));
  assert.equal(persisted.capacityReceipt.payload.sourceHead, HEAD);
  assert.equal(persisted.publisherAttestation.keyId, KEY_ID);
  assert.equal(persisted.capacityReceipt.payload.proofRefs.length, 1);
  assert.equal(persisted.capacityReceipt.payload.proofRefs[0], result.proofRef);
  const proofPath = join(workspaceRoot, ...result.proofRef.split('/'));
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  assert.equal(proof.proofId, result.proofRef.replace(/^proof\//, '').replace(/\.json$/, ''));
  assert.equal(proof.queueDepth, 0);
}));

test('signed capacity uses measured canonical Mission Worker queue depth', async () => withWorkspace(async (workspaceRoot) => {
  const result = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot, {
    readQueue: async () => [
      { adapter: 'foundry-forge' },
      { adapter: 'chatgpt-github' },
    ],
  }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.statusRecord.capacityReceipt.payload.queueDepth, 2);
  assert.equal(result.proofRecord.queueDepth, 2);
  assert.equal(result.proofRecord.queueDepthSource, 'canonical-mission-worker-queue');
  assert.ok(result.proofRecord.refs.includes('queue-depth:2'));
}));

test('publisher fails dark when canonical queue posture cannot be proved', async () => withWorkspace(async (workspaceRoot) => {
  const result = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot, { readQueue: undefined }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'native-capacity-queue-unproven');
  await assert.rejects(readFile(join(workspaceRoot, 'status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`), 'utf8'), { code: 'ENOENT' });
}));

test('probe refuses model substitution even when a different local model returns a plausible repair', async () => {
  const probe = await probeStephanosNativeOllamaV1({
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen:14b',
    fetchImpl: fetchFixture({
      chat: {
        model: 'qwen:32b',
        message: { content: JSON.stringify({ source: 'export const add=(a,b)=>a+b;', test: 'assert.equal(add(2,3),5);' }) },
      },
    }),
  });
  assert.equal(probe.ok, false);
  assert.equal(probe.reason, 'native-model-substitution-detected');
});

test('failed deterministic source qualification clears previously published native capacity', async () => withWorkspace(async (workspaceRoot) => {
  const first = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot));
  assert.equal(first.ok, true);
  const second = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot, {
    fetchImpl: fetchFixture({
      chat: { model: 'qwen:14b', message: { content: JSON.stringify({ source: 'wrong', test: 'wrong' }) } },
    }),
  }));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'native-source-qualification-failed');
  await assert.rejects(readFile(join(workspaceRoot, 'status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`), 'utf8'), { code: 'ENOENT' });
}));

test('remote or caller-shaped transport never becomes native capacity', async () => {
  const probe = await probeStephanosNativeOllamaV1({
    endpoint: 'http://192.168.1.20:11434',
    model: 'qwen:14b',
    fetchImpl: fetchFixture(),
  });
  assert.equal(probe.ok, false);
  assert.equal(probe.reason, 'native-local-transport-invalid');
});

test('publisher fails dark when the exact requested model is not installed or loaded', async () => withWorkspace(async (workspaceRoot) => {
  let result = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot, {
    fetchImpl: fetchFixture({ tags: { models: [{ name: 'qwen:32b' }] } }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'native-model-not-installed');

  result = await publishStephanosNativeCapacityV1(publicationOptions(workspaceRoot, {
    fetchImpl: fetchFixture({ ps: { models: [] } }),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'native-model-load-unproven');
}));
