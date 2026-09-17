import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1,
  analyzeWindowsAuthorityForgeWsl2PrerequisiteReview,
} from './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const ELEVATION_PATH = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];
const BOOTSTRAP_PATH = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[1];

// Self-contained inert fixtures. The reviewer bootstrap must not depend on the
// unadmitted implementation files that it exists to review.
const elevationSource = [
  "[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]",
  'param(',
  "  [ValidatePattern('^[0-9a-fA-F]{40}$')]",
  '  [string]$ExpectedHead,',
  '  [switch]$OperatorApproved',
  ')',
  'Set-StrictMode -Version Latest',
  "$Repository = 'Cheekyfellastef/stephan-os'",
  "$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')",
  "$PowerShellExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
  "$DismExe = Join-Path $env:SystemRoot 'System32\\dism.exe'",
  "$WslExe = Join-Path $env:SystemRoot 'System32\\wsl.exe'",
  'rebootPerformed = $false',
  'podmanMutation = $false',
  'forgeRuntimeMutation = $false',
  'sourceMutation = $false',
  'arbitraryShellAllowed = $false',
  'arbitraryPowerShellAllowed = $false',
  'callerSelectedPathAllowed = $false',
  'callerSelectedExecutableAllowed = $false',
  'callerSelectedArgumentAllowed = $false',
  'githubCredentialUsed = $false',
  "$arguments = @('-NoProfile', '-File', $PSCommandPath, '-ExpectedHead', $ExpectedHead, '-OperatorApproved')",
  'Start-Process -FilePath $PowerShellExe -ArgumentList $arguments -Verb RunAs',
  "Invoke-Fixed $DismExe @('/online', '/enable-feature', \"/featurename:$Feature\", '/all', '/norestart') -AllowFailure",
  "Invoke-Fixed $WslExe @('--update') -AllowFailure",
  "Invoke-Fixed $WslExe @('--set-default-version', '2') -AllowFailure",
  "Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_REBOOT_REQUIRED'",
].join('\n');

const bootstrapSource = [
  '[CmdletBinding()]',
  'param(',
  "  [ValidatePattern('^[0-9a-fA-F]{40}$')]",
  '  [string]$ExpectedHead,',
  '  [switch]$OperatorApproved',
  ')',
  'Set-StrictMode -Version Latest',
  "$Repository = 'Cheekyfellastef/stephan-os'",
  "$WrapperRelativePath = 'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1'",
  "$ElevationScriptRelativePath = 'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1'",
  "$GitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'",
  "$PowerShellExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
  "$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\\forge-wsl2-prerequisite-elevated-v1.json'",
  "$DesktopPath = [Environment]::GetFolderPath('Desktop')",
  "$LauncherName = 'Stephanos Forge WSL2 Bootstrap.cmd'",
  "$LauncherPath = Join-Path $DesktopPath $LauncherName",
  'rebootPerformed = $false',
  'podmanMutation = $false',
  'forgeRuntimeMutation = $false',
  'sourceMutation = $false',
  'githubCredentialUsed = $false',
  "Invoke-Fixed $GitExe @('-C', $RepoRoot, 'hash-object', \"--path=$($entry.Relative)\", $entry.Path)",
  "Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH'",
  'if (Test-Path -LiteralPath $LauncherPath) {',
  "  Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }",
  '}',
  '$launcher = @"',
  '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$ElevationScriptPath" -ExpectedHead $ExpectedHead -OperatorApproved -VisibleElevationBroker',
  'del "%~f0"',
  '"@',
  'Set-Content -LiteralPath $LauncherPath -Value $launcher -Encoding ASCII',
  "Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED'",
].join('\n');

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function record(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}
function input({ elevation = elevationSource, bootstrap = bootstrapSource, findingPath = BOOTSTRAP_PATH } = {}) {
  return {
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: findingPath }] },
    sources: [record(ELEVATION_PATH, elevation), record(BOOTSTRAP_PATH, bootstrap)],
  };
}

test('Forge WSL2 specialist always reviews the closed two-file authority estate', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1, [
    'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1',
    'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1',
  ]);
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1);
  assert.equal(result.proofRefs.length, 2);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_CLEAN');
});

test('either authority path escalates into review of both files', () => {
  const fromElevation = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ findingPath: ELEVATION_PATH }));
  const fromBootstrap = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ findingPath: BOOTSTRAP_PATH }));
  assert.equal(fromElevation.clean, true);
  assert.equal(fromBootstrap.clean, true);
  assert.deepEqual(fromElevation.reviewedPaths, WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1);
  assert.deepEqual(fromBootstrap.reviewedPaths, WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1);
});

test('automatic reboot and dynamic execution in the elevated child fail closed', () => {
  const bad = `${elevationSource}\nRestart-Computer\nInvoke-Expression $payload\n`;
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: bad }));
  assert.equal(result.clean, false);
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-automatic-restart-forbidden'));
  assert.ok(codes.includes('forge-wsl2-dynamic-execution-forbidden'));
});

test('caller-selected feature or command authority in the elevated child fails closed', () => {
  const bad = elevationSource.replace('[switch]$OperatorApproved', '[switch]$OperatorApproved, [string]$Feature, [string]$Command');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-caller-authority-forbidden'));
});

test('widening beyond the fixed two-feature set fails closed', () => {
  const bad = elevationSource.replace(
    "$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')",
    "$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform', 'Containers')",
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-feature-set-not-fixed'));
});

test('desktop bootstrap direct elevation, restart and force overwrite fail closed', () => {
  const bad = `${bootstrapSource}\nStart-Process powershell.exe -Verb RunAs\nRestart-Computer\nSet-Content -LiteralPath $LauncherPath -Value $launcher -Encoding ASCII -Force\n`;
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-bootstrap-direct-elevation-forbidden'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-automatic-restart-forbidden'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-force-overwrite-forbidden'));
});

test('desktop bootstrap caller-selected command authority fails closed', () => {
  const bad = bootstrapSource.replace('[switch]$OperatorApproved', '[switch]$OperatorApproved, [string]$Command');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-caller-authority-forbidden'));
});

test('missing collision refusal fails closed', () => {
  const bad = bootstrapSource.replace("if (Test-Path -LiteralPath $LauncherPath) {\n  Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }\n}", '');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-bootstrap-collision-guard-missing'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-collision-reason-missing'));
});

test('tampered exact-head evidence for either file fails closed', () => {
  const sources = [record(ELEVATION_PATH, elevationSource), record(BOOTSTRAP_PATH, bootstrapSource)];
  sources[1].blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: BOOTSTRAP_PATH }] },
    sources,
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'windows-authority-source-evidence-invalid'));
});

test('extra source evidence widens the estate and fails closed', () => {
  const request = input();
  request.sources.push(record('scripts/windows/unrelated.ps1', bootstrapSource));
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(request);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'windows-authority-source-estate-widened'));
});
