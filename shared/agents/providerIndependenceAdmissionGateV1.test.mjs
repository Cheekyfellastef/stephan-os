import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_CLASS,
  PROVIDER_DEPENDENCY_MODE,
  PROVIDER_INDEPENDENCE_ADMISSION_GATE_SCHEMA,
  PROVIDER_INDEPENDENCE_VERDICT,
  evaluateProviderIndependenceAdmissionV1,
} from './providerIndependenceAdmissionGateV1.mjs';

const NOW = '2026-08-19T18:10:00.000Z';

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
    operatorImpact: 'No operator impact when fallback capacity is healthy.',
    hardExternalBoundaryReason: '',
    parityProofRefs: ['proofs/provider-parity/github-review.json'],
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateProviderIndependenceAdmissionV1({
    nowUtc: NOW,
    dependency: dependency(),
    parityRoutes: [route()],
    retiringRouteIds: [],
    exception: null,
    ...overrides,
  });
}

test('optional Codex specialist with an exact qualified GitHub fallback passes existing parity', () => {
  const result = evaluate();
  assert.equal(result.schemaVersion, PROVIDER_INDEPENDENCE_ADMISSION_GATE_SCHEMA);
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.PASS_EXISTING_QUALIFIED_PARITY);
  assert.deepEqual(result.selectedAlternativeRouteIds, ['github-review-v1']);
});

test('Codex-only exact-head review critical path is rejected even when prose says it is convenient', () => {
  const result = evaluate({
    dependency: dependency({
      mode: PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH,
      qualifiedAlternatives: [],
      whyProviderSpecific: 'Codex is convenient for code review.',
    }),
    parityRoutes: [],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH);
  assert.equal(result.concentrationRiskVisible, true);
});

test('retiring the last qualified OpenClaw or Forge style fallback fails closed', () => {
  const openClaw = route({
    routeId: 'openclaw-review-v1',
    provider: PROVIDER_CLASS.OPENCLAW_LOCAL,
  });
  const result = evaluate({
    dependency: dependency({ qualifiedAlternatives: ['openclaw-review-v1'] }),
    parityRoutes: [openClaw],
    retiringRouteIds: ['openclaw-review-v1'],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT);
});

test('the word Codex in descriptive prose does not trigger a raw-string policy block', () => {
  const result = evaluate({
    dependency: dependency({
      provider: PROVIDER_CLASS.PROVIDER_NEUTRAL,
      mode: PROVIDER_DEPENDENCY_MODE.PROVIDER_INDEPENDENT,
      criticalPathImpact: 'NONE',
      whyProviderSpecific: 'Documentation mentions Codex, OpenClaw and Forge for historical comparison only.',
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.PASS_PROVIDER_INDEPENDENT);
});

test('Work-only critical product execution is rejected as the sole critical path', () => {
  const result = evaluate({
    dependency: dependency({
      provider: PROVIDER_CLASS.WORK_AGENTIC,
      mode: PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH,
      capabilityClass: 'PRODUCT_IMPLEMENTATION',
      requiredTaskClass: 'PRODUCT_IMPLEMENTATION',
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH);
});

test('hard external boundary passes only when the capability alone is isolated and risk remains visible', () => {
  const result = evaluate({
    dependency: dependency({
      provider: PROVIDER_CLASS.OTHER_NON_CODEX,
      mode: PROVIDER_DEPENDENCY_MODE.HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION,
      qualifiedAlternatives: [],
      hardExternalBoundaryReason: 'Vendor-owned signing ceremony has no substitute API.',
      failureBehaviour: 'CAPABILITY_BLOCKED_ONLY',
    }),
    parityRoutes: [],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.PASS_PROVIDER_INDEPENDENT);
  assert.equal(result.hardExternalBoundary, true);
  assert.equal(result.concentrationRiskVisible, true);
});

test('expired temporary concentration exception blocks rather than becoming permanent', () => {
  const result = evaluate({
    dependency: dependency({
      mode: PROVIDER_DEPENDENCY_MODE.TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER,
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
    exception: {
      exceptionId: 'temporary-codex-specialist-gap',
      reason: 'Fallback implementation is still under review.',
      scope: 'EXACT_HEAD_REVIEW',
      owner: 'goal-1900',
      createdAt: '2026-08-18T12:00:00.000Z',
      expiresAt: '2026-08-19T17:00:00.000Z',
      blastRadius: 'Only the exact review capability is constrained.',
      unblockedUnrelatedWork: true,
      fallbackBuildGoal: '#1574',
      proofRequiredToRemoveException: 'Fresh provider-neutral exact-head review receipt.',
      operatorApprovalRef: '#1900',
    },
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH);
});

test('live bounded temporary exception is visible, owned, expiring and never a parity pass', () => {
  const result = evaluate({
    dependency: dependency({
      mode: PROVIDER_DEPENDENCY_MODE.TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER,
      qualifiedAlternatives: [],
    }),
    parityRoutes: [],
    exception: {
      exceptionId: 'temporary-codex-specialist-gap',
      reason: 'Fallback implementation is still under review.',
      scope: 'EXACT_HEAD_REVIEW',
      owner: 'goal-1900',
      createdAt: '2026-08-19T12:00:00.000Z',
      expiresAt: '2026-08-20T12:00:00.000Z',
      blastRadius: 'Only the exact review capability is constrained.',
      unblockedUnrelatedWork: true,
      fallbackBuildGoal: '#1574',
      proofRequiredToRemoveException: 'Fresh provider-neutral exact-head review receipt.',
      operatorApprovalRef: '#1900',
    },
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.TEMPORARY_EXCEPTION_ACTIVE);
  assert.equal(result.concentrationRiskVisible, true);
});

test('provider swap preserves exact checkpoint and receipt contracts', () => {
  const swapped = route({
    routeId: 'openclaw-review-v1',
    provider: PROVIDER_CLASS.OPENCLAW_LOCAL,
  });
  const result = evaluate({
    dependency: dependency({ qualifiedAlternatives: ['openclaw-review-v1'] }),
    parityRoutes: [swapped],
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.PASS_EXISTING_QUALIFIED_PARITY);
  assert.deepEqual(result.selectedAlternativeRouteIds, ['openclaw-review-v1']);
});

test('missing portable checkpoint contract gets the dedicated fail-closed verdict', () => {
  const result = evaluate({
    dependency: dependency({ portableCheckpointContract: '' }),
  });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PORTABLE_CHECKPOINT_MISSING);
  assert.deepEqual(result.blockers, ['portable-checkpoint-contract-missing']);
});

test('changed capability card invalidating the checkpoint contract blocks until reproof', () => {
  const changed = route({ portableCheckpointContract: 'different-checkpoint-v2' });
  const result = evaluate({ parityRoutes: [changed] });
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_DECLARED_FALLBACK_UNQUALIFIED);
});

test('malformed or accessor-shaped evidence fails closed', () => {
  const hostile = {
    nowUtc: NOW,
    dependency: dependency(),
    parityRoutes: [route()],
    retiringRouteIds: [],
    exception: null,
  };
  Object.defineProperty(hostile.dependency, 'operatorImpact', { get() { throw new Error('should not execute'); }, enumerable: true });
  const result = evaluateProviderIndependenceAdmissionV1(hostile);
  assert.equal(result.finalVerdict, PROVIDER_INDEPENDENCE_VERDICT.BLOCK_PROVIDER_DEPENDENCY_AMBIGUOUS);
});

test('no admission verdict grants mutation, qualification, merge, runtime or spending authority', () => {
  for (const result of [
    evaluate(),
    evaluate({
      dependency: dependency({ provider: PROVIDER_CLASS.PROVIDER_NEUTRAL, mode: PROVIDER_DEPENDENCY_MODE.PROVIDER_INDEPENDENT, criticalPathImpact: 'NONE', qualifiedAlternatives: [] }),
      parityRoutes: [],
    }),
  ]) {
    assert.deepEqual(result.authorityBoundary, {
      sourceMutationAllowed: false,
      dispatchAllowed: false,
      providerQualificationAuthority: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      windowsRuntimeAuthority: false,
      openClawMutationAuthority: false,
      spendingOrAccountAuthority: false,
      leaseSeizureAllowed: false,
    });
  }
});
