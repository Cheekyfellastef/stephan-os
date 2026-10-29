import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = await readFile(new URL('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const commanderHttp = await readFile(new URL('../../scripts/sovereign-commander-http.mjs', import.meta.url), 'utf8');
const elevatedBootstrap = await readFile(new URL('../../scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1', import.meta.url), 'utf8');
const operatorContext = await readFile(new URL('../../scripts/windows/sovereign-commander-operator-context-v1.ps1', import.meta.url), 'utf8');
const fleetSupervisor = await readFile(new URL('../../scripts/sovereign-commander-fleet-goal-supervisor.mjs', import.meta.url), 'utf8');
const coreDaemon = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');

test('boot recovery installers parse with the Windows PowerShell used by the bootstrap', { skip: process.platform !== 'win32' }, () => {
  const paths = [
    'install-sovereign-commander.ps1',
    'install-sovereign-boot-daemon-tasks-elevated.ps1',
    'install-battle-bridge-recovery-mesh.ps1',
    'stephanos-core-process-observation.ps1',
    'status-stephanos-core-daemon.ps1',
    'run-sovereign-commander-hidden.ps1',
    'sovereign-commander-operator-context-v1.ps1',
  ].map((name) => fileURLToPath(new URL(`../../scripts/windows/${name}`, import.meta.url)));
  const literals = paths.map((path) => `'${path.replace(/'/g, "''")}'`).join(',');
  const command = `$ErrorActionPreference = 'Stop'; $failureCount = 0; foreach ($path in @(${literals})) { $tokens = $null; $parseErrors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors); foreach ($error in $parseErrors) { Write-Output ($path + ':' + $error.Extent.StartLineNumber + ': ' + $error.Message); $failureCount++ } }; if ($failureCount -gt 0) { exit 1 }`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
});

test('windowless launcher exposes Sovereign Commander without a visible console', () => {
  assert.match(launcher, /Case "sovereign-commander-watchdog"/);
  assert.match(launcher, /run-sovereign-commander-hidden\.ps1/);
  assert.match(installer, /wscript\.exe/i);
  assert.match(installer, /-Hidden/);
  assert.match(installer, /visiblePowerShellRequired = \$false/);
});

test('installer creates a local bearer token and does not install a vendor package', () => {
  assert.match(installer, /RandomNumberGenerator/);
  assert.match(installer, /sovereign-commander-token\.txt/);
  assert.match(installer, /existingToken\.Length -ge 32/);
  assert.match(installer, /Set-CurrentUserOnlyFileDacl -Path \$tokenPath -UserSid \$currentUserSid/);
  assert.match(installer, /\$file\.SetAccessControl\(\$acl\)/);
  assert.match(installer, /tokenAclHardened = \$true/);
  assert.doesNotMatch(installer, /\bSet-Acl\b/);
  assert.match(installer, /vendorMeterRequired = \$false/);
  assert.match(installer, /externalSaasRelayRequired = \$false/);
  assert.doesNotMatch(installer, /npm\s+install|npx\s+@wonderwhy-er|desktop-commander/i);
});

test('watchdog retains array snapshots for zero, one, or many process matches', () => {
  assert.match(runner, /\$before = @\(Get-SovereignCommanderProcesses\)/);
  assert.match(runner, /\$after = @\(Get-SovereignCommanderProcesses\)/);
});

test('watchdog recognizes the fixed loopback listener when Windows hides the daemon command line', () => {
  assert.match(runner, /Get-NetTCPConnection/);
  assert.match(runner, /-LocalAddress '127\.0\.0\.1'/);
  assert.match(runner, /-LocalPort \$port/);
  assert.match(runner, /OwningProcess/);
  assert.match(runner, /ProcessId = \$listenerProcessId/);
  assert.match(runner, /Health\/capability checks below still decide/);
});

test('Core watchdog reloads stale runtime immediately but preserves bounded busy flywheel work', () => {
  assert.match(runner, /\$coreHeartbeatFreshSeconds = 60/);
  assert.match(runner, /\$coreBusyGraceSeconds = 300/);
  assert.match(runner, /\$readiness -ne 'RELOAD_REQUIRED'/);
  assert.match(runner, /\$gitExe = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(runner, /\$sourceHeadMatchesLive/);
  assert.match(runner, /\$sourceHeadMatchesLive -and\s*\r?\n\s*\(\$heartbeatFresh -or \$busyGraceActive\)/);
  assert.match(runner, /\$flywheelCycleRunning/);
  assert.match(runner, /\$busyGraceActive/);
  assert.match(runner, /\$age -le \$coreBusyGraceSeconds/);
  assert.match(runner, /coreDaemonBusyGraceActive = \[bool\]\$coreDaemonBusyGraceActive/);
});

test('Core status also fails closed on source-head drift even with a fresh heartbeat', async () => {
  const coreStatus = await readFile(new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8');
  assert.match(coreStatus, /\$gitExe = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(coreStatus, /\$sourceHeadMatchesLive/);
  assert.match(coreStatus, /\$sourceHeadMatchesLive -and\s*\r?\n\s*\(\$heartbeatFresh -or \$busyGraceActive\)/);
  assert.match(coreStatus, /sourceHeadMatchesLive = \[bool\]\$sourceHeadMatchesLive/);
});

test('watchdog starts only the source-controlled local HTTP server and proves health', () => {
  assert.match(runner, /sovereign-commander-http\.mjs/);
  assert.match(runner, /http:\/\/127\.0\.0\.1:\$port\/health/);
  assert.match(runner, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(runner, /Test-Path -LiteralPath \$canonicalNode -PathType Leaf/);
  assert.match(runner, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(runner, /Get-Command node/);
  assert.match(runner, /-WindowStyle Hidden/);
  assert.match(runner, /arbitraryShellAllowed = \$false/);
  assert.match(runner, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(runner, /@wonderwhy-er/i);
  assert.match(runner, /SkipDesktopCommanderCrossHeal/);
  assert.match(runner, /Get-DesktopCommanderRemoteProcesses/);
  assert.match(runner, /Stephanos Commander Watchdog/);
  assert.match(runner, /Start-ScheduledTask -TaskName [$]desktopCommanderTaskName/);
  assert.match(runner, /MultipleInstances=IgnoreNew serializes/);
});



test('watchdog continuously wakes the canonical fleet-goal fabric without owning source mutation', () => {
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /ExecutionTimeLimit \(New-TimeSpan -Minutes 2\)/);
  assert.match(installer, /sovereign-commander-fleet-goal-supervisor\.mjs/);
  assert.match(installer, /fleetGoalSupervisionEnabled = \$true/);
  assert.match(installer, /canonicalGoalFabricOnly = \$true/);
  assert.match(installer, /sourceMutationDelegatedToMissionWorker = \$true/);
  assert.match(installer, /duplicateSchedulerAllowed = \$false/);
  assert.match(installer, /duplicateLeaseAllowed = \$false/);
  assert.match(runner, /sovereign-commander-fleet-goal-supervisor\.mjs/);
  assert.match(runner, /SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=/);
  assert.match(runner, /fleetGoalSupervisorRequested/);
  assert.match(runner, /\$RequireCapabilityVersion -or \$startRequested/);
  assert.match(runner, /SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SKIPPED_DAEMON_BOOTSTRAP/);
  assert.match(runner, /canonicalGoalFabricOnly = \$true/);
  assert.match(runner, /sourceMutationDelegatedToMissionWorker = \$true/);
  assert.match(runner, /healthy = \[bool\]\$overallOk/);
  assert.match(runner, /blocker = \$overallBlocker/);
  assert.match(runner, /duplicateSchedulerAllowed = \$false/);
  assert.match(runner, /duplicateLeaseAllowed = \$false/);
  assert.match(fleetSupervisor, /ensureCriticalBacklogMission/);
  assert.equal(fleetSupervisor.includes('processNextProviderNeutralSourceBuild'), false);
  assert.equal(fleetSupervisor.includes('runBattleBridgeGoalDiscoveryHeartbeat'), false);
  assert.equal(fleetSupervisor.includes('runGitHubLifeboatLane7'), false);
  assert.equal(fleetSupervisor.includes('refreshGitHubLifeboatLane7Capacity'), false);
  assert.equal(fleetSupervisor.includes('refreshForgeLifeboatCapacity'), false);
  assert.equal(fleetSupervisor.includes('refreshDesktopCommanderCapacity'), false);
  assert.match(fleetSupervisor, /synchronousProviderRefreshAllowed: false/);
  assert.doesNotMatch(runner, /Start-ScheduledTask.*mission|New-ScheduledTask.*mission/i);
});

test('installer reports skipped truth instead of claiming installation when ShouldProcess declines', () => {
  assert.match(installer, /\$shouldApply = \$PSCmdlet\.ShouldProcess/);
  assert.match(installer, /if \(-not \$shouldApply\)/);
  assert.match(installer, /installActionPerformed = \$false/);
  assert.match(installer, /mutationPerformed = \$false/);
  assert.match(installer, /startedNow = \$false/);
  assert.match(installer, /SOVEREIGN_COMMANDER_INSTALL_SKIPPED/);
  assert.doesNotMatch(installer, /installed = \$true/);
});

test('watchdog recycles only verified Sovereign Commander processes when capability or continuous repair contract is stale', () => {
  const runnerDefault = runner.match(/\[string\]\$RequireCapabilityVersion = '([^']+)'/)?.[1];
  const httpDefault = commanderHttp.match(/export const SOVEREIGN_COMMANDER_HTTP_CAPABILITY_VERSION = '([^']+)'/)?.[1];
  assert.equal(runnerDefault, '2026-10-18-island-action-contract-v6');
  assert.equal(runnerDefault, httpDefault, 'Direct Windows runner must require the live HTTP capability generation');
  assert.match(runner, /\$serverScriptPattern = \[regex\]::Escape\(\$serverScript\)/);
  assert.match(runner, /CommandLine -match \$serverScriptPattern/);
  assert.match(runner, /PSObject\.Properties\['continuousRepairGuardian'\]/);
  assert.match(runner, /continuousRepairEnabled/);
  assert.match(runner, /continuousRepairRunning/);
  assert.match(runner, /continuousRepairScheduled/);
  assert.match(runner, /\$continuousRepairRunning -or \$continuousRepairScheduled/);
  assert.match(runner, /continuousRepairSatisfied/);
  assert.match(runner, /\$staleContinuousRepair/);
  assert.match(runner, /\$staleDaemonContract = \[bool\]\(\$staleCapability -or \$staleContinuousRepair\)/);
  assert.match(runner, /\$staleContinuousRepairRecycleRequested = \[bool\]\$staleContinuousRepair/);
  assert.match(runner, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
  assert.match(runner, /SOVEREIGN_COMMANDER_STALE_CONTRACT_RECYCLE_FAILED/);
  assert.doesNotMatch(runner, /Stop-Process\s+-Name/);
});


test('capability probing is StrictMode-safe when an old daemon omits capabilityVersion', () => {
  assert.match(runner, /PSObject\.Properties\['capabilityVersion'\]/);
  assert.match(runner, /\$capabilityProperty\.Value/);
  assert.doesNotMatch(runner, /\$null -ne \$health\.capabilityVersion/);
});

test('legacy refresh cannot stop or replace an owner without a terminal custody handoff', { skip: process.platform !== 'win32' }, () => {
  const start = runner.indexOf('if ($healthBefore.timeoutCustodyHeld -eq $true) {');
  const end = runner.indexOf('$after = @(Get-SovereignCommanderProcesses)', start);
  assert.ok(start > 0 && end > start);
  const selection = runner.slice(start, end);
  const harness = `
$ErrorActionPreference = 'Stop'
function Test-Path { return $true }
function Start-Sleep {}
function Stop-Process { $script:stops += 1 }
function Start-Process { $script:starts += 1; return [pscustomobject]@{Id=999} }
$rows = @()
foreach ($case in @('legacy-running','legacy-idle','unreachable-owner','current-idle-mismatch','timeout-held','maintenance-busy','healthy-owner','cold-start')) {
  $script:stops=0; $script:starts=0; $blocker=''; $stoppedPidCount=0
  $serverScript='fixed-server'; $tokenPath='fixed-token'; $canonicalNode='fixed-node'; $repoRoot='fixed-repository'
  $before = @()
  if ($case -ne 'cold-start') { $before = @([pscustomobject]@{ProcessId=123}) }
  $healthyBefore = $case -eq 'healthy-owner'
  $authenticatedInBandParentProof=$false
  $staleDaemonContract=$true; $staleCapability=$true; $staleContinuousRepair=$false
  $healthBefore=[pscustomobject]@{basicHealthy=($case -ne 'unreachable-owner' -and $case -ne 'cold-start');timeoutCustodyHeld=($case -eq 'timeout-held');maintenanceInFlight=($case -eq 'maintenance-busy');continuousRepairRunning=($case -eq 'legacy-running')}
  ${selection}
  $rows += [pscustomobject]@{name=$case;stops=$script:stops;starts=$script:starts;blocker=$blocker}
}
$rows | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout.trim());
  for (const row of rows) {
    assert.equal(row.stops, 0, row.name);
    assert.equal(row.starts, row.name === 'cold-start' ? 1 : 0, row.name);
    if (['legacy-running','legacy-idle','unreachable-owner','current-idle-mismatch'].includes(row.name)) {
      assert.equal(row.blocker, 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN', row.name);
    }
  }
});


test('Commander uses the operator session while separate recovery ingress retains its existing boot configuration', async () => {
  const recoveryInstaller = await readFile(new URL('../../scripts/windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(installer, /-UserId \$currentUserSid -LogonType Interactive -RunLevel Limited/);
  assert.match(installer, /requiresInteractiveLogon = \$true/);
  assert.match(installer, /normalOperatorRuntimeProven = \$false/);
  assert.match(installer, /preLoginExecutionProven = \$false/);
  assert.match(installer, /RestartCount 3/);
  assert.match(recoveryInstaller, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(recoveryInstaller, /-LogonType S4U/);
  assert.match(recoveryInstaller, /requiresInteractiveLogon = \$false/);
  assert.match(recoveryInstaller, /RestartCount 3/);
  assert.match(launcher, /shell\.Environment\("PROCESS"\)\("USERPROFILE"\) = profileRoot/);
  assert.doesNotMatch(installer, /-LogonType S4U\b/);
  assert.doesNotMatch(recoveryInstaller, /-LogonType Interactive\b/);
});


test('one-time boot daemon bootstrap elevates only fixed exact-head task installation', () => {
  assert.match(elevatedBootstrap, /\[ValidatePattern\('\^\[0-9a-fA-F\]\{40\}\$'\)\]/);
  assert.match(elevatedBootstrap, /Start-Process[^\r\n]*-Verb RunAs[^\r\n]*-WindowStyle Hidden/);
  assert.match(elevatedBootstrap, /Stephanos Sovereign Commander/);
  assert.match(elevatedBootstrap, /Stephanos Commander Watchdog/);
  assert.match(elevatedBootstrap, /install-desktop-commander-watchdog[.]ps1/);
  assert.match(elevatedBootstrap, /DESKTOP_COMMANDER_ELEVATED_INSTALL_UNPROVEN/);
  assert.match(elevatedBootstrap, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(elevatedBootstrap, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(elevatedBootstrap, /bootTriggerPresent/);
  assert.match(elevatedBootstrap, /'InteractiveToken' \} else \{ 'S4U'/);
  assert.match(elevatedBootstrap, /logonType -eq \$expectedLogonType/);
  assert.match(elevatedBootstrap, /restartCount -eq 3/);
  assert.match(elevatedBootstrap, /restartInterval -eq 'PT1M'/);
  assert.match(elevatedBootstrap, /SOVEREIGN_DAEMON_TASK_CONFIGURATION_VERIFIED/);
  assert.match(elevatedBootstrap, /'Stephanos Sovereign Commander'[^\r\n]*-RequiresInteractiveOperator/);
  assert.match(elevatedBootstrap, /'InteractiveToken'/);
  assert.match(elevatedBootstrap, /normalOperatorRuntimeProven = \$false/);
  assert.match(elevatedBootstrap, /preLoginExecutionProven = \$false/);
  assert.match(elevatedBootstrap, /runtimeActivationGranted = \$false/);
  assert.doesNotMatch(elevatedBootstrap, /\$allBootSafe/);
  assert.match(elevatedBootstrap, /AppData\\Local\\Stephanos\\sovereign-boot-daemon-bootstrap-v1[.]json/);
  assert.match(elevatedBootstrap, /receiptDeadline = \[DateTimeOffset\]::UtcNow[.]AddSeconds\(20\)/);
  assert.match(elevatedBootstrap, /standingElevatedTaskCreated = \$false/);
  assert.match(elevatedBootstrap, /arbitraryShellAllowed = \$false/);
  assert.match(elevatedBootstrap, /mergeAuthority = \$false/);
  assert.match(elevatedBootstrap, /pcRestartAuthority = \$false/);
  assert.doesNotMatch(elevatedBootstrap, /Invoke-Expression|Restart-Computer|Stop-Process|git\s+(?:reset|clean|checkout|switch)/i);
});

test('actual operator token decisions reject privileged, missing and coerced evidence', { skip: process.platform !== 'win32' }, () => {
  const path = fileURLToPath(new URL('../../scripts/windows/sovereign-commander-operator-context-v1.ps1', import.meta.url)).replace(/'/g, "''");
  const script = `
$ErrorActionPreference='Stop'
. '${path}'
$sid='S-1-5-21-1-2-3-1002'
$rows=@()
foreach($case in @(
 @{name='normal';sid=$sid;role=$false},
 @{name='administrator-despite-limited-metadata';sid=$sid;role=$true},
 @{name='missing-role';sid=$sid;role=$null},
 @{name='string-false';sid=$sid;role='false'},
 @{name='numeric-false';sid=$sid;role=0},
 @{name='service-account';sid='S-1-5-19';role=$false},
 @{name='missing-user';sid=$null;role=$false}
)) {
 $decision=Resolve-SovereignCommanderOperatorContextV1 -UserSid $case.sid -AdministratorRole $case.role
 $rows += [pscustomobject]@{name=$case.name;allowed=$decision.normalOperatorObserved;blocker=$decision.blocker}
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try {
 $expected= -not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 $actual=Get-SovereignCommanderOperatorContextV1
 if($actual.normalOperatorObserved -isnot [bool] -or $actual.normalOperatorObserved -ne $expected){throw 'ACTUAL_TOKEN_OBSERVATION_MISMATCH'}
} finally { $identity.Dispose() }
$rows | ConvertTo-Json -Compress
`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  for (const row of JSON.parse(result.stdout.trim())) {
    assert.equal(row.allowed, row.name === 'normal', row.name);
    assert.equal(row.blocker, row.name === 'normal' ? '' : row.name === 'administrator-despite-limited-metadata' ? 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED' : 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN', row.name);
  }
});

test('task registration proof rejects legacy or altered Commander context without claiming runtime admission', { skip: process.platform !== 'win32' }, () => {
  const start = elevatedBootstrap.indexOf('function Get-BootTaskProof {');
  const end = elevatedBootstrap.indexOf('\nAssert-CanonicalSource', start);
  assert.ok(start > 0 && end > start);
  const script = `
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$wscriptExe='fixed-wscript'
$script:sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Get-ScheduledTask {
 $actions=@([pscustomobject]@{Execute='fixed-wscript';Arguments='fixed-arguments'})
 if($script:case -eq 'extra-action'){$actions+= [pscustomobject]@{Execute='other-program';Arguments='other-arguments'}}
 if($script:case -eq 'wrong-action'){$actions[0].Arguments='different-arguments'}
 [pscustomobject]@{Actions=$actions}
}
function Export-ScheduledTask {
 $type=if($script:case -eq 'legacy-s4u' -or $script:case -eq 'other-existing-s4u'){'S4U'}else{'InteractiveToken'}
 $user=if($script:case -eq 'wrong-user'){'S-1-5-19'}else{$script:sid}
 $logonUser=if($script:case -eq 'wrong-logon-user'){'S-1-5-19'}else{$script:sid}
 $level=if($script:case -eq 'highest'){'HighestAvailable'}else{'LeastPrivilege'}
 '<Task><Principals><Principal><UserId>'+ $user +'</UserId><LogonType>'+ $type +'</LogonType><RunLevel>'+ $level +'</RunLevel></Principal></Principals><Triggers><BootTrigger/><LogonTrigger><UserId>'+ $logonUser +'</UserId></LogonTrigger></Triggers><Settings><Hidden>true</Hidden><StartWhenAvailable>true</StartWhenAvailable><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><RestartOnFailure><Count>3</Count><Interval>PT1M</Interval></RestartOnFailure></Settings></Task>'
}
${elevatedBootstrap.slice(start, end)}
$rows=@()
foreach($script:case in @('normal-registration','legacy-s4u','wrong-user','wrong-logon-user','highest','wrong-action','extra-action','other-existing-s4u')) {
 $interactive=$script:case -ne 'other-existing-s4u'
 $proof=Get-BootTaskProof -TaskName 'fixed-task' -ExpectedArguments 'fixed-arguments' -RequiresInteractiveOperator:$interactive
 $rows += [pscustomobject]@{name=$script:case;verified=$proof.configurationVerified;interactive=$proof.requiresInteractiveLogon;bootSafe=$proof.bootSafe;runtime=$proof.normalOperatorRuntimeProven;preLogin=$proof.preLoginExecutionProven}
}
$rows | ConvertTo-Json -Compress
`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  for (const row of JSON.parse(result.stdout.trim())) {
    assert.equal(row.verified, ['normal-registration', 'other-existing-s4u'].includes(row.name), row.name);
    assert.equal(row.runtime, false, row.name);
    assert.equal(row.preLogin, false, row.name);
    if (row.name === 'normal-registration') {
      assert.equal(row.interactive, true);
      assert.equal(row.bootSafe, false);
    }
    if (row.name === 'other-existing-s4u') assert.equal(row.bootSafe, true);
  }
});

test('watchdog stops privileged or unknown startup context before lifecycle mutations', { skip: process.platform !== 'win32' }, () => {
  const start = runner.indexOf('$operatorContext = Get-SovereignCommanderOperatorContextV1');
  const end = runner.indexOf('$serverScript =', start);
  assert.ok(start > 0 && end > start);
  assert.ok(end < runner.indexOf('Stop-Process'));
  assert.ok(end < runner.indexOf('Start-Process'));
  assert.match(operatorContext, /WindowsIdentity\]::GetCurrent\(\)/);
  assert.doesNotMatch(operatorContext, /Start-Process|Stop-Process|Register-ScheduledTask|SetAccessControl|Impersonate|CreateRestrictedToken/);
  for (const value of ['$false', "'true'"]) {
    const script = `$ErrorActionPreference='Stop'; function Get-SovereignCommanderOperatorContextV1 { [pscustomobject]@{normalOperatorObserved=${value};blocker='SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED'} };\n${runner.slice(start, end)}\nthrow 'LIFECYCLE_REACHED'`;
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 2, result.stderr);
    const row = JSON.parse(result.stdout.trim());
    assert.equal(row.healthy, false);
    assert.equal(row.runtimeActivationGranted, false);
    assert.equal(row.sourceMutationAllowed, false);
    assert.equal(row.pcRestartAllowed, false);
  }
});


test('in-band maintenance never deadlocks on Sovereign self-health and waits for fresh Core truth', () => {
  assert.match(runner, /STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN/);
  assert.match(runner, /STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP/);
  assert.match(runner, /STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY/);
  assert.match(runner, /authenticatedInBandParentProof/);
  assert.match(runner, /STEPHANOS_CORE_BOOTSTRAP_SOVEREIGN_PARENT_PROVEN/);
  assert.match(runner, /SetEnvironmentVariable\(\$coreBootstrapMarkerName, '1', 'Process'\)/);
  assert.match(runner, /SetEnvironmentVariable\(\$coreBootstrapMarkerName, \$coreBootstrapMarkerPrevious, 'Process'\)/);
  assert.match(coreDaemon, /STEPHANOS_CORE_BOOTSTRAP_SOVEREIGN_PARENT_PROVEN/);
  assert.match(coreDaemon, /bootstrapSovereignParentProofAvailable = false/);
  assert.match(coreDaemon, /SOVEREIGN_COMMANDER_AUTHENTICATED_PARENT_BOOTSTRAP_PROVEN/);
  assert.match(coreDaemon, /: probeSovereignCommanderRuntimeCompatibility\(\)/);
  assert.match(runner, /Wait-SovereignCommanderHealth/);
  assert.match(runner, /Wait-StephanosCoreDaemonHealth/);
  assert.match(runner, /coreDaemonStartRequested -or \$coreDaemonRestartRequested/);
});
