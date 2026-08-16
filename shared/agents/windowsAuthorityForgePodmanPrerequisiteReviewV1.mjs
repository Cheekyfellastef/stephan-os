import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1 = Object.freeze([
  'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const INSTALLER_SHA256 = 'c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f';

function text(value) {
  return String(value ?? '').trim();
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && source.size > 0
    && source.size <= MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
  );
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

function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  if (
    text(item?.severity).toUpperCase() !== 'P0'
    || text(item?.code) !== 'unsupported-high-risk-surface'
    || text(item?.path) !== WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0]
  ) return [];
  return [WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0]];
}

function reviewPrerequisite(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]", 'forge-podman-prerequisite-shouldprocess-missing', 'Podman prerequisite mutation must remain high-impact ShouldProcess-gated.'],
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-podman-prerequisite-head-not-exact', 'Podman prerequisite must bind to one exact canonical head.'],
    ["[switch]$OperatorApproved", 'forge-podman-prerequisite-operator-approval-missing', 'Podman prerequisite must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-podman-prerequisite-repository-not-fixed', 'Podman prerequisite repository identity must remain fixed.'],
    ["$PodmanVersion = '6.0.2'", 'forge-podman-prerequisite-version-not-fixed', 'Podman prerequisite version must remain exactly 6.0.2.'],
    ["podman-installer-windows-amd64.msi", 'forge-podman-prerequisite-asset-not-fixed', 'Podman prerequisite must use the fixed Windows amd64 MSI asset.'],
    [INSTALLER_SHA256, 'forge-podman-prerequisite-digest-not-fixed', 'Podman prerequisite MSI SHA-256 must remain source-pinned.'],
    ["$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\\Podman\\podman.exe'", 'forge-podman-prerequisite-user-path-not-fixed', 'Podman prerequisite executable path must remain user-scoped and fixed.'],
    ["$MsiexecExe = Join-Path $env:SystemRoot 'System32\\msiexec.exe'", 'forge-podman-prerequisite-msiexec-not-fixed', 'Podman prerequisite must invoke only the canonical Windows Installer executable.'],
    ["Get-FileHash -LiteralPath $msiPath -Algorithm SHA256", 'forge-podman-prerequisite-hash-proof-missing', 'Downloaded MSI must be fully hash verified before execution.'],
    ["Get-AuthenticodeSignature -LiteralPath $msiPath", 'forge-podman-prerequisite-signature-proof-missing', 'Downloaded MSI must have its Authenticode signature verified.'],
    ["if ([string]$signature.Status -ne 'Valid')", 'forge-podman-prerequisite-signature-gate-missing', 'Invalid Authenticode status must fail closed.'],
    ["'ALLUSERS=2'", 'forge-podman-prerequisite-user-scope-missing', 'MSI installation must remain user scoped.'],
    ["'MSIINSTALLPERUSER=1'", 'forge-podman-prerequisite-per-user-property-missing', 'MSI installation must explicitly request per-user installation.'],
    ["'/norestart'", 'forge-podman-prerequisite-restart-not-denied', 'Podman prerequisite installation must remain no-restart.'],
    ["PODMAN_USER_VERSION_NOT_PROVEN", 'forge-podman-prerequisite-version-proof-missing', 'Exact Podman 6.0.2 must be re-proved after installation.'],
    ["CANONICAL_REPOSITORY_CHANGED_DURING_PREREQUISITE_INSTALL", 'forge-podman-prerequisite-source-recheck-missing', 'Canonical source identity must be re-proved after prerequisite installation.'],
    ["status = 'FORGE_SHADOW_PODMAN_PREREQUISITE_READY'", 'forge-podman-prerequisite-ready-receipt-missing', 'Prerequisite success must emit only its bounded ready receipt.'],
    ["machineMutation = $false", 'forge-podman-prerequisite-machine-authority-not-zero', 'Prerequisite receipt must deny Podman machine mutation.'],
    ["containerMutation = $false", 'forge-podman-prerequisite-container-authority-not-zero', 'Prerequisite receipt must deny container mutation.'],
    ["imagePull = $false", 'forge-podman-prerequisite-image-pull-authority-not-zero', 'Prerequisite receipt must deny image pulls.'],
    ["githubCredentialUsed = $false", 'forge-podman-prerequisite-github-credential-not-zero', 'Prerequisite must not use GitHub credentials.'],
    ["arbitraryPowerShellAllowed = $false", 'forge-podman-prerequisite-powershell-authority-not-zero', 'Prerequisite must deny arbitrary PowerShell authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$MsiexecExe\s+-ArgumentList\s+@\([\s\S]*'\/i',\s*\$msiPath[\s\S]*'\/qn'[\s\S]*'\/norestart'[\s\S]*'ALLUSERS=2'[\s\S]*'MSIINSTALLPERUSER=1'/, 'forge-podman-prerequisite-msi-invocation-not-fixed', 'Podman prerequisite must use only the fixed quiet per-user MSI invocation.', path);
  requirePattern(findings, source, /finally\s*\{[\s\S]*Remove-Item -LiteralPath \$msiPath[\s\S]*Remove-Item -LiteralPath \$tempRoot/, 'forge-podman-prerequisite-temp-cleanup-missing', 'Downloaded prerequisite material must be cleaned in a finally path.', path);

  for (const [pattern, code, summary] of [
    [/Invoke-Expression|ScriptBlock::Create|cmd\.exe|Start-Job/i, 'forge-podman-prerequisite-dynamic-execution-forbidden', 'Podman prerequisite must not gain dynamic execution authority.'],
    [/RunLevel\s+Highest|Start-Process[^\r\n]*-Verb\s+RunAs/i, 'forge-podman-prerequisite-elevation-forbidden', 'Podman prerequisite must not request elevation.'],
    [/Restart-Computer|shutdown\.exe/i, 'forge-podman-prerequisite-restart-forbidden', 'Podman prerequisite must not restart the host.'],
    [/@\('machine',\s*'(?:init|start)'|@\('pull'/i, 'forge-podman-prerequisite-forge-mutation-forbidden', 'Prerequisite-only execution must not initialize/start Podman machines or pull images.'],
    [/Get-Command\s+podman/i, 'forge-podman-prerequisite-path-resolution-forbidden', 'Podman prerequisite must not resolve Podman from PATH.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i, 'forge-podman-prerequisite-source-mutation-forbidden', 'Podman prerequisite must not mutate Git state.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);

  const parameterBlock = source.slice(0, source.indexOf('Set-StrictMode'));
  if (/\$(?:Url|Uri|Path|Executable|Command|Args|Token|Credential)\b/i.test(parameterBlock)) {
    findings.push(finding('forge-podman-prerequisite-caller-authority-forbidden', 'Prerequisite caller must not select URL, path, executable, command, arguments or credentials.', path));
  }
}

export function analyzeWindowsAuthorityForgePodmanPrerequisiteReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({
      eligible: false,
      clean: false,
      findings: Object.freeze([]),
      reviewedPaths: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Forge Podman prerequisite specialist requires exactly one immutable exact-head source record.', path));
  } else {
    reviewPrerequisite(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-forge-podman-prerequisite/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([path]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_FORGE_PODMAN_PREREQUISITE_SPECIALIST_FINDINGS',
  });
}
