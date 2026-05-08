function nowIso() { return new Date().toISOString(); }
function id(prefix='presence'){ return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2,8)}`; }

export function createPresenceEvent(event = {}) {
  return {
    id: event.id || id('presence-event'),
    timestamp: event.timestamp || nowIso(),
    sourceTile: String(event.sourceTile || 'unknown'),
    kind: String(event.kind || 'unknown'),
    severity: event.severity || 'info',
    summary: String(event.summary || ''),
    impact: String(event.impact || ''),
    suggestedAction: String(event.suggestedAction || ''),
    requiresApproval: event.requiresApproval === true,
  };
}

export function buildPresenceVoiceMessage(event) {
  return {
    id: id('voice'),
    timestamp: event.timestamp || nowIso(),
    sourceTile: event.sourceTile,
    severity: event.severity,
    title: `${event.sourceTile}: ${event.kind}`,
    message: event.summary || event.impact || 'Presence event received.',
    suggestedActions: event.suggestedAction ? [event.suggestedAction] : [],
    requiresApproval: event.requiresApproval === true,
    acknowledged: false,
  };
}

export function reducePresenceState(state = {}, rawEvent = {}) {
  const event = createPresenceEvent(rawEvent);
  const awarenessItem = {
    id: event.id,
    sourceTile: event.sourceTile,
    kind: event.kind,
    summary: event.summary,
    impact: event.impact,
    suggestedAction: event.suggestedAction,
    requiresApproval: event.requiresApproval,
    status: 'new',
  };
  const voice = buildPresenceVoiceMessage(event);
  const recentEvents = [event, ...(state.recentEvents || [])].slice(0, 60);
  const awarenessQueue = [awarenessItem, ...(state.awarenessQueue || [])].slice(0, 30);
  const voiceMessages = [voice, ...(state.voiceMessages || [])].slice(0, 30);
  const status = event.severity === 'warning' ? 'attention' : 'observing';
  return { ...state, status, recentEvents, awarenessQueue, voiceMessages, lastSpokenSummary: voice.message };
}

export function getPresenceSummary(state = {}) { return state.lastSpokenSummary || state.voiceMessages?.[0]?.message || 'Stephanos presence idle.'; }
export function acknowledgePresenceItem(state = {}, idValue='') { return mutateAwareness(state, idValue, 'acknowledged'); }
export function dismissPresenceItem(state = {}, idValue='') { return mutateAwareness(state, idValue, 'dismissed'); }
export function approvePresenceAction(state = {}, idValue='') { return mutateAwareness(state, idValue, 'approved'); }

function mutateAwareness(state = {}, idValue='', status='acknowledged') {
  const awarenessQueue = (state.awarenessQueue || []).map((item) => item.id === idValue ? { ...item, status } : item);
  const voiceMessages = (state.voiceMessages || []).map((item) => item.id === idValue ? { ...item, acknowledged: status !== 'new' } : item);
  return { ...state, awarenessQueue, voiceMessages };
}
