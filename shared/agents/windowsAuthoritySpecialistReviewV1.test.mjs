import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('./windowsAuthoritySpecialistReviewCoreV1.test.mjs');
await import('./windowsAuthorityNoFaffRescueReviewV1.test.mjs');
await import('./windowsAuthorityRecoveryMeshGuardianReviewV1.test.mjs');
await import('./windowsAuthorityOpenClawRecoveryReviewV1.test.mjs');
await import('./windowsAuthorityLocalChatRecoveryReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryExecutorReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryVerificationJournalReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryGitHubConsumerReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryLifeboatInstallerReviewV1.test.mjs');
await import('./windowsAuthorityWorkerWatchdogReviewV1.test.mjs');
await import('./windowsAuthorityIgnitionConvergenceReviewV1.test.mjs');
await import('./windowsAuthorityForgeM3ExecutorReviewV1.test.mjs');
await import('./windowsAuthorityForgePodmanPrerequisiteReviewV1.test.mjs');

test('top-level specialist pins and routes the exact ignition convergence reviewer before the legacy core', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /IGNITION_CONVERGENCE_PATH = '\.\/windowsAuthorityIgnitionConvergenceReviewV1\.mjs'/);
  assert.match(source, /IGNITION_CONVERGENCE_BLOB_SHA = '8d583a4c2247be80f91db34d46e3eb870aea9576'/);
  assert.match(source, /WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1/);
  assert.ok(source.indexOf('analyzeWindowsAuthorityIgnitionConvergenceReview') < source.indexOf('core.analyzeWindowsAuthoritySpecialistReview'));
});
