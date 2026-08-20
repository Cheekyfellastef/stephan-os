import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1 = Object.freeze([
  'scripts/windows/repair-stephanos-battle-bridge.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
]);

export const WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SCHEMA_VERSION = 'stephanos.windows-authority-ignition-convergence-review.v1';

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const REVIEWED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const REVIEWED_PR = 1919;
const REVIEWED_BRANCH = 'fix/ignition-canonical-convergence-gate-v1';
const REVIEWED_SOURCE_HEAD = '34b573d15fe065a35a6c94f9f58a2876811a63b7';
const REVIEWED_BASE_SHA = '3dc12a7c84c54f406b10dee1293789e2338f7824';
const SOURCE_RECORD_KEYS = Object.freeze([
  'blobSha', 'content', 'exists', 'path', 'ref', 'repository', 'schemaVersion', 'size',
]);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function finding(code, summary, path) { return Object.freeze({ severity: 'P0', code, summary, path }); }
function dataValue(record, key) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.getPrototypeOf(record) !== Object.prototype) {
    return Object.freeze({ ok: false, value: undefined });
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
    return Object.freeze({ ok: false, value: undefined });
  }
  return Object.freeze({ ok: true, value: descriptor.value });
}
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function exactPlainRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string') || ownKeys.length !== keys.length) return false;
  const sorted = ownKeys.map(String).sort();
  if (sorted.some((key, index) => key !== keys[index])) return false;
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true;
  });
}
function exactSource(source, repository, sourceHead, path) {
  if (!exactPlainRecord(source, SOURCE_RECORD_KEYS)) return false;
  const content = typeof source.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= MAX_SOURCE_BYTES
    && SHA.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content);
}
function exactArray(value, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength) return false;
  const keys = Reflect.ownKeys(value).map(String);
  const expected = Array.from({ length: expectedLength }, (_, index) => String(index)).concat('length');
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
function exactFinding(item) {
  const severity = dataValue(item, 'severity');
  const code = dataValue(item, 'code');
  const path = dataValue(item, 'path');
  if (!severity.ok || !code.ok || !path.ok) return null;
  if (typeof severity.value !== 'string' || typeof code.value !== 'string' || typeof path.value !== 'string') return null;
  return Object.freeze({ severity: severity.value.trim(), code: code.value.trim(), path: path.value.trim() });
}
function escalationPaths(analysis) {
  const findingsProperty = dataValue(analysis, 'findings');
  if (!findingsProperty.ok || !exactArray(findingsProperty.value, WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length)) return [];
  const normalized = findingsProperty.value.map(exactFinding);
  if (normalized.some((item) => !item
    || item.severity.toUpperCase() !== 'P0'
    || item.code !== 'unsupported-high-risk-surface')) return [];
  const paths = normalized.map((item) => item.path);
  if (new Set(paths).size !== paths.length) return [];
  const sorted = [...paths].sort();
  const expected = [...WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1].sort();
  return sorted.every((path, index) => path === expected[index]) ? expected : [];
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
function parameterPrefix(source) {
  const marker = source.indexOf('$ErrorActionPreference');
  return marker >= 0 ? source.slice(0, marker) : source.slice(0, Math.min(source.length, 4096));
}

function reviewRepair(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead", 'ignition-repair-expected-head-not-mandatory', 'Battle Bridge repair must require one exact approved head.'],
    ["$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'ignition-repair-git-not-fixed', 'Battle Bridge repair must use fixed canonical Git.'],
    ['function Assert-ExpectedHeadImmediatelyBeforeMutation', 'ignition-repair-pre-mutation-head-gate-missing', 'Every consequential repair stage must retain the exact-head mutation gate.'],
    ['function Test-BackendExactHeadHealth', 'ignition-repair-backend-head-health-missing', 'Backend health must bind HTTP health to the expected source head.'],
    ['$payload.schemaVersion', 'ignition-repair-backend-schema-identity-missing', 'Backend health must verify the canonical health schema.'],
    ["'stephanos.backend-health.v1'", 'ignition-repair-backend-schema-value-missing', 'Backend health must require the canonical health schema value.'],
    ['$payload.backendIdentity.runtimeId', 'ignition-repair-backend-runtime-identity-missing', 'Backend health must verify the canonical runtime identity.'],
    ["'stephanos-battle-bridge-backend'", 'ignition-repair-backend-runtime-value-missing', 'Backend health must require the canonical backend runtime identifier.'],
    ['BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH', 'ignition-repair-backend-schema-mismatch-not-blocked', 'Wrong or missing backend schema must fail closed.'],
    ['BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH', 'ignition-repair-backend-runtime-mismatch-not-blocked', 'Wrong or missing backend runtime identity must fail closed.'],
    ['$payload.backendIdentity.sourceHead', 'ignition-repair-backend-identity-missing', 'Backend health must read the canonical backend source-head identity.'],
    ['BACKEND_HEALTH_SOURCE_HEAD_MISSING_OR_INVALID', 'ignition-repair-backend-missing-head-not-blocked', 'Missing backend source identity must fail closed.'],
    ['BACKEND_HEALTH_SOURCE_HEAD_MISMATCH', 'ignition-repair-backend-head-mismatch-not-blocked', 'Wrong-head backend health must fail closed.'],
    ['Test-BackendExactHeadHealth -Url $localHealthUrl -ExpectedSourceHead $ExpectedHead', 'ignition-repair-local-head-health-not-bound', 'Local backend health must be exact-head bound.'],
    ['Test-BackendExactHeadHealth -Url $hostedHealthUrl -ExpectedSourceHead $ExpectedHead', 'ignition-repair-hosted-head-health-not-bound', 'Hosted backend health must be exact-head bound.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend starter child'", 'ignition-repair-backend-child-gate-missing', 'Backend child start must be re-gated immediately before mutation.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'Tailscale Serve repair'", 'ignition-repair-tailscale-gate-missing', 'Tailscale Serve repair must be re-gated immediately before mutation.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'", 'ignition-repair-openclaw-gate-missing', 'OpenClaw adapter ensure must be re-gated immediately before mutation.'],
    ['npm run --silent openclaw:stub:ensure', 'ignition-repair-openclaw-command-not-fixed', 'OpenClaw repair must remain the fixed readonly stub ensure command.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  const params = parameterPrefix(source);
  if (/\$(?:Path|Executable|Command|TaskName|Url|Uri|Script|Arguments?)\b/i.test(params)) {
    findings.push(finding('ignition-repair-caller-command-authority-forbidden', 'Repair parameters may not accept caller-selected paths, executables, tasks, commands or URLs.', path));
  }
  forbidPattern(findings, source, /\b(?:Invoke-Expression|Invoke-Command|Start-Job|ScriptBlock::Create)\b/i, 'ignition-repair-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbidPattern(findings, source, /\bgit(?:\.exe)?\s+(?:reset|clean|checkout|switch|rebase|push|merge)\b/i, 'ignition-repair-destructive-git-forbidden', 'Repair must not gain destructive or publishing Git authority.', path);
}

function reviewRestart(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[ValidateSet('backend', 'mission-worker')]", 'ignition-restart-target-not-closed', 'Approved runtime restart target must remain a closed two-value set.'],
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'ignition-restart-head-not-exact', 'Approved runtime restart must require an exact source head.'],
    ["'Stephanos Battle Bridge Backend'", 'ignition-restart-backend-task-not-fixed', 'Backend Scheduled Task identity must remain fixed.'],
    ["'Stephanos Mission Orchestrator Worker'", 'ignition-restart-worker-task-not-fixed', 'Mission Worker Scheduled Task identity must remain fixed.'],
    ['NON_CANONICAL_REPOSITORY_PATH', 'ignition-restart-canonical-root-gate-missing', 'Runtime restart must fail closed outside the canonical repository root.'],
    ['EXPECTED_HEAD_MISMATCH', 'ignition-restart-source-head-gate-missing', 'Runtime restart must fail closed on source-head drift.'],
    ["if ($Target -eq 'backend' -and [string]$task.Settings.MultipleInstances -ne 'IgnoreNew')", 'ignition-restart-backend-overlap-gate-missing', 'Backend task must prove IgnoreNew before repair.'],
    ['Publish-BackendExpectedHeadHandoff', 'ignition-restart-handoff-missing', 'Approved backend restart must preserve the expected head through the scheduled-task boundary.'],
    ["schemaVersion = 'stephanos.backend-expected-head-handoff.v1'", 'ignition-restart-handoff-schema-missing', 'Expected-head handoff must use the fixed schema.'],
    ["expiresAtUtc = $issuedAtUtc.AddMinutes(2).ToString('o')", 'ignition-restart-handoff-expiry-not-bounded', 'Expected-head handoff must remain short lived.'],
    ['Disable-ScheduledTask -TaskName $plan.TaskName', 'ignition-restart-task-quiesce-missing', 'Backend task must be quiesced before handoff publication.'],
    ['BACKEND_TASK_NOT_QUIESCENT_BEFORE_HANDOFF', 'ignition-restart-quiescence-proof-missing', 'Backend handoff requires an explicit quiescence proof.'],
    ['BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_HANDOFF', 'ignition-restart-pre-handoff-overlap-proof-missing', 'IgnoreNew must be re-proved before handoff publication.'],
    ['BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START', 'ignition-restart-pre-start-overlap-proof-missing', 'IgnoreNew must be re-proved before task start.'],
    ['Read-FreshBackendReceipt', 'ignition-restart-backend-receipt-proof-missing', 'Backend restart must require a fresh exact-head runtime receipt.'],
    ['Read-FreshWorkerHeartbeat', 'ignition-restart-worker-heartbeat-proof-missing', 'Mission Worker restart must require a fresh exact-head heartbeat.'],
    ['arbitraryTaskTargetAllowed = $false', 'ignition-restart-arbitrary-task-authority-not-zero', 'Arbitrary Scheduled Task authority must remain denied.'],
    ['arbitraryProcessKillAllowed = $false', 'ignition-restart-arbitrary-process-authority-not-zero', 'Arbitrary process-kill authority must remain denied.'],
    ['verifiedOwnedProcessTerminationOnly = $true', 'ignition-restart-process-ownership-proof-missing', 'Any process termination must remain restricted to verified owned processes.'],
    ['liveOpenClawUpdatePerformed = $false', 'ignition-restart-openclaw-authority-not-zero', 'Runtime restart must not acquire live OpenClaw update authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  requirePattern(findings, source, /Stop-Process\s+-Id\s+\$listener\.ProcessId\s+-Force/, 'ignition-restart-backend-stop-not-identity-bound', 'Backend process termination must use the verified listener identity.', path);
  requirePattern(findings, source, /Stop-Process\s+-Id\s+\$oldWorker\.ProcessId\s+-Force/, 'ignition-restart-worker-stop-not-identity-bound', 'Worker process termination must use the verified heartbeat identity.', path);
  const params = parameterPrefix(source);
  if (/\$(?:Path|Executable|Command|TaskName|Url|Uri|Script|Arguments?)\b/i.test(params)) {
    findings.push(finding('ignition-restart-caller-command-authority-forbidden', 'Restart parameters may not accept caller-selected paths, executables, tasks, commands or URLs.', path));
  }
  forbidPattern(findings, source, /\b(?:Invoke-Expression|Invoke-Command|Start-Job|ScriptBlock::Create)\b/i, 'ignition-restart-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbidPattern(findings, source, /\bgit(?:\.exe)?\s+(?:reset|clean|checkout|switch|rebase|push|merge)\b/i, 'ignition-restart-destructive-git-forbidden', 'Restart must not gain destructive or publishing Git authority.', path);
}

function reviewBackendStart(source, path, findings) {
  for (const [literal, code, summary] of [
    ["$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'ignition-backend-git-not-fixed', 'Backend start must use fixed canonical Git.'],
    ["$canonicalNpm = 'C:\\Program Files\\nodejs\\npm.cmd'", 'ignition-backend-npm-not-fixed', 'Backend start must use fixed canonical npm.'],
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'ignition-backend-node-not-fixed', 'Backend start must use fixed canonical Node.'],
    ['function Assert-ExpectedHeadImmediatelyBeforeMutation', 'ignition-backend-pre-mutation-head-gate-missing', 'Backend start must re-prove the expected head before mutation.'],
    ['function Read-BackendExpectedHeadHandoff', 'ignition-backend-handoff-consumer-missing', 'Scheduled backend start must consume the bounded expected-head handoff.'],
    ["schemaVersion -ne 'stephanos.backend-expected-head-handoff.v1'", 'ignition-backend-handoff-schema-gate-missing', 'Backend handoff must be schema checked.'],
    ['BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED', 'ignition-backend-handoff-expiry-gate-missing', 'Expired backend handoffs must fail closed.'],
    ['BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID', 'ignition-backend-handoff-time-gate-missing', 'Malformed backend handoff time windows must fail closed.'],
    ["if ($branch -ne 'main')", 'ignition-backend-main-gate-missing', 'Backend start must require canonical main.'],
    ["if ($upstream -ne 'origin/main')", 'ignition-backend-upstream-gate-missing', 'Backend start must require canonical origin/main upstream.'],
    ['if ($originHead -ne $headSha)', 'ignition-backend-origin-head-gate-missing', 'Backend start must require synchronized local and origin/main heads.'],
    ['if ($headSha -ne $boundExpectedHead)', 'ignition-backend-expected-head-binding-missing', 'Backend start must bind the observed head to the approved expected head.'],
    ['Get-TrackedWorktreeAssessment -StatusLines $trackedStatus', 'ignition-backend-source-dirt-classifier-missing', 'Backend start must classify tracked worktree state before mutation.'],
    ['if ($trackedAssessment.SourceDirt.Count -ne 0)', 'ignition-backend-source-dirt-gate-missing', 'Source dirt must remain fail closed.'],
    ['Test-BackendHealth -Url $healthUrl -ExpectedSourceHead $headSha', 'ignition-backend-health-head-binding-missing', 'Backend health must prove the exact source head.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'", 'ignition-backend-openclaw-gate-missing', 'Readonly OpenClaw ensure must be exact-head gated.'],
    ["$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha", 'ignition-backend-child-head-binding-missing', 'The Node backend child must inherit the exact approved source head.'],
    ["$arguments = @('run', 'stephanos:backend')", 'ignition-backend-command-not-fixed', 'Backend npm command must remain fixed.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start'", 'ignition-backend-process-start-gate-missing', 'Backend process creation must be re-gated immediately before mutation.'],
    ['Start-Process -FilePath $canonicalNpm', 'ignition-backend-process-executable-not-fixed', 'Backend process start must use fixed canonical npm.'],
    ['Publish-VerifiedBackendRuntimeReceipt', 'ignition-backend-runtime-receipt-proof-missing', 'Backend success must publish only after listener and exact-head health proof.'],
    ['arbitraryShellAllowed = $false', 'ignition-backend-arbitrary-shell-authority-not-zero', 'Backend receipt must deny arbitrary shell authority.'],
    ['sourceMutationAllowed = $false', 'ignition-backend-source-authority-not-zero', 'Backend receipt must deny source mutation authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  const params = parameterPrefix(source);
  if (/\$(?:Path|Executable|Command|TaskName|Url|Uri|Script|Arguments?)\b/i.test(params)) {
    findings.push(finding('ignition-backend-caller-command-authority-forbidden', 'Backend parameters may not accept caller-selected paths, executables, tasks, commands or URLs.', path));
  }
  forbidPattern(findings, source, /\b(?:Invoke-Expression|Invoke-Command|Start-Job|ScriptBlock::Create)\b/i, 'ignition-backend-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbidPattern(findings, source, /\bgit(?:\.exe)?\s+(?:reset|clean|checkout|switch|rebase|push|merge)\b/i, 'ignition-backend-destructive-git-forbidden', 'Backend start must not gain destructive or publishing Git authority.', path);
}

export function analyzeWindowsAuthorityIgnitionConvergenceReview(input = {}) {
  const repositoryProperty = dataValue(input, 'repository');
  const prProperty = dataValue(input, 'prNumber');
  const branchProperty = dataValue(input, 'branch');
  const headProperty = dataValue(input, 'sourceHead');
  const baseProperty = dataValue(input, 'baseSha');
  const analysisProperty = dataValue(input, 'analysis');
  const sourcesProperty = dataValue(input, 'sources');
  if (!repositoryProperty.ok || !prProperty.ok || !branchProperty.ok || !headProperty.ok
    || !baseProperty.ok || !analysisProperty.ok || !sourcesProperty.ok) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_NOT_ELIGIBLE' });
  }
  const repository = text(repositoryProperty.value);
  const prNumber = prProperty.value;
  const branch = text(branchProperty.value);
  const sourceHead = text(headProperty.value).toLowerCase();
  const baseSha = text(baseProperty.value).toLowerCase();
  const paths = escalationPaths(analysisProperty.value);
  if (repository !== REVIEWED_REPOSITORY || !Number.isSafeInteger(prNumber) || prNumber !== REVIEWED_PR
    || branch !== REVIEWED_BRANCH || sourceHead !== REVIEWED_SOURCE_HEAD || baseSha !== REVIEWED_BASE_SHA
    || paths.length !== WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = sourcesProperty.value;
  const findings = [];
  const proofRefs = [];
  if (!exactArray(sources, WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length)) {
    findings.push(finding('windows-authority-source-estate-invalid', 'Exactly three closed-world immutable source records are required.', WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0]));
  } else {
    for (const path of WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1) {
      const candidates = sources.filter((source) => exactPlainRecord(source, SOURCE_RECORD_KEYS) && source.path === path);
      if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
        findings.push(finding('windows-authority-source-evidence-invalid', 'One immutable exact-head source record is required for every reviewed path.', path));
        continue;
      }
      const content = candidates[0].content;
      if (path.endsWith('/repair-stephanos-battle-bridge.ps1')) reviewRepair(content, path, findings);
      else if (path.endsWith('/restart-approved-stephanos-runtime.ps1')) reviewRestart(content, path, findings);
      else reviewBackendStart(content, path, findings);
      proofRefs.push(`proofs/windows-authority-ignition-convergence/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
    }
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SCHEMA_VERSION,
    eligible: true,
    clean,
    reviewedSourceHead: REVIEWED_SOURCE_HEAD,
    reviewedBaseSha: REVIEWED_BASE_SHA,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([...WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1]),
    proofRefs: Object.freeze(proofRefs),
    mergeAuthority: false,
    runtimeAuthority: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_FINDINGS',
  });
}