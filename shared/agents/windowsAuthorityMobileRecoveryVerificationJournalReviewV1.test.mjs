import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1,
  analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview,
} from './windowsAuthorityMobileRecoveryVerificationJournalReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = '7eaec03a9d13b44665fa2d35d7ab26e5b1d94e4b';
const blobs = {
  'docs/architecture/battle-bridge-recovery-lifeboat-verification-journal-v1.md': '022aa589f0604447801c7eaa321f655511e05d5e',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': 'c7d8c1ab0ff3e172b4a366a9d2fa74ffd9afaedb',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': '70567748452d3b2230d668c72b094b99489daa93',
  'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs': '30ed3eb5334a72b01507bac1cc5c1c192027f083',
};
const escalated = [{
  severity: 'P0',
  code: 'unsupported-high-risk-surface',
  path: 'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
}];

const contents = {
  'docs/architecture/battle-bridge-recovery-lifeboat-verification-journal-v1.md': `M7 closes two truth gaps left by M6.\nThe executable recovery vocabulary remains exactly:\nRECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY\nRECOVERY_LOCAL_STATE_BLOCKED\nrecoveredHealthClaimed=false\nadds no caller-selected URL, path, executable, task, PID, Git ref or shell command`,
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': `param()\n$repository = 'Cheekyfellastef/stephan-os'\n$issueNumber = 1814\n$ownerLogin = 'Cheekyfellastef'\n$apiUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1814/comments?per_page=100&page=1'\n$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'\n$allowedActions = @('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')\n$journalSchema = 'stephanos.battle-bridge-recovery-lifeboat-execution-journal.v1'\n$journalRoot = Join-Path $stateRoot 'execution-journal'\n[System.IO.FileMode]::CreateNew\nfunction Invoke-ReadOnlyProbe() {}\n-File $actionPath -Action PROBE_BATTLE_BRIDGE\nfunction Verify-PostAction([string]$Action, [object]$ActionReceipt) {}\nfunction Get-ProbeUtc([object]$Value) {}\nfunction Test-TaskCurrentlyHealthy([object]$TaskSnapshot, [object]$BaselineSnapshot) {}\nreturn $postRun -gt $baselineRun\n$journal.state = 'TERMINAL'\nRECOVERY_PROBE_VERIFIED\nRECOVERY_ACTION_TARGET_VERIFIED\nRECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED\nRECOVERY_ACTION_BLOCKED\nRECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY\nPREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM\nREAD_ONLY_POST_CRASH_PROBE_COMPLETE\nRECOVERY_LOCAL_STATE_BLOCKED\nINTERRUPTED_CLAIM_MALFORMED\nINTERRUPTED_CLAIM_IDENTITY_INVALID\nINTERRUPTED_CLAIM_ACTION_INVALID\nINTERRUPTED_JOURNAL_MALFORMED\nINTERRUPTED_JOURNAL_IDENTITY_INVALID\nINTERRUPTED_JOURNAL_STATE_INVALID\nINTERRUPTED_JOURNAL_TERMINAL_INVALID\nINTERRUPTED_TERMINAL_RECEIPT_MISSING\nINTERRUPTED_TERMINAL_RECEIPT_INVALID\nrecoveredHealthClaimed = $false\nbattleBridgeHealthyClaimed = $false\nreplayAllowed = $false\nexecutionReplayAllowed = $false`,
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': `GITHUB_RECOVERY_JSON_INVALID\nPROBE_BATTLE_BRIDGE\nWAKE_CANONICAL_MAILBOX\nWAKE_CANONICAL_RECOVERY_MESH\nreplayAllowed`,
  'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs': `Invoke-ReadOnlyProbe\nVerify-PostAction\npostRun -gt\nRECOVERY_ACTION_TARGET_VERIFIED\nRECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED\nRECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY\nPREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM\nREAD_ONLY_POST_CRASH_PROBE_COMPLETE\nRECOVERY_LOCAL_STATE_BLOCKED\nINTERRUPTED_CLAIM_MALFORMED\nINTERRUPTED_TERMINAL_RECEIPT_INVALID\nexecutionReplayAllowed`,
};

function input(overrides = {}) {
  const sources = WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1.map((path) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: contents[path].length,
    blobSha: blobs[path],
    content: contents[path],
  }));
  return { repository, sourceHead, analysis: { findings: escalated }, sources, ...overrides };
}

test('qualifies only the exact four-file M7 verification journal estate behind the one Windows escalation', () => {
  const result = analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MOBILE_RECOVERY_VERIFICATION_JOURNAL_PATHS_V1);
});

test('rejects partial, widened or wrong escalation estates', () => {
  assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ analysis: { findings: [] } })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ sources: [...input().sources, input().sources[0]] })).clean, false);
  const wrong = [{ ...escalated[0], path: 'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1' }];
  assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ analysis: { findings: wrong } })).eligible, false);
});

test('rejects changed blob identity and widened shell, task, Git or restart authority', () => {
  const changed = input().sources.map((source) => source.path.includes('github-claim') ? { ...source, blobSha: '0'.repeat(40) } : source);
  assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ sources: changed })).clean, false);
  for (const addition of ['Restart-Computer', 'Start-Process calc.exe', 'git.exe reset --hard', 'Start-ScheduledTask -TaskName x']) {
    const widened = input().sources.map((source) => source.path.includes('github-claim') ? { ...source, content: `${source.content}\n${addition}` } : source);
    assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ sources: widened })).clean, false);
  }
});

test('rejects removed no-replay, freshness, local-state or whole-system-health boundaries', () => {
  for (const literal of [
    'RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY',
    'return $postRun -gt $baselineRun',
    'RECOVERY_LOCAL_STATE_BLOCKED',
    'battleBridgeHealthyClaimed = $false',
  ]) {
    const weakened = input().sources.map((source) => source.path.includes('github-claim') ? { ...source, content: source.content.replace(literal, '') } : source);
    assert.equal(analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ sources: weakened })).clean, false);
  }
});

test('execution replay guard is owned by the dedicated M7 journal test', () => {
  const baseline = input();
  const consumerTest = baseline.sources.find((source) => source.path === 'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs');
  const journalTest = baseline.sources.find((source) => source.path === 'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs');
  assert.doesNotMatch(consumerTest.content, /executionReplayAllowed/);
  assert.match(journalTest.content, /executionReplayAllowed/);
  const weakened = baseline.sources.map((source) => source.path === journalTest.path
    ? { ...source, content: source.content.replace('executionReplayAllowed', '') }
    : source);
  const result = analyzeWindowsAuthorityMobileRecoveryVerificationJournalReview(input({ sources: weakened }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'm7-verification-static-guard-test-missing'));
});
