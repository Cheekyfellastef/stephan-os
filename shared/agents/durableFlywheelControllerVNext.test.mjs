import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  reconcileDurableFlywheelController,
  renderDurableFlywheelReceipt,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA } from './missionControllerCapacityRouterV1.mjs';

const NOW = '2026-07-30T13:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const LANE_HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const LANE_ID = 'goal-1497-pr-1617';
const BRANCH = 'feat/durable-flywheel-controller-vnext';

function projection(status = 'IDLE', overrides = {}) {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status,
    finalVerdict: status === 'HOLD'
      ? 'AUTHORITATIVE_PROGRAMME_PROJECTION_HOLD'
      : 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: null,
    mutationLease: null,
    projectionReceipt: {
      schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
      receiptId: 'programme-projection-20260730130000',
      status,
      chatMemoryAuthoritative: false,
      sourceConstructionMode: 'production-contracts',
      mergeAuthority: false,
      workerAuthorityOwnedByController: false,
      schedulerAuthorityOwnedByController: false,
      boundedMutationStepsPerCycle: 1,
    },
    ...overrides,
  };
}

function activeProjection(overrides = {}) {
  return projection('ACTIVE', {
    lane: {
      valid: true,
      active: true,
      terminal: false,
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 1497,
      prNumber: 1617,
      branch: BRANCH,
      headSha: LANE_HEAD,
    },
    mutationLease: {
      leaseId: 'lease-goal-1497-pr-1617',
      ownerId: 'mission-worker',
    },
    criticalBacklog: {
      activeMission: {
        missionId: 'critical-1497-controller-test',
        revision: 4,
        currentPhase: 'CHECK_PULL_REQUEST',
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617, headSha: LANE_HEAD },
      },
    },
    ...overrides,
  });
}

function machineryFor(authoritativeProjection, overrides = {}) {
  const heartbeats = [];
  const receipts = [];
  return {
    heartbeats,
    receipts,
    machinery: {
      publishControllerHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ok: true };
      },
      loadAuthoritativeProjection: async () => authoritativeProjection,
      publishReceipt: async (receipt) => {
        receipts.push(receipt);
        return { ok: true };
      },
      ensureBacklogMission: async () => ({
        ok: true,
        createdMission: false,
        projection: {
          activeMission: {
            missionId: 'critical-1497-controller-test',
            revision: 0,
            currentPhase: 'LIVE_RUNTIME_INVESTIGATION',
            repository: REPOSITORY,
          },
        },
      }),
      finalizeTerminalLane: async () => ({ ok: true }),
      ...overrides,
    },
  };
}

test('production canonical ACTIVE projection authorizes one existing worker tick', async () => {
  const fixture = machineryFor(activeProjection());
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.action, 'ADVANCE_EXISTING_ACTIVE_LANE');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.boundedMutationSteps, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.deepEqual(
    fixture.heartbeats.map(({ cycleState }) => cycleState),
    ['STARTING', 'ACTIVE_LANE', 'ACTIVE_LANE'],
  );
  assert.equal(result.workerActionGrant.missionId, 'critical-1497-controller-test');
  assert.equal(result.workerActionGrant.actionId.includes('critical-1497-controller-test'), true);
  assert.equal(result.workerActionGrant.boundedActionCount, 1);
  assert.equal(fixture.receipts.length, 1);
  assert.equal(fixture.receipts[0].repository, REPOSITORY);
  assert.equal(fixture.receipts[0].prNumber, 1617);
  assert.equal(fixture.receipts[0].headSha, LANE_HEAD);
});

test('ACTIVE source work receives one exact proven fallback grant when Codex capacity is low', async () => {
  const sourceMission = {
    missionId: 'critical-1497-controller-test',
    revision: 4,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: 'Repair controller routing',
    repository: REPOSITORY,
    operatorIntent: 'Repair the bounded controller route.',
    intendedOutcome: 'The route is proven by focused tests.',
    allowedFiles: ['shared/agents/controller.mjs'],
    requiredTests: ['node --test shared/agents/controller.test.mjs'],
    requiredEvidence: ['focused tests'],
    providerRouteIntent: 'CHATGPT_GITHUB',
    dispatch: { adapter: 'codex', status: 'pending' },
    git: { branch: BRANCH, worktreePath: '/bounded/worktree' },
  };
  const fixture = machineryFor(activeProjection({
    criticalBacklog: { activeMission: sourceMission },
  }), {
    loadCapacityRoutingInput: async () => ({
      nowUtc: NOW,
      codexStatus: {
        schemaVersion: 'shared-agent-workspace-record.v1',
        statusId: 'codex-capacity-current',
        truthState: 'CURRENT',
        meterTruthUsable: true,
        observedAtUtc: NOW,
        remainingPercent: 3,
        availability: 'AVAILABLE',
        confidence: 'high',
      },
      githubLaneReceipt: {
        schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
        receiptId: 'github-builder-capacity-controller-test',
        route: 'CHATGPT_GITHUB',
        repository: REPOSITORY,
        workerId: 'shared-fabric-chatgpt-github-builder-01',
        state: 'READY',
        supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
        supportedTaskClasses: ['FOCUSED_REPAIR'],
        observedAtUtc: NOW,
        expiresAtUtc: '2026-07-30T13:15:00.000Z',
        queueDepth: 0,
        p95StartLatencySeconds: 15,
        authorityReceiptIds: [],
        proofRefs: ['receipts/github-builder/capacity.json'],
      },
    }),
  });
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.workerActionGrant.adapter, 'chatgpt-github');
  assert.equal(result.workerActionGrant.providerRouteIntent, 'CHATGPT_GITHUB');
  assert.equal(result.workerActionGrant.capacityRoute, 'CHATGPT_GITHUB');
  assert.equal(result.workerActionGrant.capacityReceiptId, 'github-builder-capacity-controller-test');
  assert.deepEqual(result.workerActionGrant.capacityProofRefs, ['receipts/github-builder/capacity.json']);
  assert.equal(result.workerActionGrant.mergeAuthority, false);
  assert.equal(result.workerActionGrant.leaseSeizureAllowed, false);
});

test('provider AUTO intent binds the capacity-selected route while explicit intent rejects substitution', async () => {
  const sourceMission = {
    missionId: 'critical-1497-provider-intent-test',
    revision: 4,
    currentPhase: 'AGENT_IMPLEMENTATION',
    title: 'Repair provider intent routing',
    repository: REPOSITORY,
    operatorIntent: 'Repair the bounded provider route.',
    intendedOutcome: 'The provider selection is exactly bound.',
    allowedFiles: ['shared/agents/provider-intent.mjs'],
    requiredTests: ['node --test shared/agents/provider-intent.test.mjs'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
    git: { branch: BRANCH, worktreePath: '/bounded/worktree' },
  };
  const codexCapacity = {
    nowUtc: NOW,
    codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1',
      statusId: 'codex-capacity-current',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      observedAtUtc: NOW,
      remainingPercent: 100,
      availability: 'AVAILABLE',
      confidence: 'high',
    },
  };
  const run = (providerRouteIntent) => {
    const fixture = machineryFor(activeProjection({
      criticalBacklog: {
        selectedItem: { mission: { providerRouteIntent } },
        activeMission: { ...sourceMission, providerRouteIntent },
      },
    }), { loadCapacityRoutingInput: async () => codexCapacity });
    return runDurableFlywheelStartupCycle(fixture.machinery, {
      nowUtc: NOW,
      sourceRevision: SOURCE_REVISION,
      env: {},
    });
  };

  const automatic = await run('AUTO');
  assert.equal(automatic.status, 'ACTIVE');
  assert.equal(automatic.workerActionGrant.providerRouteIntent, 'AUTO');
  assert.equal(automatic.workerActionGrant.capacityRoute, 'CODEX');

  const substituted = await run('CHATGPT_GITHUB');
  assert.equal(substituted.status, 'HOLD');
  assert.ok(substituted.blockers.includes('mission-worker:exact-action-grant-unavailable'));
});

test('READY projection continues the already-active backlog mission with one exact native worktree grant', async () => {
  const activeMission = {
    missionId: 'critical-1291-worker-watchdog-repair',
    revision: 1,
    currentPhase: 'CREATE_WORKTREE',
    title: 'Repair and prove Mission Orchestrator Worker self-heal',
    repository: REPOSITORY,
    repositoryRoot: 'C:\\repo',
    baseBranch: 'main',
    allowedFiles: ['shared/agents/**'],
    git: {
      branch: 'openclaw/critical-1291-worker-watchdog-repair',
      worktreePath: 'C:\\worktree',
    },
  };
  const fixture = machineryFor(projection('READY', {
    scheduler: { selectedGoal: '#1291', decisionReceipt: { selectedIssue: 1291 } },
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      activeMission,
    },
  }), {
    ensureBacklogMission: async () => ({
      ok: true,
      createdMission: false,
      projection: {
        decision: 'WAIT_ACTIVE_MISSION',
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
        activeMission,
      },
    }),
    loadCapacityRoutingInput: async () => null,
  });
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  assert.equal(result.status, 'READY', JSON.stringify(result));
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.workerActionGrant.missionId, activeMission.missionId);
  assert.equal(result.workerActionGrant.currentPhase, 'CREATE_WORKTREE');
  assert.equal(result.workerActionGrant.adapter, 'openclaw-signed');
  assert.equal(result.workerActionGrant.operation, 'create-worktree');
  assert.match(result.nextAction, /continue the conveyor-authorized mission/i);
});

test('canonical HOLD projection preserves authority blockers and forbids work', async () => {
  const fixture = machineryFor(projection('HOLD', {
    blockers: [
      'lane:github-merge-evidence-incomplete',
      'execution:sourceHead mismatch',
      'critical-backlog-active-lane-pr-mismatch',
    ],
  }));
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.deepEqual(result.blockers, [
    'authoritative-programme-reconciliation-blocked',
    'authority:lane:github-merge-evidence-incomplete',
    'authority:execution:sourceHead mismatch',
    'authority:critical-backlog-active-lane-pr-mismatch',
  ]);
  assert.deepEqual(
    fixture.heartbeats.map(({ cycleState }) => cycleState),
    ['STARTING', 'HOLD'],
  );
});

test('non-production, memory-authoritative, malformed, and unknown projections fail closed', () => {
  const cases = [
    [
      projection('IDLE', { schemaVersion: 'legacy.parallel-authority.v1' }),
      'authoritative-programme-projection-schema-mismatch',
    ],
    [
      projection('IDLE', { sourceConstructionMode: 'deterministic-testing-seam' }),
      'authoritative-programme-projection-not-production-constructed',
    ],
    [
      projection('IDLE', { chatMemoryAuthoritative: true }),
      'chat-memory-authority-not-explicitly-disabled',
    ],
    [
      projection('UNRECOGNIZED'),
      'authoritative-programme-status-invalid',
    ],
    [
      null,
      'authoritative-programme-projection-invalid',
    ],
  ];

  for (const [candidate, expectedBlocker] of cases) {
    const result = reconcileDurableFlywheelController(candidate, {
      nowUtc: NOW,
      sourceRevision: SOURCE_REVISION,
    });
    assert.equal(result.status, 'HOLD');
    assert.equal(result.allowWorkerTick, false);
    assert.ok(result.blockers.includes(expectedBlocker));
  }
});

test('explicit observation time and exact source revision are mandatory', () => {
  const missingTime = reconcileDurableFlywheelController(
    projection('IDLE', { observedAtUtc: undefined }),
    {
    sourceRevision: SOURCE_REVISION,
    },
  );
  assert.ok(missingTime.blockers.includes('controller-observation-time-invalid'));

  const missingRevision = reconcileDurableFlywheelController(projection(), {
    nowUtc: NOW,
  });
  assert.ok(missingRevision.blockers.includes('controller-source-revision-invalid'));
  assert.equal(missingRevision.allowWorkerTick, false);
});

test('invalid startup source revision publishes a durable HOLD without touching authority services', async () => {
  let authorityCalls = 0;
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    publishControllerHeartbeat: async () => {
      authorityCalls += 1;
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      authorityCalls += 1;
      return projection();
    },
    publishReceipt: async (receipt) => {
      receipts.push(receipt);
      return { ok: true };
    },
  }, {
    nowUtc: NOW,
    sourceRevision: 'not-a-sha',
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(authorityCalls, 0);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].action, 'HOLD');
});

test('IDLE waits without mutation and renders its authority posture', async () => {
  const fixture = machineryFor(projection('IDLE'));
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  const rendered = renderDurableFlywheelReceipt(result);

  assert.equal(result.status, 'IDLE');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(result.boundedMutationSteps, 0);
  assert.match(rendered, /Status: IDLE/);
  assert.match(rendered, /Worker-Tick-Allowed: false/);
  assert.match(rendered, /Merge-Authority: false/);
  assert.match(rendered, /Lease-Seizure-Allowed: false/);
  assert.match(rendered, /Blockers: none/);
});
