import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStephanosIgniteCommand,
  routeStephanosIgniteCommand,
  validateLoopbackHealthEndpoint,
} from './router.mjs';

test('parser accepts only V1A commands', () => {
  assert.deepEqual(parseStephanosIgniteCommand('help'), { ok: true, command: 'help' });
  assert.deepEqual(parseStephanosIgniteCommand('/stephanos-ignite openclaw-status'), { ok: true, command: 'openclaw-status' });
  assert.deepEqual(parseStephanosIgniteCommand('status'), { ok: true, command: 'status' });
  assert.equal(parseStephanosIgniteCommand('logs').ok, false);
  assert.equal(parseStephanosIgniteCommand('status --verbose').ok, false);
});

test('unknown and deferred unsafe commands return help without mutation', async () => {
  const blocked = ['rebuild', 'restart-backend', 'full', 'logs', 'worker-restart', 'update-main-dry-run', 'git reset --hard', 'status && env'];
  for (const command of blocked) {
    const reply = await routeStephanosIgniteCommand(command, {
      fetchFn: async () => {
        throw new Error('fetch must not run for rejected commands');
      },
    });
    assert.match(reply.text, /Stephanos Ignite V1A \(read-only\)/);
    assert.match(reply.text, /Mutation commands are not available in V1A/);
  }
});

test('validates loopback health endpoints only', () => {
  assert.equal(validateLoopbackHealthEndpoint('http://127.0.0.1:8790/health', '/health'), 'http://127.0.0.1:8790/health');
  assert.equal(validateLoopbackHealthEndpoint('http://localhost:8787/api/health', '/api/health'), 'http://localhost:8787/api/health');
  assert.throws(() => validateLoopbackHealthEndpoint('https://example.com/health', '/health'), /loopback HTTP/);
  assert.throws(() => validateLoopbackHealthEndpoint('http://127.0.0.1:8790/health?token=secret', '/health'), /credentials, query parameters, or fragments/);
  assert.throws(() => validateLoopbackHealthEndpoint('http://127.0.0.1:8790/admin', '/health'), /target \/health/);
});

test('openclaw-status returns concise availability proof', async () => {
  const reply = await routeStephanosIgniteCommand('openclaw-status', {
    endpoint: 'http://127.0.0.1:8790/health',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ state: 'available', executionAllowed: false, secret: 'must-not-leak' }),
    }),
  });
  assert.equal(reply.text, 'OpenClaw: available; endpoint=/health; http=200; executionAllowed=false; mutation=blocked.');
  assert.doesNotMatch(reply.text, /secret|must-not-leak/i);
});

test('status returns concise Stephanos health proof', async () => {
  const reply = await routeStephanosIgniteCommand('status', {
    endpoint: 'http://127.0.0.1:8787/api/health',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy', env: { token: 'must-not-leak' } }),
    }),
  });
  assert.equal(reply.text, 'Stephanos: reachable; endpoint=/api/health; http=200; health=healthy; mutation=blocked.');
  assert.doesNotMatch(reply.text, /token|must-not-leak/i);
});
