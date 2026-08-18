export const WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1 = Object.freeze([
  'scripts/battle-bridge-control-plane-self-repair.test.mjs',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
]);

const ESCALATED_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
]);

const EXPECTED_BLOBS = Object.freeze({
  'scripts/battle-bridge-control-plane-self-repair.test.mjs': '08911f3e3ba07bd1714a5e9c6203596e97190428',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': '7f54c6f911d0f7012121b615b8cb6d84adffb46a',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1da7c432fd051f7b9249d881638d21b131fa98a4',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs': 'c724540a727aab7881dd3b06b52aa7cf9d86f7d8',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs': '4923796bd34b1e6dcac0ec6fe45c17bc001dc27f',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs': 'c42b73f478c96a306890ba96e318bb7c23f1b9b5',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs': '40f6b6c5d6d5030fd2cfdd17bf3b15b09f56e35c',
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
    ["$candidateVersion = '1.2.0'", 'lifeboat-windowless-version-not-fixed'],
    ["$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'", 'lifeboat-wscript-not-fixed'],
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
    ["id: 'githubCommandMailbox'", 'control-plane-mailbox-task-missing'],
    ['shell: false', 'control-plane-shell-false-missing'],
    ["'-File', installerPath", 'control-plane-fixed-installer-execution-missing'],
    ["'-StartNow'", 'control-plane-start-now-missing'],
    ['function validateRecoveryLifeboatReceipt', 'control-plane-lifeboat-receipt-validator-missing'],
    ['payload.scheduledTaskExecutable', 'control-plane-lifeboat-executable-proof-field-missing'],
    ['wscript.exe', 'control-plane-lifeboat-wscript-identity-missing'],
    ['payload.directPowerShellTaskLaunch === false', 'control-plane-direct-powershell-denial-missing'],
    ['payload.githubClaimConsumerIncluded === true', 'control-plane-consumer-proof-missing'],
    ['payload.repoCheckoutRequiredAfterInstall === false', 'control-plane-checkout-independence-missing'],
    ['payload.openClawGatewayRequiredAfterInstall === false', 'control-plane-openclaw-independence-missing'],
    ["task.id === 'recoveryLifeboat'", 'control-plane-closed-receipt-routing-missing'],
  ]) requireLiteral(findings, source, path, literal, code);
  const lifeboat = source.indexOf("id: 'recoveryLifeboat'");
  const mesh = source.indexOf("id: 'recoveryMesh'");
  const mailbox = source.indexOf("id: 'githubCommandMailbox'");
  if (!(lifeboat >= 0 && lifeboat < mesh && mesh < mailbox)) findings.push(finding('control-plane-lifeboat-not-first', path));
  forbid(findings, source, path, /taskName\s*=\s*options|installerRelativePath\s*=\s*options|executable\s*=\s*options|shell\s*=\s*true/i, 'control-plane-caller-selection-forbidden');
  forbid(findings, source, path, /Invoke-Expression|reset --hard|git clean|git stash|git checkout|git push|Restart-Computer/i, 'control-plane-destructive-authority-forbidden');
}

function reviewPostSync(source, path, findings) {
  for (const literal of [
    "'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'",
    "'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'",
    "'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'",
  ]) requireLiteral(findings, source, path, literal, 'post-sync-lifeboat-natural-reload-missing');
  forbid(findings, source, path, /automaticExecutionAllowed:\s*true/, 'post-sync-unconditional-authority-forbidden');
}

function reviewTestEvidence(source, path, findings) {
  const requirements = path.includes('control-plane-self-repair')
    ? ['recoveryLifeboat', 'result.taskCount, 3', 'install-battle-bridge-recovery-lifeboat-v1.ps1', "failedTaskId, 'recoveryLifeboat'", 'powerShellCalls.length, 3']
    : path.includes('hidden-window')
      ? ['$wscriptExe', '$powershellExe', '-WindowStyle Hidden', 'shell', 'WScript']
      : ['windowless Lifeboat delivery', 'install-battle-bridge-recovery-lifeboat-v1.ps1', 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs', 'battleBridgeControlPlaneSelfRepairV1.mjs', 'unknownPathCount, 0', 'automaticExecutionAllowed, true'];
  for (const literal of requirements) requireLiteral(findings, source, path, literal, 'lifeboat-activation-regression-proof-missing');
}

export function analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === 'Cheekyfellastef/stephan-os' && SHA.test(sourceHead) && escalationMatches(input.analysis);
  if (!eligible) return Object.freeze({ schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE' });
  if (!Array.isArray(input.sources) || input.sources.length === 0) return Object.freeze({ schemaVersion: SCHEMA, eligible: true, clean: false, reviewedPaths: WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1, findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED' });

  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1) {
    const candidates = input.sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') reviewInstaller(source, path, findings);
    else if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs') reviewWindowlessLauncher(source, path, findings);
    else if (path === 'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs') reviewControlPlane(source, path, findings);
    else if (path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs') reviewPostSync(source, path, findings);
    else reviewTestEvidence(source, path, findings);
    proofRefs.push(`proofs/windows-authority-battle-bridge-lifeboat-activation/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (input.sources.length !== WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1.length) findings.push(finding('windows-authority-source-estate-widened', ''));
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
