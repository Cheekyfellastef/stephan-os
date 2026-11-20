import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OBSERVATION_MODEL_SAMPLE_LIMIT,
  BATTLE_BRIDGE_OBSERVATION_SCHEMA,
  BATTLE_BRIDGE_OBSERVATION_STDOUT_BUDGET_BYTES,
  collectBattleBridgeObservation,
  parseNvidiaSmiObservation,
} from '../scripts/battle-bridge-observation.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const CONTROL_TOWER_ORIGIN = 'https://stephanos-control-tower.timelesspearl.chatgpt.site';
const BACKEND_HEAD = '293bb02a54a723c782ab6a5167e960a9719f7ddc';
function backendHealth(origins = [CONTROL_TOWER_ORIGIN]) {
  return {
    ok: true,
    schemaVersion: 'stephanos.backend-health.v1',
    service: 'stephanos-server',
    backendIdentity: {
      schemaVersion: 'stephanos.backend-runtime-identity.v1',
      runtimeId: 'stephanos-battle-bridge-backend',
      sourceHead: BACKEND_HEAD,
    },
    cors: { allowed_origin_count: origins.length, allowed_origins: origins },
  };
}

async function observeBackend(body, options = {}) {
  const calls = [];
  const observation = await collectBattleBridgeObservation({
    fetchFn: async (url, requestOptions) => {
      calls.push({ url, options: requestOptions });
      return String(url) === 'http://127.0.0.1:8787/api/health'
        ? options.response || new Response(JSON.stringify(body), {
          status: options.status || 200, headers: { 'content-type': 'application/json' },
        }) : jsonResponse({ models: [] });
    },
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: '' }),
    now: () => new Date('2026-11-07T15:00:00.000Z'),
    memory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 32 * 1024 ** 3 }),
    uptimeFn: () => 3600,
    env: {},
  });
  return { observation, calls };
}

test('existing backend probe returns exact identity and only the pinned Site origin decision', async () => {
  const body = backendHealth(['https://private-origin.invalid', CONTROL_TOWER_ORIGIN]);
  body.provider_secret_status = { privateToken: 'SECRET_MUST_NOT_ESCAPE' };
  body.backendIdentity.privatePath = 'PRIVATE_PATH_MUST_NOT_ESCAPE';
  const { observation, calls } = await observeBackend(body);
  assert.deepEqual(observation.services.backend.connection, {
    schemaVersion: 'stephanos.battle-bridge-backend-connection.v1',
    observed: true,
    healthSchemaVersion: 'stephanos.backend-health.v1',
    service: 'stephanos-server',
    backendIdentity: {
      schemaVersion: 'stephanos.backend-runtime-identity.v1',
      runtimeId: 'stephanos-battle-bridge-backend',
      sourceHead: BACKEND_HEAD,
    },
    controlTowerOrigin: CONTROL_TOWER_ORIGIN,
    controlTowerOriginConfigured: true,
    browserAccessProven: false,
    loadedSourceBytesProven: false,
    executionAuthority: false,
  });
  assert.equal(calls.filter(call => call.url === 'http://127.0.0.1:8787/api/health').length, 1);
  const backendRequest = calls.find(call => call.url === 'http://127.0.0.1:8787/api/health').options;
  assert.equal(backendRequest.method, 'GET');
  assert.equal(backendRequest.redirect, 'error');
  assert.equal(backendRequest.credentials, 'omit');
  assert.equal(backendRequest.headers.authorization, undefined);
  assert.doesNotMatch(JSON.stringify(observation), /SECRET_MUST_NOT_ESCAPE|PRIVATE_PATH_MUST_NOT_ESCAPE|private-origin|allowed_origins|provider_secret_status/);
});

test('origin exclusion is false, while missing, malformed or oversized origin evidence is unknown', async () => {
  const excluded = await observeBackend(backendHealth(['https://unrelated.invalid']));
  assert.equal(excluded.observation.services.backend.connection.controlTowerOriginConfigured, false);
  const bodies = [
    { ...backendHealth(), cors: undefined },
    { ...backendHealth(), cors: { allowed_origin_count: 1, allowed_origins: CONTROL_TOWER_ORIGIN } },
    { ...backendHealth(), cors: { allowed_origin_count: 1, allowed_origins: [true] } },
    { ...backendHealth(), cors: { allowed_origin_count: 2, allowed_origins: [CONTROL_TOWER_ORIGIN] } },
    backendHealth(Array(129).fill(CONTROL_TOWER_ORIGIN)),
  ];
  for (const body of bodies) {
    const { observation } = await observeBackend(body);
    assert.equal(observation.services.backend.connection.observed, true);
    assert.equal(observation.services.backend.connection.controlTowerOriginConfigured, null);
  }
});

test('an HTTP response cannot assert a backend identity through a foreign or incomplete contract', async () => {
  const valid = backendHealth();
  const bodies = [
    null, [], {}, { ...valid, ok: false }, { ...valid, schemaVersion: 'foreign' },
    { ...valid, service: 'other-service' },
    { ...valid, backendIdentity: { ...valid.backendIdentity, schemaVersion: 'foreign' } },
    { ...valid, backendIdentity: { ...valid.backendIdentity, runtimeId: 'other-runtime' } },
    { ...valid, backendIdentity: { ...valid.backendIdentity, sourceHead: '' } },
    { ...valid, backendIdentity: { ...valid.backendIdentity, sourceHead: 'SECRET_MUST_NOT_ESCAPE' } },
  ];
  for (const body of bodies) {
    const { observation } = await observeBackend(body);
    const backend = observation.services.backend;
    assert.equal(backend.ready, true); // Reachability remains separate from identity.
    assert.equal(backend.connection.observed, false);
    assert.equal(backend.connection.backendIdentity, null);
    assert.equal(backend.connection.controlTowerOriginConfigured, null);
    assert.equal(backend.connection.executionAuthority, false);
    assert.doesNotMatch(JSON.stringify(backend), /SECRET_MUST_NOT_ESCAPE|other-service|other-runtime/);
  }
  const failed = await observeBackend(valid, { status: 503 });
  assert.equal(failed.observation.services.backend.ready, false);
  assert.equal(failed.observation.services.backend.connection.observed, false);
});

test('backend health parsing stops at its stream bound and rejects unreadable content', async () => {
  let cancelled = false;
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } });
  const large = await observeBackend(null, { response: oversized });
  assert.equal(large.observation.services.backend.connection.observed, false);
  assert.equal(cancelled, true);
  for (const response of [
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify(backendHealth()), { headers: { 'content-type': 'text/html' } }),
    new Response(JSON.stringify(backendHealth()), { status: 302, headers: { location: 'https://unrelated.invalid' } }),
  ]) {
    const { observation } = await observeBackend(null, { response });
    assert.equal(observation.services.backend.connection.observed, false);
    assert.equal(observation.services.backend.connection.controlTowerOriginConfigured, null);
  }
});

test('Battle Bridge observer returns bounded machine and Ollama facts', async () => {
  const fetchFn = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return jsonResponse({
        models: [{
          name: 'qwen3.5:27b',
          size: 17_000_000_000,
          details: { parameter_size: '27.8B', quantization_level: 'Q4_K_M', family: 'qwen3' },
          privatePath: 'C:\\secret\\model',
        }],
      });
    }
    if (target.endsWith('/api/ps')) {
      return jsonResponse({
        models: [{
          name: 'qwen:14b',
          size: 8_200_000_000,
          size_vram: 7_900_000_000,
          context_length: 32768,
        }],
      });
    }
    return jsonResponse({ ok: true });
  };
  const observation = await collectBattleBridgeObservation({
    fetchFn,
    spawnSyncFn: () => ({
      status: 0,
      stdout: 'NVIDIA GeForce RTX 5090, 32768, 8192, 24576, 17\n',
      stderr: '',
    }),
    now: () => new Date('2026-10-02T10:55:00.000Z'),
    memory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 24 * 1024 ** 3 }),
    uptimeFn: () => 12345,
  });

  assert.equal(observation.schemaVersion, BATTLE_BRIDGE_OBSERVATION_SCHEMA);
  assert.equal(observation.ok, true);
  assert.equal(observation.hostRole, 'battle-bridge');
  assert.equal(observation.memory.usedBytes, 40 * 1024 ** 3);
  assert.equal(observation.gpu.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(observation.gpu.memoryTotalMiB, 32768);
  assert.equal(observation.ollama.installedModelCount, 1);
  assert.equal(observation.ollama.installedModels[0].name, 'qwen3.5:27b');
  assert.equal(observation.ollama.installedModels[0].parameterSize, '27.8B');
  assert.equal(observation.ollama.loadedModels[0].name, 'qwen:14b');
  assert.equal(observation.ollama.loadedModels[0].contextLength, 32768);
  assert.equal(observation.services['sovereign-commander'].ready, true);
  assert.equal(observation.readOnly, true);
  assert.equal(observation.arbitraryShellAllowed, false);
  assert.equal(observation.secretMaterialIncluded, false);
  assert.doesNotMatch(JSON.stringify(observation), /privatePath|secret\\model/);
});


test('proven Sovereign Commander command path outranks a contradictory auxiliary self-probe', async () => {
  const fetchFn = async (url) => {
    const target = String(url);
    if (target.includes('127.0.0.1:18791/health')) throw new Error('self-probe cannot respond while parent command route is synchronously executing');
    if (target.endsWith('/api/tags') || target.endsWith('/api/ps')) return jsonResponse({ models: [] });
    return jsonResponse({ ok: true });
  };

  const observation = await collectBattleBridgeObservation({
    fetchFn,
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: '' }),
    now: () => new Date('2026-10-02T20:37:00.000Z'),
    memory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 32 * 1024 ** 3 }),
    uptimeFn: () => 3600,
    env: {
      STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN: '1',
      STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_TRANSPORT: 'authenticated-http-jsonrpc',
      STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP: '1',
      STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY: '1',
    },
  });

  const commander = observation.services['sovereign-commander'];
  assert.equal(commander.reachable, true);
  assert.equal(commander.ready, true);
  assert.equal(commander.effectiveStatus, 'healthy-command-path-proven');
  assert.equal(commander.evidenceSource, 'sovereign-command-path');
  assert.equal(commander.commandPathProven, true);
  assert.equal(commander.commandTransport, 'authenticated-http-jsonrpc');
  assert.equal(commander.authenticatedMcp, true);
  assert.equal(commander.mcpSessionReady, true);
  assert.equal(commander.probe.reachable, false);
  assert.equal(commander.probe.ready, false);
  assert.equal(commander.probe.authoritative, false);
  assert.equal(commander.warning, 'SOVEREIGN_COMMANDER_AUXILIARY_PROBE_FAILED_COMMAND_PATH_PROVEN');
});

test('Battle Bridge observer stays below the Sovereign fixed-process stdout ceiling with a large model inventory', async () => {
  const installed = Array.from({ length: 64 }, (_, index) => ({
    name: `qwen-maximal-model-name-${String(index).padStart(2, '0')}-${'x'.repeat(72)}:latest`,
    size: 17_000_000_000 + index,
    details: {
      parameter_size: '1234567890123456789012345678901234567890',
      quantization_level: 'Q4_K_M_MAXIMUM_DETAIL_12345678901234567890',
      family: 'family-' + 'y'.repeat(72),
    },
  }));
  const loaded = Array.from({ length: 64 }, (_, index) => ({
    name: `loaded-model-${String(index).padStart(2, '0')}-${'z'.repeat(80)}:latest`,
    size: 9_000_000_000 + index,
    size_vram: 8_000_000_000 + index,
    context_length: 131072,
  }));
  const fetchFn = async (url) => {
    const target = String(url);
    if (target === 'http://127.0.0.1:8787/api/health') return new Response(JSON.stringify(backendHealth()), { headers: { 'content-type': 'application/json' } });
    if (target.endsWith('/api/tags')) return jsonResponse({ models: installed });
    if (target.endsWith('/api/ps')) return jsonResponse({ models: loaded });
    return jsonResponse({ ok: true });
  };
  const observation = await collectBattleBridgeObservation({
    fetchFn,
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: '' }),
    now: () => new Date('2026-10-02T11:30:00.000Z'),
    memory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 32 * 1024 ** 3 }),
    uptimeFn: () => 12345,
  });

  assert.equal(observation.ollama.installedModelCount, 64);
  assert.equal(observation.ollama.loadedModelCount, 64);
  assert.equal(observation.ollama.installedModels.length, BATTLE_BRIDGE_OBSERVATION_MODEL_SAMPLE_LIMIT);
  assert.equal(observation.ollama.loadedModels.length, BATTLE_BRIDGE_OBSERVATION_MODEL_SAMPLE_LIMIT);
  assert.equal(observation.ollama.installedModelsTruncated, true);
  assert.equal(observation.ollama.loadedModelsTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(observation), 'utf8') < BATTLE_BRIDGE_OBSERVATION_STDOUT_BUDGET_BYTES);
});

test('NVIDIA observation fails closed when nvidia-smi is unavailable', () => {
  const gpu = parseNvidiaSmiObservation({ status: 1, stdout: '', error: new Error('missing') });
  assert.equal(gpu.available, false);
  assert.equal(gpu.memoryTotalMiB, null);
  assert.equal(gpu.utilizationGpuPercent, null);
});
