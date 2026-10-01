import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcher = await readFile(new URL('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
const fleetSupervisor = await readFile(new URL('../../scripts/sovereign-commander-fleet-goal-supervisor.mjs', import.meta.url), 'utf8');

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
  assert.doesNotMatch(runner, /@wonderwhy-er|desktop-commander/i);
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

test('watchdog can boundedly recycle only verified Sovereign Commander processes when capability is stale', () => {
  assert.match(runner, /\[string\]\$RequireCapabilityVersion = ''/);
  assert.match(runner, /\$serverScriptPattern = \[regex\]::Escape\(\$serverScript\)/);
  assert.match(runner, /CommandLine -match \$serverScriptPattern/);
  assert.match(runner, /\$staleCapabilityRecycleRequested = \$true/);
  assert.match(runner, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
  assert.match(runner, /SOVEREIGN_COMMANDER_STALE_CAPABILITY_RECYCLE_FAILED/);
  assert.doesNotMatch(runner, /Stop-Process\s+-Name/);
});


test('capability probing is StrictMode-safe when an old daemon omits capabilityVersion', () => {
  assert.match(runner, /PSObject\.Properties\['capabilityVersion'\]/);
  assert.match(runner, /\$capabilityProperty\.Value/);
  assert.doesNotMatch(runner, /\$null -ne \$health\.capabilityVersion/);
});


test('Sovereign Commander and remote recovery ingress use the proven unattended auto-logon lifecycle', async () => {
  const recoveryInstaller = await readFile(new URL('../../scripts/windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(installer, /-LogonType Interactive/);
  assert.match(installer, /atStartup = \$false/);
  assert.match(installer, /requiresInteractiveLogon = \$true/);
  assert.match(installer, /RestartCount 3/);
  assert.match(recoveryInstaller, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(recoveryInstaller, /-LogonType Interactive/);
  assert.match(recoveryInstaller, /atStartup = \$false/);
  assert.match(recoveryInstaller, /requiresInteractiveLogon = \$true/);
  assert.match(recoveryInstaller, /RestartCount 3/);
  assert.doesNotMatch(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.doesNotMatch(recoveryInstaller, /New-ScheduledTaskTrigger -AtStartup/);
});
