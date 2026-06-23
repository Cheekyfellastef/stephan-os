import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowserProofPacket, evaluateBrowserProofResult, shouldGenerateBrowserProofPacket } from './browser-proof-runner.mjs';

test('browser proof packet generated only when nextProof is browser-proof-checklist', () => {
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'browser-proof-checklist' } }), true);
  assert.equal(shouldGenerateBrowserProofPacket({ operatorProofConcierge: { nextProof: 'verify-proof' } }), false);
});

test('successful DOM proof accepts browser-proof-checklist', () => {
  const result = { browserAutomationAvailable: true, checks: { runtimeReachable: true, footerGitCommitPresent: true, uiBuildTimestampPresent: true, proofConciergeDomNextProofMatches: true, proofConciergePrimaryButtonPresent: true, proofConciergeVisibleDriftClear: true, cloneParityClear: true, operatorDiagnosticCopyPresent: true, consoleErrorCount: 0 } };
  assert.equal(evaluateBrowserProofResult(result).accepted, true);
  assert.match(buildBrowserProofPacket(result), /Status: accepted/);
});

test('console or blocking browser failure rejects browser proof', () => {
  const result = { browserAutomationAvailable: true, checks: { runtimeReachable: true, footerGitCommitPresent: true, uiBuildTimestampPresent: true, proofConciergeDomNextProofMatches: true, proofConciergePrimaryButtonPresent: true, proofConciergeVisibleDriftClear: true, cloneParityClear: true, operatorDiagnosticCopyPresent: true, consoleErrorCount: 2 } };
  const verdict = evaluateBrowserProofResult(result);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.blocking.join(' | '), /console error count 2/);
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
