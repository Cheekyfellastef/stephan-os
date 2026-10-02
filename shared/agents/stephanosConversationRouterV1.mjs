export const STEPHANOS_CONVERSATION_ROUTER_SCHEMA_VERSION = 'stephanos.conversation-router.v1';

export const STEPHANOS_CONVERSATION_TARGETS = Object.freeze([
  Object.freeze({
    id: 'stephanos',
    label: 'Stephanos AI',
    capability: 'PRIMARY_SYNTHESIZER',
    directReplyInAiRoute: true,
    availability: 'LIVE',
  }),
  Object.freeze({
    id: 'flywheel',
    label: 'Flywheel',
    capability: 'DIALOGUE_GROUNDED',
    directReplyInAiRoute: false,
    availability: 'AVAILABLE_VIA_STEPHANOS',
  }),
  Object.freeze({
    id: 'vr-agent',
    label: 'VR Agent',
    capability: 'BOUNDED_QA_CONTRACT',
    canonicalParticipantId: 'stephanos-vr-research',
    directReplyInAiRoute: false,
    availability: 'CONTRACT_PRESENT_NOT_DIRECTLY_DISPATCHED',
  }),
  Object.freeze({
    id: 'sovereign-commander',
    label: 'Sovereign Commander',
    capability: 'GUARDED_COMMAND_SURFACE',
    directReplyInAiRoute: false,
    availability: 'ADDRESSABLE_NOT_CONVERSATIONAL',
  }),
  Object.freeze({
    id: 'openclaw-local',
    label: 'OpenClaw Local',
    capability: 'STEPHANOS_SCOPED_EXECUTION_WORKER',
    directReplyInAiRoute: false,
    availability: 'WORKER_NOT_CONVERSATIONAL',
  }),
  Object.freeze({
    id: 'openclaw-standalone',
    label: 'OpenClaw Standalone',
    capability: 'WHOLE_PC_EXECUTION_WORKER',
    directReplyInAiRoute: false,
    availability: 'WORKER_NOT_CONVERSATIONAL',
  }),
  Object.freeze({
    id: 'builders',
    label: 'Builders',
    capability: 'TEAM_PROJECTION',
    directReplyInAiRoute: false,
    availability: 'TEAM_NOT_SINGLE_CONVERSATIONAL_PARTICIPANT',
  }),
  Object.freeze({
    id: 'controllers',
    label: 'Controllers',
    capability: 'TEAM_PROJECTION',
    directReplyInAiRoute: false,
    availability: 'TEAM_NOT_SINGLE_CONVERSATIONAL_PARTICIPANT',
  }),
  Object.freeze({
    id: 'research',
    label: 'Research',
    capability: 'RESEARCH_ROUTE',
    directReplyInAiRoute: false,
    availability: 'ROUTE_NOT_SINGLE_CONVERSATIONAL_PARTICIPANT',
  }),
  Object.freeze({
    id: 'battle-bridge',
    label: 'Battle Bridge',
    capability: 'RUNTIME_TRUTH_SOURCE',
    directReplyInAiRoute: false,
    availability: 'STATUS_SOURCE_NOT_CONVERSATIONAL',
  }),
]);

const TARGET_BY_ID = new Map(STEPHANOS_CONVERSATION_TARGETS.map((target) => [target.id, target]));
const MAX_CONTRIBUTORS = 3;

const ROUTE_RULES = Object.freeze([
  Object.freeze({ id: 'vr-agent', pattern: /\b(vr|virtual reality|starfield|skyrim|quest ?3|vorpx|mutar|openxr|stereo|headset|aer|frame pacing)\b/i }),
  Object.freeze({ id: 'sovereign-commander', pattern: /\b(sovereign commander|commander|meter|mailbox|battle bridge command|pc command)\b/i }),
  Object.freeze({ id: 'battle-bridge', pattern: /\b(battle bridge|telemetry|runtime health|machine health|service health|disk|gpu|vram)\b/i }),
  Object.freeze({ id: 'flywheel', pattern: /\b(flywheel|learn|learning|uplift|improve|improvement|capability gap|next best|what should.*next)\b/i }),
  Object.freeze({ id: 'openclaw-local', pattern: /\b(openclaw local|local openclaw)\b/i }),
  Object.freeze({ id: 'openclaw-standalone', pattern: /\b(openclaw standalone|standalone openclaw|whole pc)\b/i }),
  Object.freeze({ id: 'builders', pattern: /\b(builder|builders|build lane|merge-ready|merge ready|pull request|\bpr\b|implementation lane)\b/i }),
  Object.freeze({ id: 'controllers', pattern: /\b(controller|controllers|scheduler|orchestrator|mission loop|hourly controller)\b/i }),
  Object.freeze({ id: 'research', pattern: /\b(research|evidence|source|sources|investigate|scout|compare approaches)\b/i }),
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeRequestedTarget(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized || normalized === 'everyone') return 'everyone';
  if (normalized === 'stephanos-ai' || normalized === 'stephanos ai') return 'stephanos';
  return normalized;
}

function contributorsForPrompt(prompt) {
  const selected = [];
  for (const rule of ROUTE_RULES) {
    if (!rule.pattern.test(prompt)) continue;
    if (!selected.includes(rule.id)) selected.push(rule.id);
    if (selected.length >= MAX_CONTRIBUTORS) break;
  }
  return selected;
}

function targetProjection(id) {
  const target = TARGET_BY_ID.get(id);
  return target ? freeze({ ...target }) : null;
}

function contextBlockFor(route) {
  const contributors = route.selectedContributors.length
    ? route.selectedContributors.map((entry) => `${entry.label} [${entry.capability}; ${entry.availability}]`).join(', ')
    : 'none';
  return [
    'Stephanos AI conversation router:',
    `requestedTarget: ${route.requestedTargetId}.`,
    `responder: ${route.responder.label}.`,
    `routeState: ${route.routeState}.`,
    `selectedContributors: ${contributors}.`,
    'Only the responder may be presented as having answered this turn.',
    'Contributor selection is context/routing evidence, not proof that the contributor executed a live independent chat turn.',
    'When a selected contributor is not directly conversational, Stephanos must synthesize from canonical project context and clearly avoid pretending that participant spoke.',
  ].join('\n');
}

export function routeStephanosConversationV1(input = {}) {
  const prompt = text(input.prompt);
  const requestedTargetId = normalizeRequestedTarget(input.requestedTargetId);
  let routeState = 'DIRECT_STEPHANOS';
  let selectedContributorIds = [];
  let reason = 'DEFAULT_PRIMARY_SYNTHESIZER';

  if (requestedTargetId === 'everyone') {
    selectedContributorIds = contributorsForPrompt(prompt);
    if (selectedContributorIds.length > 0) {
      routeState = 'STEPHANOS_SYNTHESIS_WITH_RELEVANT_CONTRIBUTORS';
      reason = 'EVERYONE_AUTO_ROUTED_BY_PROMPT';
    }
  } else if (requestedTargetId === 'stephanos') {
    reason = 'STEPHANOS_EXPLICITLY_ADDRESSED';
  } else if (TARGET_BY_ID.has(requestedTargetId)) {
    selectedContributorIds = [requestedTargetId];
    routeState = 'STEPHANOS_SYNTHESIS_FOR_EXPLICIT_TARGET';
    reason = 'EXPLICIT_TARGET_NOT_DIRECTLY_DISPATCHED_ON_AI_ROUTE';
  } else {
    routeState = 'UNKNOWN_TARGET_FALLBACK_TO_STEPHANOS';
    reason = 'REQUESTED_TARGET_NOT_REGISTERED';
  }

  const selectedContributors = selectedContributorIds
    .map(targetProjection)
    .filter(Boolean);
  const responder = targetProjection('stephanos');
  const directlyConversationalTargetIds = STEPHANOS_CONVERSATION_TARGETS
    .filter((target) => target.directReplyInAiRoute)
    .map((target) => target.id);
  const unavailableDirectTargetIds = STEPHANOS_CONVERSATION_TARGETS
    .filter((target) => !target.directReplyInAiRoute)
    .map((target) => target.id);

  const base = {
    schemaVersion: STEPHANOS_CONVERSATION_ROUTER_SCHEMA_VERSION,
    requestedTargetId,
    routeState,
    reason,
    responder,
    selectedContributors,
    directlyConversationalTargetIds,
    unavailableDirectTargetIds,
    allTargetCapabilities: STEPHANOS_CONVERSATION_TARGETS,
    directParticipantDispatchProven: false,
  };

  return freeze({
    ...base,
    contextBlock: contextBlockFor(base),
  });
}
