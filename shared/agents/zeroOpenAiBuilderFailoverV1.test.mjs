import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_NEUTRAL_HARD_DENIALS_V1,
  createProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';
import {
  createProviderFamilyRouteV1,
  planProviderIndependentBuilderIgnitionV1,
  planProviderIndependentCapacityRefillV1,
  validateProviderFamilyRouteV1,
} from './zeroOpenAiBuilderFailoverV1.mjs';

const BASE = 'b312160001b0e89667e6a384dd9df5bc391944d0';
const HEAD = '88946c2805a8000c0f2e2239a80ffedd8d1591fe';
const CREATED = '2026-09-02T14:00:00Z';
const EXPIRES = '2026-09-02T15:00:00Z';

function task({
  suffix = 'source-a',
  sourceAdapter = 'github-first',
  taskClass = 'bounded-source-repair',
  lease = `lease-${suffix}`,
  branch = `fix/${suffix}`,
  allowedPaths = [`shared/agents/${suffix}.mjs`],
  allowedOperations = ['read', 'test'],
} = {}) {
  return createProviderNeutralTaskEnvelope({
    missionId: 'mission-zero-openai-builders',
    goalId: 'goal-2098',
    taskId: `task-${suffix}`,
    taskClass,
    correlationId: `corr-${suffix}`,
    repository: 'Cheekyfellastef/stephan-os',
    branch,
    exactBase: BASE,
    exactHeadIfReadOnly: HEAD,
    allowedPaths,
    allowedOperations,
    allowedCommandsOrTestIds: [`${suffix}-test-v1`],
    forbiddenOperations: [...PROVIDER_NEUTRAL_HARD_DENIALS_V1],
    timeoutAndRetryBudget: { timeoutMs: 120_000, maxAttempts: 1 },
    resourceLeaseIds: [lease],
    requiredTests: [`${suffix}-test-v1`],
    requiredArtifacts: [`proofs/${suffix}.json`],
    requiredEvidence: [`proof/${suffix}.json`],
    completionContract: `${suffix.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASS`,
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: false,
      dispatchApprovalPresent: false,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: `receipts/${suffix}-checkpoint.json`,
    createdAtUtc: CREATED,
    expiresAtUtc: EXPIRES,
    sourceAdapter,
  });
}

function route({
  routeId,
  adapterId,
  providerFamily,
  taskClasses = ['bounded-source-repair'],
  allowedOperations = ['read', 'test'],
  builderIgnition = 'HEALTHY',
  sourceImplementation = 'HEALTHY',
  publication = 'HEALTHY',
  review = 'HEALTHY',
  priority = 100,
} = {}) {
  return createProviderFamilyRouteV1({
    routeId,
    adapterId,
    providerFamily,
    capabilityHealth: {
      builderIgnition,
      sourceImplementation,
      publication,
      review,
    },
    qualifiedTaskClasses: taskClasses,
    allowedOperations,
    priority,
    proofRef: `proof/${routeId}`,
  });
}

function openAiGitHubBlocked(overrides = {}) {
  return route({
    routeId: 'chatgpt-github',
    adapterId: 'github-first',
    providerFamily: 'OPENAI',
    builderIgnition: 'WRITE_BLOCKED',
    sourceImplementation: 'WRITE_BLOCKED',
    publication: 'WRITE_BLOCKED',
    review: 'CAPACITY_UNAVAILABLE',
    priority: 10,
    ...overrides,
  });
}

function openClawHealthy(overrides = {}) {
  return route({
    routeId: 'openclaw-local',
    adapterId: 'openclaw',
    providerFamily: 'OPENCLAW',
    priority: 20,
    ...overrides,
  });
}

function forgeHealthy(overrides = {}) {
  return route({
    routeId: 'forge-local',
    adapterId: 'forge',
    providerFamily: 'FORGE',
    priority: 30,
    ...overrides,
  });
}

test('provider-family route validation is closed-world and preserves per-capability health', () => {
  const candidate = openAiGitHubBlocked();
  const validation = validateProviderFamilyRouteV1(candidate);
  assert.equal(validation.valid, true, JSON.stringify(validation));
  assert.equal(candidate.providerFamily, 'OPENAI');
  assert.equal(candidate.capabilityHealth.sourceImplementation, 'WRITE_BLOCKED');
  assert.equal(candidate.capabilityHealth.publication, 'WRITE_BLOCKED');

  const widened = Object.freeze({ ...candidate, hiddenAuthority: true });
  assert.equal(validateProviderFamilyRouteV1(widened).errors.includes('route-fields-invalid'), true);
});

test('builder ignition routes the same task to OpenClaw when ChatGPT GitHub mutation is blocked', () => {
  const sourceTask = task();
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'builder-start-2098-a',
    correlationId: 'corr-builder-start-2098-a',
    requestedSlots: 1,
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [openAiGitHubBlocked(), openClawHealthy()],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY');
  assert.equal(plan.ignitionRequests.length, 1);
  assert.equal(plan.ignitionRequests[0].taskId, sourceTask.taskId);
  assert.equal(plan.ignitionRequests[0].taskEnvelope, sourceTask);
  assert.equal(plan.ignitionRequests[0].exactSourceIdentity, HEAD);
  assert.deepEqual(plan.ignitionRequests[0].resourceLeaseIds, sourceTask.resourceLeaseIds);
  assert.equal(plan.ignitionRequests[0].selectedRoute.providerFamily, 'OPENCLAW');
  assert.equal(plan.ignitionRequests[0].selectedRoute.adapterId, 'openclaw');
  assert.equal(plan.ignitionRequests[0].selectedRoute.failover, true);
  assert.equal(plan.ignitionRequests[0].selectedRoute.originalProviderBlocked, true);
  assert.equal(plan.authority.dispatchAllowed, false);
  assert.equal(plan.authority.sourceMutationAllowed, false);
  assert.equal(plan.authority.mergeAllowed, false);
});

test('one blocked OpenAI-only task cannot starve a healthy Forge task behind it', () => {
  const blocked = task({
    suffix: 'openai-only',
    taskClass: 'openai-specialist-fixture',
    lease: 'lease-openai-only',
  });
  const forgeTask = task({
    suffix: 'forge-ready',
    sourceAdapter: 'forge',
    taskClass: 'forge-fixture',
    lease: 'lease-forge-ready',
  });
  const plan = planProviderIndependentCapacityRefillV1({
    releaseEvent: {
      trigger: 'LANE_CAPACITY_RELEASED',
      eventId: 'release-provider-health-a',
      correlationId: 'corr-release-provider-health-a',
      releasedSlots: 1,
    },
    schedulerDecision: { selectedTasks: [blocked, forgeTask] },
    providerRoutes: [
      openAiGitHubBlocked({ taskClasses: ['openai-specialist-fixture'] }),
      forgeHealthy({ taskClasses: ['forge-fixture'] }),
    ],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_REFILL_READY');
  assert.equal(plan.refillRequests.length, 1);
  assert.equal(plan.refillRequests[0].taskId, forgeTask.taskId);
  assert.equal(plan.refillRequests[0].selectedRoute.providerFamily, 'FORGE');
  assert.equal(plan.heldTasks.some((item) => item.taskId === blocked.taskId && item.reason === 'NON_OPENAI_PARITY_GAP'), true);
});

test('complete OpenAI blackout can still ignite two resource-disjoint non-OpenAI builders', () => {
  const first = task({ suffix: 'blackout-openclaw', sourceAdapter: 'openclaw', lease: 'lease-blackout-openclaw' });
  const second = task({ suffix: 'blackout-forge', sourceAdapter: 'forge', lease: 'lease-blackout-forge' });
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'zero-openai-blackout-a',
    correlationId: 'corr-zero-openai-blackout-a',
    requestedSlots: 2,
    openAiBlackout: true,
    schedulerDecision: { selectedTasks: [first, second] },
    providerRoutes: [
      openAiGitHubBlocked(),
      openClawHealthy(),
      forgeHealthy(),
    ],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY');
  assert.deepEqual(plan.ignitionRequests.map((item) => item.taskId), [first.taskId, second.taskId]);
  assert.deepEqual(plan.ignitionRequests.map((item) => item.selectedRoute.providerFamily), ['OPENCLAW', 'FORGE']);
  assert.ok(plan.ignitionRequests.every((item) => item.selectedRoute.providerFamily !== 'OPENAI'));
});

test('OpenAI blackout forces non-OpenAI substitution even when the OpenAI route reports healthy', () => {
  const sourceTask = task();
  const healthyOpenAi = route({
    routeId: 'chatgpt-github-healthy',
    adapterId: 'github-first',
    providerFamily: 'OPENAI',
    priority: 1,
  });
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'blackout-forced-substitution-a',
    correlationId: 'corr-blackout-forced-substitution-a',
    openAiBlackout: true,
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [healthyOpenAi, openClawHealthy()],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY');
  assert.equal(plan.ignitionRequests[0].selectedRoute.providerFamily, 'OPENCLAW');
});

test('healthy original provider remains selected when no failover condition exists', () => {
  const forgeTask = task({ suffix: 'forge-original', sourceAdapter: 'forge' });
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'healthy-original-a',
    correlationId: 'corr-healthy-original-a',
    schedulerDecision: { selectedTasks: [forgeTask] },
    providerRoutes: [forgeHealthy()],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY');
  assert.equal(plan.ignitionRequests[0].selectedRoute.providerFamily, 'FORGE');
  assert.equal(plan.ignitionRequests[0].selectedRoute.failover, false);
  assert.equal(plan.ignitionRequests[0].selectedRoute.originalProviderBlocked, false);
});

test('missing non-OpenAI parity fails closed instead of selecting a blocked OpenAI writer', () => {
  const sourceTask = task();
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'parity-gap-a',
    correlationId: 'corr-parity-gap-a',
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [openAiGitHubBlocked()],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_HELD');
  assert.deepEqual(plan.ignitionRequests, []);
  assert.equal(plan.heldTasks.some((item) => item.taskId === sourceTask.taskId && item.reason === 'NON_OPENAI_PARITY_GAP'), true);
});

test('active leases and duplicate resource ownership remain blocking during provider failover', () => {
  const first = task({ suffix: 'lease-a', lease: 'lease-shared' });
  const second = task({ suffix: 'lease-b', lease: 'lease-shared', branch: 'fix/lease-b' });
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'lease-guard-a',
    correlationId: 'corr-lease-guard-a',
    requestedSlots: 2,
    schedulerDecision: { selectedTasks: [first, second] },
    providerRoutes: [openAiGitHubBlocked(), openClawHealthy()],
  });
  assert.equal(plan.ignitionRequests.length, 1);
  assert.equal(plan.heldTasks.some((item) => item.taskId === second.taskId && item.reason === 'RESOURCE_LEASE_DUPLICATE'), true);

  const active = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'lease-guard-b',
    correlationId: 'corr-lease-guard-b',
    schedulerDecision: { selectedTasks: [first] },
    activeLeaseIds: ['lease-shared'],
    providerRoutes: [openAiGitHubBlocked(), openClawHealthy()],
  });
  assert.deepEqual(active.ignitionRequests, []);
  assert.equal(active.heldTasks.some((item) => item.taskId === first.taskId && item.reason === 'RESOURCE_LEASE_ACTIVE'), true);
});

test('builder ignition evaluation is idempotent across replay', () => {
  const sourceTask = task();
  const ignitionId = 'idempotent-builder-start-a';
  const correlationId = 'corr-idempotent-builder-start-a';
  const first = planProviderIndependentBuilderIgnitionV1({
    ignitionId,
    correlationId,
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [openAiGitHubBlocked(), openClawHealthy()],
  });
  assert.equal(first.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY');

  const replay = planProviderIndependentBuilderIgnitionV1({
    ignitionId,
    correlationId,
    seenIgnitionKeys: [first.ignitionKey],
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [openAiGitHubBlocked(), openClawHealthy()],
  });
  assert.equal(replay.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_ALREADY_EVALUATED');
  assert.deepEqual(replay.ignitionRequests, []);
});

test('unknown provider health is not treated as usable builder capacity', () => {
  const sourceTask = task({ sourceAdapter: 'openclaw' });
  const unknownRoute = openClawHealthy({ sourceImplementation: 'UNKNOWN' });
  const plan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: 'unknown-health-a',
    correlationId: 'corr-unknown-health-a',
    schedulerDecision: { selectedTasks: [sourceTask] },
    providerRoutes: [unknownRoute],
  });
  assert.equal(plan.finalVerdict, 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_HELD');
  assert.deepEqual(plan.ignitionRequests, []);
  assert.equal(plan.heldTasks.some((item) => item.taskId === sourceTask.taskId && item.reason === 'NO_HEALTHY_QUALIFIED_PROVIDER_ROUTE'), true);
});
