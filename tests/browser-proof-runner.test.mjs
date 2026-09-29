import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { buildBrowserProofPacket, evaluateBrowserProofResult } from '../scripts/browser-proof-runner.mjs';

test('browser proof repair packet first line is copyable and canonical', () => {
  const packet = buildBrowserProofPacket({
    browserAutomationAvailable: false,
    automationUnavailable: 'test runtime unavailable',
    checks: { runtimeReachable: false },
  });

  assert.equal(packet.split('\n')[0], 'Browser Proof Repair Packet V1');
  assert.match(packet, /Status: repair-required/);
});

test('browser proof success packet first line is copyable and canonical', () => {
  const packet = buildBrowserProofPacket({
    browserAutomationAvailable: true,
    checks: {
      runtimeReachable: true,
      footerGitCommitPresent: true,
      uiBuildTimestampPresent: true,
      proofConciergeDomNextProofMatches: true,
      proofConciergePrimaryButtonPresent: true,
      proofConciergeVisibleDriftClear: true,
      cloneParityClear: true,
      operatorDiagnosticCopyPresent: true,
      consoleErrorCount: 0,
    },
  });

  assert.equal(packet.split('\n')[0], 'Browser Proof Checklist V1');
  assert.match(packet, /Status: observed/);
});

test('browser proof observed packet preserves caveats and merge blockers without blocking proof evidence', () => {
  const result = {
    browserAutomationAvailable: true,
    screenshotPath: '/tmp/browser-proof.png',
    consoleErrors: ['TypeError: sample browser console failure'],
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
  };
  const verdict = evaluateBrowserProofResult(result);
  const packet = buildBrowserProofPacket(result);

  assert.equal(verdict.accepted, true);
  assert.equal(verdict.mergeReady, false);
  assert.match(packet, /^Browser Proof Checklist V1/);
  assert.match(packet, /Status: observed/);
  assert.match(packet, new RegExp('Observed caveats:\\n- Proof Concierge primary button missing\\n- console error count 1'));
  assert.match(packet, /Merge blockers:/);
  assert.match(packet, new RegExp('Console error summary:\\n- TypeError: sample browser console failure'));
  assert.match(packet, /Screenshot evidence: \/tmp\/browser-proof\.png/);
});

test('browser proof runner always emits one packet when invoked directly', () => {
  const result = spawnSync(process.execPath, ['scripts/browser-proof-runner.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  const stdout = result.stdout.trim();
  const packetHeaders = stdout.split('\n').filter((line) => (
    line === 'Browser Proof Checklist V1' || line === 'Browser Proof Repair Packet V1'
  ));

  assert.ok(stdout.length > 0);
  assert.equal(packetHeaders.length, 1);
  assert.match(packetHeaders[0], /^Browser Proof (Checklist|Repair Packet) V1$/);
});
