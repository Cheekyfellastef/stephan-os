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

const OC1_HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const OC1_MISSION_ID = 'critical-1725-openclaw-oc1';
const OC1_TASK_ID = 'critical-1725-openclaw-oc1-r1-task';

function oc1Grant(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${OC1_TASK_ID}`,
    controllerId: 'durable-flywheel-controller',
    sourceRevision: OC1_HEAD,
    missionId: OC1_MISSION_ID,
    missionRevision: 1,
    currentPhase: 'LIVE_RUNTIME_INVESTIGATION',
    actionId: OC1_TASK_ID,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: '',
    issueNumber: 1725,
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'main',
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    ...overrides,
  };
}

function oc1GatewayResult(overrides = {}) {
  return {
    schemaVersion: 'stephanos.openclaw-oc1-gateway-result.v1',
    success: true,
    error: '',
    missionId: OC1_MISSION_ID,
    goalId: '#1725',
    taskId: OC1_TASK_ID,
    taskClass: 'OC1_REPOSITORY_SCOUT',
    repository: 'Cheekyfellastef/stephan-os',
    requestedSourceHead: OC1_HEAD,
    provider: 'openclaw-standalone',
    providerInstance: 'openclaw-gateway:4242',
    providerVersion: '1.0.0',
    executionSurface: 'openclaw-gateway-plugin',
    qualificationEligible: true,
    result: {
      success: true,
      error: '',
      resultId: OC1_TASK_ID,
      changedFiles: [],
      completedAt: '2026-08-19T18:30:00.000Z',
      receipt: {
        receiptId: 'openclaw-oc1-result-1234567890',
        requirement: 'provider-neutral OpenClaw OC1 result',
        source: 'openclaw-standalone-oc1',
        evidenceType: 'provider-neutral-task-result',
        verified: true,
        commandOutputHash: 'a'.repeat(64),
        createdAt: '2026-08-19T18:30:00.000Z',
      },
      evidenceReceipts: [{
        receiptId: 'openclaw-oc1-proof-1234567890',
        requirement: 'OpenClaw OC1 canonical claimed-task proof',
        source: 'openclaw-standalone-oc1',
        evidenceType: 'shared-workspace-proof',
        verified: true,
        sha256: 'b'.repeat(64),
        receiptPath: 'proofs/openclaw-oc1/example.json',
        createdAt: '2026-08-19T18:30:00.000Z',
      }],
    },
    ...overrides,
  };
}

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

test('OC1 qualifying work is sent through fixed OpenClaw Gateway RPC with grant-only params', async () => {
  const calls = [];
  const grant = oc1Grant();
  const result = await executeOpenClawReadonlyAction({
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    actionId: OC1_TASK_ID,
    missionId: OC1_MISSION_ID,
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
  }, { processingPath: 'C:/queue/processing/claim.json' }, {
    actionGrant: grant,
    runCommand: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0, stdout: JSON.stringify(oc1GatewayResult()), stderr: '' };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.resultId, OC1_TASK_ID);
  assert.deepEqual(result.changedFiles, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'openclaw.cmd');
  assert.deepEqual(calls[0].args.slice(0, 3), ['gateway', 'call', 'stephanos-builder-provider.oc1Qualification']);
  assert.equal(calls[0].args.includes('agent'), false);
  assert.equal(calls[0].args[calls[0].args.indexOf('--timeout') + 1], '120000');
  assert.equal(calls[0].args.includes('--json'), true);
  const params = JSON.parse(calls[0].args[calls[0].args.indexOf('--params') + 1]);
  assert.deepEqual(Object.keys(params).sort(), ['actionGrant', 'schemaVersion']);
  assert.deepEqual(params.actionGrant, grant);
  assert.equal(JSON.stringify(params).includes('processingPath'), false);
});

test('OC1 Gateway response with wrong exact source lineage fails closed', async () => {
  const result = await executeOpenClawReadonlyAction({
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    actionId: OC1_TASK_ID,
    missionId: OC1_MISSION_ID,
    repository: 'Cheekyfellastef/stephan-os',
  }, { processingPath: 'C:/queue/processing/claim.json' }, {
    actionGrant: oc1Grant(),
    runCommand: () => ({
      status: 0,
      stdout: JSON.stringify(oc1GatewayResult({ requestedSourceHead: '1'.repeat(40) })),
      stderr: '',
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC1_GATEWAY_RESULT_LINEAGE_INVALID');
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(result.evidenceReceipts, []);
});
