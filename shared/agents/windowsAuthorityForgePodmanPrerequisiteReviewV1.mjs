import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1 = Object.freeze([
  'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const INSTALLER_SHA256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';

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
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function requireUniqueAssignment(findings, source, variable, expectedLine, code, summary, path) {
  const pattern = new RegExp(`^\\s*\\$${escapeRegex(variable)}\\s*=`, 'gm');
  const matches = [...source.matchAll(pattern)];
  const exact = source.split(/\r?\n/).filter((line) => line.trim() === expectedLine);
  if (matches.length !== 1 || exact.length !== 1) findings.push(finding(code, summary, path));
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path) === WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0]
    ? [WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0]] : [];
}
function reviewPrerequisite(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]", 'forge-podman-prerequisite-shouldprocess-missing', 'Podman prerequisite mutation must remain high-impact ShouldProcess-gated.'],
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-podman-prerequisite-head-not-exact', 'Podman prerequisite must bind to one exact canonical head.'],
    ["[switch]$OperatorApproved", 'forge-podman-prerequisite-operator-approval-missing', 'Podman prerequisite must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-podman-prerequisite-repository-not-fixed', 'Repository identity must remain fixed.'],
    ["$PodmanVersion = '6.0.2'", 'forge-podman-prerequisite-version-not-fixed', 'Podman version must remain exactly 6.0.2.'],
    ['podman-installer-windows-amd64.msi', 'forge-podman-prerequisite-asset-not-fixed', 'Windows amd64 MSI asset must remain fixed.'],
    [INSTALLER_SHA256, 'forge-podman-prerequisite-digest-not-fixed', 'MSI SHA-256 must remain source-pinned.'],
    ["$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\\Podman\\podman.exe'", 'forge-podman-prerequisite-user-path-not-fixed', 'Podman executable path must remain user-scoped and fixed.'],
    ["$MsiexecExe = Join-Path $env:SystemRoot 'System32\\msiexec.exe'", 'forge-podman-prerequisite-msiexec-not-fixed', 'Windows Installer executable must remain fixed.'],
    ['Get-FileHash -LiteralPath $msiPath -Algorithm SHA256', 'forge-podman-prerequisite-hash-proof-missing', 'MSI must be hash verified.'],
    ['Get-AuthenticodeSignature -LiteralPath $msiPath', 'forge-podman-prerequisite-signature-proof-missing', 'MSI signature must be verified.'],
    ["if ([string]$signature.Status -ne 'Valid')", 'forge-podman-prerequisite-signature-gate-missing', 'Invalid signature must fail closed.'],
    ["'ALLUSERS=2'", 'forge-podman-prerequisite-user-scope-missing', 'Install must remain user scoped.'],
    ["'MSIINSTALLPERUSER=1'", 'forge-podman-prerequisite-per-user-property-missing', 'Per-user installation must be explicit.'],
    ["'/norestart'", 'forge-podman-prerequisite-restart-not-denied', 'Install must remain no-restart.'],
    ['PODMAN_USER_VERSION_NOT_PROVEN', 'forge-podman-prerequisite-version-proof-missing', 'Exact Podman version must be re-proved.'],
    ['CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL', 'forge-podman-prerequisite-source-recheck-missing', 'Canonical source must be re-proved after install.'],
    ["status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'", 'forge-podman-prerequisite-ready-receipt-missing', 'Only bounded prerequisite-ready success is allowed.'],
    ['machineMutation = $false', 'forge-podman-prerequisite-machine-authority-not-zero', 'Machine mutation must be denied.'],
    ['containerMutation = $false', 'forge-podman-prerequisite-container-authority-not-zero', 'Container mutation must be denied.'],
    ['imagePull = $false', 'forge-podman-prerequisite-image-pull-authority-not-zero', 'Image pulls must be denied.'],
    ['githubCredentialUsed = $false', 'forge-podman-prerequisite-github-credential-not-zero', 'GitHub credentials must not be used.'],
    ['arbitraryPowerShellAllowed = $false', 'forge-podman-prerequisite-powershell-authority-not-zero', 'Arbitrary PowerShell authority must be denied.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [variable, expectedLine, code, summary] of [
    ['Repository', "$Repository = 'Cheekyfellastef/stephan-os'", 'forge-podman-prerequisite-repository-assignment-not-unique', 'Repository assignment must be unique and immutable.'],
    ['PodmanVersion', "$PodmanVersion = '6.0.2'", 'forge-podman-prerequisite-version-assignment-not-unique', 'Podman version assignment must be unique and immutable.'],
    ['WindowsHostAdapter', "$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'", 'forge-podman-prerequisite-host-adapter-assignment-not-unique', 'Windows host adapter assignment must be unique and immutable.'],
    ['MinimumWindowsBuild', '$MinimumWindowsBuild = 19043', 'forge-podman-prerequisite-build-floor-assignment-not-unique', 'Windows build floor must be assigned exactly once to 19043.'],
    ['MaximumWindowsBuildExclusive', '$MaximumWindowsBuildExclusive = 22000', 'forge-podman-prerequisite-build-ceiling-assignment-not-unique', 'Windows build ceiling must be assigned exactly once to 22000 exclusive.'],
    ['RequiredWindowsArchitecture', "$RequiredWindowsArchitecture = 'X64'", 'forge-podman-prerequisite-architecture-assignment-not-unique', 'Windows architecture must be assigned exactly once to X64.'],
    ['InstallerUrl', "$InstallerUrl = 'https://github.com/podman-container-tools/podman/releases/download/v6.0.2/podman-installer-windows-amd64.msi'", 'forge-podman-prerequisite-installer-url-assignment-not-unique', 'Installer URL assignment must remain one fixed official asset.'],
    ['InstallerSha256', `$InstallerSha256 = '${INSTALLER_SHA256}'`, 'forge-podman-prerequisite-installer-digest-assignment-not-unique', 'Installer digest assignment must remain unique and fixed.'],
  ]) requireUniqueAssignment(findings, source, variable, expectedLine, code, summary, path);

  for (const [pattern, code, summary] of [
    [/\$ObservedWindowsInstallationType\s+-ne\s+'Client'[\s\S]*\$ObservedWindowsProductName\s+-notmatch\s+'\^Windows 10/, 'forge-podman-prerequisite-windows10-client-gate-missing', 'Windows host must prove Windows 10 client identity.'],
    [/\$ObservedWindowsArchitecture\s+-ne\s+\$RequiredWindowsArchitecture/, 'forge-podman-prerequisite-x64-gate-missing', 'Windows host must prove X64 architecture.'],
    [/\$ObservedWindowsBuild\s+-lt\s+\$MinimumWindowsBuild/, 'forge-podman-prerequisite-build-floor-gate-missing', 'Windows build floor must be enforced.'],
    [/\$ObservedWindowsBuild\s+-ge\s+\$MaximumWindowsBuildExclusive/, 'forge-podman-prerequisite-build-ceiling-gate-missing', 'Windows 11 build range must be excluded from the Windows 10 adapter.'],
    [/function\s+Get-Wsl2Evidence[\s\S]*@\('--status'\)[\s\S]*Default Version:[\\s\*]*2[\s\S]*@\('--list',\s*'--verbose'\)[\s\S]*distribution-version-2/, 'forge-podman-prerequisite-wsl2-proof-missing', 'WSL2 must be proved from parsed version-2 evidence.'],
    [/\$ObservedWsl2Evidence\s*=\s*Get-Wsl2Evidence[\s\S]*if\s*\(-not\s+\$ObservedWsl2Evidence\)\s*\{\s*Emit-Blocked\s+'WSL2_NOT_AVAILABLE'/, 'forge-podman-prerequisite-wsl2-gate-missing', 'Missing WSL2 evidence must fail closed before prerequisite readiness.'],
    [/Start-Process\s+-FilePath\s+\$MsiexecExe\s+-ArgumentList\s+@\([\s\S]*'\/i',\s*\$msiPath[\s\S]*'\/qn'[\s\S]*'\/norestart'[\s\S]*'ALLUSERS=2'[\s\S]*'MSIINSTALLPERUSER=1'/, 'forge-podman-prerequisite-msi-invocation-not-fixed', 'Only the fixed quiet per-user MSI invocation is allowed.'],
    [/finally\s*\{[\s\S]*Remove-Item -LiteralPath \$msiPath[\s\S]*Remove-Item -LiteralPath \$tempRoot/, 'forge-podman-prerequisite-temp-cleanup-missing', 'Downloaded material must be cleaned in finally.'],
  ]) requirePattern(findings, source, pattern, code, summary, path);

  for (const [pattern, code, summary] of [
    [/Invoke-Expression|ScriptBlock::Create|cmd\.exe|Start-Job/i, 'forge-podman-prerequisite-dynamic-execution-forbidden', 'Dynamic execution is forbidden.'],
    [/RunLevel\s+Highest|Start-Process[^\r\n]*-Verb\s+RunAs/i, 'forge-podman-prerequisite-elevation-forbidden', 'Elevation is forbidden.'],
    [/Restart-Computer|shutdown\.exe/i, 'forge-podman-prerequisite-restart-forbidden', 'Host restart is forbidden.'],
    [/@\('machine',\s*'(?:init|start)'|@\('pull'/i, 'forge-podman-prerequisite-forge-mutation-forbidden', 'Machine start/init and image pulls are forbidden.'],
    [/Get-Command\s+podman/i, 'forge-podman-prerequisite-path-resolution-forbidden', 'PATH Podman resolution is forbidden.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i, 'forge-podman-prerequisite-source-mutation-forbidden', 'Git source mutation is forbidden.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  if (/\$(?:Url|Uri|Path|Executable|Command|Args|Token|Credential)\b/i.test(parameterBlock)) findings.push(finding('forge-podman-prerequisite-caller-authority-forbidden', 'Caller-selected URL/path/executable/commands/credentials are forbidden.', path));
}
export function analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_NOT_ELIGIBLE' });
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = []; const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head source record is required.', path));
  else { reviewPrerequisite(candidates[0].content, path, findings); proofRefs.push(`proofs/windows-authority-forge-podman-prerequisite/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`); }
  const clean = findings.length === 0;
  return Object.freeze({ eligible: true, clean, findings: Object.freeze(findings), reviewedPaths: Object.freeze([path]), proofRefs: Object.freeze(proofRefs), finalVerdict: clean ? 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_FINDINGS' });
}
