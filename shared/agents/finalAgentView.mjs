function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toAgeLabel(isoTimestamp = '', nowMs = Date.now()) {
  const ts = Date.parse(isoTimestamp || '');
  if (!Number.isFinite(ts)) return 'never';
  const diff = Math.max(0, nowMs - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function buildFinalAgentView({ adjudicated = {}, selectedAgentId = '' } = {}) {
  const agents = asArray(adjudicated.agents);
  const visibleAgents = agents.filter((entry) => entry.visibility !== 'hidden');
  const activeAgentIds = visibleAgents.filter((entry) => entry.active).map((entry) => entry.agentId);
  const actingAgent = visibleAgents.find((entry) => entry.acting) || null;
  const actingAgentId = actingAgent?.agentId || '';
  const focusAgentId = selectedAgentId && visibleAgents.some((entry) => entry.agentId === selectedAgentId)
    ? selectedAgentId
    : visibleAgents[0]?.agentId || '';

  const recentTransitions = visibleAgents
    .flatMap((entry) => asArray(entry.recentEvents).map((event) => ({
      agentId: entry.agentId,
      displayName: entry.displayName,
      type: event.type || 'event',
      state: event.state || entry.state,
      reason: event.reason || entry.stateReason,
      at: event.at || '',
    })))
    .sort((left, right) => Date.parse(right.at || 0) - Date.parse(left.at || 0))
    .slice(0, 20);

  const visibleHandoffChain = recentTransitions
    .filter((entry) => entry.type === 'handoff')
    .map((entry) => entry.reason)
    .filter(Boolean)
    .slice(0, 6);

  const suppressionReasons = visibleAgents
    .filter((entry) => !entry.active && entry.state === 'blocked')
    .map((entry) => `${entry.displayName}: ${entry.stateReason}`);

  return {
    visibleAgents: visibleAgents.map((entry) => ({
      ...entry,
      pulseToken: entry.acting ? 'pulse-acting' : entry.active ? 'pulse-active' : entry.state === 'blocked' ? 'pulse-blocked' : 'pulse-idle',
      actionAgeLabel: toAgeLabel(entry.lastActionAt),
      successAgeLabel: toAgeLabel(entry.lastSuccessAt),
      failureAgeLabel: toAgeLabel(entry.lastFailureAt),
    })),
    activeAgentIds,
    actingAgentId,
    selectedAgentId: focusAgentId,
    recentTransitions,
    visibleHandoffChain,
    suppressionReasons,
    operatorSummary: actingAgent
      ? `${actingAgent.displayName} is acting. ${actingAgent.stateReason}`
      : suppressionReasons[0] || 'Fleet idle and watching current context.',
    globalAutonomyStatus: adjudicated.global?.globalAutonomy || 'manual',
    safeModeStatus: adjudicated.global?.safeMode === true ? 'enabled' : 'disabled',
    timestamps: {
      adjudicatedAt: adjudicated.global?.adjudicatedAt || '',
      now: new Date().toISOString(),
    },
  };
}
