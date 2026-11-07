import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPROVED_WORKER_TASK,
  assessMissionOrchestratorWorker,
  buildWorkerWatchdogRecoveryDecision,
  isCanonicalIssueOrPrCorrelation,
} from './battle-bridge-worker-watchdog-policy.mjs';

const NOW = Date.parse('2026-07-15T02:00:00.000Z');
const PROBE_SCRIPT = readFileSync(
  new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url),
  'utf8',
);
const RESTART_SCRIPT = readFileSync(
  new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url),
  'utf8',
);

function healthyInput() {
  const launchIdentityId = '1'.repeat(64);
  const workerStartedAtUtc = '2026-07-15T01:58:00.000Z';
  return {
    nowMs: NOW,
    scheduledTask: {
      taskName: APPROVED_WORKER_TASK,
      status: 'Running',
      actionMatchesCanonicalWorker: true,
    },
    repository: {
      repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
      branch: 'main',
      headSha: 'a'.repeat(40),
      remoteMainHeadSha: 'a'.repeat(40),
      trackedClean: true,
    },
    process: {
      running: true,
      taskName: APPROVED_WORKER_TASK,
      pid: 1291,
      commandLineMatchesCanonicalWorker: true,
      startedAtUtc: workerStartedAtUtc,
      launchIdentityId,
      launchIdentityVerified: true,
    },
    heartbeat: {
      timestampUtc: '2026-07-15T01:59:30.000Z',
      repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
      branch: 'main',
      headSha: 'a'.repeat(40),
      taskName: APPROVED_WORKER_TASK,
      pid: 1291,
      launchIdentityId,
      workerStartedAtUtc,
    },
  };
}

test('healthy canonical worker is a no-op and exposes its exact validated source head', () => {
  const result = buildWorkerWatchdogRecoveryDecision(healthyInput());
  assert.equal(result.action, 'NO_OP');
  assert.equal(result.assessment.healthy, true);
  assert.equal(result.assessment.taskActionMatchesCanonicalWorker, true);
  assert.equal(result.assessment.processLaunchIdentityVerified, true);
  assert.equal(result.assessment.heartbeatLaunchIdentityMatchesProcess, true);
  assert.equal(result.assessment.heartbeatProcessStartMatchesProcess, true);
  assert.equal(result.assessment.sourceHead, 'a'.repeat(40));
  assert.equal(result.restartTaskName, '');
});

test('missing observed task identity fails closed', () => {
  const input = healthyInput();
  delete input.scheduledTask.taskName;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.assessment.taskApproved, false);
  assert.ok(result.blockers.includes('scheduled-task-identity-missing'));
});

test('wrong task name cannot be restarted', () => {
  const input = healthyInput();
  input.scheduledTask.taskName = 'Any Other Task';
  input.process.running = false;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.restartTaskName, '');
  assert.ok(result.blockers.includes('scheduled-task-not-allowlisted'));
});

test('noncanonical task action blocks healthy and recovery verdicts', () => {
  const input = healthyInput();
  input.scheduledTask.actionMatchesCanonicalWorker = false;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.assessment.restartPermitted, false);
  assert.equal(result.restartTaskName, '');
  assert.ok(result.blockers.includes('scheduled-task-action-not-canonical'));
});

test('approved stopped canonical task authorizes only the fixed task', () => {
  const input = healthyInput();
  input.scheduledTask.status = 'Ready';
  input.process.running = false;
  input.process.commandLineMatchesCanonicalWorker = false;
  input.process.launchIdentityVerified = false;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'START_APPROVED_WORKER_TASK');
  assert.equal(result.restartTaskName, APPROVED_WORKER_TASK);
});

test('stale heartbeat requires bounded recovery', () => {
  const input = healthyInput();
  input.heartbeat.timestampUtc = '2026-07-15T01:00:00.000Z';
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'START_APPROVED_WORKER_TASK');
  assert.ok(result.blockers.includes('worker-heartbeat-stale'));
  assert.equal(result.boundedProbeAttempts, 3);
});

test('malformed heartbeat is detected', () => {
  const input = healthyInput();
  input.heartbeat.timestampUtc = 'not-a-date';
  const result = assessMissionOrchestratorWorker(input);
  assert.equal(result.heartbeatFresh, false);
  assert.ok(result.blockers.includes('worker-heartbeat-malformed'));
});

test('wrong repository or branch cannot prove canonical main or expose a repair source head', () => {
  const input = healthyInput();
  input.heartbeat.repositoryRoot = 'C:\\temp\\stephan-os';
  input.heartbeat.branch = 'feature';
  const result = assessMissionOrchestratorWorker(input);
  assert.equal(result.repositoryFromCanonicalMain, false);
  assert.equal(result.sourceHead, '');
  assert.ok(result.blockers.includes('worker-not-proven-from-canonical-main'));
});

test('old-head heartbeat is not healthy and authorizes only the fixed worker restart', () => {
  const input = healthyInput();
  input.heartbeat.headSha = 'b'.repeat(40);
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.assessment.canonicalRepositoryHeadProven, true);
  assert.equal(result.assessment.heartbeatMatchesCanonicalRepositoryHead, false);
  assert.equal(result.assessment.sourceHead, '');
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.action, 'START_APPROVED_WORKER_TASK');
  assert.equal(result.restartTaskName, APPROVED_WORKER_TASK);
  assert.ok(result.blockers.includes('worker-heartbeat-head-mismatch'));
});

test('unproven repository head fails closed without restart authority', () => {
  for (const headSha of ['', 'not-a-sha']) {
    const input = healthyInput();
    input.repository.headSha = headSha;
    const result = buildWorkerWatchdogRecoveryDecision(input);
    assert.equal(result.assessment.canonicalRepositoryHeadProven, false);
    assert.equal(result.assessment.heartbeatMatchesCanonicalRepositoryHead, false);
    assert.equal(result.assessment.sourceHead, '');
    assert.equal(result.assessment.restartPermitted, false);
    assert.equal(result.action, 'BLOCKED');
    assert.ok(result.blockers.includes('canonical-repository-head-unproven'));
  }
});

test('missing, malformed or different remote main truth blocks restart authority', () => {
  for (const remoteMainHeadSha of ['', 'not-a-sha', 'b'.repeat(40)]) {
    const input = healthyInput();
    input.repository.remoteMainHeadSha = remoteMainHeadSha;
    input.process.running = false;
    input.process.commandLineMatchesCanonicalWorker = false;
    input.process.launchIdentityVerified = false;
    const result = buildWorkerWatchdogRecoveryDecision(input);
    assert.equal(result.assessment.canonicalRepositoryHeadProven, false);
    assert.equal(result.assessment.restartPermitted, false);
    assert.equal(result.action, 'BLOCKED');
    assert.equal(result.restartTaskName, '');
    assert.ok(result.blockers.includes('canonical-repository-head-unproven'));
    if (remoteMainHeadSha === 'b'.repeat(40)) {
      assert.ok(result.blockers.includes('canonical-repository-head-stale'));
    } else {
      assert.ok(result.blockers.includes('remote-main-head-unproven'));
    }
  }
});

test('tracked source drift blocks healthy and restart verdicts', () => {
  const input = healthyInput();
  input.repository.trackedClean = false;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.assessment.canonicalRepositoryTrackedClean, false);
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.assessment.restartPermitted, false);
  assert.equal(result.action, 'BLOCKED');
  assert.ok(result.blockers.includes('canonical-repository-tracked-dirty'));
});

test('command line and heartbeat pid must bind to the canonical worker process', () => {
  const commandLineInput = healthyInput();
  commandLineInput.process.commandLineMatchesCanonicalWorker = false;
  const commandLineResult = assessMissionOrchestratorWorker(commandLineInput);
  assert.equal(commandLineResult.processHealthy, false);
  assert.ok(commandLineResult.blockers.includes('worker-command-line-not-canonical'));

  const pidInput = healthyInput();
  pidInput.heartbeat.pid = 9999;
  const pidResult = assessMissionOrchestratorWorker(pidInput);
  assert.equal(pidResult.heartbeatPidMatchesProcess, false);
  assert.ok(pidResult.blockers.includes('worker-heartbeat-pid-mismatch'));
});

test('heartbeat task identity must be the fixed approved task', () => {
  const input = healthyInput();
  input.heartbeat.taskName = 'Any Other Task';
  const result = assessMissionOrchestratorWorker(input);
  assert.equal(result.heartbeatTaskApproved, false);
  assert.ok(result.blockers.includes('worker-heartbeat-task-not-allowlisted'));
});

test('missing or malformed launch identity can never paint the worker healthy', () => {
  for (const launchIdentityId of ['', 'not-a-launch-id']) {
    const input = healthyInput();
    input.heartbeat.launchIdentityId = launchIdentityId;
    const result = buildWorkerWatchdogRecoveryDecision(input);
    assert.equal(result.assessment.healthy, false);
    assert.equal(result.action, 'START_APPROVED_WORKER_TASK');
    assert.ok(result.blockers.includes('worker-heartbeat-launch-identity-invalid'));
  }
});

test('heartbeat launch identity must match the independently verified live process launch identity', () => {
  const input = healthyInput();
  input.process.launchIdentityId = '2'.repeat(64);
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.assessment.heartbeatLaunchIdentityMatchesProcess, false);
  assert.ok(result.blockers.includes('worker-launch-identity-mismatch'));
});

test('heartbeat process-start identity must exactly match the live process creation time', () => {
  const input = healthyInput();
  input.process.startedAtUtc = '2026-07-15T01:58:01.000Z';
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.assessment.heartbeatProcessStartMatchesProcess, false);
  assert.ok(result.blockers.includes('worker-process-start-mismatch'));
});

test('canonical command line and pid are insufficient without an independently verified launch receipt', () => {
  const input = healthyInput();
  input.process.launchIdentityVerified = false;
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.assessment.healthy, false);
  assert.equal(result.assessment.processHealthy, false);
  assert.ok(result.blockers.includes('worker-launch-identity-unproven'));
});

test('issue and PR correlations require exact numeric boundaries', () => {
  assert.equal(isCanonicalIssueOrPrCorrelation('issue:#1291'), true);
  assert.equal(isCanonicalIssueOrPrCorrelation('pr:#1375'), true);
  assert.equal(isCanonicalIssueOrPrCorrelation('issue:#1291-extra'), false);
  assert.equal(isCanonicalIssueOrPrCorrelation('issue:#01291'), false);
  assert.equal(isCanonicalIssueOrPrCorrelation('#1291'), false);
});

test('invalid correlation blocks restart authorization and clears task target', () => {
  const input = healthyInput();
  input.process.running = false;
  input.process.commandLineMatchesCanonicalWorker = false;
  input.process.launchIdentityVerified = false;
  input.related = 'issue:#1291-extra';
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.restartTaskName, '');
  assert.ok(result.blockers.includes('invalid-issue-or-pr-correlation'));
});

test('Windows probe binds repository truth and health to fixed launch-identity evidence', () => {
  assert.match(PROBE_SCRIPT, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(PROBE_SCRIPT, /\$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/);
  assert.doesNotMatch(PROBE_SCRIPT, /Get-Command (?:git|powershell)(?:\.exe)?\b/i);
  assert.match(PROBE_SCRIPT, /-C \$repositoryRoot symbolic-ref --quiet --short HEAD/);
  assert.match(PROBE_SCRIPT, /-C \$repositoryRoot rev-parse --verify HEAD/);
  assert.match(PROBE_SCRIPT, /status '--porcelain=v1' '--untracked-files=no'/);
  assert.match(PROBE_SCRIPT, /https:\/\/github\.com\/Cheekyfellastef\/stephan-os\.git/);
  assert.match(PROBE_SCRIPT, /& \$GitExecutable 'ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main'/);
  assert.match(PROBE_SCRIPT, /\$repositoryHead -ne \$remoteMainHead/);
  assert.match(PROBE_SCRIPT, /repositoryRoot = \$repositoryRoot/);
  assert.match(PROBE_SCRIPT, /headSha = \$repositoryHead/);
  assert.match(PROBE_SCRIPT, /remoteMainHeadSha = \$remoteMainHead/);
  assert.match(PROBE_SCRIPT, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(PROBE_SCRIPT, /& \$canonicalPowerShell @restartArguments/);
  assert.match(PROBE_SCRIPT, /'mission-worker'/);
  assert.match(PROBE_SCRIPT, /'-ExpectedHead'/);
  assert.match(PROBE_SCRIPT, /\$repositoryHead/);
  assert.match(PROBE_SCRIPT, /'-TimeoutSeconds',[\s\S]*'30'/);
  assert.match(PROBE_SCRIPT, /stephanos\.approved-runtime-restart\.v1/);
  assert.match(PROBE_SCRIPT, /APPROVED_RUNTIME_RESTART_PASS/);
  assert.match(PROBE_SCRIPT, /terminatedVerifiedOwnedProcess/);
  assert.match(PROBE_SCRIPT, /\[string\]\$restartReceipt\.publicMainHead -eq \$repositoryHead/);
  assert.match(PROBE_SCRIPT, /\$restartReceipt\.postStartSourceProofOk -eq \$true/);
  assert.match(PROBE_SCRIPT, /\$restartReceipt\.sourceTrackedClean -eq \$true/);
  assert.match(PROBE_SCRIPT, /\$restartReceipt\.cleanupAttempted -eq \$false/);
  assert.match(PROBE_SCRIPT, /\$restartReceipt\.cleanupCompleted -eq \$false/);
  assert.match(PROBE_SCRIPT, /\$restartStartedWorkerPid -gt 0/);
  assert.match(PROBE_SCRIPT, /function Get-VerifiedWorkerLaunchIdentity/);
  assert.match(PROBE_SCRIPT, /mission-orchestrator-worker-launch-identity-\$launchIdentityId\.json/);
  assert.match(PROBE_SCRIPT, /launchIdentityVerified = \[bool\]\$launchIdentity/);
  assert.match(PROBE_SCRIPT, /launchIdentityId = if \(\$heartbeat\.PSObject\.Properties\['launchIdentityId'\]\) \{ \[string\]\$heartbeat\.launchIdentityId \} else \{ '' \}/);
  assert.match(PROBE_SCRIPT, /workerStartedAtUtc = if \(\$heartbeat\.PSObject\.Properties\['workerStartedAtUtc'\]\) \{ \[string\]\$heartbeat\.workerStartedAtUtc \} else \{ '' \}/);
  assert.doesNotMatch(PROBE_SCRIPT, /^\s*launchIdentityId = \[string\]\$heartbeat\.launchIdentityId/m);
  assert.doesNotMatch(PROBE_SCRIPT, /^\s*workerStartedAtUtc = \[string\]\$heartbeat\.workerStartedAtUtc/m);
  assert.match(PROBE_SCRIPT, /startedAtUtc = \$workerProcessStartedAtUtc/);
  assert.doesNotMatch(PROBE_SCRIPT, /trackedStatusAfterRestart|remoteMainHeadAfterRestart|repositoryHeadAfterRestart|repositoryBranchAfterRestart/);
  assert.doesNotMatch(PROBE_SCRIPT, /Stop-ScheduledTask|Stop-Process/);
  assert.doesNotMatch(PROBE_SCRIPT, /Invoke-Expression|Start-Process/);
});

test('worker restart request lifecycle cannot leave one failed invocation as a permanent fixed-path wedge', () => {
  assert.match(RESTART_SCRIPT, /function Read-CanonicalMissionWorkerRestartRequest/);
  assert.match(RESTART_SCRIPT, /function Reclaim-ExpiredMissionWorkerRestartRequest/);
  assert.match(RESTART_SCRIPT, /function Remove-ExactOwnedMissionWorkerRestartRequest/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_INVALID/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_CHANGED_BEFORE_RECLAIM/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_RECLAIM_FAILED/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_CLEANUP_IDENTITY_CHANGED/);
  assert.match(RESTART_SCRIPT, /MISSION_WORKER_RESTART_REQUEST_CLEANUP_FAILED/);
  assert.match(RESTART_SCRIPT, /\$windowSeconds -le 0 -or \$windowSeconds -gt 95/);
  assert.match(RESTART_SCRIPT, /\[string\]\$recheck\.Raw -ne \[string\]\$observed\.Raw/);
  assert.match(RESTART_SCRIPT, /\[string\]\$observed\.Record\.invocationId -ne \$ExpectedInvocationId/);
  assert.match(RESTART_SCRIPT, /\[string\]\$observed\.Record\.headSha -ne \$ExpectedHead/);
  assert.match(RESTART_SCRIPT, /\$observed\.DeadlineUtc\.Ticks -ne \$ExpectedDeadlineUtc\.ToUniversalTime\(\)\.Ticks/);
  const reclaim = RESTART_SCRIPT.indexOf('Reclaim-ExpiredMissionWorkerRestartRequest');
  const write = RESTART_SCRIPT.indexOf('Write-BoundedAtomicJson -Path $script:restartRequestPath', reclaim);
  const ownership = RESTART_SCRIPT.indexOf('$script:restartRequestWritten = $true', write);
  assert.ok(reclaim >= 0 && write > reclaim && ownership > write);
  assert.ok((RESTART_SCRIPT.match(/Remove-ExactOwnedMissionWorkerRestartRequest/g) || []).length >= 3);
  assert.doesNotMatch(RESTART_SCRIPT, /Remove-Item[^\n]*(?:restart-claim|restart-receipt|restart-confirm|restart-heartbeat)-\*/i);
});

test('forbidden command surfaces remain absent', () => {
  const result = buildWorkerWatchdogRecoveryDecision(healthyInput());
  assert.equal(result.assessment.arbitraryShellAllowed, false);
  assert.equal(result.assessment.arbitraryPowerShellAllowed, false);
  assert.equal(result.assessment.arbitraryTaskNameAllowed, false);
  assert.equal(result.assessment.processKillAllowed, false);
  assert.equal(result.assessment.pcRestartAllowed, false);
  assert.equal(result.assessment.sourceMutationAllowed, false);
  assert.equal(result.assessment.visiblePowerShellRequired, false);
});
