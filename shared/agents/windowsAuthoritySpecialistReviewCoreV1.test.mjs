import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
  analyzeWindowsAuthoritySpecialistReview,
} from './windowsAuthoritySpecialistReviewV1.mjs';

const IMPORT_TOKEN = 'im' + 'port';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const paths = [
  'scripts/windows/install-stephanos-backend-autostart.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
];
const forgePaths = [
  'scripts/windows/install-forge-shadow-podman-v1.ps1',
  'scripts/windows/install-forge-shadow-podman-v1.test.mjs',
];

function blobSha(content) {
  const bytes = Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function record(path, content) {
  const exactContent = content.replaceAll('\\\\', '\\');
  return {
    schemaVersion: WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(exactContent),
    blobSha: blobSha(exactContent),
    content: exactContent,
  };
}

const installer = `
$taskName = 'Stephanos Battle Bridge Backend'
$wscriptExe = 'C:\\\\Windows\\\\System32\\\\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw 'missing' }
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $taskArgs
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -MultipleInstances IgnoreNew
if ($PSCmdlet.ShouldProcess($taskName, 'Register/Update scheduled task')) { Register-ScheduledTask }
`;

const probe = `
$wscriptPath = 'C:\\\\Windows\\\\System32\\\\wscript.exe'
$canonicalPowerShell = 'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'
$canonicalNode = 'C:\\\\Program Files\\\\nodejs\\\\node.exe'
$sourceControlExecutable = 'C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'
function Test-TaskAuthority { $Task.Principal.LogonType -eq 'Interactive'; $Task.Principal.RunLevel -eq 'Limited'; $Task.Settings.MultipleInstances -eq 'IgnoreNew' }
Assert-CanonicalTrackedWorktreeClean
$branchRaw = git branch --show-current
if ($branch -ne 'main') { throw 'bad' }
if (-not $observed.authorityCanonical) { continue }
Start-ScheduledTask -TaskName $spec.Name
$executable = $process.ExecutablePath
[string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
schemaVersion -eq 'stephanos.backend-runtime.v1'; headSha; ExpectedSourceHead; pid; $listenerAfter.pid; processStartTimeUtc
backendRestartSkippedAsCurrent
Assert-CanonicalTrackedWorktreeClean
`;

const starter = `
$canonicalGit = 'C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'
$canonicalNpm = 'C:\\\\Program Files\\\\nodejs\\\\npm.cmd'
$canonicalNode = 'C:\\\\Program Files\\\\nodejs\\\\node.exe'
[string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
schemaVersion -eq 'stephanos.backend-health.v1'; runtimeId -eq 'stephanos-battle-bridge-backend'; sourceHead
& $canonicalGit status '--porcelain=v1' '--untracked-files=no'
$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha
function Publish-VerifiedBackendRuntimeReceipt {
  Write-BackendRuntimeReceipt -ProcessStartTimeUtc $Listener.ProcessStartTimeUtc
  $confirmedListener = Get-VerifiedBackendListener
  if ($confirmedListener.ProcessId -ne $Listener.ProcessId -or $confirmedListener.ProcessStartTimeUtc -ne $Listener.ProcessStartTimeUtc -or -not (Test-BackendHealth)) { throw 'changed' }
}
& $canonicalNpm run --silent openclaw:stub:ensure
$existingListener = Get-VerifiedBackendListener
if ($existingListener) {
  Publish-VerifiedBackendRuntimeReceipt -Listener $existingListener
  exit 0
}
Start-Process -FilePath $canonicalNpm -ArgumentList $arguments
Write-BackendRuntimeReceipt -ProcessStartTimeUtc $processStartTimeUtc
`;

const forgeInstaller = `
[ValidatePattern('^[0-9a-fA-F]{40}$')]
[string]$ExpectedHead
[ValidatePattern('^sha256:[0-9a-fA-F]{64}$')]
[string]$ForgejoImageDigest
[switch]$OperatorApproved
$Repository = 'Cheekyfellastef/stephan-os'
$ForgejoVersion = '15.0.6'
$PodmanVersion = '6.0.2'
$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'
$MinimumWindowsBuild = 19043
$PodmanDesktopVersion = '1.29.1'
$PodmanDesktopSourceCommit = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc'
$PodmanDesktopPodmanManifestBlob = '5acfedd1c3171414aa218a1d5d95ea7529687809'
$CompatibilityAuthority = 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2'
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$MachineName = 'stephanos-forge-shadow'
$ContainerName = 'stephanos-forge-shadow'
$RemoteUrl = 'https://github.com/Cheekyfellastef/stephan-os.git'
$HostAddress = '127.0.0.1'
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) { Fail 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED' }
function Invoke-PodmanRemote {
  $boundArguments = @('--connection', $MachineName) + @($Arguments)
}
Invoke-Fixed $Podman @('machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4', $MachineName)
if ($machine.Rootful -ne $false) { Fail 'PODMAN_MACHINE_ROOTFUL_NOT_ALLOWED' }
$args = @(
  '--user', '1000:1000',
  '--read-only',
  '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges',
  '-p', "127.0.0.1:$Port\`:3000"
)
'FORGEJO__server__DISABLE_SSH=true'
'FORGEJO__actions__ENABLED=false'
'FORGEJO__security__DISABLE_GIT_HOOKS=true'
'FORGEJO__security__DISABLE_WEBHOOKS=true'
'FORGEJO__repository__DISABLE_MIGRATIONS=true'
$inspect.ImageDigest
if ([string]$inspect.ImageDigest -ne $ForgejoImageDigest) { Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH' }
try { migrate } finally {
  Invoke-RestMethod -Method Delete -Uri "$ApiRoot/users/$Owner/tokens/$BootstrapTokenName"
}
Fail 'FORGE_BOOTSTRAP_TOKEN_REVOCATION_FAILED'
Fail 'FORGE_BACKUP_COPY_DIGEST_MISMATCH'
Fail 'FORGE_RESTORE_COPY_DIGEST_MISMATCH'
function Create-And-ProveBackup {
  try { restore } finally {
    $RestoreContainerName
    $RestoreVolume
    Invoke-PodmanRemote $Podman @('start', $ContainerName) -AllowFailure
  }
}
Fail 'FORGE_POST_BACKUP_RESTART_HEALTH_FAILED'
Fail 'FORGE_TREE_PARITY_MISMATCH'
status = 'FORGE_SHADOW_M2_READY'
runnerRegistration = $false
mergeAuthority = $false
`;

const forgeStaticTest = `
${IMPORT_TOKEN} { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./install-forge-shadow-podman-v1.ps1', import.meta.url), 'utf8');
test('every remote Podman operation is bound to the named Forge machine connection', () => {});
test('bootstrap token revocation is attempted even when mirror migration fails', () => {});
test('backup restore probe always cleans temporary state and restarts the canonical Forge container', () => {});
test('dangerous generic execution and destructive host commands are absent', () => {});
test('Windows 10 compatibility authority and build floor are fixed', () => {});
has("FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH");
`;

function escalation(selectedPaths = paths) {
  return {
    findings: selectedPaths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', summary: 'specialist', path })),
  };
}

test('exact allowlisted Windows authority sources pass specialist review', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], starter)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN');
  assert.equal(result.proofRefs.length, 3);
});

test('PATH-resolved tools, direct npm, and substring listener proof are concrete P0 findings', () => {
  const insecure = starter
    .replace("$canonicalGit = 'C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'", '$git = Get-Command git')
    .replace("$canonicalNpm = 'C:\\\\Program Files\\\\nodejs\\\\npm.cmd'", '$npm = Get-Command npm')
    .replace('& $canonicalNpm run --silent openclaw:stub:ensure', 'npm run --silent openclaw:stub:ensure')
    .replace('[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)', "$commandLine.Contains('stephanos-server/server.js')");
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], insecure)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('windows-backend-starter-git-unpinned'));
  assert.ok(codes.includes('windows-backend-starter-npm-unpinned'));
  assert.ok(codes.includes('windows-backend-starter-unpinned-npm-invocation'));
  assert.ok(codes.includes('windows-backend-starter-substring-listener-proof'));
});

test('reusing a current listener without refreshing its receipt is a concrete P0 finding', () => {
  const insecure = starter.replace(
    'Publish-VerifiedBackendRuntimeReceipt -Listener $existingListener\n  exit 0',
    'exit 0',
  );
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], insecure)],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-backend-starter-reuse-receipt-missing'));
});

test('receipt publication without stable listener recheck is a concrete P0 finding', () => {
  const insecure = starter.replace(
    "  $confirmedListener = Get-VerifiedBackendListener\n  if ($confirmedListener.ProcessId -ne $Listener.ProcessId -or $confirmedListener.ProcessStartTimeUtc -ne $Listener.ProcessStartTimeUtc -or -not (Test-BackendHealth)) { throw 'changed' }",
    '',
  );
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], insecure)],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-backend-starter-receipt-stability-recheck-missing'));
});

test('Forge installer and its static hostile test are qualified specialist surfaces', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(forgePaths),
    sources: [record(forgePaths[0], forgeInstaller), record(forgePaths[1], forgeStaticTest)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, forgePaths);
  assert.equal(result.proofRefs.length, 2);
});

test('Forge specialist fails closed when actual OCI digest proof or connection binding disappears', () => {
  const insecure = forgeInstaller
    .replace('$inspect.ImageDigest', '$inspect.Image')
    .replace("if ([string]$inspect.ImageDigest -ne $ForgejoImageDigest) { Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH' }", '')
    .replace("$boundArguments = @('--connection', $MachineName) + @($Arguments)", '$boundArguments = @($Arguments)');
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(forgePaths),
    sources: [record(forgePaths[0], insecure), record(forgePaths[1], forgeStaticTest)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('forge-podman-connection-not-fixed'));
  assert.ok(codes.includes('forge-container-image-digest-not-independently-proved'));
  assert.ok(codes.includes('forge-container-image-digest-blocker-missing'));
});

test('Forge specialist fails closed when Windows 10 compatibility authority or build gate weakens', () => {
  const insecure = forgeInstaller
    .replace('a969ee0e0b07285122dd4988a58edb0a1a25d5fc', 'b'.repeat(40))
    .replace("if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) { Fail 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED' }", '');
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(forgePaths),
    sources: [record(forgePaths[0], insecure), record(forgePaths[1], forgeStaticTest)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('forge-podman-desktop-source-commit-not-fixed'));
  assert.ok(codes.includes('forge-windows10-build-gate-missing'));
});

test('Forge specialist test must remain static and must guard the actual image digest', () => {
  const insecure = `${forgeStaticTest.replace('FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH', 'FORGE_CONTAINER_DIGEST_LABEL_MISMATCH')}
${IMPORT_TOKEN} { spawnSync } from 'node:child_process';
`;
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(forgePaths),
    sources: [record(forgePaths[0], forgeInstaller), record(forgePaths[1], insecure)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('forge-static-test-image-digest-proof-missing'));
  assert.ok(codes.includes('forge-static-test-child-process-forbidden'));
});

test('unknown Windows paths remain escalated to an external specialist', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/unknown.ps1' }] },
    sources: [],
  });
  assert.equal(result.eligible, false);
});

test('tampered source identity fails closed', () => {
  const bad = record(paths[0], installer);
  bad.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [bad, record(paths[1], probe), record(paths[2], starter)],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});
