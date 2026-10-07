import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1 = Object.freeze([
  'scripts/windows/install-source-mutation-commit-guard.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const PATH = WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1[0];
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2863,
  branch: 'repair/source-mutation-lease-commit-guard-20261007',
});
const REVIEWED_BLOB_SHA = '5f6184f23b3d9e3758c78c1debfca9052524e67b';

const text = (value) => String(value ?? '').trim();
const finding = (code, summary = code) => Object.freeze({ severity: 'P0', code, summary, path: PATH });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === PATH;
}

function exactSource(source, repository, head) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === PATH
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content)
    && source.blobSha === REVIEWED_BLOB_SHA);
}

function requireLiteral(findings, source, literal, code) {
  if (!source.includes(literal)) findings.push(finding(code));
}

function requirePattern(findings, source, pattern, code) {
  if (!pattern.test(source)) findings.push(finding(code));
}

function forbidPattern(findings, source, pattern, code) {
  if (pattern.test(source)) findings.push(finding(code));
}

function reviewInstaller(source, findings) {
  for (const [literal, code] of [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'source-mutation-guard-shouldprocess-missing'],
    ['param()', 'source-mutation-guard-caller-parameters-forbidden'],
    ["$git='C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'", 'source-mutation-guard-git-not-fixed'],
    ["'.githooks\\\\pre-commit'", 'source-mutation-guard-pre-commit-not-fixed'],
    ["'.githooks\\\\pre-merge-commit'", 'source-mutation-guard-pre-merge-commit-not-fixed'],
    ["'scripts\\\\source-mutation-commit-guard.mjs'", 'source-mutation-guard-script-not-fixed'],
    ["ls-files --error-unmatch '.githooks/pre-commit'", 'source-mutation-guard-pre-commit-tracking-proof-missing'],
    ["ls-files --error-unmatch '.githooks/pre-merge-commit'", 'source-mutation-guard-pre-merge-tracking-proof-missing'],
    ["ls-files --stage '.githooks/pre-commit'", 'source-mutation-guard-pre-commit-mode-proof-missing'],
    ["ls-files --stage '.githooks/pre-merge-commit'", 'source-mutation-guard-pre-merge-mode-proof-missing'],
    ["$hookMode -ne '100755' -or $mergeHookMode -ne '100755'", 'source-mutation-guard-executable-mode-gate-missing'],
    ["ls-files --error-unmatch 'scripts/source-mutation-commit-guard.mjs'", 'source-mutation-guard-script-tracking-proof-missing'],
    ["config --local core.hooksPath .githooks", 'source-mutation-guard-hooks-path-write-not-fixed'],
    ["config --local --get core.hooksPath", 'source-mutation-guard-hooks-path-readback-missing'],
    ["if($observed -ne '.githooks')", 'source-mutation-guard-hooks-path-proof-missing'],
    ["mergeAuthority=$false", 'source-mutation-guard-merge-authority-denial-missing'],
    ["leaseSeizureAllowed=$false", 'source-mutation-guard-lease-seizure-denial-missing'],
  ]) requireLiteral(findings, source, literal, code);

  requirePattern(
    findings,
    source,
    /\$repoRoot=\[System\.IO\.Path\]::GetFullPath\(\(Join-Path \$PSScriptRoot '\.\.\\\\\.\.?'\)\)/,
    'source-mutation-guard-repository-root-not-fixed',
  );
  requirePattern(
    findings,
    source,
    /if\(\$PSCmdlet\.ShouldProcess\(\$repoRoot,'Configure repository-local source mutation commit guard'\)\)\{& \$git -C \$repoRoot config --local core\.hooksPath \.githooks;/,
    'source-mutation-guard-config-boundary-incomplete',
  );

  const hostileScanSource = source.replace(
    "$git='C:\\\\Program Files\\\\Git\\\\cmd\\\\git.exe'",
    "$git='<fixed-canonical-git>'",
  );
  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|Invoke-Command|ScriptBlock\s*::\s*Create|Start-Process/i, 'source-mutation-guard-dynamic-execution-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'source-mutation-guard-dynamic-powershell-forbidden'],
    [/\b(?:cmd|powershell|pwsh|wscript|cscript)(?:\.exe)?\b/i, 'source-mutation-guard-extra-executable-forbidden'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|fetch|commit)\b/i, 'source-mutation-guard-git-authority-widened'],
    [/Restart-Computer|shutdown\.exe|Stop-Process|Remove-Item|Set-Content|Add-Content|New-ScheduledTask|Register-ScheduledTask/i, 'source-mutation-guard-host-authority-widened'],
    [/Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget/i, 'source-mutation-guard-network-authority-forbidden'],
  ]) forbidPattern(findings, hostileScanSource, pattern, code);
}

export function analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === REVIEWED_IDENTITY.repository
    && Number(input.prNumber) === REVIEWED_IDENTITY.prNumber
    && text(input.branch) === REVIEWED_IDENTITY.branch
    && SHA.test(sourceHead)
    && exactEscalation(input.analysis);

  if (!eligible) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const findings = [];
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const source = sources.length === 1 ? sources[0] : null;
  const proofRefs = [];
  if (!exactSource(source, repository, sourceHead)) {
    findings.push(finding('windows-authority-source-mutation-commit-guard-source-evidence-invalid'));
  } else {
    reviewInstaller(source.content, findings);
    proofRefs.push(`proofs/windows-authority-source-mutation-commit-guard/${PATH}@${sourceHead}#${source.blobSha}:${source.size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([PATH]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_FINDINGS',
  });
}
