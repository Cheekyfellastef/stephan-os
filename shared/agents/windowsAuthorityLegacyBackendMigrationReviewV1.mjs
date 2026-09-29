import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1 = Object.freeze([
  'scripts/windows/migrate-legacy-stephanos-backend-listener-v1.ps1',
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
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  const path = WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1[0];
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path) === path ? [path] : [];
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

function reviewLegacyBackendMigration(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'legacy-backend-expected-head-not-bounded', 'Expected head must remain a fixed 40-hex commit identity.'],
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'legacy-backend-node-not-fixed', 'Legacy migration must use the canonical Node executable.'],
    ["$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'legacy-backend-git-not-fixed', 'Legacy migration must use the canonical Git executable.'],
    ["$healthUrl = 'http://127.0.0.1:8787/api/health'", 'legacy-backend-health-not-fixed', 'Legacy migration must bind the canonical loopback backend health surface.'],
    ["'Documents\\GitHub\\stephan-os'", 'legacy-backend-repository-not-fixed', 'Legacy migration must bind the canonical checkout.'],
    ['Get-NetTCPConnection -LocalPort 8787 -State Listen', 'legacy-backend-listener-not-fixed', 'Legacy migration must inspect only the canonical backend listener port.'],
    ['if ($processIds.Count -ne 1)', 'legacy-backend-single-listener-gate-missing', 'Exactly one listener identity must be required.'],
    ['Get-CimInstance Win32_Process -Filter "ProcessId = $processId"', 'legacy-backend-process-identity-gate-missing', 'Listener process identity must be read from the exact owning PID.'],
    ["'node stephanos-server/server.js'", 'legacy-backend-node-command-missing', 'The historical canonical node command must remain explicit.'],
    ["'node.exe stephanos-server/server.js'", 'legacy-backend-node-exe-command-missing', 'The historical canonical node.exe command must remain explicit.'],
    ["'stephanos.backend-health.v1'", 'legacy-backend-health-schema-gate-missing', 'Canonical backend health schema must be required.'],
    ["'stephanos-battle-bridge-backend'", 'legacy-backend-runtime-id-gate-missing', 'Canonical backend runtime identity must be required.'],
    ['branch --show-current', 'legacy-backend-main-branch-proof-missing', 'Canonical main branch identity must be proved.'],
    ['rev-parse origin/main', 'legacy-backend-origin-main-proof-missing', 'Origin main identity must be proved.'],
    ['cat-file -e "$($health.SourceHead)^{commit}"', 'legacy-backend-stale-commit-proof-missing', 'Stale source commit existence must be proved.'],
    ['merge-base --is-ancestor $health.SourceHead $ExpectedHead', 'legacy-backend-ancestry-gate-missing', 'Stale source must be an ancestor of exact current head.'],
    ['$listenerAfter.ProcessId -ne $listenerBefore.ProcessId', 'legacy-backend-stable-pid-gate-missing', 'Listener PID must remain stable before termination.'],
    ['$listenerAfter.CreationTimeUtc -ne $listenerBefore.CreationTimeUtc', 'legacy-backend-stable-start-gate-missing', 'Listener creation identity must remain stable before termination.'],
    ['$listenerAfter.CommandLine, $listenerBefore.CommandLine', 'legacy-backend-stable-command-gate-missing', 'Listener command identity must remain stable before termination.'],
    ['$headImmediatelyBeforeMutation', 'legacy-backend-final-head-gate-missing', 'Expected repository head must be re-proved immediately before mutation.'],
    ['Stop-Process -Id $listenerAfter.ProcessId -Force -ErrorAction Stop', 'legacy-backend-verified-stop-not-exact', 'Only the re-attested listener PID may be terminated.'],
    ['terminatedVerifiedOwnedProcess = $true', 'legacy-backend-owned-process-proof-missing', 'Successful migration must attest verified-owned process termination.'],
    ['arbitraryPidAllowed = $false', 'legacy-backend-arbitrary-pid-denial-missing', 'Arbitrary PID authority must remain denied.'],
    ['arbitraryExecutableAllowed = $false', 'legacy-backend-arbitrary-executable-denial-missing', 'Arbitrary executable authority must remain denied.'],
    ['arbitraryCommandAllowed = $false', 'legacy-backend-arbitrary-command-denial-missing', 'Arbitrary command authority must remain denied.'],
    ['arbitraryTaskAllowed = $false', 'legacy-backend-arbitrary-task-denial-missing', 'Arbitrary task authority must remain denied.'],
    ['arbitraryShellAllowed = $false', 'legacy-backend-arbitrary-shell-denial-missing', 'Arbitrary shell authority must remain denied.'],
    ['sourceMutationAllowed = $false', 'legacy-backend-source-denial-missing', 'Source mutation authority must remain denied.'],
    ['pcRestartAllowed = $false', 'legacy-backend-pc-restart-denial-missing', 'PC restart authority must remain denied.'],
    ['liveOpenClawUpdatePerformed = $false', 'legacy-backend-openclaw-denial-missing', 'Live OpenClaw update must remain outside this migration.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source,
    /if \(-not \[string\]::Equals\(\$executable, \$canonicalNode, \[System\.StringComparison\]::OrdinalIgnoreCase\)\)/,
    'legacy-backend-canonical-node-gate-missing', 'Listener executable must equal the fixed canonical Node executable.', path);
  requirePattern(findings, source,
    /if \(\$health\.SourceHead -eq \$ExpectedHead\) \{ Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_ALREADY_CURRENT' \}/,
    'legacy-backend-stale-only-gate-missing', 'Current-head listeners must never enter legacy migration.', path);
  requirePattern(findings, source,
    /if \(\$LASTEXITCODE -ne 0 -or \$branch -ne 'main' -or \$head -ne \$ExpectedHead -or \$originHead -ne \$ExpectedHead\)/,
    'legacy-backend-exact-main-gate-missing', 'Local main, HEAD and origin/main must all match expected head.', path);

  const stopProcessMatches = source.match(/\bStop-Process\b/g) || [];
  if (stopProcessMatches.length !== 1) {
    findings.push(finding('legacy-backend-stop-process-count-invalid', 'Exactly one fixed Stop-Process invocation is permitted.', path));
  }

  for (const [pattern, code, summary] of [
    [/\bInvoke-Expression\b|\bStart-Process\b|\bStart-Job\b|ScriptBlock::Create/i, 'legacy-backend-dynamic-execution-forbidden', 'Dynamic execution is forbidden.'],
    [/Register-ScheduledTask|Start-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask/i, 'legacy-backend-task-mutation-forbidden', 'Scheduled Task mutation is forbidden.'],
    [/Restart-Computer|shutdown\.exe|Stop-Computer|Restart-Service|Stop-Service/i, 'legacy-backend-host-mutation-forbidden', 'Host or service restart authority is forbidden.'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'legacy-backend-dynamic-powershell-forbidden', 'Dynamic PowerShell command payloads are forbidden.'],
    [/\&\s+\$canonicalGit[^\r\n]*\s(?:push|reset|clean|rebase|checkout|switch)\s/i, 'legacy-backend-git-mutation-forbidden', 'Git mutation is forbidden.'],
    [/\b(?:Set-Content|Add-Content|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b/i, 'legacy-backend-file-mutation-forbidden', 'File mutation is forbidden.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

export function analyzeWindowsAuthorityLegacyBackendMigrationReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head source record is required.', path));
  } else {
    reviewLegacyBackendMigration(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-legacy-backend-migration/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([path]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_SPECIALIST_FINDINGS',
  });
}
