import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTECTED_OPENCLAW_MERGE_FINDING,
  PROTECTED_OPENCLAW_SPECIALIST_SUCCESSOR_BOOTSTRAP_PATHS,
  validateProtectedOpenClawBootstrapFindings,
} from './protectedOpenClawMergeMailboxAdapter.mjs';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
} from './operatorMergeApprovalBoundaryV2.mjs';
import {
  WINDOWS_SPECIALIST_EXTENSION_BOUNDARY_PATHS_V1,
  analyzeIndependentSecurityReview,
} from './operatorMergeApprovalGateV2.mjs';

const SUCCESSOR_PATHS = Object.freeze([
  'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.mjs',
  'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.test.mjs',
]);

const finding = (path, overrides = {}) => ({
  severity: 'P0',
  code: PROTECTED_OPENCLAW_MERGE_FINDING,
  summary: 'Qualified operator bootstrap required.',
  path,
  ...overrides,
});

test('protected bootstrap recognizes exactly the existing OpenClaw specialist successor boundary', () => {
  assert.deepEqual(PROTECTED_OPENCLAW_SPECIALIST_SUCCESSOR_BOOTSTRAP_PATHS, SUCCESSOR_PATHS);
  assert.equal(validateProtectedOpenClawBootstrapFindings(SUCCESSOR_PATHS.map((path) => finding(path))), true);
  for (const path of SUCCESSOR_PATHS) {
    assert.equal(validateProtectedOpenClawBootstrapFindings([finding(path)]), true);
  }
});

test('successor bootstrap recognition does not widen the general approval or Windows specialist registries', () => {
  for (const path of SUCCESSOR_PATHS) {
    assert.equal(APPROVAL_BOUNDARY_PATHS_V2.includes(path), false);
    assert.equal(WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1.includes(path), false);
  }
});

test('successor bootstrap remains fail closed for unrelated, duplicated, or malformed findings', () => {
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding('shared/agents/untrusted-reviewer.mjs')]), false);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(SUCCESSOR_PATHS[0]), finding(SUCCESSOR_PATHS[0])]), false);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(SUCCESSOR_PATHS[0], { severity: 'P1' })]), false);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(SUCCESSOR_PATHS[0], { code: 'different-code' })]), false);
});

const ROUTER_TEST_PATH = 'shared/agents/windowsAuthoritySpecialistReviewV1.test.mjs';

test('protected bootstrap accepts the exact router test boundary already required by GateV2', () => {
  assert.equal(WINDOWS_SPECIALIST_EXTENSION_BOUNDARY_PATHS_V1.includes(ROUTER_TEST_PATH), true);
  const paths = [
    'shared/agents/windowsAuthorityVrResourceGovernorReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
    ROUTER_TEST_PATH,
  ];
  const analysis = analyzeIndependentSecurityReview({
    changedFiles: paths,
    diff: paths.map(path => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-// previous source\n+// reviewed source\n`).join(''),
  });
  assert.equal(analysis.finalVerdict, 'INDEPENDENT_SECURITY_REVIEW_FINDINGS');
  assert.deepEqual(analysis.counts, { P0: 3, P1: 0, P2: 0 });
  assert.deepEqual(analysis.findings.map(item => item.path).sort(), [...paths].sort());
  assert.ok(analysis.findings.every(item => item.code === PROTECTED_OPENCLAW_MERGE_FINDING));
  assert.equal(validateProtectedOpenClawBootstrapFindings(analysis.findings), true);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(ROUTER_TEST_PATH)]), true);
});

test('router test recognition admits no other extension path or path alias', () => {
  assert.equal(APPROVAL_BOUNDARY_PATHS_V2.includes(ROUTER_TEST_PATH), false);
  assert.equal(WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1.includes(ROUTER_TEST_PATH), false);
  for (const path of [
    ...WINDOWS_SPECIALIST_EXTENSION_BOUNDARY_PATHS_V1.filter(path => path !== ROUTER_TEST_PATH),
    'shared/agents/WindowsAuthoritySpecialistReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.test.mjs/extra',
    'shared/agents/windowsAuthoritySpecialistReviewV1.test.mjs.extra',
    'shared/agents/untrusted-reviewer.test.mjs',
  ]) {
    assert.equal(validateProtectedOpenClawBootstrapFindings([finding(path)]), false, path);
    assert.equal(validateProtectedOpenClawBootstrapFindings([finding(ROUTER_TEST_PATH), finding(path)]), false, path);
  }
});

test('router test recognition retains severity, finding-code and duplicate refusals', () => {
  assert.equal(validateProtectedOpenClawBootstrapFindings([
    finding(ROUTER_TEST_PATH), finding(ROUTER_TEST_PATH),
  ]), false);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(ROUTER_TEST_PATH, { severity: 'P1' })]), false);
  assert.equal(validateProtectedOpenClawBootstrapFindings([finding(ROUTER_TEST_PATH, { code: 'different-code' })]), false);
});
