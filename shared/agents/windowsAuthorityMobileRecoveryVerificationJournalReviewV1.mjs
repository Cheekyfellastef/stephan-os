export const WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1 = Object.freeze([
  'docs/architecture/battle-bridge-recovery-lifeboat-verification-journal-v1.md',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs',
  'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs',
]);

const ESCALATED_PATHS = Object.freeze([
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
]);

const EXPECTED_BLOBS = Object.freeze({
  'docs/architecture/battle-bridge-recovery-lifeboat-verification-journal-v1.md': '022aa589f0604447801c7eaa321f655511e05d5e',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': 'c7d8c1ab0ff3e172b4a366a9d2fa74ffd9afaedb',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': '70567748452d3b2230d668c72b094b99489daa93',
  'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs': '30ed3eb5334a72b01507bac1cc5c1c192027f083',
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function escalationMatches(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== ESCALATED_PATHS.length) return false;
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return false;
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  return JSON.stringify(paths) === JSON.stringify([...ESCALATED_PATHS].sort());
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

function reviewConsumer(source, path, findings) {
  for (const [literal, code] of [
    ['param()', 'm7-consumer-arguments-present'],
    ["$repository = 'Cheekyfellastef/stephan-os'", 'm7-consumer-repository-not-fixed'],
    ["$issueNumber = 1814", 'm7-consumer-issue-not-fixed'],
    ["$ownerLogin = 'Cheekyfellastef'", 'm7-consumer-owner-not-fixed'],
    ["$apiUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1814/comments?per_page=100&page=1'", 'm7-consumer-api-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'm7-consumer-powershell-not-fixed'],
    ["$allowedActions = @('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')", 'm7-consumer-action-set-not-fixed'],
    ["$journalSchema = 'stephanos.battle-bridge-recovery-lifeboat-execution-journal.v1'", 'm7-journal-schema-missing'],
    ["$journalRoot = Join-Path $stateRoot 'execution-journal'", 'm7-journal-root-not-fixed'],
    ['[System.IO.FileMode]::CreateNew', 'm7-exclusive-create-new-missing'],
    ['function Invoke-ReadOnlyProbe()', 'm7-read-only-probe-missing'],
    ['-File $actionPath -Action PROBE_BATTLE_BRIDGE', 'm7-read-only-post-action-proof-missing'],
    ['function Verify-PostAction', 'm7-post-action-verifier-missing'],
    ['function Get-ProbeUtc([object]$Value)', 'm7-probe-time-parser-missing'],
    ['function Test-TaskCurrentlyHealthy([object]$TaskSnapshot, [object]$BaselineSnapshot)', 'm7-fresh-task-verifier-missing'],
    ['return $postRun -gt $baselineRun', 'm7-freshness-comparison-missing'],
    ["$journal.state = 'TERMINAL'", 'm7-terminal-journal-missing'],
    ['RECOVERY_PROBE_VERIFIED', 'm7-probe-verdict-missing'],
    ['RECOVERY_ACTION_TARGET_VERIFIED', 'm7-target-verified-verdict-missing'],
    ['RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED', 'm7-verification-failed-verdict-missing'],
    ['RECOVERY_ACTION_BLOCKED', 'm7-action-blocked-verdict-missing'],
    ['RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY', 'm7-interrupted-no-replay-verdict-missing'],
    ['PREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM', 'm7-interrupted-owner-proof-missing'],
    ['READ_ONLY_POST_CRASH_PROBE_COMPLETE', 'm7-post-crash-read-only-proof-missing'],
    ['RECOVERY_LOCAL_STATE_BLOCKED', 'm7-local-state-blocker-missing'],
    ['INTERRUPTED_CLAIM_MALFORMED', 'm7-malformed-claim-blocker-missing'],
    ['INTERRUPTED_CLAIM_IDENTITY_INVALID', 'm7-claim-identity-blocker-missing'],
    ['INTERRUPTED_CLAIM_ACTION_INVALID', 'm7-claim-action-blocker-missing'],
    ['INTERRUPTED_JOURNAL_MALFORMED', 'm7-malformed-journal-blocker-missing'],
    ['INTERRUPTED_JOURNAL_IDENTITY_INVALID', 'm7-journal-identity-blocker-missing'],
    ['INTERRUPTED_JOURNAL_STATE_INVALID', 'm7-journal-state-blocker-missing'],
    ['INTERRUPTED_JOURNAL_TERMINAL_INVALID', 'm7-journal-terminal-blocker-missing'],
    ['INTERRUPTED_TERMINAL_RECEIPT_MISSING', 'm7-terminal-receipt-missing-blocker-missing'],
    ['INTERRUPTED_TERMINAL_RECEIPT_INVALID', 'm7-terminal-receipt-invalid-blocker-missing'],
    ['recoveredHealthClaimed = $false', 'm7-recovered-health-denial-missing'],
    ['battleBridgeHealthyClaimed = $false', 'm7-battle-bridge-health-denial-missing'],
    ['replayAllowed = $false', 'm7-replay-denial-missing'],
    ['executionReplayAllowed = $false', 'm7-execution-replay-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|cmd\.exe|powershell(?:\.exe)?\s+-Command|Start-Process/i, 'm7-consumer-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'm7-consumer-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'm7-consumer-pc-restart-forbidden'],
    [/Register-ScheduledTask|New-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask|Start-ScheduledTask/i, 'm7-consumer-direct-task-mutation-forbidden'],
    [/param\([^)]*\$(?:Url|Uri|Path|Task|Action|Repository|Issue|Token|Pid|Executable)/is, 'm7-consumer-caller-selection-forbidden'],
    [/Authorization\s*:|Bearer\s+|GITHUB_TOKEN|GH_TOKEN/i, 'm7-consumer-secret-token-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewDoc(source, path, findings) {
  for (const literal of [
    'M7 closes two truth gaps left by M6.',
    'The executable recovery vocabulary remains exactly:',
    'RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY',
    'RECOVERY_LOCAL_STATE_BLOCKED',
    'recoveredHealthClaimed=false',
    'adds no caller-selected URL, path, executable, task, PID, Git ref or shell command',
  ]) requireLiteral(findings, source, path, literal, 'm7-doc-boundary-missing');
}

function reviewConsumerTest(source, path, findings) {
  for (const literal of [
    'GITHUB_RECOVERY_JSON_INVALID',
    'PROBE_BATTLE_BRIDGE',
    'WAKE_CANONICAL_MAILBOX',
    'WAKE_CANONICAL_RECOVERY_MESH',
    'replayAllowed',
  ]) requireLiteral(findings, source, path, literal, 'm7-consumer-static-guard-test-missing');
  forbid(findings, source, path, /node:child_process|require\(['"]child_process/i, 'm7-test-process-authority-forbidden');
}

function reviewJournalTest(source, path, findings) {
  for (const literal of [
    'Invoke-ReadOnlyProbe',
    'Verify-PostAction',
    'postRun -gt',
    'RECOVERY_ACTION_TARGET_VERIFIED',
    'RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED',
    'RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY',
    'PREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM',
    'READ_ONLY_POST_CRASH_PROBE_COMPLETE',
    'RECOVERY_LOCAL_STATE_BLOCKED',
    'INTERRUPTED_CLAIM_MALFORMED',
    'INTERRUPTED_TERMINAL_RECEIPT_INVALID',
    'executionReplayAllowed',
  ]) requireLiteral(findings, source, path, literal, 'm7-verification-static-guard-test-missing');
  forbid(findings, source, path, /node:child_process|require\(['"]child_process/i, 'm7-test-process-authority-forbidden');
}

export function analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === 'Cheekyfellastef/stephan-os'
    && SHA.test(sourceHead)
    && escalationMatches(input.analysis);

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];

  for (const path of WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }

    const source = candidates[0].content;
    if (path === 'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1') reviewConsumer(source, path, findings);
    else if (path === 'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs') reviewConsumerTest(source, path, findings);
    else if (path === 'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs') reviewJournalTest(source, path, findings);
    else reviewDoc(source, path, findings);

    proofRefs.push(`proofs/windows-authority-mobile-recovery-verification-journal/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }

  if (sources.length !== WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
