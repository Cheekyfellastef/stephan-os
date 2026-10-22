import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  FORGE_LIFEBOAT_WORKER_ID,
  MISSION_CONTROLLER_ROUTE,
  forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef,
  routeMissionControllerCapacity,
} from './missionControllerCapacityRouterV1.mjs';

const NOW = '2026-09-18T20:10:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = '6e4a082e32fc3c44826fd185a7be510d29a2d7a4';

function stalledCodex() {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: '2026-09-18T20:09:00.000Z',
    remainingPercent: 0,
    availability: 'METER_STALLED',
    confidence: 'high',
    naturalResetAtUtc: '',
  };
}

function watchdogMission(overrides = {}) {
  return {
    missionId: 'critical-1291-worker-watchdog-repair',
    title: 'Repair and prove Mission Orchestrator Worker self-heal',
    repository: REPOSITORY,
    currentPhase: 'AGENT_IMPLEMENTATION',
    allowedFiles: [
      'scripts/battle-bridge-worker-watchdog.mjs',
      'scripts/battle-bridge-worker-watchdog-policy.mjs',
      'scripts/battle-bridge-worker-watchdog-runner.mjs',
      'scripts/battle-bridge-worker-watchdog-acceptance.mjs',
      'scripts/battle-bridge-worker-watchdog.test.mjs',
      'scripts/battle-bridge-worker-watchdog-policy.test.mjs',
      'scripts/battle-bridge-worker-watchdog-runner.test.mjs',
      'scripts/windows/install-battle-bridge-worker-watchdog.ps1',
      'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
      'shared/agents/battleBridgeGitHubCommandMailbox.test.mjs',
    ],
    requiredEvidence: ['focused watchdog tests', 'mailbox watchdog command contract tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
    ...overrides,
  };
}

function lane6Receipt(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'forge-lifeboat-capacity-20260918t2009z',
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
    repository: REPOSITORY,
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc: '2026-09-18T20:09:00.000Z',
    expiresAtUtc: '2026-09-18T20:14:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 3,
    authorityReceiptIds: [forgeLifeboatAuthorityReceiptId(SOURCE_HEAD)],
    proofRefs: [forgeLifeboatProofRef(SOURCE_HEAD)],
    ...overrides,
  };
}

function githubReceipt(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'github-builder-capacity-20260918t2009z',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'shared-fabric-chatgpt-github-builder-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'],
    observedAtUtc: '2026-09-18T20:09:00.000Z',
    expiresAtUtc: '2026-09-18T20:14:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 5,
    authorityReceiptIds: [],
    proofRefs: ['receipts/github-builder/capacity.json'],
    ...overrides,
  };
}

test('#1291-shaped source repair is not Windows-bound merely because it edits a PowerShell source file', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: watchdogMission(),
    codexStatus: stalledCodex(),
    forgeLaneReceipt: lane6Receipt(),
  });

  assert.equal(result.task.windowsBound, false);
  assert.equal(result.task.taskClass, 'MULTI_MODULE_IMPLEMENTATION');
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE);
  assert.equal(result.workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_FALLBACK_ROUTE_READY');
});

test('an explicit Windows runtime task remains Windows-bound and cannot leak into a source-only lane', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: watchdogMission(),
    task: { taskClass: 'WINDOWS_RUNTIME_PROOF' },
    codexStatus: stalledCodex(),
    githubLaneReceipt: githubReceipt(),
  });

  assert.equal(result.task.windowsBound, true);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes('proven-windows-capable-fallback-unavailable'));
});

test('required Windows runtime evidence still keeps the mission on a proven Windows-capable route', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: watchdogMission({ requiredEvidence: ['Windows runtime proof'] }),
    codexStatus: stalledCodex(),
    forgeLaneReceipt: lane6Receipt({ supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }),
  });

  assert.equal(result.task.windowsBound, true);
  assert.equal(result.task.taskClass, 'WINDOWS_RUNTIME_PROOF');
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
});
