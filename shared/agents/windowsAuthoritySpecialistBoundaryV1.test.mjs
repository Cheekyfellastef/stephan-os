import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';

function diffFor(path, additions = ['export const changed = true;']) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    ...additions.map((line) => `+${line}`),
  ].join('\n');
}

test('protects the complete source-controlled Windows specialist boundary', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1, [
    'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs',
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

test('specialist wrapper and workflow remain read-only and trusted-base bound', () => {
  const wrapper = readFileSync(new URL('../../scripts/independent-merge-security-review-with-windows-specialist-v1.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url), 'utf8');

  assert.match(wrapper, /spawnSync\(process\.execPath/);
  assert.match(wrapper, /independent-merge-security-review-v2\.mjs/);
  assert.match(wrapper, /buildIndependentReviewArtifact/);
  assert.doesNotMatch(wrapper, /gh\s+pr\s+(?:merge|ready)|git\s+(?:push|reset|clean|rebase)|Stop-Process|Restart-Computer|shell\s*:\s*true|\beval\s*\(/i);

  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /windowsAuthoritySpecialistReviewV1\.test\.mjs/);
  assert.match(workflow, /windowsAuthoritySpecialistBoundaryV1\.test\.mjs/);
  assert.match(workflow, /independent-merge-security-review-with-windows-specialist-v1\.mjs/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write/);
});

test('wrapper mutation attempts remain concrete independent-reviewer findings', () => {
  const path = 'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs';
  const result = analyzeIndependentSecurityReviewV2({
    changedFiles: [path],
    diff: diffFor(path, ["runRequired('gh', ['pr', 'merge', String(prNumber)]);"]),
  });
  assert.ok(result.findings.some((item) => item.code === 'independent-reviewer-v2-gained-mutation-authority'));
});
