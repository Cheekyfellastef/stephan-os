import assert from 'node:assert/strict';
import test from 'node:test';

import { GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA } from './githubContinuityExecutionGrantV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from './missionControllerCapacityRouterV1.mjs';
import {
  MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
  applyMissionOrchestratorEvent,
  createMissionOrchestratorState,
} from './missionOrchestrator.mjs';
import {
  GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,
  GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA,
  GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE,
  MISSION_WORKER_QUEUE_ITEM_SCHEMA,
  adjudicateGitHubContinuityExternalCompletionV1,
  buildGitHubContinuityExternalHandoffV1,
} from './githubContinuityExternalHandoffV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = '2026-08-17T14:30:00.000Z';
const FILE = 'shared/agents/continuity-example.mjs';

function receipt(requirement = 'source proof', overrides = {}) {
  return {
    receiptId: 'receipt-source-proof', requirement, source: 'provider-neutral-test',
    evidenceType: 'DETERMINISTIC_TEST', verified: true, createdAt: NOW,
    sha256: 'b'.repeat(64), ...overrides,
  };
}

function readyMission() {
  const initial = createMissionOrchestratorState({
    missionId: 'goal-1637-pr-1830-continuity',
    title: 'GitHub Continuity M3 test mission',
    operatorIntent: 'Continue bounded source work.',
    intendedOutcome: 'Produce one source-only change.',
    missionKind: 'implementation', repository: REPOSITORY, repositoryRoot: 'repo-root',
    baseBranch: 'main', branch: 'orchestrator/goal-1637-pr-1830-continuity',
    worktreePath: 'worktrees/goal-1637-pr-1830-continuity', allowedFiles: [FILE],
    requiredEvidence: ['source proof'], requiredTests: ['node --test continuity-example.test.mjs'],
  }, { now: new Date(NOW) });
  const ready = applyMissionOrchestratorEvent(initial, {
    schemaVersion: MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
    missionId: initial.missionId, eventType: 'WORKTREE_READY', timestamp: NOW,
    worktreePath: initial.git.worktreePath, clean: true, receipt: receipt('isolated worktree'),
  }, { now: new Date(NOW) });
  assert.equal(ready.currentPhase, 'AGENT_IMPLEMENTATION');
  return ready;
}

function executionGrant(overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA,
    grantId: 'continuity:goal-1637-pr-1830-continuity:source-step:1',
    repository: REPOSITORY, expectedSourceHead: HEAD,
    missionId: 'goal-1637-pr-1830-continuity', taskId: 'source-step',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB, adapter: 'chatgpt-github',
    selectedCapacityReceiptId: 'github-capacity-current-001',
    proofRefs: ['receipts/github-capacity-current-001'], grantedAtUtc: NOW,
    executionScope: 'SOURCE_ONLY_EXISTING_ROUTE', windowsBound: false,
    existingDispatchTakeoverAllowed: false, sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false, deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false, protectedMergeDispatchAllowed: false,
    leaseSeizureAllowed: false, duplicateDispatchAllowed: false, arbitraryCommandAllowed: false,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildGitHubContinuityExternalHandoffV1({
    repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW,
    executionGrant: executionGrant(), missionState: readyMission(), ...overrides,
  });
}

function runningMission(adapter = 'chatgpt-github') {
  const ready = readyMission();
  return applyMissionOrchestratorEvent(ready, {
    schemaVersion: MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION,
    missionId: ready.missionId, eventType: 'AGENT_DISPATCHED', timestamp: NOW,
    adapter, agentId: adapter,
  }, { now: new Date(NOW) });
}

function completion(handoff, overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,
    handoffId: handoff.handoffId, grantId: handoff.grantId,
    missionId: handoff.queueItemCandidate.missionId, taskId: handoff.taskId,
    repository: handoff.repository, expectedSourceHead: handoff.expectedSourceHead,
    adapter: handoff.queueItemCandidate.adapter,
    capacityRoute: handoff.queueItemCandidate.payload.capacityRoute,
    success: true, resultId: 'external-result-001', changedFiles: [FILE],
    receipt: receipt('source proof', { receiptId: 'external-source-proof', source: 'chatgpt-github', evidenceType: 'EXTERNAL_LANE_COMPLETION', sha256: 'c'.repeat(64) }),
    proofRefs: ['receipts/external-source-proof'], completedAtUtc: '2026-08-17T14:31:00.000Z', error: '',
    sourceMutationAuthorityAdded: false, mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false, runtimeMutationAuthorityAdded: false,
    protectedMergeDispatchAllowed: false, duplicateDispatchAllowed: false, arbitraryCommandAllowed: false,
    ...overrides,
  };
}

test('prepares existing queue and Shared Workspace handoff records without publishing them', () => {
  const result = build();
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY);
  assert.equal(result.queueItemCandidate.schemaVersion, MISSION_WORKER_QUEUE_ITEM_SCHEMA);
  assert.equal(result.queueItemCandidate.adapter, 'chatgpt-github');
  assert.equal(result.queueItemCandidate.payload.capacityRoute, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  const body = JSON.parse(result.sharedWorkspaceHandoffCandidate.body);
  assert.equal(body.schemaVersion, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA);
  assert.equal(body.expectedSourceHead, HEAD);
  assert.equal(body.mergeAuthority, false);
  assert.equal(result.authority.queueWriteAllowed, false);
  assert.equal(result.authority.sharedWorkspaceWriteAllowed, false);
});

test('same exact grant and mission revision yields one deterministic handoff identity', () => {
  const first = build();
  const second = build();
  assert.equal(first.actionId, second.actionId);
  assert.equal(first.handoffId, second.handoffId);
});

test('Foundry is bound to its existing route while Codex is never externalized by M3', () => {
  const foundry = build({ executionGrant: executionGrant({
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE, adapter: 'foundry-forge',
    selectedCapacityReceiptId: 'foundry-capacity-current-001',
    proofRefs: ['receipts/foundry-capacity-current-001'],
  }) });
  assert.equal(foundry.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY);
  assert.equal(foundry.queueItemCandidate.adapter, 'foundry-forge');

  const codex = build({ executionGrant: executionGrant({
    route: MISSION_CONTROLLER_ROUTE.CODEX, adapter: 'codex',
    selectedCapacityReceiptId: null, proofRefs: [],
  }) });
  assert.equal(codex.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXISTING_IN_PROCESS_ROUTE_PRESERVED);
  assert.equal(codex.queueItemCandidate, null);
});

test('head drift, Windows scope, authority widening and active dispatch fail closed', () => {
  for (const grant of [
    executionGrant({ expectedSourceHead: 'd'.repeat(40) }),
    executionGrant({ windowsBound: true }),
    executionGrant({ mergeAuthorityAdded: true }),
    executionGrant({ duplicateDispatchAllowed: true }),
  ]) assert.equal(build({ executionGrant: grant }).state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);
  const running = build({ missionState: runningMission() });
  assert.equal(running.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);
  assert.ok(running.blockers.includes('existing-dispatch-owns-mission'));
});

test('successful portable completion preflights canonical AGENT_RESULT_RECEIVED', () => {
  const handoff = build();
  const result = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff), missionState: runningMission(),
  });
  assert.equal(result.valid, true, result.blockers.join(', '));
  assert.equal(result.eventCandidate.eventType, 'AGENT_RESULT_RECEIVED');
  assert.equal(result.projectedMissionState.dispatch.status, 'complete');
  assert.equal(result.projectedMissionState.currentPhase, 'GITHUB_COMMIT');
  assert.deepEqual(result.projectedMissionState.git.changedFiles, [FILE]);
});

test('completion identity, source scope and authority remain fail closed', () => {
  const handoff = build();
  const identityMismatch = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff, { expectedSourceHead: 'e'.repeat(40) }), missionState: runningMission(),
  });
  assert.equal(identityMismatch.valid, false);
  assert.ok(identityMismatch.blockers.includes('completion-handoff-identity-mismatch'));

  const scopeMismatch = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff, { changedFiles: ['shared/agents/unrelated.mjs'] }), missionState: runningMission(),
  });
  assert.equal(scopeMismatch.valid, false);
  assert.ok(scopeMismatch.blockers.includes('completion-event-preflight-failed'));

  const widened = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff, { mergeAuthorityAdded: true }), missionState: runningMission(),
  });
  assert.equal(widened.valid, false);
  assert.ok(widened.blockers.includes('completion-authority-invalid'));
});

test('reported external failure becomes the existing blocked mission event, never false success', () => {
  const handoff = build();
  const result = adjudicateGitHubContinuityExternalCompletionV1({
    handoff,
    completionReceipt: completion(handoff, { success: false, resultId: '', changedFiles: [], receipt: null, error: 'external lane failed' }),
    missionState: runningMission(),
  });
  assert.equal(result.valid, true, result.blockers.join(', '));
  assert.equal(result.finalVerdict, 'GITHUB_CONTINUITY_EXTERNAL_FAILURE_EVENT_READY');
  assert.equal(result.projectedMissionState.currentPhase, 'BLOCKED');
});

test('hostile caller objects fail closed without invoking accessors or toJSON', () => {
  let calls = 0;
  const hostile = { repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: executionGrant(), missionState: readyMission() };
  Object.defineProperty(hostile, 'nowUtc', { enumerable: true, get() { calls += 1; throw new Error('getter must not run'); } });
  let result;
  assert.doesNotThrow(() => { result = buildGitHubContinuityExternalHandoffV1(hostile); });
  assert.equal(calls, 0);
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);

  const withToJson = { repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: executionGrant(), missionState: readyMission(), toJSON: () => ({ fabricated: true }) };
  assert.equal(buildGitHubContinuityExternalHandoffV1(withToJson).state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);

  const revoked = Proxy.revocable({ repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: executionGrant(), missionState: readyMission() }, {});
  revoked.revoke();
  assert.doesNotThrow(() => buildGitHubContinuityExternalHandoffV1(revoked.proxy));
});
