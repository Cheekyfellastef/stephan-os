export const WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1 = Object.freeze([
  'scripts/windows/battle-bridge-local-chat-recovery-v1.test.mjs',
  'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1',
  'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1',
]);

const ESCALATED_PATHS = WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1;

const EXPECTED_BLOBS = Object.freeze({
  'scripts/windows/battle-bridge-local-chat-recovery-v1.test.mjs': '25a34ce17214abc022614b2400b93c95bd13fc2d',
  'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1': '4f58a6654913b2415de6df340efe59df98a87602',
  'scripts/windows/invoke-battle-bridge-local-chat-recovery-v1.ps1': 'e5f0e8f1781730f3128298134499f96069bbcfdb',
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

function reviewHandler(source, path, findings) {
  for (const [literal, code] of [
    ["[ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')]", 'local-chat-action-allowlist-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'local-chat-powershell-not-fixed'],
    ["Join-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat'", 'local-chat-lifeboat-root-not-fixed'],
    ["$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1'", 'local-chat-active-bank-schema-gate-missing'],
    ["$bankId -notin @('A', 'B')", 'local-chat-bank-boundary-missing'],
    ["$state.selfTestVerdict -ne 'PASS'", 'local-chat-self-test-gate-missing'],
    ["Installed lifeboat payload hash verification failed.", 'local-chat-manifest-verification-missing'],
    ["[System.Windows.Forms.MessageBoxButtons]::YesNo", 'local-chat-local-confirmation-missing'],
    ["[System.Windows.Forms.MessageBoxDefaultButton]::Button2", 'local-chat-confirmation-default-not-deny'],
    ["if ($Action -ne 'PROBE_BATTLE_BRIDGE')", 'local-chat-probe-confirmation-boundary-missing'],
    ["-File $actionPath -Action $Action", 'local-chat-fixed-action-adapter-missing'],
    ["local-chat-recovery-last.json", 'local-chat-receipt-surface-missing'],
    ["callerSelectedExecutableAllowed = $false", 'local-chat-executable-denial-missing'],
    ["callerSelectedPathAllowed = $false", 'local-chat-path-denial-missing'],
    ["callerSelectedUrlAllowed = $false", 'local-chat-url-denial-missing'],
    ["callerSelectedTaskAllowed = $false", 'local-chat-task-denial-missing'],
    ["arbitraryShellAllowed = $false", 'local-chat-shell-denial-missing'],
    ["gitMutationAllowed = $false", 'local-chat-git-denial-missing'],
    ["sourceMutationAllowed = $false", 'local-chat-source-denial-missing'],
    ["mergeAllowed = $false", 'local-chat-merge-denial-missing'],
    ["deploymentAllowed = $false", 'local-chat-deployment-denial-missing'],
    ["pcRestartAllowed = $false", 'local-chat-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  for (const [pattern, code] of [
    [/\$Uri\b|\[System\.Uri\]/i, 'local-chat-caller-uri-surface-forbidden'],
    [/Invoke-Expression|\biex\b|Start-Process|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'local-chat-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'local-chat-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'local-chat-pc-restart-forbidden'],
    [/\[ValidateSet\([^\]]*(?:REPAIR|FULL_BATTLE_BRIDGE_RECOVERY|EXEC)[^\]]*\)\]/i, 'local-chat-action-authority-widened'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewInstaller(source, path, findings) {
  for (const [literal, code] of [
    ["Join-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat'", 'local-chat-installer-lifeboat-root-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'local-chat-installer-powershell-not-fixed'],
    ["$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1'", 'local-chat-installer-state-schema-gate-missing'],
    ["$state.selfTestVerdict -ne 'PASS'", 'local-chat-installer-self-test-gate-missing'],
    ["Get-FileHash -LiteralPath $sourceHandler -Algorithm SHA256", 'local-chat-installer-source-hash-missing'],
    ["Installed local recovery handler hash does not match reviewed source.", 'local-chat-installer-copy-verification-missing'],
    ["Scheme = 'stephanos-recover-probe'; Action = 'PROBE_BATTLE_BRIDGE'", 'local-chat-probe-protocol-not-fixed'],
    ["Scheme = 'stephanos-recover-mailbox'; Action = 'WAKE_CANONICAL_MAILBOX'", 'local-chat-mailbox-protocol-not-fixed'],
    ["Scheme = 'stephanos-recover-mesh'; Action = 'WAKE_CANONICAL_RECOVERY_MESH'", 'local-chat-mesh-protocol-not-fixed'],
    ["HKCU:\\Software\\Classes\\$($protocol.Scheme)", 'local-chat-protocol-not-per-user'],
    ["if ($command.Contains('%1'))", 'local-chat-uri-injection-denial-missing'],
    ["must not receive caller-controlled URI text", 'local-chat-uri-injection-fail-closed-missing'],
    ["Registered local recovery protocol command identity mismatch", 'local-chat-command-identity-verification-missing'],
    ["callerControlledUriPassedToHandler = $false", 'local-chat-uri-forwarding-denial-missing'],
    ["callerSelectedExecutableAllowed = $false", 'local-chat-installer-executable-denial-missing'],
    ["callerSelectedPathAllowed = $false", 'local-chat-installer-path-denial-missing'],
    ["callerSelectedUrlAllowed = $false", 'local-chat-installer-url-denial-missing'],
    ["callerSelectedTaskAllowed = $false", 'local-chat-installer-task-denial-missing'],
    ["arbitraryShellAllowed = $false", 'local-chat-installer-shell-denial-missing'],
    ["gitMutationAllowed = $false", 'local-chat-installer-git-denial-missing'],
    ["sourceMutationAllowed = $false", 'local-chat-installer-source-denial-missing'],
    ["mergeAllowed = $false", 'local-chat-installer-merge-denial-missing'],
    ["deploymentAllowed = $false", 'local-chat-installer-deployment-denial-missing'],
    ["pcRestartAllowed = $false", 'local-chat-installer-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  for (const [pattern, code] of [
    [/%1[^')]|-[Uu]ri\b|\$Uri\b|\[System\.Uri\]/, 'local-chat-installer-caller-uri-surface-forbidden'],
    [/Invoke-Expression|\biex\b|Start-Process|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'local-chat-installer-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'local-chat-installer-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'local-chat-installer-pc-restart-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewTest(source, path, findings) {
  for (const [literal, code] of [
    ["assert.match(handler, /ValidateSet", 'local-chat-test-action-allowlist-guard-missing'],
    ["assert.doesNotMatch(handler, /\\$Uri\\b/)", 'local-chat-test-uri-handler-denial-missing'],
    ["assert.doesNotMatch(handler, /Invoke-Expression/i)", 'local-chat-test-shell-handler-denial-missing'],
    ["assert.match(installer, /command\\.Contains\\('%1'\\)/)", 'local-chat-test-uri-installer-denial-missing'],
    ["assert.doesNotMatch(installer, /-Uri\\b/)", 'local-chat-test-uri-parameter-denial-missing'],
    ["assert.match(installer, /callerControlledUriPassedToHandler = \\$false/)", 'local-chat-test-uri-forwarding-denial-missing'],
    ["assert.match(handler, /pcRestartAllowed = \\$false/)", 'local-chat-test-restart-handler-denial-missing'],
    ["assert.match(installer, /pcRestartAllowed = \\$false/)", 'local-chat-test-restart-installer-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /node:child_process|require\(['"]child_process/i, 'local-chat-test-process-authority-forbidden');
}

export function analyzeWindowsAuthorityLocalChatRecoveryReview(input = {}) {
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
  for (const path of WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('.test.mjs')) reviewTest(source, path, findings);
    else if (path === 'scripts/windows/install-battle-bridge-local-chat-recovery-v1.ps1') reviewInstaller(source, path, findings);
    else reviewHandler(source, path, findings);
    proofRefs.push(`proofs/windows-authority-local-chat-recovery/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_LOCAL_CHAT_RECOVERY_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
