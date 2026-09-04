import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installPath = new URL('./windows/install-battle-bridge-worker-watchdog.ps1', import.meta.url);
const statusPath = new URL('./windows/status-battle-bridge-worker-watchdog.ps1', import.meta.url);
const uninstallPath = new URL('./windows/uninstall-battle-bridge-worker-watchdog.ps1', import.meta.url);
const probePath = new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url);
const restartPath = new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url);
const workerStartPath = new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-worker-watchdog-hidden.ps1', import.meta.url);

function parameterBlock(source) {
  const match = source.match(/param\(([^)]*)\)/s);
  return match?.[1] || '';
}

function finalWorkerProofPrecedesConfirmation(source) {
  const postProof = source.indexOf("-Phase 'POST_START'");
  const finalTaskRead = source.indexOf(
    "$afterTask = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop",
    postProof,
  );
  const exactTaskState = source.indexOf("if ([string]$afterTask.State -ne 'Running')", finalTaskRead);
  const preparedReceipt = source.indexOf('$successReceiptJson = [PSCustomObject]@{', exactTaskState);
  const finalDeadline = source.indexOf('Assert-BeforeOperationDeadline -RequiredReserveSeconds 1', preparedReceipt);
  const confirmationWrite = source.indexOf('Write-BoundedAtomicJson -Path $confirmationPath', postProof);
  const guardedCatch = source.indexOf('\n        catch {', confirmationWrite);
  const blockerGate = source.indexOf('if ($startupBlocker)', guardedCatch);
  const cleanup = source.indexOf('Stop-NewlyStartedOwnedWorker', blockerGate);
  const successPublication = source.indexOf('Write-Output $successReceiptJson', cleanup);
  const afterConfirmationBeforeCatch = source.slice(confirmationWrite, guardedCatch);
  return postProof >= 0
    && finalTaskRead > postProof
    && exactTaskState > finalTaskRead
    && preparedReceipt > exactTaskState
    && finalDeadline > preparedReceipt
    && confirmationWrite > finalDeadline
    && guardedCatch > confirmationWrite
    && blockerGate > guardedCatch
    && cleanup > blockerGate
    && successPublication > cleanup
    && !/Assert-BeforeOperationDeadline|Get-ScheduledTask|ConvertTo-Json/.test(afterConfirmationBeforeCatch);
}

function exactOwnedLauncherCleanupBoundary(source) {
  const launchFunction = source.indexOf('function Start-ExactWorkerWithLaunchIdentity');
  const guardedStart = source.indexOf('if (-not $workerProcess.Start())', launchFunction);
  const startedCapability = source.indexOf('$workerProcessStarted = $true', guardedStart);
  const ownedCapability = source.indexOf('$ownedWorkerProcess = $workerProcess', startedCapability);
  const startTimeRead = source.indexOf('$workerStartedAtUtc = $workerProcess.StartTime.ToUniversalTime()', ownedCapability);
  const receiptWrite = source.indexOf('Write-BoundedCreateOnlyJson -Path $launchReceiptPath', startTimeRead);
  const guardedCatch = source.indexOf('\n    catch {', receiptWrite);
  const cleanup = source.indexOf('Stop-ExactOwnedWorkerProcess `', guardedCatch);
  return launchFunction >= 0
    && guardedStart > launchFunction
    && startedCapability > guardedStart
    && ownedCapability > startedCapability
    && startTimeRead > ownedCapability
    && receiptWrite > startTimeRead
    && guardedCatch > receiptWrite
    && cleanup > guardedCatch
    && source.includes('[object]::ReferenceEquals($Process, $OwnedProcess)')
    && source.includes('[System.IO.Path]::GetFullPath([string]$Process.StartInfo.FileName)')
    && source.includes("[string]$Process.StartInfo.Arguments -ne ('\"' + $ExpectedWorkerScript + '\"')")
    && source.includes('$ExpectedStartedAtUtc -ne [datetime]::MinValue')
    && source.includes('$observedStartedAtUtc.Ticks -ne $ExpectedStartedAtUtc.ToUniversalTime().Ticks')
    && source.includes('$Process.Kill()')
    && source.includes('$Process.WaitForExit(5000)')
    && source.includes('if ($workerProcessStarted)')
    && source.includes("schemaVersion = 'stephanos.mission-worker-launch-identity.v1'")
    && source.includes("$processStartInfo.EnvironmentVariables['STEPHANOS_MISSION_WORKER_LAUNCH_ID'] = $LaunchIdentityId")
    && source.includes("$processStartInfo.EnvironmentVariables['STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH'] = $launchReceiptPath")
    && /Start-ExactWorkerWithLaunchIdentity[\s\S]*-LaunchKind 'guarded-restart'/.test(source)
    && /Start-ExactWorkerWithLaunchIdentity[\s\S]*-LaunchKind 'ordinary'/.test(source)
    && source.includes('throw $launchFailure');
}

function strictRestartInvocationBoundary({ probe, restart, launcher }) {
  return probe.includes("$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'")
    && probe.includes('$arguments.Count -ne 2')
    && probe.includes('CommandLineToArgvW')
    && probe.includes('if ([string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath)) { return $false }')
    && probe.includes('$resolvedExecutePath, $canonicalNode')
    && probe.includes('$commandExecutable, $canonicalNode')
    && probe.includes('$scriptArgument = [System.IO.Path]::GetFullPath([string]$arguments[1])')
    && /\$scriptArgument,\r?\n\s*\$workerPath,/.test(probe)
    && probe.includes("$restartReceipt.invocationId -match '^[0-9a-f]{64}$'")
    && probe.includes('$restartReceipt.deadlineUtc -eq $canonicalDeadlineUtc')
    && restart.includes('mission-orchestrator-worker-restart-heartbeat-$ExpectedInvocationId.json')
    && restart.includes('$invocationHeartbeat.invocationId -ne $ExpectedInvocationId')
    && restart.includes('$timestamp -lt $boundHeartbeatTimestampUtc')
    && restart.includes('$sharedHeartbeatObservedAtUtc = [datetime]::UtcNow')
    && restart.includes('$timestamp -gt $sharedHeartbeatObservedAtUtc')
    && restart.includes('$invocationHeartbeatObservedAtUtc = [datetime]::UtcNow')
    && restart.includes('$boundHeartbeatTimestampUtc -gt $invocationHeartbeatObservedAtUtc')
    && !restart.includes('$boundHeartbeatTimestampUtc.Ticks -ne $timestamp.Ticks')
    && restart.includes('$processStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks')
    && restart.includes('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks')
    && restart.includes('$reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks')
    && restart.includes('Assert-BeforeOperationDeadline -RequiredReserveSeconds 1')
    && finalWorkerProofPrecedesConfirmation(restart)
    && restart.includes("deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')")
    && !restart.includes("deadlineUtc = $script:operationDeadlineUtc.ToString('o')")
    && launcher.includes('$processStartInfo.FileName = $canonicalNode')
    && launcher.includes('$processStartInfo.Arguments = \'"\' + $workerScript + \'"\'')
    && launcher.includes('$workerHeartbeat.pid -eq $workerProcess.Id')
    && launcher.includes('$workerHeartbeat.launchIdentityId -eq $invocationId')
    && launcher.includes('$workerHeartbeat.workerStartedAtUtc')
    && launcher.includes('$heartbeatTimestampUtc -gt $workerStartedAtUtc')
    && launcher.includes('$heartbeatObservedAtUtc = [datetime]::UtcNow')
    && launcher.includes('$heartbeatTimestampUtc -le $heartbeatObservedAtUtc')
    && launcher.includes('$workerProcess.StartTime.ToUniversalTime().Ticks -eq $workerStartedAtUtc.Ticks')
    && launcher.includes('if ($confirmation -and $invocationHeartbeatBound)')
    && launcher.includes("[string]$record.deadlineUtc -ne $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')")
    && restart.includes('$receiptProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks')
    && restart.includes('$liveProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks')
    && restart.includes('$heartbeatTimestampUtc -gt $observedAtUtc')
    && !restart.includes('$heartbeatTimestampUtc -gt $observedAtUtc.AddSeconds(60)')
    && restart.includes('($observedAtUtc - $heartbeatTimestampUtc).TotalSeconds -gt 120')
    && restart.includes('[System.Diagnostics.Process]::GetProcessById($processId)')
    && restart.includes('$null = $processCapability.Handle')
    && restart.includes('ProcessCapability = $processCapability')
    && restart.includes('$reverifiedProcessCapability = $oldWorkerRecheck.ProcessCapability')
    && restart.includes('$reverifiedProcessCapability.StartTime.ToUniversalTime()')
    && restart.includes('$reverifiedProcessCapability.Kill()')
    && restart.includes('$reverifiedProcessCapability.WaitForExit(10000)')
    && !restart.includes('Stop-Process -Id $oldWorker.ProcessId')
    && restart.includes('$oldWorkerRecheck.LaunchIdentityId -ne $oldWorker.LaunchIdentityId')
    && restart.includes('$oldWorkerRecheck.LaunchReceiptDigest -ne $oldWorker.LaunchReceiptDigest')
    && restart.includes('$oldWorkerRecheck.HeartbeatTimestampUtc -lt $oldWorker.HeartbeatTimestampUtc')
    && exactOwnedLauncherCleanupBoundary(launcher)
    && !launcher.includes('$processStartInfo.Arguments +=');
}

function typedRestartFailureBoundary({ probe, restart }) {
  const propertyEstate = probe.match(/\$missionWorkerRestartFailureProperties = @\(([\s\S]*?)\n\)/)?.[1] || '';
  const blockerEstate = probe.match(/\$missionWorkerRestartFailureBlockers = @\(([\s\S]*?)\n\)/)?.[1] || '';
  const probeBlockers = new Set([...blockerEstate.matchAll(/'(MISSION_WORKER_[A-Z0-9_:-]+)'/g)].map((match) => match[1]));
  const adapterBlockers = new Set([...restart.matchAll(/'(MISSION_WORKER_[A-Z0-9_:-]+)'/g)].map((match) => match[1]));
  const nonZero = probe.indexOf('if ($LASTEXITCODE -ne 0) {');
  const typedRead = probe.indexOf('Read-ValidatedMissionWorkerRestartFailureBlocker `', nonZero);
  const typedThrow = probe.indexOf('if ($typedRestartBlocker) { throw $typedRestartBlocker }', typedRead);
  const genericThrow = probe.indexOf("throw 'The approved runtime restart adapter failed.'", typedThrow);
  return propertyEstate.includes("'schemaVersion', 'target', 'expectedHead', 'exactHeadProofOk', 'postStartSourceProofOk'")
    && propertyEstate.includes("'liveOpenClawUpdatePerformed', 'ok', 'blocker', 'finalVerdict'")
    && probe.includes('Test-ExactJsonPropertyEstate -Record $receipt -ExpectedProperties $missionWorkerRestartFailureProperties')
    && probe.includes("[string]$receipt.schemaVersion -ne 'stephanos.approved-runtime-restart.v1'")
    && probe.includes("[string]$receipt.target -ne 'mission-worker'")
    && probe.includes('[string]$receipt.expectedHead -ne $ExpectedHead')
    && probe.includes('[string]$receipt.deadlineUtc -ne $ExpectedDeadlineUtc')
    && probe.includes('$receipt.exactHeadProofOk -ne $false')
    && probe.includes('$receipt.postStartSourceProofOk -ne $false')
    && probe.includes('$receipt.unrelatedTasksChanged -ne $false')
    && probe.includes('$receipt.arbitraryTaskTargetAllowed -ne $false')
    && probe.includes('$receipt.arbitraryProcessKillAllowed -ne $false')
    && probe.includes('$receipt.verifiedOwnedProcessTerminationOnly -ne $true')
    && probe.includes('$receipt.liveOpenClawUpdatePerformed -ne $false')
    && probe.includes('$receipt.ok -ne $false')
    && probe.includes("[string]$receipt.finalVerdict -ne 'APPROVED_RUNTIME_RESTART_BLOCKED'")
    && probe.includes('if ($missionWorkerRestartFailureBlockers -notcontains $blocker) { return \'\' }')
    && probe.includes('$restartBytes -le 0 -or $restartBytes -gt 8192')
    && probeBlockers.size > 0
    && [...probeBlockers].every((blocker) => adapterBlockers.has(blocker))
    && [...adapterBlockers].every((blocker) => probeBlockers.has(blocker))
    && nonZero >= 0
    && typedRead > nonZero
    && typedThrow > typedRead
    && genericThrow > typedThrow
    && !/Write-Output\s+\$restartOutput|throw\s+\$restartJson|throw\s+\$restartOutput/.test(probe);
}

test('installer exposes only StartNow and registers hidden limited fixed watchdog plus visibility reconciler', async () => {
  const source = await readFile(installPath, 'utf8');
  assert.deepEqual([...parameterBlock(source).matchAll(/\[switch\]\s*\$(\w+)/g)].map((match) => match[1]), ['StartNow']);
  assert.match(source, /Stephanos Mission Orchestrator Worker Watchdog/);
  assert.match(source, /New-ScheduledTaskAction -Execute \$wscriptExe/);
  assert.match(source, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(source, /\/\/B \/\/NoLogo/);
  assert.match(source, /worker-watchdog/);
  assert.match(source, /remoteCodexVisibilityReconciler = \$true/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /-AtLogOn/);
  assert.match(source, /-Hidden/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process powershell|Stop-Process|Restart-Computer|shutdown\.exe/i);
});

test('watchdog headless launcher pins the canonical fixed Node runner', async () => {
  const source = await readFile(hiddenLauncherPath, 'utf8');
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /battle-bridge-worker-watchdog-runner\.mjs/);
  assert.match(source, /battle-bridge-worker-watchdog-launch-current\.json/);
  assert.match(source, /WATCHDOG_HIDDEN_WRAPPER_STARTED/);
  assert.match(source, /WATCHDOG_RUNNER_STARTING/);
  assert.match(source, /WATCHDOG_RUNNER_COMPLETED/);
  assert.match(source, /WATCHDOG_RUNNER_FAILED/);
  assert.match(source, /Get-Command node\.exe/);
  assert.match(source, /ConvertFrom-Json/);
  assert.equal(parameterBlock(source).trim(), '');
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|cmd\.exe/i);
});

test('operator status script is read-only and surfaces watchdog plus worker heartbeat', async () => {
  const source = await readFile(statusPath, 'utf8');
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /Get-ScheduledTaskInfo/);
  assert.match(source, /battle-bridge-worker-watchdog-current\.json/);
  assert.match(source, /battle-bridge-worker-watchdog-launch-current\.json/);
  assert.match(source, /mission-orchestrator-worker-heartbeat\.json/);
  assert.doesNotMatch(source, /Register-ScheduledTask|Unregister-ScheduledTask|Start-ScheduledTask|Stop-ScheduledTask|Stop-Process/);
});

test('rollback removes only the watchdog task and preserves worker, source and proof', async () => {
  const source = await readFile(uninstallPath, 'utf8');
  assert.match(source, /Unregister-ScheduledTask -TaskName \$taskName/);
  assert.match(source, /workerTaskPreserved = \$true/);
  assert.match(source, /sourcePreserved = \$true/);
  assert.match(source, /sharedWorkspaceReceiptsPreserved = \$true/);
  assert.doesNotMatch(source, /Remove-Item|Stop-Process|Restart-Computer|shutdown\.exe|\bgit(?:\.exe)?\s/i);
});

test('internal probe permits only inspect or exact-head canonical worker restart', async () => {
  const source = await readFile(probePath, 'utf8');
  assert.match(source, /ValidateSet\('Inspect', 'StartApprovedWorkerTask'\)/);
  assert.match(source, /\$taskName = 'Stephanos Mission Orchestrator Worker'/);
  assert.match(source, /\$workerLauncherPath/);
  assert.match(source, /\$windowlessLauncherPath/);
  assert.match(source, /Test-CanonicalWorkerTaskAction/);
  assert.match(source, /TaskPath -ne '\\'/);
  assert.match(source, /\.Actions\.Count -ne 1/);
  assert.match(source, /actionMatchesCanonicalWorker/);
  assert.match(source, /The fixed Mission Orchestrator worker task action is not canonical/);
  assert.match(source, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(source, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(source, /\$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/);
  assert.match(source, /& \$canonicalPowerShell @restartArguments/);
  assert.doesNotMatch(source, /Get-Command (?:git|powershell)(?:\.exe)?\b/i);
  assert.match(source, /'mission-worker'/);
  assert.match(source, /'-ExpectedHead'/);
  assert.match(source, /\$repositoryHead/);
  assert.match(source, /'-TimeoutSeconds',[\s\S]*'30'/);
  assert.match(source, /'-DeadlineUtc',[\s\S]*\$canonicalDeadlineUtc/);
  assert.match(source, /\$parsedDeadlineUtc -le \[datetime\]::UtcNow/);
  assert.match(source, /\$restartReceipt\.invocationId -match '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(source, /\$restartReceipt\.deadlineUtc -eq \$canonicalDeadlineUtc/);
  assert.match(source, /\$restartReceipt\.invocationBound -eq \$true/);
  assert.match(source, /\$restartReceipt\.canonicalWorkerCommandVerified -eq \$true/);
  assert.match(source, /status '--porcelain=v1' '--untracked-files=no'/);
  assert.match(source, /sourceTrackedClean = \$true/);
  assert.match(source, /\[string\]\$restartReceipt\.publicMainHead -eq \$repositoryHead/);
  assert.match(source, /\$restartReceipt\.postStartSourceProofOk -eq \$true/);
  assert.match(source, /\$restartReceipt\.cleanupAttempted -eq \$false/);
  assert.match(source, /\$restartReceipt\.cleanupCompleted -eq \$false/);
  assert.match(source, /\$restartStartedWorkerPid -gt 0/);
  assert.doesNotMatch(source, /trackedStatusAfterRestart|remoteMainHeadAfterRestart|repositoryHeadAfterRestart|repositoryBranchAfterRestart/);
  assert.match(source, /APPROVED_RUNTIME_RESTART_PASS/);
  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /CommandLineToArgvW/);
  assert.match(source, /Test-CanonicalWorkerProcessCommandLine/);
  assert.match(source, /\$arguments\.Count -ne 2/);
  assert.match(source, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(source, /\$arguments\[1\]/);
  assert.match(source, /\$arguments\[2\]/);
  assert.match(source, /\$arguments\[3\]\s*-eq 'mission-worker'/);
  assert.match(source, /wscript\.exe/);
  assert.doesNotMatch(source, /IndexOf\(\$workerPath/);
  assert.doesNotMatch(source, /\[string\]\$TaskName|Stop-ScheduledTask|Stop-Process|Invoke-Expression|Restart-Computer|shutdown\.exe/i);
});

test('stale canonical worker reclaim is unique, task-quiescent and process-capability bound', async () => {
  const source = await readFile(restartPath, 'utf8');
  const helperStart = source.indexOf('function Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat');
  const freshWorkerStart = source.indexOf('function Get-VerifiedFreshWorkerInstance', helperStart);
  const missionWorkerBranch = source.indexOf("$heartbeatPath = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace\\status\\mission-orchestrator-worker-heartbeat.json'");
  const taskStop = source.indexOf("Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\'", missionWorkerBranch);
  const reclaim = source.indexOf('$orphanWorker = Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat -ExpectedRepoRoot $repoRoot', missionWorkerBranch);
  const guardedStart = source.indexOf("Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\'", reclaim);
  const helperSource = source.slice(helperStart, freshWorkerStart);

  assert.ok(helperStart >= 0);
  assert.ok(freshWorkerStart > helperStart);
  assert.ok(taskStop > missionWorkerBranch);
  assert.ok(reclaim > taskStop);
  assert.ok(guardedStart > reclaim);
  assert.match(helperSource, /Get-CimInstance Win32_Process -Filter "Name = 'node\.exe'"/);
  assert.match(helperSource, /Test-ExactCanonicalWorkerProcess -Process \$process -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(helperSource, /\$canonicalWorkers\.Count -gt 1/);
  assert.match(helperSource, /MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS/);
  assert.match(helperSource, /\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)/);
  assert.match(helperSource, /\$processCapability\.StartTime\.ToUniversalTime\(\)/);
  assert.match(helperSource, /Get-CimInstance Win32_Process -Filter "ProcessId = \$processId"/);
  assert.match(helperSource, /Test-ExactCanonicalWorkerProcess -Process \$candidateReRead -ExpectedRepoRoot \$ExpectedRepoRoot/);
  assert.match(helperSource, /\$candidateReReadStartedAtUtc\.Ticks -ne \$candidateStartedAtUtc\.Ticks/);
  assert.match(helperSource, /ProcessStartedAtUtc = \$capabilityProcessStartedAtUtc/);
  assert.doesNotMatch(helperSource, /\$capabilityProcessStartedAtUtc\.Ticks -ne \$candidateStartedAtUtc\.Ticks/);
  assert.match(source, /\$orphanWorkerRecheck\.ProcessStartedAtUtc\.Ticks -ne \$orphanWorker\.ProcessStartedAtUtc\.Ticks/);
  assert.match(source, /\$reverifiedOrphanProcessCapability\.Kill\(\)/);
  assert.match(source, /\$reverifiedOrphanProcessCapability\.WaitForExit\(10000\)/);
  assert.doesNotMatch(helperSource, /Stop-Process|Invoke-Expression|Start-Process|cmd\.exe/i);
});

test('typed mission-worker restart failures are bounded to the exact blocked adapter contract', async () => {
  const [probe, restart] = await Promise.all([
    readFile(probePath, 'utf8'),
    readFile(restartPath, 'utf8'),
  ]);
  assert.equal(typedRestartFailureBoundary({ probe, restart }), true);

  const attacks = [
    { probe: probe.replace("[string]$receipt.target -ne 'mission-worker'", '$false'), restart },
    { probe: probe.replace('[string]$receipt.expectedHead -ne $ExpectedHead', '$false'), restart },
    { probe: probe.replace('[string]$receipt.deadlineUtc -ne $ExpectedDeadlineUtc', '$false'), restart },
    { probe: probe.replace('$receipt.arbitraryTaskTargetAllowed -ne $false', '$false'), restart },
    { probe: probe.replace('$receipt.arbitraryProcessKillAllowed -ne $false', '$false'), restart },
    { probe: probe.replace('$receipt.liveOpenClawUpdatePerformed -ne $false', '$false'), restart },
    { probe: probe.replace("[string]$receipt.finalVerdict -ne 'APPROVED_RUNTIME_RESTART_BLOCKED'", '$false'), restart },
    { probe: probe.replace("'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',", "'MISSION_WORKER_ATTACKER_SELECTED',"), restart },
    { probe: probe.replace('if ($typedRestartBlocker) { throw $typedRestartBlocker }', '# typed blocker suppressed'), restart },
    { probe: probe.replace("throw 'The approved runtime restart adapter failed.'", 'Write-Output $restartOutput'), restart },
  ];
  for (const [index, attack] of attacks.entries()) {
    assert.equal(typedRestartFailureBoundary(attack), false, `typed failure attack ${index} must fail closed`);
  }
});

test('worker launcher is pinned to canonical main and supervised heartbeat loop', async () => {
  const source = await readFile(workerStartPath, 'utf8');
  assert.match(source, /mission-orchestrator-worker-supervised\.mjs/);
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /\$branch -ne 'main'/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_HEAD_SHA/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_TASK_NAME/);
  assert.match(source, /function Invoke-BoundedWorkerLogRetention/);
  assert.match(source, /function Write-BoundedWorkerLogLine/);
  assert.match(source, /\$maximumLogBytes = 64MB/);
  assert.match(source, /\$retainedArchiveBytes = 8MB/);
  assert.match(source, /Invoke-BoundedWorkerLogRetention -LogRoot \$logRoot -LogPath \$logPath -ArchivePath \$workerLogArchivePath/);
  assert.equal((source.match(/Write-BoundedWorkerLogLine -LogRoot \$logRoot -LogPath \$logPath -ArchivePath \$workerLogArchivePath/g) || []).length, 3);
  assert.doesNotMatch(source, /Out-File -LiteralPath \$logPath -Append/);
  assert.match(source, /status '--porcelain=v1' '--untracked-files=no'/);
  assert.match(source, /ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main'/);
  assert.doesNotMatch(source, /& \$canonicalNode \$workerScript/);
  assert.match(source, /stephanos\.mission-worker-restart-request\.v1/);
  assert.match(source, /mission-orchestrator-worker-restart-claim-\$invocationId\.json/);
  assert.match(source, /mission-orchestrator-worker-restart-receipt-\$invocationId\.json/);
  assert.match(source, /mission-orchestrator-worker-restart-heartbeat-\$invocationId\.json/);
  assert.match(source, /mission-orchestrator-worker-restart-confirm-\$invocationId\.json/);
  assert.match(source, /mission-orchestrator-worker-restart-cancel-\$invocationId\.json/);
  assert.match(source, /New-Object System\.Diagnostics\.ProcessStartInfo/);
  assert.match(source, /\$processStartInfo\.FileName = \$canonicalNode/);
  assert.match(source, /\$processStartInfo\.Arguments = '"' \+ \$workerScript \+ '"'/);
  assert.match(source, /mission-orchestrator-worker-launch-identity-\$LaunchIdentityId\.json/);
  assert.match(source, /stephanos\.mission-worker-launch-identity\.v1/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_LAUNCH_ID/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH/);
  assert.match(source, /-LaunchKind 'guarded-restart'/);
  assert.match(source, /-LaunchKind 'ordinary'/);
  assert.match(source, /\$workerProcess\.StartTime\.ToUniversalTime\(\)/);
  assert.match(source, /\$workerHeartbeat\.pid -eq \$workerProcess\.Id/);
  assert.match(source, /\$heartbeatTimestampUtc -gt \$workerStartedAtUtc/);
  assert.match(source, /if \(\$confirmation -and \$invocationHeartbeatBound\)/);
  assert.match(source, /function Stop-ExactOwnedWorkerProcess[\s\S]*\$Process\.Kill\(\)/);
  assert.match(source, /\$restartDeadlineUtc/);
  assert.doesNotMatch(source, /\$processStartInfo\.Arguments\s*\+=|\$env:[A-Z_]+_COMMAND|Invoke-Expression/);
  assert.doesNotMatch(source, /Get-Command (?:git|node)(?:\.exe)?\b/i);
  assert.doesNotMatch(source, /Start-Process|Invoke-Expression|git reset|git checkout|git clean|git push/i);
});

test('restart invocation binds exact command, heartbeat, deadline and process creation identity', async () => {
  const [probe, restart, launcher] = await Promise.all([
    readFile(probePath, 'utf8'),
    readFile(restartPath, 'utf8'),
    readFile(workerStartPath, 'utf8'),
  ]);
  const canonical = { probe, restart, launcher };
  assert.equal(strictRestartInvocationBoundary(canonical), true);

  const attacks = [
    { ...canonical, probe: probe.replace("$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", '$canonicalNode = $env:NODE') },
    { ...canonical, probe: probe.replace('$arguments.Count -ne 2', '$arguments.Count -lt 2') },
    { ...canonical, probe: probe.replaceAll('CommandLineToArgvW', 'Split-Path') },
    { ...canonical, probe: probe.replace('if ([string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath)) { return $false }', '# executable identity omitted') },
    { ...canonical, probe: probe.replace('$scriptArgument = [System.IO.Path]::GetFullPath([string]$arguments[1])', '$scriptArgument = [string]$arguments[0]') },
    { ...canonical, probe: probe.replace(/\$scriptArgument,\r?\n\s*\$workerPath,/, '$scriptArgument.StartsWith($workerPath),\n        $true,') },
    { ...canonical, probe: probe.replace("$restartReceipt.invocationId -match '^[0-9a-f]{64}$'", '$true') },
    { ...canonical, probe: probe.replace('$restartReceipt.deadlineUtc -eq $canonicalDeadlineUtc', '$true') },
    { ...canonical, restart: restart.replace('$invocationHeartbeat.invocationId -ne $ExpectedInvocationId', '$false') },
    { ...canonical, restart: restart.replace('$timestamp -lt $boundHeartbeatTimestampUtc', '$false') },
    { ...canonical, restart: restart.replace('$timestamp -gt $sharedHeartbeatObservedAtUtc', '$false') },
    { ...canonical, restart: restart.replace('$boundHeartbeatTimestampUtc -gt $invocationHeartbeatObservedAtUtc', '$false') },
    { ...canonical, restart: restart.replace('$processStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks', '$false') },
    { ...canonical, restart: restart.replace('$liveProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks', '$false') },
    { ...canonical, restart: restart.replace('$heartbeatTimestampUtc -gt $observedAtUtc', '$false') },
    { ...canonical, restart: restart.replace('($observedAtUtc - $heartbeatTimestampUtc).TotalSeconds -gt 120', '$false') },
    { ...canonical, restart: restart.replaceAll('[System.Diagnostics.Process]::GetProcessById($processId)', 'Get-Process -Id $processId') },
    { ...canonical, restart: restart.replaceAll('$null = $processCapability.Handle', '$null = $processId') },
    { ...canonical, restart: restart.replaceAll('ProcessCapability = $processCapability', 'ProcessCapability = $processId') },
    { ...canonical, restart: restart.replace('$reverifiedProcessCapability.StartTime.ToUniversalTime()', '$oldWorker.ProcessStartedAtUtc') },
    { ...canonical, restart: restart.replace('$reverifiedProcessCapability.Kill()', 'Stop-Process -Id $oldWorker.ProcessId -Force') },
    { ...canonical, restart: restart.replace('$reverifiedProcessCapability.WaitForExit(10000)', '$true') },
    { ...canonical, restart: restart.replace('$oldWorkerRecheck.LaunchIdentityId -ne $oldWorker.LaunchIdentityId', '$false') },
    { ...canonical, restart: restart.replace('$oldWorkerRecheck.LaunchReceiptDigest -ne $oldWorker.LaunchReceiptDigest', '$false') },
    { ...canonical, restart: restart.replace('$oldWorkerRecheck.HeartbeatTimestampUtc -lt $oldWorker.HeartbeatTimestampUtc', '$false') },
    { ...canonical, restart: restart.replace('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks', '$false') },
    { ...canonical, restart: restart.replaceAll('Assert-BeforeOperationDeadline -RequiredReserveSeconds 1', '# deadline check removed') },
    { ...canonical, restart: restart.replace("$afterTask = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop", '$afterTask = $task') },
    { ...canonical, restart: restart.replace("if ([string]$afterTask.State -ne 'Running')", 'if ($false)') },
    { ...canonical, restart: restart.replace('$successReceiptJson = [PSCustomObject]@{', 'Write-BoundedAtomicJson -Path $confirmationPath -Value $true\n            $successReceiptJson = [PSCustomObject]@{') },
    { ...canonical, restart: restart.replace(/(schemaVersion = 'stephanos\.mission-worker-restart-confirmation\.v1'[\s\S]*?deadlineUtc = \$script:operationDeadlineUtc\.ToString\('yyyy-MM-ddTHH:mm:ss\.fffZ'\)\r?\n\s*\}\))/, "$1\n            Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop") },
    { ...canonical, restart: restart.replaceAll("deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')", "deadlineUtc = $script:operationDeadlineUtc.ToString('o')") },
    { ...canonical, restart: restart.replaceAll("deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')", "deadlineUtc = [datetime]::UtcNow.AddMinutes(5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')") },
    { ...canonical, launcher: launcher.replace('$processStartInfo.FileName = $canonicalNode', '$processStartInfo.FileName = $env:NODE') },
    { ...canonical, launcher: launcher.replace('$processStartInfo.Arguments = \'"\' + $workerScript + \'"\'', '$processStartInfo.Arguments = $env:WORKER_ARGS') },
    { ...canonical, launcher: launcher.replace('$workerHeartbeat.pid -eq $workerProcess.Id', '$workerHeartbeat.pid -gt 0') },
    { ...canonical, launcher: launcher.replace('$heartbeatTimestampUtc -le $heartbeatObservedAtUtc', '$true') },
    { ...canonical, launcher: launcher.replace('$workerProcess.StartTime.ToUniversalTime().Ticks -eq $workerStartedAtUtc.Ticks', '$true') },
    { ...canonical, launcher: launcher.replace('if ($confirmation -and $invocationHeartbeatBound)', 'if ($confirmation)') },
    { ...canonical, launcher: launcher.replace('$workerProcessStarted = $true', '$workerProcessStarted = $false') },
    { ...canonical, launcher: launcher.replace('$ownedWorkerProcess = $workerProcess', '$ownedWorkerProcess = $null') },
    { ...canonical, launcher: launcher.replace('[object]::ReferenceEquals($Process, $OwnedProcess)', '$true') },
    { ...canonical, launcher: launcher.replaceAll('Stop-ExactOwnedWorkerProcess `', '# cleanup omitted') },
    { ...canonical, launcher: launcher.replace('$Process.Kill()', '# kill omitted') },
    { ...canonical, launcher: launcher.replace("[string]$record.deadlineUtc -ne $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')", '$false') },
    { ...canonical, launcher: `${launcher}\n$processStartInfo.Arguments += ' --caller-selected'` },
  ];
  for (const [index, attack] of attacks.entries()) {
    assert.equal(strictRestartInvocationBoundary(attack), false, `attack ${index} must fail closed`);
  }
});