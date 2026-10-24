import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTECTED_MERGE_REQUIRED_WORKFLOWS,
  validateProtectedMergeCheckRows,
} from './protectedMergeCheckClassifierV1.mjs';

function successfulRequiredChecks() {
  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.map((workflow, index) => ({
    name: `required-${index}`,
    workflow,
    state: 'SUCCESS',
  }));
}

test('intentional pull-request Pages deployment skip is neutral only with successful required CI', () => {
  const checks = [
    ...successfulRequiredChecks(),
    { name: 'pages-deploy', workflow: 'Build Stephanos UI', state: 'SKIPPED' },
  ];
  assert.equal(validateProtectedMergeCheckRows(checks), true);
  for (const bad of [
    { name: 'pages-deploy', workflow: 'Build Stephanos UI', state: 'FAILURE' },
    { name: 'build', workflow: 'Build Stephanos UI', state: 'SKIPPED' },
    { name: 'proof', workflow: 'Battle Bridge Publisher Proof', state: 'SKIPPED' },
  ]) {
    assert.equal(validateProtectedMergeCheckRows([...successfulRequiredChecks(), bad]), false);
  }
  assert.equal(validateProtectedMergeCheckRows(checks.filter(row => row.workflow !== 'Build Stephanos UI')), false);
  assert.equal(validateProtectedMergeCheckRows(checks.map(row =>
    row.workflow === 'Build Stephanos UI' && row.state === 'SUCCESS'
      ? { ...row, state: 'SKIPPED' } : row)), false);
});
