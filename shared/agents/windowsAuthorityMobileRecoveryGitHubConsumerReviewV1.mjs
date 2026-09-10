export const WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1 = Object.freeze([
  'docs/architecture/battle-bridge-recovery-lifeboat-github-consumer-v1.md',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs',
]);

const ESCALATED_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
]);

const EXPECTED_BLOBS = Object.freeze({
  'docs/architecture/battle-bridge-recovery-lifeboat-github-consumer-v1.md': 'e826ff8ee5821ded73f2e08f24f03e4c2d9c40ef',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '0203869947447f0ae7b60814c1056e81b4139334',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1': '1189bba73607a1d802f2594c16431febdc3a8719',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': '3ee321a023ac85bc0c71750228bae4da40bbb58b',
  'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs': 'aebec71e5e0333fbf7a4b44521c8e5822f8544d0',
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

function reviewInstaller(source, path, findings) {
  for (const [literal, code] of [
    ["$candidateVersion = '1.1.0'", 'm6-installer-version-not-fixed'],
    ["Join-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat'", 'm6-installer-root-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'm6-installer-powershell-not-fixed'],
    ["invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1", 'm6-installer-claim-payload-missing'],
    ["claim=$claimHash", 'm6-installer-claim-manifest-binding-missing'],
    ["-File $candidateRunner -SelfTestOnly", 'm6-installer-self-test-only-gate-missing'],
    ["githubClaimConsumerIncluded = $true", 'm6-installer-consumer-proof-missing'],
    ["githubEndpointFixed = $true", 'm6-installer-fixed-endpoint-proof-missing'],
    ["githubTokenRequired = $false", 'm6-installer-tokenless-proof-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'm6-installer-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'm6-installer-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'm6-installer-pc-restart-forbidden'],
    [/\$ApiUrl\b|\$Repository\b|\$IssueNumber\b|\$Token\b/i, 'm6-installer-caller-network-authority-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewConsumer(source, path, findings) {
  for (const [literal, code] of [
    ['param()', 'm6-consumer-arguments-present'],
    ["$repository = 'Cheekyfellastef/stephan-os'", 'm6-consumer-repository-not-fixed'],
    ["$issueNumber = 1814", 'm6-consumer-issue-not-fixed'],
    ["$ownerLogin = 'Cheekyfellastef'", 'm6-consumer-owner-not-fixed'],
    ["$apiUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1814/comments?per_page=100&page=1'", 'm6-consumer-api-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'm6-consumer-powershell-not-fixed'],
    ["$allowedActions = @('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')", 'm6-consumer-action-set-not-fixed'],
    ['[System.IO.FileMode]::CreateNew', 'm6-consumer-exclusive-claim-missing'],
    ['GITHUB_RECOVERY_RESPONSE_NOT_JSON', 'm6-consumer-media-type-fail-closed-missing'],
    ['GITHUB_RECOVERY_JSON_INVALID', 'm6-consumer-json-fail-closed-missing'],
    ['RECOVERY_ACTION_DISPATCHED_PROOF_PENDING', 'm6-consumer-proof-pending-truth-missing'],
    ['recoveredHealthClaimed = $false', 'm6-consumer-recovered-health-denial-missing'],
    ['postActionProofRequired = $true', 'm6-consumer-post-proof-gate-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'm6-consumer-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'm6-consumer-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'm6-consumer-pc-restart-forbidden'],
    [/param\([^)]*\$(?:Url|Uri|Path|Task|Action|Repository|Issue|Token)/is, 'm6-consumer-caller-selection-forbidden'],
    [/Authorization\s*:|Bearer\s+|GITHUB_TOKEN|GH_TOKEN/i, 'm6-consumer-secret-token-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewBank(source, path, findings) {
  for (const [literal, code] of [
    ['[switch]$SelfTestOnly', 'm6-bank-self-test-switch-missing'],
    ["$bankId -notin @('A', 'B')", 'm6-bank-id-boundary-missing'],
    ['claim=$claimConsumerHash', 'm6-bank-claim-manifest-binding-missing'],
    ['if (-not $SelfTestOnly -and $ok)', 'm6-bank-self-test-network-boundary-missing'],
    ['invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1', 'm6-bank-fixed-consumer-missing'],
    ['repoCheckoutRequired = $false', 'm6-bank-checkout-independence-missing'],
    ['openClawGatewayRequired = $false', 'm6-bank-openclaw-independence-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'm6-bank-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'm6-bank-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'm6-bank-pc-restart-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewDoc(source, path, findings) {
  for (const literal of [
    'fixed public GitHub issue #1814 endpoint',
    'The currently executable action set remains exactly:',
    'GITHUB_RECOVERY_RESPONSE_NOT_JSON',
    'GITHUB_RECOVERY_JSON_INVALID',
    'RECOVERY_ACTION_DISPATCHED_PROOF_PENDING',
    'M6 exports no caller parameters',
  ]) requireLiteral(findings, source, path, literal, 'm6-doc-boundary-missing');
}

function reviewTest(source, path, findings) {
  for (const literal of [
    'PROBE_BATTLE_BRIDGE',
    'WAKE_CANONICAL_MAILBOX',
    'WAKE_CANONICAL_RECOVERY_MESH',
    'GITHUB_RECOVERY_RESPONSE_NOT_JSON',
    'GITHUB_RECOVERY_JSON_INVALID',
    'SelfTestOnly',
  ]) requireLiteral(findings, source, path, literal, 'm6-static-guard-test-missing');
  forbid(findings, source, path, /node:child_process|require\(['"]child_process/i, 'm6-test-process-authority-forbidden');
}

export function analyzeWindowsAuthorityMobileRecoveryGitHubConsumerReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === 'Cheekyfellastef/stephan-os'
    && SHA.test(sourceHead)
    && escalationMatches(input.analysis);
  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') reviewInstaller(source, path, findings);
    else if (path === 'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1') reviewConsumer(source, path, findings);
    else if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1') reviewBank(source, path, findings);
    else if (path.endsWith('.test.mjs')) reviewTest(source, path, findings);
    else reviewDoc(source, path, findings);
    proofRefs.push(`proofs/windows-authority-mobile-recovery-github-consumer/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_MOBILE_RECOVERY_GITHUB_CONSUMER_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
