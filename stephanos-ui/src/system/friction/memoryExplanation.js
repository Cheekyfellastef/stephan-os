function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function boundedConfidence(value, fallback = 0.5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.05, Math.min(0.95, Number(numeric.toFixed(3))));
}

function normalizeMode(mode = 'summary') {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'expanded' || normalized === 'diagnostic') return normalized;
  return 'summary';
}

export function buildMemoryExplanationModel({
  acceptedSurfaceRules = [],
  surfaceFrictionPatterns = [],
  surfaceProtocolRecommendations = [],
  elevatedMemories = [],
} = {}) {
  const learnedPreferences = asArray(acceptedSurfaceRules)
    .filter((rule) => rule?.status !== 'reverted')
    .map((rule) => ({
      id: rule.id,
      scope: rule.scope || 'session',
      appliedProtocols: asArray(rule.appliedProtocols),
      confidence: 0.92,
      provenance: rule.sourceRecommendationId || 'operator-approved',
    }));

  const recurringPatterns = asArray(surfaceFrictionPatterns)
    .filter((pattern) => pattern?.patternStrength === 'strong' || Number(pattern?.aggregatedConfidence || 0) >= 0.66)
    .map((pattern) => ({
      id: pattern.id,
      frictionType: pattern.frictionType || 'unknown',
      subsystem: pattern.subsystem || 'general-surface-experience',
      surfaceProfileId: pattern.surfaceProfileId || 'generic-surface',
      recurrenceCount: Number(pattern.recurrenceCount || 0),
      confidence: boundedConfidence(pattern.aggregatedConfidence, 0.66),
      provenance: asArray(pattern.contributingEventIds),
    }));

  const activeRecommendations = asArray(surfaceProtocolRecommendations)
    .filter((recommendation) => recommendation?.status !== 'rejected')
    .map((recommendation) => ({
      id: recommendation.id,
      proposalType: recommendation.proposalType || 'transient-adjustment',
      affectedProtocols: asArray(recommendation.affectedProtocols),
      confidence: boundedConfidence(recommendation.confidence, 0.6),
      reasoning: asArray(recommendation.reasoning),
      requiresApproval: recommendation.requiresApproval !== false,
    }));

  const systemInsights = asArray(elevatedMemories)
    .filter((memory) => Number(memory?.confidence || memory?.score || 0) >= 0.7)
    .map((memory) => ({
      id: memory.id || memory.sourceRef || `insight_${Math.random().toString(36).slice(2, 8)}`,
      summary: memory.summary || memory.text || 'High-confidence continuity signal.',
      confidence: boundedConfidence(memory.confidence || memory.score, 0.75),
      provenance: memory.sourceType || memory.source || 'elevated-memory',
      classification: memory.memoryClass || 'high-confidence-elevated-memory',
    }));

  return {
    learnedPreferences,
    recurringPatterns,
    activeRecommendations,
    systemInsights,
  };
}

function buildSummarySentences(model = {}) {
  const sentences = [];
  if (model.learnedPreferences.length > 0) {
    const first = model.learnedPreferences[0];
    const protocols = first.appliedProtocols.length > 0 ? first.appliedProtocols.join(', ') : 'approved protocol adjustments';
    sentences.push(`I've learned your preferred behavior on ${first.scope} scope, especially ${protocols}.`);
  }
  if (model.recurringPatterns.length > 0) {
    const first = model.recurringPatterns[0];
    sentences.push(`I'm tracking recurring ${first.frictionType} friction on ${first.surfaceProfileId} (${first.recurrenceCount} reports).`);
  }
  if (model.activeRecommendations.length > 0) {
    const first = model.activeRecommendations[0];
    sentences.push(`I have ${model.activeRecommendations.length} active recommendation${model.activeRecommendations.length === 1 ? '' : 's'} waiting for approval before any behavior changes.`);
  }
  if (model.systemInsights.length > 0) {
    sentences.push(`I also retain ${model.systemInsights.length} high-confidence system insight${model.systemInsights.length === 1 ? '' : 's'} that support continuity.`);
  }
  if (sentences.length === 0) {
    sentences.push('I currently remember only stable defaults and no approved surface adaptations yet.');
  }
  return sentences.slice(0, 5);
}

export function explainStephanosMemory(input = {}, { mode = 'summary' } = {}) {
  const resolvedMode = normalizeMode(mode);
  const model = buildMemoryExplanationModel(input);

  if (resolvedMode === 'summary') {
    return {
      mode: resolvedMode,
      text: buildSummarySentences(model).join(' '),
      categories: {
        learnedPreferences: model.learnedPreferences.length,
        recurringPatterns: model.recurringPatterns.length,
        activeRecommendations: model.activeRecommendations.length,
        systemInsights: model.systemInsights.length,
      },
    };
  }

  if (resolvedMode === 'expanded') {
    return {
      mode: resolvedMode,
      text: [
        `Learned preferences (${model.learnedPreferences.length})`,
        ...model.learnedPreferences.map((entry) => `- scope=${entry.scope}; protocols=${entry.appliedProtocols.join(', ') || 'none'}; confidence=${entry.confidence}`),
        `Recurring patterns (${model.recurringPatterns.length})`,
        ...model.recurringPatterns.map((entry) => `- ${entry.frictionType} on ${entry.surfaceProfileId}/${entry.subsystem}; recurrence=${entry.recurrenceCount}; confidence=${entry.confidence}`),
        `Active recommendations (${model.activeRecommendations.length})`,
        ...model.activeRecommendations.map((entry) => `- ${entry.proposalType}; protocols=${entry.affectedProtocols.join(', ') || 'none'}; confidence=${entry.confidence}; requiresApproval=${entry.requiresApproval}`),
        `System insights (${model.systemInsights.length})`,
        ...model.systemInsights.map((entry) => `- ${entry.summary}; confidence=${entry.confidence}; source=${entry.provenance}`),
      ].join('\n'),
      model,
    };
  }

  return {
    mode: resolvedMode,
    text: JSON.stringify(model, null, 2),
    model,
    diagnostic: {
      provenance: 'memory-explanation-layer',
      classification: 'operator-explicit-diagnostic',
    },
  };
}
