import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrowserProofMachineResult,
  buildBrowserProofPacket,
  evaluateBrowserProofResult,
  parseBrowserProofArguments,
  shouldGenerateBrowserProofPacket,
} from './browser-proof-runner.mjs';

test('browser proof packet generated only when nextProof is browser-proof-checklist', () => {
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'browser-proof-checklist' } }), true);
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'verify-proof' } }), false);
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
  assert.deepEqual(parseBrowserProofArguments(['--expected-head', expectedHead, '--no-artifacts', '--machine-json']), {
    ok: true,
    url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    expectedHead,
    writeArtifacts: false,
    machineJson: true,
  });
  assert.equal(parseBrowserProofArguments(['--expected-head', 'short']).blocker, 'EXPECTED_HEAD_INVALID');
});

test('machine result exposes the browser-observed exact-head decision without relying on model text', () => {
  const expectedHead = 'a'.repeat(40);
  const result = buildBrowserProofMachineResult({
    browserAutomationAvailable: true,
    url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
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
  }, { expectedHead });
  assert.equal(result.schemaVersion, 'stephanos.browser-runtime-exact-head-proof.v1');
  assert.equal(result.url, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(result.observedUrl, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
  assert.equal(result.accepted, true);
  assert.equal(result.runtimeSourceHead, expectedHead);
  assert.equal(result.expectedHeadMatch, true);
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
