import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1,
  WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1,
  WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1,
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
await import('./windowsAuthorityLifeboatPrincipalSidReviewV1.test.mjs');
await import('./windowsAuthorityWorkerWatchdogReviewV1.test.mjs');
await import('./windowsAuthorityMissionWorkerCleanupReviewV1.test.mjs');
await import('./windowsAuthorityForgeM3ExecutorReviewV1.test.mjs');
await import('./windowsAuthorityForgePodmanPrerequisiteReviewV1.test.mjs');
await import('./windowsAuthorityIgnitionConvergenceReviewV1.test.mjs');
await import('./windowsAuthorityStarfieldVrLauncherReviewV1.test.mjs');

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
  assert.match(source, /2c4bcfe69f030071e0bbd278f7fd55b7da9a0cba/);
  assert.match(source, /4a9318654405855cba5b1e15aaf2e4a587530f7f/);
  assert.match(source, /sourceMutationAllowed:\s*false/);
  assert.match(source, /mergeAuthority:\s*false/);
  assert.match(source, /runtimeMutationAllowed:\s*false/);
  assert.match(source, /providerQualificationAuthority:\s*false/);
});

test('routes exact Lifeboat principal repair through the SID specialist before the frozen fallback', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: 'a'.repeat(40),
    analysis: {
      findings: [{
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
      }],
      counts: { P0: 1, P1: 0, P2: 0 },
    },
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED');
});


test('routes exact Starfield VR launcher escalation through the qualified one-path specialist', () => {
  const path = WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0];
  const content = [
    "$decisionScript = Join-Path $repositoryRoot 'scripts\\starfield-vr-launch-decision.mjs'",
    "'stephanos.starfield-vr-launch-profile.v1'",
    "'meta-air-link'",
    "@('mutar-openxr', 'vorpx')",
    "Get-Process -Name 'OculusDash'",
    "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\Khronos\\OpenXR\\1' -Name 'ActiveRuntime'",
    'Get-FileHash -LiteralPath $Path -Algorithm SHA256',
    '$observationsJson = $observations | ConvertTo-Json -Depth 10',
    '[System.IO.File]::WriteAllText(',
    'New-Object System.Text.UTF8Encoding($false)',
    '& $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath',
    'if ($ReadinessOnly)',
    'if (-not $decision.ok)',
    "if ($decision.action -eq 'LAUNCH_VORPX')",
    '$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path',
    'Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru',
    'Nothing was changed and flat Starfield was not started.',
  ].join('\n');
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }],
      counts: { P0: 1, P1: 0, P2: 0 },
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: gitBlobSha(content),
      content,
    }],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_CLEAN');
});
