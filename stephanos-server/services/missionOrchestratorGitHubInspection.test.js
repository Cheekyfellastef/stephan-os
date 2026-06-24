import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction, readMissionWorkerQueue } from './missionOrchestratorWorkerService.js';
import { processNextGitHubInspectionItem } from './missionOrchestratorWorkerConsumer.js';

function proof(requirement, id) {
  return { receiptId: id, requirement, source: 'test-runner', evidenceType: 'command-output', verified: true, exitCode: 0 };
}

async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-github-inspection-'));
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), now: new Date('2026-06-24T23:10:00.000Z') };
}

async function stateAtChecks(options) {
  const input = {
    missionId: 'github-inspection-test', operatorIntent: 'Implement a bounded source change.', intendedOutcome: 'Failed PR checks trigger bounded repair.',
    missionKind: 'implementation', repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: 'openclaw/github-inspection-test',
    worktreePath: 'C:\\worktree', allowedFiles: ['shared/agents/**'], requiredEvidence: ['focused test output'], requiredTests: ['node --test focused.test.mjs'],
  };
  await createMissionRecord(input, options);
  const event = (eventId, eventType, fields) => appendMissionEvent(input.missionId, { eventId, eventType, ...fields }, options);
  await event('worktree-inspection-001', 'WORKTREE_READY', { worktreePath: input.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree') });
  await event('dispatch-inspection-001', 'AGENT_DISPATCHED', { agentId: 'codex' });
  await event('result-inspection-001', 'AGENT_RESULT_RECEIVED', { success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result') });
  await event('evidence-inspection-001', 'EVIDENCE_RECORDED', { receipts: [proof('focused test output', 'test')] });
  await event('commit-inspection-001', 'GIT_OPERATION_COMPLETED', { operation: 'commit', commitSha: 'a'.repeat(40), clean: true, receipt: proof('signed git commit', 'commit') });
  await event('push-inspection-001', 'GIT_OPERATION_COMPLETED', { operation: 'push', success: true, receipt: proof('signed git push', 'push') });
  return event('pr-inspection-001', 'PULL_REQUEST_OPENED', { prNumber: 1300, prUrl: 'https://github.com/o/r/pull/1300', headSha: 'b'.repeat(40), mergeable: true, receipt: proof('pull request creation', 'pr') });
}

async function recordFailedChecks(options) {
  const atChecks = await stateAtChecks(options);
  const published = await publishMissionWorkerAction(atChecks.state, options);
  const processed = await processNextGitHubInspectionItem({
    ...options,
    inspectGitHub: async () => ({
      execution: { success: true, commandOutputHash: 'c'.repeat(64), completedAt: '2026-06-24T23:11:00.000Z' },
      inspection: { prNumber: 1300, headSha: 'b'.repeat(40), prState: 'open', mergeable: true, checks: [{ name: 'Build', status: 'failure', required: true }] },
    }),
  });
  return { published, processed };
}

test('failed PR checks are recorded as state, not treated as worker execution failure', async () => {
  const options = await runtime();
  const { published, processed } = await recordFailedChecks(options);
  assert.equal(published.adapter, 'openclaw-github-readonly');
  assert.equal(processed.event.eventType, 'PULL_REQUEST_CHECKS_UPDATED');
  assert.equal(processed.applied.state.currentPhase, 'REPAIR_REQUIRED');
  assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE');
});

test('publishing repair starts exactly one round and resets stale promotion state before Codex dispatch', async () => {
  const options = await runtime();
  await recordFailedChecks(options);
  const failed = await readMissionRecord('github-inspection-test', options);
  const repair = await publishMissionWorkerAction(failed.state, options);
  assert.equal(repair.published, true);
  assert.equal(repair.repairStarted, true);
  assert.equal(repair.adapter, 'codex');
  assert.equal(repair.action.repairRound, 1);
  const current = await readMissionRecord('github-inspection-test', options);
  assert.equal(current.state.repair.currentRound, 1);
  assert.equal(current.state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(current.state.dispatch.status, 'running');
  assert.equal(current.state.activeWriter, 'Codex');
  assert.equal(current.state.git.commitSha, '');
  assert.equal(current.state.git.pushed, false);
  assert.deepEqual(current.state.pullRequest.checks, []);
  const pending = await readMissionWorkerQueue(options);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].adapter, 'codex');
});
