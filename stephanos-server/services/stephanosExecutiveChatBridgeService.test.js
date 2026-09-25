import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE,
  buildStephanosExecutiveChatBridge,
  classifyStephanosExecutiveChatIntent,
} from './stephanosExecutiveChatBridgeService.js';

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

function deps(programmeProjection = projection()) {
  const writes = [];
  return {
    writes,
    options: {
      testOnly: true,
      dependencies: {
        readProgrammeProjection: async () => programmeProjection,
        writeRecord: async (root, segments, record) => {
          writes.push({ root, segments, record });
          return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: root + '/' + segments.join('/') };
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
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0].segments, ['handoffs', result.handoff.record.handoffId + '.json']);
  assert.equal(result.handoff.record.participantId, 'stephanos');
  assert.equal(result.handoff.record.fromParticipantId, 'stephanos');
  assert.equal(result.handoff.record.toParticipantId, 'mission-orchestrator');
  const body = JSON.parse(result.handoff.record.body);
  assert.equal(body.authority.directMutationAuthority, false);
  assert.equal(body.authority.leaseSeizureAllowed, false);
  assert.equal(body.authority.bypassApprovalAllowed, false);
  assert.equal(body.returnContract.durableReceiptRequired, true);
  assert.match(result.contextBlock, /Do not claim the delegated work is complete until a durable execution receipt/i);
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
  const question = classifyStephanosExecutiveChatIntent('What is the current goal and why is it blocked?');
  const action = classifyStephanosExecutiveChatIntent('Please repair the current goal and keep going.');

  assert.equal(question.applies, true);
  assert.equal(question.explicitActionRequested, false);
  assert.equal(question.commandClass, 'ASK_FLYWHEEL');
  assert.equal(action.applies, true);
  assert.equal(action.explicitActionRequested, true);
  assert.equal(action.commandClass, 'REQUEST_SYSTEM_ACTION');
});
