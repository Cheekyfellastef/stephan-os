import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1,
  analyzeWindowsAuthorityMobileRecoveryExecutorReview,
} from './windowsAuthorityMobileRecoveryExecutorReviewV1.mjs';

const HEAD = 'c0c0cce34994f677ec03658b25f432e19f0c55b4';
const blobs = {
  'docs/architecture/openclaw-battle-bridge-recovery-executor-v1.md': 'd0b4fce021231972273984642d5f65c6716ba104',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1': 'd95a445f1979dda4f0f6b8458ed2eb84a4b8a88c',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.mjs': 'e692c1b50b66d29f4d707f871f9f6de8bb901c01',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.test.mjs': '5de1d8d052a3dc0a04e4717fe7bfaa5ba228cd93',
};

const content = {
  'docs/architecture/openclaw-battle-bridge-recovery-executor-v1.md': '`PROBE_BATTLE_BRIDGE` `WAKE_CANONICAL_MAILBOX` `WAKE_CANONICAL_RECOVERY_MESH` freshPostActionProofRequired=true does not install the lifeboat',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1': "[ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH', 'RECOVER_REMOTE_ACCESS_STACK')] $wscriptExe = 'C:\\Windows\\System32\\wscript.exe' $mailboxTask = 'Stephanos Battle Bridge GitHub Command Mailbox' $recoveryMeshTask = 'Stephanos Battle Bridge Recovery Mesh' $githubSyncTask = 'Stephanos Battle Bridge GitHub Sync' $commanderWatchdogTask = 'Stephanos Commander Watchdog' authorityIdentityValid = [bool]$authorityIdentityValid $taskPrincipalSid -eq $currentUserSid [string]$task.Principal.LogonType -eq 'Interactive' [string]$task.Principal.RunLevel -eq 'Limited' [string]$task.Settings.MultipleInstances -eq 'IgnoreNew' githubSyncStartAllowed = $false criticalTasks = @('recoveryMesh') Start-ScheduledTask -TaskName $TaskName freshPostActionProofRequired = $true arbitraryShellAllowed = $false callerSelectedTaskAllowed = $false gitMutationAllowed = $false sourceMutationAllowed = $false pcRestartAllowed = $false",
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.mjs': "'PROBE_BATTLE_BRIDGE' 'WAKE_CANONICAL_MAILBOX' 'WAKE_CANONICAL_RECOVERY_MESH' 'RECOVER_REMOTE_ACCESS_STACK' fixedAdapterRelativePath: OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH freshPostActionProofRequired: true arbitraryShellAllowed: false callerSelectedTaskAllowed: false gitMutationAllowed: false sourceMutationAllowed: false pcRestartAllowed: false",
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.test.mjs': "assert.doesNotMatch(source, /Invoke-Expression/i) assert.doesNotMatch(source, /Start-Process/i) assert.doesNotMatch(source, /git\\.exe/i) assert.doesNotMatch(source, /Restart-Computer/i) assert.match(source, /authorityIdentityValid/) assert.match(source, /githubSyncStartAllowed = \\$false/) assert.doesNotMatch(recoveryBlock, /\\$githubSyncTask\\s*,/)",
};

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    analysis: {
      findings: WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1.map((path) => ({
        severity: 'P0', code: 'unsupported-high-risk-surface', path,
      })),
    },
    sources: WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1.map((path) => ({
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

test('qualifies only the exact four-file mobile recovery executor estate', () => {
  const result = analyzeWindowsAuthorityMobileRecoveryExecutorReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1);
});

test('rejects partial or widened escalation estates', () => {
  const partial = input();
  partial.analysis = { findings: partial.analysis.findings.slice(0, 3) };
  assert.equal(analyzeWindowsAuthorityMobileRecoveryExecutorReview(partial).eligible, false);
  const widened = input();
  widened.sources = [...widened.sources, { ...widened.sources[0], path: 'scripts/windows/extra.ps1' }];
  const result = analyzeWindowsAuthorityMobileRecoveryExecutorReview(widened);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-estate-widened'));
});

test('rejects changed blob identity and widened shell/task/Git/restart authority', () => {
  for (const mutate of [
    (x) => { x.sources[1].blobSha = '0'.repeat(40); },
    (x) => { x.sources[1].content += ' Register-ScheduledTask'; },
    (x) => { x.sources[1].content += ' Invoke-Expression $x'; },
    (x) => { x.sources[1].content += ' git.exe reset --hard'; },
    (x) => { x.sources[1].content += ' Restart-Computer'; },
  ]) {
    const candidate = input();
    mutate(candidate);
    assert.equal(analyzeWindowsAuthorityMobileRecoveryExecutorReview(candidate).clean, false);
  }
});
