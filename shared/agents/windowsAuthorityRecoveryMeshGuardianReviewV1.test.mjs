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
const review = (path, content) => analyzeWindowsAuthorityRecoveryMeshGuardianReview({
  repository,
  sourceHead: head,
  analysis: analysisFor([path]),
  sources: [sourceRecord(path, content)],
});

function codes(result) {
  return result.findings.map((item) => item.code);
}

function boundedIngressFixture() {
  return [
    "[CmdletBinding(DefaultParameterSetName = 'Wake')]",
    "[ValidateSet('GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')]",
    "$taskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'))",
    "$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\\windows\\run-stephanos-scheduled-task-windowless.vbs'))",
    "$wscriptPath = 'C:\\Windows\\System32\\wscript.exe'",
    "if (-not [string]::Equals($EvidenceIssuer, 'battle-bridge-github-command-mailbox', [System.StringComparison]::Ordinal)) { throw 'RECOVERY_ROUTE_EVIDENCE_ISSUER_INVALID' }",
    "if ([string]$mailboxReceipt.operation -ne 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH') { throw 'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID' }",
    "$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    '$currentSourceHead = [string](& $sourceControlExecutable -C $repoRoot rev-parse HEAD)',
    "if ([string]$mailboxReceipt.state -notin @('ACCEPTED','DONE')) { throw 'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID' }",
    "$expectedArguments = \"//B //NoLogo `\"$launcherPath`\" recovery-mesh\"",
    "if ([string]$task.Principal.LogonType -ne 'Interactive') { throw 'RECOVERY_MESH_TASK_PRINCIPAL_INVALID' }",
    "if ([string]$task.Principal.RunLevel -ne 'Limited') { throw 'RECOVERY_MESH_TASK_PRINCIPAL_INVALID' }",
    "if ([string]$task.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'RECOVERY_MESH_TASK_SETTINGS_INVALID' }",
    "action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'",
    'arbitraryShellAllowed = $false',
    'arbitraryTaskNameAllowed = $false',
    'sourceMutationAllowed = $false',
    'Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force',
    '$taskStateBefore = [string]$task.State',
    '$startAttempted = $false',
    "if ($taskStateBefore -ne 'Running') {",
    '  $startAttempted = $true',
    '  try {',
    '    Start-ScheduledTask -TaskName $taskName',
    '  } catch {',
    '    $taskAfterFailure = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue',
    "    if (-not $taskAfterFailure -or [string]$taskAfterFailure.State -ne 'Running') {",
    "      throw 'RECOVERY_MESH_TASK_START_FAILED'",
    '    }',
    '  }',
    '}',
    '[pscustomobject]@{',
    '  queued = $true',
    '  coordinatorStateBefore = $taskStateBefore',
    '  startAttempted = $startAttempted',
    '  arbitraryShellAllowed = $false',
    '  sourceMutationAllowed = $false',
    '}',
  ].join('\n');
}

test('reviewer recognizes exactly the five bounded Recovery Mesh authority paths', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1, [
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'scripts/windows/uninstall-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/request-battle-bridge-recovery.ps1',
  ]);
  for (const path of WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1) {
    const result = review(path, 'bounded fixture');
    assert.equal(result.eligible, true, path);
    assert.deepEqual(result.reviewedPaths, [path]);
  }
});

test('reviewer rejects an unrelated Windows authority surface', () => {
  const path = 'scripts/windows/arbitrary-admin.ps1';
  const result = analyzeWindowsAuthorityRecoveryMeshGuardianReview({
    repository,
    sourceHead: head,
    analysis: analysisFor([path]),
    sources: [sourceRecord(path, 'x')],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE');
});

test('reviewer rejects source evidence not bound to the exact blob', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1];
  const record = sourceRecord(path, 'fixed source');
  record.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityRecoveryMeshGuardianReview({
    repository,
    sourceHead: head,
    analysis: analysisFor([path]),
    sources: [record],
  });
  assert.equal(result.clean, false);
  assert.ok(codes(result).includes('windows-authority-source-evidence-invalid'));
});

test('installer review rejects elevated and dynamic PowerShell authority', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[0];
  const result = review(path, 'RunLevel Highest\n-Command arbitrary');
  assert.ok(codes(result).includes('windows-authority-expanded'));
  assert.ok(codes(result).includes('recovery-guardian-dynamic-powershell-forbidden'));
});

test('guardian review requires trusted remote-main binding and forbids direct registration', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1];
  const result = review(path, 'Register-ScheduledTask\nInvoke-Expression unsafe');
  assert.ok(codes(result).includes('recovery-guardian-exact-head-comparison-missing'));
  assert.ok(codes(result).includes('recovery-guardian-direct-registration-forbidden'));
  assert.ok(codes(result).includes('recovery-guardian-dynamic-execution-forbidden'));
});

test('guardian review requires canonical task identity in the healthy-state join', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1];
  const result = review(path, '$healthy = $null -ne $task -and $lastTaskResult -eq 0 -and $lastRunAgeMinutes -le $StaleAfterMinutes');
  assert.ok(codes(result).includes('recovery-guardian-health-join-incomplete'));
  assert.ok(codes(result).includes('recovery-guardian-task-identity-check-missing'));
});

test('launcher review rejects a second caller-controlled argument and dynamic code', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[2];
  const result = review(path, 'value = WScript.Arguments(1)\nEval(value)');
  assert.ok(codes(result).includes('recovery-guardian-launcher-extra-argument-forbidden'));
  assert.ok(codes(result).includes('recovery-guardian-launcher-dynamic-code-forbidden'));
});

test('uninstaller review requires guardian-first parent shutdown order', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  const reversed = [
    '[CmdletBinding(SupportsShouldProcess = $true)]',
    "$taskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'",
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false',
    "throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'",
    'Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false',
    'guardianRemovedBeforeRecoveryMesh = $true',
    'workerPreserved = $true',
    'mailboxPreserved = $true',
    'sourcePreserved = $true',
  ].join('\n');
  const result = review(path, reversed);
  assert.ok(codes(result).includes('recovery-guardian-uninstall-order-not-proved'));
});

test('uninstaller is routed only through uninstaller rules', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  const boundedUninstaller = [
    '[CmdletBinding(SupportsShouldProcess = $true)]',
    "$taskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'",
    'Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false',
    "throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'",
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false',
    'guardianRemovedBeforeRecoveryMesh = $true',
    'workerPreserved = $true',
    'mailboxPreserved = $true',
    'sourcePreserved = $true',
  ].join('\n');
  const result = review(path, boundedUninstaller);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(codes(result).some((code) => code.startsWith('recovery-guardian-install-')), false);
  assert.equal(codes(result).includes('recovery-guardian-recursion-guard-missing'), false);
});

test('uninstaller rejects every Scheduled Task construction primitive', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  const boundedUninstaller = [
    '[CmdletBinding(SupportsShouldProcess = $true)]',
    "$taskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'",
    'Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false',
    "throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'",
    'Unregister-ScheduledTask -TaskName $taskName -Confirm:$false',
    'guardianRemovedBeforeRecoveryMesh = $true',
    'workerPreserved = $true',
    'mailboxPreserved = $true',
    'sourcePreserved = $true',
  ].join('\n');
  for (const command of [
    '(Register-ScheduledTask -TaskName x)',
    'ScheduledTasks\\Register-ScheduledTask -TaskName x',
    'Start-ScheduledTask -TaskName x',
    'New-ScheduledTask',
    'New-ScheduledTaskAction -Execute x',
    'New-ScheduledTaskTrigger -AtLogOn',
    'New-ScheduledTaskPrincipal -UserId x',
    'New-ScheduledTaskSettingsSet',
  ]) {
    const result = review(path, `${boundedUninstaller}\n${command}`);
    assert.ok(
      codes(result).includes('recovery-guardian-uninstall-start-or-register-forbidden'),
      command,
    );
  }
});

test('authenticated ingress adapter accepts only the fixed idempotent wake contract', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[4];
  const result = review(path, boundedIngressFixture());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN');
});

test('authenticated ingress adapter rejects an unconditional or widened task start', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[4];
  const unconditional = boundedIngressFixture().replace(
    "$taskStateBefore = [string]$task.State\n$startAttempted = $false\nif ($taskStateBefore -ne 'Running') {",
    "$taskStateBefore = [string]$task.State\n$startAttempted = $false\nStart-ScheduledTask -TaskName $taskName\nif ($taskStateBefore -ne 'Running') {",
  );
  const result = review(path, unconditional);
  assert.ok(codes(result).includes('recovery-ingress-start-count-not-one'));

  const arbitrary = review(path, `${boundedIngressFixture()}\nStart-ScheduledTask -TaskName $CallerTask`);
  assert.ok(codes(arbitrary).includes('recovery-ingress-arbitrary-task-start-forbidden'));
});

test('authenticated ingress adapter rejects dynamic execution, elevation and Git mutation', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[4];
  for (const [command, expected] of [
    ['Invoke-Expression $payload', 'recovery-ingress-dynamic-execution-forbidden'],
    ['Start-Process cmd.exe', 'recovery-ingress-dynamic-execution-forbidden'],
    ['git reset --hard HEAD', 'windows-authority-source-mutation-forbidden'],
    ['RunLevel Highest', 'windows-authority-expanded'],
    ['Register-ScheduledTask -TaskName x', 'recovery-ingress-task-construction-forbidden'],
  ]) {
    const result = review(path, `${boundedIngressFixture()}\n${command}`);
    assert.ok(codes(result).includes(expected), command);
  }
});
