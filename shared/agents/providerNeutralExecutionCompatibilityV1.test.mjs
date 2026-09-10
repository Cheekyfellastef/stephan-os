import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodexQueueRecord,
} from './codexDispatchQueue.mjs';
import {
  PROVIDER_NEUTRAL_HARD_DENIALS_V1,
  adaptLegacyCodexQueueRecordV1,
  createProviderNeutralResultEnvelope,
  createProviderNeutralTaskEnvelope,
  planContinuousCapacityRefillV1,
  validateProviderNeutralResultEnvelope,
  validateProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';

const BASE = '49f5b253e991fb94afa45dbcc0a3b4d9a9ef9b2f';
const HEAD = 'b91c1ffd961069ee80d585d77d426ab5665eaa24';
const CREATED = '2026-08-21T20:30:00Z';
const EXPIRES = '2026-08-21T21:30:00Z';

function legacyQueueRecord(overrides = {}) {
  return createCodexQueueRecord({
    issueNumber: 1947,
    branch: 'agent/provider-neutral-execution-compatibility-v1',
    prompt: 'Prove the provider-neutral execution compatibility shim without changing the legacy worker.',
    requestedProofCommands: [
      'node --test shared/agents/providerNeutralExecutionCompatibilityV1.test.mjs',
      'git diff --check',
    ],
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1948,
      expectedHead: HEAD,
      proofTarget: 'PULL_REQUEST_HEAD',
      proofScenario: 'provider-neutral-compatibility-v1',
    },
    proofRequirements: {
      refs: ['proof/provider-neutral-execution-compatibility-v1.json'],
      verifierTypes: ['ProofReferenceVerifier'],
    },
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: false,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
    },
    createdAt: CREATED,
    ...overrides,
  });
}

function legacyContext(overrides = {}) {
  return {
    missionId: 'mission-1947-provider-neutral-compatibility',
    goalId: 'goal-1947',
    taskClass: 'deterministic-test',
    correlationId: 'corr-1947-legacy-codex',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'agent/provider-neutral-execution-compatibility-v1',
    exactBase: BASE,
    readOnly: true,
    allowedPaths: [
      'shared/agents/providerNeutralExecutionCompatibilityV1.mjs',
      'shared/agents/providerNeutralExecutionCompatibilityV1.test.mjs',
    ],
    allowedOperations: ['read', 'test'],
    forbiddenOperations: [...PROVIDER_NEUTRAL_HARD_DENIALS_V1],
    timeoutAndRetryBudget: { timeoutMs: 300_000, maxAttempts: 2 },
    resourceLeaseIds: ['lease-provider-neutral-1947'],
    requiredArtifacts: ['proofs/provider-neutral-execution-compatibility-v1.json'],
    completionContract: 'PROVIDER_NEUTRAL_EXECUTION_COMPATIBILITY_TEST_PASS',
    portableCheckpointRef: 'receipts/provider-neutral-compatibility-checkpoint.json',
    createdAtUtc: CREATED,
    expiresAtUtc: EXPIRES,
    ...overrides,
  };
}

function adaptedLegacyTask(contextOverrides = {}, recordOverrides = {}) {
  const adapted = adaptLegacyCodexQueueRecordV1(
    legacyQueueRecord(recordOverrides),
    legacyContext(contextOverrides),
  );
  assert.equal(adapted.ok, true, JSON.stringify(adapted));
  return adapted.envelope;
}

function independentTask({
  provider = 'forge',
  suffix = 'forge',
  lease = `lease-${suffix}`,
  approvalRequired = false,
  approvalPresent = false,
} = {}) {
  return createProviderNeutralTaskEnvelope({
    missionId: 'mission-1947-provider-neutral-compatibility',
    goalId: 'goal-1947',
    taskId: `task-${suffix}`,
    taskClass: 'deterministic-test',
    correlationId: `corr-${suffix}`,
    repository: 'Cheekyfellastef/stephan-os',
    branch: `agent/${suffix}-provider-neutral-proof-v1`,
    exactBase: BASE,
    exactHeadIfReadOnly: HEAD,
    allowedPaths: [`shared/agents/${suffix}ProviderNeutralFixture.mjs`],
    allowedOperations: ['read', 'test'],
    allowedCommandsOrTestIds: [`${suffix}-test-v1`],
    forbiddenOperations: [...PROVIDER_NEUTRAL_HARD_DENIALS_V1],
    timeoutAndRetryBudget: { timeoutMs: 120_000, maxAttempts: 1 },
    resourceLeaseIds: [lease],
    requiredTests: [`${suffix}-test-v1`],
    requiredArtifacts: [`proofs/${suffix}-provider-neutral.json`],
    requiredEvidence: [`proof/${suffix}-provider-neutral.json`],
    completionContract: `${suffix.toUpperCase()}_PROVIDER_NEUTRAL_PASS`,
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: approvalRequired,
      dispatchApprovalPresent: approvalPresent,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: `receipts/${suffix}-checkpoint.json`,
    createdAtUtc: CREATED,
    expiresAtUtc: EXPIRES,
    sourceAdapter: provider,
  });
}

test('legacy Codex queue record adapts without rewriting its worker contract', () => {
  const record = legacyQueueRecord();
  const adapted = adaptLegacyCodexQueueRecordV1(record, legacyContext());
  assert.equal(adapted.ok, true);
  assert.equal(adapted.finalVerdict, 'LEGACY_CODEX_QUEUE_ADAPTED_TO_PROVIDER_NEUTRAL_TASK_V1');
  assert.equal(adapted.legacyIdentity.jobId, record.jobId);
  assert.equal(adapted.envelope.taskId, record.jobId);
  assert.equal(adapted.envelope.goalId, 'goal-1947');
  assert.equal(adapted.envelope.sourceAdapter, 'legacy-codex');
  assert.equal(adapted.envelope.exactHeadIfReadOnly, HEAD);
  assert.equal(adapted.envelope.expectedStartingHeadIfMutable, '');
  assert.deepEqual(adapted.envelope.allowedCommandsOrTestIds, record.requestedProofCommands);
  assert.deepEqual(adapted.envelope.requiredTests, record.requestedProofCommands);
  assert.deepEqual(adapted.envelope.requiredEvidence, record.proofRequirements.refs);
  assert.equal(validateProviderNeutralTaskEnvelope(adapted.envelope).valid, true);
  assert.equal(adapted.authority.sourceMutationAllowed, false);
  assert.equal(adapted.authority.mergeAllowed, false);
  assert.equal(adapted.authority.runtimeMutationAllowed, false);
});

test('legacy adapter fails closed on invalid queue truth, repository drift and branch drift', () => {
  const record = legacyQueueRecord();
  const tampered = { ...record, status: 'DONE' };
  assert.equal(adaptLegacyCodexQueueRecordV1(tampered, legacyContext()).blocker, 'LEGACY_CODEX_QUEUE_RECORD_INVALID');
  assert.equal(
    adaptLegacyCodexQueueRecordV1(record, legacyContext({ repository: 'OtherOwner/other-repo' })).blocker,
    'LEGACY_CODEX_QUEUE_REPOSITORY_MISMATCH',
  );
  assert.equal(
    adaptLegacyCodexQueueRecordV1(record, legacyContext({ branch: 'agent/wrong-branch' })).blocker,
    'LEGACY_CODEX_QUEUE_BRANCH_MISMATCH',
  );
});

test('task envelope rejects path escape, source ambiguity and authority widening', () => {
  const clean = independentTask();
  assert.equal(validateProviderNeutralTaskEnvelope(clean).valid, true);

  const escaped = Object.freeze({ ...clean, allowedPaths: Object.freeze(['../outside']) });
  assert.equal(validateProviderNeutralTaskEnvelope(escaped).errors.includes('allowed-paths-invalid'), true);

  const ambiguous = Object.freeze({ ...clean, expectedStartingHeadIfMutable: BASE });
  assert.equal(
    validateProviderNeutralTaskEnvelope(ambiguous).errors.includes('exactly-one-source-head-mode-required'),
    true,
  );

  const widened = Object.freeze({ ...clean, allowedOperations: Object.freeze(['read', 'merge']) });
  assert.equal(validateProviderNeutralTaskEnvelope(widened).errors.includes('authority-widening-operation'), true);

  const missingDenials = Object.freeze({ ...clean, forbiddenOperations: Object.freeze(['merge']) });
  assert.equal(validateProviderNeutralTaskEnvelope(missingDenials).errors.includes('hard-denials-missing'), true);
});

test('result envelope is exact-task bound and cannot report authority or path outside the task', () => {
  const task = adaptedLegacyTask();
  const result = createProviderNeutralResultEnvelope({
    provider: 'legacy-codex',
    providerInstance: 'codex-worker-v1',
    providerVersion: 'v1',
    taskClass: task.taskClass,
    missionId: task.missionId,
    goalId: task.goalId,
    taskId: task.taskId,
    correlationId: task.correlationId,
    exactInputIdentity: HEAD,
    exactOutputIdentity: HEAD,
    authorityUsed: ['read', 'test'],
    commandsOrTestIdsExecuted: task.allowedCommandsOrTestIds,
    changedPaths: [],
    artifacts: ['proofs/provider-neutral-execution-compatibility-v1.json'],
    proofRefs: task.requiredEvidence,
    portableCheckpointRef: task.portableCheckpointRef,
    startedAtUtc: '2026-08-21T20:31:00Z',
    completedAtUtc: '2026-08-21T20:32:00Z',
    verdict: 'complete',
    blockers: [],
    retryState: 'none',
    leaseDisposition: 'released',
  });
  assert.equal(validateProviderNeutralResultEnvelope(result, task).valid, true);

  const wrongTask = Object.freeze({ ...result, taskId: 'task-other' });
  assert.equal(validateProviderNeutralResultEnvelope(wrongTask, task).errors.includes('taskId-mismatch'), true);

  const widened = Object.freeze({ ...result, authorityUsed: Object.freeze(['read', 'merge']) });
  const widenedValidation = validateProviderNeutralResultEnvelope(widened, task);
  assert.equal(widenedValidation.errors.includes('authority-used-outside-task'), true);
  assert.equal(widenedValidation.errors.includes('authority-used-invalid'), true);

  const escaped = Object.freeze({ ...result, changedPaths: Object.freeze(['shared/agents/unowned.mjs']) });
  assert.equal(validateProviderNeutralResultEnvelope(escaped, task).errors.includes('changed-path-outside-task'), true);
});

test('one capacity-release receipt produces one zero-authority refill evaluation', () => {
  const task = adaptedLegacyTask();
  const event = {
    trigger: 'TASK_COMPLETE',
    eventId: 'receipt-complete-1947-a',
    correlationId: 'corr-release-1947-a',
    releasedSlots: 1,
  };
  const plan = planContinuousCapacityRefillV1({
    releaseEvent: event,
    seenEventKeys: [],
    activeLeaseIds: [],
    schedulerDecision: { selectedTasks: [task] },
  });
  assert.equal(plan.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_READY');
  assert.equal(plan.refillRequests.length, 1);
  assert.equal(plan.refillRequests[0].taskId, task.taskId);
  assert.equal(plan.authority.dispatchAllowed, false);
  assert.equal(plan.authority.sourceMutationAllowed, false);
  assert.equal(plan.authority.mergeAllowed, false);

  const replay = planContinuousCapacityRefillV1({
    releaseEvent: event,
    seenEventKeys: [plan.eventKey],
    activeLeaseIds: [],
    schedulerDecision: { selectedTasks: [task] },
  });
  assert.equal(replay.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_ALREADY_EVALUATED');
  assert.equal(replay.refillRequests.length, 0);
});

test('approval-gated work is held while another eligible task can refill the lane', () => {
  const gated = independentTask({ suffix: 'approval-gated', approvalRequired: true, approvalPresent: false });
  const eligible = independentTask({ suffix: 'eligible' });
  assert.equal(validateProviderNeutralTaskEnvelope(gated).valid, true);
  const plan = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'LANE_CAPACITY_RELEASED',
      eventId: 'lane-release-1947-a',
      correlationId: 'corr-lane-release-1947-a',
      releasedSlots: 1,
    },
    schedulerDecision: { selectedTasks: [gated, eligible] },
  });
  assert.equal(plan.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_READY');
  assert.equal(plan.refillRequests[0].taskId, eligible.taskId);
  assert.equal(plan.heldTasks.some((item) => item.taskId === gated.taskId && item.reason === 'OPERATOR_APPROVAL_REQUIRED'), true);
});

test('two resource-disjoint lanes refill in parallel but active leases remain held', () => {
  const forge = independentTask({ suffix: 'forge-a', provider: 'forge', lease: 'lease-forge-a' });
  const openclaw = independentTask({ suffix: 'openclaw-a', provider: 'openclaw', lease: 'lease-openclaw-a' });
  const plan = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'PROVIDER_CAPACITY_BECAME_AVAILABLE',
      eventId: 'provider-capacity-1947-a',
      correlationId: 'corr-provider-capacity-1947-a',
      releasedSlots: 2,
    },
    activeLeaseIds: [],
    schedulerDecision: { selectedTasks: [forge, openclaw] },
  });
  assert.equal(plan.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_READY');
  assert.deepEqual(plan.refillRequests.map((item) => item.taskId), [forge.taskId, openclaw.taskId]);

  const blocked = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'PROVIDER_CAPACITY_BECAME_AVAILABLE',
      eventId: 'provider-capacity-1947-b',
      correlationId: 'corr-provider-capacity-1947-b',
      releasedSlots: 2,
    },
    activeLeaseIds: ['lease-forge-a'],
    schedulerDecision: { selectedTasks: [forge, openclaw] },
  });
  assert.deepEqual(blocked.refillRequests.map((item) => item.taskId), [openclaw.taskId]);
  assert.equal(blocked.heldTasks.some((item) => item.taskId === forge.taskId && item.reason === 'RESOURCE_LEASE_ACTIVE'), true);
});

test('duplicate lease selection cannot manufacture two mutation owners', () => {
  const first = independentTask({ suffix: 'lease-first', lease: 'lease-shared-resource' });
  const second = independentTask({ suffix: 'lease-second', provider: 'openclaw', lease: 'lease-shared-resource' });
  const plan = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'TASK_BLOCKED_AND_LEASE_RELEASED',
      eventId: 'lease-release-1947-a',
      correlationId: 'corr-lease-release-1947-a',
      releasedSlots: 2,
    },
    schedulerDecision: { selectedTasks: [first, second] },
  });
  assert.equal(plan.refillRequests.length, 1);
  assert.equal(plan.refillRequests[0].taskId, first.taskId);
  assert.equal(plan.heldTasks.some((item) => item.taskId === second.taskId && item.reason === 'RESOURCE_LEASE_DUPLICATE'), true);
});

test('no eligible work and malformed release events remain truthful and inert', () => {
  const idle = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'TASK_CANCELLED_AND_LEASE_RELEASED',
      eventId: 'cancel-release-1947-a',
      correlationId: 'corr-cancel-release-1947-a',
      releasedSlots: 1,
    },
    schedulerDecision: { selectedTasks: [] },
  });
  assert.equal(idle.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_IDLE_NO_ELIGIBLE_WORK');
  assert.deepEqual(idle.refillRequests, []);

  const malformed = planContinuousCapacityRefillV1({
    releaseEvent: {
      trigger: 'ARBITRARY_WAKE',
      eventId: 'bad-release-1947-a',
      correlationId: 'corr-bad-release-1947-a',
    },
    schedulerDecision: { selectedTasks: [independentTask()] },
  });
  assert.equal(malformed.finalVerdict, 'CONTINUOUS_CAPACITY_REFILL_BLOCKED');
  assert.equal(malformed.blocker, 'REFILL_RELEASE_EVENT_INVALID');
  assert.deepEqual(malformed.refillRequests, []);
});
