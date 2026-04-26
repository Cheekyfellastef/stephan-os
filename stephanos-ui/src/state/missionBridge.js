import { classifyOperatorIntent } from '../ai/intentEngine.js';
import { buildMissionExecutionPacket } from '../ai/missionExecutionEngine.js';

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function deriveExecutionReadiness({ routeTruthView = {}, backendExecutionContractStatus = '', providerExecutionGateStatus = '' } = {}) {
  const routeHealthy = asText(routeTruthView?.routeLayerStatus).toLowerCase() === 'healthy'
    || asText(routeTruthView?.routeUsableState).toLowerCase() === 'yes';
  const backendValidated = asText(backendExecutionContractStatus || routeTruthView?.backendExecutionContractStatus).toLowerCase() === 'validated';
  const providerGateOpen = asText(providerExecutionGateStatus || routeTruthView?.providerExecutionGateStatus).toLowerCase() === 'open';
  return {
    routeHealthy,
    backendValidated,
    providerGateOpen,
    allowedForReasoning: routeHealthy && backendValidated && providerGateOpen,
  };
}

function buildDerivedOrchestration(packet = {}, { finalAgentView = {} } = {}) {
  const assignments = asArray(packet.agentAssignments);
  const tools = asArray(packet.toolPlan);
  const blocked = asArray(packet.blockers);
  const queue = asArray(finalAgentView?.finalApprovalQueueView?.queue);
  const pendingApprovals = queue.filter((entry) => entry?.approvalState === 'pending');
  const actingAgent = assignments[0]?.roleId || finalAgentView?.actingAgentId || 'intent-engine';

  return {
    activeGoals: [asText(packet.missionTitle, 'Mission goal')].filter(Boolean),
    openTasks: tools.map((tool) => asText(tool.toolType || tool.toolId)).filter(Boolean),
    pendingApprovals: pendingApprovals.map((entry) => entry.taskId).filter(Boolean),
    blockedTasks: blocked,
    resumableTasks: blocked.length === 0 ? tools.slice(0, 1).map((tool) => asText(tool.toolType || tool.toolId)).filter(Boolean) : [],
    actingAgent,
    waitingAgents: asArray(finalAgentView?.waitingAgentIds),
    blockedAgents: asArray(finalAgentView?.blockedAgentIds),
  };
}

export function createMissionBridgeState() {
  return {
    state: 'idle',
    missionPacketGeneratedFromOperatorIntent: false,
    missionPacket: null,
    orchestration: null,
    pendingApproval: false,
    latestAiResponse: '',
    nextRecommendedAction: 'Submit explicit operator intent.',
    lastAiRouterRequestSource: 'none',
    lastAiResponseRoutedToMissionConsole: false,
    localDesktopAgentGatePassed: false,
    events: [],
  };
}

export function processMissionBridgeIntent({
  operatorIntent = '',
  proposalPacket = {},
  missionWorkflow = {},
  graphState = {},
  finalRouteTruth = {},
  finalAgentView = {},
  backendExecutionContractStatus = '',
  providerExecutionGateStatus = '',
} = {}) {
  const intentText = asText(operatorIntent);
  const intentResult = classifyOperatorIntent({ prompt: intentText });
  const packet = buildMissionExecutionPacket({
    intent: intentResult,
    proposalPacket,
    missionWorkflow,
    graphState,
  });
  const readiness = deriveExecutionReadiness({ routeTruthView: finalRouteTruth, backendExecutionContractStatus, providerExecutionGateStatus });
  const unknownIntent = ['unknown', 'ambiguous'].includes(asText(intentResult.intentType).toLowerCase());
  const pendingApproval = packet.approvalRequired === true;
  const events = [];

  events.push({ type: 'mission-created', missionId: packet.missionId, missionTitle: packet.missionTitle });
  if (unknownIntent) {
    events.push({ type: 'mission-blocked', reason: 'Current intent is unknown; mission cannot safely advance.' });
  }
  if (pendingApproval) {
    events.push({ type: 'mission-awaiting-approval', missionId: packet.missionId });
    events.push({ type: 'approval-required', missionId: packet.missionId, reason: 'Execution remains approval-gated.' });
  }
  if (packet.codexHandoffEligible === true) {
    events.push({ type: 'codex-handoff-ready', missionId: packet.missionId });
  }

  const orchestration = buildDerivedOrchestration(packet, { finalAgentView });
  events.push({ type: 'agent-assigned', missionId: packet.missionId, actingAgent: orchestration.actingAgent });

  return {
    state: unknownIntent ? 'blocked' : pendingApproval ? 'awaiting-approval' : 'ready',
    missionPacketGeneratedFromOperatorIntent: intentText.length > 0,
    missionPacket: packet,
    orchestration,
    pendingApproval,
    localDesktopAgentGatePassed: readiness.allowedForReasoning,
    latestAiResponse: '',
    nextRecommendedAction: unknownIntent
      ? 'Clarify operator intent before requesting AI execution.'
      : pendingApproval
        ? 'Review mission packet and explicitly approve gated actions.'
        : 'Mission packet ready for supervised agent reasoning.',
    lastAiRouterRequestSource: 'none',
    lastAiResponseRoutedToMissionConsole: false,
    events,
  };
}

export async function requestMissionBridgeAI({ bridgeState = createMissionBridgeState(), invokeAi = null, prompt = '' } = {}) {
  const events = [];
  const missionId = bridgeState?.missionPacket?.missionId || '';
  events.push({ type: 'ai-request-started', missionId, source: 'mission-bridge' });
  if (typeof invokeAi !== 'function') {
    events.push({ type: 'mission-blocked', missionId, reason: 'AI router callback unavailable.' });
    return {
      ...bridgeState,
      lastAiRouterRequestSource: 'mission-bridge',
      lastAiResponseRoutedToMissionConsole: false,
      events: [...asArray(bridgeState.events), ...events],
    };
  }

  const result = await invokeAi(asText(prompt, bridgeState?.missionPacket?.missionTitle || 'Mission reasoning request'));
  const output = asText(result?.output || result?.output_text || result?.text, 'AI response received through router.');
  events.push({ type: 'ai-response-received', missionId, output });
  if (bridgeState?.pendingApproval === false) {
    events.push({ type: 'mission-complete', missionId });
  }

  return {
    ...bridgeState,
    latestAiResponse: output,
    lastAiRouterRequestSource: 'mission-bridge',
    lastAiResponseRoutedToMissionConsole: true,
    events: [...asArray(bridgeState.events), ...events],
  };
}
