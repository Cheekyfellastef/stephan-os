import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import { publishMissionWorkerAction } from './missionOrchestratorWorkerService.js';
import { processNextGitHubInspectionItem } from './missionOrchestratorWorkerConsumer.js';

const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });
async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-github-inspection-'));
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue') };
}

async function stateAtChecks(options) {
  const input = { missionId: 'github-inspection-test', operatorIntent: 'Implement safely.', intendedOutcome: 'Failed checks trigger repair.', missionKind: 'implementation', repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: 'openclaw/github-inspection-test', worktreePath: 'C:\\worktree', allowedFiles: ['shared/agents/**'], requiredEvidence: ['focused test output'], requiredTests: ['node --test focused.test.mjs'] };
  await createMissionRecord(input, options);
  const append = (eventId, eventType, fields) => appendMissionEvent(input.missionId, { eventId, eventType, ...fields }, options);
  await append('worktree-inspection-001', 'WORKTREE_READY', { worktreePath: input.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree') });
  await append('dispatch-inspection-001', 'AGENT_DISPATCHED', { agentId: 'codex' });
  await append('result-inspection-001', 'AGENT_RESULT_RECEIVED', { success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result') });
  await append('evidence-inspection-001', 'EVIDENCE_RECORDED', { receipts: [proof('focused test output', 'evidence')] });
  await append('commit-inspection-001', 'GIT_OPERATION_COMPLETED', { operation: 'commit', commitSha: 'a'.repeat(40), clean: true, receipt: proof('signed git commit', 'commit') });
  await append('push-inspection-001', 'GIT_OPERATION_COMPLETED', { operation: 'push', success: true, receipt: proof('signed git push', 'push') });
  return append('pr-inspection-001', 'PULL_REQUEST_OPENED', { prNumber: 1300, prUrl: 'https://github.com/o/r/pull/1300', headSha: 'b'.repeat(40), mergeable: true, receipt: proof('pull request creation', 'pr') });
}

test('failed checks become repair state and start one bounded Codex round', async () => {
  const options = await runtime();
  const atChecks = await stateAtChecks(options);
  await publishMissionWorkerAction(atChecks.state, options);
  const processed = await processNextGitHubInspectionItem({ ...options, inspectGitHub: async () => ({ execution: { success: true, commandOutputHash: 'c'.repeat(64), completedAt: new Date().toISOString() }, inspection: { prNumber: 1300, headSha: 'b'.repeat(40), prState: 'open', mergeable: true, checks: [{ name: 'Build', status: 'failure', required: true }] } }) });
  assert.equal(processed.applied.state.currentPhase, 'REPAIR_REQUIRED');
  const repair = await publishMissionWorkerAction((await readMissionRecord('github-inspection-test', options)).state, options);
  assert.equal(repair.repairStarted, true);
  assert.equal(repair.adapter, 'codex');
  assert.equal(repair.action.repairRound, 1);
});
