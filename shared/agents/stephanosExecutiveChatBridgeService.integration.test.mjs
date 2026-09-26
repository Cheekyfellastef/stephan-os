import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE,
  buildStephanosExecutiveChatBridge,
  classifyStephanosExecutiveChatIntent,
} from '../../stephanos-server/services/stephanosExecutiveChatBridgeService.js';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import { buildStephanosOperatorKnowledgeTwinV1 } from './stephanosOperatorKnowledgeTwinV1.mjs';

const NOW = '2026-09-25T19:30:00.000Z';

function alignmentTwin() {
  return buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: NOW,
    operatorConsent: {
      visibilityAllowed: true,
      learningCandidatesAllowed: false,
      durableLearningAllowed: false,
      scope: 'CURRENT_SHARED_THREAD',
    },
    items: [{
      chatId: 'shared-operator-primary',
      messageId: 'operator-current-intent',
      role: 'operator',
      sourceSurface: 'shared-workspace',
      createdAtUtc: NOW,
      text: 'Complete my goals through the canonical Octopus and guarded project machinery.',
      knowledgeClass: 'OPEN_THREAD',
      retentionIntent: 'CONTEXT_ONLY',
      explicitOperatorTeaching: false,
      supersedesKnowledgeId: '',
      sourceRefs: ['workspace://shared-thread/current-intent'],
    }],
  });
}

function projection() {
  return {
    scheduler: {
      programmeStatus: 'ACTIVE',
      failClosed: false,
      activeGoal: '#2002',
      activeGoals: ['#2002'],
      activeLane: null,
      activeLanes: [],
      selectedGoal: '#2002',
      selectedRoute: 'PROVIDER_NEUTRAL',
      selectedLifecycle: 'AGENT_IMPLEMENTATION',
      parallelCandidates: ['#1556'],
      elasticCapacity: { effectiveWidth: 5 },
      nextEligible: ['#2002', '#1556'],
      operatorNeeded: false,
      operatorAction: null,
      whyNow: '#2002 is the highest-value safe eligible goal.',
      blockers: [],
      contradictionsTotal: 0,
      decisionReceipt: { proofRefs: ['proof/stephanos-octopus-chat-integration'] },
    },
    machineryInventory: { sourceHead: 'a'.repeat(40) },
    sourceReads: {
      workspaceConfig: { root: '/tmp/stephanos-octopus-chat-integration' },
    },
  };
}

test('Stephanos completion wording is classified as an executable Octopus command', () => {
  for (const prompt of [
    'Tell the octopus to complete the goals and keep going.',
    'Make sure Stephanos is actually telling the octopus to complete the goals.',
    'Have the octopus finish the selected goal and continue.',
  ]) {
    const result = classifyStephanosExecutiveChatIntent(prompt);
    assert.equal(result.applies, true, prompt);
    assert.equal(result.explicitActionRequested, true, prompt);
    assert.equal(result.commandClass, 'REQUEST_SYSTEM_ACTION', prompt);
    assert.equal(result.targetSystem, 'mission-orchestrator-worker', prompt);
  }
});

test('Stephanos publishes completion, release, select-next and refill requirements to Mission Orchestrator', async () => {
  const writes = [];
  const wakeCalls = [];
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete my goals and keep going.',
    requestId: 'octopus-complete-goals',
    knowledgeTwin: alignmentTwin(),
    sharedThreadId: 'shared-operator-primary',
    operatorTurnId: 'operator-current-intent',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, {
    testOnly: true,
    dependencies: {
      readProgrammeProjection: async () => projection(),
      writeRecord: async (root, segments, record) => {
        writes.push({ root, segments, record });
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
      },
      wakeCanonicalGoalBuilder: async (input) => {
        wakeCalls.push(input);
        return {
          ok: true,
          classification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
          finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_READY',
          elasticAdmission: { selectedMission: { missionId: 'critical-2002-elastic-goal' } },
          executiveIngressAcceptance: {
            accepted: true,
            consumer: 'critical-backlog-conveyor',
            handoffId: input.executiveHandoffId,
            correlationId: input.executiveCorrelationId,
            selectedGoal: '#2002',
            acceptedGoalIssue: 2002,
            classification: 'EXECUTIVE_INGRESS_ACCEPTED',
            dispatchClassification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
          },
        };
      },
    },
  });

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.DELEGATION_PUBLISHED);
  assert.equal(writes.length, 2);
  assert.equal(wakeCalls.length, 1);
  assert.equal(wakeCalls[0].executiveSelectedGoal, '#2002');
  assert.equal(wakeCalls[0].executiveHandoffId, result.handoff.record.handoffId);
  assert.deepEqual(writes[1].segments.slice(0, 2), ['receipts', 'stephanos-executive']);
  assert.equal(result.canonicalIngress.ok, true);
  assert.equal(result.acknowledgement.ok, true);
  assert.equal(writes[1].record.acceptedGoalIssue, 2002);
  const acknowledgementValidation = validateSharedWorkspaceRecord(writes[1].record, { nowMs: Date.parse(NOW) });
  assert.equal(acknowledgementValidation.valid, true, acknowledgementValidation.errors.join(', '));
  assert.equal(writes[1].record.kind, 'stephanos.shared_workspace.record.receipt');
  assert.equal(writes[1].record.receivedRecordId, result.handoff.record.handoffId);
  assert.equal(result.handoff.record.toParticipantId, 'mission-orchestrator');

  const body = JSON.parse(result.handoff.record.body);
  assert.equal(body.selectedGoal, '#2002');
  assert.equal(body.goalCompletionContract.mode, 'COMPLETE_SELECTED_GOAL_AND_REFILL');
  assert.equal(body.goalCompletionContract.selectedGoal, '#2002');
  assert.equal(body.goalCompletionContract.completionRequired, true);
  assert.equal(body.goalCompletionContract.terminalExecutionReceiptRequired, true);
  assert.equal(body.goalCompletionContract.exactHeadReviewHandoffRequired, true);
  assert.equal(body.goalCompletionContract.releaseConstructionCapacityAfterTerminal, true);
  assert.equal(body.goalCompletionContract.selectNextEligibleAfterRelease, true);
  assert.equal(body.goalCompletionContract.workConservingRefillRequired, true);
  assert.equal(body.goalCompletionContract.continueIndependentEligibleWorkWhileBlocked, true);
  assert.equal(body.goalCompletionContract.duplicateControllerAllowed, false);
  assert.equal(body.goalCompletionContract.parallelMutationOwnerAllowed, false);
  assert.equal(body.returnContract.selectedGoalCompletionRequired, true);
  assert.equal(body.returnContract.continueAfterGoalReleaseRequired, true);
  assert.match(result.contextBlock, /canonical goal-building conveyor accepted/i);
  assert.match(result.contextBlock, /#2002/i);
  assert.match(result.contextBlock, /RELEASE, SELECT NEXT/i);
});


test('Stephanos refuses to acknowledge canonical ingress for the wrong selected goal', async () => {
  const writes = [];
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete my goals and keep going.',
    requestId: 'octopus-wrong-goal',
    knowledgeTwin: alignmentTwin(),
    sharedThreadId: 'shared-operator-primary',
    operatorTurnId: 'operator-current-intent',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, {
    testOnly: true,
    dependencies: {
      readProgrammeProjection: async () => projection(),
      writeRecord: async (root, segments, record) => {
        writes.push({ root, segments, record });
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
      },
      wakeCanonicalGoalBuilder: async (input) => ({
        ok: true,
        classification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
        finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_READY',
        elasticAdmission: { selectedMission: { missionId: 'critical-1556-elastic-goal' } },
        executiveIngressAcceptance: {
          accepted: true,
          consumer: 'critical-backlog-conveyor',
          handoffId: input.executiveHandoffId,
          correlationId: input.executiveCorrelationId,
          selectedGoal: '#1556',
          acceptedGoalIssue: 1556,
          classification: 'EXECUTIVE_INGRESS_ACCEPTED',
          dispatchClassification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
        },
      }),
    },
  });

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.equal(
    result.blocker,
    'CANONICAL_GOAL_BUILD_INGRESS_ACCEPTANCE_UNPROVEN:consumer-acceptance-binding-mismatch:expected-2002:accepted-1556',
  );
  assert.equal(writes.length, 1);
  assert.equal(result.acknowledgement, null);
  assert.match(result.contextBlock, /do not claim that the Octopus received or executed it/i);
});


test('Stephanos fails closed when canonical goal ingress throws after publication', async () => {
  const writes = [];
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete my goals and keep going.',
    requestId: 'octopus-ingress-exception',
    knowledgeTwin: alignmentTwin(),
    sharedThreadId: 'shared-operator-primary',
    operatorTurnId: 'operator-current-intent',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, {
    testOnly: true,
    dependencies: {
      readProgrammeProjection: async () => projection(),
      writeRecord: async (root, segments, record) => {
        writes.push({ root, segments, record });
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
      },
      wakeCanonicalGoalBuilder: async () => {
        const error = new Error('queue filesystem failed');
        error.code = 'EACCES';
        throw error;
      },
    },
  });

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.equal(result.publication.ok, true);
  assert.equal(result.blocker, 'CANONICAL_GOAL_BUILD_INGRESS_EXCEPTION:EACCES');
  assert.equal(result.canonicalIngress.ingressOutcomeUncertain, true);
  assert.equal(writes.length, 1);
  assert.match(result.contextBlock, /completion handoff was published/i);
  assert.match(result.contextBlock, /do not claim that the Octopus received or executed it/i);
});
