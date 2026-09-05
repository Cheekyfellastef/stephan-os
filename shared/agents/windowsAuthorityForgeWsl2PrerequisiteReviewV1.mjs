import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = Object.freeze([
  'scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1',
]);

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
function requireLiteral(findings, source, literal, code, summary, path) { if (!source.includes(literal)) findings.push(finding(code, summary, path)); }
function requirePattern(findings, source, pattern, code, summary, path) { if (!pattern.test(source)) findings.push(finding(code, summary, path)); }
function forbidPattern(findings, source, pattern, code, summary, path) { if (pattern.test(source)) findings.push(finding(code, summary, path)); }
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path) === WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0]
    ? [WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0]] : [];
}

function reviewPrerequisite(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]", 'forge-wsl2-shouldprocess-missing', 'WSL2 prerequisite mutation must remain high-impact ShouldProcess-gated.'],
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-wsl2-head-not-exact', 'WSL2 prerequisite must bind to one exact source head.'],
    ["[switch]$OperatorApproved", 'forge-wsl2-operator-approval-missing', 'WSL2 prerequisite must require explicit operator approval.'],
    ["[switch]$ElevatedChild", 'forge-wsl2-elevated-child-marker-missing', 'The fixed elevation boundary must be explicit.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-wsl2-repository-not-fixed', 'Repository identity must remain fixed.'],
    ["$GitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'forge-wsl2-git-not-fixed', 'Git identity proof must use the fixed executable.'],
    ["$PowerShellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'forge-wsl2-powershell-not-fixed', 'Elevation must use the fixed Windows PowerShell executable.'],
    ["$DismExe = Join-Path $env:SystemRoot 'System32\\dism.exe'", 'forge-wsl2-dism-not-fixed', 'Optional feature mutation must use the fixed DISM executable.'],
    ["$WslExe = Join-Path $env:SystemRoot 'System32\\wsl.exe'", 'forge-wsl2-wsl-not-fixed', 'WSL configuration must use the fixed WSL executable.'],
    ["$ReceiptPath = Join-Path $env:LOCALAPPDATA 'Stephanos\\forge-wsl2-prerequisite-elevated-v1.json'", 'forge-wsl2-receipt-path-not-fixed', 'Elevated-child handback must use one fixed user-local receipt path.'],
    ["'Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform'", 'forge-wsl2-feature-set-not-fixed', 'The only admitted Windows features must be WSL and VirtualMachinePlatform.'],
    ["@('--update')", 'forge-wsl2-update-not-fixed', 'WSL update must use the fixed update command.'],
    ["@('--set-default-version', '2')", 'forge-wsl2-default-version-not-fixed', 'WSL default version must be fixed to 2.'],
    ["'FORGE_WSL2_REBOOT_REQUIRED'", 'forge-wsl2-reboot-gate-missing', 'Feature enablement must stop at a typed reboot gate.'],
    ["rebootPerformed = $false", 'forge-wsl2-reboot-authority-not-zero', 'This rung must not reboot the host itself.'],
    ["podmanMutation = $false", 'forge-wsl2-podman-authority-not-zero', 'This rung must not mutate Podman.'],
    ["forgeRuntimeMutation = $false", 'forge-wsl2-forge-authority-not-zero', 'This rung must not start or mutate Forge.'],
    ["sourceMutation = $false", 'forge-wsl2-source-authority-not-zero', 'This rung must not mutate source.'],
    ["arbitraryPowerShellAllowed = $false", 'forge-wsl2-arbitrary-powershell-not-zero', 'Arbitrary PowerShell authority must remain denied.'],
    ["callerSelectedArgumentAllowed = $false", 'forge-wsl2-caller-argument-authority-not-zero', 'Caller-selected command arguments must remain denied.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$PowerShellExe\s+-ArgumentList\s+\$arguments\s+-Verb\s+RunAs\s+-Wait\s+-PassThru/, 'forge-wsl2-elevation-not-fixed', 'Elevation may launch only the fixed source-controlled script through fixed Windows PowerShell.', path);
  requirePattern(findings, source, /\$arguments\s*=\s*@\([\s\S]*'-File',\s*\$ScriptPath[\s\S]*'-ExpectedHead',\s*\$ExpectedHead[\s\S]*'-OperatorApproved',\s*'-ElevatedChild'/, 'forge-wsl2-elevation-arguments-not-fixed', 'Elevated child arguments must bind only the fixed script and exact head.', path);
  requirePattern(findings, source, /Assert-CanonicalSource[\s\S]*\$ObservedWsl2Evidence\s*=\s*Get-Wsl2Evidence[\s\S]*if \(-not \$ElevatedChild\)/, 'forge-wsl2-pre-elevation-source-proof-missing', 'Exact canonical source must be proved before elevation.', path);
  requirePattern(findings, source, /foreach \(\$feature in @\('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform'\)\)[\s\S]*Invoke-Fixed \$DismExe @\('\/online', '\/enable-feature', "\/featurename:\$feature", '\/all', '\/norestart'\)/, 'forge-wsl2-feature-invocation-not-fixed', 'DISM may enable only the two exact WSL2 prerequisite features with no restart.', path);
  requirePattern(findings, source, /Assert-CanonicalSource -ToFile[\s\S]*Emit-Receipt \$true 'FORGE_WSL2_PREREQUISITE_READY'/, 'forge-wsl2-post-mutation-source-proof-missing', 'Exact source must be re-proved before a ready receipt.', path);

  const startProcessCount = (source.match(/\bStart-Process\b/g) || []).length;
  if (startProcessCount !== 1) findings.push(finding('forge-wsl2-extra-process-launch-forbidden', 'Exactly one fixed RunAs process launch is allowed.', path));
  const featureNames = [...source.matchAll(/\/featurename:([^'"\s,)]+)/gi)].map((match) => match[1]);
  if (featureNames.some((name) => name !== '$feature')) findings.push(finding('forge-wsl2-nonfixed-feature-forbidden', 'No caller-selected or extra Windows feature name is allowed.', path));

  for (const [pattern, code, summary] of [
    [/Invoke-Expression|ScriptBlock::Create|cmd\.exe|Start-Job|Invoke-Command/i, 'forge-wsl2-dynamic-execution-forbidden', 'Dynamic execution is forbidden.'],
    [/Restart-Computer|shutdown\.exe|Stop-Process/i, 'forge-wsl2-host-control-forbidden', 'This rung must not reboot or kill host processes.'],
    [/Register-ScheduledTask|New-ScheduledTask|schtasks(?:\.exe)?/i, 'forge-wsl2-persistent-elevation-forbidden', 'No persistent elevated task may be created.'],
    [/RunLevel\s+Highest/i, 'forge-wsl2-highest-task-forbidden', 'Scheduled-task elevation is forbidden.'],
    [/podman(?:\.exe)?|forgejo/i, 'forge-wsl2-runtime-mutation-forbidden', 'The WSL2 prerequisite must not touch Podman or Forgejo.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'forge-wsl2-source-mutation-forbidden', 'Git source mutation is forbidden.'],
    [/Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|bitsadmin/i, 'forge-wsl2-caller-network-forbidden', 'The WSL2 feature rung must not add arbitrary download surfaces.'],
    [/-Force\b[^\r\n]*(?:Restart|shutdown)/i, 'forge-wsl2-forced-reboot-forbidden', 'Forced reboot authority is forbidden.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);

  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  if (/\$(?:Url|Uri|Path|Executable|Command|Args|Arguments|Feature|Token|Credential|TaskName)\b/i.test(parameterBlock)) {
    findings.push(finding('forge-wsl2-caller-authority-forbidden', 'Caller-selected URL/path/executable/commands/features/credentials are forbidden.', path));
  }
}

export function analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head source record is required.', path));
  } else {
    reviewPrerequisite(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-forge-wsl2-prerequisite/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([path]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_SPECIALIST_FINDINGS',
  });
}
