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
    missionId: 'goal-1637-pr-1830-continuity', title: 'GitHub Continuity M3 test mission',
    operatorIntent: 'Continue bounded source work.', intendedOutcome: 'Produce one source-only change.',
    missionKind: 'implementation', repository: REPOSITORY, repositoryRoot: 'repo-root', baseBranch: 'main',
    branch: 'orchestrator/goal-1637-pr-1830-continuity', worktreePath: 'worktrees/goal-1637-pr-1830-continuity',
    allowedFiles: [FILE], requiredEvidence: ['source proof'], requiredTests: ['node --test continuity-example.test.mjs'],
  }, { now: new Date(NOW) });
  const ready = applyMissionOrchestratorEvent(initial, {
    schemaVersion: MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION, missionId: initial.missionId,
    eventType: 'WORKTREE_READY', timestamp: NOW, worktreePath: initial.git.worktreePath, clean: true,
    receipt: receipt('isolated worktree'),
  }, { now: new Date(NOW) });
  assert.equal(ready.currentPhase, 'AGENT_IMPLEMENTATION');
  return ready;
}

function grant(overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_EXECUTION_GRANT_SCHEMA,
    grantId: 'continuity:goal-1637-pr-1830-continuity:source-step:1', repository: REPOSITORY,
    expectedSourceHead: HEAD, missionId: 'goal-1637-pr-1830-continuity', taskId: 'source-step',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB, adapter: 'chatgpt-github',
    selectedCapacityReceiptId: 'github-capacity-current-001', proofRefs: ['receipts/github-capacity-current-001'],
    grantedAtUtc: NOW, executionScope: 'SOURCE_ONLY_EXISTING_ROUTE', windowsBound: false,
    existingDispatchTakeoverAllowed: false, sourceMutationAuthorityAdded: false, mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false, runtimeMutationAuthorityAdded: false, protectedMergeDispatchAllowed: false,
    leaseSeizureAllowed: false, duplicateDispatchAllowed: false, arbitraryCommandAllowed: false,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildGitHubContinuityExternalHandoffV1({
    repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW,
    executionGrant: grant(), missionState: readyMission(), ...overrides,
  });
}

function runningMission(adapter = 'chatgpt-github') {
  const ready = readyMission();
  const running = applyMissionOrchestratorEvent(ready, {
    schemaVersion: MISSION_ORCHESTRATOR_EVENT_SCHEMA_VERSION, missionId: ready.missionId,
    eventType: 'AGENT_DISPATCHED', timestamp: NOW, adapter, agentId: adapter,
  }, { now: new Date(NOW) });
  assert.equal(running.dispatch.status, 'running');
  return running;
}

function completion(handoff, overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA,
    handoffId: handoff.handoffId, grantId: handoff.grantId, missionId: handoff.queueItemCandidate.missionId,
    taskId: handoff.taskId, repository: handoff.repository, expectedSourceHead: handoff.expectedSourceHead,
    adapter: handoff.queueItemCandidate.adapter, capacityRoute: handoff.queueItemCandidate.payload.capacityRoute,
    success: true, resultId: 'external-result-001', changedFiles: [FILE],
    receipt: receipt('source proof', { receiptId: 'external-source-proof', source: 'chatgpt-github', evidenceType: 'EXTERNAL_LANE_COMPLETION', sha256: 'c'.repeat(64) }),
    proofRefs: ['receipts/external-source-proof'], completedAtUtc: '2026-08-17T14:31:00.000Z', error: '',
    sourceMutationAuthorityAdded: false, mergeAuthorityAdded: false, deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false, protectedMergeDispatchAllowed: false,
    duplicateDispatchAllowed: false, arbitraryCommandAllowed: false, ...overrides,
  };
}

test('maps one external M2 grant to existing queue/workspace schemas without publishing', () => {
  const result = build();
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY);
  assert.equal(result.queueItemCandidate.schemaVersion, MISSION_WORKER_QUEUE_ITEM_SCHEMA);
  assert.equal(result.queueItemCandidate.adapter, 'chatgpt-github');
  assert.equal(result.queueItemCandidate.payload.capacityRoute, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  const body = JSON.parse(result.sharedWorkspaceHandoffCandidate.body);
  assert.equal(body.schemaVersion, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_BODY_SCHEMA);
  assert.equal(body.grantId, grant().grantId);
  assert.equal(body.expectedSourceHead, HEAD);
  assert.equal(body.mergeAuthority, false);
  assert.equal(result.authority.queueWriteAllowed, false);
  assert.equal(result.authority.sharedWorkspaceWriteAllowed, false);
});

test('preserves canonical publisher correlation: handoffId equals actionId everywhere', () => {
  const result = build();
  assert.equal(result.handoffId, result.actionId);
  assert.equal(result.queueItemCandidate.actionId, result.actionId);
  assert.equal(result.sharedWorkspaceHandoffCandidate.handoffId, result.actionId);
  assert.equal(JSON.parse(result.sharedWorkspaceHandoffCandidate.body).actionId, result.actionId);
  const again = build();
  assert.equal(again.actionId, result.actionId);
  assert.equal(again.handoffId, result.handoffId);
});

test('REPAIR_REQUIRED cannot be externalized until canonical mission service persists REPAIR_STARTED', () => {
  const repair = readyMission();
  repair.currentPhase = 'REPAIR_REQUIRED';
  const result = build({ missionState: repair });
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);
  assert.ok(result.blockers.includes('repair-start-must-be-persisted-by-canonical-mission-service'));
  assert.equal(result.queueItemCandidate, null);
});

test('Foundry stays bound to its route while Codex remains on the existing in-process path', () => {
  const foundry = build({ executionGrant: grant({
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE, adapter: 'foundry-forge',
    selectedCapacityReceiptId: 'foundry-capacity-current-001', proofRefs: ['receipts/foundry-capacity-current-001'],
  }) });
  assert.equal(foundry.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXTERNAL_HANDOFF_CANDIDATE_READY);
  assert.equal(foundry.queueItemCandidate.adapter, 'foundry-forge');

  const codex = build({ executionGrant: grant({
    route: MISSION_CONTROLLER_ROUTE.CODEX, adapter: 'codex', selectedCapacityReceiptId: null, proofRefs: [],
  }) });
  assert.equal(codex.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.EXISTING_IN_PROCESS_ROUTE_PRESERVED);
  assert.equal(codex.queueItemCandidate, null);
});

test('external grant requires proof evidence and rejects head/Windows/authority drift', () => {
  for (const bad of [
    grant({ proofRefs: [] }), grant({ expectedSourceHead: 'd'.repeat(40) }), grant({ windowsBound: true }),
    grant({ mergeAuthorityAdded: true }), grant({ duplicateDispatchAllowed: true }),
  ]) {
    const result = build({ executionGrant: bad });
    assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);
    assert.equal(result.queueItemCandidate, null);
  }
});

test('an already-running mission dispatch cannot be taken over', () => {
  const result = build({ missionState: runningMission() });
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);
  assert.ok(result.blockers.includes('existing-dispatch-owns-mission'));
  assert.equal(result.authority.existingDispatchTakeoverAllowed, false);
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

test('completion rejects fabricated handoff correlation, scope drift and authority widening', () => {
  const handoff = build();
  const fabricated = { ...handoff, handoffId: 'fabricated-handoff-id' };
  assert.equal(adjudicateGitHubContinuityExternalCompletionV1({
    handoff: fabricated, completionReceipt: completion(handoff), missionState: runningMission(),
  }).valid, false);

  const scope = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff, { changedFiles: ['shared/agents/unrelated.mjs'] }), missionState: runningMission(),
  });
  assert.equal(scope.valid, false);
  assert.ok(scope.blockers.includes('completion-event-preflight-failed'));

  const authority = adjudicateGitHubContinuityExternalCompletionV1({
    handoff, completionReceipt: completion(handoff, { mergeAuthorityAdded: true }), missionState: runningMission(),
  });
  assert.equal(authority.valid, false);
  assert.ok(authority.blockers.includes('completion-authority-invalid'));
});

test('external failure remains a blocked canonical mission result', () => {
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
  const hostile = { repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: grant(), missionState: readyMission() };
  Object.defineProperty(hostile, 'nowUtc', { enumerable: true, get() { calls += 1; throw new Error('getter must not run'); } });
  let result;
  assert.doesNotThrow(() => { result = buildGitHubContinuityExternalHandoffV1(hostile); });
  assert.equal(calls, 0);
  assert.equal(result.state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);

  const withToJson = { repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: grant(), missionState: readyMission(), toJSON: () => ({ fabricated: true }) };
  assert.equal(buildGitHubContinuityExternalHandoffV1(withToJson).state, GITHUB_CONTINUITY_EXTERNAL_HANDOFF_STATE.SAFE_HOLD);

  const revoked = Proxy.revocable({ repository: REPOSITORY, expectedSourceHead: HEAD, nowUtc: NOW, executionGrant: grant(), missionState: readyMission() }, {});
  revoked.revoke();
  assert.doesNotThrow(() => buildGitHubContinuityExternalHandoffV1(revoked.proxy));
});
