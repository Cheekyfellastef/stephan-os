import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord, runWithMissionStatePrecondition } from './missionOrchestratorStore.js';
import {
  buildMissionWorkerAction,
  missionWorkerActionGrantsMatchV1,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  collectAgentWorkerResult,
  publishMissionWorkerAction,
  replacementSourceForgePublicationBlocked,
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';
import * as workerConsumer from './missionOrchestratorWorkerConsumer.js';
import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import { exactElasticExternalGrant } from './criticalBacklogConveyorServiceCore.js';
import { createExactWorkerActionGrant } from '../../shared/agents/durableFlywheelControllerVNext.mjs';
import { buildEngineeringIncidentMethodRecordV1 } from '../../shared/agents/engineeringIncidentMethodMemoryV1.mjs';
import { SHARED_WORKSPACE_RECORD_KINDS, createSharedWorkspaceProofRecord, writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { runMissionWorkerTick, selectGrantedMissionWorkerQueueItem } from '../../scripts/mission-orchestrator-worker.mjs';
import { runSupervisedMissionWorker } from '../../scripts/mission-orchestrator-worker-supervised.mjs';
import { readMissionWorkerActiveClaim } from '../../scripts/mission-orchestrator-worker-heartbeat-active-claim.mjs';
import { resolveCanonicalMissionWorkerPaths, writeMissionWorkerHeartbeat } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import { projectNarrowedMissionSourceScopeV1 } from '../../shared/agents/missionOrchestrator.mjs';
import { CODEX_TASK_CLASS } from '../../shared/agents/codexCapacityGovernorV1.mjs';
import { appendExecutionReceipt, createExecutionReceipt } from '../../shared/agents/executionReceiptV1.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA, FORGE_LIFEBOAT_WORKER_ID, MISSION_CONTROLLER_ROUTE,
  projectMissionControllerTaskV1, forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';

const intent = {
  missionId: 'worker-service-test', operatorIntent: 'Implement a bounded source change.', intendedOutcome: 'Deliver grounded evidence.',
  missionKind: 'implementation', repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\repo', branch: 'openclaw/worker-service-test',
  worktreePath: 'C:\\worktree', allowedFiles: ['shared/agents/**'], requiredEvidence: ['focused test output'], requiredTests: ['node --test focused.test.mjs'],
};
const proof = (requirement, receiptId) => ({ receiptId, requirement, source: 'test', evidenceType: 'command-output', verified: true, exitCode: 0 });

function freshCodexCapacityRouting() {
  const now = new Date();
  return {
    nowUtc: now.toISOString(),
    codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1',
      statusId: 'codex-capacity-current',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      observedAtUtc: new Date(now.getTime() - 1000).toISOString(),
      remainingPercent: 90,
      availability: 'AVAILABLE',
      confidence: 'high',
      naturalResetAtUtc: '',
    },
    githubLaneReceipt: null,
    forgeLaneReceipt: null,
    forgeSidecar: null,
  };
}
async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-worker-service-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), sharedWorkspaceRoot: join(parent, 'workspace'), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function exactCapacityGrant(state, { adapter, route, workerId, receiptId, proofRefs = [] }) {
  const draft = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId: state.missionId,
    missionRevision: state.revision,
    currentPhase: state.currentPhase,
    adapter,
    workerId,
    capacityRoute: route,
    capacityReceiptId: receiptId,
    capacityProofRefs: proofRefs,
    repository: state.repository,
    branch: state.git.branch,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const action = buildMissionWorkerAction(state, { actionGrant: draft });
  return {
    action,
    grant: {
      ...draft,
      actionId: action.actionId,
      actionKind: action.actionKind,
      operation: action.operation || '',
    },
  };
}

test('queue root defaults below Mission Runner orchestrator state', () => {
  assert.match(resolveMissionWorkerQueueRoot({ USERPROFILE: 'C:\\Users\\Operator' }).replace(/\\/g, '/'), /mission-runner\/orchestrator\/worker-queue$/);
});

test('publishes worktree then one Codex dispatch and collects grounded result', async () => {
  const options = await runtime();
  options.capacityRouting = freshCodexCapacityRouting();
  const created = await createMissionRecord(intent, options);
  assert.equal((await publishMissionWorkerAction(created.state, options)).adapter, 'openclaw-signed');
  const ready = await appendMissionEvent(intent.missionId, { eventId: 'worktree-1', eventType: 'WORKTREE_READY', worktreePath: intent.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree') }, options);
  const dispatch = await publishMissionWorkerAction(ready.state, options);
  assert.equal(dispatch.adapter, 'codex');
  assert.equal((await readMissionWorkerQueue(options)).some((entry) => entry.adapter === 'codex'), true);
  assert.equal((await readMissionRecord(intent.missionId, options)).state.dispatch.status, 'pending');
  const claim = await claimNextMissionWorkerItem('codex', options);
  assert.ok(claim);
  assert.equal(claim.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.equal((await readMissionRecord(intent.missionId, options)).state.dispatch.status, 'running');
  const collected = await collectAgentWorkerResult({ missionId: intent.missionId, actionId: dispatch.action.actionId, adapter: 'codex', success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result'), evidenceReceipts: [proof('focused test output', 'evidence')] }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal((await readMissionRecord(intent.missionId, options)).state.dispatch.status, 'complete');
});

test('publishes one exact external fallback handoff and accepts its grounded result', async () => {
  const options = await runtime();
  const missionId = 'github-fallback-test';
  const created = await createMissionRecord({
    ...intent,
    missionId,
    branch: 'openclaw/github-fallback-test',
  }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: 'github-fallback-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'github-fallback-worktree-proof'),
  }, options);
  const capacityRouting = {
    nowUtc: new Date().toISOString(),
    codexStatus: null,
    githubLaneReceipt: {
      schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
      receiptId: 'github-fallback-capacity-receipt',
      route: 'CHATGPT_GITHUB',
      repository: intent.repository,
      workerId: 'shared-fabric-chatgpt-github-builder-01',
      state: 'READY',
      supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
      supportedTaskClasses: ['FOCUSED_REPAIR'],
      observedAtUtc: new Date(Date.now() - 1000).toISOString(),
      expiresAtUtc: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      queueDepth: 0,
      p95StartLatencySeconds: 10,
      authorityReceiptIds: [],
      proofRefs: ['receipts/github-builder/capacity.json'],
    },
  };
  const action = buildMissionWorkerAction(ready.state, { ...options, capacityRouting });
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId,
    missionRevision: ready.state.revision,
    currentPhase: ready.state.currentPhase,
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: action.adapter,
    operation: '',
    capacityRoute: action.capacityRoute,
    capacityReceiptId: action.capacityReceiptId,
    capacityProofRefs: action.capacityProofRefs,
    repository: ready.state.repository,
    branch: ready.state.git.branch,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const dispatch = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, 'chatgpt-github');
  assert.equal(dispatch.action.capacityReceiptId, 'github-fallback-capacity-receipt');
  assert.equal(dispatch.fabricPublication.ok, true);
  assert.equal(dispatch.handoffResponsibility.state, 'PICKUP_PENDING');
  assert.equal(dispatch.handoffResponsibility.pickupProofRequired, true);
  assert.equal(dispatch.handoffResponsibility.responsibilityRetained, true);
  assert.equal(dispatch.handoffResponsibility.publicationIsTerminal, false);
  assert.equal(dispatch.handoffResponsibility.retryOrEscalateUntilPickup, true);
  assert.deepEqual((await readMissionWorkerQueue(options)).map(({ adapter }) => adapter), ['chatgpt-github']);
  assert.equal((await readMissionRecord(missionId, options)).state.dispatch.status, 'pending');
  const pickup = await claimNextMissionWorkerItem('chatgpt-github', options);
  assert.ok(pickup);
  assert.equal(pickup.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.equal((await readMissionRecord(missionId, options)).state.dispatch.status, 'running');
  const collected = await collectAgentWorkerResult({
    missionId,
    actionId: action.actionId,
    adapter: 'chatgpt-github',
    success: true,
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('github builder result', 'github-builder-result'),
    evidenceReceipts: [proof('focused test output', 'github-builder-evidence')],
  }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal(collected.state.dispatch.adapter, 'chatgpt-github');
});

test('Stephanos can load one exact scheduler-approved goal into a Desktop Commander lane', async () => {
  const options = await runtime();
  const missionId = 'desktop-commander-fallback-test';
  await createMissionRecord({
    ...intent,
    missionId,
    branch: 'openclaw/desktop-commander-fallback-test',
  }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: 'desktop-commander-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'desktop-commander-worktree-proof'),
  }, options);
  const now = Date.now();
  const capacityRouting = {
    nowUtc: new Date(now).toISOString(),
    sourceHead: 'a'.repeat(40),
    codexStatus: null,
    desktopCommanderLaneReceipt: {
      schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
      receiptId: 'desktop-commander-capacity-receipt',
      route: 'DESKTOP_COMMANDER',
      repository: intent.repository,
      sourceHead: 'a'.repeat(40),
      workerId: 'desktop-commander-battle-bridge-01',
      state: 'READY',
      supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
      supportedTaskClasses: ['FOCUSED_REPAIR'],
      observedAtUtc: new Date(now - 1000).toISOString(),
      expiresAtUtc: new Date(now + 10 * 60 * 1000).toISOString(),
      queueDepth: 0,
      p95StartLatencySeconds: 5,
      authorityReceiptIds: [],
      proofRefs: ['receipts/desktop-commander/capacity.json'],
    },
  };
  const action = buildMissionWorkerAction(ready.state, { ...options, capacityRouting });
  assert.equal(action.adapter, 'desktop-commander');
  assert.equal(action.capacityRoute, 'DESKTOP_COMMANDER');
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId,
    missionRevision: ready.state.revision,
    currentPhase: ready.state.currentPhase,
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: action.adapter,
    operation: '',
    capacityRoute: action.capacityRoute,
    capacityReceiptId: action.capacityReceiptId,
    capacityProofRefs: action.capacityProofRefs,
    repository: ready.state.repository,
    branch: ready.state.git.branch,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const dispatch = await publishNextMissionWorkerAction({ ...options, capacityRouting, actionGrant: grant });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, 'desktop-commander');
  assert.equal(dispatch.fabricPublication.ok, true);
  const handoffRecord = JSON.parse(await readFile(dispatch.fabricPublication.path, 'utf8'));
  const handoffBody = JSON.parse(handoffRecord.body);
  assert.equal(handoffBody.executionCommand.surface, 'DESKTOP_COMMANDER');
  assert.equal(handoffBody.executionCommand.scope, 'WHOLE_PC');
  assert.equal(handoffBody.executionCommand.dispatchAllowed, true);
  const queued = await readMissionWorkerQueue(options);
  assert.deepEqual(queued.map(({ adapter }) => adapter), ['desktop-commander']);
  assert.equal(queued[0].item.actionGrant.adapter, 'desktop-commander');
  assert.equal(queued[0].item.executionBinding.executionId, action.actionId);
  assert.equal((await readMissionRecord(missionId, options)).state.dispatch.status, 'pending');
  const pickup = await claimNextMissionWorkerItem('desktop-commander', options);
  assert.ok(pickup);
  assert.equal(pickup.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.equal((await readMissionRecord(missionId, options)).state.dispatch.status, 'running');
  const collected = await collectAgentWorkerResult({
    missionId,
    actionId: action.actionId,
    adapter: 'desktop-commander',
    success: true,
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('desktop commander result', 'desktop-commander-result'),
    evidenceReceipts: [proof('focused test output', 'desktop-commander-evidence')],
  }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal(collected.state.dispatch.adapter, 'desktop-commander');
});

test('OpenClaw Standalone handoff is a distinct whole-PC command surface', async () => {
  const options = await runtime();
  const missionId = 'openclaw-standalone-command-fabric-test';
  await createMissionRecord({ ...intent, missionId, branch: 'openclaw/openclaw-standalone-command-fabric-test' }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: 'openclaw-standalone-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'openclaw-standalone-worktree-proof'),
  }, options);
  const { grant } = exactCapacityGrant(ready.state, {
    adapter: 'openclaw-standalone',
    route: 'OPENCLAW_STANDALONE',
    workerId: 'openclaw-standalone',
    receiptId: 'openclaw-standalone-capacity',
    proofRefs: ['receipts/openclaw-standalone/capacity.json'],
  });
  const dispatch = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, 'openclaw-standalone');
  const handoffRecord = JSON.parse(await readFile(dispatch.fabricPublication.path, 'utf8'));
  const handoffBody = JSON.parse(handoffRecord.body);
  assert.equal(handoffRecord.toParticipantId, 'openclaw-standalone');
  assert.equal(handoffBody.executionCommand.surface, 'OPENCLAW_STANDALONE');
  assert.equal(handoffBody.executionCommand.scope, 'WHOLE_PC');
  assert.equal(handoffBody.executionCommand.dispatchAllowed, true);
});

test('OpenClaw Local handoff is independently selectable for a Stephanos-scoped worktree', async () => {
  const base = await runtime();
  const options = {
    ...base,
    env: { USERPROFILE: 'C:\\Users\\Operator' },
  };
  const missionId = 'openclaw-local-command-fabric-test';
  const worktreePath = 'C:\\Users\\Operator\\Stephanos\\openclaw-local-command-fabric-test';
  await createMissionRecord({
    ...intent,
    missionId,
    branch: 'openclaw/openclaw-local-command-fabric-test',
    worktreePath,
  }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: 'openclaw-local-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'openclaw-local-worktree-proof'),
  }, options);
  const { grant } = exactCapacityGrant(ready.state, {
    adapter: 'openclaw-local',
    route: 'OPENCLAW_LOCAL',
    workerId: 'stephanos-scout-coder',
    receiptId: 'openclaw-local-capacity',
    proofRefs: ['receipts/openclaw-local/capacity.json'],
  });
  const dispatch = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, 'openclaw-local');
  assert.equal(dispatch.fabricPublication.ok, true);
  const handoffRecord = JSON.parse(await readFile(dispatch.fabricPublication.path, 'utf8'));
  const handoffBody = JSON.parse(handoffRecord.body);
  assert.equal(handoffRecord.toParticipantId, 'stephanos-scout-coder');
  assert.equal(handoffBody.executionCommand.surface, 'OPENCLAW_LOCAL');
  assert.equal(handoffBody.executionCommand.scope, 'STEPHANOS_ONLY');
  assert.equal(handoffBody.executionCommand.dispatchAllowed, true);
  assert.deepEqual((await readMissionWorkerQueue(options)).map(({ adapter }) => adapter), ['openclaw-local']);
});

test('OpenClaw Local handoff fails closed when its target is outside Stephanos', async () => {
  const options = await runtime();
  const missionId = 'openclaw-local-scope-block-test';
  await createMissionRecord({ ...intent, missionId, branch: 'openclaw/openclaw-local-scope-block-test' }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: 'openclaw-local-worktree',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'openclaw-local-worktree-proof'),
  }, options);
  const { grant } = exactCapacityGrant(ready.state, {
    adapter: 'openclaw-local',
    route: 'OPENCLAW_LOCAL',
    workerId: 'stephanos-scout-coder',
    receiptId: 'openclaw-local-capacity',
    proofRefs: ['receipts/openclaw-local/capacity.json'],
  });
  const dispatch = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(dispatch.published, false);
  assert.equal(dispatch.reason, 'shared-workspace-handoff:EXECUTION_COMMAND_SCOPE_BLOCKED');
  assert.equal(dispatch.fabricPublication.executionCommand.surface, 'OPENCLAW_LOCAL');
  assert.equal(dispatch.fabricPublication.executionCommand.scope, 'STEPHANOS_ONLY');
  assert.equal(dispatch.fabricPublication.executionCommand.dispatchAllowed, false);
  assert.deepEqual(await readMissionWorkerQueue(options), []);
});

test('publisher rejects a stale mission revision before signing or queueing', async () => {
  const options = await runtime();
  const missionId = 'stale-publish-test';
  const created = await createMissionRecord({
    ...intent,
    missionId,
    branch: 'openclaw/stale-publish-test',
  }, options);
  await appendMissionEvent(missionId, {
    eventId: 'stale-worktree-ready',
    eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'stale-worktree-proof'),
  }, options);

  const stale = await publishMissionWorkerAction(created.state, options);
  assert.equal(stale.published, false);
  assert.equal(stale.reason, 'mission-state-precondition-failed');
  assert.deepEqual(await readMissionWorkerQueue(options), []);
});

test('publisher rejects retargeting and publishes only the exact granted mission action', async () => {
  const options = await runtime();
  const first = await createMissionRecord({ ...intent, missionId: 'grant-first', branch: 'openclaw/grant-first' }, options);
  const second = await createMissionRecord({ ...intent, missionId: 'grant-second', branch: 'openclaw/grant-second' }, options);
  const action = buildMissionWorkerAction(second.state, options);
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: 'a'.repeat(40),
    boundedActionCount: 1,
    missionId: second.state.missionId,
    missionRevision: second.state.revision,
    currentPhase: second.state.currentPhase,
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: 'openclaw-signed',
    operation: action.operation,
    repository: second.state.repository,
    branch: second.state.git.branch,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const targetRetargeted = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: {
      ...grant,
      repository: 'trusted/repository',
      branch: 'openclaw/trusted-target',
    },
  });
  assert.equal(targetRetargeted.published, false);
  assert.equal(targetRetargeted.reason, 'action-grant-mismatch');
  assert.equal(targetRetargeted.blockers.includes('action-grant-repository-mismatch'), true);
  assert.equal(targetRetargeted.blockers.includes('action-grant-branch-mismatch'), true);
  assert.deepEqual(await readMissionWorkerQueue(options), []);

  const published = await publishNextMissionWorkerAction({ ...options, actionGrant: grant });
  assert.equal(published.published, true);
  assert.equal(published.action.missionId, second.state.missionId);
  assert.equal(published.actionGrantAccepted, true);
  const queued = await readMissionWorkerQueue(options);
  assert.deepEqual(queued.map(({ item }) => item.missionId), [second.state.missionId]);

  const retargeted = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: { ...grant, actionId: buildMissionWorkerAction(first.state, options).actionId },
  });
  assert.equal(retargeted.published, false);
  assert.equal(retargeted.reason, 'action-grant-mismatch');
});

test('repair transition is projected, granted, applied, and queued as one exact post-repair action', async () => {
  const options = await runtime();
  options.capacityRouting = freshCodexCapacityRouting();
  const missionId = 'goal-1497-pr-1617';
  let current = await createMissionRecord({
    ...intent,
    missionId,
    branch: 'openclaw/grant-repair',
  }, options);
  const append = async (eventId, eventType, fields = {}) => {
    current = await appendMissionEvent(missionId, {
      eventId,
      eventType,
      ...fields,
    }, options);
  };
  await append('repair-worktree', 'WORKTREE_READY', {
    worktreePath: intent.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'repair-worktree'),
  });
  await append('repair-dispatch', 'AGENT_DISPATCHED', { agentId: 'codex' });
  await append('repair-result', 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'repair-result',
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('codex result', 'repair-result'),
  });
  await append('repair-evidence', 'EVIDENCE_RECORDED', {
    receipts: [proof('focused test output', 'repair-focused')],
  });
  await append('repair-commit', 'GIT_OPERATION_COMPLETED', {
    operation: 'commit',
    commitSha: '1'.repeat(40),
    clean: true,
    receipt: proof('signed git commit', 'repair-commit'),
  });
  await append('repair-push', 'GIT_OPERATION_COMPLETED', {
    operation: 'push',
    success: true,
    receipt: proof('signed git push', 'repair-push'),
  });
  await append('repair-pr', 'PULL_REQUEST_OPENED', {
    prNumber: 1617,
    prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1617',
    headSha: '2'.repeat(40),
    mergeable: true,
    receipt: proof('pull request creation', 'repair-pr'),
  });
  await append('repair-checks', 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1617,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'Build Stephanos UI', status: 'failure', required: true }],
    receipt: proof('pull request checks', 'repair-checks'),
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
    laneId: missionId,
    repository: actionState.repository,
    issueNumber: 1497,
    prNumber: 1617,
    branch: actionState.git.branch,
    headSha: '2'.repeat(40),
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const beforeRejectedGrant = await readMissionRecord(missionId, options);
  const rejected = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: { ...grant, actionId: `${grant.actionId}-retargeted` },
  });
  assert.equal(rejected.published, false);
  assert.equal(rejected.reason, 'action-grant-mismatch');
  const afterRejectedGrant = await readMissionRecord(missionId, options);
  assert.equal(afterRejectedGrant.state.currentPhase, 'REPAIR_REQUIRED');
  assert.equal(afterRejectedGrant.state.revision, beforeRejectedGrant.state.revision);

  const laneRetargeted = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: { ...grant, laneId: 'goal-1497-pr-9999' },
  });
  assert.equal(laneRetargeted.published, false);
  assert.equal(laneRetargeted.reason, 'action-grant-mismatch');
  assert.equal(laneRetargeted.blockers.includes('action-grant-lane-mismatch'), true);
  assert.equal(laneRetargeted.blockers.includes('action-grant-lane-pr-mismatch'), true);

  for (const [field, value, blocker] of [
    ['issueNumber', 9999, 'action-grant-issue-mismatch'],
    ['prNumber', 9999, 'action-grant-pr-mismatch'],
    ['headSha', '3'.repeat(40), 'action-grant-head-mismatch'],
  ]) {
    const retargeted = await publishNextMissionWorkerAction({
      ...options,
      actionGrant: { ...grant, [field]: value },
    });
    assert.equal(retargeted.published, false);
    assert.equal(retargeted.reason, 'action-grant-mismatch');
    assert.equal(retargeted.blockers.includes(blocker), true);
  }

  for (const [field, blocker] of [
    ['laneId', 'action-grant-lane-binding-missing'],
    ['issueNumber', 'action-grant-issue-binding-missing'],
    ['prNumber', 'action-grant-pr-binding-missing'],
    ['headSha', 'action-grant-head-binding-missing'],
  ]) {
    const incomplete = await publishNextMissionWorkerAction({
      ...options,
      actionGrant: { ...grant, [field]: null },
    });
    assert.equal(incomplete.published, false);
    assert.equal(incomplete.reason, 'action-grant-mismatch');
    assert.equal(incomplete.blockers.includes(blocker), true);
  }
  assert.deepEqual(await readMissionWorkerQueue(options), []);

  const published = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: grant,
  });
  assert.equal(published.published, true);
  assert.equal(published.repairStarted, true);
  assert.equal(published.action.actionId, grant.actionId);
  const durable = await readMissionRecord(missionId, options);
  assert.equal(durable.state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(durable.state.revision, grant.missionRevision);
  assert.equal(durable.state.dispatch.status, 'pending');
  const queued = await readMissionWorkerQueue(options);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].item.payload.actionId, grant.actionId);

  const claimed = await claimNextMissionWorkerItem('codex', { ...options, actionGrant: grant });
  assert.ok(claimed);
  assert.equal(claimed.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  const afterClaim = await readMissionRecord(missionId, options);
  assert.equal(afterClaim.state.revision, grant.missionRevision + 1);
  assert.equal(afterClaim.state.dispatch.status, 'running');
  assert.equal(afterClaim.state.dispatch.adapter, 'codex');
});

test('replacement-source repair fences Forge at queue publication before claiming a worker',async()=>{
 const state={missionId:'critical-1717-elastic-goal',currentPhase:'AGENT_IMPLEMENTATION',
   dispatch:{adapter:'foundry-forge',status:'pending'},continuity:{history:[
     {eventType:'MISSION_REPAIR_PROVEN',receiptId:'verified-replacement-repair-e64fab30f247e954e06dbc73'}]}};
 assert.equal(replacementSourceForgePublicationBlocked(state),true);
 const result=await publishMissionWorkerAction(state,{});
 assert.equal(result.published,false);
 assert.equal(result.reason,'replacement-source-already-merged-forge-publication-fenced');
 assert.equal(replacementSourceForgePublicationBlocked({...state,missionId:'critical-1723-elastic-goal'}),false);
 assert.equal(replacementSourceForgePublicationBlocked({...state,continuity:{history:[]}}),false);
});

test('completed source result replays only missing evidence after interrupted queue acknowledgement', async () => {
  const options = await runtime();
  const missionId = 'source-result-replay-proof';
  const receipt = proof('codex result', 'replay-source-result-receipt');
  await createMissionRecord({
    ...intent, missionId, branch: 'openclaw/source-result-replay-proof',
  }, options);
  await appendMissionEvent(missionId, {
    eventId: 'replay-worktree', eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath, clean: true,
    receipt: proof('isolated worktree', 'replay-worktree-receipt'),
  }, options);
  await appendMissionEvent(missionId, {
    eventId: 'replay-dispatch', eventType: 'AGENT_DISPATCHED',
    agentId: 'codex', adapter: 'codex',
  }, options);
  const result = {
    missionId, actionId: 'replay-source-action', adapter: 'codex', success: true,
    resultId: 'replay-source-action', changedFiles: ['shared/agents/example.mjs'],
    receipt, evidenceReceipts: [proof('focused test output', 'replay-test-evidence')],
  };
  const first = await appendMissionEvent(missionId, {
    eventId: 'result-replay-source-action', eventType: 'AGENT_RESULT_RECEIVED',
    success: true, resultId: result.resultId,
    changedFiles: result.changedFiles, receipt,
  }, options);
  assert.equal(first.state.currentPhase, 'VERIFYING');
  assert.equal(first.state.dispatch.status, 'complete');
  assert.equal(first.state.evidenceReceipts.some((item) =>
    item.receiptId === 'replay-test-evidence'), false);
  const recovered = await collectAgentWorkerResult(result, options);
  assert.equal(recovered.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal(recovered.state.evidenceReceipts.some((item) =>
    item.receiptId === 'replay-test-evidence'), true);
  const again = await collectAgentWorkerResult(result, options);
  assert.equal(again.state.revision, recovered.state.revision);
  assert.equal(again.duplicate, true);
  const stored = (await readMissionRecord(missionId, options)).state;
  assert.equal(stored.storeMetadata.processedEventIds.filter((id) =>
    id === 'result-replay-source-action').length, 1);
  await assert.rejects(() => collectAgentWorkerResult({
    ...result, actionId: 'another-action', resultId: 'another-action',
  }, options), /no active agent dispatch/);
  await assert.rejects(() => collectAgentWorkerResult({
    ...result, changedFiles: ['shared/agents/unauthorized.mjs'],
  }, options), /no active agent dispatch/);
  await assert.rejects(() => collectAgentWorkerResult({
    ...result, receipt: proof('codex result', 'forged-receipt'),
  }, options), /no active agent dispatch/);
});

test('result custody is rechecked before both mission events with safe exact-result replay', async () => {
  for (const expireOn of [1, 2, 3, 4]) {
    const options = await runtime(); options.capacityRouting = freshCodexCapacityRouting();
    const created = await createMissionRecord(intent, options);
    await publishMissionWorkerAction(created.state, options);
    const ready = await appendMissionEvent(intent.missionId, { eventId: 'custody-worktree', eventType: 'WORKTREE_READY',
      worktreePath: intent.worktreePath, clean: true, receipt: proof('isolated worktree', 'custody-worktree') }, options);
    const dispatch = await publishMissionWorkerAction(ready.state, options);
    assert.ok(await claimNextMissionWorkerItem('codex', options));
    const result = { missionId: intent.missionId, actionId: dispatch.action.actionId, adapter: 'codex', success: true,
      changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'custody-result'),
      evidenceReceipts: [proof('focused test output', 'custody-evidence')] };
    const before = (await readMissionRecord(intent.missionId, options)).state;
    let samples = 0;
    await assert.rejects(collectAgentWorkerResult(result, { ...options,
      assertResultCustody: () => { if (++samples === expireOn) throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN'); },
    }), /MISSION_WORKER_CUSTODY_UNPROVEN/);
    const held = (await readMissionRecord(intent.missionId, options)).state;
    assert.equal(samples, expireOn);
    assert.equal(held.evidenceReceipts.some(r => r.receiptId === 'custody-evidence'), false);
    if (expireOn <= 2) assert.equal(held.revision, before.revision);
    const resumed = await collectAgentWorkerResult(result, options);
    assert.equal(resumed.state.currentPhase, 'GITHUB_COMMIT');
    assert.equal(resumed.state.storeMetadata.processedEventIds.filter(id => id === `result-${dispatch.action.actionId}`).length, 1);
  }
});

test('failed result replay is atomically identity-bound and never recollects or changes a failure', async () => {
  const options = await runtime(); options.capacityRouting = freshCodexCapacityRouting();
  const created = await createMissionRecord(intent, options);
  await publishMissionWorkerAction(created.state, options);
  const ready = await appendMissionEvent(intent.missionId, { eventId: 'failed-replay-worktree', eventType: 'WORKTREE_READY',
    worktreePath: intent.worktreePath, clean: true, receipt: proof('isolated worktree', 'failed-replay-worktree') }, options);
  const dispatch = await publishMissionWorkerAction(ready.state, options);
  assert.ok(await claimNextMissionWorkerItem('codex', options));
  const result = { missionId: intent.missionId, actionId: dispatch.action.actionId, adapter: 'codex', success: false,
    resultId: 'failed-replay-result', changedFiles: [], error: 'bounded execution failed', evidenceReceipts: [] };
  const failed = await collectAgentWorkerResult(result, options);
  assert.equal(failed.state.dispatch.status, 'failed');
  const stored = await readMissionRecord(intent.missionId, options);
  assert.match(stored.state.storeMetadata.lastFailedWorkerResultIdentityV1, /^[a-f0-9]{64}$/);
  for (const alteration of [ {actionId:'different-action'}, {adapter:'chatgpt-github'}, {resultId:'different-result'},
    {error:'different error'}, {success:true}, {changedFiles:['shared/agents/other.mjs']},
    {receipt:{receiptId:'foreign'}}, {sourceArtifactEscrow:{foreign:true}},
    {offlinePublicationOutbox:{foreign:true}}, {evidenceReceipts:[proof('unrelated','unrelated')]},
  ]) await assert.rejects(collectAgentWorkerResult({...result,...alteration}, options));
  await assert.rejects(collectAgentWorkerResult(result, { ...options,
    assertResultCustody: () => { throw new Error('MISSION_WORKER_CUSTODY_UNPROVEN'); },
  }), /MISSION_WORKER_CUSTODY_UNPROVEN/);
  const unbound = structuredClone(stored.state); delete unbound.storeMetadata.lastFailedWorkerResultIdentityV1;
  await writeFile(stored.statePath, JSON.stringify(unbound));
  await assert.rejects(collectAgentWorkerResult(result, options));
  await writeFile(stored.statePath, JSON.stringify(stored.state));
  const replay = await collectAgentWorkerResult(result, options);
  assert.equal(replay.duplicate, true); assert.equal(replay.state.revision, failed.state.revision);
  const current = await readMissionRecord(intent.missionId, options);
  assert.equal(current.state.revision, failed.state.revision);
  assert.equal(current.state.storeMetadata.processedEventIds.filter(id => id === `result-${dispatch.action.actionId}`).length, 1);
});


test('result custody receives original and own-result states at each locked event commit', async () => {
  const options=await runtime();options.capacityRouting=freshCodexCapacityRouting();
  const created=await createMissionRecord(intent,options);
  await publishMissionWorkerAction(created.state,options);
  const ready=await appendMissionEvent(intent.missionId,{eventId:'state-callback-worktree',eventType:'WORKTREE_READY',
    worktreePath:intent.worktreePath,clean:true,receipt:proof('isolated worktree','state-callback-worktree')},options);
  const dispatch=await publishMissionWorkerAction(ready.state,options);
  assert.ok(await claimNextMissionWorkerItem('codex',options));
  const original=(await readMissionRecord(intent.missionId,options)).state;
  const samples=[];
  const result={missionId:intent.missionId,actionId:dispatch.action.actionId,adapter:'codex',success:true,
    resultId:dispatch.action.actionId,changedFiles:['shared/agents/example.mjs'],
    receipt:proof('codex result','state-callback-result'),
    evidenceReceipts:[proof('focused test output','state-callback-evidence')]};
  const collected=await collectAgentWorkerResult(result,{...options,assertResultCustody:(state,event)=>{
    assert.equal(state.missionId,intent.missionId);
    samples.push({revision:state.revision,status:state.dispatch.status,event:event.eventType});
  }});
  assert.deepEqual(samples,[
    {revision:original.revision,status:'running',event:'AGENT_RESULT_RECEIVED'},
    {revision:original.revision,status:'running',event:'AGENT_RESULT_RECEIVED'},
    {revision:original.revision+1,status:'complete',event:'EVIDENCE_RECORDED'},
    {revision:original.revision+1,status:'complete',event:'EVIDENCE_RECORDED'},
  ]);
  assert.equal(collected.state.revision,original.revision+2);
});

const capacityEnvelopeSha = bytes => createHash('sha256').update(bytes).digest('hex');

function capacityLesson() {
  return { kind: SHARED_WORKSPACE_RECORD_KINDS.LESSON,
    engineeringRecord: buildEngineeringIncidentMethodRecordV1({
      recordKey: 'bounded-source-grant-continuity', recordClass: 'SUCCESSFUL_REPAIR',
      problemClass: 'bounded-source-repair',
      componentAndOwnerRefs: ['shared/agents/capacity-contract.mjs'],
      observedAtUtc: '2026-10-30T13:00:00.000Z',
      sourceHead: 'a'.repeat(40), sourceBase: 'b'.repeat(40),
      symptom: 'Equivalent source grants diverged after handoff.',
      rootCause: 'Different producers reconstructed advisory memory independently.',
      repairOrMethod: 'Preserve the single admitted memory context across exact-grant handoff.',
      prerequisites: ['exact-source-grant'], forbiddenShortcuts: ['do-not-drop-admitted-context'],
      failureModes: ['grant-context-drift'], counterexamples: ['equal-authority-different-memory'],
      testAndProofRefs: ['test:grant-composition'], runtimeEvidenceRefs: [],
      confidenceBasis: 'Bounded source regression fixture.', freshness: 'CURRENT',
      supersedes: null, supersededBy: null, applicableDomains: ['software-engineering'],
      privacyAndSensitivity: 'PUBLIC_ENGINEERING', status: 'CURRENT',
    }) };
}

async function pendingCapacityFixture(t, { firstProducer = 'elastic', engineeringLessonRecords = [] } = {}) {
  const options = { ...await runtime(), env: {}, now: new Date('2026-10-30T14:00:00.000Z') };
  t.after(() => rm(dirname(options.root), { recursive: true, force: true }));
  options.repoRoot = join(dirname(options.root), 'repo');
  const missionId = 'critical-1557-elastic-goal';
  const worktreePath = join(dirname(options.root), 'bounded-worktree');
  const created = await createMissionRecord({ ...intent, missionId,
    repositoryRoot: options.repoRoot, branch: 'openclaw/elastic-goal-1557', worktreePath,
    allowedFiles: ['shared/agents/capacity-contract.mjs'],
    requiredTests: ['node --test shared/agents/capacity-contract.test.mjs'],
  }, options);
  const ready = await appendMissionEvent(missionId, { eventId: 'capacity-refresh-worktree',
    eventType: 'WORKTREE_READY', worktreePath, clean: true,
    receipt: proof('isolated worktree', 'capacity-refresh-worktree-proof') }, options);
  const state = ready.state;
  const sourceHead = 'a'.repeat(40);
  const grant = (receiptId, producer = 'controller', projection = {}) => {
    const candidate = { route: 'FOUNDRY_FORGE', adapter: 'foundry-forge',
      workerId: 'stephanos-forge-lifeboat-local', receiptId,
      proofRefs: [forgeLifeboatProofRef(sourceHead)] };
    const receipt = { schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
      route: candidate.route, workerId: candidate.workerId, receiptId,
      proofRefs: candidate.proofRefs, repository: state.repository, state: 'READY',
      supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
      supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
      observedAtUtc: '2026-10-30T13:59:00.000Z', expiresAtUtc: '2026-10-30T14:14:00.000Z',
      queueDepth: 0, p95StartLatencySeconds: 3,
      authorityReceiptIds: [forgeLifeboatAuthorityReceiptId(sourceHead)] };
    const result = producer === 'elastic'
      ? exactElasticExternalGrant(state, candidate, sourceHead, options.now)
      : createExactWorkerActionGrant({ observedAtUtc: options.now.toISOString(),
        engineeringLessonRecords, ...projection,
        criticalBacklog: { activeMission: state } }, sourceHead,
      { nowUtc: options.now.toISOString(), sourceHead, forgeLaneReceipt: receipt }, () => [candidate]);
    assert.ok(missionWorkerActionGrantsMatchV1(result, result), 'actual factory must emit a complete canonical grant');
    return result;
  };
  const firstGrant = grant('capacity-original', firstProducer);
  const first = await publishMissionWorkerAction(state, { ...options, actionGrant: firstGrant });
  assert.equal(first.published, true, JSON.stringify(first));
  // The archive must preserve historical bytes, including formatting, exactly.
  const originalItem = JSON.parse(await readFile(first.path));
  const originalBytes = Buffer.from(`${JSON.stringify(originalItem, null, 1)}\n\n`);
  await writeFile(first.path, originalBytes);
  const publish = actionGrant => publishMissionWorkerAction(state, { ...options, actionGrant });
  const claim = (actionGrant, additions = {}) => claimNextMissionWorkerItem('foundry-forge', {
    ...options, actionGrant,
    assertPendingClaimContract: item => {
      if (!missionWorkerActionGrantsMatchV1(item.actionGrant, actionGrant)) {
        throw new Error('NATIVE_SOURCE_PENDING_GRANT_CONTRACT_CHANGED');
      }
    }, ...additions,
  });
  const historyPath = join(options.queueRoot, 'foundry-forge', 'capacity-admissions', firstGrant.actionId);
  return { options, state, grant, firstGrant, first, originalItem, originalBytes, publish, claim, historyPath };
}

test('real producer handoff retains the admitted context when later controller memory differs', async t => {
  const f = await pendingCapacityFixture(t);
  const later = f.grant('capacity-original', 'controller', { engineeringLessonRecords: [capacityLesson()] });
  assert.equal(f.firstGrant.engineeringMemoryPack, null);
  assert.ok(later.engineeringMemoryPack);
  assert.equal(missionWorkerActionGrantsMatchV1(f.firstGrant, later), false);
  const admitted = await f.publish(later);
  assert.equal(admitted.published, true, JSON.stringify(admitted));
  assert.equal(admitted.queueItemRefreshed, false);
  assert.deepEqual(admitted.publishedActionGrant, f.firstGrant);
  assert.deepEqual(await readFile(f.first.path), f.originalBytes);
  assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, f.state.revision);
  await assert.rejects(f.claim(later), /NATIVE_SOURCE_PENDING_GRANT_CONTRACT_CHANGED/);
  const claimed = await f.claim(admitted.publishedActionGrant);
  assert.equal(claimed.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.deepEqual(claimed.item.actionGrant, f.firstGrant);
});

test('a later observation cannot replace or drop the original nonnull engineering memory pack', async t => {
  const f = await pendingCapacityFixture(t, {
    firstProducer: 'controller', engineeringLessonRecords: [capacityLesson()],
  });
  const later = f.grant('capacity-original', 'controller', { observedAtUtc: '2026-10-30T14:01:00.000Z' });
  assert.ok(f.firstGrant.engineeringMemoryPack);
  assert.notEqual(later.engineeringMemoryPackId, f.firstGrant.engineeringMemoryPackId);
  const admitted = await f.publish(later);
  assert.equal(admitted.published, true, JSON.stringify(admitted));
  assert.deepEqual(admitted.publishedActionGrant, f.firstGrant);
  const noLessons = f.grant('capacity-original', 'elastic');
  assert.equal(noLessons.engineeringMemoryPack, null);
  const retained = await f.publish(noLessons);
  assert.equal(retained.published, true, JSON.stringify(retained));
  assert.deepEqual(retained.publishedActionGrant, f.firstGrant);
  assert.deepEqual(await readFile(f.first.path), f.originalBytes);
  await assert.rejects(f.claim(later), /NATIVE_SOURCE_PENDING_GRANT_CONTRACT_CHANGED/);
  await assert.rejects(f.claim(noLessons), /NATIVE_SOURCE_PENDING_GRANT_CONTRACT_CHANGED/);
  assert.deepEqual((await f.claim(retained.publishedActionGrant)).item.actionGrant.engineeringMemoryPack,
    f.firstGrant.engineeringMemoryPack);
});

test('capacity renewal journals only the receipt change while retaining original nonnull memory', async t => {
  const f = await pendingCapacityFixture(t, {
    firstProducer: 'controller', engineeringLessonRecords: [capacityLesson()],
  });
  const fresh = f.grant('capacity-renewed', 'controller', { observedAtUtc: '2026-10-30T14:01:00.000Z' });
  assert.notEqual(fresh.engineeringMemoryPackId, f.firstGrant.engineeringMemoryPackId);
  const admitted = await f.publish(fresh);
  assert.equal(admitted.published, true, JSON.stringify(admitted));
  assert.equal(admitted.queueItemRefreshed, true);
  const expected = { ...fresh, engineeringMemoryPack: f.firstGrant.engineeringMemoryPack,
    engineeringMemoryPackId: f.firstGrant.engineeringMemoryPackId };
  assert.deepEqual(admitted.publishedActionGrant, expected);
  const currentBytes = await readFile(f.first.path);
  const journal = JSON.parse(await readFile(join(f.historyPath, '00000001.json')));
  assert.equal(journal.previousEnvelopeSha256, capacityEnvelopeSha(f.originalBytes));
  assert.equal(journal.admittedEnvelopeSha256, capacityEnvelopeSha(currentBytes));
  assert.deepEqual(await readFile(join(f.historyPath, 'envelopes', `${capacityEnvelopeSha(f.originalBytes)}.json`)), f.originalBytes);
  assert.deepEqual((await f.publish(f.firstGrant)).blockers, ['MISSION_WORKER_PENDING_CAPACITY_RECEIPT_REPLAY']);
  await assert.rejects(f.claim(fresh), /MISSION_WORKER_PENDING_CAPACITY_GRANT_MISMATCH/);
  assert.deepEqual((await f.claim(expected)).item.actionGrant, expected);
});

test('the real worker tick carries the published grant to native preflight without losing admitted memory', async t => {
  for (const firstProducer of ['elastic', 'controller']) await t.test(firstProducer, async t => {
    const f = await pendingCapacityFixture(t, { firstProducer, engineeringLessonRecords: [capacityLesson()] });
    const fresh = f.grant('capacity-renewed', 'controller', { observedAtUtc: '2026-10-30T14:01:00.000Z' });
    assert.notEqual(fresh.engineeringMemoryPackId, f.firstGrant.engineeringMemoryPackId);
    const result = await runMissionWorkerTick({ ...f.options, actionGrant: fresh,
      runCommand: () => { throw new Error('Fixture must never launch any command.'); } });
    assert.equal(result.publish.published, true, JSON.stringify(result));
    assert.deepEqual(result.actionGrant, { ...fresh,
      engineeringMemoryPack: f.firstGrant.engineeringMemoryPack,
      engineeringMemoryPackId: f.firstGrant.engineeringMemoryPackId });
    assert.equal(result.processed.processed, false);
    // env:{} deliberately holds before qualification, claim, model or native execution.
    assert.equal(result.processed.reason, 'native-capacity-gaming-workspace-unproved');
    assert.deepEqual(JSON.parse(await readFile(f.first.path)).actionGrant, result.actionGrant);
    assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, f.state.revision);
  });
});

test('real producer, supervisor, worker, claim and heartbeat retain the original grant before native transport', async t => {
  for (const firstProducer of ['elastic', 'controller']) await t.test(firstProducer, async t => {
    const f = await pendingCapacityFixture(t, { firstProducer, engineeringLessonRecords: [capacityLesson()] });
    const controllerGrant = f.grant('capacity-renewed', 'controller', { observedAtUtc: '2026-10-30T14:01:00.000Z' });
    const originalControllerJson = JSON.stringify(controllerGrant);
    const expected = { ...controllerGrant, engineeringMemoryPack: f.firstGrant.engineeringMemoryPack,
      engineeringMemoryPackId: f.firstGrant.engineeringMemoryPackId };
    assert.equal(missionWorkerActionGrantsMatchV1(controllerGrant, expected), false);
    const paths = { repositoryRoot: f.options.repoRoot, workspaceRoot: f.options.sharedWorkspaceRoot,
      heartbeatPath: join(f.options.sharedWorkspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json') };
    const launchId = 'b'.repeat(64), launchPath = join(paths.workspaceRoot, 'status',
      `mission-orchestrator-worker-launch-identity-${launchId}.json`);
    await mkdir(dirname(launchPath), { recursive: true });
    await writeFile(launchPath, JSON.stringify({
      schemaVersion: 'stephanos.mission-worker-launch-identity.v1', launchIdentityId: launchId,
      launchKind: 'ordinary', restartInvocationId: '', taskName: 'Stephanos Mission Orchestrator Worker',
      repositoryRoot: paths.repositoryRoot, branch: 'main', headSha: controllerGrant.sourceRevision,
      workerPid: process.pid, workerStartedAtUtc: '2026-10-30T13:58:00.000Z',
      canonicalNode: 'C:\\Program Files\\nodejs\\node.exe',
      canonicalWorkerScript: join(paths.repositoryRoot, 'scripts', 'mission-orchestrator-worker-supervised.mjs'),
      createdAtUtc: '2026-10-30T13:59:00.000Z',
    }));
    const env = { STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: paths.repositoryRoot,
      STEPHANOS_MISSION_WORKER_HEAD_SHA: controllerGrant.sourceRevision,
      STEPHANOS_MISSION_WORKER_BRANCH: 'main' };
    const readActive = input => readMissionWorkerActiveClaim({ ...input, queueRoot: f.options.queueRoot });
    let nativeEntries = 0, tickResult, register;
    const dependencies = {
      Buffer, JSON, process, AbortController, setInterval, clearInterval, createHash, randomUUID,
      resolve, relative, join, homedir,
      text: (value, fallback = '') => value === null || value === undefined ? fallback : String(value).trim() || fallback,
      missionWorkerActionGrantsMatchV1, ...workerConsumer, readMissionRecord, runWithMissionStatePrecondition,
      lstatSync: fs.lstatSync, openSync: fs.openSync, fstatSync: fs.fstatSync,
      readSync: fs.readSync, closeSync: fs.closeSync, readFileSync: fs.readFileSync,
      FORGE_LIFEBOAT_WORKER_ID, MISSION_CONTROLLER_ROUTE, CODEX_TASK_CLASS,
      projectMissionControllerTaskV1, projectNarrowedMissionSourceScopeV1,
      createSharedWorkspaceProofRecord, writeAtomicJson,
      selectGrantedMissionWorkerQueueItem, resolveCanonicalMissionWorkerPaths,
      publishNextMissionWorkerAction, readMissionWorkerQueue,
      inspectStephanosNativeCapacityGamingAdmissionV1: () => ({ ok: true }),
      inspectFixedRuntimeQualificationV1: () => ({ ok: true, sourceHead: controllerGrant.sourceRevision,
        profiles: ['SOURCE_TASK_V1'], custodyRecordSha256: 'c'.repeat(64), nativeRecordId: 26 }),
      executeFixedSourceTaskRuntimeV1: async () => {
        nativeEntries++;
        const processingPath = join(f.options.queueRoot, 'foundry-forge', 'processing', `${expected.actionId}.json`);
        const processingBytes = await readFile(processingPath);
        assert.deepEqual(JSON.parse(processingBytes).actionGrant, expected);
        const heartbeat = JSON.parse(await readFile(paths.heartbeatPath));
        assert.equal(heartbeat.activeTaskId, expected.actionId);
        assert.equal(heartbeat.activeReceiptId, `claim:${capacityEnvelopeSha(processingBytes)}`);
        assert.equal(heartbeat.executionPhase, 'processing:foundry-forge');
        assert.equal(heartbeat.lastTickVerdict, 'MISSION_WORKER_TICK_RUNNING');
        assert.equal(await register(expected), false, 'registration cannot be repeated after custody');
        return { ok: false, taskExecuted: false, reason: 'FIXTURE_NATIVE_TRANSPORT_HELD' };
      },
      consumeFixedRuntimeCompletionV1: () => null,
      consumeFixedRuntimePrelaunchExclusionV1: () => false,
    };
    // Execute the actual worker/native-parent bodies with only native admission
    // and transport isolated. All grant publication, stores, claims, receipts,
    // supervisor callbacks, active-claim inspection and heartbeat writes are real.
    const source = await readFile(new URL('../../scripts/mission-orchestrator-worker.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('function fixedSourceGrantClass(');
    const end = source.indexOf('\nasync function main()', start);
    assert.ok(start >= 0 && end > start);
    const executable = source.slice(start, end).replace('export async function runMissionWorkerTick(', 'async function runMissionWorkerTick(');
    const actualTick = new Function(...Object.keys(dependencies), `"use strict";\n${executable}\nreturn runMissionWorkerTick;`)(...Object.values(dependencies));
    const exitCode = await runSupervisedMissionWorker({ argv: ['--once'], env,
      stdout: { write() {} }, stderr: { write() {} },
      bootstrapMailbox: async () => ({ ok: true }), listMissionState: async () => [],
      inspectRepositoryIdentity: async () => ({ valid: true, canonical: true, branch: 'main',
        headSha: controllerGrant.sourceRevision, sourceClean: true, worktreeClean: true }),
      runControllerCycle: async () => ({ status: 'ACTIVE', allowWorkerTick: true,
        authoritativeProjection: { status: 'ACTIVE' }, workerActionGrant: controllerGrant }),
      loadCapacityRoutingInput: async () => null,
      runTick: async options => {
        register = options.acceptPublishedActionGrant;
        assert.equal(register({ ...expected, sourceRevision: 'd'.repeat(40) }), false);
        assert.equal(register({ ...expected, providerRouteIntent: 'OPENCLAW_ONLY' }), false);
        assert.equal(register({ ...expected, engineeringMemoryPack: { packId: 'forged' }, engineeringMemoryPackId: 'forged' }), false);
        tickResult = await actualTick({ ...f.options, ...options,
          acceptPublishedActionGrant: grant => {
            const accepted = register(grant);
            assert.equal(accepted, true);
            assert.equal(register(grant), false, 'registration is single use even before claim');
            return accepted;
          }, runCommand: () => { throw new Error('Fixture must never launch a command.'); } });
        return tickResult;
      },
      readActiveClaim: readActive,
      writeHeartbeat: input => writeMissionWorkerHeartbeat({ ...input, paths, expectedPaths: paths,
        repositoryRoot: paths.repositoryRoot, branch: 'main', headSha: controllerGrant.sourceRevision,
        launchIdentityId: launchId, launchReceiptPath: launchPath, activeClaimReader: readActive }),
      setIntervalFn: () => 1, clearIntervalFn() {}, activeClaimProbeIntervalMs: 1,
      now: () => f.options.now.toISOString(),
    });
    assert.equal(exitCode, 1, 'an isolated held transport is not material source success');
    assert.equal(nativeEntries, 1, JSON.stringify(tickResult));
    assert.equal(tickResult.processed.reason, 'NATIVE_SOURCE_CUSTODY_UNPROVEN');
    assert.deepEqual(tickResult.actionGrant, expected);
    assert.equal(JSON.stringify(controllerGrant), originalControllerJson);
    assert.equal(register(expected), false, 'a settled invocation cannot register another grant');
    assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, f.state.revision + 1);
  });
});

test('real non-capacity investigation grants keep their existing publication and worker path', async t => {
  const options = { ...await runtime(), env: {}, sourceRevision: 'a'.repeat(40) };
  t.after(() => rm(dirname(options.root), { recursive: true, force: true }));
  options.repoRoot = join(dirname(options.root), 'repo');
  await mkdir(options.repoRoot, { recursive: true });
  await mkdir(options.sharedWorkspaceRoot, { recursive: true });
  const created = await createMissionRecord({ missionId: 'critical-1557-readonly-grant-review',
    operatorIntent: 'Read-only fixture inspection', intendedOutcome: 'Report a bounded observation',
    missionKind: 'live-runtime-investigation', repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: options.repoRoot, branch: 'openclaw/readonly-grant-review', worktreePath: options.repoRoot,
    allowedFiles: [], requiredEvidence: ['focused evidence'], requiredTests: [], browserProofRequired: false,
  }, options);
  const actionGrant = createExactWorkerActionGrant({ observedAtUtc: new Date().toISOString(),
    criticalBacklog: { activeMission: created.state } }, options.sourceRevision);
  assert.equal(actionGrant.adapter, 'openclaw-readonly');
  assert.equal(actionGrant.capacityRoute, '');
  assert.equal(missionWorkerActionGrantsMatchV1(actionGrant, actionGrant), false);
  const result = await runMissionWorkerTick({ ...options, actionGrant,
    runCommand: () => ({ status: 1, stdout: '', stderr: 'Isolated fixture refusal; no command executed.' }) });
  assert.equal(result.publish.published, true);
  assert.equal(result.publish.publishedActionGrant, null);
  assert.equal(result.processed.processed, true, JSON.stringify(result));
  assert.notEqual(result.processed.reason, 'published-action-grant-unproven');
});

test('supervisor refuses first canonical registration after custody observation or controller mutation', async t => {
  for (const mode of ['custody-observed', 'controller-mutated']) await t.test(mode, async t => {
    const f = await pendingCapacityFixture(t);
    const actionGrant = structuredClone(f.firstGrant);
    let custodyObserved;
    const custody = new Promise(resolve => { custodyObserved = resolve; });
    if (mode === 'custody-observed') await f.claim(f.firstGrant);
    await runSupervisedMissionWorker({ argv: ['--once'],
      env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: actionGrant.sourceRevision },
      stdout: { write() {} }, stderr: { write() {} }, bootstrapMailbox: async () => ({ ok: true }),
      listMissionState: async () => [],
      inspectRepositoryIdentity: async () => ({ valid: true, canonical: true, branch: 'main',
        headSha: actionGrant.sourceRevision, sourceClean: true, worktreeClean: true }),
      runControllerCycle: async () => ({ allowWorkerTick: true, workerActionGrant: actionGrant }),
      loadCapacityRoutingInput: async () => null,
      runTick: async options => {
        if (mode === 'custody-observed') await custody;
        else actionGrant.providerRouteIntent = 'OPENCLAW_ONLY';
        assert.equal(options.acceptPublishedActionGrant(f.firstGrant), false);
        return { processed: { processed: false, reason: 'fixture-held' } };
      },
      readActiveClaim: input => readMissionWorkerActiveClaim({ ...input, queueRoot: f.options.queueRoot }),
      writeHeartbeat: async input => {
        const active = await readMissionWorkerActiveClaim({ actionGrant: input.activeActionGrant, queueRoot: f.options.queueRoot });
        if (active) custodyObserved();
        return { ok: true, record: { ...active, lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING' } };
      },
      setIntervalFn: () => 1, clearIntervalFn() {}, activeClaimProbeIntervalMs: 1,
    });
    const record = await readMissionRecord(f.state.missionId, f.options);
    assert.equal(record.state.revision, f.state.revision + (mode === 'custody-observed' ? 1 : 0));
  });
});

test('real producer grants refresh pending capacity without changing mission, lease or immutable history', async t => {
  const f = await pendingCapacityFixture(t);
  const fresh = f.grant('capacity-refreshed');
  assert.equal(fresh.actionId, f.firstGrant.actionId);
  const admitted = await f.publish(fresh);
  assert.equal(admitted.published, true, JSON.stringify(admitted));
  assert.equal(admitted.reason, 'pending-capacity-readmitted');
  assert.equal(admitted.queueItemRefreshed, true);
  const current = JSON.parse(await readFile(f.first.path));
  assert.ok(missionWorkerActionGrantsMatchV1(current.actionGrant, fresh));
  assert.deepEqual(current.executionBinding, f.originalItem.executionBinding);
  assert.deepEqual(current.handoffResponsibility, f.originalItem.handoffResponsibility);
  const originalHash = capacityEnvelopeSha(f.originalBytes);
  assert.deepEqual(await readFile(join(f.historyPath, 'envelopes', `${originalHash}.json`)), f.originalBytes);
  const journal = JSON.parse(await readFile(join(f.historyPath, '00000001.json')));
  assert.equal(journal.previousEnvelopeSha256, originalHash);
  assert.equal(journal.admittedEnvelopeSha256, capacityEnvelopeSha(await readFile(f.first.path)));
  assert.equal(journal.missionId, f.state.missionId);
  assert.equal(journal.missionRevision, f.state.revision);
  assert.equal(journal.claimReleaseAuthority, false);
  const pending = (await readMissionRecord(f.state.missionId, f.options)).state;
  assert.equal(pending.revision, f.state.revision); assert.equal(pending.dispatch.status, 'pending');
  await assert.rejects(f.claim(f.firstGrant), /MISSION_WORKER_PENDING_CAPACITY_GRANT_MISMATCH/);
  // The general consumer must enforce this even without a fixed-worker callback.
  await assert.rejects(claimNextMissionWorkerItem('foundry-forge', {
    ...f.options, actionGrant: f.firstGrant,
  }), /MISSION_WORKER_PENDING_CAPACITY_GRANT_MISMATCH/);
  await assert.rejects(claimNextMissionWorkerItem('foundry-forge', f.options),
    /MISSION_WORKER_PENDING_CAPACITY_GRANT_MISMATCH/);
  const claim = await f.claim(fresh);
  assert.equal(claim.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.ok(missionWorkerActionGrantsMatchV1(claim.item.actionGrant, fresh));
  const running = (await readMissionRecord(f.state.missionId, f.options)).state;
  assert.equal(running.revision, f.state.revision + 1); assert.equal(running.dispatch.status, 'running');
});

test('repeated capacity admission is idempotent and no superseded receipt can return', async t => {
  const f = await pendingCapacityFixture(t);
  const second = f.grant('capacity-second'), third = f.grant('capacity-third');
  await f.publish(second);
  const secondBytes = await readFile(f.first.path);
  const firstJournal = await readFile(join(f.historyPath, '00000001.json'));
  const replay = await f.publish(second);
  assert.equal(replay.published, true); assert.equal(replay.queueItemRefreshed, false);
  assert.deepEqual(await readFile(f.first.path), secondBytes);
  assert.deepEqual(await readFile(join(f.historyPath, '00000001.json')), firstJournal);
  assert.equal((await f.publish(third)).queueItemRefreshed, true);
  const thirdBytes = await readFile(f.first.path);
  for (const stale of [f.firstGrant, second, { ...second, capacityProofRefs: ['proofs/changed-under-old-receipt'] }]) {
    const refused = await f.publish(stale);
    assert.equal(refused.published, false);
    assert.deepEqual(refused.blockers, ['MISSION_WORKER_PENDING_CAPACITY_RECEIPT_REPLAY']);
    assert.deepEqual(await readFile(f.first.path), thirdBytes);
  }
  const secondJournal = JSON.parse(await readFile(join(f.historyPath, '00000002.json')));
  assert.equal(secondJournal.predecessorSha256, capacityEnvelopeSha(firstJournal));
  assert.deepEqual((await readdir(f.historyPath)).sort(), ['00000001.json', '00000002.json', 'envelopes']);
});

test('capacity refresh cannot alter source, worker, route, intent, memory, scope or negative authority', async t => {
  const f = await pendingCapacityFixture(t);
  const fresh = f.grant('capacity-refreshed');
  for (const alteration of [
    { sourceRevision: 'b'.repeat(40) }, { workerId: 'another-worker' }, { capacityRoute: 'CHATGPT_GITHUB' },
    { providerRouteIntent: 'OPENCLAW_ONLY' }, { engineeringMemoryPack: { packId: 'foreign' }, engineeringMemoryPackId: 'foreign' },
    { mergeAuthority: true }, { leaseSeizureAllowed: true }, { capacityProofRefs: [] },
    { newAuthority: true }, { capacityReceiptId: f.firstGrant.capacityReceiptId, capacityProofRefs: ['proofs/changed'] },
  ]) {
    const refused = await f.publish({ ...fresh, ...alteration });
    assert.equal(refused.published, false, JSON.stringify(alteration));
    assert.deepEqual(await readFile(f.first.path), f.originalBytes);
  }
  const record = await readMissionRecord(f.state.missionId, f.options);
  await writeFile(record.statePath, JSON.stringify({ ...record.state, allowedFiles: ['shared/agents/foreign-scope.mjs'] }));
  const changedScope = await f.publish(fresh);
  assert.equal(changedScope.published, false);
  assert.deepEqual(changedScope.blockers, ['MISSION_WORKER_PENDING_CAPACITY_CONTRACT_CHANGED']);
  assert.deepEqual(await readFile(f.first.path), f.originalBytes);
});

test('optional null memory compatibility does not rewrite an otherwise exact pending grant', async t => {
  const f = await pendingCapacityFixture(t);
  const legacy = JSON.parse(f.originalBytes);
  delete legacy.actionGrant.engineeringMemoryPack;
  delete legacy.actionGrant.engineeringMemoryPackId;
  const legacyBytes = Buffer.from(JSON.stringify(legacy));
  await writeFile(f.first.path, legacyBytes);
  const repeated = await f.publish(f.firstGrant);
  assert.equal(repeated.published, true); assert.equal(repeated.queueItemRefreshed, false);
  assert.deepEqual(await readFile(f.first.path), legacyBytes);
  const fresh = f.grant('capacity-refreshed');
  const renewed = await f.publish(fresh);
  assert.equal(renewed.queueItemRefreshed, true);
  assert.deepEqual(await readFile(join(f.historyPath, 'envelopes', `${capacityEnvelopeSha(legacyBytes)}.json`)), legacyBytes);
  assert.ok(await f.claim(fresh));
});

test('pending capacity admission preserves and refuses any original mission processing owner', async t => {
  const f = await pendingCapacityFixture(t);
  const processing = join(f.options.queueRoot, 'sovereign-commander', 'processing');
  await mkdir(processing, { recursive: true });
  const originalClaimPath = join(processing, `${f.state.missionId}-r0-original-unknown.json`);
  const originalClaim = Buffer.from(JSON.stringify({ ...f.originalItem,
    actionId: `${f.state.missionId}-r0-original-unknown`, historicalExecutionOutcome: 'UNKNOWN' }));
  await writeFile(originalClaimPath, originalClaim);
  const refused = await f.publish(f.grant('capacity-refreshed'));
  assert.deepEqual(refused.blockers, ['MISSION_WORKER_PENDING_CAPACITY_PROCESSING_CONFLICT']);
  assert.deepEqual(await readFile(originalClaimPath), originalClaim);
  assert.deepEqual(await readFile(f.first.path), f.originalBytes);
  assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, f.state.revision);
});

test('pending capacity admission refuses terminal queue truth and authentic execution receipt history', async t => {
  const f = await pendingCapacityFixture(t);
  const resultPath = join(f.options.queueRoot, 'foundry-forge', 'failed', `${f.firstGrant.actionId}.result.json`);
  await writeFile(resultPath, '{"fixture":"previous-terminal-result"}');
  assert.deepEqual((await f.publish(f.grant('capacity-refreshed'))).blockers,
    ['MISSION_WORKER_PENDING_CAPACITY_TERMINAL_CONFLICT']);
  await unlink(resultPath);
  const receipt = createExecutionReceipt({ repository: f.state.repository, issueNumber: 1557,
    prNumber: null, branch: f.state.git.branch, sourceHead: f.firstGrant.sourceRevision,
    workerId: f.firstGrant.workerId, workerType: 'github-first', executionId: `${f.firstGrant.actionId}-prior`,
    leaseKey: f.originalItem.executionBinding.leaseKey, state: 'queued', phase: 'fixture-prior-admission',
    sequence: 1, timestampUtc: f.options.now.toISOString(), proofRefs: f.firstGrant.capacityProofRefs,
    expectedNextAction: 'Fixture prior custody must not be overwritten by pending refresh.' });
  const appended = await appendExecutionReceipt(f.options.sharedWorkspaceRoot, receipt, { repoRoot: f.options.repoRoot });
  assert.equal(appended.ok, true, JSON.stringify(appended));
  assert.deepEqual((await f.publish(f.grant('capacity-refreshed'))).blockers,
    ['MISSION_WORKER_PENDING_CAPACITY_EXECUTION_RECEIPT_CONFLICT']);
  assert.deepEqual(await readFile(f.first.path), f.originalBytes);
});

test('interrupted admitted refresh blocks old pickup and resumes exact preserved bytes before fresh capacity', async t => {
  const f = await pendingCapacityFixture(t);
  const second = f.grant('capacity-second');
  await f.publish(second);
  const secondBytes = await readFile(f.first.path);
  const journalBytes = await readFile(join(f.historyPath, '00000001.json'));
  // This is the real durable state after intent publication but before rename.
  await writeFile(f.first.path, f.originalBytes);
  await assert.rejects(f.claim(f.firstGrant), /MISSION_WORKER_PENDING_CAPACITY_RECOVERY_REQUIRED/);
  const recovered = await f.publish(second);
  assert.equal(recovered.capacityAdmissionRecovered, true);
  assert.equal(recovered.queueItemRefreshed, false);
  assert.deepEqual(await readFile(f.first.path), secondBytes);
  assert.deepEqual(await readFile(join(f.historyPath, '00000001.json')), journalBytes);
  await writeFile(f.first.path, f.originalBytes);
  const stale = await f.publish(f.firstGrant);
  assert.deepEqual(stale.blockers, ['MISSION_WORKER_PENDING_CAPACITY_RECEIPT_REPLAY']);
  assert.deepEqual(await readFile(f.first.path), secondBytes);
  await writeFile(f.first.path, f.originalBytes);
  const current = await f.publish(f.grant('capacity-third'));
  assert.equal(current.capacityAdmissionRecovered, true); assert.equal(current.queueItemRefreshed, true);
  const secondJournal = JSON.parse(await readFile(join(f.historyPath, '00000002.json')));
  assert.equal(secondJournal.previousEnvelopeSha256, capacityEnvelopeSha(secondBytes));
});

test('missing pending or damaged admission history never reconstructs or permits a claim', async t => {
  const f = await pendingCapacityFixture(t);
  const fresh = f.grant('capacity-refreshed');
  await f.publish(fresh);
  const pendingBytes = await readFile(f.first.path);
  await unlink(f.first.path);
  assert.deepEqual((await f.publish(fresh)).blockers, ['MISSION_WORKER_PENDING_CAPACITY_PENDING_MISSING']);
  await assert.rejects(readFile(f.first.path), { code: 'ENOENT' });
  await writeFile(f.first.path, pendingBytes);
  const originalSnapshot = join(f.historyPath, 'envelopes', `${capacityEnvelopeSha(f.originalBytes)}.json`);
  await writeFile(originalSnapshot, 'corrupted-fixture-snapshot');
  await assert.rejects(f.claim(fresh), /MISSION_WORKER_PENDING_CAPACITY_HISTORY_INVALID/);
  assert.deepEqual((await f.publish(f.grant('capacity-third'))).blockers,
    ['MISSION_WORKER_PENDING_CAPACITY_HISTORY_INVALID']);
  assert.deepEqual(await readFile(f.first.path), pendingBytes);
});

test('a refreshed envelope requires its journal even if the entire history directory disappears', async t => {
  const f = await pendingCapacityFixture(t);
  const fresh = f.grant('capacity-refreshed');
  await f.publish(fresh);
  const pendingBytes = await readFile(f.first.path);
  const pending = JSON.parse(pendingBytes);
  assert.equal(pending.pendingCapacityAdmission.sequence, 1);
  assert.equal(pending.pendingCapacityAdmission.previousEnvelopeSha256, capacityEnvelopeSha(f.originalBytes));
  await rm(f.historyPath, { recursive: true });
  await assert.rejects(f.claim(fresh), /MISSION_WORKER_PENDING_CAPACITY_HISTORY_REQUIRED/);
  assert.deepEqual((await f.publish(fresh)).blockers, ['MISSION_WORKER_PENDING_CAPACITY_HISTORY_REQUIRED']);
  assert.deepEqual((await f.publish(f.grant('capacity-third'))).blockers, ['MISSION_WORKER_PENDING_CAPACITY_HISTORY_REQUIRED']);
  assert.deepEqual(await readFile(f.first.path), pendingBytes);
  assert.deepEqual(await readdir(join(f.options.queueRoot, 'foundry-forge', 'processing')), []);
});

test('locked pickup refuses stale current-state revision before acquiring either original or refreshed pending work', async t => {
  for (const refreshed of [false, true]) await t.test(refreshed ? 'refreshed grant' : 'original grant', async child => {
    const f = await pendingCapacityFixture(child);
    const currentGrant = refreshed ? f.grant('capacity-refreshed') : f.firstGrant;
    if (refreshed) await f.publish(currentGrant);
    const originalPending = await readFile(f.first.path);
    const record = await readMissionRecord(f.state.missionId, f.options);
    const advanced = { ...record.state, revision: record.state.revision + 1 };
    await writeFile(record.statePath, JSON.stringify(advanced));
    const stateBytes = await readFile(record.statePath);
    await assert.rejects(f.claim(currentGrant), /MISSION_WORKER_PENDING_CAPACITY_MISSION_CHANGED/);
    assert.deepEqual(await readFile(f.first.path), originalPending);
    assert.deepEqual(await readFile(record.statePath), stateBytes);
    assert.deepEqual(await readdir(join(f.options.queueRoot, 'foundry-forge', 'processing')), []);
  });
});

test('publication during the real post-rename pre-pickup-event interval cannot create another pending owner', async t => {
  const f = await pendingCapacityFixture(t);
  const processingPath = join(f.options.queueRoot, 'foundry-forge', 'processing', `${f.firstGrant.actionId}.json`);
  await rename(f.first.path, processingPath);
  const stateBefore = (await readMissionRecord(f.state.missionId, f.options)).state;
  assert.equal(stateBefore.dispatch.status, 'pending'); assert.equal(stateBefore.revision, f.state.revision);
  const refused = await f.publish(f.grant('capacity-refreshed'));
  assert.equal(refused.published, false);
  assert.deepEqual(refused.blockers, ['MISSION_WORKER_PENDING_CAPACITY_PROCESSING_CONFLICT']);
  assert.deepEqual(await readFile(processingPath), f.originalBytes);
  await assert.rejects(readFile(f.first.path), { code: 'ENOENT' });
  assert.deepEqual((await readMissionRecord(f.state.missionId, f.options)).state, stateBefore);
});

test('locked refreshed pickup refuses changed source scope even when the stored revision was not advanced', async t => {
  const f = await pendingCapacityFixture(t);
  const fresh = f.grant('capacity-refreshed');
  await f.publish(fresh);
  const pendingBytes = await readFile(f.first.path);
  const record = await readMissionRecord(f.state.missionId, f.options);
  await writeFile(record.statePath, JSON.stringify({ ...record.state, allowedFiles: ['shared/agents/foreign-scope.mjs'] }));
  await assert.rejects(f.claim(fresh), /MISSION_WORKER_PENDING_CAPACITY_MISSION_CHANGED/);
  assert.deepEqual(await readFile(f.first.path), pendingBytes);
  assert.deepEqual(await readdir(join(f.options.queueRoot, 'foundry-forge', 'processing')), []);
});

test('a source pickup holding the mission lock cannot be superseded by concurrent publication', async t => {
  const f = await pendingCapacityFixture(t);
  let publication;
  const claim = await f.claim(f.firstGrant, { assertPendingClaimContract: item => {
    assert.ok(missionWorkerActionGrantsMatchV1(item.actionGrant, f.firstGrant));
    publication = f.publish(f.grant('capacity-refreshed'));
  } });
  assert.ok(claim); assert.ok(publication);
  const competing = await publication;
  assert.equal(competing.published, false);
  assert.ok(['pending-capacity-reconciliation-blocked', 'mission-state-precondition-failed'].includes(competing.reason));
  assert.deepEqual(await readFile(claim.processingPath), f.originalBytes);
  await assert.rejects(readFile(f.first.path), { code: 'ENOENT' });
  assert.equal((await readMissionRecord(f.state.missionId, f.options)).state.revision, f.state.revision + 1);
});


test('first issued pending grant refuses a different controller or capacity identity before atomic pickup', async t => {
  const f = await pendingCapacityFixture(t);
  const originalPending = await readFile(f.first.path);
  const originalState = (await readMissionRecord(f.state.missionId, f.options)).state;
  const changed = [
    { workerId: 'foreign-source-writer' },
    { sourceRevision: 'b'.repeat(40) },
    { providerRouteIntent: 'OPENCLAW_ONLY' },
    { capacityReceiptId: 'foreign-capacity-receipt' },
    { capacityProofRefs: ['foreign-capacity-proof'] },
    { branch: 'openclaw/foreign-original-owner' },
    { grantId: 'grant-foreign' },
  ];
  for (const alteration of changed) {
    const foreignGrant = { ...f.firstGrant, ...alteration };
    assert.equal(missionWorkerActionGrantsMatchV1(f.firstGrant, foreignGrant), false);
    await assert.rejects(
      claimNextMissionWorkerItem('foundry-forge', { ...f.options, actionGrant: foreignGrant }),
      /MISSION_WORKER_PENDING_CAPACITY_GRANT_MISMATCH/,
    );
    assert.deepEqual(await readFile(f.first.path), originalPending);
    assert.deepEqual((await readMissionRecord(f.state.missionId, f.options)).state, originalState);
    assert.deepEqual(await readdir(join(f.options.queueRoot, 'foundry-forge', 'processing')), []);
  }
  // No lease seizure, rewrite or fake progress. The original exact writer can
  // still make the single real pending -> processing claim.
  const exact = await claimNextMissionWorkerItem('foundry-forge', {
    ...f.options, actionGrant: f.firstGrant,
  });
  assert.equal(exact.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
  assert.ok(missionWorkerActionGrantsMatchV1(exact.item.actionGrant, f.firstGrant));
  const running = (await readMissionRecord(f.state.missionId, f.options)).state;
  assert.equal(running.dispatch.status, 'running');
});


test('worker tick refuses a denied publication even when a same-action pending queue item exists', async t => {
  const f = await pendingCapacityFixture(t);
  const originalPending = await readFile(f.first.path);
  const originalState = (await readMissionRecord(f.state.missionId, f.options)).state;
  const forged = { ...f.firstGrant, workerId: 'other-worker-without-custody' };
  assert.equal(missionWorkerActionGrantsMatchV1(f.firstGrant, forged), false);
  const result = await runMissionWorkerTick({
    ...f.options, actionGrant: forged,
    runCommand: () => { throw new Error('DENIED_PUBLICATION_MUST_NOT_EXECUTE'); },
  });
  assert.equal(result.publish.published, false);
  assert.equal(result.publish.reason, 'pending-capacity-reconciliation-blocked');
  assert.deepEqual(result.publish.blockers, ['MISSION_WORKER_PENDING_CAPACITY_CONTRACT_CHANGED']);
  assert.equal(result.processed.processed, false);
  assert.equal(result.processed.reason, 'pending-capacity-reconciliation-blocked');
  assert.deepEqual(await readFile(f.first.path), originalPending);
  assert.deepEqual((await readMissionRecord(f.state.missionId, f.options)).state, originalState);
  assert.deepEqual(await readdir(join(f.options.queueRoot, 'foundry-forge', 'processing')), []);
});
