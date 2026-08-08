import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1,
  analyzeWindowsAuthorityRecoveryMeshGuardianReview,
} from './windowsAuthorityRecoveryMeshGuardianReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const sourceRecord = (path, content) => ({
  schemaVersion: 'stephanos.windows-authority-source.v1',
  repository,
  path,
  ref: head,
  exists: true,
  size: Buffer.byteLength(content, 'utf8'),
  blobSha: blobSha(content),
  content,
});
const analysisFor = (paths) => ({
  findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
});

const installer = String.raw`[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$StartNow, [switch]$RecoveryMeshOnly)
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
$guardianRunnerPath = 'run-battle-bridge-recovery-mesh-guardian-hidden.ps1'
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
if (-not $RecoveryMeshOnly) {
  $guardianActionArguments = 'recovery-mesh-guardian'
  $guardianIntervalTrigger = New-ScheduledTaskTrigger -Once -At $now -RepetitionInterval (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $guardianTaskName -Action $guardianAction
}
schemaVersion = 'stephanos.battle-bridge-recovery-mesh-install.v1'
guardianAuthority = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'
recoveryRoutes = @('LOCAL_WINDOWS_SUPERVISOR','GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')
arbitraryTaskNameAllowed = $false
sourceMutationAllowed = $false
gitMutationAllowed = $false
mergeAuthority = $false`;

const tick = '`';
const guardian = String.raw`[ValidateRange(2, 15)]
[int]$StaleAfterMinutes = 4
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$fixedPowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'
$repoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
function Test-RecoveryTaskIdentity {
  $expectedArguments = "//B //NoLogo ${tick}"$ExpectedLauncherPath${tick}" recovery-mesh"
  $x = $Task.Principal.LogonType
  $y = $Task.Principal.RunLevel
  $z = $Task.Settings.MultipleInstances
}
$remote = Read-FixedGitText -Arguments @('ls-remote', $origin, 'refs/heads/main')
if ($localHead -ne $remoteMainHead) { Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_REMOTE_MAIN' }
Stop-Guardian -Blocker 'RECOVERY_SOURCE_DIRTY'
Stop-Guardian -Blocker 'RECOVERY_SOURCE_STAGED_DIRTY'
$healthy = $null -ne $task -and $taskIdentityCanonical -and $lastTaskResult -eq 0 -and $lastRunAgeMinutes -le $StaleAfterMinutes
$reason = 'TASK_IDENTITY_DRIFTED'
$reason = 'TASK_HEARTBEAT_STALE'
$raw = & $fixedPowerShellExe -File $installerPath -StartNow -RecoveryMeshOnly
if ($receipt.schemaVersion -ne 'stephanos.battle-bridge-recovery-mesh-install.v1') { throw 'bad' }
Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_TASK_IDENTITY_UNPROVEN'
arbitraryShellAllowed = $false
sourceMutationAllowed = $false
gitMutationAllowed = $false
arbitraryRuntimeMutationAllowed = $false
mergeAuthority = $false`;

const launcher = String.raw`If WScript.Arguments.Count <> 1 Then
  WScript.Quit 2
End If
Select Case taskId
  Case "recovery-mesh-guardian"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\run-battle-bridge-recovery-mesh-guardian-hidden.ps1")
  Case Else
    WScript.Quit 2
End Select
exitCode = shell.Run(command, 0, True)`;

const uninstaller = String.raw`[CmdletBinding(SupportsShouldProcess = $true)]
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'
Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false
throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
guardianRemovedBeforeRecoveryMesh = $true
workerPreserved = $true
mailboxPreserved = $true
sourcePreserved = $true`;

const fixtures = new Map([
  [WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[0], installer],
  [WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1], guardian],
  [WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[2], launcher],
  [WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3], uninstaller],
]);

function review(path, content = fixtures.get(path)) {
  return analyzeWindowsAuthorityRecoveryMeshGuardianReview({
    repository,
    sourceHead: head,
    analysis: analysisFor([path]),
    sources: [sourceRecord(path, content)],
  });
}

test('reviewer recognizes exactly the four Recovery Mesh guardian authority paths', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1, [
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'scripts/windows/uninstall-battle-bridge-recovery-mesh.ps1',
  ]);
  for (const path of WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1) {
    const result = review(path);
    assert.equal(result.eligible, true, path);
    assert.equal(result.clean, true, JSON.stringify(result.findings));
  }
});

test('reviewer rejects an unrelated Windows authority path', () => {
  const path = 'scripts/windows/arbitrary-admin.ps1';
  const result = analyzeWindowsAuthorityRecoveryMeshGuardianReview({ repository, sourceHead: head, analysis: analysisFor([path]), sources: [sourceRecord(path, 'x')] });
  assert.equal(result.eligible, false);
});

test('reviewer rejects source evidence not bound to exact head and blob', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1];
  const record = sourceRecord(path, guardian);
  record.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityRecoveryMeshGuardianReview({ repository, sourceHead: head, analysis: analysisFor([path]), sources: [record] });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('reviewer requires trusted remote-main equality and canonical task identity', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1];
  const weakened = guardian
    .replace("if ($localHead -ne $remoteMainHead) { Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_REMOTE_MAIN' }", '')
    .replace('$taskIdentityCanonical -and ', '');
  const result = review(path, weakened);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'recovery-guardian-exact-head-comparison-missing'));
  assert.ok(result.findings.some((item) => item.code === 'recovery-guardian-health-join-incomplete'));
});

test('reviewer rejects elevated or dynamic guardian installation authority', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[0];
  const result = review(path, `${installer}\nRunLevel Highest\n-Command arbitrary`);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-expanded'));
  assert.ok(result.findings.some((item) => item.code === 'recovery-guardian-dynamic-powershell-forbidden'));
});

test('reviewer requires guardian-first uninstall order', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  const reversed = uninstaller.replace(
    'Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false\nthrow \'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED\'\nUnregister-ScheduledTask -TaskName $taskName -Confirm:$false',
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false\nthrow \'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED\'\nUnregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false',
  );
  const result = review(path, reversed);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'recovery-guardian-uninstall-order-not-proved'));
});

test('reviewer rejects extra caller-controlled launcher arguments', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[2];
  const result = review(path, `${launcher}\nvalue = WScript.Arguments(1)`);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'recovery-guardian-launcher-extra-argument-forbidden'));
});
