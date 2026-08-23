import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1,
  analyzeWindowsAuthorityLocalChatRecoveryReview,
} from './windowsAuthorityLocalChatRecoveryReviewV1.mjs';

const HEAD = 'd4d400146432f0a696a62bd8f5064c40feac5b91';
const escalated = [...WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1];
const blobs = {
  'scripts/windows/battle-bridge-local-chat-recovery-v1.test.mjs': '25a34ce17214abc022614b2400b93c95bd13fc2d',
  'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1': '4f58a6654913b2415de6df340efe59df98a87602',
  'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1': 'e5f0e8f1781730f3128298134499f96069bbcfdb',
};
const content = {
  'scripts/windows/battle-bridge-local-chat-recovery-v1.test.mjs': String.raw`
assert.match(handler, /ValidateSet/)
assert.doesNotMatch(handler, /\$Uri\b/)
assert.doesNotMatch(handler, /Invoke-Expression/i)
assert.match(installer, /command\.Contains\('%1'\)/)
assert.doesNotMatch(installer, /-Uri\b/)
assert.match(installer, /callerControlledUriPassedToHandler = \$false/)
assert.match(handler, /pcRestartAllowed = \$false/)
assert.match(installer, /pcRestartAllowed = \$false/)
`,
  'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1': String.raw`
Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1'
$state.selfTestVerdict -ne 'PASS'
Get-FileHash -LiteralPath $sourceHandler -Algorithm SHA256
Installed local recovery handler hash does not match reviewed source.
Scheme = 'stephanos-recover-probe'; Action = 'PROBE_BATTLE_BRIDGE'
Scheme = 'stephanos-recover-mailbox'; Action = 'WAKE_CANONICAL_MAILBOX'
Scheme = 'stephanos-recover-mesh'; Action = 'WAKE_CANONICAL_RECOVERY_MESH'
HKCU:\Software\Classes\$($protocol.Scheme)
if ($command.Contains('%1'))
must not receive caller-controlled URI text
Registered local recovery protocol command identity mismatch
callerControlledUriPassedToHandler = $false
callerSelectedExecutableAllowed = $false
callerSelectedPathAllowed = $false
callerSelectedUrlAllowed = $false
callerSelectedTaskAllowed = $false
arbitraryShellAllowed = $false
gitMutationAllowed = $false
sourceMutationAllowed = $false
mergeAllowed = $false
deploymentAllowed = $false
pcRestartAllowed = $false
`,
  'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1': String.raw`
[ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')]
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'
$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1'
$bankId -notin @('A', 'B')
$state.selfTestVerdict -ne 'PASS'
Installed lifeboat payload hash verification failed.
[System.Windows.Forms.MessageBoxButtons]::YesNo
[System.Windows.Forms.MessageBoxDefaultButton]::Button2
if ($Action -ne 'PROBE_BATTLE_BRIDGE')
-File $actionPath -Action $Action
local-chat-recovery-last.json
callerSelectedExecutableAllowed = $false
callerSelectedPathAllowed = $false
callerSelectedUrlAllowed = $false
callerSelectedTaskAllowed = $false
arbitraryShellAllowed = $false
gitMutationAllowed = $false
sourceMutationAllowed = $false
mergeAllowed = $false
deploymentAllowed = $false
pcRestartAllowed = $false
`,
};

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: { findings: escalated.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) },
    sources: WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1.map((path) => ({
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content[path]),
      blobSha: blobs[path],
      content: content[path],
    })),
    ...overrides,
  };
}

function source(candidate, path) {
  return candidate.sources.find((entry) => entry.path === path);
}

test('qualifies only the exact three-file Battle Bridge-local ChatGPT recovery ingress', () => {
  const result = analyzeWindowsAuthorityLocalChatRecoveryReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
});

test('rejects partial or widened escalation and source estates', () => {
  const partial = input();
  partial.analysis = { findings: partial.analysis.findings.slice(0, 2) };
  assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(partial).eligible, false);

  const widenedEscalation = input();
  widenedEscalation.analysis.findings.push({ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/foreign.ps1' });
  assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(widenedEscalation).eligible, false);

  const widenedSource = input();
  widenedSource.sources.push({ ...widenedSource.sources[0], path: 'scripts/windows/foreign.ps1' });
  assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(widenedSource).clean, false);
});

test('rejects wrong target blob or missing exact source evidence', () => {
  const wrongBlob = input();
  wrongBlob.sources[1].blobSha = '0'.repeat(40);
  assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(wrongBlob).clean, false);

  const missing = input();
  missing.sources = missing.sources.slice(1);
  assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(missing).clean, false);
});

test('rejects widened handler action URI shell Git and restart authority', () => {
  for (const mutate of [
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content += " [ValidateSet('FULL_BATTLE_BRIDGE_RECOVERY')]"; },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content += ' $Uri [System.Uri]'; },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content += ' Invoke-Expression $x'; },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content += ' git.exe reset --hard'; },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content += ' Restart-Computer'; },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content = source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content.replace('[System.Windows.Forms.MessageBoxDefaultButton]::Button2', '[System.Windows.Forms.MessageBoxDefaultButton]::Button1'); },
    (candidate) => { source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content = source(candidate, 'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1').content.replace('Installed lifeboat payload hash verification failed.', 'hash check removed'); },
  ]) {
    const candidate = input();
    mutate(candidate);
    assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(candidate).clean, false);
  }
});

test('rejects installer URI forwarding dynamic shell Git restart or widened protocol mapping', () => {
  for (const mutate of [
    (candidate) => { source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content += ' -Uri "%1"'; },
    (candidate) => { source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content += ' Invoke-Expression $x'; },
    (candidate) => { source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content += ' git.exe checkout other'; },
    (candidate) => { source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content += ' shutdown.exe /r'; },
    (candidate) => { source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content = source(candidate, 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1').content.replace("Scheme = 'stephanos-recover-probe'; Action = 'PROBE_BATTLE_BRIDGE'", "Scheme = 'stephanos-recover-probe'; Action = 'FULL_BATTLE_BRIDGE_RECOVERY'"); },
  ]) {
    const candidate = input();
    mutate(candidate);
    assert.equal(analyzeWindowsAuthorityLocalChatRecoveryReview(candidate).clean, false);
  }
});
