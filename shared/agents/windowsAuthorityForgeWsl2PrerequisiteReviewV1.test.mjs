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
  '$receiptTempPath = Join-Path $directory ("forge-wsl2-prerequisite-elevated-v1.{0}.tmp" -f [Guid]::NewGuid().ToString(\'N\'))',
  '[System.IO.File]::WriteAllText($receiptTempPath, $json, (New-Object System.Text.UTF8Encoding($false)))',
  'Move-Item -LiteralPath $receiptTempPath -Destination $ReceiptPath -Force',
  'finally { Remove-Item -LiteralPath $receiptTempPath -Force -ErrorAction SilentlyContinue }',
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
  '$LauncherPath = Join-Path $DesktopPath $LauncherName',
  'rebootPerformed = $false',
  'podmanMutation = $false',
  'forgeRuntimeMutation = $false',
  'sourceMutation = $false',
  'githubCredentialUsed = $false',
  'function Assert-CanonicalSource {',
  "  $branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()",
  "  $head = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()",
  '  foreach ($entry in @(',
  '    [pscustomobject]@{ Relative = $WrapperRelativePath; Path = $ScriptPath },',
  '    [pscustomobject]@{ Relative = $ElevationScriptRelativePath; Path = $ElevationScriptPath }',
  '  )) {',
  "    $committedBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', \"$ExpectedHead`:$($entry.Relative)\")).Output -join '').Trim().ToLowerInvariant()",
  "    $workingBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'hash-object', \"--path=$($entry.Relative)\", $entry.Path)).Output -join '').Trim().ToLowerInvariant()",
  "    if ($committedBlob -notmatch '^[0-9a-f]{40}$' -or $workingBlob -ne $committedBlob) {",
  "      Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH'",
  '    }',
  '  }',
  '}',
  'function Consume-ElevatedReceipt { return $false }',
  'if (Test-Path -LiteralPath $LauncherPath) {',
  "  Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }",
  '}',
  '$launcher = @"',
  '@echo off',
  '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$ElevationScriptPath" -ExpectedHead $ExpectedHead -OperatorApproved -VisibleElevationBroker',
  'set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"',
  'exit /b %STEPHANOS_FORGE_EXIT%',
  '"@',
  'function Test-ElevatedReceiptReady {',
  '  if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { return $false }',
  '  try {',
  '    $json = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8',
  '    if ([string]::IsNullOrWhiteSpace($json)) { return $false }',
  '    $receipt = $json | ConvertFrom-Json -ErrorAction Stop',
  "    $identityValid = $receipt.schemaVersion -eq 'stephanos.forge-wsl2-prerequisite-receipt.v1' -and $receipt.repository -eq $Repository -and ([string]$receipt.expectedHead).ToLowerInvariant() -eq $ExpectedHead",
  "    $terminalResult = ($receipt.ok -eq $true) -or ($receipt.ok -eq $false -and -not [string]::IsNullOrWhiteSpace([string]$receipt.blocker))",
  "    return $identityValid -and $terminalResult -and -not [string]::IsNullOrWhiteSpace([string]$receipt.status)",
  '  } catch {',
  '    return $false',
  '  }',
  '}',
  'function Consume-ElevatedReceipt { return $false }',
  '$LauncherWaitSeconds = 600',
  '$launcherBytes = [System.Text.Encoding]::ASCII.GetBytes("$launcher`r`n")',
  '$launcherStream = [System.IO.FileStream]::new(',
  '  $LauncherPath,',
  '  [System.IO.FileMode]::CreateNew,',
  '  [System.IO.FileAccess]::ReadWrite,',
  '  [System.IO.FileShare]::Read',
  ')',
  '$launcherStream.Write($launcherBytes, 0, $launcherBytes.Length)',
  '$launcherStream.Flush($true)',
  '$deadline = [DateTime]::UtcNow.AddSeconds($LauncherWaitSeconds)',
  'while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ElevatedReceiptReady)) {',
  '  Start-Sleep -Milliseconds 500',
  '}',
  'if (-not (Test-ElevatedReceiptReady)) {',
  "  Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_TIMEOUT' @{",
  '    mutationPerformed = $null',
  "    mutationState = 'UNKNOWN_OR_IN_PROGRESS'",
  '  }',
  '}',
  'try { return $false } finally {',
  '  $launcherStream.Dispose()',
  '  Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue',
  '}',
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
});

test('either authority path escalates into review of both files', () => {
  assert.equal(analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ findingPath: ELEVATION_PATH })).clean, true);
  assert.equal(analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ findingPath: BOOTSTRAP_PATH })).clean, true);
});

test('automatic reboot and dynamic execution in the elevated child fail closed', () => {
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: `${elevationSource}\nRestart-Computer\nInvoke-Expression $payload` }));
  const codes = result.findings.map((finding) => finding.code);
  assert.equal(result.clean, false);
  assert.ok(codes.includes('forge-wsl2-automatic-restart-forbidden'));
  assert.ok(codes.includes('forge-wsl2-dynamic-execution-forbidden'));
});

test('elevated receipt publication must stay atomic', () => {
  const directWrite = elevationSource.replace(
    'Move-Item -LiteralPath $receiptTempPath -Destination $ReceiptPath -Force',
    'Set-Content -LiteralPath $ReceiptPath -Value $json -Encoding UTF8',
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: directWrite }));
  const codes = result.findings.map((finding) => finding.code);
  assert.equal(result.clean, false);
  assert.ok(codes.includes('forge-wsl2-receipt-atomic-publication-missing'));
  assert.ok(codes.includes('forge-wsl2-receipt-direct-publication-forbidden'));
});

test('caller-selected authority in the elevated child fails closed', () => {
  const bad = elevationSource.replace('[switch]$OperatorApproved', '[switch]$OperatorApproved, [string]$Feature, [string]$Command');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ elevation: bad }));
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-caller-authority-forbidden'));
});

test('desktop bootstrap direct elevation, restart and force overwrite fail closed', () => {
  const bad = `${bootstrapSource}\nStart-Process powershell.exe -Verb RunAs\nRestart-Computer\nSet-Content -LiteralPath $LauncherPath -Value $launcher -Encoding ASCII -Force`;
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-bootstrap-direct-elevation-forbidden'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-automatic-restart-forbidden'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-set-content-forbidden'));
});

test('desktop bootstrap rejects widened launcher sharing', () => {
  const bad = bootstrapSource.replace('[System.IO.FileShare]::Read', '[System.IO.FileShare]::ReadWrite');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  const codes = result.findings.map((finding) => finding.code);
  assert.ok(codes.includes('forge-wsl2-bootstrap-launcher-lock-missing'));
  assert.ok(codes.includes('forge-wsl2-bootstrap-share-widened'));
});

test('desktop bootstrap requires locked-handoff cleanup', () => {
  const bad = bootstrapSource.replace('  $launcherStream.Dispose()\n  Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue', '');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-launcher-cleanup-missing'));
});

test('desktop bootstrap requires the launcher write through the held handle', () => {
  const bad = bootstrapSource.replace('$launcherStream.Write($launcherBytes, 0, $launcherBytes.Length)', '');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-launcher-write-missing'));
});

test('desktop bootstrap requires the fixed deadline and receipt-readiness wait loop', () => {
  const missingDeadline = bootstrapSource.replace('$deadline = [DateTime]::UtcNow.AddSeconds($LauncherWaitSeconds)', '$deadline = [DateTime]::UtcNow');
  const deadlineResult = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: missingDeadline }));
  assert.equal(deadlineResult.clean, false);
  assert.ok(deadlineResult.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-deadline-missing'
    || finding.code === 'forge-wsl2-bootstrap-bounded-wait-control-flow-missing'));

  const missingWait = bootstrapSource.replace('while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ElevatedReceiptReady)) {', 'while ([DateTime]::UtcNow -lt $deadline) {');
  const waitResult = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: missingWait }));
  assert.equal(waitResult.clean, false);
  assert.ok(waitResult.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-readiness-wait-missing'
    || finding.code === 'forge-wsl2-bootstrap-bounded-wait-control-flow-missing'));
});

test('desktop bootstrap rejects identity-valid but nonterminal receipt readiness', () => {
  const weakTerminal = bootstrapSource.replace(
    "    $terminalResult = ($receipt.ok -eq $true) -or ($receipt.ok -eq $false -and -not [string]::IsNullOrWhiteSpace([string]$receipt.blocker))",
    "    $terminalResult = $true",
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: weakTerminal }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-receipt-readiness-proof-missing'));
});

test('desktop bootstrap receipt readiness is identity-bound and timeout never claims no mutation', () => {
  const weakReceipt = bootstrapSource.replace(" -and $receipt.repository -eq $Repository -and ([string]$receipt.expectedHead).ToLowerInvariant() -eq $ExpectedHead", '');
  const receiptResult = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: weakReceipt }));
  assert.equal(receiptResult.clean, false);
  assert.ok(receiptResult.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-receipt-readiness-proof-missing'));

  const falseTimeout = bootstrapSource.replace('mutationPerformed = $null', 'mutationPerformed = $false');
  const timeoutResult = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: falseTimeout }));
  assert.equal(timeoutResult.clean, false);
  assert.ok(timeoutResult.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-timeout-mutation-unknown-missing'
    || finding.code === 'forge-wsl2-bootstrap-timeout-truth-missing'));
});

test('committed blob lookup and comparison are mandatory inside canonical source proof', () => {
  const bad = bootstrapSource.replace(
    "    if ($committedBlob -notmatch '^[0-9a-f]{40}$' -or $workingBlob -ne $committedBlob) {",
    '    if ($workingBlob) {',
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-committed-blob-compare-missing'));
});

test('generated launcher body is exact and rejects appended commands', () => {
  const bad = bootstrapSource.replace(
    'set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"',
    'set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"\npowershell.exe -Command "Write-Host widened"',
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-launcher-not-closed-world'));
});

test('all fixed executable call sites are closed to the four read-only Git proof commands', () => {
  const bad = bootstrapSource.replace(
    'function Consume-ElevatedReceipt { return $false }',
    "Invoke-Fixed $GitExe @('-C', $RepoRoot, 'reset', '--hard')\nfunction Consume-ElevatedReceipt { return $false }",
  );
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-fixed-invocation-estate-widened'));
});

test('desktop bootstrap caller-selected command authority fails closed', () => {
  const bad = bootstrapSource.replace('[switch]$OperatorApproved', '[switch]$OperatorApproved, [string]$Command');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
  assert.ok(result.findings.some((finding) => finding.code === 'forge-wsl2-bootstrap-caller-authority-forbidden'));
});

test('missing collision refusal fails closed', () => {
  const bad = bootstrapSource.replace("if (Test-Path -LiteralPath $LauncherPath) {\n  Exit-Blocked 'FORGE_WSL2_DESKTOP_LAUNCHER_WRITE_FAILED' @{ reason = 'existing-desktop-path-refused' }\n}", '');
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input({ bootstrap: bad }));
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
