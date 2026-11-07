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
