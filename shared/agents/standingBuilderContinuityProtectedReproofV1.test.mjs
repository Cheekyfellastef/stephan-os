import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_BOUNDARY_PATHS_V2 } from './operatorMergeApprovalBoundaryV2.mjs';
import {
  STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA,
  STANDING_BUILDER_CONTINUITY_POLICY_VERSION,
} from './standingBuilderContinuityAuthorityV1.mjs';
import {
  STANDING_BUILDER_CONTINUITY_PROTECTED_MODE,
  STANDING_BUILDER_CONTINUITY_PROTECTED_WORKFLOW,
  buildStandingBuilderContinuityProtectedReproofV1,
} from './standingBuilderContinuityProtectedReproofV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'e161f88f09de4614d3befb857884b68a060aaad2';
const TREE = '44b6cc88987bc295d06a9fc9496c09c83520d78c';
const MAIN = 'e5f59be5ee213fb61a536d58aa5fc989b2c68abc';
const PATHS = Object.freeze([
  '.github/workflows/battle-bridge-worker-watchdog-proof.yml',
  'scripts/mission-worker-process-start-api-consistency.test.mjs',
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);
const QUORUM = Object.freeze([
  'exact-head-hosted-checks',
  'deterministic-high-risk-tests',
  'independent-review-no-substantive-p0-p1',
  'provider-unavailability-proof',
  'operator-standing-authority-proof',
]);

function authority(overrides = {}) {
  return {
    schemaVersion: STANDING_BUILDER_CONTINUITY_AUTHORITY_SCHEMA,
    authorityId: 'stephan-builder-continuity-20260914',
    operatorIdentity: 'Cheekyfellastef',
    missionClass: 'BUILDER_CONTINUITY',
    canonicalGoalRefs: [1557, 1622, 1802],
    repository: REPOSITORY,
    allowedActionClasses: ['PROTECTED_REPROOF'],
    forbiddenActionClasses: ['DIRECT_MAIN_WRITE', 'RUNTIME_MUTATION'],
    createdAtUtc: '2026-09-14T07:00:00Z',
    revocationState: 'ACTIVE',
    policyVersion: STANDING_BUILDER_CONTINUITY_POLICY_VERSION,
    ...overrides,
  };
}

function eligibilityInput(overrides = {}) {
  return {
    authority: authority(),
    repository: REPOSITORY,
    prNumber: 2222,
    sourceHead: HEAD,
    baseSha: MAIN,
    goalRef: 1622,
    actionClass: 'PROTECTED_REPROOF',
    builderContinuityPurpose: true,
    scopeBounded: true,
    newAuthoritySurfaceIntroduced: false,
    exactHostedChecksGreen: true,
    deterministicHighRiskTestsGreen: true,
    providerUnavailableProven: true,
    sourceIdentityCurrent: true,
    resourceOwnershipUnambiguous: true,
    mergeable: true,
    unresolvedReviewThreads: 0,
    independentFindings: [
      {
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path: 'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
      },
      {
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path: 'scripts/windows/restart-approved-stephanos-runtime.ps1',
      },
    ],
    quorumProofs: [...QUORUM],
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    eligibilityInput: eligibilityInput(),
    repository: REPOSITORY,
    prNumber: 2222,
    branch: 'fix/mission-worker-watchdog-restart-v1',
    sourceHead: HEAD,
    sourceTree: TREE,
    baseSha: MAIN,
    currentMain: MAIN,
    changedPaths: [...PATHS],
    changedEstateSha256: 'a'.repeat(64),
    independentReviewPayloadSha256: 'b'.repeat(64),
    pullRequestOpen: true,
    pullRequestDraft: false,
    pullRequestMerged: false,
    mergeable: true,
    unresolvedReviewThreads: 0,
    exactHostedChecksGreen: true,
    deterministicHighRiskTestsGreen: true,
    independentReviewBoundToTuple: true,
    providerUnavailableProven: true,
    resourceOwnershipUnambiguous: true,
    noNewAuthoritySurface: true,
    changedEstateMatchesEligibleScope: true,
    ...overrides,
  };
}

test('standing builder-continuity authority code is itself an approval boundary', () => {
  for (const path of [
    'shared/agents/standingBuilderContinuityAuthorityV1.mjs',
    'shared/agents/standingBuilderContinuityProtectedReproofV1.mjs',
  ]) {
    assert.ok(APPROVAL_BOUNDARY_PATHS_V2.includes(path), `${path} must be protected as an approval boundary`);
  }
});

test('PR #2222 ready-state canary can enter only the existing protected reproof workflow', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput());
  assert.equal(result.ready, true);
  assert.equal(result.finalVerdict, 'STANDING_AUTHORITY_PROTECTED_EXECUTION');
  assert.equal(result.workflowDispatch.workflowPath, STANDING_BUILDER_CONTINUITY_PROTECTED_WORKFLOW);
  assert.equal(result.workflowDispatch.mode, STANDING_BUILDER_CONTINUITY_PROTECTED_MODE);
  assert.equal(result.workflowDispatch.expectedHead, HEAD);
  assert.equal(result.workflowDispatch.expectedHeadTree, TREE);
  assert.equal(result.workflowDispatch.expectedBase, MAIN);
  assert.deepEqual(result.workflowDispatch.changedPaths, [...PATHS].sort());
  assert.equal(result.workflowDispatch.protectedWorkflowReproofRequired, true);
  assert.equal(result.specialistReviewSatisfied, false);
  assert.equal(result.rawMergeAllowed, false);
  assert.equal(result.protectedEnvironmentBypassAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('current-main movement blocks protected reproof until identity is re-proven', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ currentMain: '1'.repeat(40) }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-current-main-drift'));
});

test('draft PR cannot enter protected reproof execution', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ pullRequestDraft: true }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-pr-still-draft'));
});

test('unresolved review thread blocks protected reproof', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ unresolvedReviewThreads: 1 }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-unresolved-review-threads'));
});

test('changed estate drift blocks protected reproof', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ changedEstateMatchesEligibleScope: false }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-changed-estate-drift'));
});

test('substantive P1 cannot be reclassified as provider friction', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({
    eligibilityInput: eligibilityInput({
      independentFindings: [{ severity: 'P1', code: 'real-defect', path: 'shared/agents/example.mjs' }],
    }),
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-eligibility-not-exact'));
});

test('provider availability proof is mandatory', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({
    eligibilityInput: eligibilityInput({ providerUnavailableProven: false }),
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-eligibility-not-exact'));
});

test('revoked standing authority remains fail closed', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({
    eligibilityInput: eligibilityInput({ authority: authority({ revocationState: 'REVOKED' }) }),
  }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-eligibility-not-exact'));
});

test('authority widening remains forbidden even after eligibility', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ noNewAuthoritySurface: false }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-authority-surface-widened'));
});

test('head drift between eligibility and protected request fails closed', () => {
  const result = buildStandingBuilderContinuityProtectedReproofV1(validInput({ sourceHead: '2'.repeat(40) }));
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('standing-reproof-eligibility-head-drift'));
});
