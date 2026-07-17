import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONITOR_MODES,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
  buildMonitorMultiplexerContract,
  classifyMonitorDue,
  createMonitorRegistry,
  runMonitorMultiplexerTick,
  validateMonitorDefinition,
} from './monitorMultiplexer.mjs';

async function workspace() {
  return mkdtemp(join(tmpdir(), 'monitor-mux-'));
}

function monitor(index, overrides = {}) {
  return {
    monitorId: `monitor-${index}`,
    handlerId: `handler-${index}`,
    mode: MONITOR_MODES.RECURRING,
    intervalMs: 30_000,
    nextDueUtc: '2026-07-17T12:00:00.000Z',
    relatedIssue: '#1290',
    summary: `Monitor ${index}`,
    ...overrides,
  };
}

test('registry rejects arbitrary command and path authority', () => {
  const validation = validateMonitorDefinition({
    ...monitor(1),
    command: 'whoami',
    nested: { path: '/tmp/unsafe' },
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('|'), /forbidden-definition-key/);

  const registry = createMonitorRegistry([monitor(1), monitor(1)]);
  assert.equal(registry.ok, false);
  assert.match(registry.errors.join('|'), /duplicate-monitor-id/);
});

test('contract multiplexes many monitors through one notification surface', () => {
  const contract = buildMonitorMultiplexerContract({ intervalMs: 1 });
  assert.equal(contract.intervalMs, 30_000);
  assert.equal(contract.notificationSurface, MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE);
  assert.equal(contract.externalTaskSlotsRequired, 1);
  assert.equal(contract.independentFailureIsolation, true);
  assert.equal(contract.arbitraryShellAllowed, false);
  assert.equal(contract.arbitraryPowerShellAllowed, false);
});

test('twelve independent monitors publish one deduplicated notification batch', async () => {
  const root = await workspace();
  const monitors = Array.from({ length: 12 }, (_, index) => monitor(index + 1));
  const handlers = Object.fromEntries(monitors.map((item) => [item.handlerId, async () => ({
    state: 'PASS',
    summary: `${item.monitorId} passed`,
    proofRefs: [`proof/${item.monitorId}.json`],
  })]));

  const result = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.registry.monitorCount, 12);
  assert.equal(result.executions.length, 12);
  assert.equal(result.notificationRecord.itemCount, 12);
  assert.equal(result.notificationRecord.notificationSurface, MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE);
  assert.equal(result.notificationRecord.externalTaskSlotsRequired, 1);
  assert.equal(result.registryStatus.independentFailureIsolation, true);
  assert.equal(result.registryStatus.restartResumeSupported, true);
  assert.equal(result.registryStatus.oneShotRetirementSupported, true);

  const outbox = await readdir(join(root, 'outbox'));
  assert.equal(outbox.length, 1);
  const registry = JSON.parse(await readFile(join(root, 'status', 'monitor-multiplexer-registry.json'), 'utf8'));
  assert.equal(registry.monitorCount, 12);
  assert.equal(registry.externalTaskSlotsRequired, 1);
});

test('one handler failure does not stop the other monitors', async () => {
  const root = await workspace();
  const monitors = Array.from({ length: 10 }, (_, index) => monitor(index + 1));
  const handlers = Object.fromEntries(monitors.map((item, index) => [item.handlerId, async () => {
    if (index === 4) throw new Error('unsafe local detail');
    return {
      state: 'PASS',
      summary: `${item.monitorId} passed`,
      proofRefs: [`proof/${item.monitorId}.json`],
    };
  }]));

  const result = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.executions.length, 10);
  assert.equal(result.executions.filter((item) => item.result.state === 'PASS').length, 9);
  assert.equal(result.executions.filter((item) => item.result.state === 'FAIL').length, 1);
  assert.equal(result.registryStatus.failedCount, 1);
});

test('restart reads durable state and suppresses duplicate notifications', async () => {
  const root = await workspace();
  const monitors = [monitor(1)];
  const handlers = {
    'handler-1': async () => ({
      state: 'PASS',
      summary: 'stable pass',
      proofRefs: ['proof/monitor-1.json'],
    }),
  };

  const first = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });
  assert.equal(first.notificationRecord.itemCount, 1);

  const second = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:30.000Z'),
  });
  assert.equal(second.executions[0].statusRecord.runCount, 2);
  assert.equal(second.notificationRecord, null);

  const outbox = await readdir(join(root, 'outbox'));
  assert.equal(outbox.length, 1);
});

test('one-shot monitor retires after its terminal result and does not run again', async () => {
  const root = await workspace();
  let calls = 0;
  const monitors = [monitor(1, { mode: MONITOR_MODES.ONE_SHOT })];
  const handlers = {
    'handler-1': async () => {
      calls += 1;
      return {
        state: 'PASS',
        summary: 'one shot complete',
        proofRefs: ['proof/monitor-1.json'],
      };
    },
  };

  const first = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });
  assert.equal(first.executions[0].statusRecord.retired, true);

  const second = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T13:00:00.000Z'),
  });
  assert.equal(calls, 1);
  assert.equal(second.executions.length, 0);
  assert.equal(second.skipped[0].due.reason, 'MONITOR_RETIRED');
});

test('due classification uses persisted next due and retirement state', () => {
  const definition = createMonitorRegistry([monitor(1)]).monitors[0];
  assert.equal(classifyMonitorDue(definition, null, {
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  }).due, true);
  assert.equal(classifyMonitorDue(definition, {
    nextDueUtc: '2026-07-17T13:00:00.000Z',
  }, {
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  }).due, false);
  assert.equal(classifyMonitorDue(definition, {
    retired: true,
  }, {
    nowMs: Date.parse('2026-07-17T14:00:00.000Z'),
  }).reason, 'MONITOR_RETIRED');
});
