import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1,
  analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview,
} from './windowsAuthorityBattleBridgeLifeboatActivationReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const BLOBS = Object.freeze({
  'scripts/battle-bridge-control-plane-self-repair.test.mjs': '08911f3e3ba07bd1714a5e9c6203596e97190428',
  'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs': '7f54c6f911d0f7012121b615b8cb6d84adffb46a',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': '1da7c432fd051f7b9249d881638d21b131fa98a4',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs': 'c724540a727aab7881dd3b06b52aa7cf9d86f7d8',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs': '4923796bd34b1e6dcac0ec6fe45c17bc001dc27f',
  'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs': 'c42b73f478c96a306890ba96e318bb7c23f1b9b5',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs': '40f6b6c5d6d5030fd2cfdd17bf3b15b09f56e35c',
});

function analysis(overrides = {}) {
  return {
    findings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1' },
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs' },
    ],
    ...overrides,
  };
}

function contentFor(path) {
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
id: 'githubCommandMailbox'
const POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT_EXE = 'C:\\Program Files\\Git\\cmd\\git.exe';
shell: false
'-File', installerPath
'-StartNow'
function validateRecoveryLifeboatReceipt
payload.scheduledTaskExecutable === 'C:\\Windows\\System32\\wscript.exe'
payload.directPowerShellTaskLaunch === false
payload.githubClaimConsumerIncluded === true
payload.repoCheckoutRequiredAfterInstall === false
payload.openClawGatewayRequiredAfterInstall === false
task.id === 'recoveryLifeboat'
`;
  if (path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs') return String.raw`
'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'
'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
automaticExecutionAllowed: unsafePaths.length === 0 && unknownPaths.length === 0
`;
  if (path === 'scripts/battle-bridge-control-plane-self-repair.test.mjs') return String.raw`
id: 'recoveryLifeboat'
id: 'recoveryMesh'
id: 'githubCommandMailbox'
assert.equal(result.taskCount, 3)
endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')
assert.equal(result.failedTaskId, 'recoveryLifeboat')
assert.equal(result.failedTaskId, 'recoveryMesh')
assert.equal(powerShellCalls.length, 3)
`;
  if (path === 'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs') return String.raw`
New-ScheduledTaskAction -Execute \$wscriptExe
shell\.Run\(command, 0, True\)
WScript\.Arguments
New-ScheduledTaskAction -Execute \$powershellExe
-WindowStyle Hidden
`;
  return String.raw`
windowless Lifeboat delivery and its fixed control-plane reconciler naturally reload without stranding sync
'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1'
'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs'
assert.equal(plan.unknownPathCount, 0)
assert.equal(plan.automaticExecutionAllowed, true)
`;
}

function sources(overrides = {}) {
  return WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1.map((path) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(contentFor(path)),
    blobSha: BLOBS[path],
    content: contentFor(path),
    ...(overrides[path] || {}),
  }));
}

test('specialist plans exactly the seven-file Lifeboat activation estate for the two generic Windows escalations', () => {
  const result = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_BATTLE_BRIDGE_LIFEBOAT_ACTIVATION_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED');
});

test('specialist seals only the exact pinned windowless Lifeboat-first activation contract', () => {
  const result = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: sources(),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.proofRefs.length, 7);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
});

test('specialist rejects broadened generic findings, widened source estate and wrong pinned source identity', () => {
  const broadened = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis({ findings: [...analysis().findings, { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] }),
    sources: [],
  });
  assert.equal(broadened.eligible, false);

  const widened = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [...sources(), { ...sources()[0], path: 'extra' }],
  });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-estate-widened'));

  const wrongBlob = analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: sources({
      'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1': { blobSha: 'b'.repeat(40) },
    }),
  });
  assert.equal(wrongBlob.clean, false);
  assert.ok(wrongBlob.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});
