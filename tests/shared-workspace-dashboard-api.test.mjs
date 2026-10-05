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
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceGoalRecord,
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
      statusId: 'workspace-ready',
      timestampUtc: NOW,
      relatedIssue: '#1290',
      status: 'CURRENT',
      summary: '#1290 Shared Workspace current',
      proofRefs: ['proof/status'],
    }),
  });

  await writeJson(root, 'proof', 'proof-1290.json', {
    ...createSharedWorkspaceProofRecord({
      proofId: 'workspace-proof',
      timestampUtc: NOW,
      correlationId: 'verification-run',
      relatedIssue: '#1290',
      status: 'PASS',
      summary: '#1290 proof current',
      proofRefs: ['proof/shared-workspace'],
      refs: ['proof/shared-workspace'],
    }),
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
  let responseHeaders = {};

  await layer.route.stack[0].handle(
    {},
    {
      set(headers) {
        responseHeaders = { ...responseHeaders, ...headers };
        return this;
      },
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
  assert.equal(responseHeaders['Cache-Control'], 'no-store, no-cache, must-revalidate');
  assert.equal(responseHeaders.Pragma, 'no-cache');
  assert.equal(responseHeaders.Expires, '0');
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

test('backend dashboard feed remains responsive when optional GitHub telemetry stalls', async () => {
  const context = await isolatedContext();
  const root = await readyWorkspace();
  const startedAt = Date.now();

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: {
      ...context.env,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'bounded-token',
      STEPHANOS_SHARED_AGENT_WORKSPACE: root,
    },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
    liveGoalProjectionOptions: {
      githubTelemetryOptions: {
        fetchImpl: async () => new Promise(() => {}),
        requestTimeoutMs: 20,
      },
    },
  });

  assert.equal(Date.now() - startedAt < 500, true);
  assert.equal(payload.state, 'ready');
  assert.equal(payload.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'CURRENT');
  assert.equal(payload.livePortfolio.state, 'ready');
  assert.equal(payload.projection.portfolioSource, 'BASE_PROJECTION_FALLBACK');
  assert.equal(payload.projection.liveGithubPrCount, 0);
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


test('dashboard feed full-history query stays read-only and requests historical records', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../stephanos-server/routes/shared-workspace.js', import.meta.url), 'utf8'));
  assert.match(source, /router\.get\('\/dashboard-feed'/);
  assert.match(source, /req\.query\?\.scope/);
  assert.match(source, /requestedScope === 'full-history'/);
  assert.match(source, /recordScope/);
  assert.match(source, /Cache-Control/);
});


test('full-history backend projection exposes latest closed-loop learning state while current-state stays bounded', async () => {
  const context = await isolatedContext();
  const root = await readyWorkspace();
  await writeJson(root, 'events', 'capability-gap.json', createSharedWorkspaceEventRecord({
    eventId: 'capability-gap',
    participantId: 'sovereign-commander',
    timestampUtc: NOW,
    eventKind: 'capability-gap',
    summary: 'Product surface discovery gap.',
    capabilityFailure: {
      failureClass: 'CAPABILITY_GAP',
      genuineCapabilityFailure: true,
      capabilityId: 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION',
      targetRefs: ['stephanos-ui/src'],
    },
  }));

  const current = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
  });
  assert.equal(current.recordScope, 'current-state');
  assert.equal(current.projection.closedLoopLearning, null);

  const full = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
    recordScope: 'full-history',
  });
  assert.equal(full.recordScope, 'full-history');
  assert.equal(full.projection.closedLoopLearning.state, 'TEACHING_REQUIRED');
  assert.equal(full.projection.closedLoopLearning.teacherId, 'openclaw-local');

  const flywheelSource = await import('node:fs/promises')
    .then(({ readFile }) => readFile(new URL('../stephanos-ui/src/components/FlywheelPanel.jsx', import.meta.url), 'utf8'));
  assert.match(flywheelSource, /dashboard-feed\?scope=full-history/);
});


test('backend dashboard feed overlays Sovereign build truth onto complete live goal cards', async () => {
  const context = await isolatedContext();
  const root = await readyWorkspace();
  await writeJson(root, 'goals', 'goal-2002.json', createSharedWorkspaceGoalRecord({
    goalId: 'goal-2002',
    participantId: 'mission-scheduler',
    timestampUtc: NOW,
    relatedIssue: '#2002',
    title: 'Stephanos Goal Building Agent',
    status: 'ACTIVE',
    summary: 'Autonomous builder goal is active.',
    nextAction: 'Continue autonomous build.',
  }));
  await writeJson(root, 'status', 'stephanos-build-truth-current.json', {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'stephanos-build-truth-current',
      participantId: 'sovereign-commander',
      timestampUtc: NOW,
      relatedIssue: '#2002',
      status: 'BUILDING',
      summary: 'Stephanos foreman BUILDING.',
    }),
    stephanosBuildTruth: {
      schemaVersion: 'stephanos.sovereign-build-truth.v1',
      observedAtUtc: NOW,
      state: 'BUILDING',
      trafficLight: 'GREEN',
      autonomous: true,
      activeGoalCount: 1,
      buildingGoalCount: 1,
      activeMaterialLaneCount: 1,
      targetMaterialLaneCount: 15,
      lastMaterialProgressAtUtc: NOW,
      blockers: [],
      nextAction: 'Continue autonomous building.',
      goals: [{
        issue: '#2002',
        title: 'Stephanos Goal Building Agent',
        state: 'BUILDING',
        controllerId: 'controller-1',
        controllerTitle: 'Stephanos Autonomous Goal Builder',
        logicalLaneId: 'logical-goal-2002',
        builder: 'mission-worker-1',
        currentPhase: 'SOURCE_CHANGED',
        lastMaterialProgressAtUtc: NOW,
        prNumber: 2800,
        proofRefs: ['proof/build-2002'],
        blocker: '',
        nextAction: 'Run focused tests.',
        autonomous: true,
      }],
    },
  });

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: { ...context.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: context.repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
    liveProjection: null,
  });
  const card = payload.projection.goals.find((goal) => goal.issue === '#2002');
  assert.equal(payload.projection.stephanosBuildTruth.state, 'BUILDING');
  assert.equal(card.buildState, 'BUILDING');
  assert.equal(card.buildTrafficLight, 'GREEN');
  assert.equal(card.autonomous, true);
  assert.equal(card.controllerTitle, 'Stephanos Autonomous Goal Builder');
  assert.equal(card.logicalLaneId, 'logical-goal-2002');
  assert.equal(card.builder, 'mission-worker-1');
  assert.equal(card.prNumber, 2800);
});
