import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTIVE_COMMAND_CLASS,
  EXECUTIVE_COMMAND_STATUS,
  buildStephanosExecutiveAuthorityContract,
  createStephanosExecutiveCommandPlan,
  createStephanosFlywheelDialogue,
  validateStephanosExecutiveCommandPlan,
} from './stephanosExecutiveCommandPlaneV1.mjs';

const NOW = '2026-09-25T17:30:00.000Z';
const FRESH = '2026-09-25T17:25:00.000Z';

function goal(issue, overrides = {}) {
  return {
    issue,
    title: 'Goal ' + issue,
    state: 'QUEUED',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
    ...overrides,
  };
}

function schedulerInput(overrides = {}) {
  return {
    now: NOW,
    goals: [goal(1556, { priority: 10 })],
    ...overrides,
  };
}

test('executive authority makes Stephanos mission owner without creating a second control plane', () => {
  const contract = buildStephanosExecutiveAuthorityContract();

  assert.equal(contract.stephanosRole, 'EXECUTIVE_MISSION_OWNER');
  assert.equal(contract.authority.mayQueryProgrammeTruth, true);
  assert.equal(contract.authority.maySelectQualifiedAgent, true);
  assert.equal(contract.authority.mayRequestBoundedAgentWork, true);
  assert.equal(contract.authority.mayBypassScheduler, false);
  assert.equal(contract.authority.mayCreateParallelController, false);
  assert.equal(contract.authority.maySeizeMutationLease, false);
  assert.equal(contract.authority.maySelfApproveReservedAction, false);
  assert.equal(contract.authority.maySelfMerge, false);
});

test('Stephanos can talk directly to the canonical goal flywheel and receive its selected goal', () => {
  const dialogue = createStephanosFlywheelDialogue({
    question: 'What should we build next?',
    schedulerInput: schedulerInput(),
  });

  assert.equal(dialogue.failClosed, false);
  assert.equal(dialogue.selectedGoal, '#1556');
  assert.equal(dialogue.selectedRoute, 'CHATGPT_GITHUB');
  assert.equal(dialogue.operatorNeeded, false);
  assert.equal(dialogue.finalVerdict, 'STEPHANOS_FLYWHEEL_DIALOGUE_READY');
  assert.equal(dialogue.answer.selectedGoal, '#1556');
});

test('Stephanos can select a qualified agent but delegation preserves canonical execution authority', () => {
  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: 'Use the UI specialist to audit the Goal Dashboard.',
    commandClass: EXECUTIVE_COMMAND_CLASS.REQUEST_AGENT_TASK,
    taskType: 'UI_AUDIT',
    schedulerInput: schedulerInput(),
    agents: [
      {
        agentId: 'user-interface-agent',
        agentClass: 'USER_INTERFACE_AND_EXPERIENCE_SPECIALIST',
        lifecycleState: 'PRODUCTION_ELIGIBLE',
        acceptedTaskTypes: ['UI_AUDIT', 'UI_REVIEW'],
        available: true,
        proofRefs: ['proof://ui-agent-qualified'],
      },
    ],
  });

  assert.equal(plan.status, EXECUTIVE_COMMAND_STATUS.READY_TO_DELEGATE);
  assert.equal(plan.delegation.selectedAgentId, 'user-interface-agent');
  assert.equal(plan.delegation.selectedGoal, '#1556');
  assert.equal(plan.delegation.dispatchThroughCanonicalFabric, true);
  assert.equal(plan.delegation.directMutationAuthority, false);
  assert.equal(plan.delegation.leaseSeizureAllowed, false);
  assert.equal(plan.delegation.bypassApprovalAllowed, false);
  assert.equal(plan.delegation.parallelControllerAllowed, false);
  assert.equal(validateStephanosExecutiveCommandPlan(plan).valid, true);
});

test('an unqualified requested agent is blocked rather than silently promoted', () => {
  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: 'Ask the UI specialist to mutate backend runtime code.',
    commandClass: EXECUTIVE_COMMAND_CLASS.REQUEST_AGENT_TASK,
    taskType: 'BACKEND_RUNTIME_MUTATION',
    requestedAgentId: 'user-interface-agent',
    schedulerInput: schedulerInput(),
    agents: [
      {
        agentId: 'user-interface-agent',
        lifecycleState: 'PRODUCTION_ELIGIBLE',
        acceptedTaskTypes: ['UI_AUDIT'],
        available: true,
      },
    ],
  });

  assert.equal(plan.status, EXECUTIVE_COMMAND_STATUS.BLOCKED);
  assert.equal(plan.blocker, 'REQUESTED_AGENT_NOT_QUALIFIED_FOR_TASK');
  assert.equal(validateStephanosExecutiveCommandPlan(plan).valid, true);
});

test('scheduler contradictions fail the executive command plane closed', () => {
  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: 'Continue autonomous building.',
    commandClass: EXECUTIVE_COMMAND_CLASS.REQUEST_SYSTEM_ACTION,
    schedulerInput: schedulerInput({
      goals: [
        goal(1, { prerequisites: [2] }),
        goal(2, { prerequisites: [1] }),
      ],
    }),
  });

  assert.equal(plan.status, EXECUTIVE_COMMAND_STATUS.BLOCKED);
  assert.equal(plan.blocker, 'FLYWHEEL_FAIL_CLOSED');
  assert.equal(plan.flywheel.failClosed, true);
  assert.equal(validateStephanosExecutiveCommandPlan(plan).valid, true);
});

test('unknown systems cannot be smuggled into the executive command plane', () => {
  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: 'Send this to an arbitrary hidden executor.',
    commandClass: EXECUTIVE_COMMAND_CLASS.REQUEST_SYSTEM_ACTION,
    targetSystem: 'secret-root-shell',
    schedulerInput: schedulerInput(),
  });

  assert.equal(plan.status, EXECUTIVE_COMMAND_STATUS.BLOCKED);
  assert.equal(plan.blocker, 'TARGET_SYSTEM_NOT_CANONICAL');
  assert.equal(plan.delegation.directMutationAuthority, false);
  assert.equal(validateStephanosExecutiveCommandPlan(plan).valid, true);
});

test('duplicate agent identities block delegation rather than creating two owners', () => {
  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: 'Delegate one UI audit.',
    commandClass: EXECUTIVE_COMMAND_CLASS.REQUEST_AGENT_TASK,
    taskType: 'UI_AUDIT',
    schedulerInput: schedulerInput(),
    agents: [
      {
        agentId: 'user-interface-agent',
        lifecycleState: 'PRODUCTION_ELIGIBLE',
        acceptedTaskTypes: ['UI_AUDIT'],
      },
      {
        agentId: 'user-interface-agent',
        lifecycleState: 'PRODUCTION_ELIGIBLE',
        acceptedTaskTypes: ['UI_AUDIT'],
      },
    ],
  });

  assert.equal(plan.status, EXECUTIVE_COMMAND_STATUS.BLOCKED);
  assert.equal(plan.blocker, 'DUPLICATE_AGENT_IDENTITY');
  assert.deepEqual(plan.registry.duplicateAgentIds, ['user-interface-agent']);
  assert.equal(validateStephanosExecutiveCommandPlan(plan).valid, true);
});
