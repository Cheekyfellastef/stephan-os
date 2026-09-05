import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
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
  const collected = await collectAgentWorkerResult({ missionId: intent.missionId, actionId: dispatch.action.actionId, adapter: 'codex', workerId: dispatch.action.workerId, success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'result'), evidenceReceipts: [proof('focused test output', 'evidence')] }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal((await readMissionRecord(intent.missionId, options)).state.dispatch.status, 'complete');
});

test('publishes one exact external fallback handoff and accepts its grounded result', async () => {
  const options = await runtime();
  const missionId = 'github-fallback-test';
  await createMissionRecord({
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
      authorityReceiptIds: ['github-fallback-authority-receipt'],
      proofRefs: ['receipts/github-builder/capacity.json'],
    },
    sourceHead: 'a'.repeat(40),
    githubLaneAuthorityReceipts: [{
      schemaVersion: 'stephanos.build-lane-authority-receipt.v1',
      receiptId: 'github-fallback-authority-receipt',
      route: 'CHATGPT_GITHUB',
      repository: intent.repository,
      sourceHead: 'a'.repeat(40),
      workerId: 'shared-fabric-chatgpt-github-builder-01',
      authorizedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
      authorizedTaskClasses: ['FOCUSED_REPAIR'],
      issuedAtUtc: new Date(Date.now() - 2000).toISOString(),
      expiresAtUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      proofRefs: ['receipts/github-builder/authority.json'],
      sourceDispatchAllowed: true,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      protectedMergeDispatchAllowed: false,
      duplicateDispatchAllowed: false,
      arbitraryCommandAllowed: false,
    }],
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
    workerId: action.workerId,
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
    workerId: action.workerId,
    success: true,
    changedFiles: ['shared/agents/example.mjs'],
    receipt: proof('github builder result', 'github-builder-result'),
    evidenceReceipts: [proof('focused test output', 'github-builder-evidence')],
  }, options);
  assert.equal(collected.state.currentPhase, 'GITHUB_COMMIT');
  assert.equal(collected.state.dispatch.adapter, 'chatgpt-github');
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
  const initialRepairAction = buildMissionWorkerAction(current.state, options);
  await append('repair-dispatch', 'AGENT_DISPATCHED', {
    agentId: 'codex',
    actionId: initialRepairAction.actionId,
    workerId: initialRepairAction.workerId,
  });
  await append('repair-result', 'AGENT_RESULT_RECEIVED', {
    actionId: initialRepairAction.actionId,
    workerId: initialRepairAction.workerId,
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
    capacityRoute: action.capacityRoute,
    capacityReceiptId: action.capacityReceiptId,
    capacityProofRefs: action.capacityProofRefs,
    workerId: action.workerId,
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