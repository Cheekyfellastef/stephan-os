import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBrowserProofMachineResult,
  buildBrowserProofPacket,
  collectPlaywrightNavigationDistFingerprint,
  collectScenarioSourceResponseBinding,
  collectServedDistFingerprint,
  createScenarioSourceGitEnvironment,
  evaluateBrowserProofResult,
  evaluateMusicRatingPreservesPlaybackScenarioEvidence,
  parseBrowserProofArguments,
  readExpectedDistManifest,
  shouldGenerateBrowserProofPacket,
} from './browser-proof-runner.mjs';
import {
  computeStephanosDistFingerprint,
  createStephanosDistManifest,
} from './stephanos-build-utils.mjs';

test('browser proof packet generated only when nextProof is browser-proof-checklist', () => {
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'browser-proof-checklist' } }), true);
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'verify-proof' } }), false);
});

test('scenario Git reads strip inherited Git controls case-insensitively on Windows', () => {
  const environment = createScenarioSourceGitEnvironment({
    Path: 'C:\\Windows\\System32',
    git_dir: 'C:\\attacker\\repo',
    Git_Object_Directory: 'C:\\attacker\\objects',
    GIT_CONFIG_COUNT: '1',
    git_config_key_0: 'core.sshCommand',
    Git_Config_Value_0: 'unsafe',
    GIT_REPLACE_REF_BASE: 'refs/attacker/',
  }, { platform: 'win32' });
  assert.equal(environment.Path, 'C:\\Windows\\System32');
  assert.equal(environment.git_dir, undefined);
  assert.equal(environment.Git_Object_Directory, undefined);
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.git_config_key_0, undefined);
  assert.equal(environment.Git_Config_Value_0, undefined);
  assert.equal(environment.GIT_REPLACE_REF_BASE, undefined);
  assert.equal(environment.GIT_CONFIG_GLOBAL, 'NUL');
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, '1');
  assert.deepEqual(
    Object.keys(environment).filter((key) => (
      key.toUpperCase().startsWith('GIT_')
      && ![
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_NO_LAZY_FETCH',
        'GIT_NO_REPLACE_OBJECTS',
        'GIT_OPTIONAL_LOCKS',
        'GIT_TERMINAL_PROMPT',
      ].includes(key)
    )),
    [],
  );
});

test('successful DOM proof accepts browser-proof-checklist', () => {
  const result = { browserAutomationAvailable: true, checks: { runtimeReachable: true, footerGitCommitPresent: true, uiBuildTimestampPresent: true, proofConciergeDomNextProofMatches: true, proofConciergePrimaryButtonPresent: true, proofConciergeVisibleDriftClear: true, cloneParityClear: true, operatorDiagnosticCopyPresent: true, consoleErrorCount: 0 } };
  assert.equal(evaluateBrowserProofResult(result).accepted, true);
  assert.match(buildBrowserProofPacket(result), /Status: observed/);
});

test('console errors remain visible merge blockers on an observed browser proof', () => {
  const result = { browserAutomationAvailable: true, checks: { runtimeReachable: true, footerGitCommitPresent: true, uiBuildTimestampPresent: true, proofConciergeDomNextProofMatches: true, proofConciergePrimaryButtonPresent: true, proofConciergeVisibleDriftClear: true, cloneParityClear: true, operatorDiagnosticCopyPresent: true, consoleErrorCount: 2 } };
  const verdict = evaluateBrowserProofResult(result);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.mergeReady, false);
  assert.match(verdict.blocking.join(' | '), /console error count 2/);
});

test('exact-head proof accepts only the full Git commit observed in the live browser DOM', () => {
  const expectedHead = 'a'.repeat(40);
  const base = {
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  };
  const matching = evaluateBrowserProofResult(base, { expectedHead });
  assert.equal(matching.accepted, true);
  assert.equal(matching.expectedHeadMatch, true);
  assert.equal(matching.runtimeSourceHead, expectedHead);

  const stale = evaluateBrowserProofResult({
    ...base,
    checks: { ...base.checks, footerGitCommit: 'b'.repeat(40) },
  }, { expectedHead });
  assert.equal(stale.accepted, false);
  assert.equal(stale.expectedHeadMatch, false);
  assert.match(stale.blocking.join(' | '), /does not match expected head/);
  assert.match(buildBrowserProofPacket({
    ...base,
    checks: { ...base.checks, footerGitCommit: 'b'.repeat(40) },
  }, { expectedHead }), /Status: rejected/);
});

test('parses an exact approved head without confusing it with the runtime URL', () => {
  const expectedHead = 'a'.repeat(40);
  const expectedSourceFingerprint = 'b'.repeat(64);
  const expectedDistFingerprint = 'c'.repeat(64);
  assert.deepEqual(parseBrowserProofArguments(['--expected-head', expectedHead, '--no-artifacts', '--machine-json']), {
    ok: true,
    url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    expectedHead,
    expectedSourceFingerprint: '',
    expectedDistFingerprint: '',
    expectedDistManifestPath: '',
    proofScenario: '',
    proofTarget: 'PULL_REQUEST_HEAD',
    writeArtifacts: false,
    machineJson: true,
  });
  assert.equal(
    parseBrowserProofArguments([
      '--expected-head',
      expectedHead,
      '--expected-source-fingerprint',
      expectedSourceFingerprint,
    ]).expectedSourceFingerprint,
    expectedSourceFingerprint,
  );
  assert.equal(
    parseBrowserProofArguments([
      '--expected-dist-fingerprint',
      expectedDistFingerprint,
      '--expected-dist-manifest',
      '/proof/canonical-dist-manifest.json',
    ]).expectedDistFingerprint,
    expectedDistFingerprint,
  );
  assert.equal(parseBrowserProofArguments(['--expected-head', 'short']).blocker, 'EXPECTED_HEAD_INVALID');
  assert.equal(
    parseBrowserProofArguments(['--expected-source-fingerprint', 'short']).blocker,
    'EXPECTED_SOURCE_FINGERPRINT_INVALID',
  );
  assert.equal(
    parseBrowserProofArguments(['--expected-dist-fingerprint', 'short']).blocker,
    'EXPECTED_DIST_FINGERPRINT_INVALID',
  );
  assert.equal(
    parseBrowserProofArguments([
      '--expected-dist-fingerprint',
      expectedDistFingerprint,
    ]).blocker,
    'EXPECTED_DIST_MANIFEST_INVALID',
  );
  assert.equal(
    parseBrowserProofArguments([
      '--expected-head',
      expectedHead,
      '--proof-scenario',
      'MUSIC_RATING_PRESERVES_PLAYBACK',
    ]).proofScenario,
    'MUSIC_RATING_PRESERVES_PLAYBACK',
  );
  assert.equal(
    parseBrowserProofArguments([
      '--expected-head',
      expectedHead,
      '--proof-target',
      'MERGED_MAIN',
      '--proof-scenario',
      'MUSIC_RATING_PRESERVES_PLAYBACK',
    ]).proofTarget,
    'MERGED_MAIN',
  );
  assert.equal(
    parseBrowserProofArguments(['--proof-target', 'MERGED_MAIN']).blocker,
    'PROOF_SCENARIO_REQUIRED_FOR_MERGED_MAIN',
  );
  assert.equal(
    parseBrowserProofArguments(['--proof-target', 'UNTRUSTED_TARGET']).blocker,
    'PROOF_TARGET_INVALID',
  );
  assert.equal(
    parseBrowserProofArguments([
      '--proof-scenario',
      'MUSIC_RATING_PRESERVES_PLAYBACK',
    ]).blocker,
    'EXPECTED_HEAD_REQUIRED_FOR_PROOF_SCENARIO',
  );
  assert.equal(
    parseBrowserProofArguments(['--proof-scenario', 'UNTRUSTED_SCENARIO']).blocker,
    'PROOF_SCENARIO_INVALID',
  );
});

test('machine result exposes the browser-observed exact-head decision without relying on model text', () => {
  const expectedHead = 'a'.repeat(40);
  const expectedSourceFingerprint = 'b'.repeat(64);
  const expectedDistFingerprint = 'c'.repeat(64);
  const result = buildBrowserProofMachineResult({
    browserAutomationAvailable: true,
    url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      sourceFingerprint: expectedSourceFingerprint,
      runtimeDistFingerprint: expectedDistFingerprint,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  }, { expectedHead, expectedSourceFingerprint, expectedDistFingerprint });
  assert.equal(result.schemaVersion, 'stephanos.browser-runtime-exact-head-proof.v3');
  assert.equal(result.url, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(result.observedUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(result.accepted, true);
  assert.equal(result.mergeReady, true);
  assert.deepEqual(result.blocking, []);
  assert.equal(result.runtimeSourceHead, expectedHead);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeSourceFingerprint, expectedSourceFingerprint);
  assert.equal(result.expectedSourceFingerprintMatch, true);
  assert.equal(result.runtimeDistFingerprint, expectedDistFingerprint);
  assert.equal(result.expectedDistFingerprintMatch, true);
});

test('machine result fails closed when observed browser evidence still has merge blockers', () => {
  const result = buildBrowserProofMachineResult({
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: false,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 1,
    },
  });
  assert.equal(result.observed, true);
  assert.equal(result.accepted, false);
  assert.equal(result.mergeReady, false);
  assert.deepEqual(result.blocking, [
    'Proof Concierge primary button missing',
    'console error count 1',
  ]);
});

function musicScenarioEvidence(overrides = {}) {
  return {
    schemaVersion: 'stephanos.browser-scenario-evidence.music-rating-preserves-playback.v2',
    proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    collector: 'playwright-page-v1',
    observed: true,
    fixture: 'isolated-browser-context-v1',
    playbackContinuityProxy: 'intercepted-spotify-frame-tick-v1',
    sourceResponseBinding: {
      exact: true,
      blocker: '',
      sourceHead: 'a'.repeat(40),
      fileCount: 3,
      responseBinding: 'playwright-scenario-source-responses-git-blob-v2',
      paths: [
        'apps/music-tile/index.html',
        'apps/music-tile/main.js',
        'shared/runtime/tileEventBridge.js',
      ],
    },
    ratingInteraction: {
      trackId: 'anyma-pictures-of-you',
      requestedRating: 2,
      persistedRating: 2,
      selectedButtonPressed: true,
      selectedButtonActive: true,
      cardRatingTextUpdated: true,
    },
    listeningDeckIframe: {
      beforePresent: true,
      sameNode: true,
      isConnected: true,
      srcUnchanged: true,
      contentWindowPreserved: true,
      frameIdentityPreserved: true,
      frameNavigationCount: 0,
      frameDetachCount: 0,
      playbackSentinelAdvanced: true,
    },
    discoveryIframe: {
      beforePresent: true,
      sameNode: true,
      isConnected: true,
      srcUnchanged: true,
      contentWindowPreserved: true,
      frameIdentityPreserved: true,
      frameNavigationCount: 0,
      frameDetachCount: 0,
      playbackSentinelAdvanced: true,
    },
    legacyRanking: {
      before: ['Other Artist - Alpha'],
      after: ['Anyma - Pictures Of You'],
      beforeIds: ['other-alpha', 'anyma-pictures-of-you'],
      afterIds: ['anyma-pictures-of-you', 'other-alpha'],
      targetId: 'anyma-pictures-of-you',
      targetLabel: 'Anyma - Pictures Of You',
      beforeIndex: 1,
      afterIndex: 0,
      beforeTargetScore: 0,
      afterTargetScore: 2.5,
      changed: true,
      targetMovedUp: true,
      sameMembers: true,
      legacyDomMatchesStoredBefore: true,
      legacyDomMatchesStoredAfter: true,
      candidateDomMatchesStoredBefore: true,
      candidateDomMatchesStoredAfter: true,
    },
    consoleErrors: [],
    pageErrors: [],
    blockers: [],
    ...overrides,
  };
}

test('requested music scenario accepts only detailed Playwright-collected interaction evidence', () => {
  const evidence = musicScenarioEvidence();
  const expectedHead = 'a'.repeat(40);
  const evaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    evidence,
    { expectedHead },
  );
  assert.equal(evaluation.accepted, true);
  assert.equal(evaluation.listeningDeckIframeIdentityPreserved, true);
  assert.equal(evaluation.discoveryIframeIdentityPreserved, true);
  assert.equal(evaluation.legacyRankingChanged, true);

  const omittedCommit = evaluateMusicRatingPreservesPlaybackScenarioEvidence(evidence);
  assert.equal(omittedCommit.accepted, false);
  assert.match(omittedCommit.blocking.join(' | '), /SOURCE_HEAD_INVALID/);

  const wrongCommit = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    evidence,
    { expectedHead: 'b'.repeat(40) },
  );
  assert.equal(wrongCommit.accepted, false);
  assert.match(wrongCommit.blocking.join(' | '), /SOURCE_HEAD_MISMATCH/);

  const missing = evaluateBrowserProofResult({
    browserAutomationAvailable: true,
    checks: { runtimeReachable: true },
  }, { proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK' });
  assert.equal(missing.accepted, false);
  assert.equal(missing.scenarioEvidenceAccepted, false);

  const navigated = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    musicScenarioEvidence({
      listeningDeckIframe: {
        ...evidence.listeningDeckIframe,
        frameNavigationCount: 1,
      },
    }),
    { expectedHead },
  );
  assert.equal(navigated.accepted, false);
  assert.match(navigated.blocking.join(' | '), /LISTENING_IFRAME_REPLACED/);
});

test('merged-main music proof rejects the timer fixture and requires same-player media progression', async () => {
  const expectedHead = 'a'.repeat(40);
  const fixtureEvaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    musicScenarioEvidence(),
    { expectedHead, proofTarget: 'MERGED_MAIN' },
  );
  assert.equal(fixtureEvaluation.accepted, false);
  assert.equal(fixtureEvaluation.livePlaybackObserved, false);
  assert.match(fixtureEvaluation.blocking.join(' | '), /LIVE_PLAYBACK_NOT_OBSERVED/);

  const liveEvidence = musicScenarioEvidence({
    fixture: 'live-runtime-v1',
    playbackContinuityProxy: 'same-player-media-time-v1',
    PLAYBACK_CONTINUED_AFTER_RATING: true,
    listeningDeckIframe: {
      ...musicScenarioEvidence().listeningDeckIframe,
      playbackMediaElementIdentityPreserved: true,
      playbackMediaSourceUnchanged: true,
      playbackMediaPlayingBefore: true,
      playbackMediaPlayingAfter: true,
      playbackMediaTimeAdvanced: true,
      playbackMediaTimeBefore: 12.25,
      playbackMediaTimeAfter: 13.75,
    },
  });
  const liveEvaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
    liveEvidence,
    { expectedHead, proofTarget: 'MERGED_MAIN' },
  );
  assert.equal(liveEvaluation.accepted, true);
  assert.equal(liveEvaluation.livePlaybackObserved, true);
});

test('machine result binds requested scenario PASS to typed browser evidence', () => {
  const expectedHead = 'a'.repeat(40);
  const evidence = musicScenarioEvidence();
  const result = buildBrowserProofMachineResult({
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
    scenarioEvidence: evidence,
  }, {
    expectedHead,
    proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
  });
  assert.equal(result.schemaVersion, 'stephanos.browser-runtime-exact-head-proof.v3');
  assert.equal(result.accepted, true);
  assert.equal(result.proofScenario, 'MUSIC_RATING_PRESERVES_PLAYBACK');
  assert.equal(result.scenarioEvidenceAccepted, true);
  assert.equal(result.scenarioEvidence.ratingInteraction.persistedRating, 2);
});

test('exact-head proof rejects a served source fingerprint from a dirty or different build', () => {
  const expectedHead = 'a'.repeat(40);
  const expectedSourceFingerprint = 'b'.repeat(64);
  const result = {
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      sourceFingerprint: 'c'.repeat(64),
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  };
  const verdict = evaluateBrowserProofResult(result, { expectedHead, expectedSourceFingerprint });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.expectedHeadMatch, true);
  assert.equal(verdict.expectedSourceFingerprintMatch, false);
  assert.match(verdict.blocking.join(' | '), /fingerprint does not match/);
});

test('exact-head proof rejects forged matching metadata when served dist bytes differ', () => {
  const expectedHead = 'a'.repeat(40);
  const expectedSourceFingerprint = 'b'.repeat(64);
  const expectedDistFingerprint = 'c'.repeat(64);
  const verdict = evaluateBrowserProofResult({
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      sourceFingerprint: expectedSourceFingerprint,
      runtimeDistFingerprint: 'd'.repeat(64),
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  }, { expectedHead, expectedSourceFingerprint, expectedDistFingerprint });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.expectedHeadMatch, true);
  assert.equal(verdict.expectedSourceFingerprintMatch, true);
  assert.equal(verdict.expectedDistFingerprintMatch, false);
  assert.match(verdict.blocking.join(' | '), /dist fingerprint does not match/);

  const missing = evaluateBrowserProofResult({
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      footerGitCommit: expectedHead,
      sourceFingerprint: expectedSourceFingerprint,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  }, { expectedHead, expectedSourceFingerprint, expectedDistFingerprint });
  assert.equal(missing.accepted, false);
  assert.equal(missing.expectedDistFingerprintMatch, false);
  assert.match(missing.blocking.join(' | '), /dist fingerprint is not a full/);
});

function distFixture({
  indexHtml = '<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">',
} = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'stephanos-dist-fingerprint-'));
  const distRoot = join(rootDir, 'apps', 'stephanos', 'dist');
  mkdirSync(join(distRoot, 'assets'), { recursive: true });
  const files = {
    'index.html': indexHtml,
    'stephanos-build.json': '{"sourceFingerprint":"fixture"}\n',
    'assets/app.js': 'globalThis.__STEPHANOS_FIXTURE__ = true;\n',
    'assets/app.css': 'body { color: green; }\n',
    'assets/lazy-chunk.js': 'globalThis.__STEPHANOS_LAZY_FIXTURE__ = true;\n',
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(distRoot, ...relativePath.split('/'));
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return { rootDir, distRoot, files };
}

function createFixtureFetch(files, {
  mutate = {},
  calls = [],
} = {}) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const marker = '/apps/stephanos/dist/';
    const markerIndex = parsed.pathname.indexOf(marker);
    const relativePath = markerIndex >= 0
      ? parsed.pathname.slice(markerIndex + marker.length)
      : '';
    calls.push({ relativePath, options });
    const contents = Object.hasOwn(mutate, relativePath)
      ? mutate[relativePath]
      : files[relativePath];
    if (contents == null) return new Response('missing', { status: 404 });
    return new Response(contents, {
      status: 200,
      headers: { 'content-length': String(Buffer.byteLength(contents)) },
    });
  };
}

test('browser runner independently fetches no-store and reproduces the canonical raw dist fingerprint', async () => {
  const { rootDir, files } = distFixture();
  const expectedManifest = createStephanosDistManifest({ rootDir });
  const expectedDistFingerprint = expectedManifest.fingerprint;
  const calls = [];
  const served = await collectServedDistFingerprint(
    'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    {
      fetchFn: createFixtureFetch(files, { calls }),
      expectedEntries: expectedManifest.entries,
    },
  );
  assert.equal(served.ok, true);
  assert.equal(served.fingerprint, expectedDistFingerprint);
  assert.equal(served.fileCount, 5);
  assert.deepEqual(
    calls.map((call) => call.relativePath).sort(),
    [
      'assets/app.css',
      'assets/app.js',
      'assets/lazy-chunk.js',
      'index.html',
      'stephanos-build.json',
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers['cache-control'], 'no-store');
  }

  const modified = await collectServedDistFingerprint(
    'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    {
      fetchFn: createFixtureFetch(files, {
        mutate: { 'assets/app.js': 'globalThis.__FORGED_RUNTIME__ = true;\n' },
      }),
      expectedEntries: expectedManifest.entries,
    },
  );
  assert.equal(modified.ok, true);
  assert.notEqual(modified.fingerprint, expectedDistFingerprint);
});

function playwrightResponse(url, contents, headers = {}) {
  const bytes = Buffer.from(contents);
  return {
    url: () => url,
    status: () => 200,
    allHeaders: async () => ({
      'content-length': String(bytes.length),
      ...headers,
    }),
    body: async () => bytes,
  };
}

function commitAllScenarioSourceFiles(repoRoot, message) {
  execFileSync('git', ['add', '--all'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('git', [
    '-c',
    'user.name=Stephanos Test',
    '-c',
    'user.email=stephanos-test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    message,
  ], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitScenarioSourceFixture(repoRoot) {
  execFileSync('git', ['init', '--quiet'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return commitAllScenarioSourceFiles(repoRoot, 'scenario source fixture');
}

test('scenario source binding compares browser responses with immutable approved-commit blobs', async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'stephanos-scenario-source-binding-'));
  const files = {
    'apps/music-tile/index.html': '<!doctype html><script type="module" src="./main.js"></script>',
    'apps/music-tile/main.js': 'import "../../../shared/runtime/proof.mjs";\n',
    'shared/runtime/proof.mjs': 'globalThis.__SCENARIO_SOURCE_BOUND__ = true;\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(repoRoot, ...path.split('/'));
    mkdirSync(join(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  const expectedHead = commitScenarioSourceFixture(repoRoot);
  const origin = 'http://127.0.0.1:4173';
  const canonical = await collectScenarioSourceResponseBinding(
    Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    {
      scenarioUrl: `${origin}/apps/music-tile/index.html`,
      repoRoot,
      expectedHead,
    },
  );
  assert.equal(canonical.exact, true);
  assert.equal(canonical.sourceHead, expectedHead);
  assert.equal(canonical.responseBinding, 'playwright-scenario-source-responses-git-blob-v2');
  assert.equal(canonical.fileCount, 3);
  assert.deepEqual(canonical.paths, Object.keys(files).sort());
  assert.equal(canonical.entries.every((entry) => /^[0-9a-f]{40}$/.test(entry.gitBlob)), true);

  const transientMain = 'x'.repeat(Buffer.byteLength(files['apps/music-tile/main.js']));
  writeFileSync(join(repoRoot, 'apps', 'music-tile', 'main.js'), transientMain);
  const committedBytesDespiteDirtyWorktree = await collectScenarioSourceResponseBinding(
    Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    {
      scenarioUrl: `${origin}/apps/music-tile/index.html`,
      repoRoot,
      expectedHead,
    },
  );
  assert.equal(committedBytesDespiteDirtyWorktree.exact, true);

  const modified = await collectScenarioSourceResponseBinding([
    playwrightResponse(`${origin}/apps/music-tile/index.html`, files['apps/music-tile/index.html']),
    playwrightResponse(
      `${origin}/apps/music-tile/main.js`,
      transientMain,
    ),
  ], {
    scenarioUrl: `${origin}/apps/music-tile/index.html`,
    repoRoot,
    expectedHead,
  });
  assert.equal(modified.exact, false);
  assert.equal(modified.blocker, 'BROWSER_SCENARIO_SOURCE_RESPONSE_MISMATCH');

  const replacementHead = commitAllScenarioSourceFiles(repoRoot, 'transient replacement source');
  execFileSync('git', ['replace', expectedHead, replacementHead], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const replaceRefIgnored = await collectScenarioSourceResponseBinding(
    Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    {
      scenarioUrl: `${origin}/apps/music-tile/index.html`,
      repoRoot,
      expectedHead,
    },
  );
  assert.equal(replaceRefIgnored.exact, true);
  assert.equal(replaceRefIgnored.sourceHead, expectedHead);

  const oversized = await collectScenarioSourceResponseBinding([
    playwrightResponse(
      `${origin}/apps/music-tile/index.html`,
      files['apps/music-tile/index.html'],
      { 'content-length': String(33 * 1024 * 1024) },
    ),
    playwrightResponse(`${origin}/apps/music-tile/main.js`, files['apps/music-tile/main.js']),
  ], {
    scenarioUrl: `${origin}/apps/music-tile/index.html`,
    repoRoot,
    expectedHead,
  });
  assert.equal(oversized.exact, false);
  assert.equal(oversized.blocker, 'BROWSER_SCENARIO_SOURCE_RESPONSE_SIZE_INVALID');

  const missingLength = await collectScenarioSourceResponseBinding([
    playwrightResponse(
      `${origin}/apps/music-tile/index.html`,
      files['apps/music-tile/index.html'],
      { 'content-length': '' },
    ),
    playwrightResponse(`${origin}/apps/music-tile/main.js`, files['apps/music-tile/main.js']),
  ], {
    scenarioUrl: `${origin}/apps/music-tile/index.html`,
    repoRoot,
    expectedHead,
  });
  assert.equal(missingLength.exact, false);
  assert.equal(missingLength.blocker, 'BROWSER_SCENARIO_SOURCE_RESPONSE_LENGTH_MISSING');

  const totalFixtureBytes = Object.values(files)
    .reduce((sum, contents) => sum + Buffer.byteLength(contents), 0);
  const duplicate = await collectScenarioSourceResponseBinding([
    ...Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    playwrightResponse(`${origin}/apps/music-tile/main.js`, files['apps/music-tile/main.js']),
  ], {
    scenarioUrl: `${origin}/apps/music-tile/index.html`,
    repoRoot,
    expectedHead,
    maxFiles: Object.keys(files).length,
    maxTotalBytes: totalFixtureBytes,
  });
  assert.equal(duplicate.exact, false);
  assert.equal(duplicate.blocker, 'BROWSER_SCENARIO_SOURCE_RESPONSE_DUPLICATE');

  const missingApprovedHead = await collectScenarioSourceResponseBinding(
    Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    {
      scenarioUrl: `${origin}/apps/music-tile/index.html`,
      repoRoot,
    },
  );
  assert.equal(missingApprovedHead.exact, false);
  assert.equal(missingApprovedHead.blocker, 'BROWSER_SCENARIO_SOURCE_HEAD_INVALID');

  const invalidLimits = await collectScenarioSourceResponseBinding(
    Object.entries(files).map(([path, contents]) => (
      playwrightResponse(`${origin}/${path}`, contents)
    )),
    {
      scenarioUrl: `${origin}/apps/music-tile/index.html`,
      repoRoot,
      expectedHead,
      maxFiles: Number.NaN,
    },
  );
  assert.equal(invalidLimits.exact, false);
  assert.equal(invalidLimits.blocker, 'BROWSER_SCENARIO_SOURCE_LIMIT_INVALID');
});

test('exact dist proof hashes the Playwright navigation and resource responses, not a second client', async () => {
  const { rootDir, files } = distFixture();
  const manifest = createStephanosDistManifest({ rootDir });
  const baseUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/';
  const capturedResponses = [
    playwrightResponse(
      `${baseUrl}assets/app.js`,
      'globalThis.__FORGED_EDGE_RUNTIME__ = true;\n',
    ),
    playwrightResponse(`${baseUrl}assets/app.css`, files['assets/app.css']),
  ];
  const page = {
    async evaluate(_callback, assetUrl) {
      const relativePath = new URL(assetUrl).pathname.split('/apps/stephanos/dist/')[1];
      capturedResponses.push(playwrightResponse(assetUrl, files[relativePath]));
    },
  };
  const result = await collectPlaywrightNavigationDistFingerprint(
    page,
    `${baseUrl}index.html`,
    {
      navigationResponse: playwrightResponse(`${baseUrl}index.html`, files['index.html']),
      capturedResponses,
      expectedEntries: manifest.entries,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_RUNTIME_DIST_ASSET_MISMATCH');
  assert.equal(result.responseBinding, 'playwright-navigation-and-browser-context-v1');

  const canonicalResponses = [
    playwrightResponse(`${baseUrl}assets/app.js`, files['assets/app.js']),
    playwrightResponse(`${baseUrl}assets/app.css`, files['assets/app.css']),
  ];
  const canonicalPage = {
    async evaluate(_callback, assetUrl) {
      const relativePath = new URL(assetUrl).pathname.split('/apps/stephanos/dist/')[1];
      canonicalResponses.push(playwrightResponse(assetUrl, files[relativePath]));
    },
  };
  const canonical = await collectPlaywrightNavigationDistFingerprint(
    canonicalPage,
    `${baseUrl}index.html`,
    {
      navigationResponse: playwrightResponse(`${baseUrl}index.html`, files['index.html']),
      capturedResponses: canonicalResponses,
      expectedEntries: manifest.entries,
    },
  );
  assert.equal(canonical.ok, true);
  assert.equal(canonical.fingerprint, manifest.fingerprint);

  canonicalResponses.push(
    playwrightResponse(
      `${baseUrl}assets/injected-after-build.js`,
      'globalThis.__INJECTED_AFTER_BUILD__ = true;\n',
    ),
  );
  const unexpected = await collectPlaywrightNavigationDistFingerprint(
    canonicalPage,
    `${baseUrl}index.html`,
    {
      navigationResponse: playwrightResponse(`${baseUrl}index.html`, files['index.html']),
      capturedResponses: canonicalResponses,
      expectedEntries: manifest.entries,
    },
  );
  assert.equal(unexpected.ok, false);
  assert.equal(unexpected.blocker, 'BROWSER_RUNTIME_DIST_UNEXPECTED_RESPONSE');
});

test('persisted expected dist manifest is bounded and fingerprint-bound', () => {
  const { rootDir } = distFixture();
  const manifest = createStephanosDistManifest({ rootDir });
  const manifestPath = join(rootDir, 'canonical-dist-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const valid = readExpectedDistManifest(manifestPath, manifest.fingerprint);
  assert.equal(valid.ok, true);
  assert.equal(valid.fileCount, manifest.fileCount);

  const mismatched = readExpectedDistManifest(manifestPath, 'f'.repeat(64));
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.blocker, 'EXPECTED_DIST_MANIFEST_INVALID');
});

test('dist manifest rejects duplicate, escaping, nonregular and symlinked runtime assets', () => {
  const duplicate = distFixture({
    indexHtml: '<script src="./assets/app.js"></script><script src="./assets/app.js"></script>',
  });
  assert.throws(
    () => createStephanosDistManifest({ rootDir: duplicate.rootDir }),
    /STEPHANOS_DIST_ASSET_REFERENCE_DUPLICATE/,
  );

  const escaping = distFixture({
    indexHtml: '<script src="../outside.js"></script>',
  });
  assert.throws(
    () => createStephanosDistManifest({ rootDir: escaping.rootDir }),
    /STEPHANOS_DIST_ASSET_REFERENCE_INVALID/,
  );

  const nonregular = distFixture();
  mkdirSync(join(nonregular.distRoot, 'assets', 'directory.js'));
  writeFileSync(
    join(nonregular.distRoot, 'index.html'),
    '<script src="./assets/directory.js"></script>',
  );
  assert.throws(
    () => createStephanosDistManifest({ rootDir: nonregular.rootDir }),
    /STEPHANOS_DIST_MANIFEST_(?:FILE_NOT_REGULAR|REQUIRED_FILE_MISSING)/,
  );

  const symlinked = distFixture();
  symlinkSync(
    join(symlinked.distRoot, 'assets', 'app.js'),
    join(symlinked.distRoot, 'assets', 'linked.js'),
  );
  writeFileSync(
    join(symlinked.distRoot, 'index.html'),
    '<script src="./assets/linked.js"></script>',
  );
  assert.throws(
    () => createStephanosDistManifest({ rootDir: symlinked.rootDir }),
    /STEPHANOS_DIST_MANIFEST_(?:FILE_NOT_REGULAR|PATH_NOT_REGULAR)/,
  );

  const ancestorSymlink = distFixture();
  const outsideAssets = mkdtempSync(join(tmpdir(), 'stephanos-outside-assets-'));
  writeFileSync(
    join(outsideAssets, 'outside.js'),
    'globalThis.__OUTSIDE_DIST_BOUNDARY__ = true;\n',
  );
  const linkedAssetsPath = join(ancestorSymlink.distRoot, 'linked-assets');
  symlinkSync(outsideAssets, linkedAssetsPath, 'dir');
  writeFileSync(
    join(ancestorSymlink.distRoot, 'index.html'),
    '<script src="./linked-assets/outside.js"></script>',
  );
  assert.throws(
    () => createStephanosDistManifest({ rootDir: ancestorSymlink.rootDir }),
    /STEPHANOS_DIST_MANIFEST_PATH_NOT_REGULAR/,
  );

  const outsideRepo = distFixture();
  const redirectedRoot = mkdtempSync(join(tmpdir(), 'stephanos-redirected-root-'));
  symlinkSync(
    join(outsideRepo.rootDir, 'apps'),
    join(redirectedRoot, 'apps'),
    'dir',
  );
  assert.throws(
    () => createStephanosDistManifest({ rootDir: redirectedRoot }),
    /STEPHANOS_DIST_MANIFEST_ROOT_NOT_REGULAR/,
  );
});

test('automation unavailable creates diagnostic repair packet', () => {
  const packet = buildBrowserProofPacket({ browserAutomationAvailable: false, automationUnavailable: 'Edge channel missing', checks: { runtimeReachable: false } });
  assert.match(packet, /Browser Proof Repair Packet V1/);
  assert.match(packet, /Status: repair-required/);
  assert.match(packet, /Repair action:/);
});

test('browser proof packet keeps safety locks closed', () => {
  const packet = buildBrowserProofPacket({ browserAutomationAvailable: false, automationUnavailable: 'Playwright unavailable', checks: {} });
  assert.match(packet, /mutation no/);
  assert.match(packet, /Codex auto-dispatch no/);
  assert.match(packet, /OpenClaw locked/);
  assert.match(packet, /merge readiness no \/ hold/);
  assert.match(packet, /no paid APIs/);
});

test('automation repair packet does not tell Codex to download browser binaries', () => {
  const packet = buildBrowserProofPacket({ browserAutomationAvailable: false, automationUnavailable: 'Playwright browser executable unavailable; use installed Microsoft Edge/system browser on the operator desktop instead of downloading browser binaries in Codex.', checks: { runtimeReachable: false } });
  assert.doesNotMatch(packet, /npx playwright install/);
  assert.match(packet, /Microsoft Edge\/system browser/);
});
