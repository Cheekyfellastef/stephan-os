const MAX_TEXT = 240;
const MAX_LIST_ITEMS = 12;

function safeString(value = '') {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeBoolean(value) {
  return value === true;
}

function safeArray(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(0, Number(limit) || MAX_LIST_ITEMS));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeMove(move = {}) {
  const source = safeObject(move);
  return {
    moveId: safeString(source.moveId),
    title: safeString(source.title),
    category: safeString(source.category),
    score: safeNumber(source.score),
    rationale: safeString(source.rationale).slice(0, MAX_TEXT),
    dependencies: safeArray(source.dependencies),
    blockers: safeArray(source.blockers),
    codexHandoffEligible: safeBoolean(source.codexHandoffEligible),
    proposalEligible: safeBoolean(source.proposalEligible),
  };
}

export function normalizeMissionSynthesisResult(input = {}) {
  const source = safeObject(input);
  return {
    planningMode: safeString(source.planningMode) || 'inactive',
    planningIntentDetected: safeBoolean(source.planningIntentDetected),
    planningConfidence: safeString(source.planningConfidence) || 'low',
    currentSystemMaturityEstimate: safeString(source.currentSystemMaturityEstimate) || 'unknown',
    candidateMoves: safeArray(source.candidateMoves).map((move) => normalizeMove(move)),
    rankedMoves: safeArray(source.rankedMoves).map((move) => normalizeMove(move)),
    blockers: safeArray(source.blockers),
    dependencies: safeArray(source.dependencies),
    recommendedNextMove: safeObject(source.recommendedNextMove),
    recommendationReason: safeString(source.recommendationReason).slice(0, MAX_TEXT),
    evidenceSources: safeArray(source.evidenceSources),
    truthWarnings: safeArray(source.truthWarnings),
    operatorActions: safeArray(source.operatorActions),
    codexHandoffEligible: safeBoolean(source.codexHandoffEligible),
    proposalEligible: safeBoolean(source.proposalEligible),
  };
}
