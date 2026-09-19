export const WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1 = Object.freeze([
  'docs/architecture/openclaw-battle-bridge-recovery-executor-v1.md',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.mjs',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.test.mjs',
]);

const EXPECTED_BLOBS = Object.freeze({
  'docs/architecture/openclaw-battle-bridge-recovery-executor-v1.md': 'd0b4fce021231972273984642d5f65c6716ba104',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1': '358715c705bb4c6d4a1c65fe2f5dcc35a5062651',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.mjs': '0766411666607dcf0e4942af57f6d00b54011c6d',
  'shared/agents/openClawBattleBridgeRecoveryExecutorV1.test.mjs': 'ff9b0b3f74e699be656aa4e280df7a1e28cc7a13',
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1.length) return [];
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return [];
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  const expected = [...WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1].sort();
  return JSON.stringify(paths) === JSON.stringify(expected) ? paths : [];
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

function reviewExecutor(source, path, findings) {
  for (const [literal, code] of [
    ["'PROBE_BATTLE_BRIDGE'", 'mobile-recovery-probe-action-missing'],
    ["'WAKE_CANONICAL_MAILBOX'", 'mobile-recovery-mailbox-action-missing'],
    ["'WAKE_CANONICAL_RECOVERY_MESH'", 'mobile-recovery-mesh-action-missing'],
    ["fixedAdapterRelativePath: OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH", 'mobile-recovery-fixed-adapter-missing'],
    ["freshPostActionProofRequired: true", 'mobile-recovery-fresh-proof-missing'],
    ["arbitraryShellAllowed: false", 'mobile-recovery-shell-denial-missing'],
    ["callerSelectedTaskAllowed: false", 'mobile-recovery-task-denial-missing'],
    ["gitMutationAllowed: false", 'mobile-recovery-git-denial-missing'],
    ["sourceMutationAllowed: false", 'mobile-recovery-source-denial-missing'],
    ["pcRestartAllowed: false", 'mobile-recovery-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /child_process|execSync|spawnSync|Invoke-Expression|cmd\.exe/i, 'mobile-recovery-dynamic-execution-forbidden');
}

function reviewPowerShell(source, path, findings) {
  for (const [literal, code] of [
    ["[ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')]", 'mobile-recovery-action-validateset-missing'],
    ["$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'", 'mobile-recovery-wscript-not-fixed'],
    ["$mailboxTask = 'Stephanos Battle Bridge GitHub Command Mailbox'", 'mobile-recovery-mailbox-task-not-fixed'],
    ["$recoveryMeshTask = 'Stephanos Battle Bridge Recovery Mesh'", 'mobile-recovery-mesh-task-not-fixed'],
    ["Start-ScheduledTask -TaskName $TaskName", 'mobile-recovery-fixed-task-start-missing'],
    ["freshPostActionProofRequired = $true", 'mobile-recovery-fresh-proof-missing'],
    ["arbitraryShellAllowed = $false", 'mobile-recovery-shell-denial-missing'],
    ["callerSelectedTaskAllowed = $false", 'mobile-recovery-task-denial-missing'],
    ["gitMutationAllowed = $false", 'mobile-recovery-git-denial-missing'],
    ["sourceMutationAllowed = $false", 'mobile-recovery-source-denial-missing'],
    ["pcRestartAllowed = $false", 'mobile-recovery-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  for (const [pattern, code] of [
    [/\b(?:Register|Unregister)-ScheduledTask\b|\bNew-ScheduledTask/i, 'mobile-recovery-task-construction-forbidden'],
    [/Invoke-Expression|\biex\b|Start-Process|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'mobile-recovery-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'mobile-recovery-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe|Stop-Process/i, 'mobile-recovery-expanded-restart-authority'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewTest(source, path, findings) {
  for (const literal of [
    "assert.doesNotMatch(source, /Invoke-Expression/i)",
    "assert.doesNotMatch(source, /Start-Process/i)",
    "assert.doesNotMatch(source, /git\\.exe/i)",
    "assert.doesNotMatch(source, /Restart-Computer/i)",
  ]) requireLiteral(findings, source, path, literal, 'mobile-recovery-static-guard-test-missing');
  forbid(findings, source, path, /node:child_process|require\(['\"]child_process/i, 'mobile-recovery-test-process-authority-forbidden');
}

function reviewDoc(source, path, findings) {
  for (const literal of [
    '`PROBE_BATTLE_BRIDGE`',
    '`WAKE_CANONICAL_MAILBOX`',
    '`WAKE_CANONICAL_RECOVERY_MESH`',
    'freshPostActionProofRequired=true',
    'does not install the lifeboat',
  ]) requireLiteral(findings, source, path, literal, 'mobile-recovery-doc-boundary-missing');
}

export function analyzeWindowsAuthorityMobileRecoveryExecutorReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository === 'Cheekyfellastef/stephan-os'
    && SHA.test(sourceHead)
    && paths.length === WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1.length;
  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('.ps1')) reviewPowerShell(source, path, findings);
    else if (path.endsWith('.test.mjs')) reviewTest(source, path, findings);
    else if (path.endsWith('.md')) reviewDoc(source, path, findings);
    else reviewExecutor(source, path, findings);
    proofRefs.push(`proofs/windows-authority-mobile-recovery-executor/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_MOBILE_RECOVERY_EXECUTOR_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
