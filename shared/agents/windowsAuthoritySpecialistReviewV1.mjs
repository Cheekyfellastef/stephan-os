import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION = 'stephanos.windows-authority-specialist-review.v1';
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION = 'stephanos.windows-authority-source.v1';
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES = 256 * 1024;

const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const ALLOWED_PATHS = Object.freeze([
  'scripts/windows/install-stephanos-backend-autostart.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
]);

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
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

function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (!findings.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path).startsWith('scripts/windows/')
  ))) return [];
  return unique(findings.map((item) => text(item.path)));
}

function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.schemaVersion === WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && source.size > 0
    && source.size <= WINDOWS_AUTHORITY_SOURCE_MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
  );
}

function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(finding(code, summary, path));
}

function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function reviewInstaller(source, path, findings) {
  requirePattern(findings, source, /\$taskName\s*=\s*'Stephanos Battle Bridge Backend'/, 'windows-backend-task-name-not-fixed', 'Backend scheduled-task identity must remain fixed.', path);
  requirePattern(findings, source, /\$wscriptExe\s*=\s*'C:\\Windows\\System32\\wscript\.exe'/, 'windows-backend-task-host-not-fixed', 'Backend scheduled-task host must remain the fixed Windows wscript executable.', path);
  requirePattern(findings, source, /Test-Path -LiteralPath \$wscriptExe -PathType Leaf/, 'windows-backend-task-host-not-proved', 'Backend scheduled-task host must be proved before registration.', path);
  requirePattern(findings, source, /New-ScheduledTaskPrincipal[^\r\n]*-LogonType\s+Interactive[^\r\n]*-RunLevel\s+Limited/, 'windows-backend-task-principal-not-limited', 'Backend task principal must remain interactive and limited.', path);
  requirePattern(findings, source, /New-ScheduledTaskSettingsSet[^\r\n]*-MultipleInstances\s+IgnoreNew/, 'windows-backend-task-overlap-not-rejected', 'Backend task must reject overlapping instances.', path);
  requirePattern(findings, source, /New-ScheduledTaskAction\s+-Execute\s+\$wscriptExe\s+-Argument\s+\$taskArgs/, 'windows-backend-task-action-not-fixed', 'Backend task action must remain bound to the fixed windowless launcher.', path);
  requirePattern(findings, source, /\$PSCmdlet\.ShouldProcess\(\$taskName,\s*'Register\/Update scheduled task'\)/, 'windows-backend-task-shouldprocess-missing', 'Backend task installation must remain ShouldProcess-gated.', path);
  forbidPattern(findings, source, /RunLevel\s+Highest|-MultipleInstances\s+Parallel/i, 'windows-backend-task-authority-expanded', 'Backend task must not gain elevated or parallel authority.', path);
}

function reviewProbe(source, path, findings) {
  for (const literal of [
    "'C:\\Program Files\\Git\\cmd\\git.exe'",
    "'C:\\Program Files\\nodejs\\node.exe'",
    "'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "'C:\\Windows\\System32\\wscript.exe'",
  ]) {
    if (!source.includes(literal)) findings.push(finding(
      'windows-recovery-canonical-executable-missing',
      'Recovery proof must pin canonical executables.',
      path,
    ));
  }
  requirePattern(findings, source, /function\s+Test-TaskAuthority[\s\S]*LogonType[\s\S]*Interactive[\s\S]*RunLevel[\s\S]*Limited[\s\S]*MultipleInstances[\s\S]*IgnoreNew/, 'windows-recovery-task-authority-not-proved', 'Recovery task authority must be proved before task start.', path);
  requirePattern(findings, source, /Assert-CanonicalTrackedWorktreeClean[\s\S]*Assert-CanonicalTrackedWorktreeClean/, 'windows-recovery-clean-source-recheck-missing', 'Recovery must prove tracked source cleanliness before and after probing.', path);
  requirePattern(findings, source, /branch --show-current[\s\S]*\$branch\s+-ne\s+'main'/, 'windows-recovery-main-binding-missing', 'Recovery must bind to canonical main.', path);
  requirePattern(findings, source, /Start-ScheduledTask\s+-TaskName\s+\$spec\.Name/, 'windows-recovery-task-start-not-allowlisted', 'Recovery may start only the fixed task selected from the allowlist.', path);
  requirePattern(findings, source, /if\s*\(-not\s+\$observed\.authorityCanonical\)\s*\{\s*continue\s*\}/, 'windows-recovery-authority-gate-missing', 'Recovery must refuse non-canonical task authority.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$executable,\s*\$canonicalNode/, 'windows-recovery-listener-executable-not-exact', 'Backend listener executable must match canonical Node exactly.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$commandLine,\s*\$expectedQuotedCommand[\s\S]*\[string\]::Equals\(\$commandLine,\s*\$expectedUnquotedCommand/, 'windows-recovery-listener-command-not-exact', 'Backend listener command line must match one of the exact canonical forms.', path);
  requirePattern(findings, source, /schemaVersion\s+-eq\s+'stephanos\.backend-runtime\.v1'[\s\S]*headSha[\s\S]*ExpectedSourceHead[\s\S]*pid[\s\S]*listenerAfter\.pid[\s\S]*processStartTimeUtc/, 'windows-recovery-runtime-receipt-not-bound', 'Backend runtime receipt must bind schema, head, PID and process start identity.', path);
  requirePattern(findings, source, /backendRestartSkippedAsCurrent/, 'windows-recovery-current-backend-preservation-missing', 'Recovery must preserve an already-current backend.', path);
}

function reviewStarter(source, path, findings) {
  requirePattern(findings, source, /\$canonicalGit\s*=\s*'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'windows-backend-starter-git-unpinned', 'Backend startup must pin the canonical Git executable instead of resolving PATH.', path);
  requirePattern(findings, source, /\$canonicalNpm\s*=\s*'C:\\Program Files\\nodejs\\npm\.cmd'/, 'windows-backend-starter-npm-unpinned', 'Backend startup must pin the canonical npm executable instead of resolving PATH.', path);
  requirePattern(findings, source, /\$canonicalNode\s*=\s*'C:\\Program Files\\nodejs\\node\.exe'/, 'windows-backend-starter-node-unpinned', 'Backend startup must pin canonical Node for listener identity.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$executable,\s*\$canonicalNode/, 'windows-backend-starter-listener-executable-not-exact', 'Backend startup must prove the listener executable exactly.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$commandLine,\s*\$expectedQuotedCommand[\s\S]*\[string\]::Equals\(\$commandLine,\s*\$expectedUnquotedCommand/, 'windows-backend-starter-listener-command-not-exact', 'Backend startup must prove the listener command line exactly.', path);
  forbidPattern(findings, source, /\.Contains\(['"]stephanos-server\/server\.js['"]\)/i, 'windows-backend-starter-substring-listener-proof', 'Substring listener proof cannot mint an exact-head runtime receipt.', path);
  forbidPattern(findings, source, /Get-Command\s+(?:git(?:\.exe)?|npm(?:\.cmd)?)/i, 'windows-backend-starter-path-resolution-forbidden', 'Backend startup must not resolve Git or npm from PATH.', path);
  forbidPattern(findings, source, /(^|\r?\n)\s*npm(?:\.cmd)?\s+run/im, 'windows-backend-starter-unpinned-npm-invocation', 'Every npm invocation in backend startup must use the canonical npm path.', path);
  requirePattern(findings, source, /schemaVersion\s+-eq\s+'stephanos\.backend-health\.v1'[\s\S]*runtimeId\s+-eq\s+'stephanos-battle-bridge-backend'[\s\S]*sourceHead/, 'windows-backend-starter-health-identity-incomplete', 'Backend health must bind schema, runtime identity and exact source head.', path);
  requirePattern(findings, source, /status\s+'--porcelain=v1'\s+'--untracked-files=no'/, 'windows-backend-starter-clean-source-proof-missing', 'Backend startup must reject tracked worktree drift.', path);
  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$canonicalNpm[\s\S]*-ArgumentList\s+\$arguments/, 'windows-backend-starter-process-not-pinned', 'Backend process launch must use canonical npm and fixed arguments.', path);
  requirePattern(findings, source, /STEPHANOS_BACKEND_SOURCE_HEAD\s*=\s*\$headSha/, 'windows-backend-starter-head-env-missing', 'Backend process must receive the exact source head.', path);
  requirePattern(findings, source, /Write-BackendRuntimeReceipt[\s\S]*ProcessStartTimeUtc/, 'windows-backend-starter-runtime-receipt-incomplete', 'Backend startup receipt must include process start identity.', path);
  requirePattern(findings, source, /function\s+Publish-VerifiedBackendRuntimeReceipt[\s\S]*Write-BackendRuntimeReceipt[\s\S]*\$confirmedListener[\s\S]*ProcessId\s+-ne\s+\$Listener\.ProcessId[\s\S]*ProcessStartTimeUtc\s+-ne\s+\$Listener\.ProcessStartTimeUtc[\s\S]*Test-BackendHealth/, 'windows-backend-starter-receipt-stability-recheck-missing', 'Runtime receipt publication must recheck exact listener PID, process start identity, and exact-head health.', path);
  requirePattern(findings, source, /\$existingListener[\s\S]*if\s*\(\$existingListener\)[\s\S]*Publish-VerifiedBackendRuntimeReceipt[\s\S]*exit\s+0/, 'windows-backend-starter-reuse-receipt-missing', 'Reusing an already-current backend must refresh and recheck its exact runtime receipt before success.', path);
}

function generalAuthorityScan(source, path, findings) {
  const forbidden = [
    [/Invoke-Expression/i, 'windows-authority-invoke-expression-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'windows-authority-pc-restart-forbidden'],
    [/Stop-Process/i, 'windows-authority-process-kill-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i, 'windows-authority-source-mutation-forbidden'],
    [/RunLevel\s+Highest/i, 'windows-authority-elevation-forbidden'],
  ];
  for (const [pattern, code] of forbidden) forbidPattern(findings, source, pattern, code, 'Specialist-reviewed Windows authority must remain bounded and non-mutating.', path);
}

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = Boolean(
    repository.includes('/')
    && EXACT_HEAD.test(sourceHead)
    && paths.length > 0
    && paths.every((path) => ALLOWED_PATHS.includes(path))
  );
  if (!eligible) {
    return Object.freeze({
      schemaVersion: WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of paths) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', 'Specialist review requires one exact-head, size-bound and blob-bound source record.', path));
      continue;
    }
    const source = candidates[0].content;
    generalAuthorityScan(source, path, findings);
    if (path.endsWith('install-stephanos-backend-autostart.ps1')) reviewInstaller(source, path, findings);
    if (path.endsWith('probe-battle-bridge-recovery-mesh.ps1')) reviewProbe(source, path, findings);
    if (path.endsWith('start-stephanos-backend.ps1')) reviewStarter(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS',
  });
}
