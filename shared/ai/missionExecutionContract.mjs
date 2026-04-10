const MAX_TEXT = 320;
const MAX_LIST_ITEMS = 16;

export const EXECUTION_MODES = Object.freeze(['analysis-only', 'approval-gated', 'execution-ready', 'blocked']);
export const MISSION_LIFECYCLE_STATES = Object.freeze([
  'inactive', 'proposed', 'accepted', 'execution-ready', 'in-progress', 'blocked', 'completed', 'failed', 'rolled-back',
]);

function safeString(value = '') {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function safeArray(value, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit);
}

function safeConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, Number(numeric.toFixed(2))));
}

function normalizeObjectList(items = [], limit = MAX_LIST_ITEMS) {
  return safeArray(items, limit).filter((item) => item && typeof item === 'object');
}

export function normalizeMissionExecutionPacket(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const executionMode = safeString(source.executionMode || 'analysis-only').toLowerCase();
  const lifecycleState = safeString(source.lifecycleState || 'proposed').toLowerCase();

  return {
    missionId: safeString(source.missionId),
    missionTitle: safeString(source.missionTitle).slice(0, MAX_TEXT),
    missionClass: safeString(source.missionClass || 'analysis').toLowerCase(),
    originIntentType: safeString(source.originIntentType || 'unknown').toLowerCase(),
    proposalId: safeString(source.proposalId),
    executionMode: EXECUTION_MODES.includes(executionMode) ? executionMode : 'analysis-only',
    lifecycleState: MISSION_LIFECYCLE_STATES.includes(lifecycleState) ? lifecycleState : 'proposed',
    confidence: safeConfidence(source.confidence),
    rationale: safeString(source.rationale).slice(0, MAX_TEXT),
    constraints: safeArray(source.constraints).map((item) => safeString(item)).filter(Boolean),
    assumptions: safeArray(source.assumptions).map((item) => safeString(item)).filter(Boolean),
    blockers: safeArray(source.blockers).map((item) => safeString(item)).filter(Boolean),
    warnings: safeArray(source.warnings).map((item) => safeString(item)).filter(Boolean),
    targetSubsystems: safeArray(source.targetSubsystems).map((item) => safeString(item)).filter(Boolean),
    buildScope: safeString(source.buildScope || 'bounded'),
    agentAssignments: normalizeObjectList(source.agentAssignments),
    toolPlan: normalizeObjectList(source.toolPlan),
    stepPlan: safeArray(source.stepPlan).map((item) => safeString(item)).filter(Boolean),
    successCriteria: safeArray(source.successCriteria).map((item) => safeString(item)).filter(Boolean),
    rollbackConsiderations: safeArray(source.rollbackConsiderations).map((item) => safeString(item)).filter(Boolean),
    evidenceSources: safeArray(source.evidenceSources).map((item) => safeString(item)).filter(Boolean),
    roadmapPromotionCandidate: safeBoolean(source.roadmapPromotionCandidate),
    codexHandoffEligible: safeBoolean(source.codexHandoffEligible),
    codexPromptSummary: safeString(source.codexPromptSummary).slice(0, MAX_TEXT),
    executionTruthPreserved: source.executionTruthPreserved !== false,
    approvalRequired: source.approvalRequired !== false,
    graphLinkSuggested: safeBoolean(source.graphLinkSuggested),
    graphLinkEligible: safeBoolean(source.graphLinkEligible),
    relatedSubsystemNodes: safeArray(source.relatedSubsystemNodes).map((item) => safeString(item)).filter(Boolean),
    dependencyEdgesSuggested: safeArray(source.dependencyEdgesSuggested).map((item) => safeString(item)).filter(Boolean),
    graphPromotionDeferredReason: safeString(source.graphPromotionDeferredReason).slice(0, MAX_TEXT),
  };
}
