import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionReceipt } from './executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createSharedWorkspaceProofRecord,
} from './sharedAgentWorkspaceStore.mjs';
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
  createSourceMutationLeaseReleaseRecord,
  createTerminalLaneEvidenceId,
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
import { buildMissionScheduler } from '../runtime/missionScheduler.mjs';

const NOW = '2026-07-30T10:00:00.000Z';
const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const LANE_ID = 'goal-1497-pr-1617';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/canonical-programme-authority-contracts';
const OWNER = 'codex-pr-1617';

function goalRecord(overrides = {}) {
  return {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL,
    goalId: 'goal-1497',
    participantId: 'codex',
    timestampUtc: NOW,
    issueNumber: 1497,
    repository: REPOSITORY,
    branch: BRANCH,
    title: 'Durable controller',
    status: 'READY',
    prerequisites: [],
    route: 'CHATGPT_GITHUB',
    ...overrides,
  };
}

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

function approvalReceipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.protected-operator-approval.v1',
    kind: 'stephanos.protected-operator-approval',
    activePr: 1617,
    headSha: HEAD,
    repository: REPOSITORY,
    branch: BRANCH,
    protectionBoundary: 'github-protected-environment:operator-merge-approval',
    requiredReviewer: 'Cheekyfellastef',
    workflowPath: '.github/workflows/operator-merge-approval-gate.yml',
    workflowRunId: 12345,
    workflowRunAttempt: 1,
    approvedAtUtc: '2026-07-30T09:59:00.000Z',
    mergeExecutionAuthority: 'github-actions-protected-environment-only',
    reusableAcrossHeads: false,
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

test('canonical lane requires GitHub to affirm the exact head repository and branch', () => {
  for (const githubEvidence of [
    github({ repository: '' }),
    github({ headBranch: '' }),
    github({ repository: 'other/repository' }),
    github({ headBranch: 'feat/other-branch' }),
  ]) {
    const projection = lane({ github: githubEvidence });
    assert.equal(projection.valid, false);
    assert.equal(projection.active, false);
  }
});

test('conflicting encoded and explicit lane identities fail closed', () => {
  const projection = lane({ issueNumber: 1700, prNumber: 9999 });
  assert.equal(projection.valid, false);
  assert.ok(projection.blockers.includes('issue-identity-conflict'));
  assert.ok(projection.blockers.includes('pr-identity-conflict'));
});

test('malformed explicit lane aliases fail closed instead of disappearing', () => {
  for (const [overrides, blocker] of [
    [{ issueNumber: 'not-an-issue' }, 'issue-explicit-identity-invalid'],
    [{ issue: 'not-an-issue' }, 'issue-explicit-identity-invalid'],
    [{ prNumber: 'not-a-pr' }, 'pr-explicit-identity-invalid'],
    [{ pr: 'not-a-pr' }, 'pr-explicit-identity-invalid'],
    [{ headSha: 'not-a-sha' }, 'head-explicit-identity-invalid'],
  ]) {
    const projection = lane(overrides);
    assert.equal(projection.valid, false);
    assert.equal(projection.active, false);
    assert.ok(projection.blockers.includes(blocker));
  }
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

test('open PR provisional merge SHAs do not fabricate contradictory merge evidence', () => {
  const projection = lane({
    github: github({ mergeCommitSha: MERGE }),
  });
  assert.equal(projection.valid, true);
  assert.equal(projection.active, true);
  assert.equal(projection.terminal, false);
  assert.equal(projection.mergeEvidence.affirmativelyMerged, false);
  assert.equal(projection.blockers.includes('github-merge-evidence-contradictory'), false);
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

test('future-dated GitHub merge evidence cannot make a lane terminal', () => {
  const projection = lane({
    github: github({
      prState: 'closed',
      merged: true,
      mergedAt: '2099-01-01T00:00:00.000Z',
      mergeCommitSha: MERGE,
    }),
  });
  assert.equal(projection.valid, false);
  assert.equal(projection.active, false);
  assert.equal(projection.terminal, false);
  assert.ok(projection.blockers.includes('github-merged-at-in-future'));
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

  for (const [field, value] of [
    ['headSha', 'bad'],
    ['ownerId', 123],
    ['issueNumber', 'bad'],
  ]) {
    const malformedExpected = validateSourceMutationLease(record, {
      nowUtc: NOW,
      expected: { [field]: value },
    });
    assert.equal(malformedExpected.valid, false);
    assert.ok(malformedExpected.errors.includes(`${field}-expected-invalid`));
  }

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

  const maximumLease = lease({
    acquiredAtUtc: '2026-07-30T09:30:00.000Z',
    renewedAtUtc: '2026-07-30T09:30:00.000Z',
    expiresAtUtc: '2026-07-31T09:30:00.000Z',
  });
  const clamped = renewSourceMutationLeaseRecord(maximumLease, {
    ...maximumLease,
    nowUtc: '2026-07-31T08:30:00.000Z',
    durationMs: 2 * 60 * 60 * 1000,
  });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.record.expiresAtUtc, '2026-07-31T09:30:00.000Z');
  assert.equal(validateSourceMutationLease(clamped.record, {
    nowUtc: '2026-07-31T08:30:00.000Z',
  }).active, true);

  const nonActive = validateSourceMutationLease({ ...record, status: 'RELEASED' }, { nowUtc: NOW });
  assert.equal(nonActive.valid, false);
  assert.ok(nonActive.errors.includes('lease-status-not-active'));

  const overlong = validateSourceMutationLease(lease({
    expiresAtUtc: '2026-08-30T09:30:00.000Z',
  }), { nowUtc: NOW });
  assert.equal(overlong.valid, false);
  assert.ok(overlong.errors.includes('lease-lifetime-exceeds-maximum'));

  const futureRenewal = validateSourceMutationLease(lease({
    renewedAtUtc: '2026-07-30T12:00:00.000Z',
    expiresAtUtc: '2026-07-30T13:00:00.000Z',
  }), { nowUtc: NOW });
  assert.equal(futureRenewal.valid, false);
  assert.ok(futureRenewal.errors.includes('future-renewal'));

  const conflictingLaneIdentity = validateSourceMutationLease(lease({
    issueNumber: 1,
    prNumber: 2,
  }), { nowUtc: NOW });
  assert.equal(conflictingLaneIdentity.valid, false);
  assert.ok(conflictingLaneIdentity.errors.includes('lane-id-issue-mismatch'));
  assert.ok(conflictingLaneIdentity.errors.includes('lane-id-pr-mismatch'));

  for (const [unsafeEnvelope, expectedError] of [
    [lease({ proofRefs: ['../secret.json'] }), 'workspace:unsafe-proof-ref'],
    [{ ...lease(), apiKey: 'not-a-real-secret' }, 'workspace:forbidden-secret-field:apiKey'],
  ]) {
    const invalidEnvelope = validateSourceMutationLease(unsafeEnvelope, { nowUtc: NOW });
    assert.equal(invalidEnvelope.valid, false);
    assert.equal(invalidEnvelope.active, false);
    assert.ok(invalidEnvelope.errors.includes(expectedError));
    assert.equal(invalidEnvelope.finalVerdict, 'SOURCE_MUTATION_LEASE_BLOCKED');
  }

  const sharedPrefix = 'lease-release-key'.padEnd(50, 'a');
  const firstRelease = createSourceMutationLeaseReleaseRecord(lease({
    leaseId:`${sharedPrefix}-one`,
  }), { timestampUtc:NOW });
  const secondRelease = createSourceMutationLeaseReleaseRecord(lease({
    leaseId:`${sharedPrefix}-two`,
  }), { timestampUtc:NOW });
  assert.notEqual(firstRelease.statusId, secondRelease.statusId);
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

  const expiredReceipt = validateExecutionReceiptAgainstMutationLease(
    receipt({ heartbeatExpiresAtUtc: '2026-07-30T10:00:00.000Z' }),
    lease(),
    { nowUtc: NOW },
  );
  assert.equal(expiredReceipt.valid, false);
  assert.ok(expiredReceipt.errors.includes('receipt-heartbeat-expired'));
  assert.equal(expiredReceipt.leaseAuthorityDerivedFromReceipt, false);

  const futureReceipt = validateExecutionReceiptAgainstMutationLease(
    receipt({
      timestampUtc: '2099-01-01T00:00:00.000Z',
      heartbeatExpiresAtUtc: '2099-01-01T00:01:00.000Z',
    }),
    lease(),
    { nowUtc: NOW },
  );
  assert.equal(futureReceipt.valid, false);
  assert.ok(futureReceipt.errors.includes('receipt-timestamp-in-future'));
  assert.equal(futureReceipt.finalVerdict, 'EXECUTION_RECEIPT_MUTATION_AUTHORITY_BLOCKED');

  const preLeaseReceipt = validateExecutionReceiptAgainstMutationLease(
    receipt({
      timestampUtc: '2026-07-30T09:29:59.000Z',
      heartbeatExpiresAtUtc: '2026-07-30T10:01:00.000Z',
    }),
    lease(),
    { nowUtc: NOW },
  );
  assert.equal(preLeaseReceipt.valid, false);
  assert.ok(preLeaseReceipt.errors.includes('receipt-before-lease-acquisition'));
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
  const wrongControllerRevision = projectProgrammeControllerHeartbeat(controller, {
    nowUtc: NOW,
    expectedSourceRevision: 'b'.repeat(40),
  });
  assert.equal(wrongControllerRevision.valid, false);
  assert.ok(wrongControllerRevision.errors.includes('controller-source-revision-mismatch'));

  const starting = createProgrammeControllerHeartbeat({
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    cycleState: 'STARTING',
    timestampUtc: NOW,
    boundedMutationSteps: 0,
    proofRefs: [],
  });
  const startingProjection = projectProgrammeControllerHeartbeat(starting, { nowUtc: NOW });
  assert.equal(startingProjection.valid, true);
  assert.equal(startingProjection.reconciliationSucceeded, false);
  assert.equal(startingProjection.lastSuccessfulReconciliationUtc, null);
  assert.equal(startingProjection.lastPublishedReceiptId, '');

  const fabricatedStarting = projectProgrammeControllerHeartbeat(
    createProgrammeControllerHeartbeat({
      controllerId: 'durable-flywheel-controller',
      sourceRevision: HEAD,
      cycleState: 'STARTING',
      lastSuccessfulReconciliationUtc: NOW,
      lastPublishedReceiptId: 'not-yet-published',
      timestampUtc: NOW,
      boundedMutationSteps: 0,
    }),
    { nowUtc: NOW },
  );
  assert.equal(fabricatedStarting.valid, false);
  assert.ok(fabricatedStarting.errors.includes(
    'starting-heartbeat-cannot-claim-success',
  ));

  const worker = createMissionWorkerHeartbeatRecord({
    timestampUtc: NOW,
    repositoryRoot: process.cwd(),
    branch: 'main',
    headSha: HEAD,
    pid: 1234,
  });
  assert.equal(worker.schemaVersion, MISSION_WORKER_HEARTBEAT_SCHEMA);
  const workerProjectionOptions = {
    nowUtc: NOW,
    expectedRepositoryRoot: process.cwd(),
    expectedHeadSha: HEAD,
  };
  assert.equal(projectMissionWorkerHeartbeat(worker, workerProjectionOptions).fresh, true);
  assert.equal(projectProgrammeControllerHeartbeat(worker, { nowUtc: NOW }).valid, false);
  assert.equal(projectMissionWorkerHeartbeat(controller, workerProjectionOptions).valid, false);
  assert.equal(projectProgrammeControllerHeartbeat(null, { nowUtc: NOW }).valid, false);
  assert.equal(projectMissionWorkerHeartbeat(null, workerProjectionOptions).valid, false);

  const contradictoryStatus = projectProgrammeControllerHeartbeat({
    ...controller,
    status: 'HOLD',
  }, { nowUtc: NOW });
  assert.equal(contradictoryStatus.valid, false);
  assert.ok(contradictoryStatus.errors.includes('controller-status-cycle-state-mismatch'));

  const wrongParticipant = projectProgrammeControllerHeartbeat({
    ...controller,
    participantId: 'different-controller',
  }, { nowUtc: NOW });
  assert.equal(wrongParticipant.valid, false);
  assert.ok(wrongParticipant.errors.includes('controller-participant-id-mismatch'));

  const invalidEnvelope = projectProgrammeControllerHeartbeat({
    ...controller,
    schemaVersion: 'unknown.v1',
  }, { nowUtc: NOW });
  assert.equal(invalidEnvelope.valid, false);
  assert.ok(invalidEnvelope.errors.includes('invalid-workspace-schema'));
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
  assert.equal(records.evidenceId, createTerminalLaneEvidenceId(terminalLane, lease()));
  assert.notEqual(
    records.evidenceId,
    createTerminalLaneEvidenceId(
      { ...terminalLane, repository: 'other/repository' },
      lease({ repository: 'other/repository' }),
    ),
  );
  assert.notEqual(
    records.evidenceId,
    createTerminalLaneEvidenceId(terminalLane, lease({ leaseId: 'lease-goal-1497-pr-1617-second' })),
  );

  const futureMergePlan = buildTerminalLaneFinalizationPlan({
    lane: terminalLane,
    mutationLease: lease(),
    github: {
      ...terminalLane.mergeEvidence,
      mergedAt: '2099-01-01T00:00:00.000Z',
    },
    leaseId: 'lease-goal-1497-pr-1617',
    ownerId: OWNER,
    nowUtc: NOW,
  });
  assert.equal(futureMergePlan.valid, false);
  assert.ok(futureMergePlan.blockers.includes('github-merged-at-in-future'));
  assert.equal(futureMergePlan.finalVerdict, 'TERMINAL_LANE_FINALIZATION_HOLD');
});

test('scheduler goals are constructed from durable records and the canonical lane', () => {
  const goals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [goalRecord()],
  });
  assert.equal(goals.valid, true);
  assert.equal(goals.goals.length, 1);
  assert.equal(goals.goals[0].state, 'ACTIVE');
  assert.equal(goals.goals[0].activePr, 1617);
  assert.equal(goals.goals[0].headSha, HEAD);

  const nonCanonicalGoalWithoutIssue = goalRecord({
    goalId: 'release-2026-goal-1497',
  });
  delete nonCanonicalGoalWithoutIssue.issueNumber;
  const rejectedInferredIssue = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [nonCanonicalGoalWithoutIssue],
  });
  assert.equal(rejectedInferredIssue.valid, false);
  assert.equal(rejectedInferredIssue.goals.length, 0);
  assert.ok(rejectedInferredIssue.blockers.includes('goal-record-0-issue-invalid'));

  const explicitNonCanonicalGoal = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({
      goalId: 'release-2026-goal-1497',
      issueNumber: 1497,
    })],
  });
  assert.equal(explicitNonCanonicalGoal.valid, true);
  assert.equal(explicitNonCanonicalGoal.goals[0].issue, 1497);

  const exactApprovalReceipt = approvalReceipt();
  const selfAttestedApproval = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({
      state: 'IMPLEMENTED',
      activePr: 1617,
      headSha: HEAD,
      operatorApprovalReceipt: exactApprovalReceipt,
    })],
  });
  assert.equal(selfAttestedApproval.valid, false);
  assert.ok(selfAttestedApproval.blockers.includes('goal-record-0-approval-receipt-invalid'));
  const implementedGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    trustedOperatorApprovalReceipts: [exactApprovalReceipt],
    goalRecords: [goalRecord({
      state: 'IMPLEMENTED',
      activePr: 1617,
      headSha: HEAD,
      proofState: 'PASS',
      operatorApprovalReceipt: exactApprovalReceipt,
      evidenceAt: NOW,
    })],
  });
  assert.equal(implementedGoals.valid, true, implementedGoals.blockers.join(','));
  assert.equal(implementedGoals.goals[0].operatorApprovalReceipt.issue, 1497);
  assert.equal(implementedGoals.goals[0].operatorApprovalReceipt.activePr, 1617);
  assert.equal(implementedGoals.goals[0].operatorApprovalReceipt.headSha, HEAD);
  assert.equal(
    implementedGoals.goals[0].operatorApprovalReceipt.schemaVersion,
    'stephanos.protected-operator-approval.v1',
  );
  const implementedScheduler = buildMissionScheduler({
    now: NOW,
    goals: implementedGoals.goals,
    proofReceipts: [{
      issue: 1497,
      activePr: 1617,
      headSha: HEAD,
      repository: REPOSITORY,
      branch: BRANCH,
    }],
  });
  assert.equal(implementedScheduler.portfolio[0].lifecycle, 'MERGE_READY');

  const activeApprovalOverlay = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    trustedOperatorApprovalReceipts: [exactApprovalReceipt],
    goalRecords: [goalRecord({ operatorApprovalReceipt: exactApprovalReceipt })],
  });
  assert.equal(activeApprovalOverlay.goals[0].operatorApprovalReceipt.issue, 1497);

  for (const conflictingApprovalAliases of [
    { issue: 1497, issueNumber: 9999 },
    { activePr: 1617, pr: 9999 },
  ]) {
    const malformedApproval = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      goalRecords: [goalRecord({
        state: 'IMPLEMENTED',
        activePr: 1617,
        headSha: HEAD,
        repository: REPOSITORY,
        branch: BRANCH,
        operatorApprovalReceipt: {
          ...exactApprovalReceipt,
          ...conflictingApprovalAliases,
        },
      })],
    });
    assert.equal(malformedApproval.valid, false);
    assert.equal(malformedApproval.goals.length, 0);
    assert.ok(malformedApproval.blockers.includes('goal-record-0-approval-receipt-invalid'));
  }

  for (const untrustedProvenance of [
    { schemaVersion: 'self-attested.approval.v1' },
    { protectionBoundary: 'unprotected-caller' },
    { requiredReviewer: 'untrusted-writer' },
    { workflowRunId: null },
    { mergeExecutionAuthority: 'caller' },
  ]) {
    const untrustedApproval = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      goalRecords: [goalRecord({
        state: 'IMPLEMENTED',
        activePr: 1617,
        headSha: HEAD,
        operatorApprovalReceipt: approvalReceipt(untrustedProvenance),
      })],
    });
    assert.equal(untrustedApproval.valid, false);
    assert.equal(untrustedApproval.goals.length, 0);
    assert.ok(untrustedApproval.blockers.includes('goal-record-0-approval-receipt-invalid'));
  }

  const aliasOnlyApprovalReceipt = approvalReceipt({
    relatedIssue: '#1497',
    relatedPr: '#1617',
    sourceHead: HEAD,
    repositoryFullName: REPOSITORY,
    headBranch: BRANCH,
  });
  delete aliasOnlyApprovalReceipt.issue;
  delete aliasOnlyApprovalReceipt.activePr;
  delete aliasOnlyApprovalReceipt.headSha;
  delete aliasOnlyApprovalReceipt.repository;
  delete aliasOnlyApprovalReceipt.branch;
  const aliasedApproval = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    trustedOperatorApprovalReceipts: [exactApprovalReceipt],
    goalRecords: [goalRecord({
      state: 'IMPLEMENTED',
      activePr: 1617,
      headSha: HEAD,
      proofState: 'PASS',
      operatorApprovalReceipt: aliasOnlyApprovalReceipt,
    })],
  });
  assert.equal(aliasedApproval.valid, true);
  assert.equal(aliasedApproval.goals[0].operatorApprovalReceipt.issue, 1497);
  assert.equal(aliasedApproval.goals[0].operatorApprovalReceipt.activePr, 1617);
  assert.equal(aliasedApproval.goals[0].operatorApprovalReceipt.headSha, HEAD);
  assert.equal(aliasedApproval.goals[0].operatorApprovalReceipt.repository, REPOSITORY.toLowerCase());
  assert.equal(aliasedApproval.goals[0].operatorApprovalReceipt.branch, BRANCH);

  for (const evidenceAt of ['2026-07-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'malformed']) {
    const preservedEvidence = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      lane: lane(),
      goalRecords: [goalRecord({ evidenceAt })],
    });
    assert.equal(preservedEvidence.goals[0].state, 'ACTIVE');
    assert.equal(preservedEvidence.goals[0].evidenceAt, evidenceAt);
  }

  const heldActiveRoute = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [goalRecord({ route: 'WAITING_FOR_EXTERNAL_CONDITION' })],
  });
  assert.equal(heldActiveRoute.goals[0].route, 'WAITING_FOR_EXTERNAL_CONDITION');
  const heldActiveScheduler = buildMissionScheduler({
    now: NOW,
    goals: heldActiveRoute.goals,
  });
  assert.equal(heldActiveScheduler.failClosed, true);
  assert.ok(heldActiveScheduler.contradictions.some(({ code }) => code === 'ACTIVE_ROUTE_NOT_EXECUTABLE'));

  const malformedDependencies = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({
      goalId: 'goal-1284',
      issueNumber: 1284,
      title: 'Malformed durable relation evidence',
      state: 'READY',
      prerequisites: '#1286',
      route: 'CHATGPT_GITHUB',
      evidenceAt: NOW,
    })],
  });
  assert.equal(malformedDependencies.goals[0].prerequisites, '#1286');
  const malformedScheduler = buildMissionScheduler({
    now: NOW,
    goals: malformedDependencies.goals,
  });
  assert.equal(malformedScheduler.portfolio[0].lifecycle, 'BLOCKED');
  assert.equal(malformedScheduler.portfolio[0].invalidPrerequisiteContainer, true);
  assert.ok(malformedScheduler.blockers.some(({ code }) => code === 'GOAL_BLOCKED'));

  const invalidated = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({
      issueNumber: 1497,
      title: 'Invalidated durable goal',
      state: 'READY',
      prerequisites: [],
      duplicateOf: 1284,
      supersededBy: 1622,
      route: 'CHATGPT_GITHUB',
      evidenceAt: NOW,
    })],
  });
  assert.equal(invalidated.goals[0].duplicateOf, 1284);
  assert.equal(invalidated.goals[0].supersededBy, 1622);

  for (const invalidIssueAliases of [
    { issueNumber: null, relatedIssue: '#1497' },
    { issueNumber: 1497, relatedIssue: '#1' },
    { issueNumber: 1497, issue: 'not-an-issue' },
  ]) {
    const malformedIdentity = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      goalRecords: [goalRecord(invalidIssueAliases)],
    });
    assert.equal(malformedIdentity.valid, false);
    assert.equal(malformedIdentity.goals.length, 0);
    assert.ok(malformedIdentity.blockers.includes('goal-record-0-issue-invalid'));
  }

  for (const invalidPrAliases of [
    { activePr: 1617, prNumber: 9999 },
    { activePr: null, prNumber: 1617 },
    { activePr: 1617, relatedPr: 'not-a-pr' },
  ]) {
    const malformedIdentity = buildSchedulerGoalsFromProgrammeSources({
      nowUtc: NOW,
      goalRecords: [goalRecord(invalidPrAliases)],
    });
    assert.equal(malformedIdentity.valid, false);
    assert.equal(malformedIdentity.goals.length, 0);
    assert.ok(malformedIdentity.blockers.includes('goal-record-0-pr-invalid'));
  }

  const conflictingActiveOverlay = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [goalRecord({
      activePr: 9999,
      repository: REPOSITORY,
      branch: BRANCH,
      headSha: HEAD,
    })],
  });
  assert.equal(conflictingActiveOverlay.valid, false);
  assert.ok(conflictingActiveOverlay.blockers.includes('active-goal-canonical-lane-identity-conflict'));

  const nonGoal = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [{
      ...goalRecord(),
      kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS,
      statusId: 'status-ready',
    }],
  });
  assert.equal(nonGoal.valid, false);
  assert.equal(nonGoal.goals.length, 0);
  assert.ok(nonGoal.blockers.includes('goal-record-0-not-canonical-goal'));

  const goalKindWithoutGoalId = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [{
      ...goalRecord(),
      goalId: undefined,
      statusId: 'status-shaped-goal',
    }],
  });
  assert.equal(goalKindWithoutGoalId.valid, false);
  assert.equal(goalKindWithoutGoalId.goals.length, 0);
  assert.ok(goalKindWithoutGoalId.blockers.includes('goal-record-0-not-canonical-goal'));

  const malformedOperatorPriority = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({ operatorPriority: 'yes' })],
  });
  assert.equal(malformedOperatorPriority.goals[0].operatorPriority, 'yes');
  const malformedOperatorScheduler = buildMissionScheduler({
    now: NOW,
    goals: malformedOperatorPriority.goals,
  });
  assert.equal(malformedOperatorScheduler.portfolio[0].lifecycle, 'BLOCKED');
  assert.ok(malformedOperatorScheduler.blockers.some(({ code }) => code === 'INVALID_OPERATOR_PRIORITY_EVIDENCE'));

  const malformedRepairCycle = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [goalRecord({ repairCycleCount: '3' })],
  });
  assert.equal(malformedRepairCycle.goals[0].repairCycleCount, '3');
  const malformedRepairScheduler = buildMissionScheduler({
    now: NOW,
    goals: malformedRepairCycle.goals,
  });
  assert.equal(malformedRepairScheduler.portfolio[0].invalidRepairCycleCount, true);
  assert.equal(malformedRepairScheduler.portfolio[0].lifecycle, 'BLOCKED');

  const malformedActiveApproval = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [goalRecord({ approvalRequired: 'yes' })],
  });
  assert.equal(malformedActiveApproval.goals[0].approvalRequired, 'yes');
  const malformedActiveScheduler = buildMissionScheduler({
    now: NOW,
    goals: malformedActiveApproval.goals,
  });
  assert.ok(malformedActiveScheduler.contradictions.some(({ code }) => code === 'ACTIVE_APPROVAL_GATE_INVALID'));

  const nullAuthorityFields = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    lane: lane(),
    goalRecords: [goalRecord({
      prerequisites: null,
      route: null,
      approvalRequired: null,
      operatorPriority: null,
      repairCycleCount: null,
      resultProofRefs: null,
      structuralReviewProofRefs: null,
      modelTestProofRefs: null,
    })],
  });
  assert.deepEqual({
    prerequisites: nullAuthorityFields.goals[0].prerequisites,
    route: nullAuthorityFields.goals[0].route,
    approvalRequired: nullAuthorityFields.goals[0].approvalRequired,
    operatorPriority: nullAuthorityFields.goals[0].operatorPriority,
    repairCycleCount: nullAuthorityFields.goals[0].repairCycleCount,
    resultProofRefs: nullAuthorityFields.goals[0].resultProofRefs,
    structuralReviewProofRefs: nullAuthorityFields.goals[0].structuralReviewProofRefs,
    modelTestProofRefs: nullAuthorityFields.goals[0].modelTestProofRefs,
  }, {
    prerequisites: null,
    route: null,
    approvalRequired: null,
    operatorPriority: null,
    repairCycleCount: null,
    resultProofRefs: null,
    structuralReviewProofRefs: null,
    modelTestProofRefs: null,
  });
  const nullAuthorityScheduler = buildMissionScheduler({
    now: NOW,
    goals: nullAuthorityFields.goals,
  });
  assert.equal(nullAuthorityScheduler.failClosed, true);
  assert.ok(nullAuthorityScheduler.contradictions.some(({ code }) => code === 'ACTIVE_APPROVAL_GATE_INVALID'));
  assert.ok(nullAuthorityScheduler.blockers.some(({ invalidPrerequisiteContainer }) => invalidPrerequisiteContainer === true));
  assert.ok(nullAuthorityScheduler.blockers.some(({ invalidRepairCycleCount }) => invalidRepairCycleCount === true));
  assert.ok(nullAuthorityScheduler.blockers.some(({ invalidFlywheelEvidenceContainers }) => (
    invalidFlywheelEvidenceContainers?.length === 3
  )));
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
    controllerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0, cycleState: 'ACTIVE_LANE', activeLaneId: LANE_ID },
    workerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0 },
    executionReceipt: receipt(),
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: { failClosed: false, selectedGoal: null, decisionReceipt: { status: 'ACTIVE_LANE', activeIssue: 1497 } },
    criticalBacklog: { decision: 'WAIT_ACTIVE_MISSION', selectedItem: { issueNumbers: [1497] } },
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

test('active projection requires the conveyor to affirm the exact active lane', () => {
  const base = {
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: lane(),
    mutationLease: lease(),
    controllerHeartbeatProjection: {
      valid: true,
      fresh: true,
      ageMs: 0,
      cycleState: 'ACTIVE_LANE',
      activeLaneId: LANE_ID,
      reconciliationSucceeded: true,
      boundedMutationSteps: 1,
    },
    workerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0 },
    executionReceipt: receipt(),
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: {
      failClosed: false,
      selectedGoal: null,
      decisionReceipt: { status: 'ACTIVE_LANE', activeIssue: 1497 },
    },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  };
  const contradictory = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision: 'CREATE_NEXT_MISSION',
      selectedItem: { issueNumbers: [1497] },
    },
  });
  assert.equal(contradictory.status, 'HOLD');
  assert.ok(contradictory.blockers.includes('critical-backlog-active-lane-status-mismatch'));

  const wrongMission = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      selectedItem: { issueNumbers: [1291] },
    },
  });
  assert.equal(wrongMission.status, 'HOLD');
  assert.ok(wrongMission.blockers.includes('critical-backlog-active-lane-identity-mismatch'));

  const exact = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      selectedItem: { issueNumbers: [1497] },
      activeMission: {
        missionId: LANE_ID,
        issueNumber: 1497,
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617 },
      },
    },
  });
  assert.equal(exact.status, 'ACTIVE');

  const transitional = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: {
      valid: true,
      fresh: true,
      ageMs: 0,
      cycleState: 'ACTIVE_LANE',
      activeLaneId: LANE_ID,
      reconciliationSucceeded: false,
      boundedMutationSteps: 0,
    },
    criticalBacklog: exact.criticalBacklog,
  });
  assert.equal(transitional.status, 'HOLD');
  assert.ok(transitional.blockers.includes(
    'controller-heartbeat-active-lane-authority-unproven',
  ));

  for (const invalidIssueAliases of [
    { issueNumber: null },
    { issueNumber: 'not-an-issue' },
    { issueNumber: 1497, relatedIssue: '#1' },
  ]) {
    const malformedMission = buildAuthoritativeProgrammeProjection({
      ...base,
      criticalBacklog: {
        decision: 'WAIT_ACTIVE_MISSION',
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
        selectedItem: { issueNumbers: [1497] },
        activeMission: {
          missionId: LANE_ID,
          repository: REPOSITORY,
          git: { branch: BRANCH },
          pullRequest: { number: 1617 },
          ...invalidIssueAliases,
        },
      },
    });
    assert.equal(malformedMission.status, 'HOLD');
    assert.ok(malformedMission.blockers.includes('critical-backlog-active-lane-identity-mismatch'));
  }

  for (const invalidPrAliases of [
    { prNumber: null },
    { prNumber: 'not-a-pr' },
    { prNumber: 1617, relatedPr: '#9999' },
  ]) {
    const malformedMission = buildAuthoritativeProgrammeProjection({
      ...base,
      criticalBacklog: {
        decision: 'WAIT_ACTIVE_MISSION',
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
        selectedItem: { issueNumbers: [1497] },
        activeMission: {
          missionId: LANE_ID,
          issueNumber: 1497,
          repository: REPOSITORY,
          git: { branch: BRANCH },
          pullRequest: { number: 1617 },
          ...invalidPrAliases,
        },
      },
    });
    assert.equal(malformedMission.status, 'HOLD');
    assert.ok(malformedMission.blockers.includes('critical-backlog-active-lane-pr-mismatch'));
  }

  const expiredReceiptProjection = buildAuthoritativeProgrammeProjection({
    ...base,
    executionReceipt: receipt({ heartbeatExpiresAtUtc: '2026-07-30T10:00:00.000Z' }),
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      selectedItem: { issueNumbers: [1497] },
      activeMission: {
        missionId: LANE_ID,
        issueNumber: 1497,
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617 },
      },
    },
  });
  assert.equal(expiredReceiptProjection.status, 'HOLD');
  assert.ok(expiredReceiptProjection.blockers.includes('execution:receipt-heartbeat-expired'));

  for (const state of ['stalled', 'completed', 'failed', 'cancelled']) {
    const terminalOrStalledExecution = buildAuthoritativeProgrammeProjection({
      ...base,
      executionReceipt: receipt({
        state,
        ...(state === 'stalled' ? { blocker: 'SIMULATED_STALL' } : {}),
      }),
      criticalBacklog: {
        decision: 'WAIT_ACTIVE_MISSION',
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
        selectedItem: { issueNumbers: [1497] },
        activeMission: {
          missionId: LANE_ID,
          issueNumber: 1497,
          repository: REPOSITORY,
          git: { branch: BRANCH },
          pullRequest: { number: 1617 },
        },
      },
    });
    assert.equal(terminalOrStalledExecution.status, 'HOLD');
    assert.ok(terminalOrStalledExecution.blockers.includes(
      'active-lane-execution-receipt-state-not-executable',
    ), `expected ${state} receipt to be non-executable: ${terminalOrStalledExecution.blockers.join(',')}`);
    if (['failed', 'cancelled'].includes(state)) {
      assert.ok(terminalOrStalledExecution.stallDiagnosis.blockers.includes(
        'execution-receipt-terminal-failure',
      ));
    }
  }

  const groupedGoal = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision:'WAIT_ACTIVE_MISSION',
      finalVerdict:'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      selectedItem:{ issueNumbers:[1497, 1622] },
      activeMission:{ repository:REPOSITORY, git:{ branch:BRANCH }, pullRequest:{ number:1617 } },
    },
  });
  assert.equal(groupedGoal.status, 'ACTIVE');

  const conflictingMission = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision:'WAIT_EXTERNAL_ACTIVE_MISSION',
      finalVerdict:'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      activeMission:{
        missionId:'goal-1497-pr-9999',
        issueNumber:1497,
        repository:'other/repo',
        git:{ branch:'feat/other-lane' },
        pullRequest:{ number:9999 },
      },
    },
  });
  assert.equal(conflictingMission.status, 'HOLD');
  assert.ok(conflictingMission.blockers.includes('critical-backlog-active-lane-pr-mismatch'));
  assert.ok(conflictingMission.blockers.includes('critical-backlog-active-lane-repository-mismatch'));
  assert.ok(conflictingMission.blockers.includes('critical-backlog-active-lane-branch-mismatch'));

  const heldMission = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_HELD',
      activeMission: {
        missionId: LANE_ID,
        issueNumber: 1497,
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617 },
      },
    },
  });
  assert.equal(heldMission.status, 'HOLD');
  assert.ok(heldMission.blockers.includes('critical-backlog-active-lane-not-affirmative'));

  const truncatedMission = buildAuthoritativeProgrammeProjection({
    ...base,
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      activeMission: { missionId: LANE_ID, issueNumber: 1497 },
    },
  });
  assert.equal(truncatedMission.status, 'HOLD');
  assert.ok(truncatedMission.blockers.includes('critical-backlog-active-lane-pr-missing'));
  assert.ok(truncatedMission.blockers.includes('critical-backlog-active-lane-repository-missing'));
  assert.ok(truncatedMission.blockers.includes('critical-backlog-active-lane-branch-missing'));
});

test('controller cycle and conveyor identity must affirm the exact idle selection', () => {
  const base = {
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: null,
    mutationLease: null,
    workerHeartbeatProjection: { valid: true, fresh: true, ageMs: 0 },
    executionReceipt: null,
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: {
      failClosed: false,
      selectedGoal: '#1497',
      decisionReceipt: { status: 'LANE_SELECTED', selectedIssue: 1497 },
    },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  };
  const stopped = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: { valid: true, fresh: true, cycleState: 'STOPPED' },
    criticalBacklog: {
      decision: 'CREATE_NEXT_MISSION',
      selectedItem: { issueNumbers: [1497] },
    },
  });
  assert.equal(stopped.status, 'HOLD');
  assert.ok(stopped.blockers.includes('controller-heartbeat-cycle-state-does-not-authorize-idle-selection'));

  const wrongMission = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: { valid: true, fresh: true, cycleState: 'IDLE' },
    criticalBacklog: {
      decision: 'CREATE_NEXT_MISSION',
      selectedItem: { issueNumbers: [1291] },
    },
  });
  assert.equal(wrongMission.status, 'HOLD');
  assert.ok(wrongMission.blockers.includes('critical-backlog-idle-selection-identity-mismatch'));

  const exact = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: { valid: true, fresh: true, cycleState: 'IDLE' },
    criticalBacklog: {
      decision: 'CREATE_NEXT_MISSION',
      selectedItem: { issueNumbers: [1497] },
    },
  });
  assert.equal(exact.status, 'READY');

  const continued = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: { valid: true, fresh: true, cycleState: 'RECONCILING' },
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      selectedItem: {
        issueNumbers: [1497],
        mission: {
          missionId: 'critical-1497-continuation',
          repository: REPOSITORY,
          branch: 'openclaw/critical-1497-continuation',
        },
      },
      activeMission: {
        missionId: 'critical-1497-continuation',
        repository: REPOSITORY,
        git: { branch: 'openclaw/critical-1497-continuation' },
      },
    },
  });
  assert.equal(continued.status, 'READY');

  const wrongContinuation = buildAuthoritativeProgrammeProjection({
    ...base,
    controllerHeartbeatProjection: { valid: true, fresh: true, cycleState: 'RECONCILING' },
    criticalBacklog: {
      decision: 'WAIT_ACTIVE_MISSION',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      selectedItem: {
        issueNumbers: [1497],
        mission: {
          missionId: 'critical-1497-continuation',
          repository: REPOSITORY,
          branch: 'openclaw/critical-1497-continuation',
        },
      },
      activeMission: {
        missionId: 'critical-1291-other',
        repository: REPOSITORY,
        git: { branch: 'openclaw/critical-1497-continuation' },
      },
    },
  });
  assert.equal(wrongContinuation.status, 'HOLD');
  assert.ok(wrongContinuation.blockers.includes(
    'critical-backlog-idle-selection-mission-mismatch',
  ));
});

test('terminal reconciliation requires the controller heartbeat to name the exact terminal lane', () => {
  const terminalLane = lane({
    github: github({
      prState: 'closed',
      merged: true,
      mergedAt: '2026-07-30T09:59:00.000Z',
      mergeCommitSha: MERGE,
    }),
  });
  const projection = buildAuthoritativeProgrammeProjection({
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: terminalLane,
    mutationLease: lease(),
    controllerHeartbeatProjection: {
      valid: true,
      fresh: true,
      cycleState: 'FINALIZING',
      activeLaneId: 'goal-1500-pr-1700',
    },
    workerHeartbeatProjection: { valid: true, fresh: true },
    executionReceipt: null,
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: { failClosed: false, selectedGoal: null, decisionReceipt: { status: 'MERGED' } },
    criticalBacklog: { decision: 'WAIT_ACTIVE_MISSION' },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  });
  assert.equal(projection.status, 'HOLD');
  assert.ok(projection.blockers.includes('controller-heartbeat-terminal-lane-mismatch'));

  const transitional = buildAuthoritativeProgrammeProjection({
    nowUtc: NOW,
    workspaceFeed: { state: 'ready' },
    lane: terminalLane,
    mutationLease: lease(),
    controllerHeartbeatProjection: {
      valid: true,
      fresh: true,
      cycleState: 'FINALIZING',
      activeLaneId: LANE_ID,
      reconciliationSucceeded: false,
      boundedMutationSteps: 0,
    },
    workerHeartbeatProjection: { valid: true, fresh: true },
    executionReceipt: null,
    battleBridgeProofs: [],
    runtimeHealthRecords: [],
    scheduler: { failClosed: false, selectedGoal: null, decisionReceipt: { status: 'MERGED' } },
    criticalBacklog: { decision: 'WAIT_ACTIVE_MISSION' },
    machineryInventory: { validation: { valid: true }, capabilities: [] },
  });
  assert.equal(transitional.status, 'HOLD');
  assert.ok(transitional.blockers.includes(
    'controller-heartbeat-terminal-lane-authority-unproven',
  ));
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
    lane: {
      active: true,
      terminal: false,
      issueNumber: 1497,
      prNumber: 1617,
      headSha: HEAD,
      repository: REPOSITORY,
      branch: BRANCH,
    },
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
  assert.ok(diagnosis.blockers.includes('active-lane-progress-stale'));

  const freshControllerOnly = diagnoseProgrammeStall({
    ...stalledProjection,
    controllerHeartbeat: { fresh: true, ageMs: 0 },
  }, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.equal(freshControllerOnly.stalled, true);
  assert.ok(freshControllerOnly.blockers.includes('active-lane-progress-stale'));
  assert.equal(freshControllerOnly.lastProgressAtUtc, '2026-07-30T09:00:00.000Z');

  const proofRecord = (overrides = {}) => ({
    ...createSharedWorkspaceProofRecord({
      proofId: 'programme-progress-proof',
      participantId: 'battle-bridge',
      timestampUtc: '2026-07-30T09:59:59.000Z',
      correlationId: LANE_ID,
      relatedIssue: '#1497',
      relatedPr: '#1617',
      proofRefs: ['proofs/programme-progress-proof.json'],
      refs: ['proofs/programme-progress-proof.json'],
      status: 'PASS',
    }),
    ...overrides,
  });
  const unrelatedAndFailedProofs = diagnoseProgrammeStall({
    ...stalledProjection,
    controllerHeartbeat: { fresh: true, ageMs: 0 },
    battleBridgeProofs: [
      proofRecord({ proofId: 'wrong-issue', relatedIssue: '#1' }),
      proofRecord({ proofId: 'failed-proof', status: 'FAILED' }),
    ],
  }, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.ok(unrelatedAndFailedProofs.blockers.includes('active-lane-progress-stale'));
  assert.equal(unrelatedAndFailedProofs.lastProgressAtUtc, '2026-07-30T09:00:00.000Z');

  const unboundProof = diagnoseProgrammeStall({
    ...stalledProjection,
    controllerHeartbeat: { fresh: true, ageMs: 0 },
    battleBridgeProofs: [proofRecord({
      issueNumber: 1497,
      prNumber: 1617,
      headSha: HEAD,
    })],
  }, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.ok(unboundProof.blockers.includes('active-lane-progress-stale'));
  assert.equal(unboundProof.lastProgressAtUtc, '2026-07-30T09:00:00.000Z');

  const exactProof = diagnoseProgrammeStall({
    ...stalledProjection,
    controllerHeartbeat: { fresh: true, ageMs: 0 },
    battleBridgeProofs: [proofRecord({
      issueNumber: 1497,
      prNumber: 1617,
      headSha: HEAD,
      repository: REPOSITORY,
      branch: BRANCH,
    })],
  }, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.equal(exactProof.stalled, false);
  assert.equal(exactProof.lastProgressAtUtc, '2026-07-30T09:59:59.000Z');

  for (const invalidAliases of [
    { issueNumber: null, relatedIssue: '#1497' },
    { repository: null, repositoryFullName: REPOSITORY },
  ]) {
    const invalidAliasProof = diagnoseProgrammeStall({
      ...stalledProjection,
      controllerHeartbeat: { fresh: true, ageMs: 0 },
      battleBridgeProofs: [proofRecord({
        issueNumber: 1497,
        prNumber: 1617,
        headSha: HEAD,
        repository: REPOSITORY,
        branch: BRANCH,
        ...invalidAliases,
      })],
    }, { nowUtc: NOW, stallAfterMs: 1_000 });
    assert.equal(invalidAliasProof.stalled, true);
    assert.ok(invalidAliasProof.blockers.includes('active-lane-progress-stale'));
    assert.equal(invalidAliasProof.lastProgressAtUtc, '2026-07-30T09:00:00.000Z');
  }

  const futureEvidence = diagnoseProgrammeStall({
    ...stalledProjection,
    controllerHeartbeat: { fresh: true, ageMs: 0 },
    executionReceipt: receipt({ timestampUtc: '2099-01-01T00:00:00.000Z' }),
    mutationLease: lease({ renewedAtUtc: '2099-01-01T00:00:00.000Z' }),
    battleBridgeProofs: [proofRecord({
      timestampUtc: '2099-01-01T00:00:00.000Z',
      issueNumber: 1497,
      prNumber: 1617,
      headSha: HEAD,
      repository: REPOSITORY,
      branch: BRANCH,
    })],
  }, { nowUtc: NOW, stallAfterMs: 1_000 });
  assert.equal(futureEvidence.stalled, true);
  assert.ok(futureEvidence.blockers.includes('active-lane-progress-evidence-missing'));
  assert.equal(futureEvidence.lastProgressAtUtc, null);

  const handler = createProgrammeStallMonitorHandler({
    loadProjection: async () => stalledProjection,
    stallAfterMs: 1_000,
  });
  const result = await handler({ timestampUtc: NOW });
  assert.equal(result.state, 'FAIL');
  assert.equal(result.diagnosis.monitorRuntime, 'monitor-multiplexer');
});
