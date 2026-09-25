import { answerMissionQuery, buildMissionScheduler } from '../runtime/missionScheduler.mjs';
import {
  buildStephanosIdentityPresenceKernel,
  validateStephanosIdentityPresenceKernel,
} from './stephanosIdentityPresenceKernelV1.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA =
  'stephanos.executive-command-plane.v1';

export const EXECUTIVE_COMMAND_CLASS = Object.freeze({
  ASK_FLYWHEEL: 'ASK_FLYWHEEL',
  REQUEST_AGENT_TASK: 'REQUEST_AGENT_TASK',
  REQUEST_SYSTEM_ACTION: 'REQUEST_SYSTEM_ACTION',
  CONTROL_REQUEST: 'CONTROL_REQUEST',
  OBSERVE: 'OBSERVE',
});

export const EXECUTIVE_COMMAND_STATUS = Object.freeze({
  ANSWER_READY: 'ANSWER_READY',
  READY_TO_DELEGATE: 'READY_TO_DELEGATE',
  OPERATOR_APPROVAL_REQUIRED: 'OPERATOR_APPROVAL_REQUIRED',
  WAITING_FOR_ELIGIBLE_WORK: 'WAITING_FOR_ELIGIBLE_WORK',
  BLOCKED: 'BLOCKED',
});

export const CANONICAL_EXECUTIVE_SYSTEMS = Object.freeze([
  'mission-scheduler',
  'goal-flywheel',
  'autonomous-build-continuity-controller',
  'shared-agent-workspace',
  'mission-worker',
  'provider-router',
  'review-fabric',
  'verification-harness',
  'battle-bridge',
]);

const EXECUTABLE_LIFECYCLE_STATES = new Set([
  'BOUNDED_EXECUTOR',
  'PRODUCTION_ELIGIBLE',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freeze(item)));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, freeze(nested)]),
    ));
  }
  return value;
}

function normalizeCommandClass(value) {
  const normalized = text(value, EXECUTIVE_COMMAND_CLASS.OBSERVE).toUpperCase();
  return Object.values(EXECUTIVE_COMMAND_CLASS).includes(normalized)
    ? normalized
    : EXECUTIVE_COMMAND_CLASS.OBSERVE;
}

function normalizeAgent(agent = {}) {
  return freeze({
    agentId: text(agent.agentId || agent.participantId),
    agentClass: text(agent.agentClass, 'UNKNOWN'),
    lifecycleState: text(agent.lifecycleState, 'DISCOVERED').toUpperCase(),
    acceptedTaskTypes: list(agent.acceptedTaskTypes).map((item) => item.toUpperCase()),
    qaCapability: text(agent.qaCapability),
    available: agent.available !== false,
    suspended: agent.suspended === true
      || text(agent.lifecycleState).toUpperCase() === 'SUSPENDED_OR_REVOKED',
    proofRefs: list(agent.proofRefs),
  });
}

function qualifiedForTask(agent = {}, taskType = '') {
  if (!agent.agentId || !agent.available || agent.suspended) return false;
  if (!EXECUTABLE_LIFECYCLE_STATES.has(agent.lifecycleState)) return false;
  const normalizedTask = text(taskType).toUpperCase();
  if (!normalizedTask) return true;
  return agent.acceptedTaskTypes.includes(normalizedTask);
}

export function buildStephanosExecutiveAuthorityContract() {
  return freeze({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    kind: 'stephanos.executive-command-plane.authority-contract',
    stephanosRole: 'EXECUTIVE_MISSION_OWNER',
    operatorRole: 'INTENT_JUDGMENT_AND_RESERVED_APPROVAL',
    programmeBrain: '#1556 — Goal: Mission Scheduler and Goal Flywheel V1',
    universalIntentOwner: '#1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1',
    selfImprovementOwner: '#1903 — Goal: Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1',
    canonicalSystems: CANONICAL_EXECUTIVE_SYSTEMS,
    authority: {
      mayQueryProgrammeTruth: true,
      maySelectQualifiedAgent: true,
      mayRequestBoundedAgentWork: true,
      mayRequestCanonicalSystemAction: true,
      mayReconcileSpecialistOutputs: true,
      mayBypassScheduler: false,
      mayCreateParallelController: false,
      maySeizeMutationLease: false,
      maySelfApproveReservedAction: false,
      maySelfMerge: false,
      maySilentlyWidenAuthority: false,
      directArbitraryShell: false,
    },
    executionRule:
      'Stephanos commands by bounded delegation through canonical machinery; execution authority remains with the existing scheduler, controller, lease, review, proof and approval contracts.',
    finalVerdict: 'STEPHANOS_EXECUTIVE_AUTHORITY_CONTRACT_READY',
  });
}

export function buildStephanosAgentCommandRegistry(input = {}) {
  const agents = Array.isArray(input.agents)
    ? input.agents.map((agent) => normalizeAgent(agent))
    : [];
  const byId = new Map();
  const duplicateAgentIds = [];
  for (const agent of agents) {
    if (!agent.agentId) continue;
    if (byId.has(agent.agentId)) duplicateAgentIds.push(agent.agentId);
    else byId.set(agent.agentId, agent);
  }
  const uniqueAgents = [...byId.values()];
  const eligibleAgents = uniqueAgents.filter((agent) => qualifiedForTask(agent, input.taskType));
  return freeze({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    kind: 'stephanos.executive-command-plane.agent-registry',
    agents: uniqueAgents,
    eligibleAgentIds: eligibleAgents.map((agent) => agent.agentId),
    duplicateAgentIds: [...new Set(duplicateAgentIds)],
    taskType: text(input.taskType).toUpperCase() || null,
    valid: duplicateAgentIds.length === 0,
    finalVerdict: duplicateAgentIds.length === 0
      ? 'STEPHANOS_AGENT_COMMAND_REGISTRY_READY'
      : 'STEPHANOS_AGENT_COMMAND_REGISTRY_BLOCKED',
  });
}

export function createStephanosFlywheelDialogue(input = {}) {
  const question = text(
    input.question || input.operatorIntent,
    'What is the highest-value safe thing to do next?',
  );
  const schedulerInput = input.schedulerInput && typeof input.schedulerInput === 'object'
    ? input.schedulerInput
    : {};
  const scheduler = buildMissionScheduler(schedulerInput);
  const answer = answerMissionQuery(schedulerInput, question);
  return freeze({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    kind: 'stephanos.executive-command-plane.flywheel-dialogue',
    question,
    programmeStatus: scheduler.programmeStatus,
    failClosed: scheduler.failClosed === true,
    selectedGoal: scheduler.selectedGoal,
    selectedRoute: scheduler.selectedRoute,
    selectedLifecycle: scheduler.selectedLifecycle,
    activeGoals: scheduler.activeGoals,
    activeLanes: scheduler.activeLanes,
    parallelCandidates: scheduler.parallelCandidates,
    nextEligible: scheduler.nextEligible,
    operatorNeeded: scheduler.operatorNeeded === true,
    operatorAction: scheduler.operatorAction,
    whyNow: scheduler.whyNow,
    blockers: scheduler.blockers,
    decisionReceipt: scheduler.decisionReceipt,
    answer,
    finalVerdict: scheduler.failClosed
      ? 'STEPHANOS_FLYWHEEL_DIALOGUE_BLOCKED'
      : 'STEPHANOS_FLYWHEEL_DIALOGUE_READY',
  });
}

function chooseAgent(registry, requestedAgentId, taskType) {
  const requested = text(requestedAgentId);
  if (requested) {
    const exact = registry.agents.find((agent) => agent.agentId === requested);
    if (!exact) return { agent: null, blocker: 'REQUESTED_AGENT_NOT_REGISTERED' };
    if (!qualifiedForTask(exact, taskType)) {
      return { agent: null, blocker: 'REQUESTED_AGENT_NOT_QUALIFIED_FOR_TASK' };
    }
    return { agent: exact, blocker: '' };
  }
  const first = registry.agents.find((agent) => qualifiedForTask(agent, taskType));
  return first
    ? { agent: first, blocker: '' }
    : { agent: null, blocker: 'NO_QUALIFIED_AGENT_AVAILABLE' };
}

function deriveStatus({
  commandClass,
  flywheel,
  registry,
  selectedAgent,
  blocker,
}) {
  if (blocker || flywheel.failClosed || registry.valid === false) {
    return EXECUTIVE_COMMAND_STATUS.BLOCKED;
  }
  if (flywheel.operatorNeeded) {
    return EXECUTIVE_COMMAND_STATUS.OPERATOR_APPROVAL_REQUIRED;
  }
  if (
    commandClass === EXECUTIVE_COMMAND_CLASS.ASK_FLYWHEEL
    || commandClass === EXECUTIVE_COMMAND_CLASS.OBSERVE
  ) {
    return EXECUTIVE_COMMAND_STATUS.ANSWER_READY;
  }
  if (
    commandClass === EXECUTIVE_COMMAND_CLASS.REQUEST_AGENT_TASK
    && !selectedAgent
  ) {
    return EXECUTIVE_COMMAND_STATUS.BLOCKED;
  }
  if (!flywheel.selectedGoal && commandClass !== EXECUTIVE_COMMAND_CLASS.CONTROL_REQUEST) {
    return EXECUTIVE_COMMAND_STATUS.WAITING_FOR_ELIGIBLE_WORK;
  }
  return EXECUTIVE_COMMAND_STATUS.READY_TO_DELEGATE;
}

export function createStephanosExecutiveCommandPlan(input = {}) {
  const identity = input.identityKernel || buildStephanosIdentityPresenceKernel();
  const identityValidation = validateStephanosIdentityPresenceKernel(identity);
  const authority = buildStephanosExecutiveAuthorityContract();
  const commandClass = normalizeCommandClass(input.commandClass);
  const operatorIntent = text(input.operatorIntent || input.question);
  const taskType = text(input.taskType).toUpperCase();
  const targetSystem = text(input.targetSystem).toLowerCase();
  const registry = buildStephanosAgentCommandRegistry({
    agents: Array.isArray(input.agents) ? input.agents : [],
    taskType,
  });
  const flywheel = createStephanosFlywheelDialogue({
    schedulerInput: input.schedulerInput,
    question: input.question || operatorIntent,
    operatorIntent,
  });

  let blocker = '';
  let selectedAgent = null;
  if (!identityValidation.valid) blocker = 'STEPHANOS_IDENTITY_KERNEL_INVALID';
  else if (!operatorIntent) blocker = 'OPERATOR_INTENT_REQUIRED';
  else if (flywheel.failClosed) blocker = 'FLYWHEEL_FAIL_CLOSED';
  else if (registry.valid === false) blocker = 'DUPLICATE_AGENT_IDENTITY';
  else if (
    targetSystem
    && !CANONICAL_EXECUTIVE_SYSTEMS.includes(targetSystem)
  ) blocker = 'TARGET_SYSTEM_NOT_CANONICAL';
  else if (commandClass === EXECUTIVE_COMMAND_CLASS.REQUEST_AGENT_TASK) {
    const chosen = chooseAgent(registry, input.requestedAgentId, taskType);
    selectedAgent = chosen.agent;
    blocker = chosen.blocker;
  }

  const status = deriveStatus({
    commandClass,
    flywheel,
    registry,
    selectedAgent,
    blocker,
  });

  const delegation = freeze({
    commandClass,
    targetSystem: targetSystem || (
      commandClass === EXECUTIVE_COMMAND_CLASS.ASK_FLYWHEEL
        ? 'goal-flywheel'
        : 'autonomous-build-continuity-controller'
    ),
    selectedAgentId: selectedAgent?.agentId || null,
    taskType: taskType || null,
    selectedGoal: flywheel.selectedGoal,
    selectedRoute: flywheel.selectedRoute,
    selectedLifecycle: flywheel.selectedLifecycle,
    dispatchThroughCanonicalFabric: true,
    directMutationAuthority: false,
    leaseSeizureAllowed: false,
    bypassApprovalAllowed: false,
    parallelControllerAllowed: false,
  });

  const nextAction = blocker
    ? 'Repair ' + blocker + ' before delegation.'
    : status === EXECUTIVE_COMMAND_STATUS.OPERATOR_APPROVAL_REQUIRED
      ? 'Surface the existing operator approval gate without creating a duplicate execution path.'
      : status === EXECUTIVE_COMMAND_STATUS.WAITING_FOR_ELIGIBLE_WORK
        ? 'Keep the flywheel live and wait for the next eligible canonical goal.'
        : status === EXECUTIVE_COMMAND_STATUS.READY_TO_DELEGATE
          ? 'Submit this bounded delegation through the existing controller/dispatch fabric and require its durable receipt.'
          : 'Return the flywheel answer and current programme truth to Stephanos.';

  return freeze({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    kind: 'stephanos.executive-command-plane.plan',
    identityVersion: identity.identityVersion,
    operatorIntent,
    commandClass,
    status,
    blocker: blocker || null,
    authority,
    registry,
    flywheel,
    delegation,
    nextAction,
    finalVerdict: status === EXECUTIVE_COMMAND_STATUS.BLOCKED
      ? 'STEPHANOS_EXECUTIVE_COMMAND_PLAN_BLOCKED'
      : 'STEPHANOS_EXECUTIVE_COMMAND_PLAN_READY',
  });
}

export function createStephanosExecutiveDelegationHandoff(input = {}) {
  const plan = input.plan?.kind === 'stephanos.executive-command-plane.plan'
    ? input.plan
    : createStephanosExecutiveCommandPlan(input);
  if (plan.status !== EXECUTIVE_COMMAND_STATUS.READY_TO_DELEGATE) {
    return freeze({
      schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
      kind: 'stephanos.executive-command-plane.delegation-handoff',
      valid: false,
      state: 'SAFE_HOLD',
      record: null,
      blocker: 'EXECUTIVE_PLAN_NOT_READY_TO_DELEGATE',
      finalVerdict: 'STEPHANOS_EXECUTIVE_DELEGATION_HANDOFF_BLOCKED',
    });
  }

  const proofRefs = list(input.proofRefs).length
    ? list(input.proofRefs)
    : list(plan.flywheel?.decisionReceipt?.proofRefs);
  if (proofRefs.length === 0) {
    return freeze({
      schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
      kind: 'stephanos.executive-command-plane.delegation-handoff',
      valid: false,
      state: 'SAFE_HOLD',
      record: null,
      blocker: 'DELEGATION_PROOF_REFERENCE_REQUIRED',
      finalVerdict: 'STEPHANOS_EXECUTIVE_DELEGATION_HANDOFF_BLOCKED',
    });
  }

  const relatedIssue = text(input.relatedIssue, plan.delegation?.selectedGoal || '');
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const correlationId = text(
    input.correlationId,
    'stephanos-executive-' + text(relatedIssue, 'current').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, ''),
  );
  const handoffId = text(input.handoffId, correlationId + '-handoff');
  const toParticipantId = text(
    input.toParticipantId,
    plan.delegation?.selectedAgentId || 'mission-worker',
  );

  const body = JSON.stringify({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    operatorIntent: plan.operatorIntent,
    commandClass: plan.commandClass,
    targetSystem: plan.delegation?.targetSystem,
    selectedAgentId: plan.delegation?.selectedAgentId,
    taskType: plan.delegation?.taskType,
    selectedGoal: plan.delegation?.selectedGoal,
    selectedRoute: plan.delegation?.selectedRoute,
    selectedLifecycle: plan.delegation?.selectedLifecycle,
    authority: {
      dispatchThroughCanonicalFabric: true,
      directMutationAuthority: false,
      leaseSeizureAllowed: false,
      bypassApprovalAllowed: false,
      parallelControllerAllowed: false,
    },
    returnContract: {
      durableReceiptRequired: true,
      specialistOutputIsFinalOutcome: false,
      reconcileBackToStephanos: true,
    },
  });

  const record = createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'stephanos',
    fromParticipantId: 'stephanos',
    toParticipantId,
    timestampUtc,
    correlationId,
    relatedIssue,
    relatedPr: text(input.relatedPr),
    proofRefs,
    summary: 'Stephanos executive delegation through the canonical control fabric.',
    body,
  });
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.parse(timestampUtc);
  const validation = validateSharedWorkspaceRecord(record, { nowMs });

  return freeze({
    schemaVersion: STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA,
    kind: 'stephanos.executive-command-plane.delegation-handoff',
    valid: validation.valid,
    state: validation.valid ? 'HANDOFF_READY' : 'SAFE_HOLD',
    record: validation.valid ? record : null,
    blocker: validation.valid ? null : validation.refusalReason || 'INVALID_SHARED_WORKSPACE_HANDOFF',
    validation,
    finalVerdict: validation.valid
      ? 'STEPHANOS_EXECUTIVE_DELEGATION_HANDOFF_READY'
      : 'STEPHANOS_EXECUTIVE_DELEGATION_HANDOFF_BLOCKED',
  });
}

export function validateStephanosExecutiveCommandPlan(plan = {}) {
  const errors = [];
  if (plan.schemaVersion !== STEPHANOS_EXECUTIVE_COMMAND_PLANE_SCHEMA) errors.push('invalid-schema-version');
  if (plan.kind !== 'stephanos.executive-command-plane.plan') errors.push('invalid-kind');
  if (!text(plan.identityVersion)) errors.push('missing-identity-version');
  if (!text(plan.operatorIntent)) errors.push('missing-operator-intent');
  if (!Object.values(EXECUTIVE_COMMAND_CLASS).includes(plan.commandClass)) errors.push('invalid-command-class');
  if (!Object.values(EXECUTIVE_COMMAND_STATUS).includes(plan.status)) errors.push('invalid-status');
  if (!plan.authority) errors.push('missing-authority-contract');
  if (!plan.registry) errors.push('missing-agent-registry');
  if (!plan.flywheel) errors.push('missing-flywheel-dialogue');
  if (!plan.delegation) errors.push('missing-delegation');
  if (plan.delegation?.directMutationAuthority !== false) errors.push('direct-mutation-authority-widened');
  if (plan.delegation?.leaseSeizureAllowed !== false) errors.push('lease-seizure-widened');
  if (plan.delegation?.bypassApprovalAllowed !== false) errors.push('approval-bypass-widened');
  if (plan.delegation?.parallelControllerAllowed !== false) errors.push('parallel-controller-widened');
  if (plan.status === EXECUTIVE_COMMAND_STATUS.BLOCKED && !text(plan.blocker)) errors.push('blocked-without-reason');

  return freeze({
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0
      ? 'STEPHANOS_EXECUTIVE_COMMAND_PLAN_PASS'
      : 'STEPHANOS_EXECUTIVE_COMMAND_PLAN_INVALID',
  });
}
