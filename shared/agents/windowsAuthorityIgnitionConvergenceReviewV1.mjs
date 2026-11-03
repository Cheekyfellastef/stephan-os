import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1 = Object.freeze([
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/repair-stephanos-battle-bridge.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
]);

export const WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_BLOBS_V1 = Object.freeze({
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1': '132460b4e131786a65da03aaaf9215bcff8de1d6',
  'scripts/windows/repair-stephanos-battle-bridge.ps1': 'c53aea4971932f9758992d8ce7cbb75e75ae6c06',
  'scripts/windows/restart-approved-stephanos-runtime.ps1': '04ac9ee1d87d5ace47f4904ad89b167b418edbd3',
  'scripts/windows/start-stephanos-backend.ps1': 'a13ce1f3f5c1b23cfcfc38343698c5e5de42bac1',
});

export const WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SCHEMA_VERSION = 'stephanos.windows-authority-ignition-convergence-review.v1';

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const REVIEWED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const REVIEWED_PR = 1919;
const REVIEWED_BRANCH = 'fix/ignition-canonical-convergence-gate-v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const LINEAGE_KEYS = Object.freeze([
  'baseSha', 'comparison', 'liveMainAfterSha', 'liveMainBeforeSha', 'parents',
  'repository', 'schemaVersion', 'sourceCommitSha', 'sourceHead',
]);
const COMPARISON_KEYS = Object.freeze([
  'aheadBy', 'baseCommitSha', 'behindBy', 'mergeBaseCommitSha', 'status',
]);
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
function exactSource(source, repository, sourceHead, path, expectedBlobSha) {
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
    && source.blobSha === gitBlobSha(content)
    && source.blobSha === expectedBlobSha;
}
function exactArray(value, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength) return false;
  const ownKeys = Reflect.ownKeys(value);
  const keys = ownKeys.map(String);
  const expected = Array.from({ length: expectedLength }, (_, index) => String(index)).concat('length');
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) return false;
  return Array.from({ length: expectedLength }, (_, index) => String(index)).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true;
  });
}
function exactReviewedLineage(lineage, repository, sourceHead, baseSha) {
  try {
    if (!SHA.test(sourceHead) || !SHA.test(baseSha) || sourceHead === baseSha
      || !exactPlainRecord(lineage, LINEAGE_KEYS)
      || lineage.schemaVersion !== LINEAGE_SCHEMA
      || lineage.repository !== repository
      || lineage.sourceHead !== sourceHead
      || lineage.sourceCommitSha !== sourceHead
      || lineage.baseSha !== baseSha
      || lineage.liveMainBeforeSha !== baseSha
      || lineage.liveMainAfterSha !== baseSha
      || !exactArray(lineage.parents, 2)
      || typeof lineage.parents[0] !== 'string'
      || typeof lineage.parents[1] !== 'string'
      || !SHA.test(lineage.parents[0])
      || !SHA.test(lineage.parents[1])
      || lineage.parents[0] === sourceHead
      || lineage.parents[0] === baseSha
      || lineage.parents[1] !== baseSha
      || !exactPlainRecord(lineage.comparison, COMPARISON_KEYS)) return false;
    const comparison = lineage.comparison;
    return comparison.status === 'ahead'
      && Number.isSafeInteger(comparison.aheadBy)
      && comparison.aheadBy >= 1
      && comparison.behindBy === 0
      && comparison.baseCommitSha === baseSha
      && comparison.mergeBaseCommitSha === baseSha;
  } catch {
    return false;
  }
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

function reviewProbe(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[ValidateSet('Inspect', 'Recover')]", 'ignition-probe-mode-not-closed', 'Recovery probe mode must remain a closed Inspect/Recover choice.'],
    ["$wscriptPath = 'C:\\Windows\\System32\\wscript.exe'", 'ignition-probe-wscript-not-fixed', 'Recovery probe must pin canonical WScript.'],
    ["$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'ignition-probe-powershell-not-fixed', 'Recovery probe must pin canonical Windows PowerShell.'],
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'ignition-probe-node-not-fixed', 'Recovery probe must pin canonical Node.'],
    ["$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'ignition-probe-git-not-fixed', 'Recovery probe must pin canonical Git.'],
    ["$canonicalBootstrapEval = \"import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)\"", 'ignition-probe-bootstrap-command-not-fixed', 'Backend listener proof must require the immutable-bootstrap command.'],
    ["'Stephanos Battle Bridge Backend'", 'ignition-probe-backend-task-not-fixed', 'Backend Scheduled Task identity must remain fixed.'],
    ["'Stephanos Mission Orchestrator Worker Watchdog'", 'ignition-probe-watchdog-task-not-fixed', 'Worker watchdog Scheduled Task identity must remain fixed.'],
    ["'Stephanos Battle Bridge GitHub Command Mailbox'", 'ignition-probe-mailbox-task-not-fixed', 'Mailbox Scheduled Task identity must remain fixed.'],
    ["'OpenClaw Gateway'", 'ignition-probe-openclaw-task-not-fixed', 'OpenClaw Scheduled Task identity must remain fixed.'],
    ["[string]$Task.Settings.MultipleInstances -eq 'IgnoreNew'", 'ignition-probe-overlap-proof-missing', 'Every accepted task must prove IgnoreNew.'],
    ['BACKEND_LISTENER_EXECUTABLE_FOREIGN', 'ignition-probe-backend-node-mismatch-not-blocked', 'A non-canonical backend Node executable must fail closed.'],
    ['BACKEND_LISTENER_COMMAND_FOREIGN', 'ignition-probe-backend-command-mismatch-not-blocked', 'A backend listener outside the immutable-bootstrap command must fail closed.'],
    ['$raw = & $canonicalNode $backendFreshnessProbePath --expected-source-head $ExpectedSourceHead', 'ignition-probe-backend-head-proof-not-bound', 'Backend freshness proof must receive the exact source head.'],
    ["[string]$receipt.schemaVersion -eq 'stephanos.backend-runtime.v1'", 'ignition-probe-runtime-receipt-schema-missing', 'Backend receipt proof must require the canonical runtime schema.'],
    ['([string]$receipt.headSha).ToLowerInvariant() -eq $ExpectedSourceHead', 'ignition-probe-runtime-receipt-head-missing', 'Backend receipt proof must bind the exact source head.'],
    ['[int]$receipt.pid -eq $listenerAfter.pid', 'ignition-probe-runtime-receipt-pid-missing', 'Backend receipt proof must bind the verified listener PID.'],
    ['[string]$receipt.processStartTimeUtc -eq $listenerAfter.creationTimeUtc', 'ignition-probe-runtime-receipt-start-time-missing', 'Backend receipt proof must bind process creation identity.'],
    ["[string]$proof.finalVerdict -eq 'BACKEND_CURRENT'", 'ignition-probe-backend-current-verdict-missing', 'Backend freshness must end in the canonical current verdict.'],
    ["if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'main')", 'ignition-probe-main-head-gate-missing', 'Recovery probe must bind canonical main to one exact source head.'],
    ['Assert-CanonicalTrackedWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot', 'ignition-probe-source-clean-gate-missing', 'Recovery probe must fail closed on tracked source dirt.'],
    ['Start-ScheduledTask -TaskName $spec.Name', 'ignition-probe-task-start-not-allowlisted', 'Recovery may start only a task from the fixed task estate.'],
    ['maximumTaskStarts = 4', 'ignition-probe-start-budget-not-fixed', 'Recovery task starts must remain bounded to the four fixed services.'],
    ['arbitraryTaskNameAllowed = $false', 'ignition-probe-arbitrary-task-authority-not-zero', 'Recovery probe must deny arbitrary task authority.'],
    ['arbitraryPowerShellAllowed = $false', 'ignition-probe-arbitrary-powershell-authority-not-zero', 'Recovery probe must deny arbitrary PowerShell authority.'],
    ['sourceMutationAllowed = $false', 'ignition-probe-source-authority-not-zero', 'Recovery probe must deny source mutation authority.'],
    ['pcRestartAllowed = $false', 'ignition-probe-pc-restart-authority-not-zero', 'Recovery probe must deny PC restart authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  requirePattern(findings, source, /if\s*\(-not\s+\$observed\.authorityCanonical\)\s*\{\s*continue\s*\}/, 'ignition-probe-task-authority-gate-missing', 'Recovery must refuse non-canonical task authority before start.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$executable,\s*\$canonicalNode[\s\S]*Test-CanonicalBackendCommandLine/, 'ignition-probe-listener-identity-incomplete', 'Backend listener proof must bind canonical Node and the fixed command.', path);
  const params = parameterPrefix(source);
  if (/\$(?:Path|Executable|Command|TaskName|Url|Uri|Script|Arguments?)\b/i.test(params)) {
    findings.push(finding('ignition-probe-caller-command-authority-forbidden', 'Probe parameters may not accept caller-selected paths, executables, tasks, commands or URLs.', path));
  }
  forbidPattern(findings, source, /\b(?:Invoke-Expression|Invoke-Command|Start-Job|ScriptBlock::Create)\b/i, 'ignition-probe-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbidPattern(findings, source, /\bgit(?:\.exe)?\s+(?:reset|clean|checkout|switch|rebase|push|merge)\b/i, 'ignition-probe-destructive-git-forbidden', 'Recovery probe must not gain destructive or publishing Git authority.', path);
  forbidPattern(findings, source, /\b(?:Stop-Process|taskkill|Restart-Computer|shutdown\.exe)\b/i, 'ignition-probe-process-or-host-mutation-forbidden', 'Recovery probe must not gain process termination or host restart authority.', path);
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
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'ignition-restart-backend-node-not-fixed', 'Backend listener verification must require fixed canonical Node.'],
    ["$canonicalBootstrapEval = \"import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)\"", 'ignition-restart-backend-bootstrap-command-not-fixed', 'Backend listener verification must require the fixed immutable-bootstrap command.'],
    ['$process.ExecutablePath', 'ignition-restart-backend-executable-identity-missing', 'Backend listener verification must inspect the executable identity.'],
    ['BACKEND_LISTENER_NOT_CANONICAL_NODE', 'ignition-restart-backend-node-mismatch-not-blocked', 'A non-canonical backend Node executable must fail closed.'],
    ['BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED', 'ignition-restart-backend-command-mismatch-not-blocked', 'A backend listener outside the fixed immutable-bootstrap command must fail closed.'],
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
    ["$canonicalBootstrapEval = \"import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)\"", 'ignition-backend-bootstrap-command-not-fixed', 'Backend start must use the fixed process-bound immutable bootstrap command.'],
    ["$env:GIT_NO_REPLACE_OBJECTS = '1'", 'ignition-backend-git-replacement-bypass-not-disabled', 'Backend exact-head materialization must disable Git replacement objects.'],
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
    ['function Get-ExactHeadBackendBootstrapBase64', 'ignition-backend-bootstrap-materializer-missing', 'Backend start must materialize its bootstrap from the exact approved Git object.'],
    ["$bootstrapGitPath = 'stephanos-server/backend-bootstrap.mjs'", 'ignition-backend-bootstrap-path-not-fixed', 'Backend bootstrap path must remain fixed.'],
    ['BACKEND_EXACT_HEAD_BOOTSTRAP_HASH_MISMATCH', 'ignition-backend-bootstrap-hash-gate-missing', 'Materialized bootstrap bytes must be verified against the exact Git blob.'],
    ['function Start-BackendNodeWithMinimalEnvironment', 'ignition-backend-minimal-environment-launcher-missing', 'Backend child launch must use the fixed minimal-environment boundary.'],
    ["$minimalEnvironment['STEPHANOS_BACKEND_SOURCE_HEAD'] = $SourceHead", 'ignition-backend-child-head-binding-missing', 'The Node backend child must inherit the exact approved source head.'],
    ["$minimalEnvironment['STEPHANOS_BACKEND_REPO_ROOT'] = $RepositoryRoot", 'ignition-backend-child-root-binding-missing', 'The backend child must inherit the canonical repository root explicitly.'],
    ["$minimalEnvironment['STEPHANOS_BACKEND_BOOTSTRAP_BASE64'] = $BootstrapBase64", 'ignition-backend-child-bootstrap-binding-missing', 'The backend child must receive only the verified exact-head bootstrap bytes.'],
    ["$arguments = @('--input-type=module', '--eval'", 'ignition-backend-command-not-fixed', 'Backend Node command must remain the fixed module eval bootstrap.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'exact-head bootstrap capture'", 'ignition-backend-bootstrap-capture-gate-missing', 'Exact-head bootstrap capture must be re-gated immediately before materialization.'],
    ['$bootstrapBase64 = Get-ExactHeadBackendBootstrapBase64 -RepositoryRoot $repoRoot -HeadSha $headSha', 'ignition-backend-bootstrap-capture-not-bound', 'Bootstrap capture must bind the canonical root to the exact approved head.'],
    ["Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start'", 'ignition-backend-process-start-gate-missing', 'Backend process creation must be re-gated immediately before mutation.'],
    ['Start-BackendNodeWithMinimalEnvironment', 'ignition-backend-process-executable-not-fixed', 'Backend process start must use the fixed canonical Node/minimal-environment launcher.'],
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

function analyzeWithReviewedBlobs(input, reviewedBlobs) {
  const repositoryProperty = dataValue(input, 'repository');
  const prProperty = dataValue(input, 'prNumber');
  const branchProperty = dataValue(input, 'branch');
  const headProperty = dataValue(input, 'sourceHead');
  const baseProperty = dataValue(input, 'baseSha');
  const lineageProperty = dataValue(input, 'lineageEvidence');
  const analysisProperty = dataValue(input, 'analysis');
  const sourcesProperty = dataValue(input, 'sources');
  if (!repositoryProperty.ok || !prProperty.ok || !branchProperty.ok || !headProperty.ok
    || !baseProperty.ok || !lineageProperty.ok || !analysisProperty.ok || !sourcesProperty.ok) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_NOT_ELIGIBLE' });
  }
  const repository = text(repositoryProperty.value);
  const prNumber = prProperty.value;
  const branch = text(branchProperty.value);
  const sourceHead = text(headProperty.value).toLowerCase();
  const baseSha = text(baseProperty.value).toLowerCase();
  const paths = escalationPaths(analysisProperty.value);
  if (repository !== REVIEWED_REPOSITORY || !Number.isSafeInteger(prNumber) || prNumber !== REVIEWED_PR
    || branch !== REVIEWED_BRANCH || !exactReviewedLineage(lineageProperty.value, repository, sourceHead, baseSha)
    || paths.length !== WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_NOT_ELIGIBLE' });
  }
  const sources = sourcesProperty.value;
  const findings = [];
  const proofRefs = [];
  if (!exactArray(sources, WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length)) {
    findings.push(finding('windows-authority-source-estate-invalid', 'Exactly four closed-world immutable source records are required.', WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0]));
  } else {
    for (const path of WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1) {
      const candidates = sources.filter((source) => exactPlainRecord(source, SOURCE_RECORD_KEYS) && source.path === path);
      if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path, reviewedBlobs[path])) {
        findings.push(finding('windows-authority-source-evidence-invalid', 'One immutable exact-head source record matching the independently reviewed Git blob is required for every reviewed path.', path));
        continue;
      }
      const content = candidates[0].content;
      if (path.endsWith('/probe-battle-bridge-recovery-mesh.ps1')) reviewProbe(content, path, findings);
      else if (path.endsWith('/repair-stephanos-battle-bridge.ps1')) reviewRepair(content, path, findings);
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
    reviewedSourceHead: sourceHead,
    reviewedBaseSha: baseSha,
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

export function analyzeWindowsAuthorityIgnitionConvergenceReview(input = {}) {
  return analyzeWithReviewedBlobs(input, WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_BLOBS_V1);
}

export function analyzeWindowsAuthorityIgnitionConvergenceReviewWithFixtureBlobsForTest(input = {}, reviewedBlobs = {}) {
  const keys = [...WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1].sort();
  if (!exactPlainRecord(reviewedBlobs, keys)
    || keys.some((path) => !SHA.test(text(reviewedBlobs[path])))) {
    throw new TypeError('WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_TEST_BLOB_MANIFEST_INVALID');
  }
  return analyzeWithReviewedBlobs(input, reviewedBlobs);
}
