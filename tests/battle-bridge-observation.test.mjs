import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_OBSERVATION_SCHEMA,
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

test('NVIDIA observation fails closed when nvidia-smi is unavailable', () => {
  const gpu = parseNvidiaSmiObservation({ status: 1, stdout: '', error: new Error('missing') });
  assert.equal(gpu.available, false);
  assert.equal(gpu.memoryTotalMiB, null);
  assert.equal(gpu.utilizationGpuPercent, null);
});
