import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { analyzeWindowsAuthorityForgePodmanPrerequisiteReview } from './windowsAuthorityForgePodmanPrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = 'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1';
const SHA = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';
const PODMAN_DESKTOP_SOURCE_COMMIT = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc';
const PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB = '5acfedd1c3171414aa218a1d5d95ea7529687809';
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
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$PodmanDesktopVersion = '1.29.1'
$PodmanDesktopSourceCommit = '${PODMAN_DESKTOP_SOURCE_COMMIT}'
$PodmanDesktopPodmanManifestBlob = '${PODMAN_DESKTOP_PODMAN_MANIFEST_BLOB}'
$CompatibilityAuthority = 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2'
$InstallerUrl = 'https://github.com/podman-container-tools/podman/releases/download/v6.0.2/podman-installer-windows-amd64.msi'
$InstallerSha256 = '${SHA}'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$MsiexecExe = Join-Path $env:SystemRoot 'System32\msiexec.exe'
Get-FileHash -LiteralPath $msiPath -Algorithm SHA256
Get-AuthenticodeSignature -LiteralPath $msiPath
if ([string]$signature.Status -ne 'Valid') { throw 'invalid' }
Start-Process -FilePath $MsiexecExe -ArgumentList @('/i', $msiPath,'/qn','/norestart','ALLUSERS=2','MSIINSTALLPERUSER=1') -Wait -PassThru
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) { Emit-Blocked 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED' }
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

test('Windows 10 compatibility authority and minimum build gate fail closed when weakened', () => {
  const bad = source
    .replace(PODMAN_DESKTOP_SOURCE_COMMIT, 'b'.repeat(40))
    .replace('if ($ObservedWindowsBuild -lt $MinimumWindowsBuild)', 'if ($false)');
  const r = analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input(bad));
  assert.equal(r.clean, false);
  const codes = r.findings.map((x) => x.code);
  assert.ok(codes.includes('forge-podman-desktop-source-commit-not-fixed'));
  assert.ok(codes.includes('forge-podman-windows10-build-gate-missing'));
});
