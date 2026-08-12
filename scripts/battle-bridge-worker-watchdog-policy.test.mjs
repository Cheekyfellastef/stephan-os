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

function healthyInput() {
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
    },
    process: {
      running: true,
      taskName: APPROVED_WORKER_TASK,
      pid: 1291,
      commandLineMatchesCanonicalWorker: true,
    },
    heartbeat: {
      timestampUtc: '2026-07-15T01:59:30.000Z',
      repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
      branch: 'main',
      headSha: 'a'.repeat(40),
      taskName: APPROVED_WORKER_TASK,
      pid: 1291,
    },
  };
}

test('healthy canonical worker is a no-op and exposes its exact validated source head', () => {
  const result = buildWorkerWatchdogRecoveryDecision(healthyInput());
  assert.equal(result.action, 'NO_OP');
  assert.equal(result.assessment.healthy, true);
  assert.equal(result.assessment.taskActionMatchesCanonicalWorker, true);
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
  input.related = 'issue:#1291-extra';
  const result = buildWorkerWatchdogRecoveryDecision(input);
  assert.equal(result.action, 'BLOCKED');
  assert.equal(result.restartTaskName, '');
  assert.ok(result.blockers.includes('invalid-issue-or-pr-correlation'));
});

test('Windows probe binds repository truth to fixed read-only git commands', () => {
  assert.match(PROBE_SCRIPT, /Get-Command git\.exe -ErrorAction Stop/);
  assert.match(PROBE_SCRIPT, /-C \$repositoryRoot symbolic-ref --quiet --short HEAD/);
  assert.match(PROBE_SCRIPT, /-C \$repositoryRoot rev-parse --verify HEAD/);
  assert.match(PROBE_SCRIPT, /https:\/\/github\.com\/Cheekyfellastef\/stephan-os\.git/);
  assert.match(PROBE_SCRIPT, /\$GitCommand\.Source 'ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main'/);
  assert.match(PROBE_SCRIPT, /\$repositoryHead -ne \$remoteMainHead/);
  assert.match(PROBE_SCRIPT, /\$remoteMainHeadAfterRestart -ne \$remoteMainHead/);
  assert.match(PROBE_SCRIPT, /repositoryRoot = \$repositoryRoot/);
  assert.match(PROBE_SCRIPT, /headSha = \$repositoryHead/);
  assert.match(PROBE_SCRIPT, /remoteMainHeadSha = \$remoteMainHead/);
  assert.match(PROBE_SCRIPT, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(PROBE_SCRIPT, /Get-Command powershell\.exe -ErrorAction Stop/);
  assert.match(PROBE_SCRIPT, /'mission-worker'/);
  assert.match(PROBE_SCRIPT, /'-ExpectedHead'/);
  assert.match(PROBE_SCRIPT, /\$repositoryHead/);
  assert.match(PROBE_SCRIPT, /stephanos\.approved-runtime-restart\.v1/);
  assert.match(PROBE_SCRIPT, /APPROVED_RUNTIME_RESTART_PASS/);
  assert.match(PROBE_SCRIPT, /terminatedVerifiedOwnedProcess/);
  assert.doesNotMatch(PROBE_SCRIPT, /Stop-ScheduledTask|Stop-Process/);
  assert.doesNotMatch(PROBE_SCRIPT, /Invoke-Expression|Start-Process/);
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
