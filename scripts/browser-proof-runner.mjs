import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
  STEPHANOS_DIST_MANIFEST_MAX_FILES,
  STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
  STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION,
  computeStephanosDistManifestFingerprint,
  getStephanosDistRuntimeAssetReferences,
} from './stephanos-build-utils.mjs';

const DEFAULT_URL = process.env.STEPHANOS_BROWSER_PROOF_URL || 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'tmp/browser-proof');
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;
const EXACT_SOURCE_FINGERPRINT = /^[0-9a-f]{64}$/;
const EXACT_DIST_FINGERPRINT = /^[0-9a-f]{64}$/;
const MUSIC_RATING_PRESERVES_PLAYBACK = 'MUSIC_RATING_PRESERVES_PLAYBACK';
const ALLOWED_PROOF_SCENARIOS = new Set([MUSIC_RATING_PRESERVES_PLAYBACK]);
const MUSIC_RATING_SCENARIO_EVIDENCE_SCHEMA = 'stephanos.browser-scenario-evidence.music-rating-preserves-playback.v2';
const BROWSER_RUNTIME_PROOF_SCHEMA = 'stephanos.browser-runtime-exact-head-proof.v3';
const SCENARIO_SOURCE_RESPONSE_BINDING = 'playwright-scenario-source-responses-git-blob-v2';
const MUSIC_TILE_STATE_KEY = 'stephanos.musicTile.dashboardState.v1';
const MUSIC_TILE_SCENARIO_PATH = '/apps/music-tile/index.html';
const MUSIC_TILE_SCENARIO_TRACK_ID = 'anyma-pictures-of-you';
const MUSIC_TILE_SCENARIO_TRACK_LABEL = 'Anyma - Pictures Of You';
const MUSIC_TILE_SCENARIO_RATING = 2;

function stamp() { return new Date().toISOString(); }
function ok(v) { return v === true || v === 'yes' || v === 0; }
function line(label, value) { return `${label}: ${value == null || value === '' ? 'unavailable' : value}`; }
function sanitizeAutomationUnavailable(message = '') {
  const text = String(message || 'browser automation unavailable');
  if (/Executable doesn't exist|Please run the following command to download new browsers|playwright install/i.test(text)) {
    return 'Playwright browser executable unavailable; use installed Microsoft Edge/system browser on the operator desktop instead of downloading browser binaries in Codex.';
  }
  return text.split('\n').slice(0, 3).join(' | ');
}

export function expectedNextProofFromProjection(projection = {}) {
  return projection?.operatorProofConcierge?.nextProof || projection?.nextProofToCollect || 'none';
}

export function shouldGenerateBrowserProofPacket(projection = {}) {
  return expectedNextProofFromProjection(projection) === 'browser-proof-checklist';
}

function normalizeGitHead(value = '') {
  const match = String(value || '').trim().toLowerCase().match(/\b[0-9a-f]{40}\b/);
  return match?.[0] || '';
}

export function parseBrowserProofArguments(argv = []) {
  let url = DEFAULT_URL;
  let expectedHead = '';
  let expectedSourceFingerprint = '';
  let expectedDistFingerprint = '';
  let expectedDistManifestPath = '';
  let proofScenario = '';
  let positionalUrlSeen = false;
  let writeArtifacts = true;
  let machineJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index] || '');
    if (argument === '--expected-head') {
      expectedHead = String(argv[index + 1] || '').trim().toLowerCase();
      index += 1;
      if (!EXACT_GIT_HEAD.test(expectedHead)) {
        return { ok: false, url, expectedHead, blocker: 'EXPECTED_HEAD_INVALID' };
      }
    } else if (argument === '--expected-source-fingerprint') {
      expectedSourceFingerprint = String(argv[index + 1] || '').trim().toLowerCase();
      index += 1;
      if (!EXACT_SOURCE_FINGERPRINT.test(expectedSourceFingerprint)) {
        return {
          ok: false,
          url,
          expectedHead,
          expectedSourceFingerprint,
          blocker: 'EXPECTED_SOURCE_FINGERPRINT_INVALID',
        };
      }
    } else if (argument === '--expected-dist-fingerprint') {
      expectedDistFingerprint = String(argv[index + 1] || '').trim().toLowerCase();
      index += 1;
      if (!EXACT_DIST_FINGERPRINT.test(expectedDistFingerprint)) {
        return {
          ok: false,
          url,
          expectedHead,
          expectedSourceFingerprint,
          expectedDistFingerprint,
          blocker: 'EXPECTED_DIST_FINGERPRINT_INVALID',
        };
      }
    } else if (argument === '--expected-dist-manifest') {
      expectedDistManifestPath = String(argv[index + 1] || '').trim();
      index += 1;
      if (!expectedDistManifestPath) {
        return {
          ok: false,
          url,
          expectedHead,
          expectedSourceFingerprint,
          expectedDistFingerprint,
          expectedDistManifestPath,
          blocker: 'EXPECTED_DIST_MANIFEST_INVALID',
        };
      }
    } else if (argument === '--proof-scenario') {
      proofScenario = String(argv[index + 1] || '').trim();
      index += 1;
      if (!ALLOWED_PROOF_SCENARIOS.has(proofScenario)) {
        return {
          ok: false,
          url,
          expectedHead,
          expectedSourceFingerprint,
          expectedDistFingerprint,
          expectedDistManifestPath,
          proofScenario,
          blocker: 'PROOF_SCENARIO_INVALID',
        };
      }
    } else if (argument === '--url') {
      url = String(argv[index + 1] || '').trim();
      index += 1;
      if (!url) return { ok: false, url: DEFAULT_URL, expectedHead, blocker: 'RUNTIME_URL_INVALID' };
    } else if (argument === '--no-artifacts') {
      writeArtifacts = false;
    } else if (argument === '--machine-json') {
      machineJson = true;
    } else if (!argument.startsWith('-') && !positionalUrlSeen) {
      url = argument;
      positionalUrlSeen = true;
    } else {
      return { ok: false, url, expectedHead, blocker: 'BROWSER_PROOF_ARGUMENT_INVALID' };
    }
  }
  if (expectedDistFingerprint && !expectedDistManifestPath) {
    return {
      ok: false,
      url,
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      proofScenario,
      blocker: 'EXPECTED_DIST_MANIFEST_INVALID',
      writeArtifacts,
      machineJson,
    };
  }
  if (proofScenario && !expectedHead) {
    return {
      ok: false,
      url,
      expectedHead,
      expectedSourceFingerprint,
      expectedDistFingerprint,
      expectedDistManifestPath,
      proofScenario,
      blocker: 'EXPECTED_HEAD_REQUIRED_FOR_PROOF_SCENARIO',
      writeArtifacts,
      machineJson,
    };
  }
  return {
    ok: true,
    url,
    expectedHead,
    expectedSourceFingerprint,
    expectedDistFingerprint,
    expectedDistManifestPath,
    proofScenario,
    writeArtifacts,
    machineJson,
  };
}

export function evaluateMusicRatingPreservesPlaybackScenarioEvidence(evidence = {}, {
  expectedHead = '',
} = {}) {
  const blocking = [];
  const listening = evidence?.listeningDeckIframe || {};
  const discovery = evidence?.discoveryIframe || {};
  const rating = evidence?.ratingInteraction || {};
  const ranking = evidence?.legacyRanking || {};
  const sourceBinding = evidence?.sourceResponseBinding || {};
  const consoleErrors = Array.isArray(evidence?.consoleErrors) ? evidence.consoleErrors : null;
  const scenarioBlockers = Array.isArray(evidence?.blockers) ? evidence.blockers : null;
  const beforeRanking = Array.isArray(ranking.before) ? ranking.before.map(String) : [];
  const afterRanking = Array.isArray(ranking.after) ? ranking.after.map(String) : [];
  const listeningDeckIframeIdentityPreserved = (
    listening.beforePresent === true
    && listening.sameNode === true
    && listening.isConnected === true
    && listening.srcUnchanged === true
    && listening.contentWindowPreserved === true
    && listening.frameIdentityPreserved === true
    && listening.frameNavigationCount === 0
    && listening.frameDetachCount === 0
    && listening.playbackSentinelAdvanced === true
  );
  const discoveryIframeIdentityPreserved = (
    discovery.beforePresent === true
    && discovery.sameNode === true
    && discovery.isConnected === true
    && discovery.srcUnchanged === true
    && discovery.contentWindowPreserved === true
    && discovery.frameIdentityPreserved === true
    && discovery.frameNavigationCount === 0
    && discovery.frameDetachCount === 0
    && discovery.playbackSentinelAdvanced === true
  );
  const legacyRankingChanged = (
    beforeRanking.length > 0
    && afterRanking.length > 0
    && JSON.stringify(beforeRanking) !== JSON.stringify(afterRanking)
    && ranking.changed === true
    && ranking.sameMembers === true
    && ranking.targetMovedUp === true
    && Number.isInteger(ranking.beforeIndex)
    && Number.isInteger(ranking.afterIndex)
    && ranking.beforeIndex > ranking.afterIndex
    && ranking.afterIndex === 0
    && ranking.targetLabel === MUSIC_TILE_SCENARIO_TRACK_LABEL
    && ranking.targetId === MUSIC_TILE_SCENARIO_TRACK_ID
    && Array.isArray(ranking.beforeIds)
    && Array.isArray(ranking.afterIds)
    && ranking.afterIds[0] === MUSIC_TILE_SCENARIO_TRACK_ID
    && ranking.beforeTargetScore === 0
    && ranking.afterTargetScore === 2.5
    && ranking.legacyDomMatchesStoredBefore === true
    && ranking.legacyDomMatchesStoredAfter === true
    && ranking.candidateDomMatchesStoredBefore === true
    && ranking.candidateDomMatchesStoredAfter === true
  );
  const ratingInteractionObserved = (
    rating.trackId === MUSIC_TILE_SCENARIO_TRACK_ID
    && rating.requestedRating === MUSIC_TILE_SCENARIO_RATING
    && rating.persistedRating === MUSIC_TILE_SCENARIO_RATING
    && rating.selectedButtonPressed === true
    && rating.selectedButtonActive === true
    && rating.cardRatingTextUpdated === true
  );
  if (evidence?.schemaVersion !== MUSIC_RATING_SCENARIO_EVIDENCE_SCHEMA) {
    blocking.push('BROWSER_SCENARIO_EVIDENCE_SCHEMA_INVALID');
  }
  if (evidence?.proofScenario !== MUSIC_RATING_PRESERVES_PLAYBACK) {
    blocking.push('BROWSER_SCENARIO_EVIDENCE_SCENARIO_MISMATCH');
  }
  if (evidence?.collector !== 'playwright-page-v1' || evidence?.observed !== true) {
    blocking.push('BROWSER_SCENARIO_NOT_OBSERVED');
  }
  if (
    sourceBinding.exact !== true
    || !Number.isInteger(sourceBinding.fileCount)
    || sourceBinding.fileCount < 2
    || !Array.isArray(sourceBinding.paths)
    || !sourceBinding.paths.includes('apps/music-tile/index.html')
    || !sourceBinding.paths.includes('apps/music-tile/main.js')
    || sourceBinding.responseBinding !== SCENARIO_SOURCE_RESPONSE_BINDING
    || !EXACT_GIT_HEAD.test(String(sourceBinding.sourceHead || '').trim().toLowerCase())
  ) {
    blocking.push(sourceBinding.blocker || 'BROWSER_SCENARIO_SOURCE_RESPONSE_MISMATCH');
  }
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  if (!EXACT_GIT_HEAD.test(normalizedExpectedHead)) {
    blocking.push('BROWSER_SCENARIO_SOURCE_HEAD_INVALID');
  } else if (
    String(sourceBinding.sourceHead || '').trim().toLowerCase() !== normalizedExpectedHead
  ) {
    blocking.push('BROWSER_SCENARIO_SOURCE_HEAD_MISMATCH');
  }
  if (!ratingInteractionObserved) blocking.push('BROWSER_SCENARIO_RATING_INTERACTION_MISSING');
  if (!listeningDeckIframeIdentityPreserved) blocking.push('BROWSER_SCENARIO_LISTENING_IFRAME_REPLACED');
  if (!discoveryIframeIdentityPreserved) blocking.push('BROWSER_SCENARIO_DISCOVERY_IFRAME_REPLACED');
  if (!legacyRankingChanged) blocking.push('BROWSER_SCENARIO_LEGACY_RANKING_UNCHANGED');
  if (!consoleErrors) blocking.push('BROWSER_SCENARIO_CONSOLE_ERRORS_INVALID');
  else if (consoleErrors.length > 0) blocking.push('BROWSER_SCENARIO_CONSOLE_ERRORS');
  if (!Array.isArray(evidence?.pageErrors)) blocking.push('BROWSER_SCENARIO_PAGE_ERRORS_INVALID');
  else if (evidence.pageErrors.length > 0) blocking.push('BROWSER_SCENARIO_PAGE_ERRORS');
  if (!scenarioBlockers) blocking.push('BROWSER_SCENARIO_BLOCKERS_INVALID');
  else blocking.push(...scenarioBlockers.map(String).filter(Boolean));
  return Object.freeze({
    accepted: blocking.length === 0,
    blocking: Object.freeze([...new Set(blocking)]),
    listeningDeckIframeIdentityPreserved,
    discoveryIframeIdentityPreserved,
    legacyRankingChanged,
    ratingInteractionObserved,
  });
}

export function evaluateBrowserProofResult(result = {}, {
  expectedHead = '',
  expectedSourceFingerprint = '',
  expectedDistFingerprint = '',
  proofScenario = '',
} = {}) {
  const checks = result.checks || {};
  const blocking = [];
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  const normalizedExpectedSourceFingerprint = String(expectedSourceFingerprint || '').trim().toLowerCase();
  const normalizedExpectedDistFingerprint = String(expectedDistFingerprint || '').trim().toLowerCase();
  const normalizedProofScenario = String(proofScenario || '').trim();
  const runtimeSourceHead = normalizeGitHead(checks.runtimeSourceHead || checks.footerGitCommit);
  const runtimeSourceFingerprint = String(checks.sourceFingerprint || '').trim().toLowerCase();
  const runtimeDistFingerprint = String(checks.runtimeDistFingerprint || '').trim().toLowerCase();
  if (!ok(checks.runtimeReachable)) blocking.push('4173 runtime unreachable');
  if (!ok(checks.footerGitCommitPresent)) blocking.push('footer UI Git Commit missing');
  if (!ok(checks.uiBuildTimestampPresent)) blocking.push('UI Build Timestamp missing');
  if (!ok(checks.proofConciergeDomNextProofMatches)) blocking.push('Proof Concierge DOM next proof is not browser-proof-checklist');
  if (!ok(checks.proofConciergePrimaryButtonPresent)) blocking.push('Proof Concierge primary button missing');
  if (!ok(checks.proofConciergeVisibleDriftClear)) blocking.push('Proof Concierge visible drift detected');
  if (!ok(checks.cloneParityClear)) blocking.push('clone parity is not clear');
  if (!ok(checks.operatorDiagnosticCopyPresent)) blocking.push('operator-facing diagnostic copy missing');
  if (Number(checks.consoleErrorCount || 0) > 0) blocking.push(`console error count ${checks.consoleErrorCount}`);
  if (result.automationUnavailable) blocking.push(`automation unavailable: ${result.automationUnavailable}`);
  let expectedHeadMatch = null;
  if (normalizedExpectedHead) {
    expectedHeadMatch = EXACT_GIT_HEAD.test(normalizedExpectedHead) && runtimeSourceHead === normalizedExpectedHead;
    if (!EXACT_GIT_HEAD.test(normalizedExpectedHead)) {
      blocking.push('approved expected head is invalid');
    } else if (!runtimeSourceHead) {
      blocking.push('served runtime Git Commit is not a full 40-character SHA');
    } else if (!expectedHeadMatch) {
      blocking.push(`served runtime Git Commit ${runtimeSourceHead} does not match expected head ${normalizedExpectedHead}`);
    }
  }
  let expectedSourceFingerprintMatch = null;
  if (normalizedExpectedSourceFingerprint) {
    expectedSourceFingerprintMatch = (
      EXACT_SOURCE_FINGERPRINT.test(normalizedExpectedSourceFingerprint)
      && runtimeSourceFingerprint === normalizedExpectedSourceFingerprint
    );
    if (!EXACT_SOURCE_FINGERPRINT.test(normalizedExpectedSourceFingerprint)) {
      blocking.push('approved source fingerprint is invalid');
    } else if (!EXACT_SOURCE_FINGERPRINT.test(runtimeSourceFingerprint)) {
      blocking.push('served runtime source fingerprint is not a full 64-character SHA-256');
    } else if (!expectedSourceFingerprintMatch) {
      blocking.push('served runtime source fingerprint does not match the clean approved checkout');
    }
  }
  let expectedDistFingerprintMatch = null;
  if (normalizedExpectedDistFingerprint) {
    expectedDistFingerprintMatch = (
      EXACT_DIST_FINGERPRINT.test(normalizedExpectedDistFingerprint)
      && runtimeDistFingerprint === normalizedExpectedDistFingerprint
    );
    if (!EXACT_DIST_FINGERPRINT.test(normalizedExpectedDistFingerprint)) {
      blocking.push('approved dist fingerprint is invalid');
    } else if (!EXACT_DIST_FINGERPRINT.test(runtimeDistFingerprint)) {
      blocking.push(
        checks.runtimeDistFingerprintBlocker
          ? `served runtime dist fingerprint unavailable: ${checks.runtimeDistFingerprintBlocker}`
          : 'served runtime dist fingerprint is not a full 64-character SHA-256',
      );
    } else if (!expectedDistFingerprintMatch) {
      blocking.push('served runtime dist fingerprint does not match the canonical built bundle');
    }
  }
  let scenarioEvidenceAccepted = null;
  let scenarioEvaluation = null;
  if (normalizedProofScenario) {
    if (!ALLOWED_PROOF_SCENARIOS.has(normalizedProofScenario)) {
      blocking.push('BROWSER_PROOF_SCENARIO_INVALID');
      scenarioEvidenceAccepted = false;
    } else if (normalizedProofScenario === MUSIC_RATING_PRESERVES_PLAYBACK) {
      scenarioEvaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
        result.scenarioEvidence,
        { expectedHead: normalizedExpectedHead },
      );
      scenarioEvidenceAccepted = scenarioEvaluation.accepted;
      blocking.push(...scenarioEvaluation.blocking);
    }
  }
  const observed = result.browserAutomationAvailable === true && !result.automationUnavailable && checks.runtimeReachable === true;
  const accepted = (
    observed
    && (normalizedExpectedHead ? expectedHeadMatch === true : true)
    && (normalizedExpectedSourceFingerprint ? expectedSourceFingerprintMatch === true : true)
    && (normalizedExpectedDistFingerprint ? expectedDistFingerprintMatch === true : true)
    && (normalizedProofScenario ? scenarioEvidenceAccepted === true : true)
  );
  return {
    accepted,
    observed,
    mergeReady: observed && blocking.length === 0,
    blocking,
    expectedHead: normalizedExpectedHead,
    runtimeSourceHead,
    expectedHeadMatch,
    expectedSourceFingerprint: normalizedExpectedSourceFingerprint,
    runtimeSourceFingerprint,
    expectedSourceFingerprintMatch,
    expectedDistFingerprint: normalizedExpectedDistFingerprint,
    runtimeDistFingerprint,
    expectedDistFingerprintMatch,
    proofScenario: normalizedProofScenario,
    scenarioEvidenceAccepted,
    scenarioEvaluation,
  };
}

function listSection(title, items = []) {
  return items.length ? [title, ...items.map((item) => `- ${item}`)] : [title, '- none'];
}

function consoleErrorSummary(errors = []) {
  return errors.slice(0, 5).map((item) => String(item || '').split('\n')[0].slice(0, 220)).filter(Boolean);
}

export function buildBrowserProofPacket(result = {}, options = {}) {
  const verdict = evaluateBrowserProofResult(result, options);
  const repair = result.automationUnavailable || !result.browserAutomationAvailable;
  const header = repair ? 'Browser Proof Repair Packet V1' : 'Browser Proof Checklist V1';
  const status = repair ? 'repair-required' : (verdict.accepted ? 'observed' : 'rejected');
  const checks = result.checks || {};
  return [
    header,
    '',
    line('Packet Kind', 'browser-proof-checklist'),
    line('Proof Item', 'browser-proof-checklist'),
    line('Status', status),
    line('Runtime URL', result.url || DEFAULT_URL),
    line('Generated At', result.generatedAt || stamp()),
    line('Local browser mechanism', result.localBrowserMechanism || 'Microsoft Edge/system browser via Playwright when available; no browser binary download'),
    line('Screenshot evidence', result.screenshotPath || 'not captured'),
    '',
    'Required checks:',
    line('- 4173 runtime reachable', checks.runtimeReachable ? 'yes' : 'no'),
    line('- Footer UI Git Commit', checks.footerGitCommit || (checks.footerGitCommitPresent ? 'present' : 'missing')),
    line('- Approved expected Git head', verdict.expectedHead || 'not requested'),
    line('- Browser-observed runtime source head', verdict.runtimeSourceHead || 'unavailable'),
    line('- Browser-observed head matches approved head', verdict.expectedHeadMatch == null ? 'not requested' : (verdict.expectedHeadMatch ? 'yes' : 'no')),
    line('- Approved source fingerprint', verdict.expectedSourceFingerprint || 'not requested'),
    line('- Browser-observed source fingerprint', verdict.runtimeSourceFingerprint || 'unavailable'),
    line('- Browser-observed fingerprint matches clean checkout', verdict.expectedSourceFingerprintMatch == null ? 'not requested' : (verdict.expectedSourceFingerprintMatch ? 'yes' : 'no')),
    line('- Approved canonical dist fingerprint', verdict.expectedDistFingerprint || 'not requested'),
    line('- Browser-fetched runtime dist fingerprint', verdict.runtimeDistFingerprint || 'unavailable'),
    line('- Browser-fetched dist bytes match canonical build', verdict.expectedDistFingerprintMatch == null ? 'not requested' : (verdict.expectedDistFingerprintMatch ? 'yes' : 'no')),
    line('- UI Build Timestamp', checks.uiBuildTimestamp || (checks.uiBuildTimestampPresent ? 'present' : 'missing')),
    line('- Source fingerprint / runtime marker', checks.sourceFingerprint || checks.runtimeMarker || 'unavailable'),
    line('- Proof Concierge DOM next proof', checks.proofConciergeDomNextProof || 'unavailable'),
    line('- Proof Concierge DOM primary button text', checks.proofConciergePrimaryButtonText || 'unavailable'),
    line('- Proof Concierge visible drift', checks.proofConciergeVisibleDrift || 'unavailable'),
    line('- Clone parity', checks.cloneParity || 'unavailable'),
    line('- Operator-facing diagnostic copy presence', checks.operatorDiagnosticCopyPresent ? 'yes' : 'no'),
    line('- Console error count', checks.consoleErrorCount ?? 'unavailable'),
    '',
    ...listSection('Observed caveats:', verdict.blocking),
    ...listSection('Merge blockers:', verdict.mergeReady ? [] : verdict.blocking),
    ...(Number(checks.consoleErrorCount || 0) > 0 ? ['Console error summary:', ...consoleErrorSummary(result.consoleErrors || checks.consoleErrors || []).map((item) => `- ${item}`)] : []),
    'Safety locks: mutation no; Codex auto-dispatch no; OpenClaw locked; merge readiness no / hold; no paid APIs; no automatic browsing beyond local Stephanos runtime URL.',
    repair ? 'Repair action: install/enable Playwright with a system Microsoft Edge channel, or run this packet again from the operator Windows desktop where Edge and the 4173 runtime are available.' : 'Next action: paste this packet into Command Deck as browser-proof-checklist evidence.',
  ].join('\n');
}

export function buildBrowserProofMachineResult(result = {}, options = {}) {
  const verdict = evaluateBrowserProofResult(result, options);
  return Object.freeze({
    schemaVersion: BROWSER_RUNTIME_PROOF_SCHEMA,
    url: String(result.url || DEFAULT_URL),
    observedUrl: String(result.observedUrl || ''),
    accepted: verdict.mergeReady,
    observed: verdict.observed,
    mergeReady: verdict.mergeReady,
    expectedHead: verdict.expectedHead,
    runtimeSourceHead: verdict.runtimeSourceHead,
    expectedHeadMatch: verdict.expectedHeadMatch,
    expectedSourceFingerprint: verdict.expectedSourceFingerprint,
    runtimeSourceFingerprint: verdict.runtimeSourceFingerprint,
    expectedSourceFingerprintMatch: verdict.expectedSourceFingerprintMatch,
    expectedDistFingerprint: verdict.expectedDistFingerprint,
    runtimeDistFingerprint: verdict.runtimeDistFingerprint,
    expectedDistFingerprintMatch: verdict.expectedDistFingerprintMatch,
    proofScenario: verdict.proofScenario,
    scenarioEvidenceAccepted: verdict.scenarioEvidenceAccepted,
    scenarioEvidence: verdict.proofScenario ? (result.scenarioEvidence || null) : null,
    blocking: [...verdict.blocking],
  });
}

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  try { return await import('@playwright/test'); } catch {}
  return null;
}

function servedDistError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function readExpectedDistManifest(
  manifestPath,
  expectedDistFingerprint,
) {
  try {
    const info = lstatSync(manifestPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 2 * 1024 * 1024) {
      throw servedDistError('EXPECTED_DIST_MANIFEST_INVALID');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
    const totalBytes = entries.reduce((total, entry) => total + Number(entry?.size), 0);
    const fingerprint = computeStephanosDistManifestFingerprint(entries);
    if (
      manifest?.schemaVersion !== STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION
      || entries.length === 0
      || entries.length > STEPHANOS_DIST_MANIFEST_MAX_FILES
      || entries.some((entry) => (
        !Number.isSafeInteger(entry?.size)
        || entry.size < 0
        || entry.size > STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES
      ))
      || totalBytes > STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES
      || manifest.fileCount !== entries.length
      || manifest.totalBytes !== totalBytes
      || manifest.fingerprint !== fingerprint
      || fingerprint !== expectedDistFingerprint
    ) {
      throw servedDistError('EXPECTED_DIST_MANIFEST_INVALID');
    }
    return Object.freeze({
      ok: true,
      blocker: '',
      fingerprint,
      entries: Object.freeze([...entries]),
      fileCount: entries.length,
      totalBytes,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: String(error?.code || 'EXPECTED_DIST_MANIFEST_INVALID'),
      fingerprint: '',
      entries: Object.freeze([]),
      fileCount: 0,
      totalBytes: 0,
    });
  }
}

async function readBoundedServedBytes(response, {
  maxFileBytes,
  remainingBytes,
} = {}) {
  const contentLengthValue = response?.headers?.get?.('content-length');
  const contentEncoding = String(response?.headers?.get?.('content-encoding') || '').trim().toLowerCase();
  if (contentLengthValue != null && contentLengthValue !== '') {
    const contentLength = Number(contentLengthValue);
    if (
      !Number.isSafeInteger(contentLength)
      || contentLength < 0
      || contentLength > maxFileBytes
      || contentLength > remainingBytes
    ) {
      throw servedDistError('BROWSER_RUNTIME_DIST_FILE_TOO_LARGE');
    }
  }

  const chunks = [];
  let totalBytes = 0;
  const append = (value) => {
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maxFileBytes || totalBytes > remainingBytes) {
      throw servedDistError('BROWSER_RUNTIME_DIST_FILE_TOO_LARGE');
    }
    chunks.push(chunk);
  };

  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (response?.body?.[Symbol.asyncIterator]) {
    for await (const chunk of response.body) append(chunk);
  } else if (typeof response?.arrayBuffer === 'function') {
    append(await response.arrayBuffer());
  } else {
    throw servedDistError('BROWSER_RUNTIME_DIST_RESPONSE_BODY_UNAVAILABLE');
  }

  if (
    contentLengthValue != null
    && contentLengthValue !== ''
    && (!contentEncoding || contentEncoding === 'identity')
    && Number(contentLengthValue) !== totalBytes
  ) {
    throw servedDistError('BROWSER_RUNTIME_DIST_CONTENT_LENGTH_MISMATCH');
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchServedDistFile(fetchFn, url, bounds) {
  let response;
  try {
    response = await fetchFn(url, {
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
        'accept-encoding': 'identity',
      },
    });
  } catch {
    throw servedDistError('BROWSER_RUNTIME_DIST_FETCH_FAILED');
  }
  if (!response || response.ok !== true || Number(response.status) !== 200) {
    throw servedDistError('BROWSER_RUNTIME_DIST_FETCH_FAILED');
  }
  const responseUrl = String(response.url || '');
  if (responseUrl && new URL(responseUrl).href !== new URL(url).href) {
    throw servedDistError('BROWSER_RUNTIME_DIST_REDIRECTED');
  }
  return readBoundedServedBytes(response, bounds);
}

export async function collectServedDistFingerprint(url = DEFAULT_URL, {
  fetchFn = globalThis.fetch,
  expectedEntries = [],
  maxFiles = STEPHANOS_DIST_MANIFEST_MAX_FILES,
  maxFileBytes = STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
  maxTotalBytes = STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
} = {}) {
  try {
    if (typeof fetchFn !== 'function') {
      throw servedDistError('BROWSER_RUNTIME_DIST_FETCH_UNAVAILABLE');
    }
    const indexUrl = new URL(String(url || ''));
    if (
      !['http:', 'https:'].includes(indexUrl.protocol)
      || indexUrl.username
      || indexUrl.password
      || indexUrl.search
      || indexUrl.hash
      || !indexUrl.pathname.endsWith('/index.html')
    ) {
      throw servedDistError('BROWSER_RUNTIME_DIST_URL_INVALID');
    }
    const boundedMaxFiles = Number(maxFiles);
    const boundedMaxFileBytes = Number(maxFileBytes);
    const boundedMaxTotalBytes = Number(maxTotalBytes);
    if (
      !Number.isSafeInteger(boundedMaxFiles)
      || boundedMaxFiles < 1
      || !Number.isSafeInteger(boundedMaxFileBytes)
      || boundedMaxFileBytes < 1
      || !Number.isSafeInteger(boundedMaxTotalBytes)
      || boundedMaxTotalBytes < 1
    ) {
      throw servedDistError('BROWSER_RUNTIME_DIST_BOUNDS_INVALID');
    }

    const baseUrl = new URL('.', indexUrl);
    const indexBytes = await fetchServedDistFile(fetchFn, indexUrl.href, {
      maxFileBytes: boundedMaxFileBytes,
      remainingBytes: boundedMaxTotalBytes,
    });
    const runtimeAssetPaths = getStephanosDistRuntimeAssetReferences(indexBytes.toString('utf8'));
    const relativePaths = Array.isArray(expectedEntries) && expectedEntries.length > 0
      ? expectedEntries.map((entry) => String(entry?.path || ''))
      : [
        'index.html',
        'stephanos-build.json',
        ...runtimeAssetPaths,
      ];
    if (relativePaths.length > boundedMaxFiles) {
      throw servedDistError('BROWSER_RUNTIME_DIST_TOO_MANY_FILES');
    }
    if (new Set(relativePaths).size !== relativePaths.length) {
      throw servedDistError('BROWSER_RUNTIME_DIST_DUPLICATE_PATH');
    }
    if (runtimeAssetPaths.some((assetPath) => !relativePaths.includes(assetPath))) {
      throw servedDistError('BROWSER_RUNTIME_DIST_MANIFEST_INCOMPLETE');
    }

    let totalBytes = indexBytes.length;
    const entries = [Object.freeze({
      path: 'index.html',
      size: indexBytes.length,
      sha256: createHash('sha256').update(indexBytes).digest('hex'),
    })];
    for (const relativePath of relativePaths
      .filter((item) => item !== 'index.html')
      .sort((left, right) => (
      left < right ? -1 : (left > right ? 1 : 0)
      ))) {
      const assetUrl = new URL(relativePath, baseUrl);
      if (
        assetUrl.origin !== indexUrl.origin
        || !assetUrl.pathname.startsWith(baseUrl.pathname)
        || assetUrl.search
        || assetUrl.hash
      ) {
        throw servedDistError('BROWSER_RUNTIME_DIST_PATH_ESCAPE');
      }
      const bytes = await fetchServedDistFile(fetchFn, assetUrl.href, {
        maxFileBytes: boundedMaxFileBytes,
        remainingBytes: boundedMaxTotalBytes - totalBytes,
      });
      totalBytes += bytes.length;
      if (totalBytes > boundedMaxTotalBytes) {
        throw servedDistError('BROWSER_RUNTIME_DIST_TOTAL_TOO_LARGE');
      }
      entries.push(Object.freeze({
        path: relativePath,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }));
    }
    const fingerprint = computeStephanosDistManifestFingerprint(entries);
    return Object.freeze({
      ok: true,
      blocker: '',
      fingerprint,
      fileCount: entries.length,
      totalBytes,
      entries: Object.freeze(entries),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: String(error?.code || error?.message || 'BROWSER_RUNTIME_DIST_FINGERPRINT_FAILED'),
      fingerprint: '',
      fileCount: 0,
      totalBytes: 0,
      entries: Object.freeze([]),
    });
  }
}

function responseUrl(response) {
  return String(typeof response?.url === 'function' ? response.url() : response?.url || '');
}

function responseStatus(response) {
  return Number(typeof response?.status === 'function' ? response.status() : response?.status);
}

async function responseHeaders(response) {
  if (typeof response?.allHeaders === 'function') return response.allHeaders();
  if (typeof response?.headers === 'function') return response.headers();
  return response?.headers || {};
}

async function readBoundedPlaywrightResponse(response, expectedUrl, {
  maxFileBytes,
  remainingBytes,
} = {}) {
  if (
    !response
    || responseStatus(response) !== 200
    || new URL(responseUrl(response)).href !== new URL(expectedUrl).href
  ) {
    throw servedDistError('BROWSER_RUNTIME_DIST_CAPTURE_MISSING');
  }
  const headers = await responseHeaders(response);
  const contentLengthValue = headers?.['content-length'];
  const contentEncoding = String(headers?.['content-encoding'] || '').trim().toLowerCase();
  if (contentLengthValue != null && contentLengthValue !== '') {
    const contentLength = Number(contentLengthValue);
    if (
      !Number.isSafeInteger(contentLength)
      || contentLength < 0
      || contentLength > maxFileBytes
      || contentLength > remainingBytes
    ) {
      throw servedDistError('BROWSER_RUNTIME_DIST_FILE_TOO_LARGE');
    }
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.body());
  } catch {
    throw servedDistError('BROWSER_RUNTIME_DIST_RESPONSE_BODY_UNAVAILABLE');
  }
  if (bytes.length > maxFileBytes || bytes.length > remainingBytes) {
    throw servedDistError('BROWSER_RUNTIME_DIST_FILE_TOO_LARGE');
  }
  if (
    contentLengthValue != null
    && contentLengthValue !== ''
    && (!contentEncoding || contentEncoding === 'identity')
    && Number(contentLengthValue) !== bytes.length
  ) {
    throw servedDistError('BROWSER_RUNTIME_DIST_CONTENT_LENGTH_MISMATCH');
  }
  return bytes;
}

function resolveServedManifestUrl(indexUrl, relativePath) {
  const baseUrl = new URL('.', indexUrl);
  const assetUrl = new URL(relativePath, baseUrl);
  if (
    assetUrl.origin !== indexUrl.origin
    || !assetUrl.pathname.startsWith(baseUrl.pathname)
    || assetUrl.search
    || assetUrl.hash
  ) {
    throw servedDistError('BROWSER_RUNTIME_DIST_PATH_ESCAPE');
  }
  return assetUrl;
}

async function fetchThroughPage(page, assetUrl) {
  try {
    await page.evaluate(async (targetUrl) => {
      const response = await fetch(targetUrl, {
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'cache-control': 'no-store',
          pragma: 'no-cache',
        },
      });
      if (!response.ok || response.status !== 200 || response.url !== targetUrl) {
        throw new Error('BROWSER_RUNTIME_DIST_FETCH_FAILED');
      }
      await response.arrayBuffer();
    }, assetUrl);
  } catch {
    throw servedDistError('BROWSER_RUNTIME_DIST_FETCH_FAILED');
  }
}

export async function collectPlaywrightNavigationDistFingerprint(
  page,
  url = DEFAULT_URL,
  {
    navigationResponse,
    capturedResponses = [],
    expectedEntries = [],
    maxFiles = STEPHANOS_DIST_MANIFEST_MAX_FILES,
    maxFileBytes = STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
    maxTotalBytes = STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
  } = {},
) {
  try {
    const indexUrl = new URL(String(url || ''));
    if (
      !['http:', 'https:'].includes(indexUrl.protocol)
      || indexUrl.username
      || indexUrl.password
      || indexUrl.search
      || indexUrl.hash
      || !indexUrl.pathname.endsWith('/index.html')
    ) {
      throw servedDistError('BROWSER_RUNTIME_DIST_URL_INVALID');
    }
    if (
      !Array.isArray(expectedEntries)
      || expectedEntries.length === 0
      || expectedEntries.length > maxFiles
      || !expectedEntries.some((entry) => entry?.path === 'index.html')
    ) {
      throw servedDistError('EXPECTED_DIST_MANIFEST_INVALID');
    }
    const expectedUrls = new Set(expectedEntries.map((entry) => (
      resolveServedManifestUrl(indexUrl, String(entry?.path || '')).href
    )));
    const distBaseUrl = new URL('.', indexUrl);
    const unexpectedCapturedResponse = () => capturedResponses.some((response) => {
      const capturedUrl = new URL(responseUrl(response));
      return (
        capturedUrl.origin === distBaseUrl.origin
        && capturedUrl.pathname.startsWith(distBaseUrl.pathname)
        && !expectedUrls.has(capturedUrl.href)
      );
    });
    if (unexpectedCapturedResponse()) {
      throw servedDistError('BROWSER_RUNTIME_DIST_UNEXPECTED_RESPONSE');
    }
    let totalBytes = 0;
    const actualEntries = [];
    for (const expectedEntry of [...expectedEntries].sort((left, right) => (
      String(left?.path || '') < String(right?.path || '')
        ? -1
        : (String(left?.path || '') > String(right?.path || '') ? 1 : 0)
    ))) {
      const relativePath = String(expectedEntry?.path || '');
      const assetUrl = resolveServedManifestUrl(indexUrl, relativePath).href;
      let candidates;
      if (relativePath === 'index.html') {
        candidates = [navigationResponse];
      } else {
        candidates = capturedResponses.filter((response) => (
          responseUrl(response) === assetUrl
        ));
        if (candidates.length === 0) {
          const captureStart = capturedResponses.length;
          await fetchThroughPage(page, assetUrl);
          candidates = capturedResponses.slice(captureStart).filter((response) => (
            responseUrl(response) === assetUrl
          ));
        }
      }
      if (candidates.length === 0) {
        throw servedDistError('BROWSER_RUNTIME_DIST_CAPTURE_MISSING');
      }
      const candidateEntries = [];
      for (const candidate of candidates) {
        const bytes = await readBoundedPlaywrightResponse(candidate, assetUrl, {
          maxFileBytes,
          remainingBytes: maxTotalBytes - totalBytes,
        });
        candidateEntries.push({
          path: relativePath,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      const [selected] = candidateEntries;
      if (candidateEntries.some((entry) => (
        entry.size !== selected.size || entry.sha256 !== selected.sha256
      ))) {
        throw servedDistError('BROWSER_RUNTIME_DIST_RESPONSE_VARIATION');
      }
      if (
        Number(expectedEntry?.size) !== selected.size
        || String(expectedEntry?.sha256 || '').trim().toLowerCase() !== selected.sha256
      ) {
        throw servedDistError('BROWSER_RUNTIME_DIST_ASSET_MISMATCH');
      }
      totalBytes += selected.size;
      if (totalBytes > maxTotalBytes) {
        throw servedDistError('BROWSER_RUNTIME_DIST_TOTAL_TOO_LARGE');
      }
      actualEntries.push(Object.freeze(selected));
    }
    if (unexpectedCapturedResponse()) {
      throw servedDistError('BROWSER_RUNTIME_DIST_UNEXPECTED_RESPONSE');
    }
    const fingerprint = computeStephanosDistManifestFingerprint(actualEntries);
    return Object.freeze({
      ok: true,
      blocker: '',
      fingerprint,
      fileCount: actualEntries.length,
      totalBytes,
      entries: Object.freeze(actualEntries),
      responseBinding: 'playwright-navigation-and-browser-context-v1',
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: String(error?.code || error?.message || 'BROWSER_RUNTIME_DIST_FINGERPRINT_FAILED'),
      fingerprint: '',
      fileCount: 0,
      totalBytes: 0,
      entries: Object.freeze([]),
      responseBinding: 'playwright-navigation-and-browser-context-v1',
    });
  }
}

function scenarioSourcePathFromUrl(value, expectedOrigin) {
  const parsed = new URL(String(value || ''));
  if (parsed.origin !== expectedOrigin) return '';
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_URL_INVALID');
  }
  if (
    !pathname.startsWith('/apps/music-tile/')
    && !pathname.startsWith('/shared/')
  ) {
    return '';
  }
  const relativePath = pathname.replace(/^\/+/, '');
  if (
    !relativePath
    || relativePath.includes('\0')
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_URL_INVALID');
  }
  return relativePath;
}

export function createScenarioSourceGitEnvironment(
  environment = process.env,
  {
    platform = process.platform,
  } = {},
) {
  const gitEnvironment = { ...environment };
  for (const key of Object.keys(gitEnvironment)) {
    if (key.toUpperCase().startsWith('GIT_')) delete gitEnvironment[key];
  }
  Object.assign(gitEnvironment, {
    GIT_CONFIG_GLOBAL: platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  });
  return Object.freeze(gitEnvironment);
}

function scenarioSourceGitCapture(
  repoRoot,
  args,
  {
    encoding = 'utf8',
    maxBuffer = 8 * 1024,
    blocker = 'BROWSER_SCENARIO_SOURCE_COMMIT_UNAVAILABLE',
  } = {},
) {
  const gitEnvironment = createScenarioSourceGitEnvironment();
  let result;
  try {
    result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', [
      '--no-replace-objects',
      ...args,
    ], {
      cwd: repoRoot,
      encoding,
      env: gitEnvironment,
      maxBuffer,
      shell: false,
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    throw servedDistError(blocker);
  }
  if (
    result?.error
    || result?.signal
    || result?.status !== 0
    || result?.stdout == null
  ) {
    throw servedDistError(blocker);
  }
  return result.stdout;
}

function verifyScenarioSourceCommit(repoRoot, expectedHead) {
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  if (!EXACT_GIT_HEAD.test(normalizedExpectedHead)) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_HEAD_INVALID');
  }
  const resolvedHead = String(scenarioSourceGitCapture(
    repoRoot,
    ['rev-parse', '--verify', `${normalizedExpectedHead}^{commit}`],
  )).trim().toLowerCase();
  if (resolvedHead !== normalizedExpectedHead) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_COMMIT_UNAVAILABLE');
  }
  return normalizedExpectedHead;
}

function readScenarioSourceCommitBlob(
  repoRoot,
  expectedHead,
  relativePath,
  {
    maxFileBytes = STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
  } = {},
) {
  const treeOutput = scenarioSourceGitCapture(
    repoRoot,
    ['ls-tree', '-z', '--full-tree', expectedHead, '--', `:(literal)${relativePath}`],
    {
      encoding: null,
      maxBuffer: 8 * 1024,
      blocker: 'BROWSER_SCENARIO_SOURCE_BLOB_INVALID',
    },
  );
  const treeRecords = Buffer.from(treeOutput)
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  if (treeRecords.length !== 1) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_BLOB_INVALID');
  }
  const separatorIndex = treeRecords[0].indexOf('\t');
  const metadata = separatorIndex >= 0 ? treeRecords[0].slice(0, separatorIndex) : '';
  const entryPath = separatorIndex >= 0 ? treeRecords[0].slice(separatorIndex + 1) : '';
  const [mode, type, blobSha, ...extra] = metadata.split(' ');
  if (
    extra.length > 0
    || !['100644', '100755'].includes(mode)
    || type !== 'blob'
    || !EXACT_GIT_HEAD.test(blobSha)
    || entryPath !== relativePath
  ) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_BLOB_INVALID');
  }
  const sizeText = String(scenarioSourceGitCapture(
    repoRoot,
    ['cat-file', '-s', blobSha],
    {
      maxBuffer: 128,
      blocker: 'BROWSER_SCENARIO_SOURCE_BLOB_INVALID',
    },
  )).trim();
  if (!/^(?:0|[1-9]\d*)$/.test(sizeText)) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_BLOB_INVALID');
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size > maxFileBytes) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_FILE_TOO_LARGE');
  }
  const bytes = Buffer.from(scenarioSourceGitCapture(
    repoRoot,
    ['cat-file', 'blob', blobSha],
    {
      encoding: null,
      maxBuffer: size + 1,
      blocker: 'BROWSER_SCENARIO_SOURCE_BLOB_INVALID',
    },
  ));
  const canonicalBlobSha = createHash('sha1')
    .update(Buffer.from(`blob ${size}\0`))
    .update(bytes)
    .digest('hex');
  if (bytes.length !== size || canonicalBlobSha !== blobSha) {
    throw servedDistError('BROWSER_SCENARIO_SOURCE_BLOB_INVALID');
  }
  return Object.freeze({ bytes, blobSha });
}

export async function collectScenarioSourceResponseBinding(
  capturedResponses = [],
  {
    scenarioUrl,
    repoRoot = process.cwd(),
    expectedHead = '',
    maxFiles = STEPHANOS_DIST_MANIFEST_MAX_FILES,
    maxFileBytes = STEPHANOS_DIST_MANIFEST_MAX_FILE_BYTES,
    maxTotalBytes = STEPHANOS_DIST_MANIFEST_MAX_TOTAL_BYTES,
  } = {},
) {
  let sourceHead = '';
  try {
    if (
      !Number.isSafeInteger(maxFiles)
      || maxFiles < 1
      || !Number.isSafeInteger(maxFileBytes)
      || maxFileBytes < 1
      || !Number.isSafeInteger(maxTotalBytes)
      || maxTotalBytes < 1
    ) {
      throw servedDistError('BROWSER_SCENARIO_SOURCE_LIMIT_INVALID');
    }
    const expectedOrigin = new URL(String(scenarioUrl || '')).origin;
    const repoInfo = lstatSync(repoRoot);
    if (repoInfo.isSymbolicLink() || !repoInfo.isDirectory()) {
      throw servedDistError('BROWSER_SCENARIO_SOURCE_ROOT_INVALID');
    }
    const realRepoRoot = realpathSync(repoRoot);
    sourceHead = verifyScenarioSourceCommit(realRepoRoot, expectedHead);
    const responseGroups = new Map();
    for (const response of capturedResponses) {
      const relativePath = scenarioSourcePathFromUrl(responseUrl(response), expectedOrigin);
      if (!relativePath) continue;
      if (responseStatus(response) !== 200) {
        throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_MISSING');
      }
      if (responseGroups.has(relativePath)) {
        throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_DUPLICATE');
      }
      responseGroups.set(relativePath, [response]);
    }
    if (
      responseGroups.size < 2
      || responseGroups.size > maxFiles
      || !responseGroups.has('apps/music-tile/index.html')
      || !responseGroups.has('apps/music-tile/main.js')
    ) {
      throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_INCOMPLETE');
    }
    let totalBytes = 0;
    const entries = [];
    for (const relativePath of [...responseGroups.keys()].sort()) {
      const { bytes: expectedBytes, blobSha } = readScenarioSourceCommitBlob(
        realRepoRoot,
        sourceHead,
        relativePath,
        { maxFileBytes },
      );
      if (expectedBytes.length > maxFileBytes || totalBytes + expectedBytes.length > maxTotalBytes) {
        throw servedDistError('BROWSER_SCENARIO_SOURCE_FILE_TOO_LARGE');
      }
      const expectedSha = createHash('sha256').update(expectedBytes).digest('hex');
      for (const response of responseGroups.get(relativePath)) {
        const headers = await responseHeaders(response);
        const declaredLengthText = String(headers?.['content-length'] || '').trim();
        if (!declaredLengthText) {
          throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_LENGTH_MISSING');
        }
        const declaredLength = Number(declaredLengthText);
        if (
          !Number.isSafeInteger(declaredLength)
          || declaredLength < 0
          || declaredLength > maxFileBytes
          || totalBytes + declaredLength > maxTotalBytes
          || declaredLength !== expectedBytes.length
        ) {
          throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_SIZE_INVALID');
        }
        let actualBytes;
        try {
          actualBytes = Buffer.from(await response.body());
        } catch {
          throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_BODY_UNAVAILABLE');
        }
        if (
          actualBytes.length > maxFileBytes
          || totalBytes + actualBytes.length > maxTotalBytes
          || actualBytes.length !== expectedBytes.length
          || createHash('sha256').update(actualBytes).digest('hex') !== expectedSha
        ) {
          throw servedDistError('BROWSER_SCENARIO_SOURCE_RESPONSE_MISMATCH');
        }
      }
      totalBytes += expectedBytes.length;
      entries.push(Object.freeze({
        path: relativePath,
        size: expectedBytes.length,
        sha256: expectedSha,
        gitBlob: blobSha,
      }));
    }
    return Object.freeze({
      exact: true,
      blocker: '',
      sourceHead,
      fileCount: entries.length,
      totalBytes,
      fingerprint: computeStephanosDistManifestFingerprint(entries),
      paths: Object.freeze(entries.map((entry) => entry.path)),
      entries: Object.freeze(entries),
      responseBinding: SCENARIO_SOURCE_RESPONSE_BINDING,
    });
  } catch (error) {
    return Object.freeze({
      exact: false,
      blocker: String(error?.code || error?.message || 'BROWSER_SCENARIO_SOURCE_RESPONSE_MISMATCH'),
      sourceHead,
      fileCount: 0,
      totalBytes: 0,
      fingerprint: '',
      paths: Object.freeze([]),
      entries: Object.freeze([]),
      responseBinding: SCENARIO_SOURCE_RESPONSE_BINDING,
    });
  }
}

function createMusicRatingScenarioState() {
  return {
    candidates: [],
    listeningDeck: [{
      id: MUSIC_TILE_SCENARIO_TRACK_ID,
      title: 'Pictures Of You',
      artist: 'Anyma',
      lane: 'proof-player',
      reason: 'scenario target',
      positiveTags: ['scenario-rated-signal'],
      spotifyUrl: 'https://open.spotify.com/track/1lXzvA8rQwRz4t5Lwz4M8W',
      candidateVerificationStatus: 'verified',
    }],
    ratings: {},
    tags: {},
    tasteDNA: {},
    feedbackHistory: [],
    trackFeedback: {},
    linkMessages: {},
    aiSuggestions: [],
    aiSmarterJourney: [{
      id: 'proof-discovery-player',
      title: 'Proof Discovery Player',
      artist: 'Proof Artist',
      spotifyUrl: 'https://open.spotify.com/track/2GQfQw0f9M8e8P3G2NL8eN',
      aiSuggested: true,
      sourceKind: 'ai',
    }],
    pendingTasteDnaChanges: [],
    appliedTasteDnaChanges: [],
    recentlyShownCandidateIds: [],
    sessionCounter: 0,
    lastDiscoveryMeta: null,
  };
}

function failedMusicRatingScenarioEvidence({
  scenarioUrl = '',
  consoleErrors = [],
  pageErrors = [],
  blocker = 'BROWSER_SCENARIO_EXECUTION_FAILED',
  sourceResponseBinding = null,
} = {}) {
  return Object.freeze({
    schemaVersion: MUSIC_RATING_SCENARIO_EVIDENCE_SCHEMA,
    proofScenario: MUSIC_RATING_PRESERVES_PLAYBACK,
    collector: 'playwright-page-v1',
    observed: false,
    musicTileUrl: scenarioUrl,
    fixture: 'isolated-browser-context-v1',
    sourceResponseBinding: sourceResponseBinding || {
      exact: false,
      blocker: 'BROWSER_SCENARIO_SOURCE_RESPONSE_INCOMPLETE',
      fileCount: 0,
      paths: [],
    },
    ratingInteraction: {},
    listeningDeckIframe: {},
    discoveryIframe: {},
    legacyRanking: {},
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
    blockers: [String(blocker || 'BROWSER_SCENARIO_EXECUTION_FAILED')],
    listeningDeckIframeIdentityPreserved: false,
    discoveryIframeIdentityPreserved: false,
    legacyRankingChanged: false,
  });
}

export async function collectMusicRatingPreservesPlaybackEvidence(page, runtimeUrl, {
  capturedResponses = [],
  consoleErrors = [],
  pageErrors = [],
  repoRoot = process.cwd(),
  expectedHead = '',
} = {}) {
  const scenarioUrl = new URL(MUSIC_TILE_SCENARIO_PATH, runtimeUrl).href;
  const captureStart = capturedResponses.length;
  let sourceResponseBinding = null;
  let refsHandle = null;
  let listeningFrame = null;
  let discoveryFrame = null;
  let frameNavigatedListener = null;
  let frameDetachedListener = null;
  const frameEvents = {
    listeningNavigations: 0,
    discoveryNavigations: 0,
    listeningDetaches: 0,
    discoveryDetaches: 0,
  };
  try {
    await page.route('https://open.spotify.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: [
          '<!doctype html><title>Spotify proof fixture</title>',
          '<body>playback continuity sentinel active',
          '<script>',
          `globalThis.__stephanosProofPlaybackInstance = ${JSON.stringify('spotify-playback-continuity-sentinel-v1')};`,
          'globalThis.__stephanosProofPlaybackTick = 0;',
          'setInterval(() => { globalThis.__stephanosProofPlaybackTick += 1; }, 10);',
          '</script></body>',
        ].join(''),
      });
    });
    await page.route('**/api/setup/integrations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ integrations: [] }),
      });
    });
    await page.addInitScript(({ key, state, origin }) => {
      if (location.origin === origin) localStorage.setItem(key, JSON.stringify(state));
    }, {
      key: MUSIC_TILE_STATE_KEY,
      state: createMusicRatingScenarioState(),
      origin: new URL(scenarioUrl).origin,
    });
    const navigationResponse = await page.goto(scenarioUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (!navigationResponse || responseStatus(navigationResponse) !== 200 || page.url() !== scenarioUrl) {
      throw servedDistError('BROWSER_SCENARIO_RUNTIME_URL_MISMATCH');
    }
    await page.locator('#advanced-studio > summary').click();
    await page.locator('#artist-input').fill('Anyma');
    await page.locator('#build-journey-btn').click();
    await page.waitForFunction(({ trackId, rating, stateKey }) => {
      const legacy = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.startsWith('Discovery Results'));
      const verified = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Verified Candidates');
      const ratingButton = document.querySelector(
        `#listening-deck [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      let state = {};
      try {
        state = JSON.parse(localStorage.getItem(stateKey) || '{}');
      } catch {}
      return !!document.querySelector('#discovery-pipeline-summary')
        && !!legacy
        && !!verified?.querySelector('iframe[src*="open.spotify.com/embed/track/"]')
        && !!ratingButton?.closest('.player-deck-card')
          ?.querySelector('iframe[src*="open.spotify.com/embed/track/"]')
        && Array.isArray(state.candidates)
        && state.candidates.some((candidate) => candidate?.id === trackId);
    }, {
      trackId: MUSIC_TILE_SCENARIO_TRACK_ID,
      rating: MUSIC_TILE_SCENARIO_RATING,
      stateKey: MUSIC_TILE_STATE_KEY,
    }, { timeout: 15000 });
    const listeningHandleValue = await page.evaluateHandle(({ trackId, rating }) => {
      const ratingButton = document.querySelector(
        `#listening-deck [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      return ratingButton?.closest('.player-deck-card')
        ?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
    }, {
      trackId: MUSIC_TILE_SCENARIO_TRACK_ID,
      rating: MUSIC_TILE_SCENARIO_RATING,
    });
    const discoveryHandleValue = await page.evaluateHandle(() => {
      const verified = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Verified Candidates');
      return verified?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
    });
    const listeningHandle = listeningHandleValue.asElement();
    const discoveryHandle = discoveryHandleValue.asElement();
    if (!listeningHandle || !discoveryHandle) {
      await listeningHandleValue.dispose();
      await discoveryHandleValue.dispose();
      throw servedDistError('BROWSER_SCENARIO_PLAYER_IFRAME_MISSING');
    }
    await listeningHandle.scrollIntoViewIfNeeded();
    await discoveryHandle.scrollIntoViewIfNeeded();
    listeningFrame = await listeningHandle.contentFrame();
    discoveryFrame = await discoveryHandle.contentFrame();
    if (!listeningFrame || !discoveryFrame) {
      throw servedDistError('BROWSER_SCENARIO_PLAYER_FRAME_MISSING');
    }
    await Promise.all([
      listeningFrame.waitForFunction(() => globalThis.__stephanosProofPlaybackTick >= 2, null, { timeout: 10000 }),
      discoveryFrame.waitForFunction(() => globalThis.__stephanosProofPlaybackTick >= 2, null, { timeout: 10000 }),
    ]);
    const listeningSentinelBefore = await listeningFrame.evaluate(() => ({
      instance: globalThis.__stephanosProofPlaybackInstance,
      tick: globalThis.__stephanosProofPlaybackTick,
    }));
    const discoverySentinelBefore = await discoveryFrame.evaluate(() => ({
      instance: globalThis.__stephanosProofPlaybackInstance,
      tick: globalThis.__stephanosProofPlaybackTick,
    }));
    refsHandle = await page.evaluateHandle(({ targetId, targetLabel, stateKey, rating }) => {
      const ratingButton = document.querySelector(
        `#listening-deck [data-rate="${rating}"][data-id="${targetId}"]`,
      );
      const listening = ratingButton?.closest('.player-deck-card')
        ?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
      const verified = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Verified Candidates');
      const discovery = verified?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
      const legacy = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.startsWith('Discovery Results'));
      const beforeRanking = Array.from(legacy?.children || [])
        .filter((node) => node.classList?.contains('meta'))
        .map((node) => String(node.textContent || '').trim())
        .filter(Boolean);
      const beforeCandidateDom = Array.from(document.querySelectorAll('#candidate-list > article.card > strong'))
        .map((node) => String(node.textContent || '').trim());
      let beforeState = {};
      try {
        beforeState = JSON.parse(localStorage.getItem(stateKey) || '{}');
      } catch {}
      const beforeIds = Array.isArray(beforeState.candidates)
        ? beforeState.candidates.map((candidate) => String(candidate?.id || ''))
        : [];
      const expectedLegacyBefore = Array.isArray(beforeState.candidates)
        ? beforeState.candidates.slice(0, 4)
          .map((candidate) => `${candidate?.artist || 'Unknown'} - ${candidate?.title || 'Unknown'}`)
        : [];
      const expectedCandidateBefore = Array.isArray(beforeState.candidates)
        ? beforeState.candidates.map((candidate) => String(candidate?.title || candidate?.name || 'Unknown'))
        : [];
      const beforeTarget = Array.isArray(beforeState.candidates)
        ? beforeState.candidates.find((candidate) => candidate?.id === targetId)
        : null;
      return {
        listening,
        discovery,
        listeningContentWindow: listening?.contentWindow || null,
        discoveryContentWindow: discovery?.contentWindow || null,
        listeningSrc: listening?.src || '',
        discoverySrc: discovery?.src || '',
        beforeRanking,
        beforeCandidateDom,
        beforeIds,
        beforeIndex: beforeIds.indexOf(targetId),
        beforeTargetScore: Number(beforeTarget?.tasteScore || 0),
        expectedLegacyBefore,
        expectedCandidateBefore,
        targetLabel,
      };
    }, {
      targetId: MUSIC_TILE_SCENARIO_TRACK_ID,
      targetLabel: MUSIC_TILE_SCENARIO_TRACK_LABEL,
      stateKey: MUSIC_TILE_STATE_KEY,
      rating: MUSIC_TILE_SCENARIO_RATING,
    });
    frameNavigatedListener = (frame) => {
      if (frame === listeningFrame) frameEvents.listeningNavigations += 1;
      if (frame === discoveryFrame) frameEvents.discoveryNavigations += 1;
    };
    frameDetachedListener = (frame) => {
      if (frame === listeningFrame) frameEvents.listeningDetaches += 1;
      if (frame === discoveryFrame) frameEvents.discoveryDetaches += 1;
    };
    page.on('framenavigated', frameNavigatedListener);
    page.on('framedetached', frameDetachedListener);
    const ratingLocator = page.locator(
      `#listening-deck .player-deck-card [data-rate="${MUSIC_TILE_SCENARIO_RATING}"][data-id="${MUSIC_TILE_SCENARIO_TRACK_ID}"]`,
    );
    await ratingLocator.click();
    await page.waitForFunction(({ key, trackId, rating }) => {
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem(key) || '{}');
      } catch {}
      const selected = document.querySelector(
        `#listening-deck .player-deck-card [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      const cardText = selected?.closest('.player-deck-card')
        ?.querySelector('.music-card-header .music-card-meta')?.textContent || '';
      return stored?.ratings?.[trackId] === rating
        && selected?.getAttribute('aria-pressed') === 'true'
        && selected?.classList.contains('is-active')
        && cardText.includes(`rating ${rating}`);
    }, {
      key: MUSIC_TILE_STATE_KEY,
      trackId: MUSIC_TILE_SCENARIO_TRACK_ID,
      rating: MUSIC_TILE_SCENARIO_RATING,
    }, { timeout: 10000 });
    await page.waitForTimeout(50);
    const currentListeningHandleValue = await page.evaluateHandle(({ trackId, rating }) => {
      const ratingButton = document.querySelector(
        `#listening-deck [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      return ratingButton?.closest('.player-deck-card')
        ?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
    }, {
      trackId: MUSIC_TILE_SCENARIO_TRACK_ID,
      rating: MUSIC_TILE_SCENARIO_RATING,
    });
    const currentDiscoveryHandleValue = await page.evaluateHandle(() => {
      const verified = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Verified Candidates');
      return verified?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
    });
    const currentListeningHandle = currentListeningHandleValue.asElement();
    const currentDiscoveryHandle = currentDiscoveryHandleValue.asElement();
    const currentListeningFrame = await currentListeningHandle?.contentFrame?.();
    const currentDiscoveryFrame = await currentDiscoveryHandle?.contentFrame?.();
    const listeningSentinelAfter = currentListeningFrame
      ? await currentListeningFrame.evaluate(() => ({
        instance: globalThis.__stephanosProofPlaybackInstance,
        tick: globalThis.__stephanosProofPlaybackTick,
      }))
      : { instance: '', tick: -1 };
    const discoverySentinelAfter = currentDiscoveryFrame
      ? await currentDiscoveryFrame.evaluate(() => ({
        instance: globalThis.__stephanosProofPlaybackInstance,
        tick: globalThis.__stephanosProofPlaybackTick,
      }))
      : { instance: '', tick: -1 };
    const observed = await page.evaluate(({ refs, key, trackId, targetLabel, rating }) => {
      const selectedRating = document.querySelector(
        `#listening-deck [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      const currentListening = selectedRating?.closest('.player-deck-card')
        ?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
      const verified = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.trim() === 'Verified Candidates');
      const currentDiscovery = verified?.querySelector('iframe[src*="open.spotify.com/embed/track/"]') || null;
      const legacy = Array.from(document.querySelectorAll('#discovery-results-list section'))
        .find((section) => section.querySelector('h3')?.textContent?.startsWith('Discovery Results'));
      const afterRanking = Array.from(legacy?.children || [])
        .filter((node) => node.classList?.contains('meta'))
        .map((node) => String(node.textContent || '').trim())
        .filter(Boolean);
      const afterCandidateDom = Array.from(document.querySelectorAll('#candidate-list > article.card > strong'))
        .map((node) => String(node.textContent || '').trim());
      const selected = document.querySelector(
        `#listening-deck .player-deck-card [data-rate="${rating}"][data-id="${trackId}"]`,
      );
      const cardText = selected?.closest('.player-deck-card')
        ?.querySelector('.music-card-header .music-card-meta')?.textContent || '';
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem(key) || '{}');
      } catch {}
      const afterCandidates = Array.isArray(stored.candidates) ? stored.candidates : [];
      const afterIds = afterCandidates.map((candidate) => String(candidate?.id || ''));
      const afterTarget = afterCandidates.find((candidate) => candidate?.id === trackId);
      const expectedLegacyAfter = afterCandidates.slice(0, 4)
        .map((candidate) => `${candidate?.artist || 'Unknown'} - ${candidate?.title || 'Unknown'}`);
      const expectedCandidateAfter = afterCandidates
        .map((candidate) => String(candidate?.title || candidate?.name || 'Unknown'));
      const afterIndex = afterIds.indexOf(trackId);
      return {
        ratingInteraction: {
          trackId,
          requestedRating: rating,
          persistedRating: stored?.ratings?.[trackId],
          selectedButtonPressed: selected?.getAttribute('aria-pressed') === 'true',
          selectedButtonActive: selected?.classList.contains('is-active') === true,
          cardRatingTextUpdated: cardText.includes(`rating ${rating}`),
        },
        listeningDeckIframe: {
          beforePresent: !!refs.listening,
          sameNode: refs.listening === currentListening,
          isConnected: refs.listening?.isConnected === true,
          srcUnchanged: !!refs.listeningSrc && refs.listeningSrc === currentListening?.src,
          contentWindowPreserved: !!refs.listeningContentWindow
            && refs.listeningContentWindow === currentListening?.contentWindow,
        },
        discoveryIframe: {
          beforePresent: !!refs.discovery,
          sameNode: refs.discovery === currentDiscovery,
          isConnected: refs.discovery?.isConnected === true,
          srcUnchanged: !!refs.discoverySrc && refs.discoverySrc === currentDiscovery?.src,
          contentWindowPreserved: !!refs.discoveryContentWindow
            && refs.discoveryContentWindow === currentDiscovery?.contentWindow,
        },
        legacyRanking: {
          before: refs.beforeRanking,
          after: afterRanking,
          beforeIds: refs.beforeIds,
          afterIds,
          targetId: trackId,
          targetLabel,
          beforeIndex: refs.beforeIndex,
          afterIndex,
          beforeTargetScore: refs.beforeTargetScore,
          afterTargetScore: Number(afterTarget?.tasteScore || 0),
          changed: JSON.stringify(refs.beforeRanking) !== JSON.stringify(afterRanking),
          targetMovedUp: refs.beforeIndex >= 0 && afterIndex >= 0 && afterIndex < refs.beforeIndex,
          sameMembers: JSON.stringify([...refs.beforeIds].sort()) === JSON.stringify([...afterIds].sort()),
          legacyDomMatchesStoredBefore: JSON.stringify(refs.beforeRanking)
            === JSON.stringify(refs.expectedLegacyBefore),
          legacyDomMatchesStoredAfter: JSON.stringify(afterRanking)
            === JSON.stringify(expectedLegacyAfter),
          candidateDomMatchesStoredBefore: JSON.stringify(refs.beforeCandidateDom)
            === JSON.stringify(refs.expectedCandidateBefore),
          candidateDomMatchesStoredAfter: JSON.stringify(afterCandidateDom)
            === JSON.stringify(expectedCandidateAfter),
        },
      };
    }, {
      refs: refsHandle,
      key: MUSIC_TILE_STATE_KEY,
      trackId: MUSIC_TILE_SCENARIO_TRACK_ID,
      targetLabel: MUSIC_TILE_SCENARIO_TRACK_LABEL,
      rating: MUSIC_TILE_SCENARIO_RATING,
    });
    observed.listeningDeckIframe.frameIdentityPreserved = currentListeningFrame === listeningFrame;
    observed.listeningDeckIframe.frameNavigationCount = frameEvents.listeningNavigations;
    observed.listeningDeckIframe.frameDetachCount = frameEvents.listeningDetaches;
    observed.listeningDeckIframe.playbackSentinelAdvanced = (
      listeningSentinelBefore.instance === listeningSentinelAfter.instance
      && Number(listeningSentinelAfter.tick) > Number(listeningSentinelBefore.tick)
    );
    observed.discoveryIframe.frameIdentityPreserved = currentDiscoveryFrame === discoveryFrame;
    observed.discoveryIframe.frameNavigationCount = frameEvents.discoveryNavigations;
    observed.discoveryIframe.frameDetachCount = frameEvents.discoveryDetaches;
    observed.discoveryIframe.playbackSentinelAdvanced = (
      discoverySentinelBefore.instance === discoverySentinelAfter.instance
      && Number(discoverySentinelAfter.tick) > Number(discoverySentinelBefore.tick)
    );
    await currentListeningHandleValue.dispose();
    await currentDiscoveryHandleValue.dispose();
    await listeningHandleValue.dispose();
    await discoveryHandleValue.dispose();
    sourceResponseBinding = await collectScenarioSourceResponseBinding(
      capturedResponses.slice(captureStart),
      { scenarioUrl, repoRoot, expectedHead },
    );
    const evidence = {
      schemaVersion: MUSIC_RATING_SCENARIO_EVIDENCE_SCHEMA,
      proofScenario: MUSIC_RATING_PRESERVES_PLAYBACK,
      collector: 'playwright-page-v1',
      observed: true,
      musicTileUrl: scenarioUrl,
      fixture: 'isolated-browser-context-v1',
      playbackContinuityProxy: 'intercepted-spotify-frame-tick-v1',
      sourceResponseBinding,
      ...observed,
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      blockers: [],
    };
    const evaluation = evaluateMusicRatingPreservesPlaybackScenarioEvidence(
      evidence,
      { expectedHead },
    );
    return Object.freeze({
      ...evidence,
      blockers: [...evaluation.blocking],
      listeningDeckIframeIdentityPreserved: evaluation.listeningDeckIframeIdentityPreserved,
      discoveryIframeIdentityPreserved: evaluation.discoveryIframeIdentityPreserved,
      legacyRankingChanged: evaluation.legacyRankingChanged,
    });
  } catch (error) {
    if (!sourceResponseBinding) {
      sourceResponseBinding = await collectScenarioSourceResponseBinding(
        capturedResponses.slice(captureStart),
        { scenarioUrl, repoRoot, expectedHead },
      );
    }
    return failedMusicRatingScenarioEvidence({
      scenarioUrl,
      consoleErrors,
      pageErrors,
      blocker: String(error?.code || error?.message || 'BROWSER_SCENARIO_EXECUTION_FAILED'),
      sourceResponseBinding,
    });
  } finally {
    if (frameNavigatedListener) page.off('framenavigated', frameNavigatedListener);
    if (frameDetachedListener) page.off('framedetached', frameDetachedListener);
    await refsHandle?.dispose?.();
  }
}

async function collectWithBrowser(url = DEFAULT_URL, {
  writeArtifacts = true,
  expectedHead = '',
  expectedDistFingerprint = '',
  expectedDistManifestEntries = [],
  proofScenario = '',
} = {}) {
  const pw = await loadPlaywright();
  if (!pw?.chromium) return { browserAutomationAvailable: false, automationUnavailable: 'Playwright chromium API unavailable', url, generatedAt: stamp(), checks: { runtimeReachable: false } };
  const errors = [];
  let browser;
  try {
    browser = await pw.chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const capturedResponses = [];
    page.on('response', (response) => { capturedResponses.push(response); });
    await page.route('**/apps/stephanos/dist/**', async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'cache-control': 'no-store',
          pragma: 'no-cache',
        },
      });
    });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    const navigationResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(750);
    const observedRuntimeUrl = page.url();
    const checks = await page.evaluate(() => {
      const text = (v) => String(v || '').trim();
      const body = document.body?.innerText || '';
      const footer = document.querySelector('footer.runtime-diagnostic')?.innerText || '';
      const card = document.querySelector('[data-testid="operator-proof-concierge"], [data-proof-concierge-instance="yes"]');
      const next = card?.querySelector('[data-testid="operator-proof-concierge-next-proof"], [data-proof-concierge-field="next-proof"] strong')?.textContent || card?.getAttribute('data-proof-concierge-next-proof-rendered') || '';
      const btn = card?.querySelector('[data-testid="operator-proof-concierge-primary-copy"], [data-concierge-button-role="primary-proof-copy"]');
      const drift = card?.getAttribute('data-proof-concierge-render-input-proof-state-contradiction-detected') === 'yes' || card?.getAttribute('data-proof-concierge-initial-render-next-proof') !== card?.getAttribute('data-proof-concierge-post-hydration-current-dom-next-proof');
      return {
        runtimeReachable: true,
        footerGitCommitPresent: /git commit|commit/i.test(footer),
        footerGitCommit: (footer.match(/(?:git commit|commit)[:\s]+([^\n]+)/i) || [])[1] || '',
        uiBuildTimestampPresent: /build/i.test(footer) && /\d{4}-\d{2}-\d{2}|timestamp/i.test(footer + body),
        uiBuildTimestamp: (footer.match(/build[:\s]+([^\n]+)/i) || [])[1] || '',
        sourceFingerprint: (
          document.querySelector('meta[name="stephanos-build-source-fingerprint"]')?.getAttribute('content')
          || (footer.match(/fingerprint[:\s]+([^\n]+)/i) || [])[1]
          || ''
        ),
        runtimeMarker: (footer.match(/marker[:\s]+([^\n]+)/i) || [])[1] || '',
        proofConciergeDomNextProof: text(next),
        proofConciergeDomNextProofMatches: text(next) === 'browser-proof-checklist',
        proofConciergePrimaryButtonPresent: !!btn,
        proofConciergePrimaryButtonText: text(btn?.textContent),
        proofConciergeVisibleDrift: drift ? 'detected' : 'clear',
        proofConciergeVisibleDriftClear: !drift,
        cloneParity: /clone parity|source\/dist parity/i.test(body) ? 'present' : 'unavailable',
        cloneParityClear: !/clone parity[^\n]*(fail|drift|mismatch)|source\/dist parity[^\n]*(false|fail)/i.test(body),
        operatorDiagnosticCopyPresent: /diagnostic|repair|copy/i.test(body),
      };
    });
    if (expectedDistFingerprint) {
      const servedDist = await collectPlaywrightNavigationDistFingerprint(page, url, {
        navigationResponse,
        capturedResponses,
        expectedEntries: expectedDistManifestEntries,
      });
      checks.runtimeDistFingerprint = servedDist.fingerprint;
      checks.runtimeDistFingerprintBlocker = servedDist.blocker;
      checks.runtimeDistManifestFileCount = servedDist.fileCount;
      checks.runtimeDistManifestTotalBytes = servedDist.totalBytes;
      checks.runtimeDistResponseBinding = servedDist.responseBinding;
    }
    let scenarioEvidence = null;
    if (proofScenario === MUSIC_RATING_PRESERVES_PLAYBACK) {
      const scenarioPage = await context.newPage();
      const scenarioResponses = [];
      const scenarioConsoleErrors = [];
      const scenarioPageErrors = [];
      scenarioPage.on('response', (response) => { scenarioResponses.push(response); });
      scenarioPage.on('console', (message) => {
        if (message.type() === 'error') scenarioConsoleErrors.push(message.text());
      });
      scenarioPage.on('pageerror', (error) => {
        scenarioPageErrors.push(String(error?.message || error || 'unknown page error'));
      });
      try {
        scenarioEvidence = await collectMusicRatingPreservesPlaybackEvidence(scenarioPage, url, {
          capturedResponses: scenarioResponses,
          consoleErrors: scenarioConsoleErrors,
          pageErrors: scenarioPageErrors,
          repoRoot: process.cwd(),
          expectedHead,
        });
      } finally {
        await scenarioPage.close();
      }
    }
    let screenshotPath = '';
    if (writeArtifacts) {
      mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
      screenshotPath = resolve(DEFAULT_OUT_DIR, `browser-proof-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    checks.consoleErrorCount = errors.length;
    return {
      browserAutomationAvailable: true,
      localBrowserMechanism: 'Playwright Chromium using installed Microsoft Edge channel on Windows when available; no browser download requested',
      url,
      observedUrl: observedRuntimeUrl,
      generatedAt: stamp(),
      screenshotPath,
      consoleErrors: errors,
      proofScenario,
      scenarioEvidence,
      checks,
    };
  } catch (error) {
    return { browserAutomationAvailable: false, automationUnavailable: sanitizeAutomationUnavailable(error.message), url, generatedAt: stamp(), consoleErrors: errors, checks: { runtimeReachable: false, consoleErrorCount: errors.length } };
  } finally { if (browser) await browser.close(); }
}

function printSinglePacket(result, options = {}, { writeArtifacts = true } = {}) {
  const packet = buildBrowserProofPacket(result, options);
  process.stdout.write(`${packet}\n`);
  if (writeArtifacts) {
    const out = resolve(DEFAULT_OUT_DIR, 'browser-proof-checklist-packet.txt');
    try {
      mkdirSync(DEFAULT_OUT_DIR, { recursive: true });
      writeFileSync(out, packet);
      console.error(`[stephanos:browser-proof] packet written: ${out}`);
    } catch (error) {
      console.error(`[stephanos:browser-proof] packet file write unavailable: ${sanitizeAutomationUnavailable(error?.message || error)}`);
    }
  }
  return evaluateBrowserProofResult(result, options).accepted ? 0 : 1;
}

function printMachineResult(result, options = {}) {
  const machineResult = buildBrowserProofMachineResult(result, options);
  process.stdout.write(`${JSON.stringify(machineResult)}\n`);
  return machineResult.accepted ? 0 : 1;
}

async function main() {
  const parsed = parseBrowserProofArguments(process.argv.slice(2));
  if (!parsed.ok) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: parsed.blocker,
      url: parsed.url,
      generatedAt: stamp(),
      checks: { runtimeReachable: false },
    };
    process.exit(parsed.machineJson
      ? printMachineResult(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      })
      : printSinglePacket(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      }, { writeArtifacts: parsed.writeArtifacts }));
  }
  const expectedDistManifest = parsed.expectedDistFingerprint
    ? readExpectedDistManifest(
      parsed.expectedDistManifestPath,
      parsed.expectedDistFingerprint,
    )
    : Object.freeze({ ok: true, entries: Object.freeze([]) });
  if (!expectedDistManifest.ok) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: expectedDistManifest.blocker,
      url: parsed.url,
      generatedAt: stamp(),
      checks: {
        runtimeReachable: false,
        runtimeDistFingerprintBlocker: expectedDistManifest.blocker,
      },
    };
    process.exit(parsed.machineJson
      ? printMachineResult(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      })
      : printSinglePacket(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      }, { writeArtifacts: parsed.writeArtifacts }));
  }
  try {
    const result = await collectWithBrowser(parsed.url, {
      writeArtifacts: parsed.writeArtifacts,
      expectedHead: parsed.expectedHead,
      expectedDistFingerprint: parsed.expectedDistFingerprint,
      expectedDistManifestEntries: expectedDistManifest.entries,
      proofScenario: parsed.proofScenario,
    });
    process.exit(parsed.machineJson
      ? printMachineResult(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      })
      : printSinglePacket(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      }, { writeArtifacts: parsed.writeArtifacts }));
  } catch (error) {
    const result = {
      browserAutomationAvailable: false,
      automationUnavailable: sanitizeAutomationUnavailable(error?.message || error),
      url: parsed.url,
      generatedAt: stamp(),
      checks: { runtimeReachable: false },
    };
    process.exit(parsed.machineJson
      ? printMachineResult(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      })
      : printSinglePacket(result, {
        expectedHead: parsed.expectedHead,
        expectedSourceFingerprint: parsed.expectedSourceFingerprint,
        expectedDistFingerprint: parsed.expectedDistFingerprint,
        proofScenario: parsed.proofScenario,
      }, { writeArtifacts: parsed.writeArtifacts }));
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) main();
