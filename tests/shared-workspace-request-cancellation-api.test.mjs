import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import express from 'express';
import { createSharedWorkspaceRouter, withWorkspaceReadRequest } from '../stephanos-server/routes/shared-workspace.js';
import { createSharedWorkspaceStatusRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { waitForWorkspaceRead } from '../shared/runtime/workspaceReadCancellation.mjs';

test('normal response finish does not abort and every request removes its close listener', async () => {
  for (let index = 0; index < 30; index++) {
    const res = new EventEmitter();
    res.writableEnded = false;
    let observed;
    const handler = withWorkspaceReadRequest(async (_req, response, signal) => {
      observed = signal;
      if (index % 2) {
        const waiting = waitForWorkspaceRead(new Promise(() => {}), signal);
        response.emit('close');
        await assert.rejects(waiting, { name: 'AbortError' });
      } else {
        response.writableEnded = true;
        response.emit('close');
        assert.equal(signal.aborted, false);
      }
    });
    await handler({}, res);
    assert.equal(observed.aborted, Boolean(index % 2));
    assert.equal(res.listenerCount('close'), 0);
  }
});

test('real hydration and dashboard disconnects skip JSON serialization and leave later readers usable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-disconnect-'));
  await mkdir(join(root, 'status'));
  await Promise.all(Array.from({ length: 256 }, (_, index) => writeFile(join(root, 'status', `record-${index}.json`), JSON.stringify(createSharedWorkspaceStatusRecord({
    statusId: `record-${index}`, timestampUtc: new Date().toISOString(), status: 'CURRENT',
  })))));
  let accepted = 0, allAccepted, serializedAfterClose = 0;
  const acceptedEight = new Promise(resolve => { allAccepted = resolve; });
  const app = express();
  app.use((_req, res, next) => {
    accepted++;
    if (accepted === 8) allAccepted();
    const json = res.json.bind(res);
    res.json = value => { if (res.destroyed) serializedAfterClose++; return json(value); };
    next();
  });
  app.use('/api/shared-workspace', createSharedWorkspaceRouter({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd() }));
  const server = app.listen(0, '127.0.0.1');
  const controller = new AbortController();
  let guard;
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/api/shared-workspace`;
    const calls = Array.from({ length: 8 }, (_, index) => fetch(origin + (index % 2 ? '/dashboard-feed' : '/hydrate?workspace=flywheel&datasets=dashboard'), { signal: controller.signal })
      .then(response => response.text()).then(() => 'completed', error => error.name));
    await Promise.race([acceptedEight, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('requests not admitted')), 5000); })]);
    clearTimeout(guard);
    controller.abort();
    assert.deepEqual(await Promise.all(calls), Array(8).fill('AbortError'));
    await setImmediate();
    const response = await fetch(origin + '/hydrate?workspace=flywheel&datasets=dashboard', { signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.datasets.dashboard.payload.records.statusRecords.length, 256);
    assert.equal(body.datasets.dashboard.payload.recordScope, 'full-history');
    await setImmediate();
    assert.equal(serializedAfterClose, 0, 'abandoned consumers must never reach Express JSON serialization');
  } finally {
    clearTimeout(guard); controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
