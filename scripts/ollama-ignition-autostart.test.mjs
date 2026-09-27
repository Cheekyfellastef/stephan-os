import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  evaluateOllamaRuntimeAutostartWithDeps,
  resolveOllamaIgnitionConfig,
} from './ignite-stephanos-local.mjs';

function response(models, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ models: models.map((name) => ({ name })) }),
  };
}

test('Ollama ignition config resolves Battle Bridge defaults and installed Windows executable', () => {
  const config = resolveOllamaIgnitionConfig({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Operator\\AppData\\Local' },
    existsFn: (candidate) => candidate.endsWith('Programs\\Ollama\\ollama.exe'),
  });
  assert.equal(config.baseURL, 'http://127.0.0.1:11434');
  assert.equal(config.requiredModel, 'qwen:14b');
  assert.match(config.executable, /Programs\\Ollama\\ollama\.exe$/);
  assert.equal(config.executableSource, 'installed-path');
});
test('Ollama ignition normalizes wildcard host into a local probe address', () => {
  const config = resolveOllamaIgnitionConfig({
    platform: 'win32',
    env: {
      OLLAMA_HOST: '0.0.0.0:11434',
      STEPHANOS_OLLAMA_EXECUTABLE: 'C:\\Ollama\\ollama.exe',
    },
  });
  assert.equal(config.baseURL, 'http://127.0.0.1:11434');
});

test('healthy Ollama and required model are reused without duplicate start', async () => {
  const spawned = [];
  const result = await evaluateOllamaRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OLLAMA_EXECUTABLE: 'C:\\Ollama\\ollama.exe' },
    fetchFn: async () => response(['qwen:14b', 'llama3.2:3b']),
    spawnFn: (...args) => spawned.push(args),
    log: () => {},
  });
  assert.equal(result.state, 'ollama-reused-existing-runtime');
  assert.equal(result.healthy, true);
  assert.equal(result.duplicateStartAvoided, true);
  assert.equal(spawned.length, 0);
});
test('Ignition starts hidden Ollama serve when absent then proves API and model readiness', async () => {
  const spawned = [];
  let fetchCount = 0;
  const result = await evaluateOllamaRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OLLAMA_EXECUTABLE: 'C:\\Ollama\\ollama.exe' },
    fetchFn: async () => {
      fetchCount += 1;
      if (fetchCount === 1) throw new Error('connection refused');
      return response(['qwen:14b']);
    },
    spawnFn: (command, commandArgs, options) => {
      spawned.push({ command, commandArgs, options });
      return { pid: 11434, unref() {} };
    },
    readinessTimeoutMs: 50,
    retryIntervalMs: 0,
    log: () => {},
  });
  assert.equal(result.state, 'ollama-autostart-verified');
  assert.equal(result.healthy, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'C:\\Ollama\\ollama.exe');
  assert.deepEqual(spawned[0].commandArgs, ['serve']);
  assert.equal(spawned[0].options.windowsHide, true);
  assert.equal(spawned[0].options.detached, true);
  assert.equal(spawned[0].options.shell, false);
});
test('reachable Ollama with missing required model blocks instead of painting local AI green', async () => {
  const spawned = [];
  await assert.rejects(() => evaluateOllamaRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OLLAMA_EXECUTABLE: 'C:\\Ollama\\ollama.exe' },
    fetchFn: async () => response(['llama3.2:3b']),
    spawnFn: (...args) => spawned.push(args),
    log: () => {},
  }), /required model qwen:14b is not installed/i);
  assert.equal(spawned.length, 0);
});

test('unreachable Ollama that stays down blocks after the bounded start attempt', async () => {
  await assert.rejects(() => evaluateOllamaRuntimeAutostartWithDeps({
    platform: 'win32',
    env: { STEPHANOS_OLLAMA_EXECUTABLE: 'C:\\Ollama\\ollama.exe' },
    fetchFn: async () => { throw new Error('connection refused'); },
    spawnFn: () => ({ pid: 99, unref() {} }),
    readinessTimeoutMs: 0,
    retryIntervalMs: 0,
    log: () => {},
  }), /did not become ready/i);
});

test('normal Ignition wires Ollama supervision before OpenClaw and publishes Local AI cockpit proof', () => {
  const source = readFileSync(new URL('./ignite-stephanos-local.mjs', import.meta.url), 'utf8');
  const ollamaCall = source.indexOf('ollamaIgnitionStatus = await evaluateOllamaRuntimeAutostartWithDeps();');
  const openClawCall = source.indexOf('await evaluateOpenClawRuntimeAutostartWithDeps();', ollamaCall);
  assert.ok(ollamaCall > 0);
  assert.ok(openClawCall > ollamaCall);
  assert.match(source, /id: 'local-ai', label: 'Local AI'/);
  assert.match(source, /ollamaIgnitionStatus,/);
});
