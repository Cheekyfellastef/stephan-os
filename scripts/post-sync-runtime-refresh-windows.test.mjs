import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backendStarterInvocation } from './run-battle-bridge-ignition.mjs';
import { createExactHeadSourceLoader } from '../stephanos-server/backend-exact-head-loader.mjs';
import { fixedBackendExecutable } from '../stephanos-server/services/fixedBackendExecutable.js';
await import('./post-sync-runtime-refresh-windows-canonical-git-hardlink.test.mjs');

const restartSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const workerStartSource = await readFile(new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url), 'utf8');
const backendStartSource = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
const ignitionEntrySource = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const backendBootstrapPath = fileURLToPath(new URL('../stephanos-server/backend-bootstrap.mjs', import.meta.url));
const backendBootstrapSource = await readFile(backendBootstrapPath, 'utf8');
const backendLoaderSource = await readFile(new URL('../stephanos-server/backend-exact-head-loader.mjs', import.meta.url), 'utf8');
const backendServerPath = fileURLToPath(new URL('../stephanos-server/server.js', import.meta.url));
const backendServerSource = await readFile(backendServerPath, 'utf8');
const workspaceUpdateSource = await readFile(new URL('../stephanos-server/services/workspaceUpdateStatusService.js', import.meta.url), 'utf8');
const githubAuthSource = await readFile(new URL('../stephanos-server/services/githubAuthResolver.js', import.meta.url), 'utf8');
const gitRitualSource = await readFile(new URL('../stephanos-server/services/gitRitualStateService.js', import.meta.url), 'utf8');
const programmeAuthoritySource = await readFile(new URL('../stephanos-server/services/programmeAuthorityService.js', import.meta.url), 'utf8');
const localShellSource = await readFile(new URL('../stephanos-server/services/localShellService.js', import.meta.url), 'utf8');

function backendHeadProofForObservedHeads(observedHeads, expectedHead) {
  const proofFunctionsStart = backendServerSource.indexOf('function minimalBackendChildGitEnvironment()');
  const proofFunctionsEnd = backendServerSource.indexOf('const backendExpectedHead =');
  const proofFunctionsSource = backendServerSource.slice(proofFunctionsStart, proofFunctionsEnd);
  const remainingHeads = [...observedHeads];
  const spawnSyncImpl = () => ({
    status: 0,
    stdout: `${remainingHeads.shift() || ''}\n`,
    stderr: '',
  });
  const processForTest = {
    env: { STEPHANOS_BACKEND_SOURCE_HEAD: expectedHead },
    platform: 'linux',
  };
  return Function(
    'spawnSync',
    'canonicalGitDirectory',
    'canonicalRepoRoot',
    'process',
    `'use strict'; ${proofFunctionsSource}; return enforceBattleBridgeBackendChildExpectedHead;`,
  )(spawnSyncImpl, '/repo/.git', '/repo', processForTest);
}

async function simulateBackendImportBoundary(observedHeads, expectedHead) {
  const proveExpectedHead = backendHeadProofForObservedHeads(observedHeads, expectedHead);
  let listenerStarted = false;
  try {
    proveExpectedHead();
    await Promise.resolve();
    proveExpectedHead();
    listenerStarted = true;
    return { listenerStarted, error: null };
  } catch (error) {
    return { listenerStarted, error };
  }
}

function runGit(gitExecutable, root, args) {
  const result = spawnSync(gitExecutable, ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return String(result.stdout || '').trim();
}

const canonicalDeadlineFormat = 'yyyy-MM-ddTHH:mm:ss.fffZ';

function exactCancellationDeadlineTransport(writer, reader) {
  const cancellationRecord = writer.match(/schemaVersion = 'stephanos\.mission-worker-restart-cancel\.v1'[\s\S]*?\n\s*\}\)/)?.[0] || '';
  return cancellationRecord.includes(`deadlineUtc = $script:operationDeadlineUtc.ToString('${canonicalDeadlineFormat}')`)
    && !cancellationRecord.includes("deadlineUtc = $script:operationDeadlineUtc.ToString('o')")
    && reader.includes(`[string]$record.deadlineUtc -ne $restartDeadlineUtc.ToString('${canonicalDeadlineFormat}')`);
}

function canonicalRestartGitBoundary(source) {
  return source.includes("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'")
    && source.includes('Test-Path -LiteralPath $canonicalGit -PathType Leaf')
    && source.includes('Get-Item -LiteralPath $canonicalGit -Force')
    && source.includes('$canonicalGitItem.LinkType')
    && source.includes('[System.IO.FileAttributes]::ReparsePoint')
    && source.includes('CANONICAL_GIT_IDENTITY_INVALID')
    && source.includes('& $canonicalGit -C $repoRoot symbolic-ref --quiet --short HEAD')
    && source.includes('& $canonicalGit -C $repoRoot rev-parse --verify HEAD')
    && !/Get-Command (?:git|git\.exe)\b|\$git\.Source|& \$env:(?:PATH|GIT)/i.test(source);
}

function mandatoryWorkerCleanupBoundary(source) {
  const postProof = source.indexOf("-Phase 'POST_START'");
  const blockerGate = source.indexOf('if ($startupBlocker)', postProof);
  const cleanup = source.indexOf('Stop-NewlyStartedOwnedWorker', blockerGate);
  const terminalBlock = source.indexOf('Stop-WithBlocker $startupBlocker', cleanup);
  return postProof >= 0
    && blockerGate > postProof
    && cleanup > blockerGate
    && terminalBlock > cleanup
    && source.includes("[string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker'")
    && source.includes('[string]$ExpectedInvocationId')
    && source.includes('Get-VerifiedInvocationProcessFromLaunchReceipt')
    && source.includes('Get-VerifiedFreshWorkerInstance')
    && source.includes('mission-orchestrator-worker-restart-heartbeat-$ExpectedInvocationId.json')
    && source.includes('$timestamp -lt $boundHeartbeatTimestampUtc')
    && !source.includes('$boundHeartbeatTimestampUtc.Ticks -ne $timestamp.Ticks')
    && source.includes('$boundHeartbeatTimestampUtc -le $receiptProcessStartedAtUtc')
    && source.includes('$processStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks')
    && source.includes('Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot')
    && source.includes('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks')
    && source.includes('$reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks')
    && source.includes('mission-orchestrator-worker-restart-cancel-$ExpectedInvocationId.json');
}

function verifiedExistingWorkerIdentityBoundary(source) {
  return source.includes("schemaVersion -ne 'stephanos.mission-orchestrator-worker-heartbeat.v1'")
    && source.includes("$launchIdentityId -notmatch '^[0-9a-f]{64}$'")
    && source.includes('mission-orchestrator-worker-launch-identity-$launchIdentityId.json')
    && source.includes("schemaVersion -ne 'stephanos.mission-worker-launch-identity.v1'")
    && source.includes('Test-ExactJsonPropertyEstate -Record $heartbeat')
    && source.includes('Test-ExactJsonPropertyEstate -Record $launchReceipt')
    && source.includes('$heartbeatTimestampUtc -le $heartbeatProcessStartedAtUtc')
    && source.includes('$heartbeatTimestampUtc -gt $observedAtUtc')
    && !source.includes('$heartbeatTimestampUtc -gt $observedAtUtc.AddSeconds(60)')
    && source.includes('($observedAtUtc - $heartbeatTimestampUtc).TotalSeconds -gt 120')
    && source.includes('$receiptProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks')
    && source.includes('$liveProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks')
    && source.includes('$oldWorkerRecheck.LaunchIdentityId -ne $oldWorker.LaunchIdentityId')
    && source.includes('$oldWorkerRecheck.LaunchReceiptDigest -ne $oldWorker.LaunchReceiptDigest')
    && source.includes('$oldWorkerRecheck.HeadSha -ne $oldWorker.HeadSha')
    && source.includes('$oldWorkerRecheck.HeartbeatTimestampUtc -lt $oldWorker.HeartbeatTimestampUtc');
}

function exactExistingWorkerProcessCapabilityBoundary(source) {
  const verifier = source.slice(
    source.indexOf('function Get-VerifiedWorkerProcessFromHeartbeat'),
    source.indexOf('function Get-VerifiedFreshWorkerInstance'),
  );
  const missionWorkerStop = source.slice(
    source.indexOf("$heartbeatPath = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace\\status\\mission-orchestrator-worker-heartbeat.json'"),
    source.indexOf('$preStartSourceProof = Read-CanonicalWorkerSourceProof'),
  );
  return verifier.includes('[System.Diagnostics.Process]::GetProcessById($processId)')
    && verifier.includes('$null = $processCapability.Handle')
    && verifier.includes('$processCapability.StartTime.ToUniversalTime()')
    && verifier.includes('ProcessCapability = $processCapability')
    && missionWorkerStop.includes('$reverifiedProcessCapability = $oldWorkerRecheck.ProcessCapability')
    && missionWorkerStop.includes('$reverifiedProcessCapability.HasExited')
    && missionWorkerStop.includes('$null = $reverifiedProcessCapability.Handle')
    && missionWorkerStop.includes('$reverifiedProcessCapability.StartTime.ToUniversalTime()')
    && missionWorkerStop.includes('$reverifiedProcessCapability.Kill()')
    && missionWorkerStop.includes('$reverifiedProcessCapability.WaitForExit(10000)')
    && !missionWorkerStop.includes('Stop-Process -Id')
    && !missionWorkerStop.includes('Get-Process -Id');
}

function heartbeatTimestampAdmissible({ timestampMs, processStartedMs, observedMs }) {
  return Number.isFinite(timestampMs)
    && Number.isFinite(processStartedMs)
    && Number.isFinite(observedMs)
    && timestampMs > processStartedMs
    && timestampMs <= observedMs
    && observedMs - timestampMs <= 120_000;
}

function freshHeartbeatTimestampAdmissible({ timestampMs, processStartedMs, observedMs }) {
  return Number.isFinite(timestampMs)
    && Number.isFinite(processStartedMs)
    && Number.isFinite(observedMs)
    && timestampMs > processStartedMs
    && timestampMs <= observedMs;
}

function exactFreshWorkerHeartbeatObservationBoundary(restart, launcher) {
  const freshVerifier = restart.slice(
    restart.indexOf('function Get-VerifiedFreshWorkerInstance'),
    restart.indexOf('function Get-VerifiedInvocationProcessFromLaunchReceipt'),
  );
  const guardedLauncher = launcher.slice(
    launcher.indexOf('$invocationHeartbeatBound = $false'),
    launcher.indexOf("throw 'Mission worker restart was not confirmed before its deadline.'"),
  );
  return /\$sharedHeartbeatObservedAtUtc = \[datetime\]::UtcNow\s+\$heartbeat = Get-Content -LiteralPath \$HeartbeatPath -Raw \| ConvertFrom-Json/.test(freshVerifier)
    && freshVerifier.includes('$timestamp -gt $sharedHeartbeatObservedAtUtc')
    && /\$invocationHeartbeatObservedAtUtc = \[datetime\]::UtcNow\s+\$invocationHeartbeat = Get-Content -LiteralPath \$invocationHeartbeatPath -Raw \| ConvertFrom-Json/.test(freshVerifier)
    && freshVerifier.includes('$boundHeartbeatTimestampUtc -gt $invocationHeartbeatObservedAtUtc')
    && /\$heartbeatObservedAtUtc = \[datetime\]::UtcNow\s+\$workerHeartbeat = Get-Content -LiteralPath \$heartbeatPath -Raw \| ConvertFrom-Json/.test(guardedLauncher)
    && guardedLauncher.includes('$heartbeatTimestampUtc -le $heartbeatObservedAtUtc')
    && guardedLauncher.includes('if ($confirmation -and $invocationHeartbeatBound)');
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
  const rethrow = source.indexOf('throw $launchFailure', cleanup);
  return launchFunction >= 0
    && guardedStart > launchFunction
    && startedCapability > guardedStart
    && ownedCapability > startedCapability
    && startTimeRead > ownedCapability
    && receiptWrite > startTimeRead
    && guardedCatch > receiptWrite
    && cleanup > guardedCatch
    && rethrow > cleanup
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
    && /Start-ExactWorkerWithLaunchIdentity[\s\S]*-LaunchKind 'guarded-restart'/.test(source)
    && /Start-ExactWorkerWithLaunchIdentity[\s\S]*-LaunchKind 'ordinary'/.test(source);
}

function finalWorkerProofPrecedesConfirmation(source) {
  const postProof = source.indexOf("-Phase 'POST_START'");
  const finalTaskRead = source.indexOf(
    "$afterTask = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop",
    postProof,
  );
  const exactTaskState = source.indexOf(
    "if ([string]$afterTask.State -ne 'Running')",
    finalTaskRead,
  );
  const preparedReceipt = source.indexOf('$successReceiptJson = [PSCustomObject]@{', exactTaskState);
  const finalDeadline = source.indexOf(
    'Assert-BeforeOperationDeadline -RequiredReserveSeconds 1',
    preparedReceipt,
  );
  const confirmationWrite = source.indexOf(
    'Write-BoundedAtomicJson -Path $confirmationPath',
    postProof,
  );
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

// Canonical source and authority tests below are preserved from the previous blob.
// Only the LinkType mutation uses replaceAll so the hostile fixture actually removes the complete repaired guard.

const canonicalSourceTests = [
  ['restart helper accepts only backend and mission-worker', () => {
    assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
    assert.match(restartSource, /Stephanos Battle Bridge Backend/);
    assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
    assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
  }],
];
for (const [name, fn] of canonicalSourceTests) test(name, fn);

test('restart helper pins every authority-bearing Git read to the canonical executable', () => {
  assert.equal(canonicalRestartGitBoundary(restartSource), true);
  assert.match(restartSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(restartSource, /Get-Item -LiteralPath \$canonicalGit -Force/);
  assert.match(restartSource, /CANONICAL_GIT_IDENTITY_INVALID/);
  assert.match(restartSource, /CANONICAL_GIT_MISSING/);
  assert.match(restartSource, /CANONICAL_GIT_PATH_MISMATCH/);
  assert.match(restartSource, /& \$canonicalGit -C \$repoRoot symbolic-ref --quiet --short HEAD/);
  assert.match(restartSource, /& \$canonicalGit -C \$repoRoot rev-parse --verify HEAD/);
  assert.match(restartSource, /-GitExecutable \$canonicalGit/);
  assert.doesNotMatch(restartSource, /Get-Command (?:git|git\.exe)\b|\$git\.Source|\bbranch --show-current\b/i);
});

test('PATH, missing-canonical-Git and substituted-executable mutations fail the source guard', () => {
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replace(
      "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'",
      '$canonicalGit = $env:PATH',
    ),
  ), false);
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replace('Test-Path -LiteralPath $canonicalGit -PathType Leaf', '$true'),
  ), false);
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replace('Get-Item -LiteralPath $canonicalGit -Force', 'Get-Item -LiteralPath $env:GIT -Force'),
  ), false);
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replaceAll('$canonicalGitItem.LinkType', '$false'),
  ), false);
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replace(
      '& $canonicalGit -C $repoRoot symbolic-ref --quiet --short HEAD',
      '& $env:GIT -C $repoRoot symbolic-ref --quiet --short HEAD',
    ),
  ), false);
  assert.equal(canonicalRestartGitBoundary(`${restartSource}\n$git = Get-Command git.exe`), false);
});

// Retain critical structural assertions for the rest of the bounded restart authority chain.
test('worker restart retains exact-head cleanup, immutable invocation and bounded deadline controls', () => {
  assert.equal(mandatoryWorkerCleanupBoundary(restartSource), true);
  assert.equal(verifiedExistingWorkerIdentityBoundary(restartSource), true);
  assert.equal(exactExistingWorkerProcessCapabilityBoundary(restartSource), true);
  assert.equal(exactFreshWorkerHeartbeatObservationBoundary(restartSource, workerStartSource), true);
  assert.equal(exactOwnedLauncherCleanupBoundary(workerStartSource), true);
  assert.equal(finalWorkerProofPrecedesConfirmation(restartSource), true);
  assert.equal(exactCancellationDeadlineTransport(restartSource, workerStartSource), true);
});

test('backend entry still binds exact parent-proven head', () => {
  const provenHead = 'a'.repeat(40);
  const invocation = backendStarterInvocation(provenHead);
  const expectedHeadIndex = invocation.args.indexOf('-ExpectedHead');
  assert.notEqual(expectedHeadIndex, -1);
  assert.equal(invocation.args[expectedHeadIndex + 1], provenHead);
});

test('backend fixed executables remain canonical', () => {
  assert.equal(fixedBackendExecutable('git', 'win32'), 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.equal(fixedBackendExecutable('githubCli', 'win32'), 'C:\\Program Files\\GitHub CLI\\gh.exe');
  assert.equal(fixedBackendExecutable('powershell', 'win32'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});
