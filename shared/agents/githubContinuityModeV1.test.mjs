import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_AVAILABILITY,
  BATTLE_BRIDGE_CONTINUITY_HEALTH_SCHEMA,
  CONTINUITY_TASK_DISPOSITION,
  GITHUB_CONTINUITY_STATE,
  planGitHubContinuityMode,
  validateBattleBridgeContinuityHealth,
} from './githubContinuityModeV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '000ef68d9eaed3715e87311f7d90df26a1203588';
const STALE_HEAD = 'ca519431f3c57add0dfa2e7b80a6e6b26404b111';
const NOW = '2026-08-16T15:30:00.000Z';

function health({
  availability = BATTLE_BRIDGE_AVAILABILITY.UNAVAILABLE,
  expiresAtUtc = '2026-08-16T15:35:00.000Z',
  sourceHead = HEAD,
} = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_CONTINUITY_HEALTH_SCHEMA,
    hostId: 'battle-bridge-primary',
    repository: REPOSITORY,
    observedAtUtc: '2026-08-16T15:29:00.000Z',
    expiresAtUtc,
    sourceHead,
    availability,
    capabilities: ['WINDOWS_RUNTIME', 'BATTLE_BRIDGE_CONTROL'],
    blockers: availability === BATTLE_BRIDGE_AVAILABILITY.READY ? [] : ['control-plane-unhealthy'],
    proofRefs: ['proofs/battle-bridge/continuity-health.json'],
  };
}

function githubReceipt(taskClass = 'FOCUSED_REPAIR') {
  return {
    schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
    receiptId: 'github-continuity-capacity-001',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'chatgpt-github-continuity',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: [taskClass],
    observedAtUtc: '2026-08-16T15:29:30.000Z',
    expiresAtUtc: '2026-08-16T16:00:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 3,
    authorityReceiptIds: [],
    proofRefs: ['proofs/github/continuity-capacity.json'],
  };
}

function sourceMission(id = 'source-1') {
  return {
    mission: {
      missionId: id,
      repository: REPOSITORY,
      title: 'Build source-only repair',
      currentPhase: 'REPAIR_REQUIRED',
      allowedFiles: ['shared/agents/example.mjs'],
      requiredEvidence: ['focused tests', 'hosted CI'],
    },
    task: { taskId: `${id}-task` },
  };
}

function windowsMission(id = 'windows-1') {
  return {
    mission: {
      missionId: id,
      repository: REPOSITORY,
      title: 'Prove Windows runtime',
      currentPhase: 'REPAIR_REQUIRED',
      allowedFiles: ['scripts/windows/example.ps1'],
      requiredEvidence: ['Windows runtime proof', 'Battle Bridge proof'],
    },
    task: { taskId: `${id}-task` },
  };
}

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
    battleBridgeHealth: health(),
    tasks: [sourceMission(), windowsMission()],
    codexStatus: {},
    githubLaneReceipt: githubReceipt(),
    forgeLaneReceipt: null,
    forgeSidecar: null,
    ...overrides,
  };
}

test('unavailable Battle Bridge enters continuity mode, continues source work, and holds Windows work', () => {
  const result = planGitHubContinuityMode(input());

  assert.equal(result.state, GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY);
  assert.equal(result.expectedSourceHead, HEAD);
  assert.equal(result.battleBridgeAvailability, BATTLE_BRIDGE_AVAILABILITY.UNAVAILABLE);
  assert.equal(result.recoveryHandoffRequired, true);
  assert.equal(result.recoveryGoalIssue, 1814);
  assert.equal(result.counts.continue, 1);
  assert.equal(result.counts.runtimeHold, 1);

  const source = result.tasks.find((item) => item.missionId === 'source-1');
  assert.equal(source.disposition, CONTINUITY_TASK_DISPOSITION.CONTINUE);
  assert.equal(source.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(source.dispatchAllowed, true);

  const windows = result.tasks.find((item) => item.missionId === 'windows-1');
  assert.equal(windows.disposition, CONTINUITY_TASK_DISPOSITION.HOLD_RUNTIME_RECOVERY);
  assert.equal(windows.dispatchAllowed, false);
  assert.deepEqual(windows.blockers, [
    'battle-bridge-unavailable',
    'windows-runtime-capability-unavailable',
  ]);
});

test('healthy Battle Bridge remains normal while existing capacity routing still applies', () => {
  const result = planGitHubContinuityMode(input({
    battleBridgeHealth: health({ availability: BATTLE_BRIDGE_AVAILABILITY.READY }),
    tasks: [sourceMission()],
  }));

  assert.equal(result.state, GITHUB_CONTINUITY_STATE.NORMAL);
  assert.equal(result.recoveryHandoffRequired, false);
  assert.equal(result.tasks[0].disposition, CONTINUITY_TASK_DISPOSITION.CONTINUE);
  assert.equal(result.tasks[0].route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
});

test('stale Battle Bridge health never paints the host green and still permits proven source continuity', () => {
  const stale = health({ expiresAtUtc: '2026-08-16T15:29:30.000Z' });
  const validation = validateBattleBridgeContinuityHealth(stale, {
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.current, false);
  assert.equal(validation.availability, BATTLE_BRIDGE_AVAILABILITY.UNKNOWN);

  const result = planGitHubContinuityMode(input({
    battleBridgeHealth: stale,
    tasks: [sourceMission()],
  }));
  assert.equal(result.state, GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY);
  assert.equal(result.battleBridgeAvailability, BATTLE_BRIDGE_AVAILABILITY.UNKNOWN);
  assert.equal(result.tasks[0].disposition, CONTINUITY_TASK_DISPOSITION.CONTINUE);
  assert.ok(result.blockers.includes('BATTLE_BRIDGE_CONTINUITY_HEALTH_STALE'));
});

test('READY health from an older source head is fenced as UNKNOWN and cannot restore Windows routing', () => {
  const staleSource = health({
    availability: BATTLE_BRIDGE_AVAILABILITY.READY,
    sourceHead: STALE_HEAD,
  });
  const validation = validateBattleBridgeContinuityHealth(staleSource, {
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.current, false);
  assert.equal(validation.availability, BATTLE_BRIDGE_AVAILABILITY.UNKNOWN);
  assert.equal(validation.blocker, 'BATTLE_BRIDGE_CONTINUITY_SOURCE_HEAD_MISMATCH');

  const result = planGitHubContinuityMode(input({
    battleBridgeHealth: staleSource,
    tasks: [sourceMission(), windowsMission()],
  }));
  assert.equal(result.state, GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY);
  assert.equal(result.battleBridgeAvailability, BATTLE_BRIDGE_AVAILABILITY.UNKNOWN);
  assert.equal(result.counts.continue, 1);
  assert.equal(result.counts.runtimeHold, 1);
  assert.ok(result.blockers.includes('BATTLE_BRIDGE_CONTINUITY_SOURCE_HEAD_MISMATCH'));
});

test('missing proven source capacity holds work instead of fabricating progress', () => {
  const result = planGitHubContinuityMode(input({
    tasks: [sourceMission()],
    githubLaneReceipt: null,
  }));

  assert.equal(result.state, GITHUB_CONTINUITY_STATE.DEGRADED_HOLD);
  assert.equal(result.counts.capacityHold, 1);
  assert.equal(result.tasks[0].disposition, CONTINUITY_TASK_DISPOSITION.HOLD_NO_PROVEN_CAPACITY);
  assert.equal(result.tasks[0].dispatchAllowed, false);
});

test('a running dispatch is preserved and continuity mode never steals ownership', () => {
  const mission = sourceMission('already-running');
  mission.mission.dispatch = { status: 'running', adapter: 'chatgpt-github' };

  const result = planGitHubContinuityMode(input({ tasks: [mission] }));
  assert.equal(result.tasks[0].disposition, CONTINUITY_TASK_DISPOSITION.PRESERVE_EXISTING_DISPATCH);
  assert.equal(result.tasks[0].dispatchAllowed, false);
  assert.deepEqual(result.tasks[0].blockers, ['existing-agent-dispatch-owns-mission']);
});

test('invalid host receipt is UNKNOWN, not READY', () => {
  const invalid = { ...health(), extra: true };
  const validation = validateBattleBridgeContinuityHealth(invalid, {
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.current, false);
  assert.equal(validation.availability, BATTLE_BRIDGE_AVAILABILITY.UNKNOWN);
});

test('continuity mode adds no merge, deployment, runtime, duplicate-dispatch, or protected-merge authority', () => {
  const result = planGitHubContinuityMode(input({ tasks: [sourceMission()] }));

  assert.equal(result.sourceMutationAuthorityAdded, false);
  assert.equal(result.mergeAuthorityAdded, false);
  assert.equal(result.deploymentAuthorityAdded, false);
  assert.equal(result.runtimeMutationAuthorityAdded, false);
  assert.equal(result.duplicateDispatchAllowed, false);
  assert.equal(result.protectedMergeDispatchAllowed, false);
});

test('missing canonical source head makes the continuity envelope fail closed', () => {
  const result = planGitHubContinuityMode(input({
    expectedSourceHead: '',
    tasks: [sourceMission()],
  }));
  assert.equal(result.state, GITHUB_CONTINUITY_STATE.DEGRADED_HOLD);
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_BLOCKED');
  assert.deepEqual(result.tasks, []);
});

test('oversized task inventory fails closed', () => {
  const tasks = Array.from({ length: 101 }, (_, index) => sourceMission(`source-${index}`));
  const result = planGitHubContinuityMode(input({ tasks }));

  assert.equal(result.state, GITHUB_CONTINUITY_STATE.DEGRADED_HOLD);
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_BLOCKED');
  assert.deepEqual(result.tasks, []);
});
