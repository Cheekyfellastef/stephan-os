const MAX_FRICTION_EVENTS = 20;
const MAX_FRICTION_PATTERNS = 12;
const MAX_FRICTION_RECOMMENDATIONS = 12;
const MAX_ACCEPTED_SURFACE_RULES = 24;

const DEFAULT_PROMOTION_CONFIG = Object.freeze({
  recurrenceThreshold: 3,
  strongPatternThreshold: 5,
});

const RULES = Object.freeze([
  { pattern: /(clutter|too dense|dense|crowded)/i, frictionType: 'layout-clutter', subsystem: 'general-surface-experience', protocolMismatch: 'comfortable-density' },
  { pattern: /(drag|dragging panels|panel drag|awkward.*drag)/i, frictionType: 'panel-dragging', subsystem: 'mission-console', protocolMismatch: 'safari-safe-dragging' },
  { pattern: /(input box.*lost|input.*lost|can.?t find input)/i, frictionType: 'control-reachability', subsystem: 'navigation-shell', protocolMismatch: 'compact-single-focus' },
  { pattern: /(hover|mouse over|required hover)/i, frictionType: 'hover-dependence', subsystem: 'general-surface-experience', protocolMismatch: 'reduced-hover-dependence' },
  { pattern: /(route|where did it route|wrong route)/i, frictionType: 'route-confusion', subsystem: 'navigation-shell', protocolMismatch: 'hosted-route-bias-hint' },
]);

function boundedConfidence(value = 0.35) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.35;
  return Number(Math.max(0.05, Math.min(0.95, numeric)).toFixed(3));
}

function classifySeverity(text = '') {
  if (/(blocked|broken|cannot|can.t|keeps|unusable)/i.test(text)) return 'high';
  if (/(awkward|hard|too|confusing)/i.test(text)) return 'medium';
  return 'low';
}

function patternStrengthFromRecurrence(recurrenceCount = 0, config = DEFAULT_PROMOTION_CONFIG) {
  if (recurrenceCount >= config.strongPatternThreshold) return 'strong';
  if (recurrenceCount >= config.recurrenceThreshold) return 'emerging';
  return 'weak';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toReasoningLines({ match, text, recurrenceCount = 0, threshold = DEFAULT_PROMOTION_CONFIG.recurrenceThreshold } = {}) {
  const lines = [];
  if (match) {
    lines.push(`Matched deterministic rule ${match.pattern}.`);
  } else {
    lines.push('No deterministic wording rule matched; report remains bounded as unknown friction.');
  }
  lines.push(`Operator text length=${String(text || '').length}.`);
  if (recurrenceCount > 0) {
    lines.push(`Recurrence observed ${recurrenceCount} time(s); threshold=${threshold}.`);
  }
  return lines;
}

export function interpretSurfaceFrictionText(userText = '', { surfaceProfileId = 'generic-surface' } = {}) {
  const text = String(userText || '').trim();
  if (!text) {
    return {
      frictionType: 'unknown',
      subsystem: 'general-surface-experience',
      likelyProtocolMismatch: null,
      confidence: boundedConfidence(0.12),
      reasoning: ['No friction text provided.'],
      noFakeCertainty: true,
      surfaceProfileId,
    };
  }

  const match = RULES.find((rule) => rule.pattern.test(text));
  if (!match) {
    return {
      frictionType: 'unknown',
      subsystem: 'general-surface-experience',
      likelyProtocolMismatch: null,
      confidence: boundedConfidence(0.24),
      reasoning: toReasoningLines({ text }),
      noFakeCertainty: true,
      surfaceProfileId,
    };
  }

  const confidence = /(keeps|always|cannot|can't|lost)/i.test(text)
    ? 0.72
    : (/(awkward|hard|too)/i.test(text) ? 0.63 : 0.54);

  return {
    frictionType: match.frictionType,
    subsystem: match.subsystem,
    likelyProtocolMismatch: match.protocolMismatch,
    confidence: boundedConfidence(confidence),
    reasoning: toReasoningLines({ match, text }),
    noFakeCertainty: true,
    surfaceProfileId,
  };
}

export function createFrictionEvent({
  userText = '',
  source = 'operator-text',
  surfaceProfileId = 'generic-surface',
  activeProtocolIds = [],
  sessionId = 'session-unknown',
  now = new Date(),
} = {}) {
  const interpretation = interpretSurfaceFrictionText(userText, { surfaceProfileId });
  const timestamp = typeof now?.toISOString === 'function' ? now.toISOString() : new Date().toISOString();
  return {
    id: `surface_friction_event_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    surfaceProfileId,
    activeProtocolIds: asArray(activeProtocolIds).map((entry) => String(entry || '')).filter(Boolean),
    subsystem: interpretation.subsystem,
    frictionType: interpretation.frictionType,
    severity: classifySeverity(userText),
    userText: String(userText || ''),
    structuredInterpretation: interpretation,
    confidence: interpretation.confidence,
    source,
    sessionId: String(sessionId || 'session-unknown'),
    lifecycleStage: 'surfaceFrictionEvent',
  };
}

export function appendFrictionEvent(history = [], event) {
  const safeHistory = asArray(history);
  if (!event || typeof event !== 'object') return safeHistory;
  return [...safeHistory, event].slice(-MAX_FRICTION_EVENTS);
}

function patternKeyFromEvent(event = {}) {
  return [event.surfaceProfileId || 'generic-surface', event.subsystem || 'general-surface-experience', event.frictionType || 'unknown'].join('::');
}

export function detectSurfaceFrictionPatterns({
  events = [],
  existingPatterns = [],
  promotionConfig = DEFAULT_PROMOTION_CONFIG,
} = {}) {
  const grouped = new Map();
  asArray(events).forEach((event) => {
    if (!event?.id) return;
    const key = patternKeyFromEvent(event);
    const bucket = grouped.get(key) || [];
    bucket.push(event);
    grouped.set(key, bucket);
  });

  const existingByKey = new Map(asArray(existingPatterns).map((pattern) => {
    const key = [pattern.surfaceProfileId || 'generic-surface', pattern.subsystem || 'general-surface-experience', pattern.frictionType || 'unknown'].join('::');
    return [key, pattern];
  }));

  const nextPatterns = [];
  grouped.forEach((bucket, key) => {
    const recurrenceCount = bucket.length;
    if (recurrenceCount < promotionConfig.recurrenceThreshold) {
      return;
    }
    const first = bucket[0] || {};
    const last = bucket[bucket.length - 1] || {};
    const previous = existingByKey.get(key);
    const aggregatedConfidence = boundedConfidence(
      bucket.reduce((sum, event) => sum + Number(event.confidence || 0), 0) / Math.max(1, recurrenceCount),
    );
    nextPatterns.push({
      id: previous?.id || `surface_friction_pattern_${(last.timestamp || first.timestamp || new Date().toISOString()).replace(/[^\d]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`,
      frictionType: first.frictionType || 'unknown',
      subsystem: first.subsystem || 'general-surface-experience',
      surfaceProfileId: first.surfaceProfileId || 'generic-surface',
      recurrenceCount,
      firstSeen: first.timestamp || '',
      lastSeen: last.timestamp || '',
      aggregatedConfidence,
      contributingEventIds: bucket.map((event) => event.id),
      patternStrength: patternStrengthFromRecurrence(recurrenceCount, promotionConfig),
      reasoning: [
        `Pattern detected from ${recurrenceCount} recurring events.`,
        `Threshold ${promotionConfig.recurrenceThreshold}+ met for ${first.frictionType || 'unknown'}.`,
        ...(first.structuredInterpretation?.reasoning || []),
      ],
      provenance: {
        promotionStage: 'surfaceFrictionPattern',
        threshold: promotionConfig.recurrenceThreshold,
      },
      lifecycleStage: 'surfaceFrictionPattern',
    });
  });

  return nextPatterns.slice(-MAX_FRICTION_PATTERNS);
}

function recommendationTypeFromPattern(pattern = {}) {
  if (pattern.frictionType === 'unknown') return 'build-task';
  if (pattern.patternStrength === 'strong') return 'protocol-adjustment';
  if (pattern.subsystem === 'navigation-shell') return 'surface-override';
  return 'transient-adjustment';
}

export function generateSurfaceProtocolRecommendations({ patterns = [], existingRecommendations = [] } = {}) {
  const existingByPattern = new Map(asArray(existingRecommendations).map((entry) => [entry.basedOnPatternId, entry]));
  return asArray(patterns).map((pattern) => {
    const existing = existingByPattern.get(pattern.id);
    const proposalType = recommendationTypeFromPattern(pattern);
    return {
      id: existing?.id || `surface_protocol_recommendation_${pattern.id}`,
      basedOnPatternId: pattern.id,
      affectedProtocols: pattern.frictionType === 'unknown' ? [] : [pattern.frictionType, pattern.subsystem].filter(Boolean),
      proposedChanges: [
        proposalType === 'build-task'
          ? `Add explicit interpreter rule for recurring unknown friction on ${pattern.subsystem}.`
          : `Apply bounded ${proposalType} for ${pattern.frictionType} on ${pattern.surfaceProfileId}.`,
      ],
      proposalType,
      expectedImpact: `Reduce recurring ${pattern.frictionType} friction without mutating global behavior implicitly.`,
      confidence: boundedConfidence(pattern.aggregatedConfidence),
      reasoning: [
        `Generated from recurring pattern ${pattern.id}.`,
        `Pattern strength=${pattern.patternStrength}; recurrence=${pattern.recurrenceCount}.`,
        ...(pattern.reasoning || []),
      ],
      requiresApproval: true,
      source: 'friction-pattern-pipeline',
      lifecycleStage: 'surfaceProtocolRecommendation',
      status: 'active',
    };
  }).slice(-MAX_FRICTION_RECOMMENDATIONS);
}

export function acceptSurfaceProtocolRecommendation({
  recommendation,
  scope = 'session',
  operatorId = 'operator',
  now = new Date(),
} = {}) {
  if (!recommendation || typeof recommendation !== 'object') {
    return null;
  }
  const timestamp = typeof now?.toISOString === 'function' ? now.toISOString() : new Date().toISOString();
  return {
    id: `accepted_surface_rule_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    sourceRecommendationId: recommendation.id,
    scope,
    appliedProtocols: asArray(recommendation.affectedProtocols),
    appliedOverrides: asArray(recommendation.proposedChanges),
    createdAt: timestamp,
    operatorApproved: true,
    auditTrail: [
      `${timestamp}: operator approved recommendation ${recommendation.id}`,
      `${timestamp}: scope=${scope} operator=${operatorId}`,
    ],
    reversible: true,
    lifecycleStage: 'acceptedSurfaceRule',
  };
}

export function appendAcceptedSurfaceRule(rules = [], rule) {
  const safeRules = asArray(rules);
  if (!rule || typeof rule !== 'object') return safeRules;
  return [...safeRules, rule].slice(-MAX_ACCEPTED_SURFACE_RULES);
}

export function revertAcceptedSurfaceRule(rules = [], ruleId = '', { now = new Date(), operatorId = 'operator' } = {}) {
  const timestamp = typeof now?.toISOString === 'function' ? now.toISOString() : new Date().toISOString();
  return asArray(rules).map((rule) => {
    if (rule.id !== ruleId) return rule;
    return {
      ...rule,
      revertedAt: timestamp,
      status: 'reverted',
      auditTrail: [...asArray(rule.auditTrail), `${timestamp}: operator reverted rule ${ruleId} (${operatorId})`],
    };
  });
}

export function deriveFrictionMemoryCandidates({ patterns = [], recommendations = [], acceptedRules = [] } = {}) {
  const strongPatterns = asArray(patterns).filter((pattern) => pattern.patternStrength === 'strong');
  return {
    frictionEventsEligible: false,
    patternMemories: strongPatterns.map((pattern) => ({
      sourceType: 'surface-friction-pattern',
      sourceRef: pattern.id,
      memoryClass: 'build-relevant-memory',
      summary: `Recurring surface friction pattern ${pattern.frictionType} (${pattern.recurrenceCount}x).`,
    })),
    recommendationMemories: asArray(recommendations).map((recommendation) => ({
      sourceType: 'surface-protocol-recommendation',
      sourceRef: recommendation.id,
      memoryClass: 'build-relevant-memory',
      summary: `Surface protocol recommendation ${recommendation.proposalType}.`,
    })),
    acceptedRuleMemories: asArray(acceptedRules).map((rule) => ({
      sourceType: 'accepted-surface-rule',
      sourceRef: rule.id,
      memoryClass: 'mission-critical-continuity-memory',
      summary: `Approved surface rule ${rule.sourceRecommendationId} scope=${rule.scope}.`,
    })),
  };
}

export {
  DEFAULT_PROMOTION_CONFIG,
  MAX_ACCEPTED_SURFACE_RULES,
  MAX_FRICTION_EVENTS,
  MAX_FRICTION_PATTERNS,
  MAX_FRICTION_RECOMMENDATIONS,
};
