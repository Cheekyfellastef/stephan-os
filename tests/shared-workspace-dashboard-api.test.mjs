import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharedWorkspaceRouter from '../stephanos-server/routes/shared-workspace.js';
import { readBackendSharedWorkspaceDashboardFeed } from '../stephanos-server/services/sharedWorkspaceDashboardFeedService.js';
import { startBattleBridgePublisherLoopForBackend } from '../stephanos-server/services/battleBridgePublisherLifecycle.js';

async function tempDir() { return mkdtemp(join(tmpdir(), 'stephanos-backend-shared-workspace-')); }

function dashboardLayer() {
  return sharedWorkspaceRouter.stack.find((entry) => entry.route?.path === '/dashboard-feed');
}

test('backend dashboard feed adapter returns exact unavailable state without dumping env', async () => {
  const payload = await readBackendSharedWorkspaceDashboardFeed({ env: {}, repoRoot: process.cwd() });
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'SHARED_WORKSPACE_PATH_UNCONFIGURED');
  assert.equal(payload.workspaceRoot, 'UNKNOWN');
  assert.equal(payload.exactNextAction, 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.');
  assert.equal(JSON.stringify(payload).includes('SECRET'), false);
});

test('backend dashboard feed route uses read-only adapter and maps unavailable to 503', async () => {
  const layer = dashboardLayer();
  let statusCode = 200;
  let payload = null;
  const original = process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  delete process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  try {
    await layer.route.stack[0].handle({}, { status(code) { statusCode = code; return this; }, json(value) { payload = value; } });
  } finally {
    if (original === undefined) delete process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
    else process.env.STEPHANOS_SHARED_AGENT_WORKSPACE = original;
  }
  assert.equal(statusCode, 503);
  assert.equal(payload.route, '/api/shared-workspace/dashboard-feed');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.state, 'unavailable');
});

test('backend dashboard feed adapter reads existing workspace without creating dashboard writes', async () => {
  const root = await tempDir();
  for (const dir of ['goals', 'status', 'proof', 'capabilities', 'events']) await mkdir(join(root, dir), { recursive: true });
  const payload = await readBackendSharedWorkspaceDashboardFeed({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd(), nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(payload.route, '/api/shared-workspace/dashboard-feed');
  assert.equal(payload.backendAdapter, 'shared-workspace-dashboard-feed-reader');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'NO_WORKSPACE_RECORDS');
});

test('backend startup publisher loop only starts for existing configured workspace and remains stoppable', async () => {
  const blocked = await startBattleBridgePublisherLoopForBackend({ env: {}, repoRoot: process.cwd(), runImmediately: false });
  assert.equal(blocked.started, false);
  assert.equal(blocked.stop().finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_NOT_STARTED');

  const root = await tempDir();
  const started = await startBattleBridgePublisherLoopForBackend({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd(), runImmediately: false, intervalMs: 30_000 });
  assert.equal(started.started, true);
  assert.equal(started.workspaceRoot, root);
  assert.equal(started.stop().finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_STOPPED');
});
