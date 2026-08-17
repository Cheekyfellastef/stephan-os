import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';

function diffFor(path) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    '+export const changed = true;',
  ].join('\n');
}

test('protects the complete source-controlled Windows specialist boundary', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1, [
    'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs',
    'shared/agents/windowsAuthorityWorkerWatchdogReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  ]);

  for (const path of WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1) {
    const result = analyzeIndependentSecurityReviewV2({
      changedFiles: [path],
      diff: diffFor(path),
    });
    assert.ok(result.findings.some((item) => (
      item.code === 'approval-boundary-v2-self-change-requires-qualified-review'
      && item.path === path
    )));
  }
});
