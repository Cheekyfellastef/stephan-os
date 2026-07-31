import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  executeCodexAction,
  executeOpenClawReadonlyAction,
  parseBridgeOutput,
  parseCodexJsonLines,
  selectGrantedMissionWorkerQueueItem,
} from './mission-orchestrator-worker.mjs';

test('parses deterministic bridge and Codex JSONL output', () => {
  assert.equal(parseBridgeOutput('FINAL_VERDICT=PASS\n').FINAL_VERDICT, 'PASS');
  assert.deepEqual(parseCodexJsonLines('{"type":"thread.started"}\ndiagnostic\n'), [{ type: 'thread.started' }]);
});

test('one exact controller grant selects only its bound queue action', () => {
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: 'mission-two',
    actionId: 'mission-two-r4-action',
    actionKind: 'agent-handoff',
    adapter: 'codex',
    operation: '',
    boundedActionCount: 1,
  };
  const selected = selectGrantedMissionWorkerQueueItem([
    {
      adapter: 'openclaw-signed',
      item: {
        schemaVersion: 'stephanos.mission-worker-queue-item.v1',
        adapter: 'openclaw-signed',
        missionId: 'mission-one',
        actionId: 'mission-one-r1-action',
        payload: {
          missionId: 'mission-one',
          actionId: 'mission-one-r1-action',
          actionKind: 'signed-openclaw-operation',
        },
      },
    },
    {
      adapter: 'codex',
      item: {
        schemaVersion: 'stephanos.mission-worker-queue-item.v1',
        adapter: 'codex',
        missionId: 'mission-two',
        actionId: 'mission-two-r4-action',
        payload: {
          missionId: 'mission-two',
          actionId: 'mission-two-r4-action',
          actionKind: 'agent-handoff',
          adapter: 'codex',
        },
      },
    },
    {
      adapter: 'openclaw-readonly',
      item: {
        schemaVersion: 'stephanos.mission-worker-queue-item.v1',
        adapter: 'openclaw-readonly',
        missionId: 'mission-three',
        actionId: 'mission-three-r2-action',
        payload: {
          missionId: 'mission-three',
          actionId: 'mission-three-r2-action',
          actionKind: 'agent-handoff',
          adapter: 'openclaw-readonly',
        },
      },
    },
  ], grant);
  assert.equal(selected.ok, true);
  assert.equal(selected.entry.item.actionId, grant.actionId);

  const retargeted = selectGrantedMissionWorkerQueueItem([
    {
      adapter: 'codex',
      item: {
        schemaVersion: 'stephanos.mission-worker-queue-item.v1',
        adapter: 'codex',
        missionId: 'mission-two',
        actionId: 'different-action',
        payload: {
          missionId: 'mission-two',
          actionId: 'different-action',
          actionKind: 'agent-handoff',
          adapter: 'codex',
        },
      },
    },
  ], grant);
  assert.equal(retargeted.ok, false);
  assert.equal(retargeted.reason, 'exact-action-queue-item-not-pending');

  const validPayload = {
    missionId: grant.missionId,
    actionId: grant.actionId,
    actionKind: grant.actionKind,
    adapter: grant.adapter,
  };
  for (const payload of [
    { ...validPayload, missionId: 'mission-other' },
    { ...validPayload, actionId: 'action-other' },
    { ...validPayload, actionKind: 'github-inspection' },
    { ...validPayload, adapter: 'openclaw-readonly' },
    { ...validPayload, operation: 'check-pr' },
  ]) {
    const retargetedPayload = selectGrantedMissionWorkerQueueItem([
      {
        adapter: 'codex',
        item: {
          schemaVersion: 'stephanos.mission-worker-queue-item.v1',
          adapter: 'codex',
          missionId: grant.missionId,
          actionId: grant.actionId,
          payload,
        },
      },
    ], grant);
    assert.equal(retargetedPayload.ok, false);
    assert.equal(retargetedPayload.reason, 'exact-action-queue-payload-mismatch');
  }
});

test('executes Codex non-interactively and grounds approved source evidence', async () => {
  const worktreePath = await mkdtemp(join(tmpdir(), 'mission-codex-'));
  const claim = { processingPath: join(worktreePath, 'action.json') };
  const command = 'node --test focused.test.mjs';
  const result = await executeCodexAction({
    actionKind: 'agent-handoff', adapter: 'codex', actionId: 'codex-1', missionId: 'codex-test',
    worktreePath, allowedFiles: ['shared/agents/**'], requiredTests: [command], requiredEvidence: ['focused test output'],
  }, claim, {
    runCommand(executable, args) {
      if (executable === 'codex.exe') {
        writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ success: true, summary: 'done', evidence: [{ requirement: 'focused test output', command }] }));
        return { status: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n${JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command, status: 'completed', exit_code: 0 } })}\n`, stderr: '' };
      }
      if (args.includes('diff')) return { status: 0, stdout: 'shared/agents/example.mjs\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
  assert.match(result.evidenceReceipts[0].commandOutputHash, /^[a-f0-9]{64}$/);
});

test('OpenClaw remains read-only and only accepts existing Mission Runner proof', async () => {
  const missionRunnerRoot = await mkdtemp(join(tmpdir(), 'mission-openclaw-'));
  const proofRoot = join(missionRunnerRoot, 'proof', 'browser');
  await mkdir(proofRoot, { recursive: true });
  const proofPath = join(proofRoot, 'proof.json');
  await writeFile(proofPath, '{"pass":true}\n');
  const result = await executeOpenClawReadonlyAction({
    actionKind: 'agent-handoff', adapter: 'openclaw-readonly', actionId: 'openclaw-1', missionId: 'openclaw-test',
    repositoryRoot: missionRunnerRoot, requiredEvidence: ['browser proof'], browserProofRequired: true,
  }, { processingPath: join(missionRunnerRoot, 'action.json') }, {
    missionRunnerRoot,
    runCommand: () => ({ status: 0, stdout: JSON.stringify({ payloads: [{ text: JSON.stringify({ success: true, evidence: [{ requirement: 'browser proof', receiptPath: proofPath }] }) }], meta: { runId: 'run-1' } }), stderr: '' }),
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.evidenceReceipts[0].receiptPath, 'proof/browser/proof.json');
});
