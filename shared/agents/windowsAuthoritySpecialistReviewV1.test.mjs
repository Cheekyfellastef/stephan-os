import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1,
  WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1,
  WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1,
  WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1,
  WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
  WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1,
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
await import('./windowsAuthorityStarfieldVrAerObserveReviewV1.test.mjs');
// Exercise the exact fail-closed governor reviewer semantics in the hosted router suite.
await import('./windowsAuthorityVrResourceGovernorReviewV1.test.mjs');
await import('./windowsAuthoritySovereignFixedRuntimeReviewV1.test.mjs');
await import('./windowsAuthorityCanonicalMailboxNativeEvidenceReviewV1.test.mjs');

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


test('router preserves exact governor specialist source pin after metadata fail-closed correction', async () => {
  const reviewerSource = await readFile(new URL('./windowsAuthorityVrResourceGovernorReviewV1.mjs', import.meta.url), 'utf8');
  const routerSource = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.equal(gitBlobSha(reviewerSource), '082ade94c9f2774e14c1dca9c7b8cda34f62c62a');
  assert.ok(routerSource.includes("const VR_RESOURCE_GOVERNOR_BLOB_SHA = '082ade94c9f2774e14c1dca9c7b8cda34f62c62a';"));
  assert.ok(reviewerSource.includes('counts.P0 === 1'));
  assert.ok(reviewerSource.includes("analysis?.verdict === 'findings'"));
});

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

test('registry source pins the current bounded mailbox recovery blobs and grants no mutation or qualification authority', async () => {
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /2c4bcfe69f030071e0bbd278f7fd55b7da9a0cba/);
  assert.match(source, /b86ac43ed02f9742bc3213b1e847707f79a6153f/);
  assert.match(source, /f66cc26ef865bb840522b16cbb53f830f9499838/);
  assert.match(source, /082ade94c9f2774e14c1dca9c7b8cda34f62c62a/);
  assert.match(source, /1b103fda85c371a218f38f20fe5163ca3f5042bf/);
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


test('routes exact Starfield VR launcher escalation through the qualified one-path specialist', async () => {
  const path = WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0];
  const content = await readFile(new URL('../../scripts/windows/launch-starfield-vr.ps1', import.meta.url), 'utf8');
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


test('composes exact Starfield VR splash and launcher escalations without widening specialist scope', async () => {
  const splashPath = WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.find((path) => path.endsWith('launch-starfield-vr-with-splash.ps1'));
  const launcherPath = WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0];
  const [splashContent, launcherContent] = await Promise.all([
    readFile(new URL('../../scripts/windows/launch-starfield-vr-with-splash.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/windows/launch-starfield-vr.ps1', import.meta.url), 'utf8'),
  ]);
  const sources = [[splashPath, splashContent], [launcherPath, launcherContent]].map(([path, content]) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: 'Cheekyfellastef/stephan-os',
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: gitBlobSha(content),
    content,
  }));
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: {
      findings: [splashPath, launcherPath].map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
      counts: { P0: 2, P1: 0, P2: 0 },
      verdict: 'findings',
    },
    sources,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, [splashPath, launcherPath]);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_COMPOSITE_SPECIALIST_CLEAN');
});


test('routes exact Starfield VR AER Observe escalation through the qualified specialist', async () => {
  const path = WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0];
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
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
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_SPECIALIST_CLEAN');
});

test('composes exact Starfield VR splash and AER Observe escalations without widening specialist scope', async () => {
  const splashPath = WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.find((path) => path.endsWith('launch-starfield-vr-with-splash.ps1'));
  const aerPath = WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0];
  const [splashContent, aerContent] = await Promise.all([
    readFile(new URL('../../scripts/windows/launch-starfield-vr-with-splash.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8'),
  ]);
  const sources = [[splashPath, splashContent], [aerPath, aerContent]].map(([path, content]) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: 'Cheekyfellastef/stephan-os',
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: gitBlobSha(content),
    content,
  }));
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: {
      findings: [splashPath, aerPath].map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
      counts: { P0: 2, P1: 0, P2: 0 },
      verdict: 'findings',
    },
    sources,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, [splashPath, aerPath]);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_COMPOSITE_SPECIALIST_CLEAN');
});


test('routes exact #3362 fixed-runtime Windows escalation through the sovereign specialist', () => {
  const head = 'a'.repeat(40);
  const base = '2f56252825d5bbc9aa0a684808fd141eff74c84c';
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 3362,
    branch: 'fix/2961-fixed-runtime-closure-relay-proof-20261031',
    sourceHead: head,
    baseSha: base,
    analysis: {
      findings: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.map(path => ({
        severity: 'P0', code: 'unsupported-high-risk-surface', path,
      })),
      counts: { P0: 2, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: head,
      sourceCommitSha: head,
      baseSha: base,
      liveMainBeforeSha: base,
      liveMainAfterSha: base,
      parents: [base],
      comparison: { status: 'ahead', aheadBy: 1, behindBy: 0, baseCommitSha: base, mergeBaseCommitSha: base },
    },
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
  assert.ok(result.findings.some(item => item.code === 'fixed-runtime-specialist-exact-source-not-pinned'));
});


test('routes exact #3302 seven Windows source-only P0s before the frozen legacy reviewer without granting native authority', () => {
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 3302,
    branch: 'codex/2315-saturated-rotation-control-v1',
    sourceHead: head, baseSha: base,
    analysis: {
      findings: WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1.map(path => ({
        severity: 'P0', code: 'unsupported-high-risk-surface', path,
      })),
      counts: { P0: 7, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os', sourceHead: head,
      sourceCommitSha: head, baseSha: base,
      liveMainBeforeSha: base, liveMainAfterSha: base, parents: [base],
      comparison: { status: 'ahead', aheadBy: 1, behindBy: 0,
        baseCommitSha: base, mergeBaseCommitSha: base },
    },
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings.filter(x => x.code === 'mailbox-native-source-blob-mismatch').length, 7);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1);
  assert.equal(result.nativeProducerQualified, false);
  assert.equal(result.nativeEvidenceAuthenticated, false);
  assert.equal(result.freezeCertified, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.epochAdoptionAuthorized, false);
});


test('composite specialist suppresses every positive source proof if either child fails exact evidence', async () => {
  const splashPath = WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.find(path =>
    path.endsWith('launch-starfield-vr-with-splash.ps1'));
  for (const [partnerPath, file] of [
    [WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0], 'launch-starfield-vr.ps1'],
    [WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0], 'run-starfield-aer-stabilizer-observe.ps1'],
  ]) {
    const [splash, partner] = await Promise.all([
      readFile(new URL('../../scripts/windows/launch-starfield-vr-with-splash.ps1', import.meta.url), 'utf8'),
      readFile(new URL('../../scripts/windows/' + file, import.meta.url), 'utf8'),
    ]);
    const paths = [splashPath, partnerPath];
    const sources = [splash, partner].map((content, index) => ({
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path: paths[index], ref: HEAD, exists: true,
      size: Buffer.byteLength(content, 'utf8'), blobSha: gitBlobSha(content), content,
    }));
    const request = (evidence) => analyzeWindowsAuthoritySpecialistReview({
      repository: 'Cheekyfellastef/stephan-os', sourceHead: HEAD,
      analysis: {
        findings: paths.map(path => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
        counts: { P0: 2, P1: 0, P2: 0 },
        verdict: 'findings',
      },
      sources: evidence,
    });
    const clean = request(sources);
    assert.equal(clean.eligible, true);
    assert.equal(clean.clean, true, JSON.stringify(clean.findings));
    assert.ok(clean.proofRefs.length >= 1, 'baseline must contain a real positive proof');
    assert.equal(clean.schemaVersion, 'stephanos.windows-authority-specialist-review.v1');
    for (const property of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority']) {
      assert.equal(clean[property], false, property + ' must remain denied on clean composite evidence');
    }
    for (const damagedIndex of [0, 1]) {
      // Self-consistent metadata is not enough: one child has absent source bytes.
      // The other child remains valid and previously leaked a positive proofRef.
      const invalidSources = sources.map((entry, index) => index === damagedIndex
        ? { ...entry, content: '', size: 0, blobSha: gitBlobSha('') } : entry);
      const rejected = request(invalidSources);
      assert.equal(rejected.eligible, true);
      assert.equal(rejected.clean, false, 'one failed child must fail the composite');
      assert.ok(rejected.findings.length > 0);
      assert.deepEqual(rejected.proofRefs, [], 'no partial positive proof on any P0 finding');
      assert.equal(rejected.schemaVersion, 'stephanos.windows-authority-specialist-review.v1');
      for (const property of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority']) {
        assert.equal(rejected[property], false, property + ' must be an explicit denial on child rejection');
      }
    }
  }
});

test('composite review refuses contradictory typed counts and verdict before delegating to child specialists', async () => {
  const splashPath = WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.find(path =>
    path.endsWith('launch-starfield-vr-with-splash.ps1'));
  for (const [partnerPath, filename] of [
    [WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0], 'launch-starfield-vr.ps1'],
    [WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0], 'run-starfield-aer-stabilizer-observe.ps1'],
  ]) {
    const paths = [splashPath, partnerPath];
    const [splash, partner] = await Promise.all([
      readFile(new URL('../../scripts/windows/launch-starfield-vr-with-splash.ps1', import.meta.url), 'utf8'),
      readFile(new URL('../../scripts/windows/' + filename, import.meta.url), 'utf8'),
    ]);
    const sources = [splash, partner].map((content, index) => ({
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path: paths[index], ref: HEAD, exists: true,
      size: Buffer.byteLength(content, 'utf8'), blobSha: gitBlobSha(content), content,
    }));
    const analysis = {
      findings: paths.map(path => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
      counts: { P0: 2, P1: 0, P2: 0 },
      verdict: 'findings',
    };
    const review = (overrides = {}) => analyzeWindowsAuthoritySpecialistReview({
      repository: 'Cheekyfellastef/stephan-os', sourceHead: HEAD,
      analysis: { ...analysis, ...overrides }, sources,
    });
    assert.equal(review().clean, true, 'baseline confirms registered positive proof paths');
    for (const [reason, override] of [
      ['zero P0', { counts: { P0: 0, P1: 0, P2: 0 } }],
      ['extra P0', { counts: { P0: 3, P1: 0, P2: 0 } }],
      ['coerced P0', { counts: { P0: '2', P1: 0, P2: 0 } }],
      ['extra P1', { counts: { P0: 2, P1: 1, P2: 0 } }],
      ['extra P2', { counts: { P0: 2, P1: 0, P2: 1 } }],
      ['missing counts', { counts: undefined }],
      ['array counts', { counts: [2, 0, 0] }],
      ['false clean', { verdict: 'clean' }],
      ['missing verdict', { verdict: undefined }],
    ]) {
      const result = review(override);
      assert.equal(result.eligible, true, reason);
      assert.equal(result.clean, false, reason);
      assert.deepEqual(result.proofRefs, [], reason);
      assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_COMPOSITE_ESCALATION_ENVELOPE_INVALID', reason);
      assert.equal(result.schemaVersion, 'stephanos.windows-authority-specialist-review.v1', reason);
      for (const property of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority']) {
        assert.equal(result[property], false, reason + ': ' + property);
      }
    }
  }
});
