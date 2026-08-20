import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1,
  analyzeWindowsAuthorityMailboxRecoveryGuardianReview,
} from './windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const path = WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1[0];
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const sourceRecord = (content) => ({
  schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: head,
  exists: true, size: Buffer.byteLength(content, 'utf8'), blobSha: blobSha(content), content,
});
const analysis = { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }] };
const review = (content) => analyzeWindowsAuthorityMailboxRecoveryGuardianReview({
  repository, sourceHead: head, analysis, sources: [sourceRecord(content)],
});
const codes = (result) => result.findings.map((item) => item.code);

function boundedGuardianFixture() {
  return [
    "$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'",
    "$gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    "$githubCli = 'C:\\Program Files\\GitHub CLI\\gh.exe'",
    "$fixedPowerShellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'",
    "$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_OR_MAILBOX_ONLY'",
    '$mailboxStaleAfterMinutes = 12',
    "$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'))",
    "$localHead = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).ToLowerInvariant()",
    '$authoritySourcePaths = @(',
    "  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',",
    "  'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',",
    "  'scripts/windows/install-battle-bridge-recovery-mesh.ps1',",
    "  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs'",
    ')',
    'foreach ($authorityPath in $authoritySourcePaths) {',
    '  & $gitExe -C $repoRoot diff --quiet -- $authorityPath',
    "  if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_DIRTY' }",
    '  & $gitExe -C $repoRoot diff --cached --quiet -- $authorityPath',
    "  if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_STAGED_DIRTY' }",
    '}',
    "$mailboxInstallerPath = Join-Path $repoRoot 'scripts\\windows\\install-battle-bridge-github-command-mailbox.ps1'",
    "$mailboxRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'))",
    "$mailboxChildRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-with-receipt-index.mjs'))",
    "$recoveryInstallerPath = Join-Path $repoRoot 'scripts\\windows\\install-battle-bridge-recovery-mesh.ps1'",
    'function Test-MailboxTaskIdentity {',
    '  $expectedArguments = "//B //NoLogo `"$ExpectedLauncherPath`" github-command-mailbox"',
    '  $Task.Principal.LogonType',
    '  $Task.Principal.RunLevel',
    '  $Task.Settings.MultipleInstances',
    '}',
    'function Test-RecoveryTaskIdentity {',
    '  $expectedArguments = "//B //NoLogo `"$ExpectedLauncherPath`" recovery-mesh"',
    '}',
    'function Read-FixedGitHubText { param([string[]]$Arguments) }',
    'function Read-FixedGitHubJson { param([string[]]$Arguments) }',
    "$remoteMainHead = (Read-FixedGitHubText -Arguments @('api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha')).ToLowerInvariant()",
    "if ($localHead -eq $remoteMainHead) {",
    "  $sourceRelation = 'EXACT'",
    '} else {',
    "  $comparePath = 'repos/Cheekyfellastef/stephan-os/compare/' + $localHead + '...' + $remoteMainHead",
    "  $comparison = Read-FixedGitHubJson -Arguments @('api', $comparePath)",
    "  $trustedAncestor = $comparison.status -eq 'ahead' -and $comparison.ahead_by -gt 0 -and $comparison.behind_by -eq 0 -and $comparison.merge_base_commit.sha -eq $localHead",
    "  if (-not $trustedAncestor) { Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_MAIN_ANCESTOR' }",
    "  $sourceRelation = 'TRUSTED_ANCESTOR'",
    '}',
    '$mailboxHealthy = $false',
    'if (-not $mailboxHealthy) {',
    '  $mailboxRepairAttempted = $true',
    '  $mailboxRaw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $mailboxInstallerPath -StartNow 2>&1 | Out-String).Trim()',
    '  $mailboxReceipt = $mailboxRaw | ConvertFrom-Json',
    "  if ([string]$mailboxReceipt.schemaVersion -ne 'stephanos.battle-bridge-github-command-mailbox-install.v1') { Stop-Guardian -Blocker 'MAILBOX_REPAIR_RECEIPT_REJECTED' }",
    '  $repairedMailboxTask = Get-ScheduledTask -TaskName $mailboxTaskName -ErrorAction SilentlyContinue',
    "  if (-not (Test-MailboxTaskIdentity -Task $repairedMailboxTask -ExpectedLauncherPath $launcherPath)) { Stop-Guardian -Blocker 'MAILBOX_REPAIR_TASK_IDENTITY_UNPROVEN' }",
    '  $mailboxRepairApplied = $true',
    '}',
    '$recoveryRepairAttempted = $false',
    "if ($sourceRelation -eq 'EXACT') {",
    '  if (-not $recoveryHealthy) {',
    '    $recoveryRepairAttempted = $true',
    '    $recoveryRaw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $recoveryInstallerPath -StartNow -RecoveryMeshOnly 2>&1 | Out-String).Trim()',
    '    $recoveryReceipt = $recoveryRaw | ConvertFrom-Json',
    "    if ([string]$recoveryReceipt.schemaVersion -ne 'stephanos.battle-bridge-recovery-mesh-install.v1') { Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_RECEIPT_REJECTED' }",
    '  }',
    '}',
    '[pscustomobject]@{',
    '  sourceRelation = $sourceRelation',
    '  mailboxRepairAttempted = $mailboxRepairAttempted',
    '  mailboxRepairApplied = $mailboxRepairApplied',
    '  recoveryRepairAttempted = $recoveryRepairAttempted',
    '  arbitraryShellAllowed = $false',
    '  arbitraryTaskNameAllowed = $false',
    '  sourceMutationAllowed = $false',
    '  gitMutationAllowed = $false',
    '  mergeAuthority = $false',
    '}',
  ].join('\n');
}

test('reviewer owns only the existing Recovery Mesh guardian path', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1, [
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  ]);
  const other = analyzeWindowsAuthorityMailboxRecoveryGuardianReview({
    repository, sourceHead: head,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] },
    sources: [],
  });
  assert.equal(other.eligible, false);
});

test('reviewer accepts the bounded mailbox cross-supervision contract', () => {
  const result = review(boundedGuardianFixture());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN');
});

test('reviewer rejects source evidence not bound to the exact blob', () => {
  const record = sourceRecord(boundedGuardianFixture());
  record.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityMailboxRecoveryGuardianReview({ repository, sourceHead: head, analysis, sources: [record] });
  assert.ok(codes(result).includes('windows-authority-source-evidence-invalid'));
});

test('reviewer rejects Git mutation and direct task construction or start', () => {
  for (const [line, expected] of [
    ['git fetch origin main', 'mailbox-recovery-guardian-git-mutation-forbidden'],
    ['Register-ScheduledTask -TaskName $mailboxTaskName', 'mailbox-recovery-guardian-direct-task-mutation-forbidden'],
    ['Start-ScheduledTask -TaskName $mailboxTaskName', 'mailbox-recovery-guardian-direct-task-mutation-forbidden'],
    ['New-ScheduledTaskAction -Execute x', 'mailbox-recovery-guardian-direct-task-mutation-forbidden'],
  ]) {
    const result = review(`${boundedGuardianFixture()}\n${line}`);
    assert.ok(codes(result).includes(expected), line);
  }
});

test('reviewer rejects mutable GitHub API and other repositories', () => {
  const mutable = review(`${boundedGuardianFixture()}\n$githubCli api repos/Cheekyfellastef/stephan-os/issues -X POST`);
  assert.ok(codes(mutable).includes('mailbox-recovery-guardian-gh-mutation-forbidden'));
  const otherRepo = review(boundedGuardianFixture().replaceAll('repos/Cheekyfellastef/stephan-os/', 'repos/other/repo/'));
  assert.ok(codes(otherRepo).includes('mailbox-recovery-guardian-main-api-not-fixed'));
});

test('reviewer requires strict ancestor proof including zero behind and exact merge base', () => {
  const missingMergeBase = boundedGuardianFixture().replace(" -and $comparison.merge_base_commit.sha -eq $localHead", '');
  const result = review(missingMergeBase);
  assert.ok(codes(result).includes('mailbox-recovery-guardian-ancestor-proof-incomplete'));
});

test('reviewer forbids Recovery Mesh repair outside the exact-head gate', () => {
  const widened = boundedGuardianFixture().replace("if ($sourceRelation -eq 'EXACT') {", "if ($sourceRelation -in @('EXACT','TRUSTED_ANCESTOR')) {");
  const result = review(widened);
  assert.ok(codes(result).includes('mailbox-recovery-guardian-recovery-exact-head-gate-missing'));
});

test('reviewer rejects arbitrary caller authority and dynamic execution', () => {
  for (const [line, expected] of [
    ['[string]$TaskName', 'mailbox-recovery-guardian-caller-authority-forbidden'],
    ['Invoke-Expression $payload', 'mailbox-recovery-guardian-dynamic-execution-forbidden'],
    ['Start-Process cmd.exe', 'mailbox-recovery-guardian-dynamic-execution-forbidden'],
    ['RunLevel Highest', 'windows-authority-expanded'],
  ]) {
    const result = review(`${boundedGuardianFixture()}\n${line}`);
    assert.ok(codes(result).includes(expected), line);
  }
});

test('reviewer requires local HEAD provenance and clean fixed authority source at that commit', () => {
  const unprovenHead = review(boundedGuardianFixture().replace(
    "$localHead = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).ToLowerInvariant()",
    "$localHead = $env:CALLER_HEAD",
  ));
  assert.ok(codes(unprovenHead).includes('mailbox-recovery-guardian-local-head-provenance-missing'));

  const dirtyProofRemoved = review(boundedGuardianFixture().replace(
    /foreach \(\$authorityPath in \$authoritySourcePaths\) \{[\s\S]*?\n\}/,
    '',
  ));
  assert.ok(codes(dirtyProofRemoved).includes('mailbox-recovery-guardian-authority-source-proof-incomplete'));
});

test('reviewer rejects mutation verbs smuggled through fixed Git argument arrays', () => {
  const widened = review(`${boundedGuardianFixture()}\nRead-FixedGitText -Arguments @('-C', $repoRoot, 'reset', '--hard')`);
  assert.ok(codes(widened).includes('mailbox-recovery-guardian-git-read-surface-widened'));
  assert.ok(codes(widened).includes('mailbox-recovery-guardian-git-mutation-argument-forbidden'));
});

test('reviewer proves Recovery Mesh repair is lexically nested inside the unique exact-head block', () => {
  const widened = boundedGuardianFixture().replace(
    "if ($sourceRelation -eq 'EXACT') {\n  if (-not $recoveryHealthy) {",
    "if ($sourceRelation -eq 'EXACT') {\n}\nif (-not $recoveryHealthy) {",
  );
  const result = review(widened);
  assert.ok(codes(result).includes('mailbox-recovery-guardian-recovery-repair-not-exact-head-gated'));
});

test('top-level specialist pins and routes the mailbox recovery reviewer before the legacy Recovery Mesh reviewer', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '0750137480031f19a364915095c69b7ab6061799'/);
  const mailboxRoute = source.indexOf('analyzeWindowsAuthorityMailboxRecoveryGuardianReview');
  const legacyRoute = source.indexOf('analyzeWindowsAuthorityRecoveryMeshGuardianReview');
  assert.ok(mailboxRoute > 0 && legacyRoute > mailboxRoute);
});
