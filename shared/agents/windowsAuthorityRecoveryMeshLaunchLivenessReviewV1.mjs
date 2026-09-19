import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_PATHS_V1 = Object.freeze([
  'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
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
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_PATHS_V1[0];
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

function reviewLaunchWrapper(source, path, findings) {
  for (const [literal, code, summary] of [
    ["$nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe'", 'recovery-launch-node-not-fixed', 'Recovery Mesh launch must use the fixed canonical Node executable.'],
    ["'Documents\\GitHub\\stephan-os'", 'recovery-launch-repository-not-fixed', 'Recovery Mesh launch must bind the canonical checkout.'],
    ["'scripts\\battle-bridge-recovery-mesh.mjs'", 'recovery-launch-runner-not-fixed', 'Recovery Mesh launch must bind the fixed runner path.'],
    ["'status\\battle-bridge-recovery-mesh-launch-current.json'", 'recovery-launch-status-not-fixed', 'Recovery Mesh launch status path must remain fixed outside the repo.'],
    ["'Local\\StephanosBattleBridgeRecoveryMeshV1'", 'recovery-launch-mutex-not-fixed', 'Recovery Mesh launch must retain the canonical named mutex.'],
    ['RECOVERY_MESH_MUTEX_BUSY', 'recovery-launch-mutex-terminal-missing', 'Mutex contention must terminalize visibly.'],
    ['RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED', 'recovery-launch-lock-terminal-missing', 'Stale-lock reclaim failure must terminalize visibly.'],
    ['RECOVERY_MESH_RUNNER_STARTING', 'recovery-launch-starting-status-missing', 'Runner start must be visible.'],
    ['RECOVERY_MESH_RUNNER_COMPLETED', 'recovery-launch-completed-status-missing', 'Runner completion must be visible.'],
    ['RECOVERY_MESH_RUNNER_FAILED', 'recovery-launch-failed-status-missing', 'Runner failure must be visible.'],
    ['RECOVERY_MESH_HIDDEN_WRAPPER_FAILED', 'recovery-launch-wrapper-failed-status-missing', 'Wrapper failure must be visible.'],
    ["$env:STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'", 'recovery-launch-mutex-attestation-missing', 'Runner must receive live mutex attestation.'],
    ["$env:STEPHANOS_RECOVERY_MESH_LAUNCHER_PID = [string]$PID", 'recovery-launch-pid-attestation-missing', 'Runner must receive the exact launcher PID.'],
    ['OpenVerifiedForDelete', 'recovery-launch-lock-handle-proof-missing', 'Stale lock must be identity-bound before deletion.'],
    ['DeleteByHandle', 'recovery-launch-lock-handle-delete-missing', 'Stale lock deletion must be handle-bound.'],
    ['RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED', 'recovery-launch-link-proof-missing', 'Multiple-link lock paths must fail closed.'],
    ['$runnerOutput = @(& $nodeExecutable $runnerPath 2>&1)', 'recovery-launch-runner-invocation-not-fixed', 'Only the fixed Node runner invocation is allowed.'],
    ['$runnerResultParsed = $null -ne $runnerResult', 'recovery-launch-result-parse-proof-missing', 'Runner JSON parse truth must be retained.'],
    ["-Classification 'RECOVERY_MESH_RUNNER_FAILED'", 'recovery-launch-nonzero-failure-missing', 'Non-successful runner results must terminalize as failed.'],
    ['visiblePowerShellRequired = $false', 'recovery-launch-visible-powershell-denial-missing', 'Visible PowerShell must not be required.'],
    ['arbitraryShellAllowed = $false', 'recovery-launch-shell-denial-missing', 'Arbitrary shell authority must remain denied.'],
    ['arbitraryPowerShellAllowed = $false', 'recovery-launch-powershell-denial-missing', 'Arbitrary PowerShell authority must remain denied.'],
    ['sourceMutationAllowed = $false', 'recovery-launch-source-denial-missing', 'Source mutation authority must remain denied.'],
    ['pcRestartAllowed = $false', 'recovery-launch-restart-denial-missing', 'PC restart authority must remain denied.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /^\[CmdletBinding\(\)\]\s*\r?\nparam\(\)/m,
    'recovery-launch-caller-parameters-forbidden', 'Hidden recovery launcher must accept no caller parameters.', path);
  requirePattern(findings, source, /if \(\$runnerResultParsed -and \$runnerExitCode -eq 0\)[\s\S]*RECOVERY_MESH_RUNNER_COMPLETED[\s\S]*else\s*\{[\s\S]*RECOVERY_MESH_RUNNER_FAILED/,
    'recovery-launch-exit-gate-not-fail-closed', 'Parseable nonzero runner results must never be classified completed.', path);
  requirePattern(findings, source, /WaitOne\(0\)[\s\S]*RECOVERY_MESH_MUTEX_BUSY/,
    'recovery-launch-mutex-gate-missing', 'Named mutex ownership must gate runner execution.', path);

  for (const [pattern, code, summary] of [
    [/\bInvoke-Expression\b|\bStart-Process\b|\bStart-Job\b|ScriptBlock::Create/i, 'recovery-launch-dynamic-execution-forbidden', 'Dynamic execution is forbidden.'],
    [/Restart-Computer|shutdown\.exe|Stop-Process/i, 'recovery-launch-host-mutation-forbidden', 'Host restart/process mutation is forbidden.'],
    [/Register-ScheduledTask|Start-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask/i, 'recovery-launch-task-mutation-forbidden', 'The hidden launcher may not construct or mutate Scheduled Tasks.'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'recovery-launch-dynamic-powershell-forbidden', 'Dynamic PowerShell command payloads are forbidden.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge)\b/i, 'recovery-launch-git-mutation-forbidden', 'Git mutation is forbidden.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

export function analyzeWindowsAuthorityRecoveryMeshLaunchLivenessReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const path = WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_PATHS_V1[0];
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => source?.path === path);
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head source record is required.', path));
  } else {
    reviewLaunchWrapper(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-recovery-mesh-launch-liveness/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([path]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_RECOVERY_MESH_LAUNCH_LIVENESS_SPECIALIST_FINDINGS',
  });
}
