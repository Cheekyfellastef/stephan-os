import {
  EXECUTIVE_COMMAND_CLASS,
  EXECUTIVE_COMMAND_STATUS,
  createStephanosExecutiveCommandPlan,
  createStephanosExecutiveDelegationHandoff,
} from '../../shared/agents/stephanosExecutiveCommandPlaneV1.mjs';
import { writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { readAuthoritativeProgrammeProjection } from './programmeAuthorityService.js';

export const STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA =
  'stephanos.executive-chat-bridge.v1';

export const STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE = Object.freeze({
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  GROUNDING_READY: 'GROUNDING_READY',
  DELEGATION_PUBLISHED: 'DELEGATION_PUBLISHED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  WAITING_FOR_ELIGIBLE_WORK: 'WAITING_FOR_ELIGIBLE_WORK',
  SAFE_HOLD: 'SAFE_HOLD',
});

const PROJECT_RELEVANT =
  /\b(stephanos|goal|flywheel|agent|agents|octopus|build|building|fix|repair|continue|controller|worker|mission|project|openclaw|battle bridge|mailbox|verify|verification|proof|system|systems|provider|shared workspace)\b/i;

const EXPLICIT_ACTION_PATTERNS = Object.freeze([
  /^\s*(?:please\s+|let(?:'|’)s\s+)?(?:build|fix|repair|continue|resume|run|start|restart|delegate|dispatch|use|finish|complete|push)\b/i,
  /^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:build|fix|repair|continue|resume|run|start|restart|delegate|dispatch|use|finish|complete|push)\b/i,
  /^\s*(?:i\s+(?:want|need)\s+you\s+to\s+)(?:build|fix|repair|continue|resume|run|start|restart|delegate|dispatch|use|finish|complete|push)\b/i,
  /\bkeep\s+going\b/i,
  /\bget\s+(?:the\s+)?(?:octopus|agent|worker|flywheel|stephanos)\s+to\s+(?:work|build|fix|repair|continue|run|start|resume|finish|complete|push)\b/i,
  /\b(?:ask|tell)\s+(?:the\s+)?(?:octopus|agent|worker|flywheel|stephanos)\s+to\s+(?:work|build|fix|repair|continue|run|start|resume|finish|complete|push)\b/i,
  /\bhave\s+(?:the\s+)?(?:octopus|agent|worker|flywheel|stephanos)\s+(?:to\s+)?(?:work|build|fix|repair|continue|run|start|resume|finish|complete|push)\b/i,
  /\bstephanos\b.{0,80}\b(?:ask|asks|asking|tell|tells|telling|direct|directs|directing|have|has|having)\s+(?:the\s+)?(?:octopus|agent|worker|flywheel)\s+to\s+(?:work|build|fix|repair|continue|run|start|resume|finish|complete|push)\b/i,
]);

function isExplicitAction(prompt = '') {
  return EXPLICIT_ACTION_PATTERNS.some((pattern) => pattern.test(text(prompt)));
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
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

function safeId(value, fallback = '') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function targetForPrompt(prompt = '') {
  const normalized = text(prompt).toLowerCase();
  if (/\b(verification harness|verify|verification|proof)\b/.test(normalized)) return 'verification-harness';
  if (/\b(recovery mesh|recover battle bridge)\b/.test(normalized)) return 'battle-bridge-recovery-mesh';
  if (/\b(mailbox|battle bridge command)\b/.test(normalized)) return 'battle-bridge-github-command-mailbox';
  if (/\b(shared workspace|workspace fabric)\b/.test(normalized)) return 'shared-agent-workspace';
  if (/\b(openclaw)\b/.test(normalized)) return 'openclaw-gateway';
  if (/\b(provider|router|routing)\b/.test(normalized)) return 'provider-router';
  if (/\b(flywheel)\b/.test(normalized) && !isExplicitAction(normalized)) return 'goal-flywheel';
  return 'mission-orchestrator-worker';
}

export function classifyStephanosExecutiveChatIntent(prompt = '') {
  const normalized = text(prompt);
  if (!normalized || !PROJECT_RELEVANT.test(normalized)) {
    return freeze({
      applies: false,
      explicitActionRequested: false,
      commandClass: EXECUTIVE_COMMAND_CLASS.OBSERVE,
      targetSystem: null,
      reason: 'NO_EXECUTIVE_PROGRAMME_SIGNAL',
    });
  }
  const explicitActionRequested = isExplicitAction(normalized);
  const targetSystem = targetForPrompt(normalized);
  const commandClass = explicitActionRequested
    ? EXECUTIVE_COMMAND_CLASS.REQUEST_SYSTEM_ACTION
    : EXECUTIVE_COMMAND_CLASS.ASK_FLYWHEEL;
  return freeze({
    applies: true,
    explicitActionRequested,
    commandClass,
    targetSystem,
    reason: explicitActionRequested
      ? 'EXPLICIT_PROGRAMME_ACTION_REQUEST'
      : 'PROGRAMME_GROUNDING_REQUEST',
  });
}

function contextBlock(result = {}) {
  if (result.state === STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.NOT_APPLICABLE) return '';
  const plan = result.plan || {};
  const flywheel = plan.flywheel || {};
  const delegation = plan.delegation || {};
  const goalCompletion = delegation.goalCompletionContract || {};
  const handoff = result.handoff || {};
  const published = result.state === STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.DELEGATION_PUBLISHED;
  const approval = result.state === STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.APPROVAL_REQUIRED;
  return [
    'Stephanos Executive Command Plane (canonical programme grounding):',
    'Stephanos role: EXECUTIVE_MISSION_OWNER.',
    `Programme status: ${text(flywheel.programmeStatus, 'UNKNOWN')}.`,
    `Selected goal: ${text(flywheel.selectedGoal, 'none')}.`,
    `Selected route: ${text(flywheel.selectedRoute, 'none')}.`,
    `Why now: ${text(flywheel.whyNow, 'No scheduler rationale available.')}.`,
    `Operator needed: ${flywheel.operatorNeeded === true ? 'yes' : 'no'}.`,
    `Executive command status: ${text(plan.status, 'UNKNOWN')}.`,
    `Target system: ${text(delegation.targetSystem, 'none')}.`,
    published
      ? goalCompletion.completionRequired === true
        ? `Stephanos has told the canonical goal-building fabric to complete ${text(goalCompletion.selectedGoal, flywheel.selectedGoal || 'the selected goal')}, require terminal proof and exact-head review handoff, release the construction slot, select the next eligible goal, and keep going. Delegation: ${text(handoff.record?.handoffId, 'unknown')}. Do not claim completion until durable receipts prove it.`
        : `A bounded Shared Workspace delegation has already been published as ${text(handoff.record?.handoffId, 'unknown')}. Do not claim the delegated work is complete until a durable execution receipt proves the outcome.`
      : approval
        ? 'The requested action is approval-bound. Explain the existing approval gate; do not claim the action executed.'
        : result.classification?.explicitActionRequested
          ? 'No execution should be claimed unless the bridge state proves a delegation was published.'
          : 'This request is read-only programme dialogue. Answer from the flywheel truth without creating work.',
    'Never invent a second scheduler, controller, mutation lease, merge path, deployment path, or approval route.',
  ].join('\n');
}

function safeHold(classification, blocker, additions = {}) {
  const result = {
    schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
    state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.SAFE_HOLD,
    classification,
    blocker: text(blocker, 'EXECUTIVE_CHAT_BRIDGE_BLOCKED'),
    plan: additions.plan || null,
    handoff: additions.handoff || null,
    publication: additions.publication || null,
    programmeProjection: additions.programmeProjection || null,
  };
  return freeze({ ...result, contextBlock: contextBlock(result) });
}

export async function buildStephanosExecutiveChatBridge(input = {}, options = {}) {
  const prompt = text(input.prompt);
  const classification = classifyStephanosExecutiveChatIntent(prompt);
  if (!classification.applies) {
    return freeze({
      schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
      state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.NOT_APPLICABLE,
      classification,
      blocker: null,
      plan: null,
      handoff: null,
      publication: null,
      programmeProjection: null,
      contextBlock: '',
    });
  }

  if (options.dependencies && options.testOnly !== true) {
    throw new TypeError('dependency overrides are test-only');
  }
  const deps = {
    readProgrammeProjection: readAuthoritativeProgrammeProjection,
    writeRecord: writeAtomicJson,
    ...(options.dependencies || {}),
  };
  const nowUtc = text(input.nowUtc, new Date().toISOString());
  const repoRoot = text(input.repoRoot, process.cwd());
  const programmeProjection = await deps.readProgrammeProjection({
    env: input.env || process.env,
    repoRoot,
    nowUtc,
    correlationId: safeId(input.requestId, 'stephanos-chat'),
  });

  if (!programmeProjection?.scheduler) {
    return safeHold(classification, programmeProjection?.blockers?.[0] || 'AUTHORITATIVE_PROGRAMME_PROJECTION_UNAVAILABLE', {
      programmeProjection,
    });
  }

  const plan = createStephanosExecutiveCommandPlan({
    operatorIntent: prompt,
    question: prompt,
    commandClass: classification.commandClass,
    targetSystem: classification.targetSystem,
    schedulerProjection: programmeProjection.scheduler,
    sourceHead: programmeProjection?.machineryInventory?.sourceHead,
    generatedAtUtc: nowUtc,
  });

  if (!classification.explicitActionRequested) {
    const result = {
      schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
      state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.GROUNDING_READY,
      classification,
      blocker: plan.blocker,
      plan,
      handoff: null,
      publication: null,
      programmeProjection,
    };
    return freeze({ ...result, contextBlock: contextBlock(result) });
  }

  if (plan.status === EXECUTIVE_COMMAND_STATUS.OPERATOR_APPROVAL_REQUIRED) {
    const result = {
      schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
      state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.APPROVAL_REQUIRED,
      classification,
      blocker: null,
      plan,
      handoff: null,
      publication: null,
      programmeProjection,
    };
    return freeze({ ...result, contextBlock: contextBlock(result) });
  }

  if (plan.status === EXECUTIVE_COMMAND_STATUS.WAITING_FOR_ELIGIBLE_WORK) {
    const result = {
      schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
      state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.WAITING_FOR_ELIGIBLE_WORK,
      classification,
      blocker: null,
      plan,
      handoff: null,
      publication: null,
      programmeProjection,
    };
    return freeze({ ...result, contextBlock: contextBlock(result) });
  }

  if (plan.status !== EXECUTIVE_COMMAND_STATUS.READY_TO_DELEGATE) {
    return safeHold(classification, plan.blocker || 'EXECUTIVE_PLAN_NOT_READY_TO_DELEGATE', {
      plan,
      programmeProjection,
    });
  }

  const requestId = safeId(input.requestId, 'request');
  const timeId = String(Date.parse(nowUtc)).replace(/[^0-9]/g, '');
  const correlationId = safeId(`stephanos-chat-${requestId}-${timeId}`, 'stephanos-chat-current');
  const handoff = createStephanosExecutiveDelegationHandoff({
    plan,
    timestampUtc: nowUtc,
    correlationId,
    handoffId: safeId(`${correlationId}-handoff`, 'stephanos-chat-handoff'),
    toParticipantId: 'mission-orchestrator',
    nowMs: Date.parse(nowUtc),
  });
  if (!handoff.valid || !handoff.record) {
    return safeHold(classification, handoff.blocker || 'EXECUTIVE_HANDOFF_NOT_READY', {
      plan,
      handoff,
      programmeProjection,
    });
  }

  const workspaceRoot = text(programmeProjection?.sourceReads?.workspaceConfig?.root);
  if (!workspaceRoot) {
    return safeHold(classification, 'SHARED_WORKSPACE_ROOT_UNAVAILABLE', {
      plan,
      handoff,
      programmeProjection,
    });
  }

  const publication = await deps.writeRecord(
    workspaceRoot,
    ['handoffs', `${handoff.record.handoffId}.json`],
    handoff.record,
    { repoRoot, nowMs: Date.parse(nowUtc) },
  );
  if (!publication?.ok) {
    return safeHold(classification, publication?.reason || 'EXECUTIVE_HANDOFF_PUBLICATION_FAILED', {
      plan,
      handoff,
      publication,
      programmeProjection,
    });
  }

  const result = {
    schemaVersion: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_SCHEMA,
    state: STEPHANOS_EXECUTIVE_CHAT_BRIDGE_STATE.DELEGATION_PUBLISHED,
    classification,
    blocker: null,
    plan,
    handoff,
    publication,
    programmeProjection,
  };
  return freeze({ ...result, contextBlock: contextBlock(result) });
}
