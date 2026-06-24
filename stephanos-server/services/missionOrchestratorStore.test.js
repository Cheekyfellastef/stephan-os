import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendMissionEvent,
  createMissionRecord,
  listMissionRecords,
  readMissionRecord,
  resolveMissionOperationsSnapshotRoot,
  resolveMissionOrchestratorRoot,
} from './missionOrchestratorStore.js';

const base = {
  missionId: 'store-test-mission',
  operatorIntent: 'Implement and promote a bounded source change.',
  intendedOutcome: 'The change is merged and safely deployed.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\repo',
  branch: 'orchestrator/store-test-mission',
  worktreePath: 'C:\\worktrees\\store-test-mission',
  allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'],
  requiredTests: ['node --test focused.test.mjs'],
};

function proof(requirement, id) {
  return {
    receiptId: id,
    requirement,
    source: 'test-runner',
    evidenceType: 'command-output',
    verified: true,
    exitCode: 0,
  };
}

async function roots() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-orchestrator-store-'));
  return {
    root: join(parent, 'state'),
    snapshotRoot: join(parent, 'proof', 'mission-operations'),
  };
}

async function append(rootOptions, missionId, eventId, eventType, fields = {}) {
  return appendMissionEvent(missionId, { eventId, eventType, ...fields }, rootOptions);
}

test('default roots live outside the repository under the Mission Runner directory', () => {
  const env = { USERPROFILE: 'C:\\Users\\Operator' };
  assert.match(resolveMissionOrchestratorRoot(env).replace(/\\/g, '/'), /OpenClaw-Standalone\/mission-runner\/orchestrator$/);
  assert.match(resolveMissionOperationsSnapshotRoot(env).replace(/\\/g, '/'), /OpenClaw-Standalone\/mission-runner\/proof\/mission-operations$/);
});

test('creates, lists, reads, and publishes an external mission record', async () => {
  const options = await roots();
  const created = await createMissionRecord(base, options);
  assert.equal(created.state.missionId, base.missionId);
  assert.equal(created.state.currentPhase, 'CREATE_WORKTREE');
  assert.equal(created.snapshot.published, true);

  const listed = await listMissionRecords(options);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].missionId, base.missionId);

  const read = await readMissionRecord(base.missionId, options);
  assert.equal(read.state.schemaVersion, 'stephanos.mission-orchestrator.v1');

  const snapshot = JSON.parse(await readFile(created.snapshot.path, 'utf8'));
  assert.equal(snapshot.schemaVersion, 'stephanos.mission-operations-snapshot.v1');
  assert.equal(snapshot.currentPhase, 'CREATE_WORKTREE');
});

test('event ids are single-use and duplicate delivery does not change state revision', async () => {
  const options = await roots();
  await createMissionRecord({
    ...base,
    missionId: 'runtime-store-test',
    operatorIntent: 'Inspect the live browser runtime.',
    intendedOutcome: 'Browser proof is collected.',
    missionKind: 'live-runtime-investigation',
    branch: 'orchestrator/runtime-store-test',
    allowedFiles: [],
    requiredEvidence: ['browser proof'],
    requiredTests: [],
  }, options);

  const first = await append(options, 'runtime-store-test', 'dispatch-runtime-001', 'AGENT_DISPATCHED', {
    agentId: 'openclaw-standalone',
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.state.dispatch.status, 'running');

  const duplicate = await append(options, 'runtime-store-test', 'dispatch-runtime-001', 'AGENT_DISPATCHED', {
    agentId: 'openclaw-standalone',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, first.state.revision);
  assert.equal(duplicate.state.storeMetadata.processedEventIds.filter((id) => id === 'dispatch-runtime-001').length, 1);
});

test('verified runtime evidence advances to complete and updates the Mission Operations snapshot', async () => {
  const options = await roots();
  const created = await createMissionRecord({
    ...base,
    missionId: 'runtime-complete-test',
    operatorIntent: 'Inspect the live runtime and collect browser proof.',
    intendedOutcome: 'Browser proof is deterministically recorded.',
    missionKind: 'live-runtime-investigation',
    branch: 'orchestrator/runtime-complete-test',
    allowedFiles: [],
    requiredEvidence: ['browser proof'],
    requiredTests: [],
  }, options);
  await append(options, 'runtime-complete-test', 'dispatch-runtime-002', 'AGENT_DISPATCHED', {
    agentId: 'openclaw-standalone',
  });
  const completed = await append(options, 'runtime-complete-test', 'result-runtime-002', 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'browser-result',
    changedFiles: [],
    receipt: proof('browser proof', 'browser-proof-receipt'),
  });
  assert.equal(completed.state.currentPhase, 'COMPLETE');
  const snapshot = JSON.parse(await readFile(created.snapshot.path, 'utf8'));
  assert.equal(snapshot.state, 'COMPLETE');
  assert.equal(snapshot.currentPhase, 'COMPLETE');
});

test('approval event log redacts the raw token while state keeps only its hash', async () => {
  const options = await roots();
  await createMissionRecord(base, options);
  await append(options, base.missionId, 'worktree-ready-001', 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'worktree-proof'),
  });
  await append(options, base.missionId, 'codex-dispatch-001', 'AGENT_DISPATCHED', { agentId: 'codex' });
  await append(options, base.missionId, 'codex-result-001', 'AGENT_RESULT_RECEIVED', {
    success: true,
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('codex result', 'codex-proof'),
  });
  await append(options, base.missionId, 'evidence-001', 'EVIDENCE_RECORDED', {
    receipts: [proof('focused test output', 'test-proof')],
  });
  await append(options, base.missionId, 'commit-001', 'GIT_OPERATION_COMPLETED', {
    operation: 'commit',
    commitSha: '1'.repeat(40),
    clean: true,
    receipt: proof('signed commit', 'commit-proof'),
  });
  await append(options, base.missionId, 'push-001', 'GIT_OPERATION_COMPLETED', {
    operation: 'push',
    success: true,
    receipt: proof('signed push', 'push-proof'),
  });
  await append(options, base.missionId, 'pr-open-001', 'PULL_REQUEST_OPENED', {
    prNumber: 1301,
    prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1301',
    headSha: '2'.repeat(40),
    mergeable: true,
    receipt: proof('open pull request', 'pr-proof'),
  });
  await append(options, base.missionId, 'checks-001', 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1301,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'Build', status: 'success', required: true }],
    receipt: proof('pull request checks', 'checks-proof'),
  });

  const beforeApproval = await readMissionRecord(base.missionId, options);
  const approvalToken = beforeApproval.state.approval.requiredToken;
  const approved = await append(options, base.missionId, 'approval-001', 'OPERATOR_APPROVAL_RECORDED', {
    approvalToken,
  });
  assert.equal(approved.state.currentPhase, 'MERGE_PULL_REQUEST');
  assert.match(approved.state.approval.suppliedTokenHash, /^[a-f0-9]{64}$/);

  const eventLog = await readFile(approved.statePath.replace(/\.state\.json$/, '.events.ndjson'), 'utf8');
  assert.equal(eventLog.includes(approvalToken), false);
  assert.match(eventLog, /\[REDACTED\]/);
});
