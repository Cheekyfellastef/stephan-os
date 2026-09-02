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

test('restart helper accepts only backend and mission-worker', () => {
  assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
  assert.match(restartSource, /Stephanos Battle Bridge Backend/);
  assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
  assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
});

test('restart helper validates canonical task action and overlap policy before mutation', () => {
  assert.match(restartSource, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(restartSource, /APPROVED_TASK_EXECUTABLE_MISMATCH/);
  assert.match(restartSource, /APPROVED_TASK_ARGUMENTS_MISMATCH/);
  assert.match(restartSource, /\$Target -eq 'backend' -and \[string\]\$task\.Settings\.MultipleInstances -ne 'IgnoreNew'/);
  assert.match(restartSource, /APPROVED_BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH/);
  assert.ok(restartSource.includes("TaskPath '\\'"));
});

test('backend entry preflight carries the parent-proven exact head into its PowerShell child', () => {
  const provenHead = 'a'.repeat(40);
  const laterHead = 'b'.repeat(40);
  const invocation = backendStarterInvocation(provenHead);
  const expectedHeadIndex = invocation.args.indexOf('-ExpectedHead');
  assert.notEqual(expectedHeadIndex, -1);
  assert.equal(invocation.args[expectedHeadIndex + 1], provenHead);
  assert.equal(invocation.args.includes(laterHead), false);
  assert.match(ignitionEntrySource, /const currentHead = entryHeadProof\.currentHead;[\s\S]*const starter = backendStarterInvocation\(currentHead\)/);
});

test('backend Node child rejects checkout drift before loading or listening', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const headProof = spawnSync(gitExecutable, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  assert.equal(headProof.status, 0, headProof.stderr || headProof.error?.message);
  const actualHead = String(headProof.stdout || '').trim().toLowerCase();
  assert.match(actualHead, /^[0-9a-f]{40}$/);
  const driftedExpectedHead = actualHead === 'a'.repeat(40) ? 'b'.repeat(40) : 'a'.repeat(40);
  const child = spawnSync(process.execPath, [backendBootstrapPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      STEPHANOS_BACKEND_SOURCE_HEAD: driftedExpectedHead,
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  assert.notEqual(child.status, 0, 'drifted backend child must fail closed');
  assert.match(String(child.stderr || ''), /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
  assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
});

test('backend Node child re-proves exact head after module loading immediately before listening', () => {
  const proofCall = 'enforceBattleBridgeBackendChildExpectedHead();';
  const proofOffsets = [...backendServerSource.matchAll(/enforceBattleBridgeBackendChildExpectedHead\(\);/g)]
    .map((match) => match.index);
  const lastBackendImportOffset = backendServerSource.lastIndexOf('await import(');
  const listenerOffset = backendServerSource.indexOf('server.listen(');

  assert.equal(proofOffsets.length, 2, 'backend entry must prove the fixed expected head exactly twice');
  assert.ok(proofOffsets[0] < lastBackendImportOffset, 'the first proof must happen before backend module loading');
  assert.ok(lastBackendImportOffset < proofOffsets[1], 'checkout drift during module loading must reach a second proof');
  assert.equal(
    backendServerSource.slice(proofOffsets[1], listenerOffset).trim(),
    proofCall,
    'the second proof must be the only operation before listener/health publication',
  );
  assert.ok(proofOffsets[1] < listenerOffset, 'failed re-proof must prevent server.listen');
});

test('backend immutable bootstrap registers the exact-head loader before importing the server entry', () => {
  const firstProofOffset = backendBootstrapSource.indexOf('\n  proveExpectedHead();');
  const loaderRegistrationOffset = backendBootstrapSource.indexOf('\n  register(');
  const serverEntryImportOffset = backendBootstrapSource.lastIndexOf('\nawait import(');
  const firstBackendImportOffset = backendServerSource.indexOf("await import('dotenv/config')");

  assert.ok(firstProofOffset >= 0);
  assert.ok(firstProofOffset < loaderRegistrationOffset);
  assert.ok(loaderRegistrationOffset < serverEntryImportOffset);
  assert.ok(backendServerSource.indexOf('BACKEND_CHILD_IMMUTABLE_BOOTSTRAP_REQUIRED') < firstBackendImportOffset);
  assert.match(
    backendBootstrapSource,
    /readExactHeadBlob\('stephanos-server\/backend-exact-head-loader\.mjs'/,
    'the loader implementation must come from the approved Git object',
  );
  assert.match(backendBootstrapSource, /readExactHeadBlob\('stephanos-server\/backend-bootstrap\.mjs'/);
  assert.match(backendBootstrapSource, /GIT_NO_REPLACE_OBJECTS: '1'/);
  assert.match(backendLoaderSource, /GIT_NO_REPLACE_OBJECTS: '1'/);
});

test('bound backend server entry cannot be launched without the immutable bootstrap', () => {
  const child = spawnSync(process.execPath, [backendServerPath], {
    cwd: repoRoot,
    env: { ...process.env, STEPHANOS_BACKEND_SOURCE_HEAD: 'a'.repeat(40) },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  assert.notEqual(child.status, 0);
  assert.match(String(child.stderr || ''), /BACKEND_CHILD_IMMUTABLE_BOOTSTRAP_REQUIRED/);
  assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
});

test('immutable module loading admits A during an A to B to A checkout transition', async () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-loader-'));
  const modulePath = join(fixtureRoot, 'module.js');
  try {
    runGit(gitExecutable, fixtureRoot, ['init', '--quiet']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.name', 'Stephanos Test']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.email', 'stephanos-test@example.invalid']);

    writeFileSync(modulePath, "export const sourceIdentity = 'A';\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'module.js']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'source A']);
    const approvedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();

    writeFileSync(modulePath, "export const sourceIdentity = 'B';\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'module.js']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'source B']);
    const driftedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();
    assert.notEqual(driftedHead, approvedHead);

    const loadExactHeadSource = createExactHeadSourceLoader({
      canonicalGitDirectory: join(fixtureRoot, '.git'),
      canonicalRepoRoot: fixtureRoot,
      expectedHead: approvedHead,
      gitEnvironment: process.env,
      gitExecutable,
    });
    const moduleUrl = pathToFileURL(modulePath).href;
    const duringDrift = await loadExactHeadSource(moduleUrl, { format: 'commonjs' }, () => {
      throw new Error('repository module must not fall through to the mutable checkout');
    });
    assert.equal(duringDrift.format, 'module', 'mutable checkout package metadata must not change source format');
    assert.match(duringDrift.source, /sourceIdentity = 'A'/);
    assert.doesNotMatch(duringDrift.source, /sourceIdentity = 'B'/);

    runGit(gitExecutable, fixtureRoot, ['checkout', '--quiet', '--detach', approvedHead]);
    const afterReturn = await loadExactHeadSource(moduleUrl, { format: 'module' }, () => {
      throw new Error('repository module must not fall through to the mutable checkout');
    });
    assert.match(afterReturn.source, /sourceIdentity = 'A'/);
    assert.equal(runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase(), approvedHead);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('process-bound production bootstrap rejects package, runtime bootstrap, server, and replace-ref drift from A to B', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-production-bootstrap-'));
  const fixtureServerRoot = join(fixtureRoot, 'stephanos-server');
  const fixtureBootstrap = join(fixtureServerRoot, 'backend-bootstrap.mjs');
  const fixtureServer = join(fixtureServerRoot, 'server.js');
  const fixturePackage = join(fixtureRoot, 'package.json');
  const alternateEntry = join(fixtureRoot, 'alternate-b.mjs');
  const runtimeBootstrap = join(fixtureRoot, 'runtime', 'backend-bootstrap-exact-a.mjs');
  const hostileBootstrapSentinel = join(fixtureRoot, 'runtime', 'bootstrap-b-executed.txt');
  try {
    mkdirSync(fixtureServerRoot, { recursive: true });
    runGit(gitExecutable, fixtureRoot, ['init', '--quiet']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.name', 'Stephanos Test']);
    runGit(gitExecutable, fixtureRoot, ['config', 'user.email', 'stephanos-test@example.invalid']);
    writeFileSync(fixturePackage, '{"scripts":{"stephanos:backend":"node stephanos-server/backend-bootstrap.mjs"}}\n', 'utf8');
    writeFileSync(fixtureBootstrap, backendBootstrapSource, 'utf8');
    writeFileSync(join(fixtureServerRoot, 'backend-exact-head-loader.mjs'), backendLoaderSource, 'utf8');
    writeFileSync(fixtureServer, "console.log('PRODUCTION_ENTRY_A');\n", 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'package.json', 'stephanos-server']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'production entry A']);
    const approvedHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();

    const packageB = '{"scripts":{"stephanos:backend":"node alternate-b.mjs"}}\n';
    const bootstrapB = [
      "import { writeFileSync as hostileWriteFileSync } from 'node:fs';",
      "hostileWriteFileSync(process.env.STEPHANOS_TEST_BOOTSTRAP_SENTINEL, 'BOOTSTRAP_B_EXECUTED');",
      "hostileWriteFileSync(process.env.STEPHANOS_TEST_RUNTIME_BOOTSTRAP, Buffer.from(process.env.STEPHANOS_TEST_APPROVED_BOOTSTRAP_BASE64, 'base64'));",
      "console.log('BOOTSTRAP_B_EXECUTED');",
      backendBootstrapSource,
    ].join('\n');
    const serverB = "console.log('PRODUCTION_ENTRY_B');\n";
    const alternateB = "console.log('ALTERNATE_PACKAGE_ENTRY_B');\n";
    writeFileSync(fixturePackage, packageB, 'utf8');
    writeFileSync(fixtureBootstrap, bootstrapB, 'utf8');
    writeFileSync(fixtureServer, serverB, 'utf8');
    writeFileSync(alternateEntry, alternateB, 'utf8');
    runGit(gitExecutable, fixtureRoot, ['add', '--', 'package.json', 'alternate-b.mjs', 'stephanos-server']);
    runGit(gitExecutable, fixtureRoot, ['commit', '--quiet', '-m', 'production entry B']);
    const replacementHead = runGit(gitExecutable, fixtureRoot, ['rev-parse', 'HEAD']).toLowerCase();
    assert.notEqual(replacementHead, approvedHead);

    runGit(gitExecutable, fixtureRoot, ['checkout', '--quiet', '--detach', approvedHead]);
    writeFileSync(fixturePackage, packageB, 'utf8');
    writeFileSync(fixtureBootstrap, bootstrapB, 'utf8');
    writeFileSync(fixtureServer, serverB, 'utf8');
    writeFileSync(alternateEntry, alternateB, 'utf8');
    runGit(gitExecutable, fixtureRoot, ['replace', approvedHead, replacementHead]);
    assert.match(readFileSync(fixturePackage, 'utf8'), /alternate-b\.mjs/);
    assert.match(readFileSync(fixtureBootstrap, 'utf8'), /BOOTSTRAP_B_EXECUTED/);

    const exactBootstrap = spawnSync(gitExecutable, ['-C', fixtureRoot, 'show', `${approvedHead}:stephanos-server/backend-bootstrap.mjs`], {
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 5_000,
    });
    assert.equal(exactBootstrap.status, 0, exactBootstrap.stderr || exactBootstrap.error?.message);
    mkdirSync(join(fixtureRoot, 'runtime'), { recursive: true });
    writeFileSync(runtimeBootstrap, bootstrapB, 'utf8');
    const bootstrapBase64 = Buffer.from(exactBootstrap.stdout, 'utf8').toString('base64');
    const bootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)";

    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', bootstrapEval], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: '0',
        STEPHANOS_BACKEND_BOOTSTRAP_BASE64: bootstrapBase64,
        STEPHANOS_BACKEND_REPO_ROOT: fixtureRoot,
        STEPHANOS_BACKEND_SOURCE_HEAD: approvedHead,
        STEPHANOS_TEST_APPROVED_BOOTSTRAP_BASE64: bootstrapBase64,
        STEPHANOS_TEST_BOOTSTRAP_SENTINEL: hostileBootstrapSentinel,
        STEPHANOS_TEST_RUNTIME_BOOTSTRAP: runtimeBootstrap,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.match(String(child.stdout || ''), /PRODUCTION_ENTRY_A/);
    assert.match(readFileSync(runtimeBootstrap, 'utf8'), /BOOTSTRAP_B_EXECUTED/);
    assert.equal(existsSync(hostileBootstrapSentinel), false);
    assert.doesNotMatch(String(child.stdout || ''), /PRODUCTION_ENTRY_B/);
    assert.doesNotMatch(String(child.stdout || ''), /BOOTSTRAP_B_EXECUTED|ALTERNATE_PACKAGE_ENTRY_B/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Windows backend process creation excludes hostile inherited executable and Node injection state', { skip: process.platform !== 'win32' }, () => {
  const functionStart = backendStartSource.indexOf('function Start-BackendNodeWithMinimalEnvironment');
  const functionEnd = backendStartSource.indexOf('\nWrite-Log "Stephanos Battle Bridge backend start requested', functionStart);
  assert.notEqual(functionStart, -1);
  assert.notEqual(functionEnd, -1);
  const launcherFunction = backendStartSource.slice(functionStart, functionEnd);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-minimal-node-env-'));
  const sentinelPath = join(fixtureRoot, 'hostile-node-options-executed.txt');
  const fixedGitProofPath = join(fixtureRoot, 'fixed-git-proof.txt');
  const hostilePreloadPath = join(fixtureRoot, 'hostile-preload.cjs');
  const hostileGitPath = join(fixtureRoot, 'git.exe');
  const stdoutPath = join(fixtureRoot, 'stdout.log');
  const stderrPath = join(fixtureRoot, 'stderr.log');
  const harnessPath = join(fixtureRoot, 'minimal-environment-harness.ps1');
  try {
    writeFileSync(hostilePreloadPath, `require('node:fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'HOSTILE_NODE_OPTIONS_EXECUTED');\n`, 'utf8');
    copyFileSync(process.execPath, hostileGitPath);
    const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const childCode = `const{execFileSync}=require('node:child_process');require('node:fs').writeFileSync(${JSON.stringify(fixedGitProofPath)},execFileSync(${JSON.stringify(fixedBackendExecutable('git', 'win32'))},['--version'],{encoding:'utf8'}));`;
    const childEval = `eval(Buffer.from('${Buffer.from(childCode, 'utf8').toString('base64')}','base64').toString())`;
    const harness = [
      `$canonicalNode = ${quoted(process.execPath)}`,
      launcherFunction,
      `$process = Start-BackendNodeWithMinimalEnvironment -Arguments @('--eval', ${quoted(childEval)}) -WorkingDirectory ${quoted(fixtureRoot)} -StandardOutputPath ${quoted(stdoutPath)} -StandardErrorPath ${quoted(stderrPath)} -SourceHead ${'a'.repeat(40)} -RepositoryRoot ${quoted(fixtureRoot)} -BootstrapBase64 'YQ=='`,
      '$process.WaitForExit()',
      'exit $process.ExitCode',
    ].join('\r\n');
    writeFileSync(harnessPath, harness, 'utf8');
    const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath], {
      env: {
        ...process.env,
        PATH: fixtureRoot,
        ComSpec: join(fixtureRoot, 'hostile-cmd.exe'),
        NODE_OPTIONS: `--require=${hostilePreloadPath}`,
        NODE_PATH: fixtureRoot,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stderr || ''}\n${readFileSync(stderrPath, 'utf8')}`);
    assert.equal(existsSync(sentinelPath), false);
    assert.match(readFileSync(fixedGitProofPath, 'utf8'), /git version/i);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('backend services pin Windows child executables instead of searching the repository current directory', () => {
  assert.equal(fixedBackendExecutable('git', 'win32'), 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.equal(fixedBackendExecutable('githubCli', 'win32'), 'C:\\Program Files\\GitHub CLI\\gh.exe');
  assert.equal(fixedBackendExecutable('powershell', 'win32'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.match(workspaceUpdateSource, /execFileAsync\(fixedBackendExecutable\('git'\)/);
  assert.match(githubAuthSource, /execImpl\(fixedBackendExecutable\('githubCli'\)/);
  assert.match(gitRitualSource, /spawnSyncImpl\(fixedBackendExecutable\('git'\)/);
  assert.match(programmeAuthoritySource, /execFileImpl\(fixedBackendExecutable\('git'\)/);
  assert.match(localShellSource, /fixedBackendExecutable\('powershell'/);
  for (const source of [workspaceUpdateSource, githubAuthSource, gitRitualSource, programmeAuthoritySource, localShellSource]) {
    assert.doesNotMatch(source, /(?:execFileAsync|execImpl|spawnSyncImpl|execFileImpl)\(['"](?:git|gh|powershell\.exe)['"]/);
  }
});

test('checkout drift A to B during backend module loading prevents listener publication', async () => {
  const approvedHead = 'a'.repeat(40);
  const driftedHead = 'b'.repeat(40);
  const result = await simulateBackendImportBoundary([approvedHead, driftedHead], approvedHead);

  assert.equal(result.listenerStarted, false);
  assert.match(result.error?.message || '', /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
});

test('unchanged exact head A across backend module loading proceeds to listener publication', async () => {
  const approvedHead = 'a'.repeat(40);
  const result = await simulateBackendImportBoundary([approvedHead, approvedHead], approvedHead);

  assert.equal(result.error, null);
  assert.equal(result.listenerStarted, true);
});

test('backend Node child ignores hostile inherited Git repository-selection variables', () => {
  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const hostileRoot = mkdtempSync(join(tmpdir(), 'stephanos-backend-hostile-git-'));
  try {
    const init = spawnSync(gitExecutable, ['init', '--quiet', hostileRoot], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(init.status, 0, init.stderr || init.error?.message);

    const commit = spawnSync(gitExecutable, [
      '-C', hostileRoot,
      '-c', 'user.name=Stephanos Test',
      '-c', 'user.email=stephanos-test@example.invalid',
      'commit', '--allow-empty', '--quiet', '-m', 'hostile Git redirect',
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(commit.status, 0, commit.stderr || commit.error?.message);

    const hostileHeadProof = spawnSync(gitExecutable, ['-C', hostileRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(hostileHeadProof.status, 0, hostileHeadProof.stderr || hostileHeadProof.error?.message);
    const hostileHead = String(hostileHeadProof.stdout || '').trim().toLowerCase();
    assert.match(hostileHead, /^[0-9a-f]{40}$/);

    const canonicalHeadProof = spawnSync(gitExecutable, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    assert.equal(canonicalHeadProof.status, 0, canonicalHeadProof.stderr || canonicalHeadProof.error?.message);
    const canonicalHead = String(canonicalHeadProof.stdout || '').trim().toLowerCase();
    assert.match(canonicalHead, /^[0-9a-f]{40}$/);
    assert.notEqual(hostileHead, canonicalHead);

    const child = spawnSync(process.execPath, [backendBootstrapPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STEPHANOS_BACKEND_SOURCE_HEAD: hostileHead,
        GIT_DIR: join(hostileRoot, '.git'),
        GIT_WORK_TREE: hostileRoot,
        GIT_COMMON_DIR: join(hostileRoot, '.git'),
        GIT_OBJECT_DIRECTORY: join(hostileRoot, '.git', 'objects'),
        GIT_INDEX_FILE: join(hostileRoot, '.git', 'index'),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.notEqual(child.status, 0, 'hostile Git environment must not redirect the backend proof');
    assert.match(String(child.stderr || ''), /BACKEND_CHILD_EXPECTED_HEAD_MISMATCH/);
    assert.doesNotMatch(`${child.stdout || ''}\n${child.stderr || ''}`, /\[BACKEND LIVE\] Stephanos server listening/);
  } finally {
    rmSync(hostileRoot, { recursive: true, force: true });
  }
});

test('backend PowerShell starter binds every Git proof to the canonical repository despite hostile inherited selectors', { skip: process.platform !== 'win32' }, () => {
  const gitExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe';
  const powershellExecutable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'stephanos-backend-powershell-git-'));
  const canonicalRoot = join(fixtureRoot, 'canonical');
  const hostileRoot = join(fixtureRoot, 'hostile');
  const proofScript = join(fixtureRoot, 'prove-canonical-git.ps1');
  try {
    for (const root of [canonicalRoot, hostileRoot]) {
      runGit(gitExecutable, fixtureRoot, ['init', '--quiet', root]);
      runGit(gitExecutable, root, ['config', 'user.name', 'Stephanos Test']);
      runGit(gitExecutable, root, ['config', 'user.email', 'stephanos-test@example.invalid']);
      runGit(gitExecutable, root, ['commit', '--allow-empty', '--quiet', '-m', root === canonicalRoot ? 'canonical' : 'hostile']);
    }
    const canonicalHead = runGit(gitExecutable, canonicalRoot, ['rev-parse', 'HEAD']).toLowerCase();
    const hostileHead = runGit(gitExecutable, hostileRoot, ['rev-parse', 'HEAD']).toLowerCase();
    assert.notEqual(canonicalHead, hostileHead);

    const boundaryStart = backendStartSource.indexOf('$canonicalGitDirectory =');
    const boundaryEnd = backendStartSource.indexOf('function Assert-ExpectedHeadImmediatelyBeforeMutation', boundaryStart);
    assert.notEqual(boundaryStart, -1);
    assert.ok(boundaryEnd > boundaryStart);
    const boundarySource = backendStartSource.slice(boundaryStart, boundaryEnd);
    const psLiteral = (value) => String(value).replaceAll("'", "''");
    writeFileSync(proofScript, [
      "$ErrorActionPreference = 'Stop'",
      `$canonicalGit = '${psLiteral(gitExecutable)}'`,
      `$repoRoot = '${psLiteral(canonicalRoot)}'`,
      boundarySource,
      '$headOutput = @(& $canonicalGit @canonicalGitArguments rev-parse HEAD 2>$null)',
      'if ($LASTEXITCODE -ne 0) { throw "CANONICAL_GIT_PROOF_FAILED" }',
      '$headOutput | Select-Object -First 1',
    ].join('\r\n'), 'utf8');

    const proof = spawnSync(powershellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', proofScript,
    ], {
      env: {
        ...process.env,
        GIT_DIR: join(hostileRoot, '.git'),
        GIT_WORK_TREE: hostileRoot,
        GIT_COMMON_DIR: join(hostileRoot, '.git'),
        GIT_OBJECT_DIRECTORY: join(hostileRoot, '.git', 'objects'),
        GIT_INDEX_FILE: join(hostileRoot, '.git', 'index'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.repositoryformatversion',
        GIT_CONFIG_VALUE_0: '0',
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(proof.status, 0, proof.stderr || proof.error?.message);
    assert.equal(String(proof.stdout || '').trim().toLowerCase(), canonicalHead);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('backend restart terminates only the verified 8787 Stephanos Node listener', () => {
  assert.match(restartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(restartSource, /--input-type=module --eval/);
  assert.match(restartSource, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(restartSource, /BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED/);
  assert.match(restartSource, /Stop-Process -Id \$listener\.ProcessId -Force/);
  assert.match(restartSource, /stephanos-backend-runtime\.json/);
  assert.match(restartSource, /BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT/);
  assert.match(restartSource, /stephanos\.backend-expected-head-handoff\.v1/);
  assert.match(restartSource, /BACKEND_LISTENER_DID_NOT_STOP[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /Disable-ScheduledTask[\s\S]*\$task\.State -in @\('Running', 'Queued'\)[\s\S]*\$prePublishTask = Get-ScheduledTask[\s\S]*\$prePublishTask\.State -ne 'Disabled'[\s\S]*\$prePublishTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_HANDOFF[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Enable-ScheduledTask[\s\S]*\$preStartTask = Get-ScheduledTask[\s\S]*\$preStartTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /backend-expected-head-handoff\.json/);
  assert.match(restartSource, /expiresAtUtc = \$issuedAtUtc\.AddMinutes\(2\)/);
  assert.match(restartSource, /catch \{[\s\S]*Remove-Item -LiteralPath \$backendExpectedHeadHandoffPath/);
  assert.match(restartSource, /BACKEND_TASK_DID_NOT_STOP/);
  assert.doesNotMatch(restartSource, /Stop-Process\s+-Name|taskkill|killall/);
});

test('worker restart requires task-owned process stop and a fresh exact-head heartbeat', () => {
  assert.match(restartSource, /mission-orchestrator-worker-heartbeat\.json/);
  assert.match(restartSource, /headSha -ne \$ExpectedSourceHead/);
  assert.match(restartSource, /MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/);
  assert.match(restartSource, /MISSION_WORKER_TASK_DID_NOT_STOP/);
  assert.match(restartSource, /MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP/);
  assert.match(restartSource, /\$reverifiedProcessCapability\.Kill\(\)/);
  assert.doesNotMatch(restartSource, /Stop-Process -Id \$oldWorker(?:Recheck)?\.ProcessId/);
  assert.doesNotMatch(restartSource, /MISSION_WORKER_TASK_OR_PROCESS_DID_NOT_STOP|MISSION_WORKER_PROCESS_OUTSIDE_RUNNING_TASK/);
  assert.match(restartSource, /unrelatedTasksChanged = \$false/);
  assert.match(restartSource, /CANONICAL_TRACKED_SOURCE_DIRTY/);
  assert.match(restartSource, /CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START/);
  assert.match(restartSource, /Stop-NewlyStartedOwnedWorker/);
  assert.match(restartSource, /mission-orchestrator-worker-restart-cancel-\$ExpectedInvocationId\.json/);
  assert.match(restartSource, /Wait-UntilOperationDeadline/);
});

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
    restartSource.replace('$canonicalGitItem.LinkType', '$false'),
  ), false);
  assert.equal(canonicalRestartGitBoundary(
    restartSource.replace(
      '& $canonicalGit -C $repoRoot symbolic-ref --quiet --short HEAD',
      '& $env:GIT -C $repoRoot symbolic-ref --quiet --short HEAD',
    ),
  ), false);
  assert.equal(canonicalRestartGitBoundary(`${restartSource}\n$git = Get-Command git.exe`), false);
});

test('worker post-start source proof has one mandatory bounded cleanup path', () => {
  assert.equal(mandatoryWorkerCleanupBoundary(restartSource), true);
  assert.match(restartSource, /Read-CanonicalWorkerSourceProof[\s\S]*-Phase 'PRE_START'/);
  assert.match(restartSource, /Read-CanonicalWorkerSourceProof[\s\S]*-Phase 'POST_START'/);
  for (const blocker of [
    'CANONICAL_BRANCH_CHANGED_DURING_WORKER_START',
    'CANONICAL_HEAD_CHANGED_DURING_WORKER_START',
    'CANONICAL_PUBLIC_MAIN_CHANGED_DURING_WORKER_START',
    'CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START',
    'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
    'MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN',
  ]) {
    assert.ok(restartSource.includes(blocker), blocker);
  }
  assert.match(
    restartSource,
    /if \(\$startupBlocker\) \{[\s\S]*Stop-NewlyStartedOwnedWorker[\s\S]*Stop-WithBlocker \$startupBlocker/,
  );
  assert.match(restartSource, /MISSION_WORKER_POST_START_CLEANUP_FAILED/);
  assert.match(restartSource, /Stop-WithBlocker \$cleanupBlocker/);
  assert.match(restartSource, /\[string\]\$DeadlineUtc/);
  assert.match(restartSource, /Assert-BeforeOperationDeadline/);
  assert.match(restartSource, /Wait-UntilOperationDeadline/);
  assert.match(restartSource, /mission-orchestrator-worker-restart-confirm-/);
  assert.match(restartSource, /mission-orchestrator-worker-restart-cancel-/);
});

test('every final mission-worker proof succeeds before atomic confirmation publication', () => {
  assert.equal(finalWorkerProofPrecedesConfirmation(restartSource), true);
  assert.match(
    restartSource,
    /\$afterTask = Get-ScheduledTask -TaskName \$plan\.TaskName -TaskPath '\\' -ErrorAction Stop[\s\S]*MISSION_WORKER_TASK_NOT_RUNNING_AFTER_START[\s\S]*\$successReceiptJson = \[PSCustomObject\]@\{[\s\S]*Assert-BeforeOperationDeadline -RequiredReserveSeconds 1[\s\S]*Write-BoundedAtomicJson -Path \$confirmationPath/,
  );
  assert.match(
    restartSource,
    /Write-BoundedAtomicJson -Path \$confirmationPath[\s\S]*catch \{[\s\S]*if \(\$startupBlocker\) \{[\s\S]*Stop-NewlyStartedOwnedWorker[\s\S]*Write-Output \$successReceiptJson/,
  );
});

test('deadline expiry, final task failure and post-confirmation widening cannot bypass cleanup', () => {
  const attacks = [
    restartSource.replaceAll(
      'Assert-BeforeOperationDeadline -RequiredReserveSeconds 1',
      '# final deadline proof removed',
    ),
    restartSource.replace(
      "$afterTask = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop",
      '$afterTask = $task',
    ),
    restartSource.replace(
      "if ([string]$afterTask.State -ne 'Running')",
      'if ($false)',
    ),
    restartSource.replace(
      '$successReceiptJson = [PSCustomObject]@{',
      'Write-BoundedAtomicJson -Path $confirmationPath -Value $true\n            $successReceiptJson = [PSCustomObject]@{',
    ),
    restartSource.replace(
      /(schemaVersion = 'stephanos\.mission-worker-restart-confirmation\.v1'[\s\S]*?deadlineUtc = \$script:operationDeadlineUtc\.ToString\('yyyy-MM-ddTHH:mm:ss\.fffZ'\)\r?\n\s*\}\))/,
      "$1\n            Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction Stop",
    ),
    restartSource.replace('Stop-NewlyStartedOwnedWorker `', '# cleanup removed'),
  ];
  for (const [index, attack] of attacks.entries()) {
    assert.equal(finalWorkerProofPrecedesConfirmation(attack), false, `attack ${index} must fail closed`);
  }
});

test('removing or widening any owned-cleanup identity edge fails the source guard', () => {
  for (const [index, mutation] of [
    restartSource.replaceAll('Stop-NewlyStartedOwnedWorker `', '# cleanup removed'),
    restartSource.replace("[string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker'", '$false'),
    restartSource.replaceAll('[string]$ExpectedInvocationId', '[string]$CallerSelectedInvocationId'),
    restartSource.replaceAll('Get-VerifiedInvocationProcessFromLaunchReceipt', 'Get-Process'),
    restartSource.replaceAll('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks', '$false'),
    restartSource.replaceAll('$reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks', '$false'),
  ].entries()) {
    assert.equal(mandatoryWorkerCleanupBoundary(mutation), false, `heartbeat mutation ${index} must fail closed`);
  }
});

test('worker cleanup can target only the exact fresh owned process and fixed task', () => {
  assert.match(restartSource, /\[string\]\$Plan\.TaskName -ne 'Stephanos Mission Orchestrator Worker'/);
  assert.match(restartSource, /MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED/);
  assert.match(restartSource, /\$ExpectedInvocationId -notmatch '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(restartSource, /Get-VerifiedInvocationProcessFromLaunchReceipt/);
  assert.match(restartSource, /mission-orchestrator-worker-restart-heartbeat-\$ExpectedInvocationId\.json/);
  assert.match(restartSource, /\$invocationHeartbeat\.invocationId -ne \$ExpectedInvocationId/);
  assert.match(restartSource, /\$timestamp -lt \$boundHeartbeatTimestampUtc/);
  assert.doesNotMatch(restartSource, /\$boundHeartbeatTimestampUtc\.Ticks -ne \$timestamp\.Ticks/);
  assert.match(restartSource, /\[string\]\$heartbeat\.repositoryRoot -ne \$ExpectedRepoRoot/);
  assert.match(restartSource, /\[string\]\$heartbeat\.headSha -ne \$ExpectedSourceHead/);
  assert.match(restartSource, /\$verifiedInvocationProcess\.ProcessId -ne \$ExpectedProcessId/);
  assert.match(restartSource, /\$verifiedInvocationProcess\.ProcessStartedAtUtc\.Ticks -ne \$ExpectedProcessStartedAtUtc\.ToUniversalTime\(\)\.Ticks/);
  assert.match(restartSource, /Test-ExactCanonicalWorkerProcess/);
  assert.match(restartSource, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN/);
  assert.match(restartSource, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED/);
  assert.match(restartSource, /schemaVersion = 'stephanos\.mission-worker-restart-cancel\.v1'/);
  assert.match(restartSource, /workerPid = \$ExpectedProcessId/);
  assert.match(restartSource, /workerStartedAtUtc = \$ExpectedProcessStartedAtUtc\.ToUniversalTime\(\)\.ToString\('o'\)/);
  assert.doesNotMatch(restartSource, /Stop-Process -Id \$verifiedWorker\.ProcessId/);
  assert.doesNotMatch(restartSource, /Stop-Process\s+-Name|taskkill|killall/);
});

test('shared heartbeat time may advance without weakening immutable invocation cleanup identity', () => {
  assert.equal(mandatoryWorkerCleanupBoundary(restartSource), true);
  assert.match(
    restartSource,
    /\$boundHeartbeatTimestampUtc -le \$receiptProcessStartedAtUtc\s*`?\r?\n\s*-or \$boundHeartbeatTimestampUtc -gt \$invocationHeartbeatObservedAtUtc\s*`?\r?\n\s*-or \$timestamp -lt \$boundHeartbeatTimestampUtc/,
  );
  for (const mutation of [
    restartSource.replace('$timestamp -lt $boundHeartbeatTimestampUtc', '$timestamp -ne $boundHeartbeatTimestampUtc'),
    restartSource.replace('$timestamp -lt $boundHeartbeatTimestampUtc', '$false'),
    restartSource.replace('$boundHeartbeatTimestampUtc -le $receiptProcessStartedAtUtc', '$false'),
    restartSource.replace('$processStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks', '$false'),
    restartSource.replaceAll('Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot', '$true'),
  ]) {
    assert.equal(mandatoryWorkerCleanupBoundary(mutation), false);
  }
});

test('existing-worker termination requires a fresh heartbeat-recorded process-start identity on both live reads', () => {
  assert.equal(verifiedExistingWorkerIdentityBoundary(restartSource), true);
  for (const mutation of [
    restartSource.replace("$launchIdentityId -notmatch '^[0-9a-f]{64}$'", '$false'),
    restartSource.replace('Test-ExactJsonPropertyEstate -Record $heartbeat', '$true #'),
    restartSource.replace('Test-ExactJsonPropertyEstate -Record $launchReceipt', '$true #'),
    restartSource.replace('$heartbeatTimestampUtc -le $heartbeatProcessStartedAtUtc', '$false'),
    restartSource.replace('$heartbeatTimestampUtc -gt $observedAtUtc', '$false'),
    restartSource.replace('($observedAtUtc - $heartbeatTimestampUtc).TotalSeconds -gt 120', '$false'),
    restartSource.replace('$receiptProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks', '$false'),
    restartSource.replace('$liveProcessStartedAtUtc.Ticks -ne $heartbeatProcessStartedAtUtc.Ticks', '$false'),
    restartSource.replace('$oldWorkerRecheck.LaunchIdentityId -ne $oldWorker.LaunchIdentityId', '$false'),
    restartSource.replace('$oldWorkerRecheck.LaunchReceiptDigest -ne $oldWorker.LaunchReceiptDigest', '$false'),
    restartSource.replace('$oldWorkerRecheck.HeadSha -ne $oldWorker.HeadSha', '$false'),
    restartSource.replace('$oldWorkerRecheck.HeartbeatTimestampUtc -lt $oldWorker.HeartbeatTimestampUtc', '$false'),
  ]) {
    assert.equal(verifiedExistingWorkerIdentityBoundary(mutation), false);
  }
});

test('existing-worker heartbeat rejects every future instant while retaining the fixed freshness window', () => {
  const observedMs = Date.parse('2026-08-14T12:00:00.000Z');
  const processStartedMs = observedMs - 180_000;
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: observedMs + 1, processStartedMs, observedMs }), false);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: observedMs + 1_000, processStartedMs, observedMs }), false);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: observedMs, processStartedMs, observedMs }), true);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: observedMs - 120_000, processStartedMs, observedMs }), true);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: observedMs - 120_001, processStartedMs, observedMs }), false);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: processStartedMs, processStartedMs, observedMs }), false);
  assert.equal(heartbeatTimestampAdmissible({ timestampMs: Number.NaN, processStartedMs, observedMs }), false);
  assert.match(restartSource, /\$heartbeatTimestampUtc -gt \$observedAtUtc/);
  assert.doesNotMatch(restartSource, /\$heartbeatTimestampUtc -gt \$observedAtUtc\.AddSeconds\(60\)/);
});

test('fresh-worker and launcher heartbeat proof reject every future instant before confirmation', () => {
  const observedMs = 10_000;
  const processStartedMs = observedMs - 1;
  assert.equal(freshHeartbeatTimestampAdmissible({ timestampMs: observedMs, processStartedMs, observedMs }), true);
  assert.equal(freshHeartbeatTimestampAdmissible({ timestampMs: observedMs + 0.0001, processStartedMs, observedMs }), false);
  assert.equal(freshHeartbeatTimestampAdmissible({ timestampMs: observedMs + 1, processStartedMs, observedMs }), false);
  assert.equal(freshHeartbeatTimestampAdmissible({ timestampMs: processStartedMs, processStartedMs, observedMs }), false);
  assert.equal(freshHeartbeatTimestampAdmissible({ timestampMs: Number.NaN, processStartedMs, observedMs }), false);
  assert.equal(exactFreshWorkerHeartbeatObservationBoundary(restartSource, workerStartSource), true);

  const mutations = [
    [restartSource.replace('$sharedHeartbeatObservedAtUtc = [datetime]::UtcNow', '$sharedHeartbeatObservedAtUtc = [datetime]::MaxValue'), workerStartSource],
    [restartSource.replace('$timestamp -gt $sharedHeartbeatObservedAtUtc', '$false'), workerStartSource],
    [restartSource.replace('$invocationHeartbeatObservedAtUtc = [datetime]::UtcNow', '$invocationHeartbeatObservedAtUtc = [datetime]::MaxValue'), workerStartSource],
    [restartSource.replace('$boundHeartbeatTimestampUtc -gt $invocationHeartbeatObservedAtUtc', '$false'), workerStartSource],
    [restartSource, workerStartSource.replace('$heartbeatObservedAtUtc = [datetime]::UtcNow', '$heartbeatObservedAtUtc = [datetime]::MaxValue')],
    [restartSource, workerStartSource.replace('$heartbeatTimestampUtc -le $heartbeatObservedAtUtc', '$true')],
    [restartSource, workerStartSource.replace('if ($confirmation -and $invocationHeartbeatBound)', 'if ($confirmation)')],
  ];
  for (const [restart, launcher] of mutations) {
    assert.equal(exactFreshWorkerHeartbeatObservationBoundary(restart, launcher), false);
  }
});

test('existing-worker cleanup terminates only through the exact final process capability', () => {
  assert.equal(exactExistingWorkerProcessCapabilityBoundary(restartSource), true);
  for (const mutation of [
    restartSource.replaceAll('[System.Diagnostics.Process]::GetProcessById($processId)', 'Get-Process -Id $processId'),
    restartSource.replaceAll('$null = $processCapability.Handle', '$null = $processId'),
    restartSource.replaceAll('$processCapability.StartTime.ToUniversalTime()', '$heartbeatProcessStartedAtUtc'),
    restartSource.replaceAll('ProcessCapability = $processCapability', 'ProcessCapability = $processId'),
    restartSource.replace('$reverifiedProcessCapability.HasExited', '$false'),
    restartSource.replace('$null = $reverifiedProcessCapability.Handle', '$null = $oldWorker.ProcessId'),
    restartSource.replace('$reverifiedProcessCapability.StartTime.ToUniversalTime()', '$oldWorker.ProcessStartedAtUtc'),
    restartSource.replace('$reverifiedProcessCapability.Kill()', 'Stop-Process -Id $oldWorker.ProcessId -Force'),
    restartSource.replace('$reverifiedProcessCapability.WaitForExit(10000)', '$true'),
  ]) {
    assert.equal(exactExistingWorkerProcessCapabilityBoundary(mutation), false);
  }
});

test('advanced heartbeat timestamps cannot transfer cleanup authority to a recycled pid', () => {
  const oldWorkerVerifier = restartSource.slice(
    restartSource.indexOf('function Get-VerifiedWorkerProcessFromHeartbeat'),
    restartSource.indexOf('function Get-VerifiedFreshWorkerInstance'),
  );
  assert.match(restartSource, /ProcessStartedAtUtc = \$heartbeatProcessStartedAtUtc/);
  assert.match(restartSource, /LaunchReceiptDigest = \$launchReceiptDigest/);
  assert.match(
    restartSource,
    /\$oldWorkerRecheck\.ProcessStartedAtUtc\.Ticks -ne \$oldWorker\.ProcessStartedAtUtc\.Ticks[\s\S]*\$oldWorkerRecheck\.LaunchIdentityId -ne \$oldWorker\.LaunchIdentityId[\s\S]*\$oldWorkerRecheck\.LaunchReceiptDigest -ne \$oldWorker\.LaunchReceiptDigest[\s\S]*\$oldWorkerRecheck\.HeartbeatTimestampUtc -lt \$oldWorker\.HeartbeatTimestampUtc/,
  );
  assert.doesNotMatch(
    oldWorkerVerifier,
    /^\s*ProcessStartedAtUtc = \(\[datetime\]\$process\.CreationDate\)\.ToUniversalTime\(\)/m,
  );
});

test('launcher owns every failure from process start through immutable receipt publication', () => {
  assert.equal(exactOwnedLauncherCleanupBoundary(workerStartSource), true);
  for (const mutation of [
    workerStartSource.replace('$workerProcessStarted = $true', '$workerProcessStarted = $false'),
    workerStartSource.replace('$ownedWorkerProcess = $workerProcess', '$ownedWorkerProcess = $null'),
    workerStartSource.replace('[object]::ReferenceEquals($Process, $OwnedProcess)', '$true'),
    workerStartSource.replace('$ExpectedStartedAtUtc -ne [datetime]::MinValue', '$false'),
    workerStartSource.replace('$observedStartedAtUtc.Ticks -ne $ExpectedStartedAtUtc.ToUniversalTime().Ticks', '$false'),
    workerStartSource.replaceAll('Stop-ExactOwnedWorkerProcess `', '# cleanup omitted'),
    workerStartSource.replace('if ($workerProcessStarted)', 'if ($false)'),
    workerStartSource.replace('$Process.Kill()', '# kill omitted'),
    workerStartSource.replace('$Process.WaitForExit(5000)', '$true'),
  ]) {
    assert.equal(exactOwnedLauncherCleanupBoundary(mutation), false);
  }
});

test('pre-receipt cleanup uses only the exact in-memory process capability and cannot publish success', () => {
  const launchFunction = workerStartSource.indexOf('function Start-ExactWorkerWithLaunchIdentity');
  const start = workerStartSource.indexOf('if (-not $workerProcess.Start())', launchFunction);
  const receipt = workerStartSource.indexOf('Write-BoundedCreateOnlyJson -Path $launchReceiptPath', start);
  const cleanup = workerStartSource.indexOf('Stop-ExactOwnedWorkerProcess `', receipt);
  assert.ok(start >= 0 && receipt > start && cleanup > receipt);
  assert.match(workerStartSource, /\$workerProcessStarted = \$true[\s\S]*\$ownedWorkerProcess = \$workerProcess[\s\S]*\$workerStartedAtUtc = \$workerProcess\.StartTime\.ToUniversalTime\(\)/);
  assert.match(workerStartSource, /-ExpectedStartedAtUtc \$workerStartedAtUtc/);
  assert.match(workerStartSource, /throw "Mission worker launch-identity cleanup failed:/);
  assert.match(workerStartSource, /throw \$launchFailure/);
  const guardedCatch = workerStartSource.slice(
    workerStartSource.indexOf('\n    catch {', receipt),
    workerStartSource.indexOf('throw $launchFailure', cleanup),
  );
  assert.doesNotMatch(guardedCatch, /restartConfirmed = \$true/);
});

test('cancellation uses the one canonical absolute deadline representation accepted by the launcher', () => {
  assert.equal(exactCancellationDeadlineTransport(restartSource, workerStartSource), true);
  for (const [writer, reader] of [
    [restartSource.replaceAll(
      `deadlineUtc = $script:operationDeadlineUtc.ToString('${canonicalDeadlineFormat}')`,
      "deadlineUtc = $script:operationDeadlineUtc.ToString('o')",
    ), workerStartSource],
    [restartSource.replaceAll(
      `deadlineUtc = $script:operationDeadlineUtc.ToString('${canonicalDeadlineFormat}')`,
      `deadlineUtc = [datetime]::UtcNow.AddMinutes(5).ToString('${canonicalDeadlineFormat}')`,
    ), workerStartSource],
    [restartSource, workerStartSource.replace(
      `[string]$record.deadlineUtc -ne $restartDeadlineUtc.ToString('${canonicalDeadlineFormat}')`,
      '[string]$record.deadlineUtc -ne [string]$restartDeadlineUtc',
    )],
    [restartSource, workerStartSource.replace(canonicalDeadlineFormat, 'o')],
  ]) {
    assert.equal(exactCancellationDeadlineTransport(writer, reader), false);
  }
});

test('cancellation remains exact-invocation, exact-worker and fail-closed bound', () => {
  for (const exactBinding of [
    '$candidateClaim.invocationId -ne $ExpectedInvocationId',
    '$candidateClaim.repositoryRoot -ne $ExpectedRepoRoot',
    '$candidateClaim.headSha -ne $ExpectedSourceHead',
    '$receiptProcessId -ne $ExpectedProcessId',
    '$receiptProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks',
    '$verifiedInvocationProcess.ProcessId -ne $ExpectedProcessId',
    '$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks',
    'MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP',
    'MISSION_WORKER_POST_START_CLEANUP_FAILED',
  ]) {
    assert.ok(restartSource.includes(exactBinding), exactBinding);
  }
  assert.match(workerStartSource, /\$restartDeadlineUtc -le \[datetime\]::UtcNow -or \$restartDeadlineUtc -gt \[datetime\]::UtcNow\.AddSeconds\(95\)/);
  assert.match(workerStartSource, /Mission worker restart request deadline is invalid/);
  assert.match(workerStartSource, /\$record\.deadlineUtc -ne \$restartDeadlineUtc\.ToString\('yyyy-MM-ddTHH:mm:ss\.fffZ'\)/);
  assert.match(workerStartSource, /\$record\.invocationId -ne \$InvocationId/);
  assert.match(workerStartSource, /\$recordPid -ne \$WorkerPid/);
  assert.match(workerStartSource, /\$recordStartedAtUtc\.Ticks -ne \$WorkerStartedAtUtc\.ToUniversalTime\(\)\.Ticks/);
});

test('success and blocked receipts expose exact startup and cleanup truth', () => {
  for (const field of [
    'sourceTrackedClean',
    'publicMainHead',
    'postStartSourceProofOk',
    'startedWorkerPid',
    'workerStartedAtUtc',
    'cleanupAttempted',
    'cleanupCompleted',
    'invocationId',
    'deadlineUtc',
    'invocationBound',
    'canonicalWorkerCommandVerified',
  ]) {
    assert.match(restartSource, new RegExp(`${field}\\s*=`));
  }
  assert.match(restartSource, /postStartSourceProofOk = if \(\$Target -eq 'mission-worker'\) \{ \$postStartSourceProofOk \}/);
  assert.match(restartSource, /exactHeadProofOk = \$false[\s\S]*cleanupAttempted = \$cleanupAttempted[\s\S]*cleanupCompleted = \$cleanupCompleted/);
});

test('backend starter proves canonical main and writes a bounded exact-head runtime receipt', () => {
  assert.match(backendStartSource, /\[string\]\$ExpectedHead = ''/);
  assert.match(backendStartSource, /branch --show-current/);
  assert.match(backendStartSource, /rev-parse HEAD/);
  assert.match(backendStartSource, /branch -ne 'main'/);
  assert.match(backendStartSource, /upstream -ne 'origin\/main'/);
  assert.match(backendStartSource, /originHead -ne \$headSha/);
  assert.match(backendStartSource, /\$boundExpectedHead = if \(\$providedExpectedHead\) \{ \$providedExpectedHead \} else \{ \$headSha \}/);
  assert.match(backendStartSource, /observedHead -ne \$boundExpectedHead/);
  assert.match(backendStartSource, /function Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /Move-Item -LiteralPath \$handoffPath -Destination \$consumedPath/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_CONSUME_FAILED/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED/);
  assert.doesNotMatch(backendStartSource, /expiresAtUtc -le \$nowUtc\) \{ return \$null/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID/);
  assert.match(backendStartSource, /expiresAtUtc -le \$issuedAtUtc/);
  assert.match(backendStartSource, /if \(-not \$providedExpectedHead\) \{[\s\S]*Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /stephanos-backend-runtime\.json/);
  assert.match(backendStartSource, /headSha = \$HeadSha/);
  assert.match(backendStartSource, /taskName = 'Stephanos Battle Bridge Backend'/);
  assert.match(backendStartSource, /pathValuesPublished = \$false/);
  assert.match(backendStartSource, /function Get-ExactHeadBackendBootstrapBase64/);
  assert.match(backendStartSource, /"--git-dir=`"\$canonicalGitDirectory`"", "--work-tree=`"\$repoRoot`"", 'show', "\$\{HeadSha\}:\$bootstrapGitPath"/);
  assert.match(backendStartSource, /ReadAllBytes\(\$temporaryPath\)/);
  assert.match(backendStartSource, /ComputeHash\(\$blobBytes\)/);
  assert.match(backendStartSource, /\$bootstrapBase64 = Get-ExactHeadBackendBootstrapBase64/);
  assert.match(backendStartSource, /function Start-BackendNodeWithMinimalEnvironment/);
  assert.match(backendStartSource, /SetEnvironmentVariable\(\[string\]\$entry\.Name, \$null, 'Process'\)/);
  assert.match(backendStartSource, /\$minimalEnvironment\['STEPHANOS_BACKEND_BOOTSTRAP_BASE64'\] = \$BootstrapBase64/);
  assert.match(backendStartSource, /\$minimalEnvironment\['PATH'\] = 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1\.0;C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd;C:\\Program Files\\GitHub CLI'/);
  assert.match(backendStartSource, /\$minimalEnvironment\['PATHEXT'\] = '\.COM;\.EXE;\.BAT;\.CMD'/);
  assert.match(backendStartSource, /--input-type=module', '--eval'/);
  assert.doesNotMatch(backendStartSource, /backend-bootstrap-\$headSha\.mjs/);
  assert.match(backendStartSource, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(backendStartSource, /Start-Process -FilePath \$canonicalNpm/);
  assert.match(backendStartSource, /\$canonicalGitArguments = @\("--git-dir=\$canonicalGitDirectory", "--work-tree=\$repoRoot"\)/);
  assert.match(backendStartSource, /if \(\[string\]\$entry\.Name -like 'GIT_\*'\)[\s\S]*Remove-Item -LiteralPath \("Env:\{0\}" -f \[string\]\$entry\.Name\)/);
  assert.match(backendStartSource, /\$env:GIT_CONFIG_NOSYSTEM = '1'/);
  assert.match(backendStartSource, /\$env:GIT_CONFIG_GLOBAL = 'NUL'/);
  assert.match(backendStartSource, /\$env:GIT_NO_REPLACE_OBJECTS = '1'/);
  assert.doesNotMatch(backendStartSource, /& \$canonicalGit -C /);
  assert.match(backendStartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.doesNotMatch(backendStartSource, /repositoryRoot\s*=/);
});

test('backend starter captures native Git exit codes before selecting bounded output', () => {
  assert.match(
    backendStartSource,
    /\$branchOutput = @\(& \$canonicalGit @canonicalGitArguments branch --show-current 2>\$null\)\r?\n\$branchExitCode = \$LASTEXITCODE\r?\nif \(\$branchExitCode -ne 0\)/,
  );
  assert.match(
    backendStartSource,
    /\$headOutput = @\(& \$canonicalGit @canonicalGitArguments rev-parse HEAD 2>\$null\)\r?\n\$headExitCode = \$LASTEXITCODE\r?\nif \(\$headExitCode -ne 0\)/,
  );
  assert.match(backendStartSource, /\$branchRaw = \$branchOutput \| Select-Object -First 1/);
  assert.match(backendStartSource, /\$headRaw = \$headOutput \| Select-Object -First 1/);
  assert.doesNotMatch(backendStartSource, /& \$canonicalGit[^\r\n]+\|\s*Select-Object/);
});
