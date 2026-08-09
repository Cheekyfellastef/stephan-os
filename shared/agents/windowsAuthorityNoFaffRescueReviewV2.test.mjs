import test from 'node:test';
import assert from 'node:assert/strict';

import {
  upgradeWindowsAuthorityNoFaffRescueReviewV2,
} from './windowsAuthorityNoFaffRescueReviewV2.mjs';

const RESCUE = 'scripts/windows/repair-battle-bridge-control-plane-now.ps1';
const STATIC = 'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs';
const STATUS = 'scripts/windows/status-stephanos-codex-dispatch-plugin.ps1';

function baseResult(findings = []) {
  return {
    schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: [RESCUE, STATIC, STATUS],
    findings,
    proofRefs: ['proofs/windows-authority-specialist/example'],
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN',
  };
}

const rescue = String.raw`
if ($dispatchProof.readyForRemoteChatDispatch -ne $true) {
$dispatchBlocker = [string]$dispatchProof.finalVerdict
if ($dispatchProof.readyForCodexCliDispatch -eq $true) {
'Establish the separately reviewed authenticated ChatGPT transport'
}
readyForCodexCliDispatch = ($dispatchProof.readyForCodexCliDispatch -eq $true)
readyForRemoteChatDispatch = $false
blocker = $dispatchBlocker
finalVerdict = $dispatchBlocker
}
$observedTree = Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', ($observedHead + '^{tree}'))
`;

const status = String.raw`
$remoteTransportAuthenticated = $false
[string]$attachmentProof.transport.kind -eq 'local-stdio'
$attachmentProof.transport.clientIdentityAuthenticated -eq $false
$attachmentProof.transport.remoteTransportAuthenticated -eq $false
$attachmentProof.clientSession.initializeReceived -eq $true
$attachmentProof.clientSession.initializedNotificationReceived -eq $true
$attachmentProof.clientSession.supportedClient -eq $true
$attachmentProof.clientSession.ready -eq $true
$status.readyForCodexCliDispatch = $status.localBridgeReady -and $attachmentProofValid
$status.readyForRemoteChatDispatch = $status.readyForRemoteChatDispatch -and $remoteTransportAuthenticated
BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED
clientIdentityAuthenticated = $false
remoteTransportAuthenticated = $remoteTransportAuthenticated
`;

const staticTest = String.raw`
test('rescue repairs the existing Codex dispatch plugin without creating another execution lane', () => {});
test('rescue resolves the exact commit tree without leaking a literal PowerShell placeholder to Git', () => {});
test('dispatch readiness requires a fresh exact-head Windows tools-list attachment proof and separates local Codex from remote transport', () => {});
assert.match(ps1, /finalVerdict = \\$dispatchBlocker/);
assert.match(ps1, /separately reviewed authenticated ChatGPT transport/);
assert.match(status, /BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED/);
assert.match(status, /remoteTransportAuthenticated = \\$false/);
`;

function input(overrides = {}) {
  const sources = [
    { path: RESCUE, content: rescue },
    { path: STATIC, content: staticTest },
    { path: STATUS, content: status },
  ];
  return { sources, ...overrides };
}

test('replaces only the four superseded V1 literal findings when authenticated-transport guards are present', () => {
  const old = [
    'no-faff-rescue-attachment-blocker-missing',
    'no-faff-rescue-attachment-verdict-missing',
    'no-faff-rescue-tree-binding-missing',
    'no-faff-static-test-attachment-guard-missing',
  ].map((code) => ({ severity: 'P0', code, summary: code, path: code.startsWith('no-faff-static') ? STATIC : RESCUE }));
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult(old), input());
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
});

test('preserves unrelated V1 findings', () => {
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(
    baseResult([{ severity: 'P0', code: 'no-faff-rescue-git-not-fixed', summary: 'x', path: RESCUE }]),
    input(),
  );
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(({ code }) => code === 'no-faff-rescue-git-not-fixed'));
});

test('rejects obsolete attachment-restart semantics and literal tree placeholder', () => {
  const badRescue = rescue
    + '\nCHATGPT_DESKTOP_PLUGIN_ATTACHMENT_REQUIRED'
    + '\nBATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_ATTACHMENT_REQUIRED'
    + '\n$observedHead`${tree}'
    + '\nRestart ChatGPT desktop then publish tools/list';
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult(), {
    sources: [
      { path: RESCUE, content: badRescue },
      { path: STATIC, content: staticTest },
      { path: STATUS, content: status },
    ],
  });
  const codes = result.findings.map(({ code }) => code);
  for (const code of [
    'no-faff-v2-obsolete-plugin-attachment-blocker-forbidden',
    'no-faff-v2-obsolete-attachment-verdict-forbidden',
    'no-faff-v2-literal-tree-placeholder-forbidden',
    'no-faff-v2-obsolete-restart-guidance-forbidden',
  ]) assert.ok(codes.includes(code));
});

test('requires remote transport authentication to remain separate from local Codex readiness', () => {
  const badStatus = status
    .replace('$remoteTransportAuthenticated = $false', '')
    .replace('$status.readyForRemoteChatDispatch = $status.readyForRemoteChatDispatch -and $remoteTransportAuthenticated', '')
    .replace('BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED', '');
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult(), {
    sources: [
      { path: RESCUE, content: rescue },
      { path: STATIC, content: staticTest },
      { path: STATUS, content: badStatus },
    ],
  });
  const codes = result.findings.map(({ code }) => code);
  assert.ok(codes.includes('dispatch-status-v2-remote-auth-default-missing'));
  assert.ok(codes.includes('dispatch-status-v2-remote-auth-join-missing'));
  assert.ok(codes.includes('dispatch-status-v2-authenticated-transport-blocker-missing'));
});

test('requires current static tests to guard dynamic blocker, tree binding and transport separation', () => {
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult(), {
    sources: [
      { path: RESCUE, content: rescue },
      { path: STATIC, content: "test('old attachment proof', () => {});" },
      { path: STATUS, content: status },
    ],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(({ code }) => code === 'no-faff-static-test-v2-attachment-guard-missing'));
  assert.ok(result.findings.some(({ code }) => code === 'no-faff-static-test-v2-tree-guard-missing'));
});

test('does not weaken fail-closed source evidence from V1', () => {
  const sourceInvalid = {
    severity: 'P0',
    code: 'windows-authority-source-evidence-invalid',
    summary: 'invalid',
    path: RESCUE,
  };
  const result = upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult([sourceInvalid]), input());
  assert.equal(result.clean, false);
  assert.equal(result.findings[0].code, 'windows-authority-source-evidence-invalid');
});
