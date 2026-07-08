import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedWorkspaceRouter } from '../stephanos-server/routes/shared-workspace.js';
import { readBackendSharedWorkspaceDashboardFeed } from '../stephanos-server/services/sharedWorkspaceDashboardFeedService.js';
import { startBattleBridgePublisherLoopForBackend } from '../stephanos-server/services/battleBridgePublisherLifecycle.js';
import {
  createAgentCapabilityRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

const NOW = '2026-07-07T00:00:00.000Z';

async function tempDir(prefix = 'stephanos-backend-shared-workspace-') {
  return mkdtemp(join(tmpdir(), prefix));
}

async function isolatedContext() {
  const home = await tempDir('stephanos-backend-api-home-');
  const repoRoot = await tempDir('stephanos-backend-api-repo-');
  return {
    home,
    repoRoot,
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: '',
    },
  };
}

async function writeJson(root, directory, name, record) {
  await writeFile(join(root, directory, name), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

async function emptyWorkspace() {
  const root = await tempDir('stephanos-backend-api-empty-workspace-');
  for (const dir of ['goals', 'status', 'proof', 'capabilities', 'events']) {
    await mkdir(join(root, dir), { recursive: true });
  }
  return root;
}

async function readyWorkspace() {
  const root = await emptyWorkspace();

  await writeJson(root, 'status', 'status-1290.json', {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'status-1290',
      timestampUtc: NOW,
      status: 'CURRENT',
      summary: '#1290 Shared Workspace current',
      proofRefs: ['proof/status'],
    }),
    relatedGoal: '#1290',
  });

  await writeJson(root, 'proof', 'proof-1290.json', {
    ...createSharedWorkspaceProofRecord({
      proofId: 'proof-1290',
      timestampUtc: NOW,
      status: 'PASS',
      summary: '#1290 proof current',
      refs: ['proof/shared-workspace'],
    }),
    relatedGoal: '#1290',
  });

  await writeJson(root, 'capabilities', 'openclaw.json', {
    ...createAgentCapabilityRecord({
      agentId: 'openclaw',
      timestampUtc: NOW,
      proofRefs: ['proof/capability'],
    }),
    relatedGoal: '#1284 #1286',
  });

  return root;
}

function dashboardLayer(input = {}) {
  return createSharedWorkspaceRouter(input).stack.find((entry) => entry.route?.path === '/dashboard-feed');
}

test('backend dashboard feed adapter returns exact unavailable state without dumping env', async () => {
  const context = await isolatedContext();
  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: context.env,
    repoRoot: context.repoRoot,
  });

  const serialized = JSON.stringify(payload);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'SHARED_WORKSPACE_PATH_UNCONFIGURED');
  assert.equal(payload.workspaceRoot, 'UNKNOWN');
  assert.equal(payload.exactNextAction, 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.');
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes(context.home), false);
});

test('backend dashboard feed redacts missing configured workspace root', async () => {
  const context = await isolatedContext();
  const missingRoot = join(context.home, 'Documents', 'Stephanos-openclaw-workspace');

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: missingRoot },
    repoRoot: context.repoRoot,
  });

  const serialized = JSON.stringify(payload);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_MISSING');
  assert.equal(payload.workspaceRoot, 'UNKNOWN');
  assert.equal(serialized.includes(missingRoot), false);
  assert.equal(serialized.includes(context.home), false);
});

test('backend dashboard feed route uses read-only adapter and maps unavailable to 503', async () => {
  const context = await isolatedContext();
  const layer = dashboardLayer({
    env: context.env,
    repoRoot: context.repoRoot,
  });

  let statusCode = 200;
  let payload = null;

  await layer.route.stack[0].handle(
    {},
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(value) {
        payload = value;
      },
    },
  );

  assert.equal(statusCode, 503);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'SHARED_WORKSPACE_PATH_UNCONFIGURED');
});

test('backend dashboard feed adapter reads existing empty workspace without creating dashboard writes', async () => {
  const context = await isolatedContext();
  const root = await emptyWorkspace();

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
  });

  assert.equal(payload.route, '/api/shared-workspace/dashboard-feed');
  assert.equal(payload.backendAdapter, 'shared-workspace-dashboard-feed-reader');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'NO_WORKSPACE_RECORDS');
});

test('backend dashboard feed adapter reads existing ready workspace records', async () => {
  const context = await isolatedContext();
  const root = await readyWorkspace();

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
  });

  assert.equal(payload.route, '/api/shared-workspace/dashboard-feed');
  assert.equal(payload.backendAdapter, 'shared-workspace-dashboard-feed-reader');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.state, 'ready');
  assert.equal(payload.workspaceRoot, root);
  assert.equal(payload.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'CURRENT');
});

test('backend startup publisher loop only starts for existing configured workspace and remains stoppable', async () => {
  const context = await isolatedContext();

  const blocked = await startBattleBridgePublisherLoopForBackend({
    env: context.env,
    repoRoot: context.repoRoot,
    runImmediately: false,
  });

  assert.equal(blocked.started, false);
  assert.equal(blocked.reason, 'SHARED_WORKSPACE_PATH_UNCONFIGURED');
  assert.equal(blocked.stop().finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_NOT_STARTED');

  const missingRoot = join(context.home, 'missing-workspace');
  const missing = await startBattleBridgePublisherLoopForBackend({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: missingRoot },
    repoRoot: context.repoRoot,
    runImmediately: false,
  });

  assert.equal(missing.started, false);
  assert.equal(missing.reason, 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_MISSING');
  assert.equal(missing.workspaceRoot, 'UNKNOWN');

  const root = await emptyWorkspace();
  const started = await startBattleBridgePublisherLoopForBackend({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    runImmediately: false,
    intervalMs: 30_000,
  });

  assert.equal(started.started, true);
  assert.equal(started.workspaceRoot, root);
  assert.equal(started.stop().finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_STOPPED');
});
