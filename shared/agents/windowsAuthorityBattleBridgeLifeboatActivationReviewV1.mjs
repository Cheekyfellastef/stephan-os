export const WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1 = Object.freeze([
  'scripts/battle-bridge-control-plane-self-repair.test.mjs',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
]);

const HISTORIC_ESCALATED_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
]);
const IDEMPOTENT_ESCALATED_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
]);

const HISTORIC_EXPECTED_BLOBS = Object.freeze({
  'scripts/battle-bridge-control-plane-self-repair.test.mjs': 'f72094e4f92b7168768a5e38b7e43de07ff752a8',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': 'a8e4b0dc13593017979b000e5caa7f7d97e2d98d',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1da7c432fd051f7b9249d881638d21b131fa98a4',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs': 'c724540a727aab7881dd3b06b52aa7cf9d86f7d8',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs': '95ead85880038b3bf630a1d95e134f5f3deeb936',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs': 'dbc82832cdf528ea144d21338971aa309d4ee667',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs': 'e92065e6c0d61365ff6f1b7c8aec75200e5102b6',
});
const IDEMPOTENT_EXPECTED_BLOBS = Object.freeze({
  ...HISTORIC_EXPECTED_BLOBS,
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': 'd56f6a37969f2d58a572b0471ed7651063d14796',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '8003ccbf2299c8530d39b86fba8b2e36c9114dcf',
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function normalizedUnsupportedPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (!findings.length) return null;
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return null;
  return [...new Set(findings.map((item) => text(item?.path)))].sort();
}

function escalationProfile(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const paths = normalizedUnsupportedPaths(analysis);
  if (!paths) return null;
  if (findings.length === HISTORIC_ESCALATED_PATHS.length
      && JSON.stringify(paths) === JSON.stringify([...HISTORIC_ESCALATED_PATHS].sort())
      && paths.length === HISTORIC_ESCALATED_PATHS.length) return 'HISTORIC_ACTIVATION';
  if (findings.length === IDEMPOTENT_ESCALATED_PATHS.length
      && JSON.stringify(paths) === JSON.stringify([...IDEMPOTENT_ESCALATED_PATHS].sort())
      && paths.length === IDEMPOTENT_ESCALATED_PATHS.length) return 'IDEMPOTENT_REINSTALL';
  return null;
}

function expectedBlobsForProfile(profile) {
  return profile === 'IDEMPOTENT_REINSTALL' ? IDEMPOTENT_EXPECTED_BLOBS : HISTORIC_EXPECTED_BLOBS;
}

function exactSource(source, repository, head, path, expectedBlobs) {
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size > 0
    && source.size <= 256 * 1024
    && source.blobSha === expectedBlobs[path]
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
    ["$candidateVersion = '1.2.0'", 'lifeboat-windowless-version-not-fixed'],
    ['$wscriptExe =', 'lifeboat-wscript-assignment-missing'],
    ['Windows', 'lifeboat-windows-identity-missing'],
    ['System32', 'lifeboat-system32-identity-missing'],
    ['wscript.exe', 'lifeboat-wscript-not-fixed'],
    ['run-battle-bridge-recovery-lifeboat-windowless-v2.vbs', 'lifeboat-windowless-launcher-not-fixed'],
    ['New-ScheduledTaskAction -Execute $wscriptExe', 'lifeboat-task-does-not-use-wscript'],
    ['//B //Nologo', 'lifeboat-wscript-bounded-flags-missing'],
    ['-RepetitionInterval (New-TimeSpan -Minutes 2)', 'lifeboat-two-minute-interval-missing'],
    ['-MultipleInstances IgnoreNew', 'lifeboat-ignore-new-missing'],
    ['githubClaimConsumerIncluded = $true', 'lifeboat-consumer-proof-missing'],
    ['windowlessLauncher = $true', 'lifeboat-windowless-proof-missing'],
    ['scheduledTaskExecutable = $wscriptExe', 'lifeboat-executable-proof-missing'],
    ['directPowerShellTaskLaunch = $false', 'lifeboat-direct-powershell-denial-missing'],
    ['repoCheckoutRequiredAfterInstall = $false', 'lifeboat-checkout-independence-missing'],
    ['openClawGatewayRequiredAfterInstall = $false', 'lifeboat-openclaw-independence-missing'],
    ['arbitraryPathAllowed = $false', 'lifeboat-arbitrary-path-denial-missing'],
    ['arbitraryTaskNameAllowed = $false', 'lifeboat-arbitrary-task-denial-missing'],
    ['arbitraryExecutableAllowed = $false', 'lifeboat-arbitrary-executable-denial-missing'],
    ['arbitraryShellAllowed = $false', 'lifeboat-arbitrary-shell-denial-missing'],
    ['gitMutationAllowed = $false', 'lifeboat-git-denial-missing'],
    ['sourceMutationAllowed = $false', 'lifeboat-source-denial-missing'],
    ['pcRestartAllowed = $false', 'lifeboat-pc-restart-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /New-ScheduledTaskAction\s+-Execute\s+\$powershellExe/i, 'lifeboat-direct-powershell-task-forbidden');
  forbid(findings, source, path, /-WindowStyle\s+Hidden/i, 'lifeboat-windowstyle-hidden-regression');
  forbid(findings, source, path, /Invoke-Expression|\biex\b|powershell(?:\.exe)?\s+-Command/i, 'lifeboat-dynamic-shell-forbidden');
  forbid(findings, source, path, /git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'lifeboat-git-mutation-forbidden');
  forbid(findings, source, path, /Restart-Computer|shutdown\.exe/i, 'lifeboat-pc-restart-forbidden');
}

function reviewIdempotentReinstall(source, path, findings) {
  for (const [literal, code] of [
    ['function Assert-ActivePayloadManifest', 'lifeboat-idempotent-active-manifest-proof-missing'],
    ['function Assert-CanonicalScheduledTask', 'lifeboat-idempotent-task-proof-missing'],
    ['Read-FreshHealthyHeartbeat -BankId $activeBank -ExpectedManifest', 'lifeboat-idempotent-fresh-heartbeat-proof-missing'],
    ['Assert-ActivePayloadManifest -BankId $activeBank -ExpectedManifest', 'lifeboat-idempotent-active-manifest-binding-missing'],
    ['Get-ScheduledTask -TaskName $taskName -ErrorAction Stop', 'lifeboat-idempotent-task-read-missing'],
    ['$actions.Count -ne 1', 'lifeboat-idempotent-task-action-count-missing'],
    ['$actions[0].Execute -ne $wscriptExe', 'lifeboat-idempotent-task-executable-proof-missing'],
    ['$actions[0].Arguments -ne $expectedArguments', 'lifeboat-idempotent-task-arguments-proof-missing'],
    ['$task.Principal.UserId -ne $CurrentUser', 'lifeboat-idempotent-task-principal-proof-missing'],
    ["$task.Principal.LogonType -ne 'Interactive'", 'lifeboat-idempotent-task-logon-proof-missing'],
    ["$task.Principal.RunLevel -ne 'Limited'", 'lifeboat-idempotent-task-runlevel-proof-missing'],
    ["installDisposition = 'PROMOTED_CANDIDATE'", 'lifeboat-promotion-disposition-missing'],
    ['changed = $true', 'lifeboat-promotion-change-proof-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  const branchStart = source.indexOf('if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {');
  const branchEnd = source.indexOf('\n$targetRoot = Join-Path $banksRoot $targetBank', branchStart);
  if (!(branchStart >= 0 && branchEnd > branchStart)) {
    findings.push(finding('lifeboat-idempotent-bounded-branch-missing', path));
    return;
  }
  const branch = source.slice(branchStart, branchEnd);
  for (const [literal, code] of [
    ['Assert-CanonicalScheduledTask -CurrentUser $currentUser', 'lifeboat-idempotent-task-reproof-not-bound'],
    ['Remove-Item -LiteralPath $stageRoot -Recurse -Force', 'lifeboat-idempotent-staging-cleanup-missing'],
    ["installDisposition = 'ALREADY_CURRENT_HEALTHY'", 'lifeboat-idempotent-disposition-missing'],
    ['changed = $false', 'lifeboat-idempotent-changed-false-missing'],
    ['activeBankAfter = $activeBank', 'lifeboat-idempotent-active-bank-preservation-missing'],
    ['scheduledTaskIdentityReproved = $true', 'lifeboat-idempotent-task-reproof-receipt-missing'],
    ["if ($StartNow -and $PSCmdlet.ShouldProcess($taskName, 'Start existing canonical Battle Bridge recovery lifeboat task'))", 'lifeboat-idempotent-start-now-boundary-missing'],
    ['Start-ScheduledTask -TaskName $taskName', 'lifeboat-idempotent-fixed-task-start-missing'],
    ['activeBankOverwriteAllowed = $false', 'lifeboat-idempotent-active-bank-overwrite-denial-missing'],
    ['dualBankOverwriteAllowed = $false', 'lifeboat-idempotent-dual-bank-overwrite-denial-missing'],
    ['arbitraryShellAllowed = $false', 'lifeboat-idempotent-shell-denial-missing'],
    ['gitMutationAllowed = $false', 'lifeboat-idempotent-git-denial-missing'],
    ['sourceMutationAllowed = $false', 'lifeboat-idempotent-source-denial-missing'],
    ['pcRestartAllowed = $false', 'lifeboat-idempotent-pc-restart-denial-missing'],
    ['return', 'lifeboat-idempotent-terminal-return-missing'],
  ]) requireLiteral(findings, branch, path, literal, code);
  forbid(findings, branch, path, /Register-ScheduledTask/i, 'lifeboat-idempotent-task-reregistration-forbidden');
  forbid(findings, branch, path, /Write-AtomicJson/i, 'lifeboat-idempotent-active-state-rewrite-forbidden');
}

function reviewWindowlessLauncher(source, path, findings) {
  for (const [literal, code] of [
    ['Option Explicit', 'lifeboat-vbs-option-explicit-missing'],
    ['CreateObject("WScript.Shell")', 'lifeboat-vbs-shell-object-missing'],
    ['ExpandEnvironmentStrings("%LOCALAPPDATA%")', 'lifeboat-vbs-localappdata-not-fixed'],
    ['ExpandEnvironmentStrings("%SystemRoot%")', 'lifeboat-vbs-systemroot-not-fixed'],
    ['run-battle-bridge-recovery-lifeboat-active-v1.ps1', 'lifeboat-vbs-active-launcher-not-fixed'],
    ['shell.Run(command, 0, True)', 'lifeboat-vbs-windowless-run-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /WScript\.Arguments|Documents\\GitHub\\stephan-os|Invoke-Expression|cmd\.exe|git\.exe|Restart-Computer/i, 'lifeboat-vbs-authority-widened');
}

function reviewControlPlane(source, path, findings) {
  for (const [literal, code] of [
    ["id: 'recoveryLifeboat'", 'control-plane-lifeboat-task-missing'],
    ["taskName: 'Stephanos Battle Bridge Recovery Lifeboat'", 'control-plane-lifeboat-name-not-fixed'],
    ["installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'", 'control-plane-lifeboat-installer-not-fixed'],
    ["id: 'recoveryMesh'", 'control-plane-recovery-mesh-task-missing'],
    ["id: 'workerWatchdog'", 'control-plane-worker-watchdog-task-missing'],
    ["id: 'githubCommandMailbox'", 'control-plane-mailbox-task-missing'],
    ["id: 'outboundHealthBeacon'", 'control-plane-outbound-health-beacon-task-missing'],
    ["installerRelativePath: 'scripts/windows/install-battle-bridge-worker-watchdog.ps1'", 'control-plane-worker-watchdog-installer-not-fixed'],
    ["installerRelativePath: 'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1'", 'control-plane-outbound-health-beacon-installer-not-fixed'],
    ['shell: false', 'control-plane-shell-false-missing'],
    ["'-File', installerPath", 'control-plane-fixed-installer-execution-missing'],
    ["'-StartNow'", 'control-plane-start-now-missing'],
    ['function validateRecoveryLifeboatReceipt', 'control-plane-lifeboat-receipt-validator-missing'],
    ['function validateWorkerWatchdogReceipt', 'control-plane-worker-watchdog-receipt-validator-missing'],
    ['function validateOutboundHealthBeaconReceipt', 'control-plane-outbound-health-beacon-receipt-validator-missing'],
    ['payload.scheduledTaskExecutable', 'control-plane-lifeboat-executable-proof-field-missing'],
    ['wscript.exe', 'control-plane-lifeboat-wscript-identity-missing'],
    ['payload.directPowerShellTaskLaunch === false', 'control-plane-direct-powershell-denial-missing'],
    ['payload.githubClaimConsumerIncluded === true', 'control-plane-consumer-proof-missing'],
    ['payload.repoCheckoutRequiredAfterInstall === false', 'control-plane-checkout-independence-missing'],
    ['payload.openClawGatewayRequiredAfterInstall === false', 'control-plane-openclaw-independence-missing'],
    ["taskId === 'recoveryLifeboat'", 'control-plane-lifeboat-closed-receipt-routing-missing'],
    ["taskId === 'workerWatchdog'", 'control-plane-worker-watchdog-closed-receipt-routing-missing'],
    ["taskId === 'outboundHealthBeacon'", 'control-plane-outbound-health-beacon-closed-receipt-routing-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  const lifeboat = source.indexOf("id: 'recoveryLifeboat'");
  const mesh = source.indexOf("id: 'recoveryMesh'");
  const watchdog = source.indexOf("id: 'workerWatchdog'");
  const mailbox = source.indexOf("id: 'githubCommandMailbox'");
  const beacon = source.indexOf("id: 'outboundHealthBeacon'");
  if (!(lifeboat >= 0 && lifeboat < mesh && mesh < watchdog && watchdog < mailbox && mailbox < beacon)) {
    findings.push(finding('control-plane-canonical-task-order-not-preserved', path));
  }
  forbid(findings, source, path, /taskName\s*=\s*options|installerRelativePath\s*=\s*options|executable\s*=\s*options|shell\s*=\s*true/i, 'control-plane-caller-selection-forbidden');
  forbid(findings, source, path, /Invoke-Expression|reset --hard|git clean|git stash|git checkout|git push|Restart-Computer/i, 'control-plane-destructive-authority-forbidden');
}

function reviewPostSync(source, path, findings) {
  for (const [literal, code] of [
    ["'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'", 'post-sync-lifeboat-natural-reload-missing'],
    ["'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'", 'post-sync-lifeboat-natural-reload-missing'],
    ["'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'", 'post-sync-lifeboat-natural-reload-missing'],
    ["'scripts/battle-bridge-outbound-health-beacon.mjs'", 'post-sync-outbound-health-beacon-natural-reload-missing'],
    ["'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1'", 'post-sync-outbound-health-beacon-natural-reload-missing'],
    ["'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1'", 'post-sync-outbound-health-beacon-natural-reload-missing'],
    ['if (NATURAL_EXACT.has(path)) return false;', 'post-sync-natural-reload-openclaw-guard-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  forbid(findings, source, path, /automaticExecutionAllowed:\s*true/, 'post-sync-unconditional-authority-forbidden');
}

function reviewTestEvidence(source, path, findings) {
  const requirements = path.includes('control-plane-self-repair')
    ? ['recoveryLifeboat', 'recoveryMesh', 'workerWatchdog', 'githubCommandMailbox', 'outboundHealthBeacon', 'result.taskCount, 5', 'install-battle-bridge-recovery-lifeboat-v1.ps1', 'install-battle-bridge-worker-watchdog.ps1', 'install-battle-bridge-outbound-health-beacon.ps1', "failedTaskId, 'recoveryLifeboat'", 'powerShellCalls.length, 5']
    : path.includes('hidden-window')
      ? ['$wscriptExe', '$powershellExe', '-WindowStyle Hidden', 'shell', 'WScript']
      : ['worker watchdog and Recovery Mesh liveness repair', 'windowless Lifeboat delivery', 'install-battle-bridge-recovery-lifeboat-v1.ps1', 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs', 'battleBridgeControlPlaneSelfRepairV1.mjs', 'unknownPathCount, 0', 'openClawPathCount, 0', 'automaticExecutionAllowed, true'];
  for (const literal of requirements) requireLiteral(findings, source, path, literal, 'lifeboat-activation-regression-proof-missing');
}

export function analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const profile = escalationProfile(input.analysis);
  const eligible = repository === 'Cheekyfellastef/stephan-os' && SHA.test(sourceHead) && profile !== null;
  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
  });
  if (!Array.isArray(input.sources) || input.sources.length === 0) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1,
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED',
  });

  const expectedBlobs = expectedBlobsForProfile(profile);
  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1) {
    const candidates = input.sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path, expectedBlobs)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') {
      reviewInstaller(source, path, findings);
      if (profile === 'IDEMPOTENT_REINSTALL') reviewIdempotentReinstall(source, path, findings);
    } else if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs') reviewWindowlessLauncher(source, path, findings);
    else if (path === 'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs') reviewControlPlane(source, path, findings);
    else if (path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs') reviewPostSync(source, path, findings);
    else reviewTestEvidence(source, path, findings);
    proofRefs.push(`proofs/windows-authority-battle-bridge-lifeboat-activation/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (input.sources.length !== WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length ? 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' : 'WINDOWS_AUTHORITY_SPECIALIST_PASS',
  });
}
