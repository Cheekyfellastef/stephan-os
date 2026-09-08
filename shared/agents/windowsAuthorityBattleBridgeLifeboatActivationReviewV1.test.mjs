import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1,
  analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview,
} from './windowsAuthorityBattleBridgeLifeboatActivationReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const HISTORIC_BLOBS = Object.freeze({
  'scripts/battle-bridge-control-plane-self-repair.test.mjs': 'f72094e4f92b7168768a5e38b7e43de07ff752a8',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': 'a8e4b0dc13593017979b000e5caa7f7d97e2d98d',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1da7c432fd051f7b9249d881638d21b131fa98a4',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs': 'c724540a727aab7881dd3b06b52aa7cf9d86f7d8',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs': '95ead85880038b3bf630a1d95e134f5f3deeb936',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs': 'dbc82832cdf528ea144d21338971aa309d4ee667',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs': 'e92065e6c0d61365ff6f1b7c8aec75200e5102b6',
});
const IDEMPOTENT_BLOBS = Object.freeze({
  ...HISTORIC_BLOBS,
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': 'd56f6a37969f2d58a572b0471ed7651063d14796',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '8003ccbf2299c8530d39b86fba8b2e36c9114dcf',
});

function historicAnalysis(overrides = {}) {
  return {
    findings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1' },
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs' },
    ],
    ...overrides,
  };
}
function idempotentAnalysis(overrides = {}) {
  return {
    findings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1' },
    ],
    ...overrides,
  };
}

function historicContentFor(path) {
  if (path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') return String.raw`
$taskName = 'Stephanos Battle Bridge Recovery Lifeboat'
$candidateVersion = '1.2.0'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wscriptExe = 'C:\Windows\System32\wscript.exe'
run-battle-bridge-recovery-lifeboat-windowless-v2.vbs
New-ScheduledTaskAction -Execute $wscriptExe
//B //Nologo
New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
-RepetitionInterval (New-TimeSpan -Minutes 2)
-MultipleInstances IgnoreNew
githubClaimConsumerIncluded = $true
windowlessLauncher = $true
scheduledTaskExecutable = $wscriptExe
directPowerShellTaskLaunch = $false
repoCheckoutRequiredAfterInstall = $false
openClawGatewayRequiredAfterInstall = $false
arbitraryPathAllowed = $false
arbitraryTaskNameAllowed = $false
arbitraryExecutableAllowed = $false
arbitraryShellAllowed = $false
gitMutationAllowed = $false
sourceMutationAllowed = $false
pcRestartAllowed = $false
`;
  if (path === 'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs') return String.raw`
Option Explicit
Set shell = CreateObject("WScript.Shell")
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
launcher = localAppData & "\Stephanos\BattleBridgeRecoveryLifeboat\run-battle-bridge-recovery-lifeboat-active-v1.ps1"
exitCode = shell.Run(command, 0, True)
`;
  if (path === 'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs') return String.raw`
id: 'recoveryLifeboat'
taskName: 'Stephanos Battle Bridge Recovery Lifeboat'
installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
id: 'recoveryMesh'
id: 'workerWatchdog'
installerRelativePath: 'scripts/windows/install-battle-bridge-worker-watchdog.ps1'
id: 'githubCommandMailbox'
id: 'outboundHealthBeacon'
installerRelativePath: 'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1'
shell: false
'-File', installerPath
'-StartNow'
function validateRecoveryLifeboatReceipt
function validateWorkerWatchdogReceipt
function validateOutboundHealthBeaconReceipt
payload.scheduledTaskExecutable === 'C:\\Windows\\System32\\wscript.exe'
payload.directPowerShellTaskLaunch === false
payload.githubClaimConsumerIncluded === true
payload.repoCheckoutRequiredAfterInstall === false
payload.openClawGatewayRequiredAfterInstall === false
taskId === 'recoveryLifeboat'
taskId === 'workerWatchdog'
taskId === 'outboundHealthBeacon'
`;
  if (path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs') return String.raw`
'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'
'scripts/battle-bridge-outbound-health-beacon.mjs'
'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1'
'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1'
'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
if (NATURAL_EXACT.has(path)) return false;
automaticExecutionAllowed: unsafePaths.length === 0 && unknownPaths.length === 0
`;
  if (path === 'scripts/battle-bridge-control-plane-self-repair.test.mjs') return String.raw`
recoveryLifeboat
recoveryMesh
workerWatchdog
githubCommandMailbox
outboundHealthBeacon
assert.equal(result.taskCount, 5)
endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')
endsWith('install-battle-bridge-worker-watchdog.ps1')
endsWith('install-battle-bridge-outbound-health-beacon.ps1')
assert.equal(result.failedTaskId, 'recoveryLifeboat')
assert.equal(powerShellCalls.length, 5)
`;
  if (path === 'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs') return String.raw`
$wscriptExe
$powershellExe
-WindowStyle Hidden
shell
WScript
`;
  return String.raw`
worker watchdog and Recovery Mesh liveness repair coalesces as natural reload only
windowless Lifeboat delivery and its fixed control-plane reconciler naturally reload without stranding sync
'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'
assert.equal(plan.unknownPathCount, 0)
assert.equal(plan.openClawPathCount, 0)
assert.equal(plan.automaticExecutionAllowed, true)
`;
}

function idempotentContentFor(path) {
  if (path !== 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1') return historicContentFor(path);
  return `${historicContentFor(path)}
function Read-FreshHealthyHeartbeat
function Assert-ActivePayloadManifest
function Assert-CanonicalScheduledTask
Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actions.Count -ne 1
$actions[0].Execute -ne $wscriptExe
$actions[0].Arguments -ne $expectedArguments
$task.Principal.UserId -ne $CurrentUser
$task.Principal.LogonType -ne 'Interactive'
$task.Principal.RunLevel -ne 'Limited'
Read-FreshHealthyHeartbeat -BankId $activeBank -ExpectedManifest
Assert-ActivePayloadManifest -BankId $activeBank -ExpectedManifest
if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {
Assert-CanonicalScheduledTask -CurrentUser $currentUser
Remove-Item -LiteralPath $stageRoot -Recurse -Force
installDisposition = 'ALREADY_CURRENT_HEALTHY'
changed = $false
activeBankAfter = $activeBank
scheduledTaskIdentityReproved = $true
if ($StartNow -and $PSCmdlet.ShouldProcess($taskName, 'Start existing canonical Battle Bridge recovery lifeboat task')) {
Start-ScheduledTask -TaskName $taskName
}
activeBankOverwriteAllowed = $false
dualBankOverwriteAllowed = $false
arbitraryShellAllowed = $false
gitMutationAllowed = $false
sourceMutationAllowed = $false
pcRestartAllowed = $false
return
}
$targetRoot = Join-Path $banksRoot $targetBank
installDisposition = 'PROMOTED_CANDIDATE'
changed = $true
`;
}

function sources({ blobs = HISTORIC_BLOBS, contentFor = historicContentFor, overrides = {} } = {}) {
  return WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1.map((path) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(contentFor(path)),
    blobSha: blobs[path],
    content: contentFor(path),
    ...(overrides[path] || {}),
  }));
}

test('historic specialist still plans exactly the seven-file Lifeboat activation estate for the two generic Windows escalations', () => {
  const result = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: historicAnalysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED');
});

test('historic specialist seals the existing pinned windowless Lifeboat-first activation contract unchanged', () => {
  const result = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: historicAnalysis(),
    sources: sources(),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.equal(result.proofRefs.length, 7);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
});

test('idempotent reinstall profile accepts only the exact singleton installer escalation and exact current repair blobs', () => {
  const plan = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis(),
    sources: [],
  });
  assert.equal(plan.eligible, true);
  assert.deepEqual(plan.reviewedPaths, WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1);

  const result = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis(),
    sources: sources({ blobs: IDEMPOTENT_BLOBS, contentFor: idempotentContentFor }),
  });
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
  assert.equal(result.proofRefs.length, 7);
});

test('idempotent reinstall profile rejects stale pins and any missing same-manifest task/state proof', () => {
  const stale = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis(),
    sources: sources({ contentFor: idempotentContentFor }),
  });
  assert.equal(stale.clean, false);
  assert.ok(stale.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));

  const weakenedInstaller = idempotentContentFor('scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1')
    .replace('Assert-CanonicalScheduledTask -CurrentUser $currentUser', 'REMOVED_TASK_REPROOF');
  const weakened = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis(),
    sources: sources({
      blobs: IDEMPOTENT_BLOBS,
      contentFor: (path) => path === 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
        ? weakenedInstaller
        : idempotentContentFor(path),
    }),
  });
  assert.equal(weakened.clean, false);
  assert.ok(weakened.findings.some((item) => item.code === 'lifeboat-idempotent-task-reproof-not-bound'));
});

test('specialist rejects broadened unsupported surfaces, duplicate findings, widened source estate and wrong pinned source identity', () => {
  const duplicateSingleton = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis({ findings: [...idempotentAnalysis().findings, ...idempotentAnalysis().findings] }),
    sources: [],
  });
  assert.equal(duplicateSingleton.eligible, false);

  const broadened = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: idempotentAnalysis({
      findings: [...idempotentAnalysis().findings, { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }],
    }),
    sources: [],
  });
  assert.equal(broadened.eligible, false);

  const widened = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: historicAnalysis(),
    sources: [...sources(), { ...sources()[0], path: 'extra' }],
  });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-estate-widened'), JSON.stringify(widened.findings));

  const wrongBlob = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: historicAnalysis(),
    sources: sources({
      overrides: {
        'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': { blobSha: 'b'.repeat(40) },
      },
    }),
  });
  assert.equal(wrongBlob.clean, false);
  assert.ok(wrongBlob.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'), JSON.stringify(wrongBlob.findings));
});
