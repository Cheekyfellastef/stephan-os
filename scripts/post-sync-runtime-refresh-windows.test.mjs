import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const restartSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const backendStartSource = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');

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
    && source.includes('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks')
    && source.includes('$reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks')
    && source.includes('mission-orchestrator-worker-restart-cancel-$ExpectedInvocationId.json');
}

test('restart helper accepts only backend and mission-worker', () => {
  assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
  assert.match(restartSource, /Stephanos Battle Bridge Backend/);
  assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
  assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
});

test('restart helper validates canonical task action before mutation', () => {
  assert.match(restartSource, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(restartSource, /APPROVED_TASK_EXECUTABLE_MISMATCH/);
  assert.match(restartSource, /APPROVED_TASK_ARGUMENTS_MISMATCH/);
  assert.ok(restartSource.includes("TaskPath '\\'"));
});

test('backend restart terminates only the verified 8787 Stephanos Node listener', () => {
  assert.match(restartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(restartSource, /stephanos-server\/server\.js/);
  assert.match(restartSource, /BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED/);
  assert.match(restartSource, /Stop-Process -Id \$listener\.ProcessId -Force/);
  assert.match(restartSource, /stephanos-backend-runtime\.json/);
  assert.match(restartSource, /BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT/);
  assert.match(restartSource, /BACKEND_TASK_DID_NOT_STOP/);
  assert.doesNotMatch(restartSource, /Stop-Process\s+-Name|taskkill|killall/);
});

test('worker restart requires task-owned process stop and a fresh exact-head heartbeat', () => {
  assert.match(restartSource, /mission-orchestrator-worker-heartbeat\.json/);
  assert.match(restartSource, /headSha -ne \$ExpectedSourceHead/);
  assert.match(restartSource, /MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/);
  assert.match(restartSource, /MISSION_WORKER_TASK_DID_NOT_STOP/);
  assert.match(restartSource, /MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP/);
  assert.match(restartSource, /Stop-Process -Id \$oldWorker\.ProcessId -Force/);
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

test('removing or widening any owned-cleanup identity edge fails the source guard', () => {
  for (const mutation of [
    restartSource.replaceAll('Stop-NewlyStartedOwnedWorker `', '# cleanup removed'),
    restartSource.replace("[string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker'", '$false'),
    restartSource.replaceAll('[string]$ExpectedInvocationId', '[string]$CallerSelectedInvocationId'),
    restartSource.replaceAll('Get-VerifiedInvocationProcessFromLaunchReceipt', 'Get-Process'),
    restartSource.replaceAll('$verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks', '$false'),
    restartSource.replaceAll('$reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks', '$false'),
  ]) {
    assert.equal(mandatoryWorkerCleanupBoundary(mutation), false);
  }
});

test('worker cleanup can target only the exact fresh owned process and fixed task', () => {
  assert.match(restartSource, /\[string\]\$Plan\.TaskName -ne 'Stephanos Mission Orchestrator Worker'/);
  assert.match(restartSource, /MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED/);
  assert.match(restartSource, /\$ExpectedInvocationId -notmatch '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(restartSource, /Get-VerifiedInvocationProcessFromLaunchReceipt/);
  assert.match(restartSource, /mission-orchestrator-worker-restart-heartbeat-\$ExpectedInvocationId\.json/);
  assert.match(restartSource, /\$invocationHeartbeat\.invocationId -ne \$ExpectedInvocationId/);
  assert.match(restartSource, /\$boundHeartbeatTimestampUtc\.Ticks -ne \$timestamp\.Ticks/);
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
  assert.match(backendStartSource, /branch --show-current/);
  assert.match(backendStartSource, /rev-parse HEAD/);
  assert.match(backendStartSource, /branch -ne 'main'/);
  assert.match(backendStartSource, /stephanos-backend-runtime\.json/);
  assert.match(backendStartSource, /headSha = \$HeadSha/);
  assert.match(backendStartSource, /taskName = 'Stephanos Battle Bridge Backend'/);
  assert.match(backendStartSource, /pathValuesPublished = \$false/);
  assert.match(backendStartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.doesNotMatch(backendStartSource, /repositoryRoot\s*=/);
});

test('backend starter captures native Git exit codes before selecting bounded output', () => {
  assert.match(
    backendStartSource,
    /\$branchOutput = @\(& \$canonicalGit -C \$repoRoot branch --show-current 2>\$null\)\r?\n\$branchExitCode = \$LASTEXITCODE\r?\nif \(\$branchExitCode -ne 0\)/,
  );
  assert.match(
    backendStartSource,
    /\$headOutput = @\(& \$canonicalGit -C \$repoRoot rev-parse HEAD 2>\$null\)\r?\n\$headExitCode = \$LASTEXITCODE\r?\nif \(\$headExitCode -ne 0\)/,
  );
  assert.match(backendStartSource, /\$branchRaw = \$branchOutput \| Select-Object -First 1/);
  assert.match(backendStartSource, /\$headRaw = \$headOutput \| Select-Object -First 1/);
  assert.doesNotMatch(backendStartSource, /& \$canonicalGit[^\r\n]+\|\s*Select-Object/);
});
