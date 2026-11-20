import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_CLASS,
  PROVIDER_DEPENDENCY_MODE,
} from './providerIndependenceAdmissionGateV1.mjs';
import {
  PROVIDER_INDEPENDENCE_MISSION_DECISION,
  evaluateProviderIndependenceMissionAdmissionV1,
} from './providerIndependenceMissionAdmissionV1.mjs';

const NOW = '2026-08-19T22:20:00.000Z';

function route(overrides = {}) {
  return {
    routeId: 'github-review-v1',
    provider: PROVIDER_CLASS.GITHUB_HOSTED,
    taskClass: 'EXACT_HEAD_REVIEW',
    qualificationState: 'PRODUCTION_ELIGIBLE',
    active: true,
    portableCheckpointContract: 'mission-checkpoint-v1',
    receiptContract: 'execution-receipt-v1',
    proofRefs: ['proofs/provider-parity/github-review.json'],
    ...overrides,
  };
}

function dependency(overrides = {}) {
  return {
    providerDependencyId: 'exact-head-review-provider',
    capabilityClass: 'EXACT_HEAD_REVIEW',
    provider: PROVIDER_CLASS.CODEX,
    mode: PROVIDER_DEPENDENCY_MODE.OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK,
    whyProviderSpecific: 'Codex may provide optional specialist review capacity.',
    criticalPathImpact: 'CRITICAL_PATH',
    requiredTaskClass: 'EXACT_HEAD_REVIEW',
    nonProviderSpecificContract: 'provider-neutral-exact-head-review-v1',
    qualifiedAlternatives: ['github-review-v1'],
    portableCheckpointContract: 'mission-checkpoint-v1',
    receiptContract: 'execution-receipt-v1',
    failureBehaviour: 'ROUTE_AROUND_PROVIDER',
    operatorImpact: 'No operator impact while the qualified fallback remains healthy.',
    hardExternalBoundaryReason: '',
    parityProofRefs: ['proofs/provider-parity/github-review.json'],
    ...overrides,
  };
}

function gateInput(overrides = {}) {
  return {
    nowUtc: NOW,
    dependency: dependency(),
    parityRoutes: [route()],
    retiringRouteIds: [],
    exception: null,
    ...overrides,
  };
}

function mission(overrides = {}) {
  return {
    missionId: 'mission-review-1900-v1',
    goalIssue: 1900,
    repository: 'Cheekyfellastef/stephan-os',
    ...overrides,
  };
}

function evaluate(providerIndependenceInput = gateInput(), missionBinding = mission()) {
  return evaluateProviderIndependenceMissionAdmissionV1({
    missionBinding,
    providerIndependenceInput,
  });
}

test('qualified non-Codex parity becomes a scheduler admission and sovereignty projection', () => {
  const result = evaluate();
  assert.equal(result.schedulerProjection.eligible, true);
  assert.equal(result.schedulerProjection.decision, PROVIDER_INDEPENDENCE_MISSION_DECISION.ADMIT);
  assert.equal(result.schedulerProjection.providerIndependenceVerdict, 'PASS_EXISTING_QUALIFIED_PARITY');
  assert.deepEqual(result.schedulerProjection.selectedAlternativeRouteIds, ['github-review-v1']);
  assert.equal(result.sovereigntyProjection.finalVerdict, 'PASS_EXISTING_QUALIFIED_PARITY');
  assert.equal(result.sovereigntyProjection.concentrationRiskVisible, false);
});

test('Codex-only critical path becomes a scheduler hold while sovereignty keeps the risk visible', () => {
  const input = gateInput({
    dependency: dependency({
      mode: PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH,
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
  });
  const result = evaluate(input);
  assert.equal(result.schedulerProjection.eligible, false);
  assert.equal(result.schedulerProjection.decision, PROVIDER_INDEPENDENCE_MISSION_DECISION.HOLD_PROVIDER_INDEPENDENCE);
  assert.equal(result.schedulerProjection.providerIndependenceVerdict, 'BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH');
  assert.equal(result.schedulerProjection.holdReason, 'codex-or-work-is-sole-critical-path-provider');
  assert.equal(result.sovereigntyProjection.concentrationRiskVisible, true);
});

test('removal of the last qualified fallback is held before mission dispatch', () => {
  const input = gateInput({ retiringRouteIds: ['github-review-v1'] });
  const result = evaluate(input);
  assert.equal(result.schedulerProjection.eligible, false);
  assert.equal(result.schedulerProjection.providerIndependenceVerdict, 'BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT');
  assert.equal(result.authority.dispatchAllowed, false);
});

test('temporary bounded exception is eligible but remains visible and expiring', () => {
  const input = gateInput({
    dependency: dependency({
      mode: PROVIDER_DEPENDENCY_MODE.TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER,
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
    exception: {
      exceptionId: 'temporary-review-provider-gap',
      reason: 'Qualified fallback repair is still under review.',
      scope: 'EXACT_HEAD_REVIEW',
      owner: 'goal-1900',
      createdAt: '2026-08-19T20:00:00.000Z',
      expiresAt: '2026-08-20T20:00:00.000Z',
      blastRadius: 'Only exact-head review is temporarily constrained.',
      unblockedUnrelatedWork: true,
      fallbackBuildGoal: '#1574',
      proofRequiredToRemoveException: 'Fresh provider-neutral exact-head review receipt.',
      operatorApprovalRef: '#1900',
    },
  });
  const result = evaluate(input);
  assert.equal(result.schedulerProjection.eligible, true);
  assert.equal(result.schedulerProjection.decision, PROVIDER_INDEPENDENCE_MISSION_DECISION.ADMIT_TEMPORARY_EXCEPTION);
  assert.equal(result.sovereigntyProjection.concentrationRiskVisible, true);
  assert.equal(result.sovereigntyProjection.exceptionId, 'temporary-review-provider-gap');
  assert.equal(result.sovereigntyProjection.exceptionExpiresAt, '2026-08-20T20:00:00.000Z');
});

test('hard external boundary can remain scheduler-eligible while sovereignty exposes concentration risk', () => {
  const input = gateInput({
    dependency: dependency({
      provider: PROVIDER_CLASS.OTHER_NON_CODEX,
      mode: PROVIDER_DEPENDENCY_MODE.HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION,
      qualifiedAlternatives: [],
      hardExternalBoundaryReason: 'Vendor-owned signing ceremony has no substitute API.',
      failureBehaviour: 'CAPABILITY_BLOCKED_ONLY',
    }),
    parityRoutes: [],
  });
  const result = evaluate(input);
  assert.equal(result.schedulerProjection.eligible, true);
  assert.equal(result.sovereigntyProjection.concentrationRiskVisible, true);
  assert.equal(result.providerVerdict.hardExternalBoundary, true);
});

test('missing portable checkpoint becomes a precise scheduler hold', () => {
  const input = gateInput({ dependency: dependency({ portableCheckpointContract: '' }) });
  const result = evaluate(input);
  assert.equal(result.schedulerProjection.eligible, false);
  assert.equal(result.schedulerProjection.providerIndependenceVerdict, 'BLOCK_PORTABLE_CHECKPOINT_MISSING');
  assert.equal(result.schedulerProjection.holdReason, 'portable-checkpoint-contract-missing');
});

test('adapter never upgrades policy evidence into execution or mutation authority', () => {
  for (const result of [
    evaluate(),
    evaluate(gateInput({
      dependency: dependency({
        mode: PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH,
        qualifiedAlternatives: [],
      }),
      parityRoutes: [],
    })),
  ]) {
    for (const authority of [result.authority, result.schedulerProjection.authority, result.sovereigntyProjection.authority]) {
      assert.deepEqual(authority, {
        dispatchAllowed: false,
        sourceMutationAllowed: false,
        providerQualificationAuthority: false,
        mergeAuthority: false,
        deploymentAuthority: false,
        windowsRuntimeAuthority: false,
        openClawMutationAuthority: false,
        spendingOrAccountAuthority: false,
        leaseSeizureAllowed: false,
      });
    }
  }
});

test('mission binding is exact and cannot smuggle scheduler fields or arbitrary authority', () => {
  assert.throws(
    () => evaluate(gateInput(), mission({ dispatchAllowed: true })),
    /mission binding is invalid/,
  );
  assert.throws(
    () => evaluateProviderIndependenceMissionAdmissionV1({
      missionBinding: mission(),
      providerIndependenceInput: gateInput(),
      arbitraryCommand: 'run-anything',
    }),
    /closed-world input schema/,
  );
});

test('malformed provider evidence remains a hold rather than becoming scheduler truth', () => {
  const result = evaluate({
    nowUtc: NOW,
    dependency: { providerDependencyId: 'incomplete' },
    parityRoutes: [],
    retiringRouteIds: [],
    exception: null,
  });
  assert.equal(result.schedulerProjection.eligible, false);
  assert.equal(result.schedulerProjection.providerIndependenceVerdict, 'BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS');
});
