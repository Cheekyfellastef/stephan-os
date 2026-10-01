import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendMissionEvent, createMissionRecord, readMissionRecord } from './missionOrchestratorStore.js';
import {
  buildMissionWorkerAction,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  collectAgentWorkerResult,
  publishMissionWorkerAction,
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';

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
  assert.deepEqual((await readMissionWorkerQueue(options)).map(({ adapter }) => adapter), ['chatgpt-github']);
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
  assert.equal(durable.state.revision, grant.missionRevision + 1);
  const queued = await readMissionWorkerQueue(options);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].item.payload.actionId, grant.actionId);
});
