import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionReceipt } from './executionReceiptV1.mjs';
import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
  CANONICAL_IMPLEMENTATION_LANE_SCHEMA,
  PROGRAMME_AUTHORITY_COMPONENTS,
  PROGRAMME_CONTROLLER_HEARTBEAT_SCHEMA,
  PROGRAMME_STALL_MONITOR_HANDLER_ID,
  PROGRAMME_STALL_MONITOR_ID,
  SOURCE_MUTATION_LEASE_SCHEMA,
  buildAuthoritativeProgrammeProjection,
  buildCanonicalImplementationLaneProjection,
  buildProgrammeStallMonitorDefinition,
  buildSchedulerGoalsFromProgrammeSources,
  buildTerminalLaneFinalizationPlan,
  createProgrammeControllerHeartbeat,
  createProgrammeStallMonitorHandler,
  createSourceMutationLeaseRecord,
  createTerminalLaneEvidenceRecords,
  diagnoseProgrammeStall,
  projectProgrammeControllerHeartbeat,
  renewSourceMutationLeaseRecord,
  validateExecutionReceiptAgainstMutationLease,
  validateSourceMutationLease,
} from './programmeAuthorityV1.mjs';
import { MONITOR_MULTIPLEXER_SCHEMA_VERSION } from './monitorMultiplexer.mjs';
import {
  MISSION_WORKER_HEARTBEAT_SCHEMA,
  createMissionWorkerHeartbeatRecord,
  projectMissionWorkerHeartbeat,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

const NOW = '2026-07-30T10:00:00.000Z';
const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const LANE_ID = 'goal-1497-pr-1617';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/canonical-programme-authority-contracts';
const OWNER = 'codex-pr-1617';

function github(overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 1617,
    headSha: HEAD,
    headBranch: BRANCH,
    prState: 'open',
    merged: false,
    mergedAt: '',
    mergeCommitSha: '',
    ...overrides,
  };
}

function lease(overrides = {}) {
  return createSourceMutationLeaseRecord({
    leaseId: 'lease-goal-1497-pr-1617',
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: BRANCH,
    headSha: HEAD,
    ownerId: OWNER,
    acquiredAtUtc: '2026-07-30T09:30:00.000Z',
    expiresAtUtc: '2026-07-30T11:30:00.000Z',
    proofRefs: ['proofs/lease-1617.json'],
    ...overrides,
  });
}

function receipt(overrides = {}) {
  return createExecutionReceipt({
    receiptId: 'execution-1617-1',
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: BRANCH,
    sourceHead: HEAD,
    workerId: OWNER,
    workerType: 'github-first',
    executionId: 'execution-1617',
    leaseKey: 'lease-goal-1497-pr-1617',
    state: 'started',
    phase: 'bounded-source-mutation',
    sequence: 1,
    timestampUtc: '2026-07-30T09:59:00.000Z',
    heartbeatExpiresAtUtc: '2026-07-30T10:01:00.000Z',
    proofRefs: ['proofs/execution-1617.json'],
    expectedNextAction: 'Continue one bounded mutation step.',
    ...overrides,
  });
}

function lane(overrides = {}) {
  return buildCanonicalImplementationLaneProjection({
    laneId: LANE_ID,
    issueNumber: 1497,
    prNumber: 1617,
    repository: REPOSITORY,
    branch: BRANCH,
    headSha: HEAD,
    github: github(),
    mutationLease: lease(),
    executionReceipt: receipt(),
    nowUtc: NOW,
    ...overrides,
  });
}

test('canonical lane binds lane ID, issue, PR, exact head, receipts, proofs and mutation lease', () => {
  const projection = lane({ proofRefs: ['proofs/pr-1617.json'] });
  assert.equal(projection.schemaVersion, CANONICAL_IMPLEMENTATION_LANE_SCHEMA);
  assert.equal(projection.valid, true);
  assert.equal(projection.active, true);
  assert.equal(projection.terminal, false);
  assert.equal(projection.issueNumber, 1497);
  assert.equal(projection.prNumber, 1617);
  assert.equal(projection.headSha, HEAD);
  assert.deepEqual(projection.executionReceiptRefs, ['execution-1617-1']);
  assert.equal(projection.mutationLeaseIdentity.leaseId, 'lease-goal-1497-pr-1617');
  assert.equal(projection.chatMemoryAuthoritative, false);
});

test('conflicting encoded and explicit lane identities fail closed', () => {
  const projection = lane({ issueNumber: 1700, prNumber: 9999 });
  assert.equal(projection.valid, false);
  assert.ok(projection.blockers.includes('issue-identity-conflict'));
  assert.ok(projection.blockers.includes('pr-identity-conflict'));
});

test('closed-but-unmerged and contradictory merge evidence never become terminal', () => {
  const closed = lane({
    github: github({ prState: 'closed' }),
  });
  assert.equal(closed.terminal, false);
  assert.equal(closed.valid, false);
  assert.ok(closed.blockers.includes('github-pr-closed-without-affirmative-merge'));

  const contradictory = lane({
    github: github({
      prState: 'closed',
      merged: false,
      mergedAt: '2026-07-30T09:50:00.000Z',
      mergeCommitSha: MERGE,
    }),
  });
  assert.equal(contradictory.terminal, false);
  assert.ok(contradictory.blockers.includes('github-merge-evidence-contradictory'));
});

test('affirmative internally consistent exact-head merge evidence produces one terminal lane', () => {
  const terminal = lane({
    github: github({
      prState: 'closed',
      merged: true,
      mergedAt: '2026-07-30T09:50:00.000Z',
      mergeCommitSha: MERGE,
    }),
  });
  assert.equal(terminal.valid, true);
  assert.equal(terminal.active, false);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.mergeEvidence.mergeCommitSha, MERGE);
});

test('source mutation lease validates, renews only the exact live owner, and never grants merge authority', () => {
  const record = lease();
  assert.equal(record.schema, SOURCE_MUTATION_LEASE_SCHEMA);
  const validation = validateSourceMutationLease(record, {
    nowUtc: NOW,
    expected: {
      leaseId: record.leaseId,
      laneId: LANE_ID,
      headSha: HEAD,
      ownerId: OWNER,
    },
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.active, true);
  assert.equal(record.mergeAuthority, false);
  assert.equal(record.leaseSeizureAllowed, false);

  const wrongOwner = renewSourceMutationLeaseRecord(record, {
    ...record,
    nowUtc: NOW,
    ownerId: 'different-owner',
  });
  assert.equal(wrongOwner.ok, false);
  assert.match(wrongOwner.reason, /ownerId-mismatch/);

  const renewed = renewSourceMutationLeaseRecord(record, {
    ...record,
    nowUtc: NOW,
  });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.record.renewedAtUtc, NOW);
});

test('execution receipt leaseKey is correlation only and cannot fabricate mutation authority', () => {
  const execution = receipt();
  const noLeaseLane = buildCanonicalImplementationLaneProjection({
    laneId: LANE_ID,
    issueNumber: 1497,
    prNumber: 1617,
    repository: REPOSITORY,
    branch: BRANCH,
    headSha: HEAD,
    github: github(),
    executionReceipt: execution,
    nowUtc: NOW,
  });
  assert.equal(noLeaseLane.mutationLeaseIdentity, null);

  const forgedOwner = validateExecutionReceiptAgainstMutationLease(execution, lease({ ownerId: 'another-owner' }), { nowUtc: NOW });
  assert.equal(forgedOwner.valid, false);
  assert.ok(forgedOwner.errors.includes('worker-owner-mismatch'));
  assert.equal(forgedOwner.leaseAuthorityDerivedFromReceipt, false);

  const expired = validateExecutionReceiptAgainstMutationLease(
    execution,
    lease({ expiresAtUtc: '2026-07-30T09:59:59.000Z' }),
    { nowUtc: NOW },
  );
  assert.equal(expired.valid, false);
  assert.deepEqual(expired.errors, ['lease:expired']);
  assert.equal(expired.leaseAuthorityDerivedFromReceipt, false);
});

test('controller and Mission Worker heartbeats remain distinct authorities', () => {
  const controller = createProgrammeControllerHeartbeat({
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    cycleState: 'ACTIVE_LANE',
    activeLaneId: LANE_ID,
    lastSuccessfulReconciliationUtc: '2026-07-30T09:59:00.000Z',
    lastPublishedReceiptId: 'projection-1617',
    timestampUtc: NOW,
    boundedMutationSteps: 1,
  });
  assert.equal(controller.schema, PROGRAMME_CONTROLLER_HEARTBEAT_SCHEMA);
  assert.equal(projectProgrammeControllerHeartbeat(controller, { nowUtc: NOW }).fresh, true);

  const worker = createMissionWorkerHeartbeatRecord({
    timestampUtc: NOW,
    repositoryRoot: process.cwd(),
    branch: 'main',
    headSha: HEAD,
    pid: 1234,
  });
  assert.equal(worker.schemaVersion, MISSION_WORKER_HEARTBEAT_SCHEMA);
  assert.equal(projectMissionWorkerHeartbeat(worker, { nowUtc: NOW }).fresh, true);
  assert.equal(projectProgrammeControllerHeartbeat(worker, { nowUtc: NOW }).valid, false);
  assert.equal(projectMissionWorkerHeartbeat(controller, { nowUtc: NOW }).valid, false);
  assert.equal(projectProgrammeControllerHeartbeat(null, { nowUtc: NOW }).valid, false);
  assert.equal(projectMissionWorkerHeartbeat(null, { nowUtc: NOW }).valid, false);
});

test('terminal finalization plan is exact-bound and emits no scheduling or merge authority', () => {
  const terminalLane = lane({
    github: github({
      prState: 'closed',
      merged: true,
      mergedAt: '2026-07-30T09:50:00.000Z',
      mergeCommitSha: MERGE,
    }),
  });
  const plan = buildTerminalLaneFinalizationPlan({
    lane: terminalLane,
    mutationLease: lease(),
    github: terminalLane.mergeEvidence,
    leaseId: 'lease-goal-1497-pr-1617',
    ownerId: OWNER,
    nowUtc: NOW,
  });
  assert.equal(plan.valid, true);
  assert.equal(plan.releaseOnlyExactLease, true);
  assert.equal(plan.schedulesWork, false);
  assert.equal(plan.mergeAuthority, false);
  const records = createTerminalLaneEvidenceRecords(plan, { timestampUtc: NOW });
  assert.equal(records.receipt.headSha, HEAD);
  assert.equal(records.receipt.leaseId, 'lease-goal-1497-pr-1617');
  assert.equal(records.receipt.schedulesWork, false);
});

test('scheduler goals are constructed from durable records and the canonical lane', () => {
  const goals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [{
      goalId: 'goal-1497',
      issueNumber: 1497,
      title: 'Durable controller',
      timestampUtc: NOW,
      status: 'READY',
      prerequisites: [],
      route: 'CHATGPT_GITHUB',
    }],
  });
  assert.equal(goals.valid, true);
  assert.equal(goals.goals.length, 1);
  assert.equal(goals.goals[0].state, 'ACTIVE');
  assert.equal(goals.goals[0].activePr, 1617);
  assert.equal(goals.goals[0].headSha, HEAD);
});

test('authoritative projection holds without a real mutation lease even when a receipt has a leaseKey', () => {
  const controllerHeartbeat = projectProgrammeControllerHeartbeat(createProgrammeControllerHeartbeat({
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    cycleState: 'ACTIVE_LANE',
    activeLaneId: LANE_ID,
    lastSuccessfulReconciliationUtc: NOW,
    lastPublishedReceiptId: 'projection-1617',
    timestampUtc: NOW,
    boundedMutationSteps: 1,
  }), { nowUtc: NOW });
  const projection = buildAuthoritativeProgrammeProjection({
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: buildCanonicalImplementationLaneProjection({
      laneId: LANE_ID,
      issueNumber: 1497,
      prNumber: 1617,
      repository: REPOSITORY,
      branch: BRANCH,
      headSha: HEAD,
      github: github(),
      executionReceipt: receipt(),
      nowUtc: NOW,
    }),
    mutationLease: null,
    controllerHeartbeatProjection: controllerHeartbeat,
    workerHeartbeatProjection: { valid: true, fresh: true },
    executionReceipt: receipt(),
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: { failClosed: false, selectedGoal: null, decisionReceipt: { status: 'ACTIVE_LANE', activeIssue: 1497 } },
    criticalBacklog: { decision: 'WAIT_ACTIVE_MISSION' },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  });
  assert.equal(projection.schemaVersion, AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA);
  assert.equal(projection.status, 'HOLD');
  assert.ok(projection.blockers.includes('active-lane-without-source-mutation-lease'));
  assert.equal(projection.chatMemoryAuthoritative, false);
});

test('projection receipt identifies every canonical component exactly once', () => {
  const projection = buildAuthoritativeProgrammeProjection({
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: lane(),
    mutationLease: lease(),
    controllerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0, activeLaneId: LANE_ID },
    workerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0 },
    executionReceipt: receipt(),
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: { failClosed: false, selectedGoal: null, decisionReceipt: { status: 'ACTIVE_LANE', activeIssue: 1497 } },
    criticalBacklog: { decision: 'WAIT_ACTIVE_MISSION' },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  });
  const components = projection.projectionReceipt.components;
  assert.equal(components.length, PROGRAMME_AUTHORITY_COMPONENTS.length);
  assert.equal(new Set(components.map(({ componentId }) => componentId)).size, components.length);
  assert.equal(components.filter(({ reuse }) => reuse).length > components.filter(({ reuse }) => !reuse).length, true);
  assert.equal(projection.projectionReceipt.authorityInjectedByCaller, true);
  assert.equal(projection.projectionReceipt.sourceConstructionMode, 'deterministic-testing-seam');
  assert.equal(projection.projectionReceipt.boundedMutationStepsPerCycle, 1);
  assert.deepEqual(projection.runtimeHealthRecords, []);
});

test('programme stall diagnosis reuses Monitor Multiplexer and never starts scheduler, worker or mutation machinery', async () => {
  const definition = buildProgrammeStallMonitorDefinition({
    nextDueUtc: NOW,
    relatedIssue: '#1497',
  });
  assert.equal(definition.ok, true);
  assert.equal(definition.definition.schemaVersion, MONITOR_MULTIPLEXER_SCHEMA_VERSION);
  assert.equal(definition.definition.monitorId, PROGRAMME_STALL_MONITOR_ID);
  assert.equal(definition.definition.handlerId, PROGRAMME_STALL_MONITOR_HANDLER_ID);
  assert.equal(definition.definition.sourceMutationAllowed, false);

  const stalledProjection = {
    observedAtUtc: NOW,
    status: 'ACTIVE',
    lane: { active: true, terminal: false },
    controllerHeartbeat: { fresh: false, ageMs: 3_600_000 },
    workerHeartbeat: { fresh: true, ageMs: 1_000 },
    executionReceipt: receipt({ timestampUtc: '2026-07-30T09:00:00.000Z' }),
    mutationLease: lease({ renewedAtUtc: '2026-07-30T09:00:00.000Z' }),
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
  };
  const diagnosis = diagnoseProgrammeStall(stalledProjection, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.equal(diagnosis.stalled, true);
  assert.equal(diagnosis.diagnosisOnly, true);
  assert.equal(diagnosis.schedulingAllowed, false);

  const handler = createProgrammeStallMonitorHandler({
    loadProjection: async () => stalledProjection,
    stallAfterMs: 1_000,
  });
  const result = await handler({ timestampUtc: NOW });
  assert.equal(result.state, 'FAIL');
  assert.equal(result.diagnosis.monitorRuntime, 'monitor-multiplexer');
});
