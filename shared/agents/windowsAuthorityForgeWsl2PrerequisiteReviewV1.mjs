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
  const path = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path) === path ? [path] : [];
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
    ["'-Verb', 'RunAs'", 'forge-wsl2-fixed-elevation-missing', 'The only reviewed elevation seam must remain the exact source-controlled self-elevation path.'],
    ["'--update'", 'forge-wsl2-update-not-fixed', 'WSL update must remain fixed.'],
    ["'--set-default-version', '2'", 'forge-wsl2-default-version-not-fixed', 'Default WSL version must remain fixed to 2.'],
    ["blocker = 'FORGE_WSL2_REBOOT_REQUIRED'", 'forge-wsl2-reboot-blocker-missing', 'A required reboot must be returned as a blocker rather than performed.'],
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

  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$PowerShellExe[\s\S]*-ArgumentList\s+\$elevationArguments[\s\S]*-Verb\s+RunAs/, 'forge-wsl2-elevation-not-source-bound', 'Elevation must invoke only fixed PowerShell with the fixed source-controlled self-elevation argument set.', path);
  requirePattern(findings, source, /&\s+\$DismExe\s+@\(\s*'\/online',[\s\S]*"\/featurename:\$Feature"[\s\S]*'\/norestart'/, 'forge-wsl2-dism-invocation-not-fixed', 'DISM must be restricted to the admitted feature set with no restart.', path);

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

export function analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head WSL2 source record is required.', path));
  } else {
    reviewWsl2Prerequisite(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-forge-wsl2/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([path]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_FINDINGS',
  });
}
