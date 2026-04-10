const MAX_FRICTION_EVENTS = 10;

const RULES = Object.freeze([
  { pattern: /(clutter|too dense|dense|crowded)/i, frictionType: 'layout-clutter', secondaryType: 'text-density', subsystem: 'general-surface-experience', protocolMismatch: 'comfortable-density' },
  { pattern: /(drag|dragging panels|panel drag|awkward.*drag)/i, frictionType: 'panel-dragging', subsystem: 'mission-console', protocolMismatch: 'safari-safe-dragging' },
  { pattern: /(input box.*lost|input.*lost|can.?t find input)/i, frictionType: 'control-reachability', subsystem: 'navigation-shell', protocolMismatch: 'compact-single-focus' },
  { pattern: /(hover|mouse over|required hover)/i, frictionType: 'hover-dependence', subsystem: 'general-surface-experience', protocolMismatch: 'reduced-hover-dependence' },
  { pattern: /(route|where did it route|wrong route)/i, frictionType: 'route-confusion', subsystem: 'navigation-shell', protocolMismatch: 'hosted-route-bias-hint' },
]);

function classifySeverity(text = '') {
  if (/(blocked|broken|cannot|can.t|keeps|unusable)/i.test(text)) return 'high';
  if (/(awkward|hard|too|confusing)/i.test(text)) return 'medium';
  return 'low';
}

export function interpretSurfaceFrictionText(userText = '', { surfaceProfileId = 'generic-surface' } = {}) {
  const text = String(userText || '').trim();
  if (!text) {
    return {
      frictionType: 'unknown',
      secondaryFrictionType: null,
      subsystem: 'general-surface-experience',
      probableProtocolMismatch: null,
      confidence: 'low',
      reason: 'No friction text provided.',
      noFakeCertainty: true,
      surfaceProfileId,
    };
  }

  const match = RULES.find((rule) => rule.pattern.test(text));
  if (!match) {
    return {
      frictionType: 'unknown',
      secondaryFrictionType: null,
      subsystem: 'general-surface-experience',
      probableProtocolMismatch: null,
      confidence: 'low',
      reason: 'No deterministic rules matched this wording; keep as operator report for review.',
      noFakeCertainty: true,
      surfaceProfileId,
    };
  }

  return {
    frictionType: match.frictionType,
    secondaryFrictionType: match.secondaryType || null,
    subsystem: match.subsystem,
    probableProtocolMismatch: match.protocolMismatch,
    confidence: /(too|keeps|awkward|lost)/i.test(text) ? 'medium' : 'low',
    reason: `Matched rule ${match.pattern}`,
    noFakeCertainty: true,
    surfaceProfileId,
  };
}

export function generateFrictionProposal(interpretation = {}, { activeProtocolIds = [] } = {}) {
  const mismatch = interpretation.probableProtocolMismatch;
  const hasMismatchProtocol = mismatch && activeProtocolIds.includes(mismatch);

  if (interpretation.frictionType === 'unknown') {
    return {
      proposalType: 'implementation-build-task',
      summary: 'Capture additional diagnostics and add a focused rule for this friction wording.',
      approvalRequired: true,
      persistenceScope: 'build-task',
    };
  }

  if (hasMismatchProtocol) {
    return {
      proposalType: 'transient-adjustment',
      summary: `Apply temporary policy easing for ${interpretation.frictionType} on this session.`,
      approvalRequired: true,
      persistenceScope: 'session',
    };
  }

  if (mismatch) {
    return {
      proposalType: 'surface-override-suggestion',
      summary: `Suggest enabling protocol ${mismatch} for the current surface session.`,
      approvalRequired: true,
      persistenceScope: 'proposal',
    };
  }

  return {
    proposalType: 'protocol-adjustment-proposal',
    summary: 'Propose embodiment bundle adjustment after operator approval.',
    approvalRequired: true,
    persistenceScope: 'proposal',
  };
}

export function createFrictionEvent({
  userText = '',
  source = 'operator-text',
  surfaceProfileId = 'generic-surface',
  activeProtocolIds = [],
  now = new Date(),
} = {}) {
  const interpretation = interpretSurfaceFrictionText(userText, { surfaceProfileId });
  const proposal = generateFrictionProposal(interpretation, { activeProtocolIds });
  const timestamp = typeof now?.toISOString === 'function' ? now.toISOString() : new Date().toISOString();
  const eventId = `friction_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: eventId,
    timestamp,
    surfaceProfileId,
    activeProtocolIds: Array.isArray(activeProtocolIds) ? activeProtocolIds : [],
    subsystem: interpretation.subsystem,
    frictionType: interpretation.frictionType,
    severity: classifySeverity(userText),
    userText: String(userText || ''),
    structuredInterpretation: interpretation,
    likelyCauses: interpretation.probableProtocolMismatch ? [`possible-protocol-mismatch:${interpretation.probableProtocolMismatch}`] : [],
    recommendedActions: [proposal.summary],
    persistenceScope: proposal.persistenceScope,
    confidence: interpretation.confidence,
    source,
    proposal,
  };
}

export function appendFrictionEvent(history = [], event) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (!event || typeof event !== 'object') return safeHistory;
  return [...safeHistory, event].slice(-MAX_FRICTION_EVENTS);
}

export { MAX_FRICTION_EVENTS };
