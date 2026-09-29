import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = Object.freeze([
  'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1',
  'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1',
]);

const ELEVATION_PATH = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];
const DESKTOP_BOOTSTRAP_PATH = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[1];
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;

function text(value) { return String(value ?? '').trim(); }
function finding(code, summary, path) { return Object.freeze({ severity: 'P0', code, summary, path }); }
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA && source.repository === repository
    && source.path === path && source.ref === sourceHead && source.exists === true
    && Number.isSafeInteger(source.size) && source.size === bytes && source.size > 0 && source.size <= MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha)) && source.blobSha === gitBlobSha(content));
}
function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(finding(code, summary, path));
}
function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}
function occurrences(source, literal) {
  if (!literal) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(literal, offset)) !== -1) {
    count += 1;
    offset += literal.length;
  }
  return count;
}
function sectionBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = source.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? '' : source.slice(startIndex, endIndex);
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  const path = text(item?.path);
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1.includes(path)
    ? [...WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1]
    : [];
}

function reviewWsl2Prerequisite(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]", 'forge-wsl2-shouldprocess-missing', 'WSL2 prerequisite must remain high-impact ShouldProcess-gated.'],
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-wsl2-head-not-exact', 'WSL2 prerequisite must bind one exact canonical head.'],
    ["[switch]$OperatorApproved", 'forge-wsl2-operator-approval-missing', 'WSL2 prerequisite must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-wsl2-repository-not-fixed', 'Repository identity must remain fixed.'],
    ["$RequiredFeatures = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')", 'forge-wsl2-feature-set-not-fixed', 'Only the two reviewed Windows features may be enabled.'],
    ["$PowerShellExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'forge-wsl2-powershell-not-fixed', 'Elevation host must remain fixed Windows PowerShell.'],
    ["$DismExe = Join-Path $env:SystemRoot 'System32\\dism.exe'", 'forge-wsl2-dism-not-fixed', 'Windows feature mutation must remain bound to fixed DISM.'],
    ["$WslExe = Join-Path $env:SystemRoot 'System32\\wsl.exe'", 'forge-wsl2-wsl-not-fixed', 'WSL executable must remain fixed.'],
    ["'--update'", 'forge-wsl2-update-not-fixed', 'WSL update must remain fixed.'],
    ["'--set-default-version', '2'", 'forge-wsl2-default-version-not-fixed', 'Default WSL version must remain fixed to 2.'],
    ["Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_REBOOT_REQUIRED'", 'forge-wsl2-reboot-blocker-missing', 'A required reboot must be returned as a blocker rather than performed.'],
    ['rebootPerformed = $false', 'forge-wsl2-reboot-authority-not-zero', 'The WSL prerequisite must not reboot the remote host itself.'],
    ['podmanMutation = $false', 'forge-wsl2-podman-authority-not-zero', 'WSL feature admission must not mutate Podman.'],
    ['forgeRuntimeMutation = $false', 'forge-wsl2-forge-authority-not-zero', 'WSL feature admission must not mutate Forge runtime.'],
    ['sourceMutation = $false', 'forge-wsl2-source-authority-not-zero', 'WSL feature admission must not mutate repository source.'],
    ['arbitraryShellAllowed = $false', 'forge-wsl2-shell-authority-not-zero', 'Arbitrary shell must remain denied.'],
    ['arbitraryPowerShellAllowed = $false', 'forge-wsl2-powershell-authority-not-zero', 'Arbitrary PowerShell must remain denied.'],
    ['callerSelectedPathAllowed = $false', 'forge-wsl2-caller-path-authority-not-zero', 'Caller-selected paths must remain denied.'],
    ['callerSelectedExecutableAllowed = $false', 'forge-wsl2-caller-executable-authority-not-zero', 'Caller-selected executables must remain denied.'],
    ['callerSelectedArgumentAllowed = $false', 'forge-wsl2-caller-argument-authority-not-zero', 'Caller-selected arguments must remain denied.'],
    ['githubCredentialUsed = $false', 'forge-wsl2-github-credential-not-zero', 'GitHub credentials must not be consumed.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$PowerShellExe[\s\S]*-ArgumentList\s+\$arguments[\s\S]*-Verb\s+RunAs/, 'forge-wsl2-elevation-not-source-bound', 'Elevation must invoke only fixed PowerShell with the fixed source-controlled self-elevation argument set.', path);
  requirePattern(findings, source, /Invoke-Fixed\s+\$DismExe\s+@\(\s*'\/online',\s*'\/enable-feature',\s*"\/featurename:\$Feature",\s*'\/all',\s*'\/norestart'\s*\)\s+-AllowFailure/, 'forge-wsl2-dism-invocation-not-fixed', 'DISM must be restricted to the admitted feature set with no restart.', path);
  requirePattern(findings, source, /\$receiptTempPath\s*=\s*Join-Path\s+\$directory[\s\S]*\[System\.IO\.File\]::WriteAllText\(\$receiptTempPath,[\s\S]*Move-Item\s+-LiteralPath\s+\$receiptTempPath\s+-Destination\s+\$ReceiptPath\s+-Force[\s\S]*finally\s*\{[\s\S]*Remove-Item\s+-LiteralPath\s+\$receiptTempPath\s+-Force\s+-ErrorAction\s+SilentlyContinue/m, 'forge-wsl2-receipt-atomic-publication-missing', 'Elevated receipts must be fully written to a same-directory temporary file and atomically published before the desktop bootstrap may consume them.', path);
  forbidPattern(findings, source, /Set-Content\s+-LiteralPath\s+\$ReceiptPath/i, 'forge-wsl2-receipt-direct-publication-forbidden', 'Elevated receipts must not become visible at the canonical path before their JSON write is complete.', path);

  for (const [pattern, code, summary] of [
    [/Invoke-Expression|ScriptBlock::Create|Start-Job|Invoke-Command/i, 'forge-wsl2-dynamic-execution-forbidden', 'Dynamic execution remains forbidden.'],
    [/Restart-Computer|shutdown\.exe|Restart-Service|Stop-Computer/i, 'forge-wsl2-automatic-restart-forbidden', 'The remote host must not be restarted by this rung.'],
    [/\bpodman(?:\.exe)?\b|forgejo/i, 'forge-wsl2-forge-mutation-forbidden', 'Podman and Forge mutation are outside the WSL2 admission rung.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'forge-wsl2-source-mutation-forbidden', 'Git source mutation remains forbidden.'],
    [/Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|wget(?:\.exe)?/i, 'forge-wsl2-network-authority-forbidden', 'The WSL2 rung must not gain caller-independent download/network authority beyond fixed wsl.exe servicing.'],
    [/Register-ScheduledTask|New-ScheduledTask|schtasks(?:\.exe)?/i, 'forge-wsl2-task-authority-forbidden', 'Scheduled-task construction is outside this rung.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);

  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  if (/\$(?:Url|Uri|Path|Executable|Command|Args|Arguments|Feature|Token|Credential)\b/i.test(parameterBlock)) {
    findings.push(finding('forge-wsl2-caller-authority-forbidden', 'Caller-selected feature/path/executable/command/network/credential inputs are forbidden.', path));
  }
}

const EXPECTED_BOOTSTRAP_GIT_CALLS = Object.freeze([
  "$branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()",
  "$head = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()",
  "$committedBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', \"$ExpectedHead`:$($entry.Relative)\")).Output -join '').Trim().ToLowerInvariant()",
  "$workingBlob = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'hash-object', \"--path=$($entry.Relative)\", $entry.Path)).Output -join '').Trim().ToLowerInvariant()",
]);
const EXPECTED_BOOTSTRAP_BLOB_COMPARISON = "if ($committedBlob -notmatch '^[0-9a-f]{40}$' -or $workingBlob -ne $committedBlob) {";
const EXPECTED_LAUNCHER_BODY = [
  '@echo off',
  '"$PowerShellExe" -NoProfile -ExecutionPolicy Bypass -File "$ElevationScriptPath" -ExpectedHead $ExpectedHead -OperatorApproved -VisibleElevationBroker',
  'set "STEPHANOS_FORGE_EXIT=%ERRORLEVEL%"',
  'exit /b %STEPHANOS_FORGE_EXIT%',
].join('\n');

function reviewWsl2DesktopBootstrap(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-wsl2-bootstrap-head-not-exact', 'Desktop bootstrap must bind one exact canonical head.'],
    ["[switch]$OperatorApproved", 'forge-wsl2-bootstrap-operator-approval-missing', 'Desktop bootstrap must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-wsl2-bootstrap-repository-not-fixed', 'Desktop bootstrap repository identity must remain fixed.'],
    ["$WrapperRelativePath = 'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1'", 'forge-wsl2-bootstrap-self-path-not-fixed', 'Desktop bootstrap must verify its own fixed source path.'],
    ["$ElevationScriptRelativePath = 'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1'", 'forge-wsl2-bootstrap-elevation-path-not-fixed', 'Desktop bootstrap may delegate only to the reviewed elevation script.'],
    ["$GitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'forge-wsl2-bootstrap-git-not-fixed', 'Desktop bootstrap source proof must use the fixed Git executable.'],
    ["$PowerShellExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'forge-wsl2-bootstrap-powershell-not-fixed', 'Desktop launcher must use fixed Windows PowerShell.'],
    ["$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\\forge-wsl2-prerequisite-elevated-v1.json'", 'forge-wsl2-bootstrap-receipt-not-fixed', 'Desktop bootstrap must consume only the fixed elevated receipt.'],
    ["$DesktopPath = [Environment]::GetFolderPath('Desktop')", 'forge-wsl2-bootstrap-desktop-not-fixed', 'Launcher must target the signed-in operator desktop.'],
    ["$LauncherName = 'Stephanos Forge WSL2 Bootstrap.cmd'", 'forge-wsl2-bootstrap-launcher-name-not-fixed', 'Launcher name must remain fixed.'],
    ["Exit-Blocked 'WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH'", 'forge-wsl2-bootstrap-source-fail-closed-missing', 'Source identity mismatch must fail closed.'],
    ["if (Test-Path -LiteralPath $LauncherPath)", 'forge-wsl2-bootstrap-collision-guard-missing', 'Desktop launcher creation must refuse an existing path.'],
    ["reason = 'existing-desktop-path-refused'", 'forge-wsl2-bootstrap-collision-reason-missing', 'Existing desktop path refusal must be explicit.'],
    ["$LauncherWaitSeconds = 600", 'forge-wsl2-bootstrap-wait-not-bounded', 'Desktop handoff wait must remain fixed and bounded.'],
    ["[System.IO.FileMode]::CreateNew", 'forge-wsl2-bootstrap-create-new-missing', 'Launcher creation must refuse replacement races by using CreateNew.'],
    ["[System.IO.FileAccess]::ReadWrite", 'forge-wsl2-bootstrap-lock-access-missing', 'Launcher lock must retain the originating handle through the operator window.'],
    ["[System.IO.FileShare]::Read", 'forge-wsl2-bootstrap-share-lock-missing', 'Launcher must remain readable but not writable, renameable or replaceable during the operator window.'],
    ["$launcherStream.Write($launcherBytes, 0, $launcherBytes.Length)", 'forge-wsl2-bootstrap-launcher-write-missing', 'The exact reviewed launcher bytes must be written through the locked originating handle.'],
    ["$launcherStream.Flush($true)", 'forge-wsl2-bootstrap-flush-missing', 'Launcher bytes must be durably flushed before operator execution.'],
    ["$deadline = [DateTime]::UtcNow.AddSeconds($LauncherWaitSeconds)", 'forge-wsl2-bootstrap-deadline-missing', 'The operator window must derive from the fixed bounded wait.'],
    ["while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ElevatedReceiptReady))", 'forge-wsl2-bootstrap-readiness-wait-missing', 'The locked operator window must wait for a complete identity-valid receipt rather than file existence.'],
    ["Start-Sleep -Milliseconds 500", 'forge-wsl2-bootstrap-readiness-poll-missing', 'Receipt readiness polling must remain bounded and non-busy.'],
    ["if (-not (Test-ElevatedReceiptReady))", 'forge-wsl2-bootstrap-timeout-readiness-recheck-missing', 'Timeout must recheck complete receipt readiness before reporting an unknown mutation state.'],
    ["mutationPerformed = $null", 'forge-wsl2-bootstrap-timeout-mutation-unknown-missing', 'Timeout may not falsely report that no Windows mutation occurred.'],
    ["mutationState = 'UNKNOWN_OR_IN_PROGRESS'", 'forge-wsl2-bootstrap-timeout-state-missing', 'Timeout must explicitly preserve unknown or in-progress mutation truth.'],
    ["Emit-Receipt $false 'BLOCKED' 'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_TIMEOUT'", 'forge-wsl2-bootstrap-timeout-blocker-missing', 'Expired operator windows must fail closed and remove the launcher.'],
    ['rebootPerformed = $false', 'forge-wsl2-bootstrap-reboot-authority-not-zero', 'Desktop bootstrap must not reboot the host.'],
    ['podmanMutation = $false', 'forge-wsl2-bootstrap-podman-authority-not-zero', 'Desktop bootstrap must not mutate Podman.'],
    ['forgeRuntimeMutation = $false', 'forge-wsl2-bootstrap-forge-authority-not-zero', 'Desktop bootstrap must not mutate Forge runtime.'],
    ['sourceMutation = $false', 'forge-wsl2-bootstrap-source-authority-not-zero', 'Desktop bootstrap must not mutate repository source.'],
    ['githubCredentialUsed = $false', 'forge-wsl2-bootstrap-github-credential-not-zero', 'Desktop bootstrap must not consume GitHub credentials.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  const sourceProof = sectionBetween(source, 'function Assert-CanonicalSource {', 'function Consume-ElevatedReceipt {');
  if (!sourceProof) {
    findings.push(finding('forge-wsl2-bootstrap-source-proof-structure-missing', 'Canonical source proof must remain a dedicated fail-closed function.', path));
  } else {
    for (const call of EXPECTED_BOOTSTRAP_GIT_CALLS) {
      if (occurrences(sourceProof, call) !== 1) {
        findings.push(finding('forge-wsl2-bootstrap-git-proof-call-mismatch', 'Canonical source proof must contain each exact read-only Git call exactly once.', path));
        break;
      }
    }
    if (occurrences(sourceProof, EXPECTED_BOOTSTRAP_BLOB_COMPARISON) !== 1) {
      findings.push(finding('forge-wsl2-bootstrap-committed-blob-compare-missing', 'Working blobs must be compared fail-closed against the exact committed blobs from ExpectedHead.', path));
    }
  }

  const fixedInvocationLines = source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('Invoke-Fixed $') && !line.startsWith('function '));
  if (fixedInvocationLines.length !== EXPECTED_BOOTSTRAP_GIT_CALLS.length
      || fixedInvocationLines.some((line, index) => line !== EXPECTED_BOOTSTRAP_GIT_CALLS[index])) {
    findings.push(finding('forge-wsl2-bootstrap-fixed-invocation-estate-widened', 'Desktop bootstrap external execution is limited to the four exact read-only Git proof calls.', path));
  }

  const launcherMatches = [...source.matchAll(/\$launcher = @"\r?\n([\s\S]*?)\r?\n"@/g)];
  const launcherBody = launcherMatches.length === 1 ? launcherMatches[0][1].replace(/\r\n/g, '\n') : '';
  if (launcherMatches.length !== 1 || launcherBody !== EXPECTED_LAUNCHER_BODY) {
    findings.push(finding('forge-wsl2-bootstrap-launcher-not-closed-world', 'Generated launcher body must match the exact five-line reviewed command body.', path));
  }

  requirePattern(findings, source, /\[System\.IO\.FileStream\]::new\(\s*\$LauncherPath,\s*\[System\.IO\.FileMode\]::CreateNew,\s*\[System\.IO\.FileAccess\]::ReadWrite,\s*\[System\.IO\.FileShare\]::Read\s*\)/m, 'forge-wsl2-bootstrap-launcher-lock-missing', 'Launcher must be created once and held open read-only to other processes throughout the bounded operator window.', path);
  requirePattern(findings, source, /function\s+Test-ElevatedReceiptReady\s*\{[\s\S]*Get-Content\s+-LiteralPath\s+\$ReceiptPath\s+-Raw\s+-Encoding\s+UTF8[\s\S]*ConvertFrom-Json\s+-ErrorAction\s+Stop[\s\S]*\$identityValid\s*=[\s\S]*schemaVersion\s+-eq\s+'stephanos\.forge-wsl2-prerequisite-receipt\.v1'[\s\S]*repository\s+-eq\s+\$Repository[\s\S]*expectedHead\)\.ToLowerInvariant\(\)\s+-eq\s+\$ExpectedHead[\s\S]*\$terminalResult\s*=\s*\(\$receipt\.ok\s+-eq\s+\$true\)[\s\S]*\$receipt\.ok\s+-eq\s+\$false[\s\S]*\$receipt\.blocker[\s\S]*return\s+\$identityValid\s+-and\s+\$terminalResult[\s\S]*\$receipt\.status[\s\S]*return\s+\$false[\s\S]*\}/m, 'forge-wsl2-bootstrap-receipt-readiness-proof-missing', 'Receipt readiness must require complete parseable JSON bound to the exact schema, repository and head and a terminal success or blocker result before the operator wait can finish.', path);
  requirePattern(findings, source, /\$launcherStream\.Write\(\$launcherBytes,\s*0,\s*\$launcherBytes\.Length\)[\s\S]*\$launcherStream\.Flush\(\$true\)[\s\S]*\$deadline\s*=\s*\[DateTime\]::UtcNow\.AddSeconds\(\$LauncherWaitSeconds\)[\s\S]*while\s*\(\[DateTime\]::UtcNow\s+-lt\s+\$deadline\s+-and\s+-not\s+\(Test-ElevatedReceiptReady\)\)[\s\S]*Start-Sleep\s+-Milliseconds\s+500/m, 'forge-wsl2-bootstrap-bounded-wait-control-flow-missing', 'The locked handle must write and flush the launcher before a real fixed deadline loop waits on complete receipt readiness.', path);
  requirePattern(findings, source, /if\s*\(-not\s+\(Test-ElevatedReceiptReady\)\)\s*\{[\s\S]*FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_TIMEOUT[\s\S]*mutationPerformed\s*=\s*\$null[\s\S]*mutationState\s*=\s*'UNKNOWN_OR_IN_PROGRESS'/m, 'forge-wsl2-bootstrap-timeout-truth-missing', 'Timeout must preserve unknown or in-progress mutation truth instead of asserting no mutation.', path);
  requirePattern(findings, source, /finally\s*\{[\s\S]*\$launcherStream\.Dispose\(\)[\s\S]*Remove-Item\s+-LiteralPath\s+\$LauncherPath\s+-Force\s+-ErrorAction\s+SilentlyContinue[\s\S]*\}/m, 'forge-wsl2-bootstrap-launcher-cleanup-missing', 'The lock must be released and the one-shot launcher removed in a finally block.', path);

  for (const [pattern, code, summary] of [
    [/Start-Process|\b-Verb\s+RunAs\b/i, 'forge-wsl2-bootstrap-direct-elevation-forbidden', 'Headless desktop bootstrap must not request elevation itself.'],
    [/Restart-Computer|shutdown\.exe|Restart-Service|Stop-Computer/i, 'forge-wsl2-bootstrap-automatic-restart-forbidden', 'Desktop bootstrap must not restart the host.'],
    [/\bdism(?:\.exe)?\b|\bwsl(?:\.exe)?\b|\bpodman(?:\.exe)?\b|forgejo/i, 'forge-wsl2-bootstrap-runtime-mutation-forbidden', 'Desktop bootstrap must not perform WSL, Podman or Forge runtime mutation itself.'],
    [/Invoke-Expression|ScriptBlock::Create|Start-Job|Invoke-Command/i, 'forge-wsl2-bootstrap-dynamic-execution-forbidden', 'Dynamic execution remains forbidden in the desktop bootstrap.'],
    [/Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|wget(?:\.exe)?/i, 'forge-wsl2-bootstrap-network-authority-forbidden', 'Desktop bootstrap must not gain network authority.'],
    [/Register-ScheduledTask|New-ScheduledTask|schtasks(?:\.exe)?/i, 'forge-wsl2-bootstrap-task-authority-forbidden', 'Desktop bootstrap must not create standing privileged tasks.'],
    [/Emit-Receipt[\s\S]{0,240}FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED/i, 'forge-wsl2-bootstrap-nonterminal-stdout-receipt-forbidden', 'Desktop bootstrap must keep interim launcher state off the receipt stdout channel so the caller receives exactly one terminal JSON document.'],
    [/Set-Content\s+-LiteralPath\s+\$LauncherPath/i, 'forge-wsl2-bootstrap-set-content-forbidden', 'Desktop bootstrap must not use a close-after-write launcher path that can be replaced before operator execution.'],
    [/FileShare\]::(?:Write|ReadWrite|Delete)/i, 'forge-wsl2-bootstrap-share-widened', 'Launcher sharing must never permit write or delete/rename during the operator window.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);

  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  if (/\$(?:Url|Uri|Path|Executable|Command|Args|Arguments|Feature|Token|Credential)\b/i.test(parameterBlock)) {
    findings.push(finding('forge-wsl2-bootstrap-caller-authority-forbidden', 'Caller-selected feature/path/executable/command/network/credential inputs are forbidden.', path));
  }
}

export function analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead)
    || paths.length !== WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1.length) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_NOT_ELIGIBLE' });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  const byPath = new Map();
  for (const path of paths) {
    const candidates = sources.filter((source) => source?.path === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', `Exactly one immutable exact-head source record is required for ${path}.`, path));
    } else {
      byPath.set(path, candidates[0]);
    }
  }
  if (sources.length !== paths.length) {
    findings.push(finding('windows-authority-source-estate-widened', 'The Forge WSL2 specialist source estate must contain exactly the two reviewed files.', DESKTOP_BOOTSTRAP_PATH));
  }

  if (byPath.has(ELEVATION_PATH)) {
    const source = byPath.get(ELEVATION_PATH);
    reviewWsl2Prerequisite(source.content, ELEVATION_PATH, findings);
    proofRefs.push(`proofs/windows-authority-forge-wsl2/${ELEVATION_PATH}@${sourceHead}#${source.blobSha}:${source.size}`);
  }
  if (byPath.has(DESKTOP_BOOTSTRAP_PATH)) {
    const source = byPath.get(DESKTOP_BOOTSTRAP_PATH);
    reviewWsl2DesktopBootstrap(source.content, DESKTOP_BOOTSTRAP_PATH, findings);
    proofRefs.push(`proofs/windows-authority-forge-wsl2/${DESKTOP_BOOTSTRAP_PATH}@${sourceHead}#${source.blobSha}:${source.size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze(paths),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_FINDINGS',
  });
}
