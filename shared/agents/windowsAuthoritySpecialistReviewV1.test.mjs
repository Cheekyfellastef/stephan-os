import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1,
  analyzeWindowsAuthoritySpecialistReview,
} from './windowsAuthoritySpecialistReviewV1.mjs';

await import('./windowsAuthoritySpecialistReviewCoreV1.test.mjs');
await import('./windowsAuthorityNoFaffRescueReviewV1.test.mjs');
await import('./windowsAuthorityRecoveryMeshGuardianReviewV1.test.mjs');
await import('./windowsAuthorityRecoveryMeshLaunchLivenessReviewV1.test.mjs');
await import('./windowsAuthorityLegacyBackendMigrationReviewV1.test.mjs');
await import('./windowsAuthorityOpenClawRecoveryReviewV1.test.mjs');
await import('./windowsAuthorityLocalChatRecoveryReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryExecutorReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryVerificationJournalReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryGitHubConsumerReviewV1.test.mjs');
await import('./windowsAuthorityMobileRecoveryLifeboatInstallerReviewV1.test.mjs');
await import('./windowsAuthorityBattleBridgeLifeboatActivationReviewV1.test.mjs');
await import('./windowsAuthorityWorkerWatchdogReviewV1.test.mjs');
await import('./windowsAuthorityMissionWorkerCleanupReviewV1.test.mjs');
await import('./windowsAuthorityForgeM3ExecutorReviewV1.test.mjs');
await import('./windowsAuthorityForgePodmanPrerequisiteReviewV1.test.mjs');
await import('./windowsAuthorityIgnitionConvergenceReviewV1.test.mjs');

const HEAD = '7acff57ddff6a506244af99d518b9b73bf1208f6';
const BASE = 'e31861d2d74e564cd7e15434774a3a0313721baa';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2164,
    branch: 'fix/canonical-mailbox-rollover-2158-v1',
    sourceHead: HEAD,
    baseSha: BASE,
    analysis: {
      findings: WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.map((path) => ({
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path,
      })),
      counts: { P0: 2, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      sourceCommitSha: HEAD,
      baseSha: BASE,
      liveMainBeforeSha: BASE,
      liveMainAfterSha: BASE,
      parents: [BASE],
      comparison: {
        status: 'ahead',
        aheadBy: 65,
        behindBy: 0,
        baseCommitSha: BASE,
        mergeBaseCommitSha: BASE,
      },
    },
    sources: [],
    ...overrides,
  };
}

test('routes exact #2164 two-path Windows escalation through the bounded mailbox rollover profile', () => {
  const result = analyzeWindowsAuthoritySpecialistReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1);
  assert.ok(result.findings.some((item) => item.code === 'mailbox-rollover-source-inventory-invalid'));
});

test('accepts the exact escalation set independent of finding order', () => {
  const baseInput = input();
  const result = analyzeWindowsAuthoritySpecialistReview(input({
    analysis: {
      ...baseInput.analysis,
      findings: [...baseInput.analysis.findings].reverse(),
    },
  }));
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1);
});

test('wrong PR, branch or escalation set cannot enter the #2164 profile', () => {
  assert.equal(analyzeWindowsAuthoritySpecialistReview(input({ prNumber: 2165 })).eligible, false);
  assert.equal(analyzeWindowsAuthoritySpecialistReview(input({ branch: 'other' })).eligible, false);
  const bad = input();
  bad.analysis = {
    findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0] }],
    counts: { P0: 1, P1: 0, P2: 0 },
  };
  assert.equal(analyzeWindowsAuthoritySpecialistReview(bad).eligible, false);
});

test('synthetic or repinned source bytes cannot be cleared by the exact source profile', () => {
  const sources = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.map((path) => {
    const content = `# synthetic ${path}\n`;
    return {
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: gitBlobSha(content),
      content,
    };
  });
  const result = analyzeWindowsAuthoritySpecialistReview(input({ sources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings.filter((item) => item.code === 'mailbox-rollover-exact-source-not-pinned').length, 2);
});

test('registry source pins the two exact #2164 blobs and grants no mutation or qualification authority', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /91a1ee081465236dc2bf509c4ccff1836eab5cd4/);
  assert.match(source, /4a9318654405855cba5b1e15aaf2e4a587530f7f/);
  assert.match(source, /sourceMutationAllowed:\s*false/);
  assert.match(source, /mergeAuthority:\s*false/);
  assert.match(source, /runtimeMutationAllowed:\s*false/);
  assert.match(source, /providerQualificationAuthority:\s*false/);
});
