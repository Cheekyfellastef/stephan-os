export const WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1 = Object.freeze([
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
]);

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA40 = /^[a-f0-9]{40}$/;
const EXPECTED_BLOBS = Object.freeze({
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': 'f398b0cb5542b2e7e33e4ad221a5b3dfa588d6e8',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': 'd453778a49940fb6cb481b5c31823c03ef86ed93',
});

function text(value) {
  return String(value ?? '').trim();
}

function finding(code, path) {
  return Object.freeze({ severity: 'P0', code, summary: code, path });
}

function exactEscalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1';
}

function exactSource(source, repository, head, path) {
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size > 0
    && source.size <= 256 * 1024
    && source.blobSha === EXPECTED_BLOBS[path]
    && typeof source.content === 'string'
    && source.content.length > 0);
}

function requireLiteral(findings, source, path, literal, code) {
  if (!source.includes(literal)) findings.push(finding(code, path));
}

function forbid(findings, source, path, pattern, code) {
  if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewInstaller(source, path, findings) {
  for (const [literal, code] of [
    ['function Resolve-IdentitySid([string]$Identity)', 'lifeboat-principal-sid-resolver-missing'],
    ['System.Security.Principal.SecurityIdentifier', 'lifeboat-principal-sid-type-missing'],
    ['System.Security.Principal.NTAccount', 'lifeboat-principal-account-type-missing'],
    ['Translate([System.Security.Principal.SecurityIdentifier]).Value', 'lifeboat-principal-translation-missing'],
    ['$taskPrincipalSid = Resolve-IdentitySid ([string]$task.Principal.UserId)', 'lifeboat-task-principal-sid-resolution-missing'],
    ['if ($taskPrincipalSid -ne $CurrentUserSid)', 'lifeboat-task-principal-sid-comparison-missing'],
    ['$currentUserSid = $currentIdentity.User.Value', 'lifeboat-current-user-sid-proof-missing'],
    ['Assert-CanonicalScheduledTask -CurrentUserSid $currentUserSid', 'lifeboat-current-user-sid-binding-missing'],
    ["$task.Principal.LogonType -ne 'Interactive'", 'lifeboat-task-logon-proof-missing'],
    ["$task.Principal.RunLevel -ne 'Limited'", 'lifeboat-task-runlevel-proof-missing'],
    ['$actions[0].Execute -ne $wscriptExe', 'lifeboat-task-executable-proof-missing'],
    ['$actions[0].Arguments -ne $expectedArguments', 'lifeboat-task-arguments-proof-missing'],
    ['arbitraryShellAllowed = $false', 'lifeboat-shell-denial-missing'],
    ['gitMutationAllowed = $false', 'lifeboat-git-denial-missing'],
    ['sourceMutationAllowed = $false', 'lifeboat-source-denial-missing'],
    ['pcRestartAllowed = $false', 'lifeboat-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  forbid(findings, source, path, /\$task\.Principal\.UserId\s+-ne\s+\$CurrentUser\b/, 'lifeboat-raw-principal-name-comparison-retained');
  forbid(findings, source, path, /Invoke-Expression|\biex\b|powershell(?:\.exe)?\s+-Command/i, 'lifeboat-dynamic-shell-forbidden');
  forbid(findings, source, path, /git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'lifeboat-git-mutation-forbidden');
  forbid(findings, source, path, /Restart-Computer|shutdown\.exe/i, 'lifeboat-pc-restart-forbidden');
}

function reviewRegression(source, path, findings) {
  for (const [literal, code] of [
    ['function Resolve-IdentitySid', 'lifeboat-sid-regression-resolver-missing'],
    ['System\\.Security\\.Principal\\.NTAccount', 'lifeboat-sid-regression-account-proof-missing'],
    ['Translate\\(\\[System\\.Security\\.Principal\\.SecurityIdentifier\\]\\)', 'lifeboat-sid-regression-translation-proof-missing'],
    ['\\$taskPrincipalSid -ne \\$CurrentUserSid', 'lifeboat-sid-regression-comparison-proof-missing'],
    ['doesNotMatch(installer, /\\$task\\.Principal\\.UserId -ne \\$CurrentUser/', 'lifeboat-sid-regression-raw-name-denial-missing'],
    ['Assert-CanonicalScheduledTask -CurrentUserSid \\$currentUserSid', 'lifeboat-sid-regression-binding-proof-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /child_process|spawnSync|execSync|powershell\.exe/i, 'lifeboat-sid-regression-must-remain-static');
}

export function analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === REPOSITORY && SHA40.test(sourceHead) && exactEscalation(input.analysis);

  if (!eligible) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
    });
  }

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: true,
      clean: false,
      reviewedPaths: WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1,
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED',
    });
  }

  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1) {
    const candidates = input.sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('.ps1')) reviewInstaller(source, path, findings);
    else reviewRegression(source, path, findings);
    proofRefs.push(`proofs/windows-authority-lifeboat-principal-sid/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (input.sources.length !== WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
