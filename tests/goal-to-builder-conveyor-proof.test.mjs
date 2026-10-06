import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildSchedulerGoalsFromProgrammeSources,
} from '../shared/agents/programmeAuthorityV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createSharedWorkspaceReceiptRecord,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { buildMissionScheduler } from '../shared/runtime/missionScheduler.mjs';
import { planElasticGoalMissionAdmissions } from '../stephanos-server/services/elasticGoalMissionAdmissionService.js';
import {
  appendMissionEvent,
  createMissionRecord,
  readMissionRecord,
} from '../stephanos-server/services/missionOrchestratorStore.js';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
  routeWithQualifiedOpenClawProvider,
} from '../shared/agents/openClawProviderPoolQualificationV1.mjs';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readExecutionReceiptHistory,
  toSharedWorkspaceExecutionReceipt,
} from '../shared/agents/executionReceiptV1.mjs';
import { dispatchElasticGoalBuilds } from '../stephanos-server/services/criticalBacklogConveyorServiceCore.js';
import { readMissionWorkerQueue } from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import { processNextOpenClawLocalItem } from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';

const NOW = '2026-10-06T13:45:00.000Z';
const SOURCE_HEAD = 'a'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PRIMARY = 7001;
const SECONDARY = 7002;

const proof = (requirement, receiptId) => ({
  receiptId,
  requirement,
  source: 'goal-to-builder-conveyor-proof',
  evidenceType: 'command-output',
  verified: true,
  exitCode: 0,
});

function goalRecord(issueNumber, priority, sourcePath) {
  return {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL,
    goalId: `goal-${issueNumber}`,
    participantId: 'stephanos',
    timestampUtc: NOW,
    issueNumber,
    repository: REPOSITORY,
    title: `Conveyor proof goal ${issueNumber}`,
    status: 'READY',
    prerequisites: [],
    resourceIds: [`repo:cheekyfellastef/stephan-os:path:${sourcePath}`],
    route: 'OPENCLAW_LOCAL',
    priority,
    criticalPathWeight: 10,
    reversibility: 'HIGH',
    evidenceAt: NOW,
  };
}

function qualificationReceipt() {
  return {
    schemaVersion: OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
    qualificationId: 'conveyor-openclaw-qualification',
    authorityReceiptId: 'conveyor-openclaw-authority',
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    state: 'PRODUCTION_ELIGIBLE',
    providerInstance: 'battle-bridge-openclaw-01',
    providerVersion: 'openclaw-qualified-v1',
    sourceHead: SOURCE_HEAD,
    realWorkTaskId: 'conveyor-openclaw-real-task',
    realWorkReceiptId: 'conveyor-openclaw-real-receipt',
    observedAtUtc: '2026-10-06T13:44:00.000Z',
    expiresAtUtc: '2026-10-06T13:59:00.000Z',
    codexRequired: false,
    proofRefs: ['receipts/openclaw/conveyor-real-work.json'],
  };
}

function openClawCapacityReceipt() {
  return {
    schemaVersion: OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
    receiptId: 'conveyor-openclaw-capacity',
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    workerId: 'battle-bridge-openclaw-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    observedAtUtc: '2026-10-06T13:44:00.000Z',
    expiresAtUtc: '2026-10-06T13:59:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 2,
    qualificationIds: ['conveyor-openclaw-qualification'],
    qualificationAuthorityReceiptId: 'conveyor-openclaw-authority',
    proofRefs: ['receipts/openclaw/conveyor-capacity.json'],
  };
}

function trustedOpenClawHostContext() {
  const qualification = qualificationReceipt();
  const realWorkExecutionReceipt = createExecutionReceipt({
    receiptId: qualification.realWorkReceiptId,
    repository: REPOSITORY,
    issueNumber: 1725,
    prNumber: 0,
    branch: 'agent/openclaw-conveyor-qualification',
    sourceHead: SOURCE_HEAD,
    workerId: qualification.providerInstance,
    workerType: 'openclaw',
    executionId: qualification.realWorkTaskId,
    leaseKey: qualification.realWorkTaskId,
    state: 'completed',
    phase: 'FOCUSED_REPAIR',
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc: '2026-10-06T13:43:30.000Z',
    heartbeatExpiresAtUtc: '2026-10-06T13:45:30.000Z',
    blocker: '',
    operatorActionRequired: false,
    proofRefs: qualification.proofRefs,
    expectedNextAction: '',
  });
  const workspace = toSharedWorkspaceExecutionReceipt(realWorkExecutionReceipt);
  assert.equal(workspace.ok, true);
  const authority = createSharedWorkspaceReceiptRecord({
    receiptId: qualification.authorityReceiptId,
    participantId: 'stephanos',
    timestampUtc: qualification.observedAtUtc,
    correlationId: qualification.qualificationId,
    relatedIssue: '1725',
    relatedPr: '',
    proofRefs: qualification.proofRefs,
    receivedRecordId: realWorkExecutionReceipt.receiptId,
    disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
    summary: `Stephanos qualifies ${qualification.providerInstance} ${qualification.providerVersion} for ${qualification.taskClass} at ${qualification.sourceHead} from OpenClaw execution ${qualification.realWorkReceiptId}.`,
  });
  return {
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
    qualificationReceipt: qualification,
    capacityReceipt: openClawCapacityReceipt(),
    realWorkExecutionReceipt,
    realWorkWorkspaceReceipt: workspace.record,
    qualificationAuthorityReceipt: authority,
  };
}

test('canonical goal reaches an OpenClaw Local builder with every handoff proven', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'goal-builder-conveyor-'));
  const home = join(temp, 'home');
  const repoRoot = join(temp, 'repo');
  const workspaceRoot = join(temp, 'workspace');
  const orchestratorRoot = join(temp, 'orchestrator');
  const snapshotRoot = join(temp, 'snapshots');
  const queueRoot = join(temp, 'worker-queue');
  const worktreeRoot = join(home, 'Stephanos', 'worktrees');
  await Promise.all([
    mkdir(repoRoot, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(orchestratorRoot, { recursive: true }),
    mkdir(snapshotRoot, { recursive: true }),
    mkdir(queueRoot, { recursive: true }),
    mkdir(worktreeRoot, { recursive: true }),
  ]);
  const env = {
    USERPROFILE: home,
    STEPHANOS_MISSION_WORKER_QUEUE_DIR: queueRoot,
  };
  const goalRecords = [
    goalRecord(PRIMARY, 100, 'shared/agents/conveyor-primary.mjs'),
    goalRecord(SECONDARY, 10, 'shared/agents/conveyor-secondary.mjs'),
  ];
  const ctx = {};

  await t.test('1 -> 2 canonical goal record hydrates with identity and scope preserved', () => {
    ctx.hydrated = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      goalRecords,
    });
    assert.equal(ctx.hydrated.valid, true);
    assert.equal(ctx.hydrated.hydrationProof.proven, true);
    const receipt = ctx.hydrated.hydrationProof.receipts.find((item) => item.canonicalIssueNumber === PRIMARY);
    assert.ok(receipt);
    assert.equal(receipt.identityPreserved, true);
    assert.equal(receipt.resourceScopePreserved, true);
    assert.equal(receipt.hydratedIssueNumber, PRIMARY);
    assert.deepEqual(ctx.hydrated.goals.find((goal) => goal.issue === PRIMARY).resourceIds, goalRecords[0].resourceIds);
  });

  await t.test('2 -> 3 hydrated goal enters eligibility and becomes READY', () => {
    ctx.scheduler = buildMissionScheduler({
      now: NOW,
      availableExecutorSlots: 8,
      goals: ctx.hydrated.goals,
      correlationId: 'goal-builder-conveyor-proof',
    });
    assert.equal(ctx.scheduler.failClosed, false);
    assert.equal(ctx.scheduler.portfolio.find((goal) => goal.issue === PRIMARY).lifecycle, 'READY');
  });

  await t.test('3 -> 4 priority ranking selects the intended goal', () => {
    assert.equal(ctx.scheduler.selectedGoal, `#${PRIMARY}`);
    assert.equal(ctx.scheduler.decisionReceipt.selectedIssue, PRIMARY);
    assert.deepEqual(ctx.scheduler.parallelCandidates.slice(0, 2), [`#${PRIMARY}`, `#${SECONDARY}`]);
  });

  await t.test('4 -> 5 scheduler selection materialises an exact mission packet', () => {
    ctx.admission = planElasticGoalMissionAdmissions(ctx.scheduler, [], {
      env,
      repoRoot,
      worktreeRoot,
      goalRecords,
    });
    assert.equal(ctx.admission.ok, true);
    ctx.primaryAdmission = ctx.admission.admitted.find((item) => item.issueNumber === PRIMARY);
    assert.ok(ctx.primaryAdmission);
    assert.equal(ctx.primaryAdmission.missionId, `critical-${PRIMARY}-elastic-goal`);
    assert.equal(ctx.primaryAdmission.missionInput.repository, REPOSITORY);
    assert.equal(ctx.primaryAdmission.missionInput.branch, `openclaw/elastic-goal-${PRIMARY}`);
    assert.ok(ctx.primaryAdmission.missionInput.allowedFiles.includes('shared/agents/conveyor-primary.mjs'));
  });

  await t.test('5 -> 6 scheduler capacity admits the materialised mission', () => {
    assert.ok(ctx.admission.admitted.some((item) => item.issueNumber === PRIMARY));
    assert.ok(ctx.admission.remainingAdmissionSlots > 0);
    assert.equal(ctx.admission.classification, 'ELASTIC_GOAL_ADMISSIONS_READY');
  });

  await t.test('6 -> 7 durable flywheel controller becomes canonical mission owner', async () => {
    ctx.created = await createMissionRecord(ctx.primaryAdmission.missionInput, {
      root: orchestratorRoot,
      snapshotRoot,
      env,
      now: new Date(NOW),
      createdBy: 'durable-flywheel-controller',
    });
    assert.equal(ctx.created.state.missionId, ctx.primaryAdmission.missionId);
    assert.equal(ctx.created.state.storeMetadata.createdBy, 'durable-flywheel-controller');
  });

  await t.test('7 -> 8 lane selection preserves the same goal/mission identity', async () => {
    ctx.ready = await appendMissionEvent(ctx.created.state.missionId, {
      eventId: 'conveyor-worktree-ready',
      eventType: 'WORKTREE_READY',
      worktreePath: ctx.primaryAdmission.missionInput.worktreePath,
      clean: true,
      receipt: proof('isolated worktree', 'conveyor-worktree-proof'),
    }, {
      root: orchestratorRoot,
      snapshotRoot,
      env,
      now: new Date(NOW),
    });
    assert.equal(ctx.ready.state.currentPhase, 'AGENT_IMPLEMENTATION');
    assert.equal(ctx.ready.state.missionId, `critical-${PRIMARY}-elastic-goal`);
  });

  await t.test('8 -> 9 resource conflict check rejects a conflicting second lane', () => {
    const conflictingGoals = ctx.hydrated.goals.map((goal) => ({
      ...goal,
      resourceIds: ['repo:cheekyfellastef/stephan-os:path:shared/agents/shared-target.mjs'],
    }));
    const conflictScheduler = buildMissionScheduler({
      now: NOW,
      availableExecutorSlots: 8,
      goals: conflictingGoals,
    });
    assert.equal(conflictScheduler.failClosed, false);
    assert.equal(conflictScheduler.parallelCandidates.length, 1);
    assert.ok(conflictScheduler.parallelHeld.some((item) => item.reasonCode === 'RESOURCE_CONFLICT'));
  });

  await t.test('9 -> 10 capacity check consumes fresh qualified provider capacity', () => {
    ctx.route = routeWithQualifiedOpenClawProvider({
      nowUtc: NOW,
      sourceHead: SOURCE_HEAD,
      mission: ctx.ready.state,
      task: {
        taskId: 'goal-builder-conveyor-route',
        taskClass: 'FOCUSED_REPAIR',
        preferredProviderRoute: 'OPENCLAW_LOCAL',
      },
      codexStatus: null,
    }, trustedOpenClawHostContext());
    assert.equal(ctx.route.openClawCapacity.valid, true);
    assert.equal(ctx.route.dispatchAllowed, true);
  });

  await t.test('10 -> 11 builder qualification is backed by completed real-work authority', () => {
    assert.equal(ctx.route.openClawQualification.valid, true);
    assert.equal(ctx.route.openClawQualificationAuthority.valid, true);
    assert.equal(ctx.route.openClawPoolEligible, true);
  });

  await t.test('11 -> 12 builder router selects OpenClaw Local', () => {
    assert.equal(ctx.route.route, 'OPENCLAW_LOCAL');
    assert.equal(ctx.route.adapter, 'openclaw-local');
    assert.equal(ctx.route.workerId, 'battle-bridge-openclaw-01');
    assert.equal(ctx.route.finalVerdict, 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY');
  });

  await t.test('12 -> 13 exact work packet is created for the selected builder', async () => {
    ctx.ignition = await dispatchElasticGoalBuilds({
      desiredWidth: 5,
      selectedMission: ctx.ready.state,
      activeMissions: [],
      runnableMissions: [ctx.ready.state],
    }, {
      env,
      now: new Date(NOW),
      sourceRevision: SOURCE_HEAD,
      paths: {
        repoRoot,
        workspaceRoot,
        orchestratorRoot,
        snapshotRoot,
      },
      resolveCapacityCandidates: () => [{
        route: ctx.route.route,
        adapter: ctx.route.adapter,
        workerId: ctx.route.workerId,
        receiptId: ctx.route.selectedCapacityReceiptId,
        proofRefs: ctx.route.proofRefs,
        queueDepth: ctx.route.openClawCapacity.receipt.queueDepth,
        p95StartLatencySeconds: ctx.route.openClawCapacity.receipt.p95StartLatencySeconds,
      }],
    });
    assert.equal(ctx.ignition.ok, true);
    assert.equal(ctx.ignition.dispatchCount, 1);
    ctx.queue = await readMissionWorkerQueue({ env, queueRoot });
    assert.equal(ctx.queue.length, 1);
    ctx.queueItem = ctx.queue[0].item;
    assert.equal(ctx.queueItem.missionId, ctx.ready.state.missionId);
    assert.equal(ctx.queueItem.payload.actionKind, 'agent-handoff');
    assert.equal(ctx.queueItem.payload.adapter, 'openclaw-local');
  });

  await t.test('13 -> 14 SELECT binds mission, action, provider and capacity receipt', () => {
    const grant = ctx.queueItem.actionGrant;
    assert.equal(grant.controllerId, 'durable-flywheel-controller');
    assert.equal(grant.missionId, ctx.ready.state.missionId);
    assert.equal(grant.actionId, ctx.queueItem.actionId);
    assert.equal(grant.adapter, 'openclaw-local');
    assert.equal(grant.capacityReceiptId, ctx.route.selectedCapacityReceiptId);
    assert.equal(grant.issueNumber, PRIMARY);
    ctx.grant = grant;
  });

  await t.test('14 -> 16 dispatch publication is pending, never falsely running', async () => {
    assert.equal(ctx.queueItem.handoffResponsibility.state, 'PICKUP_PENDING');
    assert.equal(ctx.queueItem.handoffResponsibility.pickupProofRequired, true);
    assert.equal(ctx.queueItem.handoffResponsibility.publicationIsTerminal, false);
    const pending = (await readMissionRecord(ctx.ready.state.missionId, {
      root: orchestratorRoot,
      snapshotRoot,
      env,
    })).state;
    assert.equal(pending.dispatch.status, 'pending');
  });

  await t.test('16 -> 17 provider bridge targets the OpenClaw Local execution surface', () => {
    assert.equal(ctx.ignition.dispatched[0].adapter, 'openclaw-local');
    assert.equal(ctx.ignition.dispatched[0].handoffState, 'PICKUP_PENDING');
    assert.equal(ctx.ignition.dispatched[0].responsibilityRetained, true);
  });

  await t.test('17 -> 15 durable execution binding reserves one exact claim identity', async () => {
    const binding = ctx.queueItem.executionBinding;
    assert.equal(binding.executionId, ctx.grant.actionId);
    assert.equal(binding.grantId, ctx.grant.grantId);
    assert.equal(binding.missionId, ctx.grant.missionId);
    assert.equal(binding.issueNumber, PRIMARY);
    assert.equal(binding.sourceRevision, SOURCE_HEAD);
    ctx.queuedReceipt = createExecutionReceipt({
      repository: binding.repository,
      issueNumber: binding.issueNumber,
      prNumber: binding.prNumber || 0,
      branch: binding.branch,
      sourceHead: binding.headSha || binding.sourceRevision,
      workerId: ctx.grant.workerId,
      workerType: 'openclaw',
      executionId: binding.executionId,
      leaseKey: binding.leaseKey,
      state: 'queued',
      phase: 'pre-pr-dispatch-queued',
      sequence: 1,
      timestampUtc: '2026-10-06T13:45:01.000Z',
      proofRefs: ctx.grant.capacityProofRefs,
      expectedNextAction: 'OpenClaw Local may atomically claim this exact execution.',
    });
    const appended = await appendExecutionReceipt(workspaceRoot, ctx.queuedReceipt, { repoRoot });
    assert.equal(appended.ok, true);
  });

  await t.test('15 -> 18 atomic pending-to-processing claim proves worker pickup', async () => {
    let executorInvoked = false;
    ctx.processed = await processNextOpenClawLocalItem({
      root: orchestratorRoot,
      snapshotRoot,
      queueRoot,
      sharedWorkspaceRoot: workspaceRoot,
      repoRoot,
      env,
      now: new Date('2026-10-06T13:45:02.000Z'),
      actionGrant: ctx.grant,
      executeOpenClawLocalAction: async () => {
        const activeHistory = await readExecutionReceiptHistory(
          workspaceRoot,
          {
            executionId: ctx.queueItem.executionBinding.executionId,
            leaseKey: ctx.queueItem.executionBinding.leaseKey,
            expectedHead: SOURCE_HEAD,
          },
          { repoRoot },
        );
        assert.equal(activeHistory.ok, true);
        assert.equal(activeHistory.latestReceipt.state, 'progress');
        assert.ok(activeHistory.receipts.some((receipt) => receipt.state === 'started'));
        executorInvoked = true;
        return {
          success: true,
          changedFiles: [],
          receipt: proof('openclaw local result', 'conveyor-openclaw-result'),
          evidenceReceipts: [proof('openclaw local execution evidence', 'conveyor-openclaw-evidence')],
          completedAt: '2026-10-06T13:45:03.000Z',
        };
      },
    });
    assert.equal(executorInvoked, true);
    assert.equal(ctx.processed.processed, true);
    assert.equal(ctx.processed.claim.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  });

  await t.test('18 -> 19 pickup acknowledgement has an accepted/started/progress receipt chain', async () => {
    ctx.history = await readExecutionReceiptHistory(
      workspaceRoot,
      {
        executionId: ctx.queueItem.executionBinding.executionId,
        leaseKey: ctx.queueItem.executionBinding.leaseKey,
        expectedHead: SOURCE_HEAD,
      },
      { repoRoot },
    );
    assert.equal(ctx.history.ok, true);
    const states = ctx.history.receipts.map((receipt) => receipt.state);
    assert.deepEqual(states.slice(0, 4), ['queued', 'accepted', 'started', 'progress']);
  });

  await t.test('19 -> 20 builder execution starts only after started truth exists', () => {
    const states = ctx.history.receipts.map((receipt) => receipt.state);
    assert.ok(states.includes('started'));
    assert.ok(states.includes('progress'));
    assert.equal(ctx.processed.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE');
  });
});
