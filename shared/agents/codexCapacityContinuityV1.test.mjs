import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodexQueueRecord,
  transitionCodexQueueRecord,
} from './codexDispatchQueue.mjs';
import { createProviderFamilyRouteV1 } from './zeroOpenAiBuilderFailoverV1.mjs';
import {
  CODEX_CAPACITY_UNAVAILABLE,
  CODEX_CAPACITY_REROUTE_BLOCKED,
  CODEX_CAPACITY_REROUTE_READY,
  classifyCodexCapacityOutageV1,
  createCodexProviderNeutralHandoffV1,
} from './codexCapacityContinuityV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const NOW = '2026-09-21T08:50:00.000Z';

function approvedQueueRecord() {
  const created = createCodexQueueRecord({
    jobId: 'codex-capacity-reroute-test',
    issueNumber: 1624,
    branch: 'main',
    prompt: 'Implement the bounded source repair and preserve exact task identity.',
    requestedProofCommands: [
      'node --test shared/agents/codexCapacityContinuityV1.test.mjs',
      'git diff --check',
    ],
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 2312,
      expectedHead: HEAD,
    },
    createdAt: NOW,
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: true,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
    },
  });
  const waiting = transitionCodexQueueRecord(created, 'WAITING_OPERATOR_APPROVAL', {
    timestamp: NOW,
    reason: 'fixture approval required',
  });
  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', {
    timestamp: NOW,
    reason: 'fixture approval present',
    approvalReceipt: 'operator-approved-fixture',
  });
  return ready.record;
}

function context() {
  return {
    missionId: 'music-capacity-continuity',
    goalId: 'goal-1624',
    taskId: 'codex-capacity-reroute-test',
    taskClass: 'focused_repair',
    correlationId: 'music-capacity-continuity-1624',
    exactBase: BASE,
    readOnly: false,
    expectedStartingHeadIfMutable: HEAD,
    allowedPaths: ['shared/agents/codexCapacityContinuityV1.mjs'],
    allowedOperations: ['source_construction', 'focused_tests'],
    resourceLeaseIds: ['lease-music-capacity-continuity'],
    requiredArtifacts: [],
    completionContract: 'Complete the same bounded source task with grounded proof and no authority widening.',
    portableCheckpointRef: 'proof/codex-capacity-reroute.json',
    expiresAtUtc: '2026-09-21T09:50:00.000Z',
  };
}

function route(providerFamily, adapterId, priority = 10) {
  return createProviderFamilyRouteV1({
    routeId: `${adapterId}-focused-repair`,
    adapterId,
    providerFamily,
    capabilityHealth: {
      builderIgnition: 'HEALTHY',
      sourceImplementation: 'HEALTHY',
      publication: 'UNKNOWN',
      review: 'UNKNOWN',
    },
    qualifiedTaskClasses: ['focused_repair'],
    allowedOperations: ['source_construction', 'focused_tests'],
    priority,
    proofRef: `proof/${adapterId}-capacity`,
  });
}

test('classifies explicit meter and quota exhaustion as Codex capacity, not work failure', () => {
  for (const evidence of [
    { availability: 'METER_STALLED', remainingPercent: 0 },
    { stderr: 'You have reached your Codex usage limits for code reviews.' },
    { error: { code: 'insufficient_quota', message: 'quota exhausted' } },
    { blocker: 'CODEX_CAPACITY_UNAVAILABLE' },
  ]) {
    const result = classifyCodexCapacityOutageV1(evidence);
    assert.equal(result.outage, true);
    assert.equal(result.blocker, CODEX_CAPACITY_UNAVAILABLE);
    assert.equal(result.retryCodexAllowed, false);
    assert.equal(result.authorityChanged, false);
  }
  assert.equal(classifyCodexCapacityOutageV1({ stderr: 'SyntaxError: unexpected token' }).outage, false);
});

test('converts an approved Codex task into the same provider-neutral identity and selects a qualified non-OpenAI route', () => {
  const result = createCodexProviderNeutralHandoffV1({
    failure: { stderr: 'Codex usage limit reached; meter empty.' },
    queueRecord: approvedQueueRecord(),
    context: context(),
    requiredCapability: 'sourceImplementation',
    providerRoutes: [
      route('OPENAI', 'legacy-codex', 1),
      route('OPENCLAW', 'openclaw', 5),
      route('FORGE', 'forge', 10),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, CODEX_CAPACITY_REROUTE_READY);
  assert.equal(result.taskEnvelope.sourceAdapter, 'legacy-codex');
  assert.equal(result.taskEnvelope.taskId, 'codex-capacity-reroute-test');
  assert.equal(result.taskEnvelope.expectedStartingHeadIfMutable, HEAD);
  assert.equal(result.taskEnvelope.operatorApprovalState.dispatchApprovalPresent, true);
  assert.equal(result.selectedRoute.providerFamily, 'OPENCLAW');
  assert.equal(result.selectedRoute.adapterId, 'openclaw');
  assert.equal(result.preserveIdentity.missionId, 'music-capacity-continuity');
  assert.equal(result.preserveIdentity.taskId, 'codex-capacity-reroute-test');
  assert.deepEqual(result.authority, {
    sourceMutationAllowed: false,
    publicationAllowed: false,
    reviewAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    credentialAccessAllowed: false,
    spendingAllowed: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
});

test('parks only the task with a typed parity gap when no qualified non-Codex route exists', () => {
  const result = createCodexProviderNeutralHandoffV1({
    failure: { availability: 'METER_STALLED' },
    queueRecord: approvedQueueRecord(),
    context: context(),
    providerRoutes: [route('OPENAI', 'legacy-codex', 1)],
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, CODEX_CAPACITY_REROUTE_BLOCKED);
  assert.ok(['NON_OPENAI_PARITY_GAP', 'NO_QUALIFIED_NON_CODEX_ROUTE'].includes(result.blocker));
  assert.equal(result.taskEnvelope.taskId, 'codex-capacity-reroute-test');
});

test('does not manufacture a reroute when Codex capacity failure is not proven', () => {
  const result = createCodexProviderNeutralHandoffV1({
    failure: { stderr: 'unit test failed' },
    queueRecord: approvedQueueRecord(),
    context: context(),
    providerRoutes: [route('OPENCLAW', 'openclaw')],
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CODEX_CAPACITY_OUTAGE_NOT_PROVEN');
  assert.equal(result.taskEnvelope, null);
});
