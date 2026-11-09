import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_CONTINUATION_STATES,
  projectStephanosGoalContinuation,
} from './goalBuildingAgentV1.continuation.mjs';

const main = '1'.repeat(40);
const head = '2'.repeat(40);
const tree = '3'.repeat(40);

function checkpoint(overrides = {}) {
  return {
    checkpointId: 'resume-2002-1', missionId: 'mission-goal-building-continuity', goalId: '2002', canonicalOwnerId: 'goal-building-agent',
    repository: 'Cheekyfellastef/stephan-os', prNumber: 2003, branch: 'agent/goal-building-agent-v1', protectedMainHead: main,
    sourceHead: head, sourceTree: tree, phase: 'IMPLEMENT', allowedPaths: ['shared/agents/goalBuildingAgentV1.continuation.mjs'],
    leases: [{ leaseId: 'lease-continuation-1', resourceId: 'pr:2003', ownerId: 'goal-building-agent', disposition: 'ACTIVE' }],
    lastMaterialReceiptId: 'receipt-continuation-1', lastMaterialReceiptHead: head, blockers: [], operatorGate: false,
    nextLegalAction: 'Continue through the existing continuity controller.', createdAtUtc: '2026-09-04T09:10:00.000Z', ...overrides,
  };
}
function currentLeaseReadback(leases = checkpoint().leases, overrides = {}) {
  return {
    protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent',
    observedAtUtc: new Date().toISOString(),
    leases: leases.map((lease) => ({
      ...lease, expiresAtUtc: new Date(Date.now() + 120_000).toISOString(),
    })),
    ...overrides,
  };
}
function current(overrides = {}) {
  return {
    protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent',
    leaseReadback: currentLeaseReadback(), ...overrides,
  };
}
function candidate(overrides = {}) { return { goalId: '2002', missionId: 'mission-goal-building-continuity', canonicalOwnerId: 'goal-building-agent', schedulerEligible: true, qualifiedProviderAvailable: true, operatorGate: false, nextLegalAction: 'Continue through the existing continuity controller.', resourceIds: ['pr:2003'], ...overrides }; }

test('Stephanos may request the existing continuity controller to resume a proven same-owner mission', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate() });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(result.mayRequestExistingControllerContinuation, true);
  assert.equal(result.materialProgressRequiredBeforeControllerReturn, true);
  assert.ok(result.nonMaterialSignalsDoNotSatisfyProgress.includes('ACTION_DISPATCHED'));
  assert.ok(result.nonMaterialSignalsDoNotSatisfyProgress.includes('HEARTBEAT'));
  assert.equal(result.continuationTarget, 'EXISTING_1557_CONTINUITY_CONTROLLER');
  assert.equal(result.duplicateControllerForbidden, true);
  assert.equal(result.duplicateMissionForbidden, true);
  assert.equal(result.protectedMergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('operator-gated work is parked and asks only the existing refill machinery to fill independent capacity', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint({ operatorGate: true, phase: 'READY_FOR_OPERATOR_APPROVAL' }), current: current(), schedulerCandidate: candidate({ operatorGate: true }) });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.APPROVAL_PARKED_REFILL_ELIGIBLE);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, true);
  assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
});

test('main movement forces reproof but immediately releases independent construction capacity', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current({ protectedMainHead: '4'.repeat(40) }), schedulerCandidate: candidate() });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, true);
  assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
});

test('scheduler identity mismatch fails closed rather than creating a new owner or mission', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate({ missionId: 'different-mission' }) });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD);
  assert.ok(result.reasons.includes('scheduler-mission-mismatch'));
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, false);
  assert.equal(result.materialProgressRequiredBeforeControllerReturn, false);
});

test('main drift plus scheduler identity contradiction remains fail-closed', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current({ protectedMainHead: '4'.repeat(40) }), schedulerCandidate: candidate({ missionId: 'different-mission' }) });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD);
  assert.ok(result.reasons.includes('protected-main-moved-reprove-required'));
  assert.ok(result.reasons.includes('scheduler-mission-mismatch'));
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, false);
  assert.equal(result.refillTarget, '');
});

test('missing qualified provider parks only that route and refills the released lane', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate({ qualifiedProviderAvailable: false }) });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, true);
  assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
  assert.equal(result.materialProgressRequiredBeforeControllerReturn, true);
});

test('owned blocker is lane-scoped and cannot consume otherwise usable build capacity', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint({ blockers: [{ blockerId: 'review-gate', ownerId: 'review-factory', state: 'BLOCKED' }] }), current: current(), schedulerCandidate: candidate() });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED);
  assert.equal(result.mayRequestCapacityRefill, true);
  assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
});

test('no ACTIVE exact-resource source claim or material source proof can advertise AUTO_CONTINUE', () => {
  const originalLease = checkpoint().leases[0];
  const cases = [
    { label: 'missing leases', changes: { leases: [] }, reason: 'continuation-active-owned-resource-lease-unproven' },
    { label: 'only released lease', changes: { leases: [{ ...originalLease, disposition: 'RELEASED' }] }, reason: 'continuation-active-owned-resource-lease-unproven' },
    { label: 'only parked lease', changes: { leases: [{ ...originalLease, disposition: 'PARKED' }] }, reason: 'continuation-active-owned-resource-lease-unproven' },
    { label: 'wrong resource lease', changes: { leases: [{ ...originalLease, resourceId: 'pr:9999' }] }, reason: 'continuation-active-owned-resource-lease-unproven' },
    { label: 'no declared scheduler resources', candidateChanges: { resourceIds: [] }, reason: 'continuation-active-owned-resource-lease-unproven' },
    { label: 'missing source tree', changes: { sourceTree: '' }, reason: 'continuation-source-tree-unproven' },
    { label: 'malformed source tree', changes: { sourceTree: 'unproven' }, reason: 'continuation-source-tree-unproven' },
    { label: 'missing material receipt id', changes: { lastMaterialReceiptId: '' }, reason: 'continuation-exact-head-material-receipt-unproven' },
    { label: 'missing material receipt head', changes: { lastMaterialReceiptHead: '' }, reason: 'continuation-exact-head-material-receipt-unproven' },
    { label: 'stale material receipt head', changes: { lastMaterialReceiptHead: '4'.repeat(40) }, reason: 'continuation-exact-head-material-receipt-unproven' },
  ];
  for (const item of cases) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint(item.changes),
      current: current(),
      schedulerCandidate: candidate(item.candidateChanges),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED, item.label);
    assert.equal(result.mayRequestExistingControllerContinuation, false, item.label);
    assert.equal(result.continuationTarget, '', item.label);
    assert.equal(result.mayRequestCapacityRefill, true, item.label);
    assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL', item.label);
    assert.ok(result.reasons.includes(item.reason), item.label);
    assert.equal(result.protectedMergeAuthority, false, item.label);
    assert.equal(result.runtimeMutationAuthority, false, item.label);
  }
});

test('a competing ACTIVE source owner stays SAFE_HOLD even with an otherwise valid checkpoint', () => {
  const lease = checkpoint().leases[0];
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpoint({ leases: [{ ...lease, ownerId: 'other-writer' }] }),
    current: current(),
    schedulerCandidate: candidate(),
  });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD);
  assert.ok(result.reasons.includes('active-lease-owner-mismatch'));
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, false);
});

test('Goal #2002: missing scheduler principal identity cannot advertise AUTO_CONTINUE_ELIGIBLE', () => {
  const cases = [
    ['goalId', 'scheduler-goal-unproven'],
    ['missionId', 'scheduler-mission-unproven'],
    ['canonicalOwnerId', 'scheduler-owner-unproven'],
  ];
  for (const [field, reason] of cases) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint(),
      current: current(),
      schedulerCandidate: candidate({ [field]: '' }),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD, field);
    assert.ok(result.reasons.includes(reason), field);
    assert.equal(result.mayRequestExistingControllerContinuation, false, field);
    assert.equal(result.mayRequestCapacityRefill, false, field);
    assert.equal(result.continuationTarget, '', field);
    assert.equal(result.protectedMergeAuthority, false, field);
    assert.equal(result.runtimeMutationAuthority, false, field);
  }
  const allAbsent = projectStephanosGoalContinuation({
    checkpoint: checkpoint(), current: current(),
    schedulerCandidate: candidate({ goalId: '', missionId: '', canonicalOwnerId: '' }),
  });
  assert.deepEqual(allAbsent.reasons.filter(reason => reason.endsWith('-unproven')),
    cases.map(([, reason]) => reason));
  assert.equal(allAbsent.mayRequestExistingControllerContinuation, false);
});

test('Goal #2002: every scheduler resource needs its own exact ACTIVE same-owner lease', () => {
  const extra = 'pr:2004';
  const partial = projectStephanosGoalContinuation({
    checkpoint: checkpoint(),
    current: current(),
    schedulerCandidate: candidate({ resourceIds: ['pr:2003', extra] }),
  });
  assert.equal(partial.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED);
  assert.ok(partial.reasons.includes('continuation-active-owned-resource-lease-unproven'));
  assert.equal(partial.mayRequestExistingControllerContinuation, false);
  assert.equal(partial.continuationTarget, '');
  assert.equal(partial.runtimeMutationAuthority, false);
  const complete = projectStephanosGoalContinuation({
    checkpoint: checkpoint({ leases: [
      checkpoint().leases[0],
      { leaseId: 'lease-continuation-2', resourceId: extra, ownerId: 'goal-building-agent', disposition: 'ACTIVE' },
    ] }),
    current: current({ leaseReadback: currentLeaseReadback([
      checkpoint().leases[0],
      { leaseId: 'lease-continuation-2', resourceId: extra, ownerId: 'goal-building-agent', disposition: 'ACTIVE' },
    ]) }),
    schedulerCandidate: candidate({ resourceIds: ['pr:2003', extra] }),
  });
  assert.equal(complete.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(complete.mayRequestExistingControllerContinuation, true);
});

test('Goal #2002: oversized or control-character resource identities cannot alias an ACTIVE lease', () => {
  const prefix = 'r'.repeat(180);
  const lease = { ...checkpoint().leases[0], resourceId: prefix };
  const valid = projectStephanosGoalContinuation({
    checkpoint: checkpoint({ leases: [lease] }),
    current: current({ leaseReadback: currentLeaseReadback([lease]) }),
    schedulerCandidate: candidate({ resourceIds: [prefix] }),
  });
  assert.equal(valid.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  const cases = [
    { name: 'overlong candidate', lease, resources: [prefix + 'x'], reason: 'scheduler-resource-identity-invalid' },
    { name: 'overlong lease', lease: { ...lease, resourceId: prefix + 'x' }, resources: [prefix], reason: 'checkpoint-lease-resource-identity-invalid' },
    { name: 'hidden candidate newline', lease, resources: [prefix + '\n'], reason: 'scheduler-resource-identity-invalid' },
    { name: 'extra malformed candidate', lease, resources: [prefix, ''], reason: 'scheduler-resource-identity-invalid' },
  ];
  for (const item of cases) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint({ leases: [item.lease] }),
      current: current(),
      schedulerCandidate: candidate({ resourceIds: item.resources }),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD, item.name);
    assert.ok(result.reasons.includes(item.reason), item.name);
    assert.equal(result.mayRequestExistingControllerContinuation, false, item.name);
    assert.equal(result.mayRequestCapacityRefill, false, item.name);
    assert.equal(result.protectedMergeAuthority, false, item.name);
    assert.equal(result.runtimeMutationAuthority, false, item.name);
  }
});

test('original lease identities cannot be reused across resources, dispositions or owners', () => {
  const original = checkpoint().leases[0];
  const alternate = { leaseId: 'lease-continuation-2', resourceId: 'pr:2004', ownerId: 'goal-building-agent', disposition: 'ACTIVE' };
  const scenarios = [
    {
      name: 'one ID claimed for two distinct resources',
      leases: [original, { ...alternate, leaseId: original.leaseId }],
      resourceIds: ['pr:2003', 'pr:2004'],
      reason: 'checkpoint-lease-identity-conflict',
    },
    {
      name: 'same ID contradicts ACTIVE with RELEASED',
      leases: [original, { ...original, disposition: 'RELEASED' }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-identity-conflict',
    },
    {
      name: 'same ID contradicts ACTIVE with PARKED',
      leases: [original, { ...original, disposition: 'PARKED' }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-identity-conflict',
    },
    {
      name: 'same resource is claimed by distinct active IDs',
      leases: [original, { ...alternate, resourceId: original.resourceId }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-resource-conflict',
    },
    {
      name: 'same resource is ACTIVE under one ID and PARKED under another',
      leases: [original, { ...alternate, resourceId: original.resourceId, disposition: 'PARKED' }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-resource-conflict',
    },
    {
      name: 'redundant duplicate snapshot is not independent custody',
      leases: [original, { ...original }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-identity-conflict',
    },
    {
      name: 'noncanonical whitespace aliases the lease ID',
      leases: [{ ...original, leaseId: original.leaseId + ' ' }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-id-invalid',
    },
    {
      name: 'numeric lease ID cannot be coerced into authoritative identity',
      leases: [{ ...original, leaseId: 123 }],
      resourceIds: ['pr:2003'],
      reason: 'checkpoint-lease-id-invalid',
    },
  ];
  for (const scenario of scenarios) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint({ leases: scenario.leases }),
      current: current(),
      schedulerCandidate: candidate({ resourceIds: scenario.resourceIds }),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD, scenario.name);
    assert.equal(result.mayRequestExistingControllerContinuation, false, scenario.name);
    assert.equal(result.mayRequestCapacityRefill, false, scenario.name);
    assert.equal(result.continuationTarget, '', scenario.name);
    assert.equal(result.refillTarget, '', scenario.name);
    assert.ok(result.reasons.includes(scenario.reason), scenario.name);
    assert.equal(result.protectedMergeAuthority, false, scenario.name);
    assert.equal(result.runtimeMutationAuthority, false, scenario.name);
  }
  const distinctValid = projectStephanosGoalContinuation({
    checkpoint: checkpoint({ leases: [original, alternate] }),
    current: current({ leaseReadback: currentLeaseReadback([original, alternate]) }),
    schedulerCandidate: candidate({ resourceIds: ['pr:2003', 'pr:2004'] }),
  });
  assert.equal(distinctValid.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(distinctValid.mayRequestExistingControllerContinuation, true);
  assert.equal(distinctValid.protectedMergeAuthority, false);
  assert.equal(distinctValid.runtimeMutationAuthority, false);
});


test('a historical ACTIVE checkpoint cannot substitute for fresh exact-current live lease observations', () => {
  const original = checkpoint().leases[0];
  const live = currentLeaseReadback();
  const cases = [
    { label: 'missing current readback', value: current({ leaseReadback: undefined }), reason: 'continuation-current-lease-readback-unproven' },
    { label: 'missing current leases', value: current({ leaseReadback: { ...live, leases: [] } }), reason: 'continuation-current-active-lease-unproven' },
    { label: 'released current lease', value: current({ leaseReadback: currentLeaseReadback([{ ...original, disposition: 'RELEASED' }]) }), reason: 'continuation-current-lease-record-invalid' },
    { label: 'foreign current lease owner', value: current({ leaseReadback: currentLeaseReadback([{ ...original, ownerId: 'foreign-owner' }]) }), reason: 'continuation-current-active-lease-unproven' },
    { label: 'wrong current lease ID', value: current({ leaseReadback: currentLeaseReadback([{ ...original, leaseId: 'other-lease' }]) }), reason: 'continuation-current-active-lease-unproven' },
    { label: 'expired live lease', value: current({ leaseReadback: currentLeaseReadback([original], { leases: [{ ...original, expiresAtUtc: '2020-01-01T00:00:00.000Z' }] }) }), reason: 'continuation-current-lease-record-invalid' },
    { label: 'stale readback observation', value: current({ leaseReadback: currentLeaseReadback([original], { observedAtUtc: '2020-01-01T00:00:00.000Z' }) }), reason: 'continuation-current-lease-readback-stale' },
    { label: 'wrong readback source head', value: current({ leaseReadback: currentLeaseReadback([original], { sourceHead: '4'.repeat(40) }) }), reason: 'continuation-current-lease-readback-identity-mismatch' },
    { label: 'duplicate current lease identity', value: current({ leaseReadback: currentLeaseReadback([original, original]) }), reason: 'continuation-current-lease-identity-conflict' },
    { label: 'future-dated current lease observation', value: current({ leaseReadback: currentLeaseReadback([original], { observedAtUtc: new Date(Date.now() + 120_000).toISOString() }) }), reason: 'continuation-current-lease-readback-stale' },
    { label: 'wrong current main in readback', value: current({ leaseReadback: currentLeaseReadback([original], { protectedMainHead: '8'.repeat(40) }) }), reason: 'continuation-current-lease-readback-identity-mismatch' },
    { label: 'wrong current custodian in readback', value: current({ leaseReadback: currentLeaseReadback([original], { canonicalOwnerId: 'other-custodian' }) }), reason: 'continuation-current-lease-readback-identity-mismatch' },
    { label: 'missing exact live lease expiry', value: current({ leaseReadback: currentLeaseReadback([original], { leases: [{ ...original }] }) }), reason: 'continuation-current-lease-record-invalid' },
    { label: 'same resource with competing live lease IDs', value: current({ leaseReadback: currentLeaseReadback([original, { ...original, leaseId: 'other-live-lease' }]) }), reason: 'continuation-current-lease-identity-conflict' },
    { label: 'malformed live resource', value: current({ leaseReadback: currentLeaseReadback([{ ...original, resourceId: 'pr:2003\nx' }]) }), reason: 'continuation-current-lease-record-invalid' },
  ];
  for (const { label, value, reason } of cases) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint(), current: value, schedulerCandidate: candidate(),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED, label);
    assert.equal(result.mayRequestExistingControllerContinuation, false, label);
    assert.equal(result.continuationTarget, '', label);
    assert.ok(result.reasons.includes(reason), label);
    assert.equal(result.protectedMergeAuthority, false, label);
    assert.equal(result.runtimeMutationAuthority, false, label);
  }
});

test('Goal #2002: malformed scheduler operator gates never authorize continuation or refill', () => {
  const valid = projectStephanosGoalContinuation({
    checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate({ operatorGate: false }),
  });
  assert.equal(valid.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(valid.mayRequestExistingControllerContinuation, true);

  const expresslyGated = projectStephanosGoalContinuation({
    checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate({ operatorGate: true }),
  });
  assert.notEqual(expresslyGated.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(expresslyGated.mayRequestExistingControllerContinuation, false);

  for (const malformed of ['true', 'false', 1, 0, null, [], {}, '', undefined]) {
    const result = projectStephanosGoalContinuation({
      checkpoint: checkpoint(), current: current(),
      schedulerCandidate: candidate({ operatorGate: malformed }),
    });
    assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD, String(malformed));
    assert.ok(result.reasons.includes('scheduler-operator-gate-nonboolean'), String(malformed));
    assert.equal(result.mayRequestExistingControllerContinuation, false, String(malformed));
    assert.equal(result.mayRequestCapacityRefill, false, String(malformed));
    assert.equal(result.continuationTarget, '', String(malformed));
    assert.equal(result.refillTarget, '', String(malformed));
    assert.equal(result.protectedMergeAuthority, false, String(malformed));
    assert.equal(result.runtimeMutationAuthority, false, String(malformed));
  }
});
