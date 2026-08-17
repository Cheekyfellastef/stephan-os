import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1,
  analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview,
} from './windowsAuthorityMobileRecoveryLifeboatInstallerReviewV1.mjs';

const HEAD = '040c03ea8c15408a160f2000edcb9ca1a834a118';
const escalated = [
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
];
const blobs = {
  'docs/architecture/battle-bridge-recovery-lifeboat-ab-installer-v1.md': 'fb7ac67a3bb47fa872add7548b0e7f57ab1614e0',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1807bab1ce20c6aaad6d317a69ee6b987597a7bc',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1': '914d6f390e6288bea8911db1dac7de03af661826',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': 'c280cad73ec01f7c7ff8462e2e18a1a1f49552d2',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.mjs': 'fafeff364c99c005f781f098ee6ae8802e645329',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.test.mjs': '93cb91afe0e28d915dfb890d730417c0b574fa22',
};
const content = {
  'docs/architecture/battle-bridge-recovery-lifeboat-ab-installer-v1.md': '%LOCALAPPDATA%\\Stephanos\\BattleBridgeRecoveryLifeboat Stephanos Battle Bridge Recovery Lifeboat A bank update never targets the current active bank. candidate installed-bank heartbeat proof before promotion retain the previous active bank as rollback does not install the lifeboat',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': "$taskName = 'Stephanos Battle Bridge Recovery Lifeboat' Join-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat' $powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited -RepetitionInterval (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew Read-FreshHealthyHeartbeat -BankId $targetBank -ExpectedManifest $manifestSha256 Write-AtomicJson -Path $activeStatePath activeBankOverwriteAllowed = $false dualBankOverwriteAllowed = $false arbitraryPathAllowed = $false arbitraryTaskNameAllowed = $false arbitraryExecutableAllowed = $false arbitraryShellAllowed = $false gitMutationAllowed = $false sourceMutationAllowed = $false pcRestartAllowed = $false",
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1': "param() $powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' $bankId -notin @('A', 'B') selfTestVerdict manifestSha256",
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': "param() $bankId -notin @('A', 'B') Get-FileHash payload hash does not match its immutable manifest -Action PROBE_BATTLE_BRIDGE payloadVerified = $true repoCheckoutRequired = $false openClawGatewayRequired = $false arbitraryShellAllowed = $false gitMutationAllowed = $false sourceMutationAllowed = $false pcRestartAllowed = $false",
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.mjs': "mode: 'BOOTSTRAP_SINGLE_KNOWN_GOOD_BANK' mode: 'STAGE_INACTIVE_BANK' requireCandidateSelfTestPass: true requireCandidateHeartbeatFresh: true atomicActiveBankSwitchRequired: true retainRollbackBankRequired: true activeBankOverwriteAllowed: false dualBankOverwriteAllowed: false arbitraryPathAllowed: false arbitraryTaskNameAllowed: false arbitraryExecutableAllowed: false arbitraryShellAllowed: false gitMutationAllowed: false sourceMutationAllowed: false pcRestartAllowed: false",
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.test.mjs': "assert.doesNotMatch(source, /Invoke-Expression/i) assert.doesNotMatch(source, /git\\.exe/i) assert.doesNotMatch(source, /Restart-Computer/i) assert.match(source, /RunLevel Limited/) assert.match(source, /RepetitionInterval \\(New-TimeSpan -Minutes 2\\)/)",
};

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: { findings: escalated.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) },
    sources: WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1.map((path) => ({
      schemaVersion: 'stephanos.windows-authority-source.v1', repository: 'Cheekyfellastef/stephan-os', path,
      ref: HEAD, exists: true, size: Buffer.byteLength(content[path]), blobSha: blobs[path], content: content[path],
    })),
    ...overrides,
  };
}

test('qualifies exactly the six-file M4 lifeboat installer estate behind the three high-risk Windows surfaces', () => {
  const result = analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1);
});

test('rejects partial or widened escalation and source estates', () => {
  const partial = input(); partial.analysis = { findings: partial.analysis.findings.slice(0, 2) };
  assert.equal(analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview(partial).eligible, false);
  const widened = input(); widened.sources = [...widened.sources, { ...widened.sources[0], path: 'scripts/windows/extra.ps1' }];
  assert.equal(analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview(widened).clean, false);
});

test('rejects changed blobs and widened shell Git task or PC restart authority', () => {
  for (const mutate of [
    (x) => { x.sources[1].blobSha = '0'.repeat(40); },
    (x) => { x.sources[1].content += ' Invoke-Expression $x'; },
    (x) => { x.sources[1].content += ' git.exe reset --hard'; },
    (x) => { x.sources[1].content += ' Restart-Computer'; },
    (x) => { x.sources[1].content += ' param([string]$TaskName)'; },
  ]) {
    const candidate = input(); mutate(candidate);
    assert.equal(analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview(candidate).clean, false);
  }
});
