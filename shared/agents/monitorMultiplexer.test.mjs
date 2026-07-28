import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MONITOR_MODES,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
  buildMonitorMultiplexerContract,
  classifyMonitorDue,
  createMonitorMultiplexerTestStorageAdapter,
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

test('registry rejects arbitrary command, camel-case target and duplicate authority', () => {
  for (const unsafe of [
    { command: 'whoami' },
    { nested: { path: '/tmp/unsafe' } },
    { targetPath: 'somewhere' },
    { sourceUrl: 'https://example.invalid' },
    { commandLine: 'run this' },
  ]) {
    const validation = validateMonitorDefinition({ ...monitor(1), ...unsafe });
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('|'), /forbidden-definition-key/);
  }

  assert.equal(validateMonitorDefinition({ ...monitor(1), relatedIssue: '1290' }).valid, false);
  assert.equal(validateMonitorDefinition({ ...monitor(1), monitorId: `m${'x'.repeat(60)}` }).valid, false);

  const registry = createMonitorRegistry([monitor(1), monitor(1)]);
  assert.equal(registry.ok, false);
  assert.match(registry.errors.join('|'), /duplicate-monitor-id/);
});

test('contract multiplexes many monitors through one bounded notification surface', () => {
  const contract = buildMonitorMultiplexerContract({ intervalMs: 1, concurrency: 500 });
  assert.equal(contract.intervalMs, 30_000);
  assert.equal(contract.notificationSurface, MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE);
  assert.equal(contract.externalTaskSlotsRequired, 1);
  assert.equal(contract.concurrency, 16);
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
  assert.equal(result.notificationRecords.length, 1);
  assert.equal(result.notificationRecord.itemCount, 12);
  assert.equal(result.notificationRecord.notificationSurface, MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE);
  assert.equal(result.notificationRecord.externalTaskSlotsRequired, 1);
  assert.equal(result.registryStatus.restartResumeSupported, true);

  const outbox = await readdir(join(root, 'outbox'));
  assert.equal(outbox.length, 1);
  const registry = JSON.parse(await readFile(join(root, 'status', 'monitor-multiplexer-registry.json'), 'utf8'));
  assert.equal(registry.monitorCount, 12);
  assert.equal(registry.externalTaskSlotsRequired, 1);
});

test('twenty-five simultaneous notifications are bounded into one outbox surface', async () => {
  const root = await workspace();
  const monitors = Array.from({ length: 25 }, (_, index) => monitor(index + 1));
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
  assert.deepEqual(result.notificationRecords.map((record) => record.itemCount), [12, 12, 1]);
  assert.equal(result.registryStatus.notificationCount, 25);
  assert.equal(result.registryStatus.notificationBatchCount, 3);
  assert.equal(result.registryStatus.externalTaskSlotsRequired, 1);
  for (const record of result.notificationRecords) {
    assert.ok(Buffer.byteLength(record.body, 'utf8') < 16 * 1024);
  }
  assert.equal((await readdir(join(root, 'outbox'))).length, 3);
});

test('bounded concurrency limits simultaneous handler execution', async () => {
  const root = await workspace();
  const monitors = Array.from({ length: 8 }, (_, index) => monitor(index + 1));
  let active = 0;
  let maximum = 0;
  const handlers = Object.fromEntries(monitors.map((item) => [item.handlerId, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
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
    concurrency: 2,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(maximum, 2);
  assert.equal(result.registryStatus.maxConcurrency, 2);
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
  assert.equal(result.executions.filter((item) => item.result.state === 'PASS').length, 9);
  assert.equal(result.executions.filter((item) => item.result.state === 'FAIL').length, 1);
  assert.equal(result.registryStatus.failedCount, 1);
});

test('failed outbox write cannot durably suppress the pending notification', async () => {
  const root = await workspace();
  const monitors = [monitor(1)];
  const handlers = {
    'handler-1': async () => ({
      state: 'PASS',
      summary: 'stable pass',
      proofRefs: ['proof/monitor-1.json'],
    }),
  };
  const testStorageAdapter = createMonitorMultiplexerTestStorageAdapter({
    recordKind: 'notification-outbox',
    occurrence: 1,
  });

  const first = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    testStorageAdapter,
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });
  assert.equal(first.ok, false);
  assert.equal(first.finalVerdict, 'MONITOR_MULTIPLEXER_PUBLISH_BLOCKED');
  assert.equal(first.receipt.fingerprintCommitted, false);
  await assert.rejects(readFile(join(root, 'status', 'monitor-monitor-1.json'), 'utf8'));

  const second = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:01.000Z'),
  });
  assert.equal(second.ok, true);
  assert.equal(second.notificationRecord.itemCount, 1);

  const third = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers,
    nowMs: Date.parse('2026-07-17T12:00:31.000Z'),
  });
  assert.equal(third.ok, true);
  assert.equal(third.notificationRecord, null);
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
  assert.equal((await readdir(join(root, 'outbox'))).length, 1);
});

test('invalid persisted state is ignored rather than trusted', async () => {
  const root = await workspace();
  const monitors = [monitor(1)];
  await mkdir(join(root, 'status'), { recursive: true });
  await writeFile(
    join(root, 'status', 'monitor-monitor-1.json'),
    JSON.stringify({ monitorId: 'monitor-1', retired: true }),
  );
  let calls = 0;

  const result = await runMonitorMultiplexerTick({
    root,
    repoRoot: process.cwd(),
    monitors,
    handlers: {
      'handler-1': async () => {
        calls += 1;
        return {
          state: 'PASS',
          summary: 'ran',
          proofRefs: ['proof/monitor-1.json'],
        };
      },
    },
    nowMs: Date.parse('2026-07-17T12:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
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
