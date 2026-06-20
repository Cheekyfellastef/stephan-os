const CANONICAL_COPY_SOURCES = [
  'AnswerPaneCopyButton.answer',
  'AnswerPaneCopyButton.debug',
  'StatusPanel.supportSnapshot',
  'StatusPanel.codexHandoff',
  'MissionDashboardPanel.missionHandoff',
  'MissionConsoleTile.missionHandoff',
];

export function recordCopyFeedbackEvent({
  source = 'unknown',
  success = false,
  visualState = 'idle',
  greenConfirmed = false,
  payloadKind = 'text',
  payloadFirstLine = 'none',
  reason = 'unknown',
  method = 'unknown',
  timestamp = new Date().toISOString(),
} = {}) {
  if (typeof window === 'undefined') return null;
  const snapshot = window.__STEPHANOS_PANE_DIAGNOSTICS__ || {};
  const events = Array.isArray(snapshot.copyEvents) ? [...snapshot.copyEvents] : [];
  const event = {
    source,
    ok: success === true,
    visualState,
    greenConfirmed: greenConfirmed === true,
    payloadKind,
    payloadFirstLine,
    reason,
    method,
    timestamp,
  };
  events.push(event);
  const copyControls = snapshot.copyControls && typeof snapshot.copyControls === 'object'
    ? snapshot.copyControls
    : {};
  const next = {
    ...snapshot,
    lastCopyEvent: event,
    copyEvents: events.slice(-100),
    copyControls: {
      ...copyControls,
      canonicalCopyControls: copyControls.canonicalCopyControls || CANONICAL_COPY_SOURCES,
      lastCopyEvent: event,
      copyEvents: events.slice(-100),
    },
  };
  window.__STEPHANOS_PANE_DIAGNOSTICS__ = next;
  return event;
}

export function getCanonicalCopySources() {
  return [...CANONICAL_COPY_SOURCES];
}
