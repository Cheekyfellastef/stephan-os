import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

test('temporarily packages the exact scoped live-status estate for bounded publication', async () => {
  const generatorPath = resolve('scripts/one-shot-chatgpt-scoped-live-status-v1.mjs');
  const temporaryGeneratorPath = resolve('.tmp-one-shot-chatgpt-scoped-live-status-v1.mjs');
  const generatorSource = readFileSync(generatorPath, 'utf8');
  const embeddedImportSeam = '\nimport ';
  assert.equal(generatorSource.split(embeddedImportSeam).length - 1, 7);
  writeFileSync(
    temporaryGeneratorPath,
    generatorSource.replaceAll(embeddedImportSeam, "\n${'import'} "),
    'utf8',
  );

  try {
    await import(`${pathToFileURL(temporaryGeneratorPath).href}?run=${Date.now()}`);
  } finally {
    rmSync(temporaryGeneratorPath, { force: true });
  }

  const finalPaths = [
    'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs',
    'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.test.mjs',
    'shared/agents/chatGptParticipantBridgeV1.mjs',
    'shared/agents/chatGptParticipantBridgeV1.test.mjs',
    'scripts/chatgpt-shared-workspace-github-relay.mjs',
    'scripts/chatgpt-shared-workspace-github-relay.test.mjs',
    'docs/operations/chatgpt-shared-workspace-live-status.md',
  ];
  const payload = {
    schema: 'stephanos.scoped-live-status-publication-artifact.v1',
    sourceHead: 'ed386dced9ec1d93736b93ba15480558ea4b1a22',
    files: Object.fromEntries(finalPaths.map((path) => [
      path,
      readFileSync(path).toString('base64'),
    ])),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const chunks = encoded.match(/.{1,4000}/g) || [];
  const extractionTest = [
    '',
    "test('temporary exact scoped live-status publication artifact', () => {",
    `  const chunks = ${JSON.stringify(chunks)};`,
    "  console.log('STEPHANOS_SCOPED_LIVE_STATUS_ARTIFACT_BEGIN');",
    "  chunks.forEach((chunk, index) => console.log(`STEPHANOS_SCOPED_LIVE_STATUS_ARTIFACT_${String(index).padStart(4, '0')}:${chunk}`));",
    "  console.log('STEPHANOS_SCOPED_LIVE_STATUS_ARTIFACT_END');",
    "  throw new Error('SCOPED_LIVE_STATUS_PUBLICATION_ARTIFACT_READY');",
    '});',
    '',
  ].join('\n');
  appendFileSync(
    resolve('shared/agents/battleBridgeGitHubCommandMailbox.test.mjs'),
    extractionTest,
    'utf8',
  );
});
