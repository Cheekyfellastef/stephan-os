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

const validUninstaller = [
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

test('reviewer recognizes exactly the four bounded Recovery Mesh guardian authority paths', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1, [
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'scripts/windows/uninstall-battle-bridge-recovery-mesh.ps1',
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

test('uninstaller review is isolated from installer rules and accepts unregister commands', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  const result = review(path, validUninstaller);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
});

test('uninstaller review still rejects actual registration or task start authority', () => {
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3];
  for (const command of ['Register-ScheduledTask -TaskName x', 'Start-ScheduledTask -TaskName x', 'New-ScheduledTaskAction -Execute x']) {
    const result = review(path, `${validUninstaller}\n${command}`);
    assert.ok(codes(result).includes('recovery-guardian-uninstall-start-or-register-forbidden'), command);
  }
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
