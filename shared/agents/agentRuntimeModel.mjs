const AGENT_STATES = new Set(['idle', 'watching', 'preparing', 'acting', 'waiting', 'blocked', 'failed', 'degraded', 'offline']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(state = '') {
  const normalized = String(state || '').trim().toLowerCase();
  return AGENT_STATES.has(normalized) ? normalized : 'idle';
}

export function createBaseAgentRuntimeState(agentId = '') {
  return {
    agentId,
    registered: true,
    enabled: false,
    eligible: false,
    ready: false,
    active: false,
    acting: false,
    state: 'offline',
    stateReason: 'Awaiting adjudication.',
    blockers: [],
    degraded: false,
    currentTaskId: '',
    currentTaskSummary: '',
    queueDepth: 0,
    handoffFromAgentId: '',
    handoffToAgentIds: [],
    lastActionAt: '',
    lastSuccessAt: '',
    lastFailureAt: '',
    recentEvents: [],
  };
}

export function buildAgentRuntimeModel({ registry = [], eventLog = [] } = {}) {
  const events = asArray(eventLog).filter((entry) => entry && typeof entry === 'object');

  return asArray(registry).map((agent) => {
    const state = createBaseAgentRuntimeState(agent.agentId);
    const relevant = events.filter((entry) => entry.agentId === agent.agentId);
    state.recentEvents = relevant.slice(-12);

    for (const event of relevant) {
      const type = String(event.type || '').trim().toLowerCase();
      if (type === 'queue-depth' && Number.isFinite(event.queueDepth)) {
        state.queueDepth = Math.max(0, Number(event.queueDepth));
      }
      if (type === 'task') {
        state.currentTaskId = String(event.taskId || state.currentTaskId || '');
        state.currentTaskSummary = String(event.taskSummary || state.currentTaskSummary || '');
      }
      if (type === 'handoff') {
        state.handoffFromAgentId = String(event.fromAgentId || state.handoffFromAgentId || '');
        if (event.toAgentId) {
          state.handoffToAgentIds = Array.from(new Set([...state.handoffToAgentIds, String(event.toAgentId)]));
        }
      }
      if (type === 'action') {
        state.lastActionAt = String(event.at || state.lastActionAt || '');
      }
      if (type === 'success') {
        state.lastSuccessAt = String(event.at || state.lastSuccessAt || '');
      }
      if (type === 'failure') {
        state.lastFailureAt = String(event.at || state.lastFailureAt || '');
      }
      if (event.state) {
        state.state = normalizeState(event.state);
        state.stateReason = String(event.reason || state.stateReason || '');
      }
      if (Array.isArray(event.blockers)) {
        state.blockers = event.blockers.map((entry) => String(entry || '').trim()).filter(Boolean);
      }
      if (event.degraded === true) {
        state.degraded = true;
      }
    }

    return state;
  });
}
