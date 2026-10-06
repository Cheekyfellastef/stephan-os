// Acceptance proof: a terminal builder exit must release, close, refill, and reach the next real pickup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA } from '../shared/agents/programmeAuthorityV1.mjs';
import { runDurableFlywheelStartupCycle } from '../shared/agents/durableFlywheelControllerVNext.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA } from '../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  appendMissionEvent,
  createMissionRecord,
  readMissionRecord,
} from '../stephanos-server/services/missionOrchestratorStore.js';
import { publishNextMissionWorkerAction } from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import { claimNextMissionWorkerItem } from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';

const NOW = '2026-10-06T15:30:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const TERMINAL_HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OLD_GOAL = 7201;
const NEXT_GOAL = 7202;
const OLD_LANE_ID = 'goal-7201-pr-8201';
const OLD_LEASE_ID = 'lease-goal-7201-pr-8201';

const proof = (requirement, receiptId) => ({
  receiptId,
  requirement,
  source: 'goal-completion-refill-proof',
  evidenceType: 'command-output',
  verified: true,
  exitCode: 0,
});

function projection(status, overrides = {}) {
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
      receiptId: `programme-projection-${status.toLowerCase()}`,
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

function terminalProjection() {
  return projection('TERMINAL_RECONCILIATION_REQUIRED', {
    lane: {
      valid: true,
      active: false,
      terminal: true,
      laneId: OLD_LANE_ID,
      repository: REPOSITORY,
      issueNumber: OLD_GOAL,
      prNumber: 8201,
      branch: 'fix/goal-7201',
      headSha: TERMINAL_HEAD,
    },
    mutationLease: {
      leaseId: OLD_LEASE_ID,
      laneId: OLD_LANE_ID,
      repository: REPOSITORY,
      issueNumber: OLD_GOAL,
      prNumber: 8201,
      branch: 'fix/goal-7201',
      headSha: TERMINAL_HEAD,
      ownerId: 'mission-worker',
    },
  });
}

function closeProjection() {
  return projection('IDLE', {
    goalClosurePlan: {
      state: 'READY',
      request: {
        schemaVersion: 'stephanos.goal-closure-request.v1',
        issueNumber: OLD_GOAL,
      },
    },
  });
}

function nextReadyProjection() {
  return projection('READY', {
    scheduler: {
      selectedGoal: NEXT_GOAL,
      decisionReceipt: { selectedIssue: NEXT_GOAL },
    },
    criticalBacklog: {
      decision: 'CREATE_NEXT_MISSION',
      selectedItem: { issueNumbers: [NEXT_GOAL] },
    },
  });
}

test('COMPLETED proof releases the old lane, closes the goal, refills, and the next builder claims work', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'goal-completion-refill-proof-'));
  const options = {
    root: join(parent, 'state'),
    snapshotRoot: join(parent, 'proof'),
    queueRoot: join(parent, 'queue'),
    sharedWorkspaceRoot: join(parent, 'workspace'),
  };

  const missionId = 'critical-7202-autonomous-refill';
  await createMissionRecord({
    missionId,
    operatorIntent: 'Continue autonomously with the next eligible bounded goal.',
    intendedOutcome: 'The next selected goal reaches a real builder processing claim.',
    missionKind: 'implementation',
    repository: REPOSITORY,
    repositoryRoot: 'C:\\repo',
    branch: 'openclaw/critical-7202-autonomous-refill',
    worktreePath: 'C:\\worktree\\critical-7202-autonomous-refill',
    allowedFiles: ['shared/agents/example.mjs'],
    requiredEvidence: ['focused test output'],
    requiredTests: ['node --test focused.test.mjs'],
  }, options);

  const readyMission = await appendMissionEvent(missionId, {
    eventId: 'next-goal-worktree-ready',
    eventType: 'WORKTREE_READY',
    worktreePath: 'C:\\worktree\\critical-7202-autonomous-refill',
    clean: true,
    receipt: proof('isolated worktree', 'next-goal-worktree-proof'),
  }, options);

  let phase = 'terminal';
  const finalizations = [];
  const closures = [];
  const admissions = [];
  const controllerReceipts = [];

  const machinery = {
    publishControllerHeartbeat: async () => ({ ok: true }),
    publishReceipt: async (receipt) => {
      controllerReceipts.push(receipt);
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      if (phase === 'terminal') return terminalProjection();
      if (phase === 'close') return closeProjection();
      return nextReadyProjection();
    },
    finalizeTerminalLane: async (identity) => {
      finalizations.push(identity);
      phase = 'close';
      return {
        ok: true,
        finalized: true,
        releaseOnlyExactLease: true,
        schedulesWork: false,
        mergeAuthority: false,
        reason: 'TERMINAL_LANE_FINALIZED',
      };
    },
    closeReadyGoal: async (programmeProjection) => {
      closures.push(programmeProjection.goalClosurePlan.request.issueNumber);
      phase = 'ready';
      return {
        state: 'CLOSED_COMPLETED',
        stateReason: 'completed',
        repository: REPOSITORY,
        issueNumber: OLD_GOAL,
        resultProofRefs: ['receipts/execution/goal-7201-completed.json'],
        reusableCapabilityId: 'CAPABILITY_AUTONOMOUS_REFILL_V1',
        sharedLessonId: 'LESSON_TERMINAL_RELEASE_THEN_REFILL',
      };
    },
    ensureBacklogMission: async () => {
      admissions.push(NEXT_GOAL);
      return {
        ok: true,
        createdMission: true,
        classification: 'WAIT_ACTIVE_MISSION',
        projection: {
          decision: 'WAIT_ACTIVE_MISSION',
          selectedItem: {
            issueNumbers: [NEXT_GOAL],
            mission: readyMission.state,
          },
          activeMission: readyMission.state,
        },
      };
    },
    loadCapacityRoutingInput: async () => ({
      nowUtc: NOW,
      codexStatus: null,
      githubLaneReceipt: {
        schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
        receiptId: 'github-autonomous-refill-capacity',
        route: 'CHATGPT_GITHUB',
        repository: REPOSITORY,
        workerId: 'shared-fabric-chatgpt-github-builder-01',
        state: 'READY',
        supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
        supportedTaskClasses: ['FOCUSED_REPAIR'],
        observedAtUtc: '2026-10-06T15:29:00.000Z',
        expiresAtUtc: '2026-10-06T15:40:00.000Z',
        queueDepth: 0,
        p95StartLatencySeconds: 10,
        authorityReceiptIds: [],
        proofRefs: ['receipts/github-builder/autonomous-refill-capacity.json'],
      },
      forgeLaneReceipt: null,
      forgeSidecar: null,
    }),
  };

  const terminal = await runDurableFlywheelStartupCycle(machinery, {
    ...options,
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  assert.equal(terminal.status, 'TERMINAL_RECONCILIATION_REQUIRED');
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].leaseId, OLD_LEASE_ID);
  assert.equal(finalizations[0].laneId, OLD_LANE_ID);
  assert.equal(terminal.actionResult.releaseOnlyExactLease, true);

  const closure = await runDurableFlywheelStartupCycle(machinery, {
    ...options,
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  assert.deepEqual(closures, [OLD_GOAL]);
  assert.equal(closure.action, 'CLOSE_CANONICAL_GOAL');
  assert.equal(closure.goalClosureResult.state, 'CLOSED_COMPLETED');
  assert.deepEqual(
    closure.goalClosureResult.resultProofRefs,
    ['receipts/execution/goal-7201-completed.json'],
  );

  const refill = await runDurableFlywheelStartupCycle(machinery, {
    ...options,
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  assert.deepEqual(admissions, [NEXT_GOAL]);
  assert.equal(refill.status, 'READY');
  assert.equal(refill.allowWorkerTick, true);
  assert.equal(refill.workerActionGrant.missionId, missionId);
  assert.equal(refill.workerActionGrant.issueNumber, NEXT_GOAL);
  assert.equal(refill.workerActionGrant.adapter, 'chatgpt-github');
  assert.equal(refill.workerActionGrant.capacityRoute, 'CHATGPT_GITHUB');
  assert.equal(refill.workerActionGrant.mergeAuthority, false);
  assert.equal(refill.workerActionGrant.leaseSeizureAllowed, false);

  const dispatch = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: refill.workerActionGrant,
  });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, 'chatgpt-github');
  assert.equal(dispatch.handoffResponsibility.state, 'PICKUP_PENDING');

  const pickup = await claimNextMissionWorkerItem('chatgpt-github', {
    ...options,
    actionGrant: refill.workerActionGrant,
  });
  assert.ok(pickup);
  assert.equal(pickup.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.equal(
    (await readMissionRecord(missionId, options)).state.dispatch.status,
    'running',
  );

  assert.ok(controllerReceipts.length >= 4);
});
