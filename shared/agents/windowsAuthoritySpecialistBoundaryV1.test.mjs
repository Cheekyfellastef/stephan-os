import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    'shared/agents/windowsAuthorityIgnitionConvergenceReviewV1.mjs',
    'shared/agents/windowsAuthorityMissionWorkerCleanupReviewV1.mjs',
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

test('trusted specialist composition pins and invokes the exact four-path ignition child before fallback', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /IGNITION_CONVERGENCE_PATH = '\.\/windowsAuthorityIgnitionConvergenceReviewV1\.mjs'/);
  assert.match(source, /IGNITION_CONVERGENCE_BLOB_SHA = '[a-f0-9]{40}'/);
  assert.match(source, /provePinnedModule\(IGNITION_CONVERGENCE_PATH, IGNITION_CONVERGENCE_BLOB_SHA\)/);
  assert.match(source, /WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1/);
  assert.match(source, /\['scripts\/windows\/probe-battle-bridge-recovery-mesh\.ps1','scripts\/windows\/repair-stephanos-battle-bridge\.ps1','scripts\/windows\/restart-approved-stephanos-runtime\.ps1','scripts\/windows\/start-stephanos-backend\.ps1'\]/);
  assert.match(source, /ignitionConvergence\.analyzeWindowsAuthorityIgnitionConvergenceReview\(input\); if \(ignitionConvergenceResult\.eligible\) return ignitionConvergenceResult;/);
});


test('trusted composition pins the non-Codex #2097/#2105 Mission Worker specialist before older watchdog fallbacks', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /MISSION_WORKER_CLEANUP_PATH = '\.\/windowsAuthorityMissionWorkerCleanupReviewV1\.mjs'/);
  assert.match(source, /MISSION_WORKER_CLEANUP_BLOB_SHA = '907c95a364c4b5eb5e083788b52056071d78e3a2'/);
  assert.match(source, /provePinnedModule\(MISSION_WORKER_CLEANUP_PATH, MISSION_WORKER_CLEANUP_BLOB_SHA\)/);
  assert.match(source, /WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1/);
  assert.match(source, /missionWorkerCleanup\.analyzeWindowsAuthorityMissionWorkerCleanupReviewV1\(input\); if \(missionWorkerCleanupResult\.eligible\) return missionWorkerCleanupResult;/);
});
