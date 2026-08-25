import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { analyzeWindowsAuthorityForgePodmanPrerequisiteReview } from './windowsAuthorityForgePodmanPrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = 'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1';
const SHA = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';
function blobSha(content) { const b = Buffer.from(content); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); }
function record(content) { return { schemaVersion: 'stephanos.windows-authority-source.v1', repository: REPOSITORY, path: PATH, ref: HEAD, exists: true, size: Buffer.byteLength(content), blobSha: blobSha(content), content }; }
function input(content) { return { repository: REPOSITORY, sourceHead: HEAD, analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }] }, sources: [record(content)] }; }
const source = String.raw`
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param([ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead,[switch]$OperatorApproved)
Set-StrictMode -Version Latest
$Repository = 'Cheekyfellastef/stephan-os'
$PodmanVersion = '6.0.2'
$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'
$MinimumWindowsBuild = 19043
$MaximumWindowsBuildExclusive = 22000
$RequiredWindowsArchitecture = 'X64'
$InstallerUrl = 'https://github.com/podman-container-tools/podman/releases/download/v6.0.2/podman-installer-windows-amd64.msi'
$InstallerSha256 = '${SHA}'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$MsiexecExe = Join-Path $env:SystemRoot 'System32\msiexec.exe'
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)') { Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' }
if ($ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) { Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' }
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) { Emit-Blocked 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED' }
if ($ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) { Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' }
function Get-Wsl2Evidence {
  $status = Invoke-Fixed $WslExe @('--status') -AllowFailure
  if ($statusText -match '(?im)^\s*Default Version:\s*2\s*$') { return 'default-version-2' }
  $list = Invoke-Fixed $WslExe @('--list', '--verbose') -AllowFailure
  if ($listText -match '2') { return 'distribution-version-2' }
  return ''
}
$ObservedWsl2Evidence = Get-Wsl2Evidence
if (-not $ObservedWsl2Evidence) { Emit-Blocked 'WSL2_NOT_AVAILABLE' }
Get-FileHash -LiteralPath $msiPath -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath $msiPath
if ([string]$signature.Status -ne 'Valid') { throw 'invalid' }
Start-Process -FilePath $MsiexecExe -ArgumentList @('/i', $msiPath,'/qn','/norestart','ALLUSERS=2','MSIINSTALLPERUSER=1') -Wait -PassThru
PODMAN_USER_VERSION_NOT_PROVEN
CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL
status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'
machineMutation = $false
containerMutation = $false
imagePull = $false
githubCredentialUsed = $false
arbitraryPowerShellAllowed = $false
try {} finally { Remove-Item -LiteralPath $msiPath; Remove-Item -LiteralPath $tempRoot }
`;

test('fixed prerequisite is eligible and clean', () => {
  const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(source));
  assert.equal(r.eligible, true); assert.equal(r.clean, true);
  assert.equal(r.finalVerdict, 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_CLEAN');
});

test('caller-selected URL and elevation fail closed', () => {
  const bad = source.replace('[switch]$OperatorApproved)', '[switch]$OperatorApproved,[string]$Url)').concat('\nStart-Process powershell.exe -Verb RunAs\n');
  const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(bad));
  assert.equal(r.clean, false);
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('forge-podman-prerequisite-caller-authority-forbidden'));
  assert.ok(codes.includes('forge-podman-prerequisite-elevation-forbidden'));
});

test('machine or image authority and missing signature proof fail closed', () => {
  const bad = source.replace('Get-AuthenticodeSignature -LiteralPath $msiPath', 'Write-Output no-signature').concat("\n@('machine', 'start')\n@('pull', 'image')\n");
  const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(bad));
  assert.equal(r.clean, false);
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('forge-podman-prerequisite-signature-proof-missing'));
  assert.ok(codes.includes('forge-podman-prerequisite-forge-mutation-forbidden'));
});

test('critical Windows host assignments cannot be reassigned behind safe literals', () => {
  for (const [mutation, code] of [
    ["\n$MinimumWindowsBuild = 0\n", 'forge-podman-prerequisite-build-floor-assignment-not-unique'],
    ["\n$MaximumWindowsBuildExclusive = 99999\n", 'forge-podman-prerequisite-build-ceiling-assignment-not-unique'],
    ["\n$RequiredWindowsArchitecture = 'Arm64'\n", 'forge-podman-prerequisite-architecture-assignment-not-unique'],
    ["\n$WindowsHostAdapter = 'anything-goes'\n", 'forge-podman-prerequisite-host-adapter-assignment-not-unique'],
  ]) {
    const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(source + mutation));
    assert.equal(r.clean, false);
    assert.ok(r.findings.some((item) => item.code === code));
  }
});

test('Windows client architecture build ceiling and parsed WSL2 gates cannot disappear', () => {
  for (const [needle, code] of [
    ["if ($ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) { Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' }", 'forge-podman-prerequisite-x64-gate-missing'],
    ["if ($ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) { Emit-Blocked 'WINDOWS_10_CLIENT_REQUIRED' }", 'forge-podman-prerequisite-build-ceiling-gate-missing'],
    ["$status = Invoke-Fixed $WslExe @('--status') -AllowFailure", 'forge-podman-prerequisite-wsl2-proof-missing'],
    ["$ObservedWsl2Evidence = Get-Wsl2Evidence", 'forge-podman-prerequisite-wsl2-gate-missing'],
  ]) {
    const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(source.replace(needle, '# removed')));
    assert.equal(r.clean, false);
    assert.ok(r.findings.some((item) => item.code === code));
  }
});
