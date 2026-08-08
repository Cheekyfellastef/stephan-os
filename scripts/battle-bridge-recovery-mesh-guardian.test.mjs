import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guardianUrl = new URL('./windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1', import.meta.url);
const installerUrl = new URL('./windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url);
const uninstallerUrl = new URL('./windows/uninstall-battle-bridge-recovery-mesh.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);
const [guardian, installer, uninstaller, launcher] = await Promise.all([
  readFile(guardianUrl, 'utf8'),
  readFile(installerUrl, 'utf8'),
  readFile(uninstallerUrl, 'utf8'),
  readFile(launcherUrl, 'utf8'),
]);

test('guardian has one fixed recovery-mesh mutation scope', () => {
  assert.match(guardian, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(guardian, /REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY/);
  assert.match(guardian, /-RecoveryMeshOnly/);
  assert.match(guardian, /-StartNow/);
  assert.doesNotMatch(guardian, /Register-ScheduledTask|New-ScheduledTaskAction|New-ScheduledTaskTrigger/);
  assert.doesNotMatch(guardian, /Invoke-Expression|\biex\b|Start-Process|cmd\.exe/i);
  assert.match(guardian, /arbitraryShellAllowed = \$false/);
  assert.match(guardian, /sourceMutationAllowed = \$false/);
  assert.match(guardian, /gitMutationAllowed = \$false/);
  assert.match(guardian, /arbitraryRuntimeMutationAllowed = \$false/);
  assert.match(guardian, /mergeAuthority = \$false/);
});

test('guardian binds recovery source to exact trusted remote main before mutation', () => {
  assert.match(guardian, /Documents\\GitHub\\stephan-os/);
  assert.match(guardian, /'branch', '--show-current'/);
  assert.match(guardian, /CANONICAL_MAIN_BRANCH_REQUIRED/);
  assert.match(guardian, /'remote', 'get-url', 'origin'/);
  assert.match(guardian, /CANONICAL_ORIGIN_REQUIRED/);
  assert.match(guardian, /'ls-remote', \$origin, 'refs\/heads\/main'/);
  assert.match(guardian, /LOCAL_HEAD_NOT_TRUSTED_REMOTE_MAIN/);
  assert.match(guardian, /exactRemoteHeadMatch = \$true/);
  assert.match(guardian, /ReparsePoint/);
  assert.match(guardian, /diff --quiet --/);
  assert.match(guardian, /diff --cached --quiet --/);
  assert.match(guardian, /RECOVERY_SOURCE_DIRTY/);
  assert.match(guardian, /RECOVERY_SOURCE_STAGED_DIRTY/);
  assert.doesNotMatch(guardian, /\b(?:reset|clean|stash|rebase|push|checkout|switch|merge|fetch)\b/i);
});

test('guardian validates canonical task action authority and freshness', () => {
  assert.match(guardian, /Test-RecoveryTaskIdentity/);
  assert.match(guardian, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(guardian, /recovery-mesh/);
  assert.match(guardian, /Task\.Principal\.LogonType/);
  assert.match(guardian, /Task\.Principal\.RunLevel/);
  assert.match(guardian, /Task\.Settings\.MultipleInstances/);
  assert.match(guardian, /TASK_IDENTITY_DRIFTED/);
  assert.match(guardian, /TASK_MISSING/);
  assert.match(guardian, /TASK_INFO_MISSING/);
  assert.match(guardian, /TASK_LAST_RESULT_FAILED/);
  assert.match(guardian, /TASK_HEARTBEAT_STALE/);
  assert.match(guardian, /StaleAfterMinutes = 4/);
  assert.match(guardian, /lastTaskResult -eq 0/);
  assert.match(guardian, /lastRunAgeMinutes -le \$StaleAfterMinutes/);
  assert.match(guardian, /RECOVERY_MESH_REPAIR_TASK_IDENTITY_UNPROVEN/);
  assert.match(guardian, /BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_REPAIRED/);
  assert.match(guardian, /BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_HEALTHY/);
});

test('recovery installer creates a separate wake-only guardian while retaining v1 mailbox receipt compatibility', () => {
  assert.match(installer, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(installer, /recovery-mesh-guardian/);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(installer, /guardianStaleAfterMinutes = 4/);
  assert.match(installer, /guardianAuthority = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'/);
  assert.match(installer, /RecoveryMeshOnly/);
  assert.match(installer, /stephanos\.battle-bridge-recovery-mesh-install\.v1/);
  assert.match(installer, /LOCAL_WINDOWS_SUPERVISOR/);
  assert.match(installer, /maximumConcurrentExecutors = 1/);
  assert.match(installer, /arbitraryTaskNameAllowed = \$false/);
  assert.match(installer, /sourceMutationAllowed = \$false/);
  assert.match(installer, /gitMutationAllowed = \$false/);
  assert.match(installer, /mergeAuthority = \$false/);
});

test('uninstall removes guardian before parent so requested shutdown cannot self-reverse', () => {
  assert.match(uninstaller, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(uninstaller, /Unregister-ScheduledTask -TaskName \$guardianTaskName/);
  assert.match(uninstaller, /RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED/);
  assert.match(uninstaller, /guardianRemovedBeforeRecoveryMesh = \$true/);
  assert.ok(uninstaller.indexOf('Unregister-ScheduledTask -TaskName $guardianTaskName') < uninstaller.indexOf('Unregister-ScheduledTask -TaskName $taskName'));
});

test('windowless launcher exposes only the fixed guardian identity and script', () => {
  assert.match(launcher, /Case "recovery-mesh-guardian"/);
  assert.match(launcher, /run-battle-bridge-recovery-mesh-guardian-hidden\.ps1/);
  assert.doesNotMatch(launcher, /WScript\.Arguments\(1\)|ExecuteGlobal|Eval\(/i);
});
