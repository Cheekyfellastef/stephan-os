import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guardianUrl = new URL('./windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1', import.meta.url);
const recoveryInstallerUrl = new URL('./windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url);
const mailboxInstallerUrl = new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
const uninstallerUrl = new URL('./windows/uninstall-battle-bridge-recovery-mesh.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);
const [guardian, recoveryInstaller, mailboxInstaller, uninstaller, launcher] = await Promise.all([
  readFile(guardianUrl, 'utf8'),
  readFile(recoveryInstallerUrl, 'utf8'),
  readFile(mailboxInstallerUrl, 'utf8'),
  readFile(uninstallerUrl, 'utf8'),
  readFile(launcherUrl, 'utf8'),
]);

test('guardian cross-supervises only the two canonical fixed tasks', () => {
  assert.match(guardian, /\$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'/);
  assert.match(guardian, /\$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'/);
  assert.match(guardian, /REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_OR_MAILBOX_ONLY/);
  assert.match(guardian, /Test-MailboxTaskIdentity/);
  assert.match(guardian, /Test-RecoveryTaskIdentity/);
  assert.match(guardian, /github-command-mailbox/);
  assert.match(guardian, /recovery-mesh/);
  assert.doesNotMatch(guardian, /Register-ScheduledTask|New-ScheduledTaskAction|New-ScheduledTaskTrigger|Start-ScheduledTask/);
  assert.doesNotMatch(guardian, /Invoke-Expression|\biex\b|Start-Process|cmd\.exe|Stop-Process/i);
  assert.match(guardian, /arbitraryShellAllowed = \$false/);
  assert.match(guardian, /arbitraryTaskNameAllowed = \$false/);
  assert.match(guardian, /sourceMutationAllowed = \$false/);
  assert.match(guardian, /gitMutationAllowed = \$false/);
  assert.match(guardian, /mergeAuthority = \$false/);
});

test('guardian proves local source is exact main or a strict trusted ancestor without mutating git', () => {
  assert.match(guardian, /C:\\Program Files\\Git\\cmd\\git\.exe/);
  assert.match(guardian, /C:\\Program Files\\GitHub CLI\\gh\.exe/);
  assert.match(guardian, /'branch', '--show-current'/);
  assert.match(guardian, /'remote', 'get-url', 'origin'/);
  assert.match(guardian, /'rev-parse', 'HEAD'/);
  assert.match(guardian, /repos\/Cheekyfellastef\/stephan-os\/branches\/main/);
  assert.match(guardian, /repos\/Cheekyfellastef\/stephan-os\/compare\//);
  assert.match(guardian, /\$comparison\.status -eq 'ahead'/);
  assert.match(guardian, /\$comparison\.ahead_by -gt 0/);
  assert.match(guardian, /\$comparison\.behind_by -eq 0/);
  assert.match(guardian, /\$comparison\.merge_base_commit\.sha -eq \$localHead/);
  assert.match(guardian, /sourceRelation = 'EXACT'/);
  assert.match(guardian, /sourceRelation = 'TRUSTED_ANCESTOR'/);
  assert.match(guardian, /LOCAL_HEAD_NOT_TRUSTED_MAIN_ANCESTOR/);
  assert.doesNotMatch(guardian, /\bgit(?:\.exe)?\s+(?:fetch|push|reset|clean|rebase|checkout|switch|merge)\b/i);
});

test('guardian proves the complete launched mailbox and Recovery Mesh runner chains are clean', () => {
  const requiredAuthorityPaths = [
    'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
    'scripts/battle-bridge-recovery-mesh.mjs',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  ];
  for (const path of requiredAuthorityPaths) {
    assert.match(guardian, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(guardian, /foreach \(\$authorityPath in \$authoritySourcePaths\)/);
  assert.match(guardian, /diff --quiet -- \$authorityPath/);
  assert.match(guardian, /diff --cached --quiet -- \$authorityPath/);
  assert.match(guardian, /LOCAL_AUTHORITY_SOURCE_DIRTY/);
  assert.match(guardian, /LOCAL_AUTHORITY_SOURCE_STAGED_DIRTY/);
});

test('guardian may repair the fixed mailbox while source is a trusted ancestor', () => {
  assert.match(guardian, /\$mailboxStaleAfterMinutes = 12/);
  assert.match(guardian, /if \(-not \$mailboxHealthy\)/);
  assert.match(guardian, /-File \$mailboxInstallerPath -StartNow/);
  assert.match(guardian, /stephanos\.battle-bridge-github-command-mailbox-install\.v1/);
  assert.match(guardian, /normalizedFromFixedInstaller = \$true/);
  assert.match(guardian, /MAILBOX_REPAIR_TASK_IDENTITY_UNPROVEN/);
  assert.match(guardian, /mailboxRepairAttempted = \$mailboxRepairAttempted/);
  assert.match(guardian, /mailboxRepairApplied = \$mailboxRepairApplied/);
});

test('guardian validates the legacy fixed mailbox installer receipt before versioning its projection', () => {
  for (const field of [
    'taskName', 'installed', 'startedNow', 'receiptIndexEnabled', 'outboxGuardEnabled',
    'runnerPath', 'childRunnerPath', 'intervalMinutes', 'runLevel',
    'arbitraryShellAllowed', 'destructiveGitAllowed', 'liveOpenClawUpdateAllowed',
  ]) assert.match(guardian, new RegExp(`mailboxInstallerReceiptRaw\\.${field}`));
  assert.match(guardian, /MAILBOX_REPAIR_RECEIPT_REJECTED/);
  assert.match(guardian, /MAILBOX_REPAIR_NORMALIZED_RECEIPT_REJECTED/);
  assert.match(mailboxInstaller, /receiptIndexEnabled = \$true/);
  assert.match(mailboxInstaller, /outboxGuardEnabled = \$true/);
  assert.match(mailboxInstaller, /battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
  assert.match(mailboxInstaller, /childRunnerPath = \$childRunnerPath/);
  assert.match(mailboxInstaller, /intervalMinutes = 5/);
  assert.match(mailboxInstaller, /runLevel = 'Limited'/);
  assert.match(mailboxInstaller, /startedNow = \[bool\]\$StartNow/);
});

test('guardian reports mailbox recovery only after a fresh successful scheduled-task run', () => {
  assert.match(guardian, /\$mailboxRepairProofWaitSeconds = 20/);
  assert.match(guardian, /\$mailboxLastRunBefore/);
  assert.match(guardian, /\$mailboxRepairStartedAt = Get-Date/);
  assert.match(guardian, /Start-Sleep -Milliseconds 500/);
  assert.match(guardian, /\$postRunTime -gt \$mailboxLastRunBefore/);
  assert.match(guardian, /\$postRunTime -ge \$mailboxRepairStartedAt\.AddSeconds\(-2\)/);
  assert.match(guardian, /\[int\]\$postInfo\.LastTaskResult -eq 0/);
  assert.match(guardian, /\[string\]\$postTask\.State -ne 'Running'/);
  assert.match(guardian, /MAILBOX_REPAIR_SUCCESSFUL_RUN_NOT_YET_PROVEN/);
  assert.match(guardian, /MAILBOX_TASK_RUNNING_WITHOUT_SUCCESS_PROOF/);
  assert.match(guardian, /BATTLE_BRIDGE_MAILBOX_REPAIR_PENDING_PROOF/);
  assert.match(guardian, /mailboxRepairRunProven = \$mailboxRepairRunProven/);
  assert.match(guardian, /if \(\$mailboxRepairApplied -and \$mailboxRepairRunProven\) \{ 'BATTLE_BRIDGE_MAILBOX_RECOVERED_BY_RECOVERY_GUARDIAN' \}/);
});

test('guardian keeps Recovery Mesh mutation strictly inside the exact-head relation block', () => {
  const marker = "if ($sourceRelation -eq 'EXACT') {";
  const markerIndex = guardian.indexOf(marker);
  assert.ok(markerIndex >= 0);
  const recoveryCall = '-File $recoveryInstallerPath -StartNow -RecoveryMeshOnly';
  const callIndex = guardian.indexOf(recoveryCall);
  assert.ok(callIndex > markerIndex);
  assert.equal(guardian.indexOf(recoveryCall, callIndex + recoveryCall.length), -1);
  assert.match(guardian, /stephanos\.battle-bridge-recovery-mesh-install\.v1/);
  assert.match(guardian, /recoveryRepairAttempted = \$recoveryRepairAttempted/);
  assert.match(guardian, /recoveryRepairAllowed = \(\$sourceRelation -eq 'EXACT'\)/);
});

test('recovery installer retains the separate wake-only guardian and fixed Recovery Mesh receipt', () => {
  assert.match(recoveryInstaller, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(recoveryInstaller, /recovery-mesh-guardian/);
  assert.match(recoveryInstaller, /RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(recoveryInstaller, /RecoveryMeshOnly/);
  assert.match(recoveryInstaller, /stephanos\.battle-bridge-recovery-mesh-install\.v1/);
  assert.match(recoveryInstaller, /maximumConcurrentExecutors = 1/);
});

test('uninstall still removes guardian before parent so requested shutdown cannot self-reverse', () => {
  assert.match(uninstaller, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(uninstaller, /Unregister-ScheduledTask -TaskName \$guardianTaskName/);
  assert.match(uninstaller, /RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED/);
  assert.ok(uninstaller.indexOf('Unregister-ScheduledTask -TaskName $guardianTaskName') < uninstaller.indexOf('Unregister-ScheduledTask -TaskName $taskName'));
});

test('windowless launcher retains only fixed identities', () => {
  assert.match(launcher, /Case "recovery-mesh-guardian"/);
  assert.match(launcher, /run-battle-bridge-recovery-mesh-guardian-hidden\.ps1/);
  assert.match(launcher, /Case "github-command-mailbox"/);
  assert.doesNotMatch(launcher, /WScript\.Arguments\(1\)|ExecuteGlobal|Eval\(/i);
});

test('guardian binds qualified and unqualified task principals through resolved Windows SID identity', () => {
  assert.match(guardian, /function Resolve-WindowsAccountSid/);
  assert.match(guardian, /System\.Security\.Principal\.NTAccount/);
  assert.match(guardian, /System\.Security\.Principal\.SecurityIdentifier/);
  assert.match(guardian, /COMPUTERNAME/);
  assert.match(guardian, /function Test-TaskPrincipalMatchesCurrentUser/);
  assert.match(guardian, /WindowsIdentity\]::GetCurrent\(\)/);
  assert.match(guardian, /\$identity\.User\.Value/);
  assert.match(guardian, /IsNullOrWhiteSpace\(\$principalSid\)/);
  assert.match(guardian, /IsNullOrWhiteSpace\(\$currentSid\)/);
  assert.match(guardian, /StringComparison\]::Ordinal/);
  assert.match(guardian, /principalMatchesCurrentUser = Test-TaskPrincipalMatchesCurrentUser/);
  assert.doesNotMatch(
    guardian,
    /\[string\]::Equals\(\[string\]\$Task\.Principal\.UserId,\s*\$currentUser/
  );
});
