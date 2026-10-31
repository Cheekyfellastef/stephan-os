import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1 = Object.freeze([
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs',
]);

export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1 = Object.freeze({
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1': '8883b76eb04a4857e5627391d612dd09a02a8a97',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs': '6c5f32afbba17c21d72aff7f983622862409c73b',
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA40 = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const REVIEWED_PR = 3362;
const REVIEWED_BRANCH = 'fix/2961-fixed-runtime-closure-relay-proof-20261031';
const MAX_SOURCE_BYTES = 256 * 1024;

const text = value => typeof value === 'string' ? value.trim() : '';
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });

function plainDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && d && Object.hasOwn(d, 'value') && d.enumerable === true;
  });
}

function blobSha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function exactEscalation(analysis) {
  if (!plainDataRecord(analysis) || !Array.isArray(analysis.findings)
      || analysis.findings.length !== WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.length
      || !plainDataRecord(analysis.counts)
      || analysis.counts.P0 !== 2 || analysis.counts.P1 !== 0 || analysis.counts.P2 !== 0) return false;
  const paths = [];
  for (const row of analysis.findings) {
    if (!plainDataRecord(row)
        || text(row.severity).toUpperCase() !== 'P0'
        || text(row.code) !== 'unsupported-high-risk-surface'
        || !WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.includes(text(row.path))) return false;
    paths.push(text(row.path));
  }
  return new Set(paths).size === 2;
}

function exactLineage(lineage, sourceHead, baseSha) {
  if (!plainDataRecord(lineage) || lineage.schemaVersion !== LINEAGE_SCHEMA
      || lineage.repository !== REPOSITORY
      || lineage.sourceHead !== sourceHead
      || lineage.sourceCommitSha !== sourceHead
      || lineage.baseSha !== baseSha
      || lineage.liveMainBeforeSha !== baseSha
      || lineage.liveMainAfterSha !== baseSha
      || !plainDataRecord(lineage.comparison)) return false;
  const c = lineage.comparison;
  return c.status === 'ahead'
    && Number.isSafeInteger(c.aheadBy) && c.aheadBy >= 1
    && c.behindBy === 0
    && c.baseCommitSha === baseSha
    && c.mergeBaseCommitSha === baseSha;
}

function exactSource(source, sourceHead, path) {
  if (!plainDataRecord(source)) return false;
  const body = typeof source.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(body, 'utf8');
  return source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && bytes > 0 && bytes <= MAX_SOURCE_BYTES
    && SHA40.test(text(source.blobSha))
    && source.blobSha === blobSha(body)
    && source.blobSha === WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[path];
}

function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function reviewInstaller(source, findings, path) {
  for (const [literal, code, summary] of [
    ["param([switch]$OperatorApproved,[string]$ExpectedMain='')", 'fixed-runtime-installer-operator-gate-missing', 'Installer must retain the explicit operator-approved exact-main gate.'],
    ["$bootstrap.Records.Count -lt 40 -or $bootstrap.Records.Count -gt 258", 'fixed-runtime-installer-closure-bound-changed', 'Installer source estate must remain capped at exactly 258 members.'],
    ["throw 'FIXED_INSTALL_ADMINISTRATOR_REQUIRED'", 'fixed-runtime-installer-admin-gate-missing', 'Installer must require an administrator token only at the attended install boundary.'],
    ["if($identity.User.Value -cne $bootstrap.OperatorSid){throw 'FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED'}", 'fixed-runtime-installer-operator-identity-gate-missing', 'Elevated installer identity must remain bound to the initiating operator SID.'],
    ["$sourceRoot='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os'", 'fixed-runtime-installer-source-root-not-fixed', 'Installer source root must remain canonical and fixed.'],
    ["$protectedRoot='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1'", 'fixed-runtime-installer-protected-root-not-fixed', 'Installer output root must remain the fixed protected Program Files location.'],
    ["@('.git/HEAD','ref: refs/heads/main'),@('.git/refs/heads/main',$ExpectedMain)", 'fixed-runtime-installer-ref-proof-missing', 'Installer must retain exact main ref proof immediately from physical source.'],
    ["if([DateTime]::Parse($installed) -le [DateTime]::Parse($compileCompleted)){throw 'FIXED_INSTALL_TIME_ORDER_UNPROVEN'}", 'fixed-runtime-installer-time-order-gate-missing', 'Installer must prove compilation completed before installation.'],
    ["# PENDING only: true later full boot + authenticated custody IDLE + exact pins", 'fixed-runtime-installer-pending-only-contract-missing', 'Installer must remain pending-only and require a genuinely later boot.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [pattern, code, summary] of [
    [/\b(?:Invoke-Expression|Invoke-Command|Start-Job|Restart-Computer|Stop-Computer|shutdown\.exe)\b/i,
      'fixed-runtime-installer-authority-widened', 'Installer must not gain dynamic shell or host-restart authority.'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget)\b/i,
      'fixed-runtime-installer-network-authority-forbidden', 'Installer must not gain network download authority.'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i,
      'fixed-runtime-installer-git-mutation-forbidden', 'Installer must not gain Git mutation or publication authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function reviewIdentity(source, findings, path) {
  for (const [literal, code, summary] of [
    ['const string RuntimeSourceRootV1 = @"C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os";', 'fixed-runtime-identity-source-root-not-fixed', 'Runtime source root must remain canonical and fixed.'],
    ['const string RuntimeProtectedRootV1 = @"C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1";', 'fixed-runtime-identity-protected-root-not-fixed', 'Runtime helper root must remain the fixed protected Program Files location.'],
    ['return compiled<installed && installed<boot && boot<now;', 'fixed-runtime-identity-later-boot-order-missing', 'Runtime qualification must retain compile-before-install-before-later-boot ordering.'],
    ['manifest.Files==null || manifest.Files.Length<40 || manifest.Files.Length>258)', 'fixed-runtime-identity-closure-bound-changed', 'Runtime manifest must remain capped at exactly 258 members.'],
    ['pending.SourceHead!=manifest.SourceHead || pending.SourceTree!=manifest.SourceTree ||', 'fixed-runtime-identity-pending-source-binding-missing', 'Pending receipt must remain bound to exact source head and tree.'],
    ['throw new InvalidOperationException("RUNTIME_PENDING_LATER_BOOT_UNPROVEN");', 'fixed-runtime-identity-later-boot-failclose-missing', 'Missing later-boot proof must remain fail closed.'],
    ['new WindowsPrincipal(principal).IsInRole(WindowsBuiltInRole.Administrator)', 'fixed-runtime-identity-normal-operator-gate-missing', 'Runtime execution must reject administrator context after installation.'],
    ['string expected=relative==".git/HEAD"?"ref: refs/heads/main":manifest.SourceHead;', 'fixed-runtime-identity-main-ref-binding-missing', 'Runtime must pin physical Git main identity to the installed source head.'],
    ['throw new InvalidOperationException("RUNTIME_SOURCE_REF_CHANGED");', 'fixed-runtime-identity-source-ref-failclose-missing', 'Source ref drift must remain fail closed.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [pattern, code, summary] of [
    [/\bProcess\.Start\s*\(/, 'fixed-runtime-identity-process-authority-forbidden', 'Identity validator must not start arbitrary processes.'],
    [/\b(?:WebClient|HttpClient|WebRequest|FtpWebRequest)\b/, 'fixed-runtime-identity-network-authority-forbidden', 'Identity validator must not gain network authority.'],
    [/\b(?:RegistryKey\.CreateSubKey|SetValue|DeleteValue|DeleteSubKey)\b/, 'fixed-runtime-identity-registry-mutation-forbidden', 'Identity validator must not mutate the registry.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

export function analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = repository === REPOSITORY
    && input.prNumber === REVIEWED_PR
    && text(input.branch) === REVIEWED_BRANCH
    && SHA40.test(sourceHead)
    && SHA40.test(baseSha)
    && sourceHead !== baseSha
    && exactEscalation(input.analysis)
    && exactLineage(input.lineageEvidence, sourceHead, baseSha);

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_NOT_APPLICABLE',
  });

  const findings = [];
  const proofRefs = [];
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const byPath = new Map();
  for (const source of sources) {
    const path = text(source?.path);
    if (!WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.includes(path) || byPath.has(path)) {
      findings.push(finding('fixed-runtime-specialist-source-estate-widened',
        'Specialist source evidence must contain exactly the two reviewed fixed-runtime Windows files.',
        path || WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1[0]));
      continue;
    }
    byPath.set(path, source);
  }
  if (sources.length !== 2) findings.push(finding(
    'fixed-runtime-specialist-source-estate-widened',
    'Specialist source evidence must contain exactly two reviewed files.',
    WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1[0],
  ));

  for (const path of WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1) {
    const source = byPath.get(path);
    if (!exactSource(source, sourceHead, path)) {
      findings.push(finding('fixed-runtime-specialist-exact-source-not-pinned',
        'High-risk fixed-runtime source must match the exact reviewed Git blob.',
        path));
      continue;
    }
    if (path.endsWith('.ps1')) reviewInstaller(source.content, findings, path);
    else reviewIdentity(source.content, findings, path);
    proofRefs.push('proofs/windows-authority-sovereign-fixed-runtime/'
      + path + '@' + sourceHead + '#' + source.blobSha + ':' + source.size);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_FINDINGS',
  });
}
