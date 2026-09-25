import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE,
  buildStephanosExecutiveChatBridge,
  classifyStephanosExecutiveChatIntent,
} from './stephanosExecutiveChatBridgeService.js';
import { validateSharedWorkspaceRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

const NOW = '2026-09-25T18:00:00.000Z';

function scheduler(overrides = {}) {
  return {
    programmeStatus: 'ACTIVE',
    failClosed: false,
    activeGoal: '#1556',
    activeGoals: ['#1556'],
    activeLane: null,
    activeLanes: [],
    selectedGoal: '#1556',
    selectedRoute: 'CHATGPT_GITHUB',
    selectedLifecycle: 'AGENT_IMPLEMENTATION',
    parallelCandidates: [],
    elasticCapacity: null,
    nextEligible: ['#1556'],
    operatorNeeded: false,
    operatorAction: null,
    whyNow: '#1556 is the highest-value safe eligible goal.',
    blockers: [],
    contradictionsTotal: 0,
    decisionReceipt: {
      proofRefs: ['proof/executive-chat-bridge-test'],
    },
    ...overrides,
  };
}

function projection(overrides = {}) {
  return {
    scheduler: scheduler(),
    machineryInventory: {
      sourceHead: 'a'.repeat(40),
    },
    sourceReads: {
      workspaceConfig: {
        root: '/tmp/stephanos-executive-chat-workspace',
      },
    },
    ...overrides,
  };
}

function acceptedIngress(input, issueNumber = 1556) {
  return {
    ok: true,
    classification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_READY',
    elasticAdmission: { selectedMission: { missionId: `critical-${issueNumber}-elastic-goal` } },
    executiveIngressAcceptance: {
      accepted: true,
      consumer: 'critical-backlog-conveyor',
      handoffId: input.executiveHandoffId,
      correlationId: input.executiveCorrelationId,
      selectedGoal: `#${issueNumber}`,
      acceptedGoalIssue: issueNumber,
      classification: 'EXECUTIVE_INGRESS_ACCEPTED',
      dispatchClassification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
    },
  };
}

function deps(programmeProjection = projection(), ingress = null) {
  const writes = [];
  const wakeCalls = [];
  return {
    writes,
    wakeCalls,
    options: {
      testOnly: true,
      dependencies: {
        readProgrammeProjection: async () => programmeProjection,
        writeRecord: async (root, segments, record) => {
          writes.push({ root, segments, record });
          return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
        },
        wakeCanonicalGoalBuilder: async (input) => {
          wakeCalls.push(input);
          if (typeof ingress === 'function') return ingress(input);
          return ingress || acceptedIngress(input);
        },
      },
    },
  };
}

test('unrelated conversation does not wake programme machinery', async () => {
  let reads = 0;
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Recommend a good album for tonight.',
    nowUtc: NOW,
  }, {
    testOnly: true,
    dependencies: {
      readProgrammeProjection: async () => {
        reads += 1;
        return projection();
      },
      writeRecord: async () => ({ ok: true }),
    },
  });

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.NOT_APPLICABLE);
  assert.equal(reads, 0);
  assert.equal(result.contextBlock, '');
});

test('flywheel question is read-only grounding and creates no handoff', async () => {
  const harness = deps();
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'What does the flywheel think we should do next?',
    requestId: 'chat-read-1556',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.GROUNDING_READY);
  assert.equal(result.plan.commandClass, 'ASK_FLYWHEEL');
  assert.equal(result.plan.flywheel.selectedGoal, '#1556');
  assert.equal(harness.writes.length, 0);
  assert.match(result.contextBlock, /read-only programme dialogue/i);
});

test('explicit octopus build request publishes one zero-authority Stephanos handoff', async () => {
  const harness = deps();
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Keep going in octopus mode and continue building the next safe goal.',
    requestId: 'chat-build-1556',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.DELEGATION_PUBLISHED);
  assert.equal(result.plan.delegation.targetSystem, 'mission-orchestrator-worker');
  assert.equal(result.plan.delegation.selectedGoal, '#1556');
  assert.equal(harness.writes.length, 2);
  assert.equal(harness.wakeCalls.length, 1);
  assert.equal(harness.wakeCalls[0].executiveSelectedGoal, '#1556');
  assert.equal(harness.wakeCalls[0].executiveHandoffId, result.handoff.record.handoffId);
  assert.deepEqual(harness.writes[0].segments, ['handoffs', result.handoff.record.handoffId + '.json']);
  assert.deepEqual(harness.writes[1].segments.slice(0, 2), ['receipts', 'stephanos-executive']);
  const acknowledgementValidation = validateSharedWorkspaceRecord(harness.writes[1].record, { nowMs: Date.parse(NOW) });
  assert.equal(acknowledgementValidation.valid, true, acknowledgementValidation.errors.join(', '));
  assert.equal(harness.writes[1].record.kind, 'stephanos.shared_workspace.record.receipt');
  assert.equal(harness.writes[1].record.receivedRecordId, result.handoff.record.handoffId);
  assert.equal(result.handoff.record.participantId, 'stephanos');
  assert.equal(result.handoff.record.fromParticipantId, 'stephanos');
  assert.equal(result.handoff.record.toParticipantId, 'mission-orchestrator');
  const body = JSON.parse(result.handoff.record.body);
  assert.equal(body.authority.directMutationAuthority, false);
  assert.equal(body.authority.leaseSeizureAllowed, false);
  assert.equal(body.authority.bypassApprovalAllowed, false);
  assert.equal(body.returnContract.durableReceiptRequired, true);
  assert.equal(body.returnContract.selectedGoalCompletionRequired, true);
  assert.equal(body.returnContract.continueAfterGoalReleaseRequired, true);
  assert.equal(body.goalCompletionContract.mode, 'COMPLETE_SELECTED_GOAL_AND_REFILL');
  assert.equal(body.goalCompletionContract.selectedGoal, '#1556');
  assert.equal(body.goalCompletionContract.terminalExecutionReceiptRequired, true);
  assert.equal(body.goalCompletionContract.exactHeadReviewHandoffRequired, true);
  assert.equal(body.goalCompletionContract.releaseConstructionCapacityAfterTerminal, true);
  assert.equal(body.goalCompletionContract.selectNextEligibleAfterRelease, true);
  assert.equal(body.goalCompletionContract.workConservingRefillRequired, true);
  assert.equal(body.goalCompletionContract.duplicateControllerAllowed, false);
  assert.equal(result.canonicalIngress.ok, true);
  assert.equal(result.acknowledgement.ok, true);
  assert.match(result.contextBlock, /canonical goal-building conveyor accepted/i);
  assert.match(result.contextBlock, /#1556/i);
  assert.match(result.contextBlock, /RELEASE, SELECT NEXT/i);
  assert.match(result.contextBlock, /Do not claim goal completion until durable terminal receipts prove it/i);
});

test('approval-bound system action is surfaced but never published by chat', async () => {
  const harness = deps();
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Use the Battle Bridge command mailbox to update the live machine.',
    requestId: 'chat-mailbox-approval',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.APPROVAL_REQUIRED);
  assert.equal(result.plan.delegation.targetSystem, 'battle-bridge-github-command-mailbox');
  assert.equal(result.plan.delegation.targetCapability.requiresOperatorApproval, true);
  assert.equal(result.plan.delegation.bypassApprovalAllowed, false);
  assert.equal(harness.writes.length, 0);
  assert.match(result.contextBlock, /approval-bound/i);
});

test('fail-closed scheduler projection cannot create a conversational delegation', async () => {
  const harness = deps(projection({
    scheduler: scheduler({
      failClosed: true,
      blockers: ['CONTRADICTORY_PROGRAMME_TRUTH'],
      selectedGoal: null,
    }),
  }));
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Continue building.',
    requestId: 'chat-fail-closed',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.equal(result.blocker, 'FLYWHEEL_FAIL_CLOSED');
  assert.equal(harness.writes.length, 0);
});

test('classifier keeps natural questions separate from explicit action requests', () => {
  const question = classifyStephanosExecutiveChatIntent('Why is the repair blocked on the current goal?');
  const action = classifyStephanosExecutiveChatIntent('Please repair the current goal and keep going.');
  const octopusAction = classifyStephanosExecutiveChatIntent('Can you get the octopus to work on this?');
  const octopusCompletion = classifyStephanosExecutiveChatIntent('Tell the octopus to complete the goals and keep going.');
  const stephanosCompletion = classifyStephanosExecutiveChatIntent('Make sure Stephanos is actually telling the octopus to complete the goals.');

  assert.equal(question.applies, true);
  assert.equal(question.explicitActionRequested, false);
  assert.equal(question.commandClass, 'ASK_FLYWHEEL');
  assert.equal(action.applies, true);
  assert.equal(action.explicitActionRequested, true);
  assert.equal(action.commandClass, 'REQUEST_SYSTEM_ACTION');
  assert.equal(octopusAction.explicitActionRequested, true);
  assert.equal(octopusAction.targetSystem, 'mission-orchestrator-worker');
  assert.equal(octopusCompletion.explicitActionRequested, true);
  assert.equal(octopusCompletion.targetSystem, 'mission-orchestrator-worker');
  assert.equal(stephanosCompletion.explicitActionRequested, true);
  assert.equal(stephanosCompletion.targetSystem, 'mission-orchestrator-worker');
});


test('published completion handoff fails closed when canonical goal builder does not accept ingress', async () => {
  const harness = deps(projection(), {
    ok: false,
    classification: 'ELASTIC_GOAL_BUILD_DISPATCH_HELD',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  });
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete the goals and keep going.',
    requestId: 'chat-ingress-held',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.match(result.blocker, /^CANONICAL_GOAL_BUILD_INGRESS_FAILED:/);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.wakeCalls.length, 1);
  assert.match(result.contextBlock, /do not claim that the Octopus received or executed it/i);
});


test('canonical ingress acknowledgement fails closed when a different goal was accepted', async () => {
  const harness = deps(projection(), (input) => acceptedIngress(input, 2002));
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete the goals and keep going.',
    requestId: 'chat-ingress-wrong-goal',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, harness.options);

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.equal(
    result.blocker,
    'CANONICAL_GOAL_BUILD_INGRESS_ACCEPTANCE_UNPROVEN:consumer-acceptance-binding-mismatch:expected-1556:accepted-2002',
  );
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.wakeCalls.length, 1);
  assert.equal(result.acknowledgement, null);
  assert.match(result.contextBlock, /do not claim that the Octopus received or executed it/i);
});


test('acknowledgement I/O exception preserves published truth and returns SAFE_HOLD', async () => {
  const writes = [];
  const wakeCalls = [];
  let writeCount = 0;
  const result = await buildStephanosExecutiveChatBridge({
    prompt: 'Tell the octopus to complete the goals and keep going.',
    requestId: 'chat-ack-io-failure',
    nowUtc: NOW,
    repoRoot: '/repo',
  }, {
    testOnly: true,
    dependencies: {
      readProgrammeProjection: async () => projection(),
      writeRecord: async (root, segments, record) => {
        writeCount += 1;
        writes.push({ root, segments, record });
        if (writeCount === 2) {
          const error = new Error('disk full');
          error.code = 'ENOSPC';
          throw error;
        }
        return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
      },
      wakeCanonicalGoalBuilder: async (input) => {
        wakeCalls.push(input);
        return acceptedIngress(input);
      },
    },
  });

  assert.equal(result.state, STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD);
  assert.equal(result.publication.ok, true);
  assert.equal(result.acknowledgement.ok, false);
  assert.equal(result.blocker, 'CANONICAL_GOAL_BUILD_INGRESS_ACKNOWLEDGEMENT_EXCEPTION:ENOSPC');
  assert.equal(wakeCalls.length, 1);
  assert.match(result.contextBlock, /completion handoff was published/i);
  assert.match(result.contextBlock, /do not claim that the Octopus received or executed it/i);
});
