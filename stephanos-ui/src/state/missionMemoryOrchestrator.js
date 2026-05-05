const MEMORY_GROUPS = Object.freeze([
  'architecture_canon',
  'durable_operator_preference',
  'project_lesson',
  'workflow_preference',
  'verification_rule',
  'capability_gap',
  'mission_history',
  'do_not_repeat_warning',
]);

const INFLUENCE_LEVELS = Object.freeze([
  'critical_canon',
  'strong_guidance',
  'relevant_lesson',
  'weak_context',
  'draft_context',
]);

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeType(candidate = {}) {
  const rawType = asText(candidate.memoryCandidateType || candidate.type || candidate.category).toLowerCase();
  if (rawType === 'architecture_canon_candidate') return 'architecture_canon';
  if (rawType === 'bug_lesson') return 'project_lesson';
  if (rawType === 'temporary_note') return 'mission_history';
  if (rawType === 'do_not_store') return 'mission_history';
  if (MEMORY_GROUPS.includes(rawType)) return rawType;

  const summary = asText(candidate.summary || candidate.text).toLowerCase();
  if (/canon|architecture|invariant|truth boundary|source of truth/.test(summary)) return 'architecture_canon';
  if (/prefer|workflow|habit|style/.test(summary)) return 'workflow_preference';
  if (/verify|test|build|acceptance|merge-ready/.test(summary)) return 'verification_rule';
  if (/capability|missing|gap|skill/.test(summary)) return 'capability_gap';
  if (/do not repeat|regression|avoid repeating|incident/.test(summary)) return 'do_not_repeat_warning';
  if (/lesson|learned|root cause/.test(summary)) return 'project_lesson';
  return 'mission_history';
}

function isApprovedSavedDurable(candidate = {}) {
  const status = asText(candidate.status || candidate.approvalStatus).toLowerCase();
  const promotion = asText(candidate.promotionState || candidate.persistedState || candidate.durabilityState).toLowerCase();
  const saved = promotion === 'saved' || promotion === 'durable' || promotion === 'persisted';
  return status === 'approved' && saved;
}

function isExplicitDraftContext(candidate = {}) {
  return candidate.explicitDraftContext === true
    || candidate.draftContext === true
    || candidate.sourceType === 'draft-mission-context';
}

function tokenize(text = '') {
  return new Set(asText(text).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
}

function scoreRelevance({ intentText = '', targetArea = '', candidate = {}, type = 'mission_history' } = {}) {
  const summary = asText(candidate.summary || candidate.text || candidate.intentSummary);
  const intentTokens = tokenize(`${intentText} ${targetArea}`);
  const summaryTokens = tokenize(`${summary} ${asText(candidate.source)} ${type}`);
  let overlap = 0;
  summaryTokens.forEach((token) => {
    if (intentTokens.has(token)) overlap += 1;
  });
  const typeBoost = {
    architecture_canon: 0.24,
    durable_operator_preference: 0.18,
    workflow_preference: 0.16,
    verification_rule: 0.18,
    project_lesson: 0.14,
    do_not_repeat_warning: 0.16,
    capability_gap: 0.12,
    mission_history: 0.06,
  }[type] || 0.04;
  const explicitBoost = isExplicitDraftContext(candidate) ? 0.04 : 0;
  const overlapScore = Math.min(0.52, overlap * 0.08);
  return Number(Math.max(0.05, Math.min(0.99, 0.28 + typeBoost + overlapScore + explicitBoost)).toFixed(3));
}

function influenceLevelFor({ type, candidate = {}, score = 0 }) {
  if (isExplicitDraftContext(candidate)) return 'draft_context';
  if (type === 'architecture_canon' && score >= 0.45) return 'critical_canon';
  if (type === 'durable_operator_preference' || type === 'workflow_preference' || type === 'verification_rule') return 'strong_guidance';
  if (type === 'project_lesson' || type === 'do_not_repeat_warning' || type === 'capability_gap') return 'relevant_lesson';
  return 'weak_context';
}

function appliedTargetsFor(type, summary = '') {
  const lower = asText(summary).toLowerCase();
  const targets = new Set();
  if (type === 'architecture_canon') targets.add('allowed_scope');
  if (type === 'verification_rule') targets.add('verification_commands');
  if (type === 'durable_operator_preference' || type === 'workflow_preference') targets.add('next_best_action');
  if (type === 'project_lesson' || type === 'do_not_repeat_warning') targets.add('risks');
  if (type === 'capability_gap') targets.add('capability_radar');
  if (/handoff|codex/.test(lower)) targets.add('codex_handoff_text');
  if (/acceptance|criteria/.test(lower)) targets.add('acceptance_criteria');
  if (/blocked|approval|destructive|openclaw|secrets|push/.test(lower)) targets.add('blocked_actions');
  if (/dist|runtime|launcher|memory|mission|openclaw/.test(lower)) targets.add('likely_affected_systems');
  return [...targets];
}

function memoryReason({ type, score, candidate = {} }) {
  const durable = isApprovedSavedDurable(candidate) ? 'approved saved durable memory' : 'explicit draft mission context';
  return `${durable}; classified as ${type}; relevance score ${score}.`;
}

function buildConflict({ conflictType, severity = 'warning', memorySource = 'doctrine', operatorIntentExcerpt = '', suggestedResolution = '' }) {
  return { conflictType, severity, memorySource, operatorIntentExcerpt, suggestedResolution };
}

export function detectMissionMemoryConflicts({ intentText = '', groupedMemory = {}, memories = [] } = {}) {
  const text = asText(intentText).toLowerCase();
  const memoryText = memories.map((memory) => `${memory.type} ${memory.summary}`).join(' ').toLowerCase();
  const conflicts = [];
  const sourceFor = (pattern) => {
    const found = memories.find((memory) => pattern.test(`${memory.type} ${memory.summary}`.toLowerCase()));
    return found ? found.memoryId : 'stephanos-doctrine';
  };

  if (/(autonomous|auto[-\s]?execute|without approval|no approval|full autonomy)/.test(text)
    && /(approval|operator|final authority|manual)/.test(memoryText)) {
    conflicts.push(buildConflict({
      conflictType: 'autonomy_requires_operator_approval',
      severity: 'high',
      memorySource: sourceFor(/approval|operator|final authority|manual/),
      operatorIntentExcerpt: intentText,
      suggestedResolution: 'Keep operator approval explicit; generate proposals and handoffs instead of autonomous execution.',
    }));
  }
  if (/openclaw/.test(text) && /(execute|run|control|mutate)/.test(text)) {
    conflicts.push(buildConflict({
      conflictType: 'openclaw_parked_execution_requested',
      severity: 'high',
      memorySource: sourceFor(/openclaw|parked|readonly|proposal/),
      operatorIntentExcerpt: intentText,
      suggestedResolution: 'Keep OpenClaw scoped to readonly validation/proposal packets unless the operator explicitly changes doctrine.',
    }));
  }
  if (/(delete|remove files|rm -rf|destructive|wipe|drop database)/.test(text)) {
    conflicts.push(buildConflict({
      conflictType: 'destructive_action_blocked_by_doctrine',
      severity: 'critical',
      memorySource: sourceFor(/destructive|delete|secrets|push|external account/),
      operatorIntentExcerpt: intentText,
      suggestedResolution: 'Surface the destructive scope for explicit operator review; do not include execution steps in the handoff.',
    }));
  }
  if (/(dist-only|edit dist|apps\/stephanos\/dist|generated output only)/.test(text)) {
    conflicts.push(buildConflict({
      conflictType: 'dist_not_source_truth',
      severity: 'high',
      memorySource: sourceFor(/dist|source truth|generated output/),
      operatorIntentExcerpt: intentText,
      suggestedResolution: 'Edit live source and rebuild dist; do not treat generated dist as source truth.',
    }));
  }
  if (/(skip verification|no verify|without tests|do not run tests|skip build)/.test(text)) {
    conflicts.push(buildConflict({
      conflictType: 'verification_required_by_canon',
      severity: 'high',
      memorySource: sourceFor(/verify|build|test|merge-ready/),
      operatorIntentExcerpt: intentText,
      suggestedResolution: 'Keep build and verification commands in acceptance criteria; mark any unrun checks as warnings.',
    }));
  }

  return conflicts;
}

export function buildMissionMemoryContext({ operatorIntent = '', missionSpec = {}, memoryContext = {} } = {}) {
  const targetArea = asText(missionSpec.targetArea || memoryContext.targetArea);
  const acceptedCandidates = [
    ...asArray(memoryContext.memoryCandidates),
    ...asArray(memoryContext.approvedMemoryCandidates),
    ...asArray(memoryContext.records),
  ];
  const draftText = asText(memoryContext.draftMissionContext || memoryContext.missionDraft);
  const draftCandidates = memoryContext.includeDraftMissionContext === true && draftText
    ? [{ id: 'draft-mission-context', type: 'mission_history', summary: draftText, source: 'mission-bridge-draft', explicitDraftContext: true, sourceType: 'draft-mission-context' }]
    : [];

  const eligible = [...acceptedCandidates, ...draftCandidates].filter((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    if (isExplicitDraftContext(candidate)) return true;
    return isApprovedSavedDurable(candidate);
  });

  const memories = eligible.map((candidate, index) => {
    const type = normalizeType(candidate);
    const summary = asText(candidate.summary || candidate.text || candidate.intentSummary, 'Approved mission memory.');
    const relevanceScore = scoreRelevance({ intentText: operatorIntent, targetArea, candidate: { ...candidate, summary }, type });
    const influenceLevel = influenceLevelFor({ type, candidate, score: relevanceScore });
    return {
      memoryId: asText(candidate.id || candidate.memoryId, `${type}-${index + 1}`),
      type,
      summary,
      relevanceScore,
      influenceLevel,
      reason: memoryReason({ type, score: relevanceScore, candidate }),
      appliedTo: appliedTargetsFor(type, summary),
      requiresOperatorVisibility: influenceLevel === 'critical_canon' || relevanceScore >= 0.5 || type === 'capability_gap',
      source: asText(candidate.source || candidate.sourceRef, isExplicitDraftContext(candidate) ? 'mission-bridge-draft' : 'memory-bridge'),
    };
  }).sort((left, right) => right.relevanceScore - left.relevanceScore || left.memoryId.localeCompare(right.memoryId));

  const grouped = MEMORY_GROUPS.reduce((accumulator, group) => ({ ...accumulator, [group]: [] }), {});
  memories.forEach((memory) => {
    grouped[memory.type] = [...(grouped[memory.type] || []), memory];
  });
  const influenceLevels = [...new Set(memories.map((memory) => memory.influenceLevel))];
  const conflicts = detectMissionMemoryConflicts({ intentText: operatorIntent, groupedMemory: grouped, memories });
  const capabilityGapItems = memories.filter((memory) => memory.type === 'capability_gap');
  const highConfidenceGap = capabilityGapItems.find((memory) => memory.relevanceScore >= 0.5);
  const repeatedGap = capabilityGapItems.length >= 2 ? capabilityGapItems[0] : null;
  const capabilitySignalSource = highConfidenceGap || repeatedGap || null;
  const skillForgeCandidate = capabilitySignalSource ? {
    candidateType: 'skill_forge_capability_gap',
    title: `Suggested capability: ${capabilitySignalSource.summary}`,
    reason: highConfidenceGap ? 'High-confidence capability gap in approved memory.' : 'Repeated capability gap pattern in approved memory.',
    sourceMemoryIds: capabilityGapItems.map((memory) => memory.memoryId),
    requiresOperatorApproval: true,
    status: 'suggested-not-built',
  } : null;

  return {
    missionContextClassification: {
      categories: asArray(missionSpec.intentClassifications),
      targetArea,
      operatorIntentPrimary: true,
    },
    groups: grouped,
    memories,
    conflicts,
    skillForgeCandidate,
    summary: {
      count: memories.length,
      influenceLevels,
      groupCounts: Object.fromEntries(Object.entries(grouped).map(([group, entries]) => [group, entries.length])),
      conflictCount: conflicts.length,
      approvedDurableOnly: memories.every((memory) => memory.influenceLevel === 'draft_context' || !/draft/i.test(memory.reason)),
    },
  };
}

export function deriveVerificationReturnLessonCandidates({ verificationReturnText = '', missionSpec = {} } = {}) {
  const text = asText(verificationReturnText);
  if (!text) return [];
  const lower = text.toLowerCase();
  const base = {
    generatedFrom: 'verification-return',
    requiresOperatorApproval: true,
    promotionState: 'pending-operator-approval',
    status: 'draft',
    missionId: asText(missionSpec.missionId, 'unknown-mission'),
  };
  const candidates = [];
  if (/fail|error|blocker|regression|root cause|fix/.test(lower)) {
    candidates.push({ ...base, id: `${base.missionId}-lesson`, memoryCandidateType: 'project_lesson', summary: `Suggested lesson from this mission: ${text.slice(0, 220)}` });
  }
  if (/verify|test|build|lint|command/.test(lower)) {
    candidates.push({ ...base, id: `${base.missionId}-verification-rule`, memoryCandidateType: 'verification_rule', summary: 'Verification return indicates a command/check pattern worth approval-gated reuse.' });
  }
  if (/missing|could not|unable|capability|manual|environment limitation|not available/.test(lower)) {
    candidates.push({ ...base, id: `${base.missionId}-capability-gap`, memoryCandidateType: 'capability_gap', summary: 'Verification return suggests a missing capability or automation gap.' });
  }
  if (/do not repeat|avoid|regression|incident|stale|duplicate import/.test(lower)) {
    candidates.push({ ...base, id: `${base.missionId}-do-not-repeat`, memoryCandidateType: 'do_not_repeat_warning', summary: 'Do-not-repeat warning suggested from verification return.' });
  }
  if (/canon|architecture|invariant|source of truth|truth boundary/.test(lower)) {
    candidates.push({ ...base, id: `${base.missionId}-canon-candidate`, memoryCandidateType: 'architecture_canon_candidate', summary: 'Architecture canon candidate suggested from verification return.' });
  }
  if (candidates.length === 0) {
    candidates.push({ ...base, id: `${base.missionId}-history`, memoryCandidateType: 'mission_history', summary: `Mission history candidate from verification return: ${text.slice(0, 220)}` });
  }
  return candidates;
}

export { MEMORY_GROUPS, INFLUENCE_LEVELS, isApprovedSavedDurable };
