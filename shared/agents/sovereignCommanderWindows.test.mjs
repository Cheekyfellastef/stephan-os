import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const launcher = await readFile(new URL('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const elevatedBootstrap = await readFile(new URL('../../scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1', import.meta.url), 'utf8');
const fleetSupervisor = await readFile(new URL('../../scripts/sovereign-commander-fleet-goal-supervisor.mjs', import.meta.url), 'utf8');
const coreDaemon = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');

test('boot recovery installers parse with the Windows PowerShell used by the bootstrap', { skip: process.platform !== 'win32' }, () => {
  const paths = [
    'install-sovereign-commander.ps1',
    'install-sovereign-boot-daemon-tasks-elevated.ps1',
    'install-battle-bridge-recovery-mesh.ps1',
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
  assert.match(runner, /\[string\]\$RequireCapabilityVersion = '2026-10-05-continuous-repair-reporting-v4'/);
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


test('Sovereign Commander and remote recovery ingress are boot-safe before interactive logon', async () => {
  const recoveryInstaller = await readFile(new URL('../../scripts/windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(installer, /-LogonType S4U/);
  assert.match(installer, /requiresInteractiveLogon = \$false/);
  assert.match(installer, /RestartCount 3/);
  assert.match(recoveryInstaller, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(recoveryInstaller, /-LogonType S4U/);
  assert.match(recoveryInstaller, /requiresInteractiveLogon = \$false/);
  assert.match(recoveryInstaller, /RestartCount 3/);
  assert.match(launcher, /shell\.Environment\("PROCESS"\)\("USERPROFILE"\) = profileRoot/);
  assert.doesNotMatch(installer, /-LogonType Interactive\b/);
  assert.doesNotMatch(recoveryInstaller, /-LogonType Interactive\b/);
});


test('one-time boot daemon bootstrap elevates only fixed exact-head task installation', () => {
  assert.match(elevatedBootstrap, /\[ValidatePattern\('\^\[0-9a-fA-F\]\{40\}\$'\)\]/);
  assert.match(elevatedBootstrap, /Start-Process[^\r\n]*-Verb RunAs[^\r\n]*-WindowStyle Hidden/);
  assert.match(elevatedBootstrap, /Stephanos Sovereign Commander/);
  assert.match(elevatedBootstrap, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(elevatedBootstrap, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(elevatedBootstrap, /bootTriggerPresent/);
  assert.match(elevatedBootstrap, /logonType -eq 'S4U'/);
  assert.match(elevatedBootstrap, /restartCount -eq 3/);
  assert.match(elevatedBootstrap, /restartInterval -eq 'PT1M'/);
  assert.match(elevatedBootstrap, /SOVEREIGN_BOOT_DAEMON_TASKS_INSTALLED_AND_PROVEN/);
  assert.match(elevatedBootstrap, /standingElevatedTaskCreated = \$false/);
  assert.match(elevatedBootstrap, /arbitraryShellAllowed = \$false/);
  assert.match(elevatedBootstrap, /mergeAuthority = \$false/);
  assert.match(elevatedBootstrap, /pcRestartAuthority = \$false/);
  assert.doesNotMatch(elevatedBootstrap, /Invoke-Expression|Restart-Computer|Stop-Process|git\s+(?:reset|clean|checkout|switch)/i);
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
