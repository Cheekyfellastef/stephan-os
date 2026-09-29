import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { createSharedWorkspaceRouter } from '../stephanos-server/routes/shared-workspace.js';

test('Goal Dashboard shared workspace feed is never browser-cacheable', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'goal-dashboard-cache-control-'));
  const app = express();
  app.use('/api/shared-workspace', createSharedWorkspaceRouter({
    env: {
      HOME: home,
      USERPROFILE: home,
      STEPHANOS_SHARED_AGENT_WORKSPACE: join(home, 'missing-workspace'),
    },
    repoRoot: process.cwd(),
  }));

  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/shared-workspace/dashboard-feed`);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
});
