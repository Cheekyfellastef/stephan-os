import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT,
  runMonitorMultiplexerCanary,
  validateMonitorMultiplexerCanaryRequest,
} from './monitorMultiplexerCanary.mjs';

const HEAD = '3557023f3f27e7a1aa647400dacba0f2dae1abef';

async function workspace() {
  return mkdtemp(join(tmpdir(), 'monitor-mux-canary-'));
}

test('request validation requires a matching exact source head and bounded request id', () => {
  const valid = validateMonitorMultiplexerCanaryRequest({
    expectedHead: HEAD,
    sourceHead: HEAD,
    requestId: 'req-monitor-canary-0001',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.expectedHead, HEAD);
  assert.equal(valid.sourceHead, HEAD);

  const mismatch = validateMonitorMultiplexerCanaryRequest({
    expectedHead: HEAD,
    sourceHead: 'd65724d28a11caf7a3f4589cf0011eaf6ae0597d',
    requestId: 'req-monitor-canary-0002',
  });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.includes('EXPECTED_HEAD_MISMATCH'));

  const unsafe = validateMonitorMultiplexerCanaryRequest({
    expectedHead: HEAD,
    sourceHead: HEAD,
    requestId: '../unsafe',
  });
  assert.equal(unsafe.valid, false);
  assert.ok(unsafe.errors.includes('REQUEST_ID_INVALID'));
});

test('real canary proves 13 monitors, batching, isolation, restart, dedupe and retirement', async () => {
  const root = await workspace();
  const result = await runMonitorMultiplexerCanary({
    root,
    repoRoot: process.cwd(),
    expectedHead: HEAD,
    sourceHead: HEAD,
    requestId: 'req-monitor-canary-acceptance-0001',
    nowMs: Date.parse('2026-07-17T18:30:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_PASS');
  assert.equal(result.monitorCount, MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT);
  assert.equal(result.executedCount, MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT);
  assert.equal(result.unaffectedMonitorCount, MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT - 1);
  assert.equal(result.expectedFailureCount, 1);
  assert.equal(result.notificationBatchCount, 2);
  assert.equal(result.notificationCount, MONITOR_MULTIPLEXER_CANARY_MONITOR_COUNT);
  assert.equal(result.externalTaskSlotsRequired, 1);
  assert.equal(result.maxConcurrencyObserved, 3);
  assert.equal(result.proofWrittenToSharedWorkspace, true);
  assert.ok(Object.values(result.checks).every(Boolean));

  const outbox = (await readdir(join(root, 'outbox'))).filter((name) => name.endsWith('.json'));
  assert.equal(outbox.length, 2);
  const proof = (await readdir(join(root, 'proof'))).filter((name) => name.includes('monitor-multiplexer-canary'));
  assert.ok(proof.length >= 1);
});

test('canary blocks before execution when the deployed head is not the expected head', async () => {
  const root = await workspace();
  const result = await runMonitorMultiplexerCanary({
    root,
    repoRoot: process.cwd(),
    expectedHead: HEAD,
    sourceHead: 'd65724d28a11caf7a3f4589cf0011eaf6ae0597d',
    requestId: 'req-monitor-canary-mismatch-0001',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXPECTED_HEAD_MISMATCH');
  assert.equal(result.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_BLOCKED');
});
