import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent } from './missionOrchestratorStore.js';
import {
  approveBoundedMission,
  cancelBoundedMission,
  createBoundedMission,
  listBoundedMissions,
  readBoundedMission,
} from './missionOrchestratorControlService.js';

const intent = {
  missionId: 'control-service-test',
  operatorIntent: 'Implement a bounded source change and promote it safely.',
  intendedOutcome: 'The verified change reaches local runtime after exact approval.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\repo',
  worktreePath: 'C:\\worktrees\\control-service-test',
  allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'],
  requiredTests: ['node --test focused.test.mjs'],
};

function proof(requirement, id) {
  return { receiptId: id, requirement, source: 'test-runner', evidenceType: 'command-output', verified: true, exitCode: 0 };
}

async function roots() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-orchestrator-control-'));
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof', 'mission-operations') };
}

async function event(options, missionId, eventId, eventType, fields = {}) {
  return appendMissionEvent(missionId, { eventId, eventType, ...fields }, options);
}

async function advanceToApproval(options, missionId) {
  await event(options, missionId, 'worktree-control-001', 'WORKTREE_READY', { worktreePath: intent.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree-receipt') });
  await event(options, missionId, 'dispatch-control-001', 'AGENT_DISPATCHED', { agentId: 'codex', actionId: 'codex-control-action', workerId: 'codex' });
  await event(options, missionId, 'result-control-001', 'AGENT_RESULT_RECEIVED', { actionId: 'codex-control-action', workerId: 'codex', success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'codex-receipt') });
  await event(options, missionId, 'evidence-control-001', 'EVIDENCE_RECORDED', { receipts: [proof('focused test output', 'focused-test-receipt')] });
  await event(options, missionId, 'commit-control-001', 'GIT_OPERATION_COMPLETED', { operation: 'commit', commitSha: '1'.repeat(40), clean: true, receipt: proof('signed commit', 'commit-receipt') });
  await event(options, missionId, 'push-control-001', 'GIT_OPERATION_COMPLETED', { operation: 'push', success: true, receipt: proof('signed push', 'push-receipt') });
  await event(options, missionId, 'pr-control-001', 'PULL_REQUEST_OPENED', { prNumber: 1302, prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1302', headSha: '2'.repeat(40), mergeable: true, receipt: proof('open pull request', 'pr-receipt') });
  await event(options, missionId, 'checks-control-001', 'PULL_REQUEST_CHECKS_UPDATED', { prNumber: 1302, headSha: '2'.repeat(40), prState: 'open', mergeable: true, checks: [{ name: 'Build', status: 'success', required: true }], receipt: proof('pull request checks', 'checks-receipt') });
}

test('bounded control creates an executor-compatible branch, lists, and reads missions without accepting arbitrary state', async () => {
  const options = await roots();
  const created = await createBoundedMission({ ...intent, ignoredStateOverride: { currentPhase: 'COMPLETE' } }, options);
  assert.equal(created.state.currentPhase, 'CREATE_WORKTREE');
  assert.equal(created.state.git.branch, 'openclaw/control-service-test');
  assert.equal(Object.hasOwn(created.state, 'ignoredStateOverride'), false);
  assert.equal((await listBoundedMissions(options)).length, 1);
  assert.equal((await readBoundedMission(intent.missionId, options)).state.missionId, intent.missionId);
});

test('exact approval command advances once and the same command is retry-safe', async () => {
  const options = await roots();
  await createBoundedMission(intent, options);
  await advanceToApproval(options, intent.missionId);
  const ready = await readBoundedMission(intent.missionId, options);
  const command = { missionId: intent.missionId, commandId: 'operator-command-001', approvalToken: ready.state.approval.requiredToken };
  const approved = await approveBoundedMission(command, options);
  assert.equal(approved.state.currentPhase, 'MERGE_PULL_REQUEST');
  assert.equal((await approveBoundedMission(command, options)).duplicate, true);
});

test('incorrect approval is rejected before an event is appended', async () => {
  const options = await roots();
  await createBoundedMission(intent, options);
  await advanceToApproval(options, intent.missionId);
  await assert.rejects(() => approveBoundedMission({ missionId: intent.missionId, commandId: 'operator-command-002', approvalToken: 'APPROVE_OPENCLAW_SQUASH_MERGE:1302:stale' }, options), /does not match/);
  assert.equal((await readBoundedMission(intent.missionId, options)).state.currentPhase, 'AWAITING_OPERATOR_APPROVAL');
});

test('cancel retries are idempotent while a new terminal cancellation is rejected', async () => {
  const options = await roots();
  await createBoundedMission(intent, options);
  const command = { missionId: intent.missionId, commandId: 'operator-cancel-001', reason: 'Operator stopped the mission.' };
  const cancelled = await cancelBoundedMission(command, options);
  assert.equal(cancelled.state.currentPhase, 'CANCELLED');
  assert.equal((await cancelBoundedMission(command, options)).duplicate, true);
  await assert.rejects(() => cancelBoundedMission({ missionId: intent.missionId, commandId: 'operator-cancel-002' }, options), /terminal mission/i);
});
