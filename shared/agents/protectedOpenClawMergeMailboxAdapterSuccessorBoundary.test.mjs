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
