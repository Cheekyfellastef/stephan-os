import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1,
  analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview,
} from './windowsAuthorityMobileRecoveryGitHubConsumerReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = '4783d12311e19c0ca1294136f0745c43d569d66d';
const blobs = {
  'docs/architecture/battle-bridge-recovery-lifeboat-github-consumer-v1.md': 'e826ff8ee5821ded73f2e08f24f03e4c2d9c40ef',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '0203869947447f0ae7b60814c1056e81b4139334',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': '1189bba73607a1d802f2594c16431febdc3a8719',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': '3ee321a023ac85bc0c71750228bae4da40bbb58b',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': 'aebec71e5e0333fbf7a4b44521c8e5822f8544d0',
};
const escalated = [
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
].map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path }));

const contents = {
  'docs/architecture/battle-bridge-recovery-lifeboat-github-consumer-v1.md': `fixed public GitHub issue #1814 endpoint\nThe currently executable action set remains exactly:\nGITHUB_RECOVERY_RESPONSE_NOT_JSON\nGITHUB_RECOVERY_JSON_INVALID\nRECOVERY_ACTION_DISPATCHED_PROOF_PENDING\nM6 exports no caller parameters`,
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': `$candidateVersion = '1.1.0'\nJoin-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat'\n$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'\ninvoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1\nclaim=$claimHash\n-File $candidateRunner -SelfTestOnly\ngithubClaimConsumerIncluded = $true\ngithubEndpointFixed = $true\ngithubTokenRequired = $false`,
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': `param()\n$repository = 'Cheekyfellastef/stephan-os'\n$issueNumber = 1814\n$ownerLogin = 'Cheekyfellastef'\n$apiUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1814/comments?per_page=100&page=1'\n$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'\n$allowedActions = @('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')\n[System.IO.FileMode]::CreateNew\nGITHUB_RECOVERY_RESPONSE_NOT_JSON\nGITHUB_RECOVERY_JSON_INVALID\nRECOVERY_ACTION_DISPATCHED_PROOF_PENDING\nrecoveredHealthClaimed = $false\npostActionProofRequired = $true`,
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': `[switch]$SelfTestOnly\n$bankId -notin @('A', 'B')\nclaim=$claimConsumerHash\nif (-not $SelfTestOnly -and $ok)\ninvoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1\nrepoCheckoutRequired = $false\nopenClawGatewayRequired = $false`,
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': `PROBE_BATTLE_BRIDGE\nWAKE_CANONICAL_MAILBOX\nWAKE_CANONICAL_RECOVERY_MESH\nGITHUB_RECOVERY_RESPONSE_NOT_JSON\nGITHUB_RECOVERY_JSON_INVALID\nSelfTestOnly`,
};

function input(overrides = {}) {
  const sources = WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1.map((path) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: sourceHead,
    exists: true, size: contents[path].length, blobSha: blobs[path], content: contents[path],
  }));
  return { repository, sourceHead, analysis: { findings: escalated }, sources, ...overrides };
}

test('qualifies only the exact five-file M6 GitHub consumer estate behind three Windows escalations', () => {
  const result = analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1);
});

test('rejects partial, widened or wrong escalation estates', () => {
  assert.equal(analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input({ analysis: { findings: escalated.slice(0, 2) } })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input({ sources: [...input().sources, input().sources[0]] })).clean, false);
});

test('rejects changed blob identity and widened authority', () => {
  const changed = input().sources.map((source) => source.path.includes('github-claim') ? { ...source, blobSha: '0'.repeat(40) } : source);
  assert.equal(analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input({ sources: changed })).clean, false);
  const widened = input().sources.map((source) => source.path.includes('github-claim') ? { ...source, content: `${source.content}\nRestart-Computer` } : source);
  assert.equal(analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input({ sources: widened })).clean, false);
});
