const MAX_TEXT = 240;
const MAX_LIST_ITEMS = 12;

export const INTENT_FAMILIES = Object.freeze([
  'explain',
  'inspect',
  'recall',
  'troubleshoot',
  'route-config',
  'provider-config',
  'memory-operation',
  'graph-operation',
  'roadmap-operation',
  'proposal-review',
  'build-system',
  'build-ui',
  'build-runtime',
  'build-transport',
  'build-surface',
  'build-agent',
  'build-tooling',
  'build-simulation',
  'build-integration',
  'experimental',
  'ambiguous',
  'unknown',
]);

function safeString(value = '') {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeArray(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeString(item)).filter(Boolean).slice(0, limit);
}

function safeBoolean(value) {
  return value === true;
}

function safeConfidence(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return 0;
  return Math.max(0, Math.min(1, Number(candidate.toFixed(2))));
}

export function normalizeIntentResult(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const intentType = safeString(source.intentType || source.intentFamily || 'unknown').toLowerCase();
  const resolvedIntentType = INTENT_FAMILIES.includes(intentType) ? intentType : 'unknown';

  return {
    intentDetected: safeBoolean(source.intentDetected),
    intentType: resolvedIntentType,
    intentFamily: safeString(source.intentFamily || resolvedIntentType).toLowerCase(),
    confidence: safeConfidence(source.confidence),
    reason: safeString(source.reason).slice(0, MAX_TEXT),
    ambiguityFlags: safeArray(source.ambiguityFlags),
    buildRelevant: safeBoolean(source.buildRelevant),
    executionEligible: safeBoolean(source.executionEligible),
    approvalRequired: source.approvalRequired !== false,
    suggestedNextStage: safeString(source.suggestedNextStage || 'analysis').toLowerCase(),
    extractedTargets: safeArray(source.extractedTargets),
    extractedSubsystems: safeArray(source.extractedSubsystems),
    extractedConstraints: safeArray(source.extractedConstraints),
    warnings: safeArray(source.warnings),
  };
}
