export const WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1 = Object.freeze([
  'docs/architecture/battle-bridge-recovery-lifeboat-ab-installer-v1.md',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.mjs',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.test.mjs',
]);

const ESCALATED_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
]);

const EXPECTED_BLOBS = Object.freeze({
  'docs/architecture/battle-bridge-recovery-lifeboat-ab-installer-v1.md': 'fb7ac67a3bb47fa872add7548b0e7f57ab1614e0',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1807bab1ce20c6aaad6d317a69ee6b987597a7bc',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1': '914d6f390e6288bea8911db1dac7de03af661826',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1': 'c280cad73ec01f7c7ff8462e2e18a1a1f49552d2',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.mjs': 'fafeff364c99c005f781f098ee6ae8802e645329',
  'shared/agents/battleBridgeRecoveryLifeboatInstallV1.test.mjs': '93cb91afe0e28d915dfb890d730417c0b574fa22',
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
    ["$taskName = 'Stephanos Battle Bridge Recovery Lifeboat'", 'lifeboat-task-name-not-fixed'],
    ["Join-Path $env:LOCALAPPDATA 'Stephanos\\BattleBridgeRecoveryLifeboat'", 'lifeboat-root-not-fixed'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'lifeboat-powershell-not-fixed'],
    ["New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited", 'lifeboat-limited-principal-missing'],
    ["-RepetitionInterval (New-TimeSpan -Minutes 2)", 'lifeboat-fixed-interval-missing'],
    ["-MultipleInstances IgnoreNew", 'lifeboat-ignore-new-missing'],
    ["Read-FreshHealthyHeartbeat -BankId $targetBank -ExpectedManifest $manifestSha256", 'lifeboat-candidate-heartbeat-gate-missing'],
    ["Write-AtomicJson -Path $activeStatePath", 'lifeboat-atomic-promotion-missing'],
    ["activeBankOverwriteAllowed = $false", 'lifeboat-active-overwrite-denial-missing'],
    ["dualBankOverwriteAllowed = $false", 'lifeboat-dual-overwrite-denial-missing'],
    ["arbitraryPathAllowed = $false", 'lifeboat-path-denial-missing'],
    ["arbitraryTaskNameAllowed = $false", 'lifeboat-task-denial-missing'],
    ["arbitraryExecutableAllowed = $false", 'lifeboat-executable-denial-missing'],
    ["arbitraryShellAllowed = $false", 'lifeboat-shell-denial-missing'],
    ["gitMutationAllowed = $false", 'lifeboat-git-denial-missing'],
    ["sourceMutationAllowed = $false", 'lifeboat-source-denial-missing'],
    ["pcRestartAllowed = $false", 'lifeboat-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|cmd\.exe|powershell(?:\.exe)?\s+-Command/i, 'lifeboat-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'lifeboat-git-mutation-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'lifeboat-pc-restart-forbidden'],
    [/\[ValidateSet\([^\]]*\)\]\s*\$TaskName|param\([^)]*\$TaskName/i, 'lifeboat-caller-task-selection-forbidden'],
  ]) forbid(findings, source, path, pattern, code);
}

function reviewLauncher(source, path, findings) {
  for (const [literal, code] of [
    ["param()", 'lifeboat-launcher-arguments-present'],
    ["$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'lifeboat-launcher-powershell-not-fixed'],
    ["$bankId -notin @('A', 'B')", 'lifeboat-launcher-bank-boundary-missing'],
    ["selfTestVerdict", 'lifeboat-launcher-self-test-gate-missing'],
    ["manifestSha256", 'lifeboat-launcher-manifest-gate-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /USERPROFILE|Documents\\GitHub\\stephan-os|Invoke-Expression|cmd\.exe|Restart-Computer|git\.exe/i, 'lifeboat-launcher-authority-widened');
}

function reviewBank(source, path, findings) {
  for (const [literal, code] of [
    ["param()", 'lifeboat-bank-arguments-present'],
    ["$bankId -notin @('A', 'B')", 'lifeboat-bank-id-boundary-missing'],
    ["Get-FileHash", 'lifeboat-bank-payload-hash-missing'],
    ["payload hash does not match its immutable manifest", 'lifeboat-bank-manifest-fail-closed-missing'],
    ["-Action PROBE_BATTLE_BRIDGE", 'lifeboat-bank-probe-not-fixed'],
    ["payloadVerified = $true", 'lifeboat-bank-payload-proof-missing'],
    ["repoCheckoutRequired = $false", 'lifeboat-bank-checkout-independence-missing'],
    ["openClawGatewayRequired = $false", 'lifeboat-bank-openclaw-independence-missing'],
    ["arbitraryShellAllowed = $false", 'lifeboat-bank-shell-denial-missing'],
    ["gitMutationAllowed = $false", 'lifeboat-bank-git-denial-missing'],
    ["sourceMutationAllowed = $false", 'lifeboat-bank-source-denial-missing'],
    ["pcRestartAllowed = $false", 'lifeboat-bank-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /Documents\\GitHub\\stephan-os|Invoke-Expression|cmd\.exe|Restart-Computer|git\.exe/i, 'lifeboat-bank-authority-widened');
}

function reviewPlanner(source, path, findings) {
  for (const literal of [
    "mode: 'BOOTSTRAP_SINGLE_KNOWN_GOOD_BANK'",
    "mode: 'STAGE_INACTIVE_BANK'",
    'requireCandidateSelfTestPass: true',
    'requireCandidateHeartbeatFresh: true',
    'atomicActiveBankSwitchRequired: true',
    'retainRollbackBankRequired: true',
    'activeBankOverwriteAllowed: false',
    'dualBankOverwriteAllowed: false',
    'arbitraryPathAllowed: false',
    'arbitraryTaskNameAllowed: false',
    'arbitraryExecutableAllowed: false',
    'arbitraryShellAllowed: false',
    'gitMutationAllowed: false',
    'sourceMutationAllowed: false',
    'pcRestartAllowed: false',
  ]) requireLiteral(findings, source, path, literal, 'lifeboat-planner-boundary-missing');
  forbid(findings, source, path, /node:child_process|execSync|spawnSync|Invoke-Expression/i, 'lifeboat-planner-process-authority-forbidden');
}

function reviewTest(source, path, findings) {
  for (const literal of [
    "assert.doesNotMatch(source, /Invoke-Expression/i)",
    "assert.doesNotMatch(source, /git\\.exe/i)",
    "assert.doesNotMatch(source, /Restart-Computer/i)",
    "assert.match(source, /RunLevel Limited/)",
    "assert.match(source, /RepetitionInterval \\(New-TimeSpan -Minutes 2\\)/)",
  ]) requireLiteral(findings, source, path, literal, 'lifeboat-static-guard-test-missing');
  forbid(findings, source, path, /node:child_process|require\(['\"]child_process/i, 'lifeboat-test-process-authority-forbidden');
}

function reviewDoc(source, path, findings) {
  for (const literal of [
    '%LOCALAPPDATA%\\Stephanos\\BattleBridgeRecoveryLifeboat',
    'Stephanos Battle Bridge Recovery Lifeboat',
    'A bank update never targets the current active bank.',
    'require a fresh healthy heartbeat bound to that exact manifest',
    'retain the previous active bank as rollback',
    'does not install the lifeboat',
  ]) requireLiteral(findings, source, path, literal, 'lifeboat-doc-boundary-missing');
}

export function analyzeWindowsAuthorityMobileRecoveryLifeboatInstallerReview(input = {}) {
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
  for (const path of WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') reviewInstaller(source, path, findings);
    else if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1') reviewLauncher(source, path, findings);
    else if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1') reviewBank(source, path, findings);
    else if (path.endsWith('.test.mjs')) reviewTest(source, path, findings);
    else if (path.endsWith('.md')) reviewDoc(source, path, findings);
    else reviewPlanner(source, path, findings);
    proofRefs.push(`proofs/windows-authority-mobile-recovery-lifeboat-installer/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_MOBILE_RECOVERY_LIFEBOAT_INSTALLER_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
