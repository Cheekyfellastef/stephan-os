import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVED_WORKER_TASK,
  assessMissionOrchestratorWorker,
  buildWorkerWatchdogRecoveryDecision,
  isCanonicalIssueOrPrCorrelation,
} from './battle-bridge-worker-watchdog-policy.mjs';

const NOW = Date.parse('2026-07-15T02:00:00.000Z');

function healthyInput() {
  return {
    nowMs: NOW,
    scheduledTask: {
      taskName: APPROVED_WORKER_TASK,
      status: 'Running',
      actionMatchesCanonicalWorker: true,
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

test('healthy canonical worker is a no-op', () => {
  const result = buildWorkerWatchdogRecoveryDecision(healthyInput());
  assert.equal(result.action, 'NO_OP');
  assert.equal(result.assessment.healthy, true);
  assert.equal(result.assessment.taskActionMatchesCanonicalWorker, true);
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

test('wrong repository or branch cannot prove canonical main', () => {
  const input = healthyInput();
  input.heartbeat.repositoryRoot = 'C:\\temp\\stephan-os';
  input.heartbeat.branch = 'feature';
  const result = assessMissionOrchestratorWorker(input);
  assert.equal(result.repositoryFromCanonicalMain, false);
  assert.ok(result.blockers.includes('worker-not-proven-from-canonical-main'));
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
