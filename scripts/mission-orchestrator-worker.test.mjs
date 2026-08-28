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
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from '../shared/agents/missionOrchestratorWorker.mjs';
import { readCurrentExecutionReceipt } from '../shared/agents/executionReceiptV1.mjs';
import {
  appendMissionEvent,
  createMissionRecord,
} from '../stephanos-server/services/missionOrchestratorStore.js';
import {
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
} from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import { processNextCodexItem } from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';

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

test('exact PR source dispatch claims lease, records execution lifecycle, and releases only after terminal receipt', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'source-lifecycle-'));
  const releaseCalls = [];
  const claimCalls = [];
  const options = {
    root: join(parent, 'state'),
    snapshotRoot: join(parent, 'proof'),
    queueRoot: join(parent, 'queue'),
    sharedWorkspaceRoot: join(parent, 'workspace'),
    testOnly: true,
    sourceExecutionDependencies: {
      async claimSourceMutationLease(input) {
        claimCalls.push(input);
        return {
          ok: true,
          claimed: true,
          record: {
            leaseId: input.leaseId,
            laneId: input.laneId,
            repository: input.repository,
            issueNumber: input.issueNumber,
            prNumber: input.prNumber,
            branch: input.branch,
            headSha: input.headSha,
            ownerId: input.ownerId,
          },
        };
      },
      async releaseSourceMutationLease(input) {
        releaseCalls.push(input);
        return { ok: true, released: true, reason: 'TEST_EXACT_LEASE_RELEASED' };
      },
    },
  };
  const missionId = 'goal-1497-pr-1617';
  const sourceProof = (requirement, receiptId) => ({
    receiptId,
    requirement,
    source: 'test',
    evidenceType: 'command-output',
    verified: true,
    exitCode: 0,
  });
  const intent = {
    missionId,
    operatorIntent: 'Repair one exact PR-backed source lane.',
    intendedOutcome: 'Prove lease-bound worker execution.',
    missionKind: 'implementation',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:\\repo',
    branch: 'openclaw/source-lifecycle',
    worktreePath: 'C:\\worktree',
    allowedFiles: ['shared/agents/**'],
    requiredEvidence: ['focused test output'],
    requiredTests: ['node --test focused.test.mjs'],
  };
  let current = await createMissionRecord(intent, options);
  const append = async (eventId, eventType, fields = {}) => {
    current = await appendMissionEvent(missionId, { eventId, eventType, ...fields }, options);
  };
  await append('source-worktree', 'WORKTREE_READY', {
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: sourceProof('isolated worktree', 'source-worktree'),
  });
  const initialAction = buildMissionWorkerAction(current.state, options);
  await append('source-dispatch', 'AGENT_DISPATCHED', {
    agentId: 'codex',
    adapter: 'codex',
    actionId: initialAction.actionId,
    workerId: initialAction.workerId,
  });
  await append('source-result', 'AGENT_RESULT_RECEIVED', {
    actionId: initialAction.actionId,
    workerId: initialAction.workerId,
    success: true,
    resultId: 'source-result',
    changedFiles: ['shared/agents/example.mjs'],
    receipt: sourceProof('codex result', 'source-result'),
  });
  await append('source-evidence', 'EVIDENCE_RECORDED', {
    receipts: [sourceProof('focused test output', 'source-focused')],
  });
  await append('source-commit', 'GIT_OPERATION_COMPLETED', {
    operation: 'commit',
    commitSha: '1'.repeat(40),
    clean: true,
    receipt: sourceProof('signed git commit', 'source-commit'),
  });
  await append('source-push', 'GIT_OPERATION_COMPLETED', {
    operation: 'push',
    success: true,
    receipt: sourceProof('signed git push', 'source-push'),
  });
  await append('source-pr', 'PULL_REQUEST_OPENED', {
    prNumber: 1617,
    prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1617',
    headSha: '2'.repeat(40),
    mergeable: true,
    receipt: sourceProof('pull request creation', 'source-pr'),
  });
  await append('source-checks', 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1617,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'Build Stephanos UI', status: 'failure', required: true }],
    receipt: sourceProof('pull request checks', 'source-checks'),
  });
  assert.equal(current.state.currentPhase, 'REPAIR_REQUIRED');

  const actionState = projectMissionWorkerActionState(current.state, options);
  const action = buildMissionWorkerAction(actionState, options);
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId,
    missionRevision: actionState.revision,
    currentPhase: actionState.currentPhase,
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: 'codex',
    operation: '',
    capacityRoute: action.capacityRoute,
    capacityReceiptId: action.capacityReceiptId,
    capacityProofRefs: action.capacityProofRefs,
    workerId: action.workerId,
    laneId: missionId,
    repository: intent.repository,
    issueNumber: 1497,
    prNumber: 1617,
    branch: intent.branch,
    headSha: '2'.repeat(40),
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const published = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(published.published, true);
  assert.equal(claimCalls.length, 1);
  assert.equal(releaseCalls.length, 0);
  const queued = await readMissionWorkerQueue(options);
  assert.equal(queued.length, 1);
  const binding = queued[0].item.sourceExecution;
  assert.equal(binding.prNumber, 1617);
  assert.equal(binding.headSha, '2'.repeat(40));
  const queuedReceipt = await readCurrentExecutionReceipt(options.sharedWorkspaceRoot, {
    executionId: binding.executionId,
    leaseKey: binding.leaseId,
    expectedHead: binding.headSha,
  });
  assert.equal(queuedReceipt.ok, true);
  assert.equal(queuedReceipt.receipt.state, 'queued');

  const processed = await processNextCodexItem({
    ...options,
    actionGrant: grant,
    executeCodexAction: async () => ({
      success: true,
      resultId: 'source-lifecycle-worker-result',
      changedFiles: ['shared/agents/example.mjs'],
      receipt: sourceProof('codex result', 'source-lifecycle-result'),
      evidenceReceipts: [sourceProof('focused test output', 'source-lifecycle-evidence')],
      completedAt: new Date().toISOString(),
    }),
  });
  assert.equal(processed.processed, true);
  assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE');
  const terminalReceipt = await readCurrentExecutionReceipt(options.sharedWorkspaceRoot, {
    executionId: binding.executionId,
    leaseKey: binding.leaseId,
    expectedHead: binding.headSha,
  });
  assert.equal(terminalReceipt.ok, true);
  assert.equal(terminalReceipt.receipt.state, 'completed');
  assert.equal(terminalReceipt.receipt.sequence, 4);
  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0].leaseId, binding.leaseId);
  assert.equal(releaseCalls[0].prNumber, binding.prNumber);
  assert.equal(releaseCalls[0].headSha, binding.headSha);
  assert.equal(releaseCalls[0].ownerId, binding.ownerId);
});
