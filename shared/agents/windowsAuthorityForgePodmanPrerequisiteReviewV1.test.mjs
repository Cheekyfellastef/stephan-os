import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1,
  analyzeWindowsAuthorityForgePodmanPrerequisiteReview,
} from './windowsAuthorityForgePodmanPrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0];
const SHA = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function record(content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content),
    blobSha: blobSha(content),
    content,
  };
}

function escalation(path = PATH) {
  return { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }] };
}

const source = String.raw`
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
[ValidatePattern('^[0-9a-fA-F]{40}$')]
[string]$ExpectedHead,
[switch]$OperatorApproved
)
Set-StrictMode -Version Latest
$Repository = 'Cheekyfellastef/stephan-os'
$PodmanVersion = '6.0.2'
$InstallerUrl = 'https://github.com/podman-container-tools/podman/releases/download/v6.0.2/podman-installer-windows-amd64.msi'
$InstallerSha256 = '${SHA}'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$MsiexecExe = Join-Path $env:SystemRoot 'System32\msiexec.exe'
$actualDigest = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = Get-AuthenticodeSignature -LiteralPath $msiPath
if ([string]$signature.Status -ne 'Valid') { throw 'invalid' }
$process = Start-Process -FilePath $MsiexecExe -ArgumentList @(
'/i', $msiPath,
'/qn',
'/norestart',
'ALLUSERS=2',
'MSIINSTALLPERUSER=1'
) -Wait -PassThru -WindowStyle Hidden
if ($installedVersion -notmatch '^podman version 6\.0\.2') { PODMAN_USER_VERSION_NOT_PROVEN }
if ($headAfter -ne $ExpectedHead -or $treeAfter -ne $localTree) { CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL }
status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'
machineMutation = $false
containerMutation = $false
imagePull = $false
githubCredentialUsed = $false
arbitraryPowerShellAllowed = $false
try { install } finally {
Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $tempRoot -Force -Recurse -ErrorAction SilentlyContinue
}
`;

test('exact fixed Podman prerequisite passes qualified specialist review', () => {
  const result = analyzeWindowsAuthorityForgePodmanPrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(source)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, [PATH]);
});

test('specialist rejects caller-selected installer authority', () => {
  const insecure = source.replace('[string]$ExpectedHead,', '[string]$ExpectedHead,\n[string]$Url,');
  const result = analyzeWindowsAuthorityForgePodmanPrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(insecure)],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'forge-podman-prerequisite-caller-authority-forbidden'));
});

test('specialist rejects elevation, machine startup, image pulls and missing verification', () => {
  const insecure = source
    .replace("Get-FileHash -LiteralPath $msiPath -Algorithm SHA256", 'Write-Output hash')
    .replace("Get-AuthenticodeSignature -LiteralPath $msiPath", 'Write-Output signature')
    .replace("if ([string]$signature.Status -ne 'Valid') { throw 'invalid' }", '')
    .concat("\nStart-Process powershell.exe -Verb RunAs\n& $PodmanUserExe machine start\n@('pull', 'image')\n");
  const result = analyzeWindowsAuthorityForgePodmanPrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(insecure)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('forge-podman-prerequisite-hash-proof-missing'));
  assert.ok(codes.includes('forge-podman-prerequisite-signature-proof-missing'));
  assert.ok(codes.includes('forge-podman-prerequisite-signature-gate-missing'));
  assert.ok(codes.includes('forge-podman-prerequisite-elevation-forbidden'));
  assert.ok(codes.includes('forge-podman-prerequisite-forge-mutation-forbidden'));
});

test('specialist rejects unknown paths and tampered source evidence', () => {
  const unknown = analyzeWindowsAuthorityForgePodmanPrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation('scripts/windows/unknown.ps1'),
    sources: [],
  });
  assert.equal(unknown.eligible, false);

  const tampered = record(source);
  tampered.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityForgePodmanPrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [tampered],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});
