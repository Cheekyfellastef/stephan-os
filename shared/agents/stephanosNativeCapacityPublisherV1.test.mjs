import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fsPromises, { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  STEPHANOS_NATIVE_CAPACITY_DEFAULT_MODEL,
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

function governorState(overrides = {}) {
  return {
    schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    phase: 'NORMAL', overrideMode: 'AUTO', ollamaLoadMode: 'balanced', cooldownUntilUtc: '',
    active: false, flatGameActive: false, airLinkActive: false, realAirLinkActive: false,
    virtualAirLinkTestActive: false, prepareLeaseActive: false,
    localModelAllowed: true, heavyModelAllowed: true, updatedAtUtc: OBSERVED,
    ...overrides,
  };
}

function governorPath(root) { return join(root, 'vr', 'vr-resource-governor-current.json'); }
function statusPath(root) { return join(root, 'status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`); }
async function assertGamingHold(result, root) {
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_CAPACITY_GAMING_HOLD');
  assert.match(result.reason, /^native-capacity-gaming-/);
  assert.equal(result.cleared, true);
  await assert.rejects(readFile(statusPath(root), 'utf8'), { code: 'ENOENT' });
}

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
      assert.equal(body.keep_alive, '5m');
      const qualification = body.messages?.[1]?.content || '';
      assert.ok(qualification.includes('Derive the correction yourself.'));
      assert.ok(qualification.includes('minified with no spaces'));
      assert.equal(qualification.includes('export const add=(a,b)=>a+b;'), false);
      assert.ok(qualification.includes('exactly one minified assert.equal call'));
      assert.equal(qualification.includes('assert.equal(add(2,3),5);'), false);
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
  const profile = await mkdtemp(join(tmpdir(), 'stephanos-native-capacity-'));
  const root = join(profile, 'Documents', 'Stephanos-openclaw-workspace');
  try {
    await mkdir(join(root, 'vr'), { recursive: true });
    await writeFile(governorPath(root), JSON.stringify(governorState()));
    return await action(root);
  } finally { await rm(profile, { recursive: true, force: true }); }
}

function publicationOptions(workspaceRoot, overrides = {}) {
  let clock = Date.parse(OBSERVED);
  return {
    workspaceRoot,
    repoRoot: resolve('.'),
    env: { USERPROFILE: resolve(workspaceRoot, '../..') },
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

test('native capacity defaults to the live-qualified deep local model', () => {
  assert.equal(STEPHANOS_NATIVE_CAPACITY_DEFAULT_MODEL, 'qwen3.5:27b');
});

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

test('probe refuses model substitution even when a different local model returns a plausible repair', async () => withWorkspace(async (workspaceRoot) => {
  const probe = await probeStephanosNativeOllamaV1(publicationOptions(workspaceRoot, {
    fetchImpl: fetchFixture({
      chat: {
        model: 'qwen:32b',
        message: { content: JSON.stringify({ source: 'export const add=(a,b)=>a+b;', test: 'assert.equal(add(2,3),5);' }) },
      },
    }),
  }));
  assert.equal(probe.ok, false);
  assert.equal(probe.reason, 'native-model-substitution-detected');
}));

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

test('each refresh rechecks admission and clears old capacity without another model call', async () => withWorkspace(async (root) => {
  let calls = 0;
  const fixture = fetchFixture();
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/chat')) calls += 1;
    return fixture(url, init);
  };
  assert.equal((await publishStephanosNativeCapacityV1(publicationOptions(root, { fetchImpl }))).ok, true);
  await writeFile(governorPath(root), JSON.stringify(governorState({ active: true, heavyModelAllowed: false })));
  await assertGamingHold(await publishStephanosNativeCapacityV1(publicationOptions(root, { fetchImpl })), root);
  assert.equal(calls, 1);
}));

test('missing governor state cannot reuse a previously available capacity receipt', async () => withWorkspace(async (root) => {
  assert.equal((await publishStephanosNativeCapacityV1(publicationOptions(root))).ok, true);
  await rm(governorPath(root));
  let calls = 0;
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root, {
    fetchImpl: async () => { calls += 1; throw new Error('No network request is admitted.'); },
  }));
  await assertGamingHold(result, root);
  assert.equal(calls, 0);
}));

test('prepare appearing during inventory retrieval prevents the model POST', async () => withWorkspace(async (root) => {
  const fixture = fetchFixture();
  let modelCalls = 0;
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root, {
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat')) modelCalls += 1;
      const value = await fixture(url, init);
      if (url.endsWith('/api/tags')) await writeFile(join(root, 'vr', 'gaming-resource-prepare.json'), '{}');
      return value;
    },
  }));
  await assertGamingHold(result, root);
  assert.equal(result.reason, 'native-capacity-gaming-prepare-pending');
  assert.equal(modelCalls, 0);
}));

test('a governor observation that expires during inventory retrieval cannot authorize the POST', async () => withWorkspace(async (root) => {
  const fixture = fetchFixture();
  let now = Date.parse(OBSERVED);
  let modelCalls = 0;
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root, {
    nowMs: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat')) modelCalls += 1;
      const value = await fixture(url, init);
      if (url.endsWith('/api/tags')) now += 30_001;
      return value;
    },
  }));
  await assertGamingHold(result, root);
  assert.equal(result.reason, 'native-capacity-gaming-observation-stale');
  assert.equal(modelCalls, 0);
}));

test('gaming beginning during qualification prevents capacity publication', async () => withWorkspace(async (root) => {
  const fixture = fetchFixture();
  let modelCalls = 0;
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root, {
    fetchImpl: async (url, init) => {
      const value = await fixture(url, init);
      if (url.endsWith('/api/chat')) {
        modelCalls += 1;
        await writeFile(governorPath(root), JSON.stringify(governorState({ phase: 'GAMING', flatGameActive: true })));
      }
      return value;
    },
  }));
  await assertGamingHold(result, root);
  assert.equal(modelCalls, 1);
}));

test('revocation during canonical queue retrieval cannot publish qualified capacity', async () => withWorkspace(async (root) => {
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root, {
    readQueue: async () => {
      await writeFile(governorPath(root), JSON.stringify(governorState({ heavyModelAllowed: false })));
      return [];
    },
  }));
  await assertGamingHold(result, root);
}));

function mockFileSystem(t, method, implementation) {
  const mocked = t.mock.method(fsPromises, method, implementation(fsPromises[method]));
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
}

test('revocation after the status temporary write blocks the actual status rename', async (t) => withWorkspace(async (root) => {
  let temporaryWrites = 0;
  let statusRenames = 0;
  mockFileSystem(t, 'writeFile', (original) => async (path, ...args) => {
    const result = await original(path, ...args);
    if (String(path).startsWith(`${statusPath(root)}.`) && String(path).endsWith('.tmp')) {
      temporaryWrites += 1;
      writeFileSync(governorPath(root), JSON.stringify(governorState({ heavyModelAllowed: false })));
    }
    return result;
  });
  mockFileSystem(t, 'rename', (original) => async (source, target) => {
    if (target === statusPath(root)) statusRenames += 1;
    return original(source, target);
  });
  await assertGamingHold(await publishStephanosNativeCapacityV1(publicationOptions(root)), root);
  assert.equal(temporaryWrites, 1);
  assert.equal(statusRenames, 0);
}));

test('revocation during an awaited status rename clears capacity before returning', async (t) => withWorkspace(async (root) => {
  let statusRenames = 0;
  mockFileSystem(t, 'rename', (original) => async (source, target) => {
    const result = await original(source, target);
    if (target === statusPath(root)) {
      statusRenames += 1;
      writeFileSync(join(root, 'vr', 'gaming-resource-prepare.json'), '{}');
    }
    return result;
  });
  await assertGamingHold(await publishStephanosNativeCapacityV1(publicationOptions(root)), root);
  assert.equal(statusRenames, 1);
}));

test('a filesystem refusal to clear revoked capacity remains an explicit unresolved cleanup failure', async (t) => withWorkspace(async (root) => {
  let published = false;
  mockFileSystem(t, 'rename', (original) => async (source, target) => {
    const result = await original(source, target);
    if (target === statusPath(root)) {
      published = true;
      writeFileSync(join(root, 'vr', 'gaming-resource-prepare.json'), '{}');
    }
    return result;
  });
  mockFileSystem(t, 'unlink', (original) => async (path) => {
    if (published && path === statusPath(root)) {
      throw Object.assign(new Error('The filesystem refused status removal.'), { code: 'EACCES' });
    }
    return original(path);
  });
  const result = await publishStephanosNativeCapacityV1(publicationOptions(root));
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_CAPACITY_GAMING_HOLD');
  assert.equal(result.reason, 'native-capacity-gaming-prepare-pending');
  assert.equal(result.cleared, false);
  assert.equal(result.cleanupReason, 'native-capacity-status-clear-failed');
  assert.equal(JSON.parse(await readFile(statusPath(root), 'utf8')).status, 'READY');
}));

test('an atomic rename retry must obtain fresh admission before attempting publication again', async (t) => withWorkspace(async (root) => {
  let statusRenames = 0;
  mockFileSystem(t, 'rename', (original) => async (source, target) => {
    if (target === statusPath(root)) {
      statusRenames += 1;
      if (statusRenames === 1) {
        writeFileSync(join(root, 'vr', 'gaming-resource-prepare.json'), '{}');
        throw Object.assign(new Error('Retryable Windows sharing conflict.'), { code: 'EPERM' });
      }
    }
    return original(source, target);
  });
  await assertGamingHold(await publishStephanosNativeCapacityV1(publicationOptions(root)), root);
  assert.equal(statusRenames, 1);
}));
