import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import express from 'express';
import { createSharedWorkspaceRouter } from '../stephanos-server/routes/shared-workspace.js';
import { createSharedWorkspaceStatusRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';

test('actual Flywheel and Goal Dashboard HTTP routes deliver local data while GitHub stalls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shared-feed-deadline-'));
  await mkdir(join(root, 'status'));
  await writeFile(join(root, 'status', 'current.json'), JSON.stringify(createSharedWorkspaceStatusRecord({
    statusId: 'local-current', timestampUtc: new Date().toISOString(), status: 'CURRENT',
  })));
  const originalFetch = globalThis.fetch;
  const previousWorkspace = process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  process.env.STEPHANOS_SHARED_AGENT_WORKSPACE = root;
  let calls = 0;
  let release;
  let started;
  const upstreamStarted = new Promise(resolve => { started = resolve; });
  // This file runs in its own Node test process. Block external I/O and use a
  // fixture token; leave the production router/service/overlay path intact.
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.github\.com\//);
    calls += 1;
    started();
    return new Promise((_, reject) => {
      release = () => reject(new Error('fixture upstream unavailable'));
      options.signal.addEventListener('abort', release, { once: true });
    });
  };
  const app = express();
  app.use('/api/shared-workspace', createSharedWorkspaceRouter({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root, GITHUB_REPOSITORY: 'fixture/repo', GITHUB_TOKEN: 'fixture-only' },
    repoRoot: process.cwd(),
  }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const flywheelRequest = originalFetch(`${origin}/api/shared-workspace/hydrate?workspace=flywheel&datasets=dashboard`, { signal: AbortSignal.timeout(8000) });
    let guard;
    try {
      await Promise.race([upstreamStarted, new Promise((_, reject) => {
        guard = setTimeout(() => reject(new Error('real overlay did not reach the fixture upstream')), 3000);
      })]);
    } finally { clearTimeout(guard); }
    const dashboard = await originalFetch(`${origin}/api/shared-workspace/dashboard-feed`, { signal: AbortSignal.timeout(8000) });
    const dashboardData = await dashboard.json();
    const flywheel = await flywheelRequest;
    const flywheelData = (await flywheel.json()).datasets.dashboard.payload;
    for (const [response, feed] of [[dashboard, dashboardData], [flywheel, flywheelData]]) {
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal(feed.state, 'ready');
      assert.equal(feed.records.statusRecords[0].statusId, 'local-current');
      assert.equal(feed.livePortfolio.state, 'unavailable');
      assert.equal(feed.livePortfolio.source, 'BASE_PROJECTION_FALLBACK');
    }
    assert.equal(dashboardData.livePortfolio.reason, 'LIVE_PROJECTION_READ_IN_PROGRESS');
    assert.equal(flywheelData.livePortfolio.reason, 'LIVE_PROJECTION_DEADLINE_EXCEEDED');
    assert.equal(flywheelData.recordScope, 'full-history');
    assert.equal(dashboardData.recordScope, 'current-state');
    assert.equal(calls, 1, 'the second route must not start another stalled optional read');
  } finally {
    release?.();
    await setImmediate();
    globalThis.fetch = originalFetch;
    if (previousWorkspace === undefined) delete process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
    else process.env.STEPHANOS_SHARED_AGENT_WORKSPACE = previousWorkspace;
    await new Promise(resolve => server.close(resolve));
  }
});
