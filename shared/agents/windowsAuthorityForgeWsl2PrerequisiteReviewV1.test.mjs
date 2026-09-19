import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1,
  analyzeWindowsAuthorityForgeWsl2PrerequisiteReview,
} from './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];

// Self-contained inert source fixture. The reviewer bootstrap must not depend on
// the unadmitted implementation file that it exists to review.
const source = [
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

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function record(content = source) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}
function input(content = source) {
  return {
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }] },
    sources: [record(content)],
  };
}

test('exact bounded Forge WSL2 source fixture passes its dedicated specialist', () => {
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_CLEAN');
});

test('reviewer bootstrap fixture is self-contained and does not read the unadmitted implementation', () => {
  assert.equal(source.includes('enable-forge-wsl2-prerequisite-v1.ps1'), false);
});

test('automatic reboot and dynamic execution fail closed', () => {
  const bad = `${source}\nRestart-Computer\nInvoke-Expression $payload\n`;
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input(bad));
  assert.equal(result.clean, false);
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-automatic-restart-forbidden'));
  assert.ok(codes.includes('forge-wsl2-dynamic-execution-forbidden'));
});

test('caller-selected feature or command authority fails closed', () => {
  const bad = source.replace('[switch]$OperatorApproved', '[switch]$OperatorApproved, [string]$Feature, [string]$Command');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input(bad));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-caller-authority-forbidden'));
});

test('widening beyond the fixed two-feature set fails closed', () => {
  const bad = source.replace(
    "$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')",
    "$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform', 'Containers')",
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input(bad));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-feature-set-not-fixed'));
});

test('tampered exact-head source identity fails closed', () => {
  const candidate = record();
  candidate.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }] },
    sources: [candidate],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'windows-authority-source-evidence-invalid'));
});
