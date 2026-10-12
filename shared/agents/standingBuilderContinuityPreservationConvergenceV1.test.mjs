import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderFamilyRouteV1 } from './zeroOpenAiBuilderFailoverV1.mjs';
import {
  planStandingBuilderContinuityPreservationConvergenceV1,
  runStandingBuilderContinuityPreservationConvergenceV1,
} from './standingBuilderContinuityPreservationConvergenceV1.mjs';

const OLD_BASE = '1'.repeat(40);
const CURRENT_MAIN = '2'.repeat(40);
const OLD_HEAD = '3'.repeat(40);
const NEW_HEAD = '4'.repeat(40);

function route({ routeId, adapterId, providerFamily, priority = 10, sourceHealth = 'HEALTHY' }) {
  return createProviderFamilyRouteV1({
    routeId,
    adapterId,
    providerFamily,
    capabilityHealth: {
      builderIgnition: 'HEALTHY',
      sourceImplementation: sourceHealth,
      publication: 'HEALTHY',
      review: 'HEALTHY',
    },
    qualifiedTaskClasses: ['preservation-convergence'],
    allowedOperations: ['preservation-converge'],
    priority,
    proofRef: `proof-${routeId}`,
  });
}

function input(overrides = {}) {
  return {
    laneState: 'STALE_BASE_REVALIDATION_REQUIRED',
    existingOwnerConfirmed: true,
    exactPrIdentityConfirmed: true,
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2277,
    branch: 'fix/recovery-lifeboat-pinned-launcher-restore-v1',
    previousHead: OLD_HEAD,
    observedBase: OLD_BASE,
    currentMain: CURRENT_MAIN,
    preferredSourceAdapter: 'github-first',
    openAiBlackout: false,
    providerRoutes: [
      route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB', priority: 1 }),
      route({ routeId: 'forge-route', adapterId: 'forge', providerFamily: 'FORGE', priority: 2 }),
      route({ routeId: 'openclaw-route', adapterId: 'openclaw', providerFamily: 'OPENCLAW', priority: 3 }),
    ],
    createdAtUtc: '2026-09-19T22:00:00Z',
    expiresAtUtc: '2026-09-19T23:00:00Z',
    ...overrides,
  };
}

function successReceipt(routeId, overrides = {}) {
  return {
    ok: true,
    routeId,
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2277,
    branch: 'fix/recovery-lifeboat-pinned-launcher-restore-v1',
    previousHead: OLD_HEAD,
    currentMain: CURRENT_MAIN,
    newHead: NEW_HEAD,
    sameBranch: true,
    ordinaryTwoParentMerge: true,
    previousHeadIsParent: true,
    currentMainIsParent: true,
    parentOrder: [OLD_HEAD, CURRENT_MAIN],
    forcePushUsed: false,
    rebaseUsed: false,
    resetUsed: false,
    directMainWriteUsed: false,
    ...overrides,
  };
}

test('typed stale-base state becomes an executable same-branch preservation route instead of STOP', () => {
  const plan = planStandingBuilderContinuityPreservationConvergenceV1(input());
  assert.equal(plan.finalVerdict, 'PRESERVATION_CONVERGENCE_ROUTE_READY');
  assert.equal(plan.selectedRoute.routeId, 'github-route');
  assert.equal(plan.convergenceContract.branch, 'fix/recovery-lifeboat-pinned-launcher-restore-v1');
  assert.deepEqual(plan.convergenceContract.requiredParentOrder, [OLD_HEAD, CURRENT_MAIN]);
  assert.equal(plan.convergenceContract.ordinaryTwoParentMergeRequired, true);
  assert.equal(plan.convergenceContract.forcePushAllowed, false);
  assert.equal(plan.convergenceContract.rebaseAllowed, false);
  assert.equal(plan.convergenceContract.resetAllowed, false);
  assert.equal(plan.convergenceContract.replacementBranchAllowed, false);
  assert.equal(plan.convergenceContract.replacementPrAllowed, false);
});

test('main advances -> stale existing PR -> same branch convergence -> fresh exact-head proof request -> merge train resumes', async () => {
  let convergenceCalls = 0;
  let verificationCalls = 0;
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input(), {
    'github-first': async ({ convergenceContract }) => {
      convergenceCalls += 1;
      assert.equal(convergenceContract.previousHead, OLD_HEAD);
      assert.equal(convergenceContract.currentMain, CURRENT_MAIN);
      return successReceipt('github-route');
    },
    requestFreshExactHeadVerification: async (request) => {
      verificationCalls += 1;
      assert.equal(request.newHead, NEW_HEAD);
      assert.equal(request.currentMain, CURRENT_MAIN);
      assert.equal(request.invalidatePriorHeadBoundEvidence, true);
      assert.equal(request.requireFreshCi, true);
      assert.equal(request.requireFreshIndependentReview, true);
      return { accepted: true, head: NEW_HEAD };
    },
  });

  assert.equal(convergenceCalls, 1);
  assert.equal(verificationCalls, 1);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_COMPLETED_FRESH_PROOF_REQUESTED');
  assert.equal(result.newHead, NEW_HEAD);
  assert.equal(result.exactHeadVerificationRequested, true);
  assert.equal(result.mergeTrainState, 'CHECKS_RUNNING');
  assert.equal(result.attempts[0].outcome, 'CONVERGED');
});

test('a blocked GitHub writer immediately fails over through the existing provider-neutral fabric to Forge', async () => {
  const calls = [];
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input(), {
    'github-first': async () => {
      calls.push('github-first');
      return { ok: false, blocker: 'SURFACE_WRITE_UNAVAILABLE' };
    },
    forge: async () => {
      calls.push('forge');
      return successReceipt('forge-route');
    },
    requestFreshExactHeadVerification: async ({ newHead }) => ({ accepted: true, head: newHead }),
  });

  assert.deepEqual(calls, ['github-first', 'forge']);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_COMPLETED_FRESH_PROOF_REQUESTED');
  assert.deepEqual(result.attempts.map(({ routeId, outcome }) => [routeId, outcome]), [
    ['github-route', 'CONVERGENCE_RECEIPT_REJECTED'],
    ['forge-route', 'CONVERGED'],
  ]);
});

test('Codex/OpenAI exhaustion is routing truth only and a qualified non-OpenAI route remains executable', () => {
  const plan = planStandingBuilderContinuityPreservationConvergenceV1(input({
    preferredSourceAdapter: 'legacy-codex',
    openAiBlackout: true,
    providerRoutes: [
      route({ routeId: 'codex-route', adapterId: 'legacy-codex', providerFamily: 'OPENAI', priority: 1 }),
      route({ routeId: 'forge-route', adapterId: 'forge', providerFamily: 'FORGE', priority: 2 }),
    ],
  }));
  assert.equal(plan.finalVerdict, 'PRESERVATION_CONVERGENCE_ROUTE_READY');
  assert.equal(plan.selectedRoute.routeId, 'forge-route');
  assert.equal(plan.selectedRoute.providerFamily, 'FORGE');
});

test('all qualified route failures are typed only after every available route received an execution attempt', async () => {
  const calls = [];
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [
      route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB', priority: 1 }),
      route({ routeId: 'openclaw-route', adapterId: 'openclaw', providerFamily: 'OPENCLAW', priority: 2 }),
    ],
  }), {
    'github-first': async () => {
      calls.push('github-first');
      return { ok: false, blocker: 'WRITER_BLOCKED' };
    },
    openclaw: async () => {
      calls.push('openclaw');
      return { ok: false, blocker: 'LOCAL_CAPACITY_BLOCKED' };
    },
  });
  assert.deepEqual(calls, ['github-first', 'openclaw']);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  assert.equal(result.blocker, 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED');
  assert.equal(result.attempts.length, 2);
});

test('unsafe replacement semantics remain fail closed', () => {
  for (const overrides of [
    { branchReplacementRequested: true },
    { authorityExpansionRequested: true },
    { branch: 'main' },
    { observedBase: CURRENT_MAIN },
  ]) {
    const plan = planStandingBuilderContinuityPreservationConvergenceV1(input(overrides));
    assert.equal(plan.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  }
});

test('a forged convergence result cannot advance to fresh proof', async () => {
  let verificationCalls = 0;
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB' })],
  }), {
    'github-first': async () => successReceipt('github-route', { forcePushUsed: true }),
    requestFreshExactHeadVerification: async () => {
      verificationCalls += 1;
      return { accepted: true, head: NEW_HEAD };
    },
  });
  assert.equal(verificationCalls, 0);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  assert.equal(result.blocker, 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED');
});


test('a fully blocked convergence run parks only the lane and can never disable the controller', async () => {
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [
      route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB', priority: 1 }),
      route({ routeId: 'forge-route', adapterId: 'forge', providerFamily: 'FORGE', priority: 2 }),
    ],
  }), {
    'github-first': async () => ({ ok: false, blocker: 'SURFACE_BLOCKED_FOR_RUN' }),
    forge: async () => ({ ok: false, blocker: 'LOCAL_CAPACITY_BLOCKED' }),
  });

  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  assert.equal(result.blocker, 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED');
  assert.equal(result.controllerLivenessAction, 'KEEP_ENABLED');
  assert.equal(result.controllerDisableAllowed, false);
  assert.equal(result.blockedLaneScope, 'LANE_ONLY');
  assert.equal(result.refillUnrelatedCapacityRequired, true);
  assert.equal(result.attempts.length, 2);
});

test('no qualified convergence route is lane-scoped and still preserves controller liveness', () => {
  const result = planStandingBuilderContinuityPreservationConvergenceV1(input({ providerRoutes: [] }));
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  assert.equal(result.controllerLivenessAction, 'KEEP_ENABLED');
  assert.equal(result.controllerDisableAllowed, false);
  assert.equal(result.blockedLaneScope, 'LANE_ONLY');
  assert.equal(result.refillUnrelatedCapacityRequired, true);
});


test('convergence receipt must prove exact ordered parents', async () => {
  let verificationCalls = 0;
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB' })],
  }), {
    'github-first': async () => successReceipt('github-route', { parentOrder: [CURRENT_MAIN, OLD_HEAD] }),
    requestFreshExactHeadVerification: async () => { verificationCalls += 1; return { accepted: true, head: NEW_HEAD }; },
  });
  assert.equal(verificationCalls, 0);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
});

test('convergence receipt rejects missing ordered parent evidence even when parent booleans are true', async () => {
  let verificationCalls = 0;
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB' })],
  }), {
    'github-first': async () => successReceipt('github-route', { parentOrder: undefined }),
    requestFreshExactHeadVerification: async () => { verificationCalls += 1; return { accepted: true, head: NEW_HEAD }; },
  });
  assert.equal(verificationCalls, 0);
  assert.equal(result.finalVerdict, 'PRESERVATION_CONVERGENCE_BLOCKED');
  assert.equal(result.blocker, 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED');
});

test('verification transport failure preserves converged head and parks only fresh proof', async () => {
  const result = await runStandingBuilderContinuityPreservationConvergenceV1(input({
    providerRoutes: [route({ routeId: 'github-route', adapterId: 'github-first', providerFamily: 'GITHUB' })],
  }), {
    'github-first': async () => successReceipt('github-route'),
    requestFreshExactHeadVerification: async () => { throw new Error('review dispatch temporarily unavailable'); },
  });
  assert.equal(result.blocker, 'FRESH_EXACT_HEAD_VERIFICATION_REQUEST_FAILED');
  assert.equal(result.newHead, NEW_HEAD);
  assert.equal(result.mergeTrainState, 'CHECKS_RUNNING');
  assert.equal(result.sourceMutationAllowed, true);
  assert.equal(result.attempts.at(-1).outcome, 'CONVERGED');
});
