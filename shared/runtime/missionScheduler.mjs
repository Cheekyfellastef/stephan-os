const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIVE_STATES = new Set(['ACTIVE', 'IMPLEMENTING', 'CI_REVIEW', 'PROOF_RUNNING']);
const RUNNABLE_STATES = new Set(['QUEUED', 'READY']);
const COMPLETION_STATES = new Set(['COMPLETE', 'CLOSED']);
const TERMINAL_STATES = new Set(['COMPLETE', 'CLOSED', 'SUPERSEDED', 'DUPLICATE']);
const ROUTES = new Set(['CHATGPT_GITHUB','OPENCLAW_LOCAL','BATTLE_BRIDGE_FIXED_TEST','REMOTE_CODEX','OPERATOR_APPROVAL','WAITING_FOR_EXTERNAL_CONDITION','BLOCKED_UNSAFE_OR_UNKNOWN']);
const CHAT_EVIDENCE_LIMIT = 20;
const CHAT_NESTED_LIMIT = 20;
const CHAT_STRING_LIMIT = 512;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const [key, entry] of Object.entries(value)) value[key] = freeze(entry);
  return Object.freeze(value);
}
function text(value, fallback = '') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function issueNumber(value) {
  const raw = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function sha(value) { return typeof value === 'string' && SHA_RE.test(value.trim()) ? value.trim().toLowerCase() : null; }
function positiveNumber(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function normalizedStringArray(value) { return Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : []; }
function invalidArrayContainer(object, key) { return hasOwn(object, key) && !Array.isArray(object[key]); }

function normalizeGoal(candidate = {}) {
  const goal = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const number = issueNumber(goal.issue ?? goal.issueNumber);
  const prerequisitesPresent = hasOwn(goal, 'prerequisites');
  const invalidPrerequisiteContainer = prerequisitesPresent && !Array.isArray(goal.prerequisites);
  const rawPrerequisites = Array.isArray(goal.prerequisites) ? goal.prerequisites : [];
  const normalizedPrerequisites = rawPrerequisites.map(issueNumber);
  const prerequisites = [...new Set(normalizedPrerequisites.filter(Boolean))];
  const invalidPrerequisites = rawPrerequisites.filter((_, index) => !normalizedPrerequisites[index]).map(String);
  const duplicateOfPresent = hasOwn(goal, 'duplicateOf') && goal.duplicateOf !== null && goal.duplicateOf !== undefined && goal.duplicateOf !== '';
  const supersededByPresent = hasOwn(goal, 'supersededBy') && goal.supersededBy !== null && goal.supersededBy !== undefined && goal.supersededBy !== '';
  const duplicateOf = issueNumber(goal.duplicateOf);
  const supersededBy = issueNumber(goal.supersededBy);
  const invalidInvalidationClaims = [
    ...(duplicateOfPresent && (!duplicateOf || duplicateOf === number) ? ['duplicateOf'] : []),
    ...(supersededByPresent && (!supersededBy || supersededBy === number) ? ['supersededBy'] : []),
  ];
  const approvalRequiredPresent = hasOwn(goal, 'approvalRequired');
  const invalidApprovalRequired = approvalRequiredPresent && typeof goal.approvalRequired !== 'boolean';
  const operatorPriorityPresent = hasOwn(goal, 'operatorPriority');
  const invalidOperatorPriority = operatorPriorityPresent && typeof goal.operatorPriority !== 'boolean';
  const repairCycleCountPresent = hasOwn(goal, 'repairCycleCount');
  const invalidRepairCycleCount = repairCycleCountPresent && (!Number.isSafeInteger(goal.repairCycleCount) || goal.repairCycleCount < 0);
  const repairCycleCount = invalidRepairCycleCount || !repairCycleCountPresent ? 0 : goal.repairCycleCount;
  const resultProofRefs = normalizedStringArray(goal.resultProofRefs);
  const structuralReviewProofRefs = normalizedStringArray(goal.structuralReviewProofRefs);
  const modelTestProofRefs = normalizedStringArray(goal.modelTestProofRefs);
  const invalidFlywheelEvidenceContainers = [
    ...(invalidArrayContainer(goal, 'resultProofRefs') ? ['resultProofRefs'] : []),
    ...(invalidArrayContainer(goal, 'structuralReviewProofRefs') ? ['structuralReviewProofRefs'] : []),
    ...(invalidArrayContainer(goal, 'modelTestProofRefs') ? ['modelTestProofRefs'] : []),
  ];
  const reusableCapabilityId = text(goal.reusableCapabilityId) || null;
  const sharedLessonId = text(goal.sharedLessonId) || null;
  const flywheelOutputsComplete = resultProofRefs.length > 0 && Boolean(reusableCapabilityId) && Boolean(sharedLessonId);
  const convergenceReviewRequired = repairCycleCount >= 3;
  const convergenceEvidenceComplete = !convergenceReviewRequired || (structuralReviewProofRefs.length > 0 && modelTestProofRefs.length > 0);
  const state = text(goal.state, 'UNKNOWN').toUpperCase();
  const route = ROUTES.has(goal.route) ? goal.route : 'BLOCKED_UNSAFE_OR_UNKNOWN';
  const headSha = sha(goal.headSha);
  const operatorApprovalHeadSha = sha(goal.operatorApprovalHeadSha);
  return freeze({
    issue:number,
    title:text(goal.title, number ? `Goal #${number}` : 'Unknown goal'),
    state,
    prerequisites,
    invalidPrerequisites,
    invalidPrerequisiteContainer,
    invalidInvalidationClaims,
    invalidApprovalRequired,
    invalidOperatorPriority,
    invalidRepairCycleCount,
    invalidFlywheelEvidenceContainers,
    priority:positiveNumber(goal.priority),
    criticalPathWeight:positiveNumber(goal.criticalPathWeight),
    reversibility:text(goal.reversibility, 'UNKNOWN').toUpperCase(),
    route,
    activePr:issueNumber(goal.activePr),
    branch:text(goal.branch) || null,
    headSha,
    proofState:text(goal.proofState, 'UNKNOWN').toUpperCase(),
    approvalRequired:goal.approvalRequired === true,
    operatorPriority:goal.operatorPriority === true,
    operatorApprovalHeadSha,
    exactHeadApprovalSatisfied:Boolean(headSha && operatorApprovalHeadSha === headSha),
    duplicateOf,
    supersededBy,
    evidenceAt:text(goal.evidenceAt) || null,
    resultProofRefs,
    reusableCapabilityId,
    sharedLessonId,
    flywheelOutputsComplete,
    repairCycleCount,
    convergenceReviewRequired,
    structuralReviewProofRefs,
    modelTestProofRefs,
    convergenceEvidenceComplete,
  });
}

function detectCycles(goalsByIssue) {
  const visiting = new Set(); const visited = new Set(); const cycles = [];
  function visit(issue, path = []) {
    if (visiting.has(issue)) { const start = path.indexOf(issue); cycles.push([...path.slice(start), issue]); return; }
    if (visited.has(issue)) return;
    visiting.add(issue);
    for (const dependency of goalsByIssue.get(issue)?.prerequisites ?? []) if (goalsByIssue.has(dependency)) visit(dependency, [...path, issue]);
    visiting.delete(issue); visited.add(issue);
  }
  for (const issue of goalsByIssue.keys()) visit(issue);
  return cycles;
}
function hasMalformedRelations(goal) { return goal.invalidPrerequisiteContainer || goal.invalidPrerequisites.length || goal.invalidInvalidationClaims.length; }
function hasMalformedEvidence(goal) { return hasMalformedRelations(goal) || goal.invalidApprovalRequired || goal.invalidOperatorPriority || goal.invalidRepairCycleCount || goal.invalidFlywheelEvidenceContainers.length; }
function completionOutputsSatisfied(goal) { return goal.flywheelOutputsComplete && goal.convergenceEvidenceComplete; }
function dependencyComplete(goal, goalsByIssue, staleByGoal, seen = new Set()) {
  const finalGateBlocked = goal?.approvalRequired === true || goal?.route === 'OPERATOR_APPROVAL' || goal?.route === 'WAITING_FOR_EXTERNAL_CONDITION' || goal?.route === 'BLOCKED_UNSAFE_OR_UNKNOWN';
  if (!goal || !goal.issue || hasMalformedEvidence(goal) || staleByGoal.get(goal) || goal.duplicateOf || goal.supersededBy || finalGateBlocked || !COMPLETION_STATES.has(goal.state) || !completionOutputsSatisfied(goal)) return false;
  if (seen.has(goal.issue)) return false;
  const nextSeen = new Set(seen).add(goal.issue);
  return goal.prerequisites.every((issue) => dependencyComplete(goalsByIssue.get(issue), goalsByIssue, staleByGoal, nextSeen));
}
function dependencyStatus(goal, goalsByIssue, staleByGoal) {
  if (goal.invalidPrerequisiteContainer || goal.invalidPrerequisites.length) return 'INVALID';
  if (goal.prerequisites.some((issue) => !goalsByIssue.has(issue))) return 'MISSING';
  if (goal.prerequisites.some((issue) => !dependencyComplete(goalsByIssue.get(issue), goalsByIssue, staleByGoal))) return 'INCOMPLETE';
  return 'SATISFIED';
}
function classify(goal, goalsByIssue, activeGoals, rejectedActiveClaims, staleByGoal, stale, provenHeads) {
  if (!goal.issue || hasMalformedEvidence(goal)) return 'BLOCKED';
  if (!goal.convergenceEvidenceComplete) return 'STRUCTURAL_REVIEW_REQUIRED';
  if (goal.duplicateOf) return 'DUPLICATE';
  if (goal.supersededBy) return 'SUPERSEDED';
  if (stale) return 'STALLED';
  if (rejectedActiveClaims.has(goal)) return 'BLOCKED';
  const dependencies = dependencyStatus(goal, goalsByIssue, staleByGoal);
  if (dependencies === 'INVALID' || dependencies === 'MISSING') return 'BLOCKED';
  if (dependencies === 'INCOMPLETE') return 'WAITING_FOR_DEPENDENCY';
  if (goal.route === 'WAITING_FOR_EXTERNAL_CONDITION') return 'WAITING_FOR_EXTERNAL_CONDITION';
  if (goal.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') return 'BLOCKED';
  if (activeGoals.has(goal)) return 'ACTIVE';
  if (goal.approvalRequired || goal.route === 'OPERATOR_APPROVAL' || goal.state === 'APPROVAL_REQUIRED') return 'APPROVAL_REQUIRED';
  if (TERMINAL_STATES.has(goal.state)) {
    if (COMPLETION_STATES.has(goal.state) && !goal.flywheelOutputsComplete) return 'FLYWHEEL_OUTPUTS_REQUIRED';
    return goal.state === 'COMPLETE' ? 'CLOSE_READY' : goal.state;
  }
  if (goal.state === 'IMPLEMENTED') {
    const exactHeadProven = Boolean(goal.headSha && provenHeads.has(goal.headSha));
    if (!(goal.proofState === 'PASS' && goal.activePr && exactHeadProven)) return 'IMPLEMENTED_NEEDS_PROOF';
    return goal.exactHeadApprovalSatisfied ? 'MERGE_READY' : 'APPROVAL_REQUIRED';
  }
  if (!RUNNABLE_STATES.has(goal.state)) return 'BLOCKED';
  return 'READY';
}
function compareDescendingNumber(a, b) { return a === b ? 0 : a > b ? -1 : 1; }
function compareReady(a, b) {
  if (a.operatorPriority !== b.operatorPriority) return a.operatorPriority ? -1 : 1;
  const priorityOrder = compareDescendingNumber(a.priority, b.priority);
  if (priorityOrder) return priorityOrder;
  const criticalPathOrder = compareDescendingNumber(a.criticalPathWeight, b.criticalPathWeight);
  if (criticalPathOrder) return criticalPathOrder;
  const reversibilityRank = { HIGH:2, MEDIUM:1 };
  const reversibilityOrder = compareDescendingNumber(reversibilityRank[a.reversibility] ?? 0, reversibilityRank[b.reversibility] ?? 0);
  if (reversibilityOrder) return reversibilityOrder;
  const githubFirstOrder = compareDescendingNumber(a.route === 'CHATGPT_GITHUB' ? 1 : 0, b.route === 'CHATGPT_GITHUB' ? 1 : 0);
  return githubFirstOrder || a.issue - b.issue;
}
function selectionRationale(goal) {
  const criteria = [
    goal.operatorPriority ? 'operator priority' : null,
    `priority ${goal.priority}`,
    `critical-path weight ${goal.criticalPathWeight}`,
    `reversibility ${goal.reversibility}`,
    `route ${goal.route}`,
  ].filter(Boolean);
  return `Selected by lexicographic scheduler order: ${criteria.join(', ')}.`;
}
function lifecycleBlockers(portfolio) {
  const blocked = new Set(['BLOCKED','STALLED','WAITING_FOR_DEPENDENCY','WAITING_FOR_EXTERNAL_CONDITION','APPROVAL_REQUIRED','IMPLEMENTED_NEEDS_PROOF','FLYWHEEL_OUTPUTS_REQUIRED','STRUCTURAL_REVIEW_REQUIRED']);
  return portfolio.filter((goal) => blocked.has(goal.lifecycle)).map((goal) => ({
    code:`GOAL_${goal.lifecycle}`,
    issue:goal.issue,
    route:goal.route,
    prerequisites:goal.prerequisites,
    invalidPrerequisites:goal.invalidPrerequisites,
    invalidPrerequisiteContainer:goal.invalidPrerequisiteContainer,
    invalidInvalidationClaims:goal.invalidInvalidationClaims,
    invalidApprovalRequired:goal.invalidApprovalRequired,
    invalidOperatorPriority:goal.invalidOperatorPriority,
    invalidRepairCycleCount:goal.invalidRepairCycleCount,
    invalidFlywheelEvidenceContainers:goal.invalidFlywheelEvidenceContainers,
    flywheelOutputsComplete:goal.flywheelOutputsComplete,
    exactHeadApprovalSatisfied:goal.exactHeadApprovalSatisfied,
    repairCycleCount:goal.repairCycleCount,
    convergenceReviewRequired:goal.convergenceReviewRequired,
    convergenceEvidenceComplete:goal.convergenceEvidenceComplete,
    evidenceFreshness:goal.evidenceFreshness,
  }));
}
function compactString(value) {
  const normalized = String(value);
  return normalized.length <= CHAT_STRING_LIMIT ? normalized : `${normalized.slice(0, CHAT_STRING_LIMIT)}…`;
}
function compactArray(values) { return Array.isArray(values) ? values.slice(0, CHAT_NESTED_LIMIT).map((entry) => typeof entry === 'string' ? compactString(entry) : entry) : values; }
function compactBlocker(blocker) {
  return Object.fromEntries(Object.entries(blocker).map(([key, value]) => [key, Array.isArray(value) ? compactArray(value) : typeof value === 'string' ? compactString(value) : value]));
}

export function buildMissionScheduler(input = {}) {
  const publicInputInvalid = !input || typeof input !== 'object' || Array.isArray(input);
  const source = publicInputInvalid ? {} : input;
  const nowPresent = hasOwn(source, 'now');
  const parsedNowMs = Date.parse(source.now);
  const nowInvalid = nowPresent && !Number.isFinite(parsedNowMs);
  const nowMs = nowInvalid || !nowPresent ? Date.now() : parsedNowMs;
  const freshnessPresent = hasOwn(source, 'freshnessMs');
  const freshnessInvalid = freshnessPresent && (typeof source.freshnessMs !== 'number' || !Number.isFinite(source.freshnessMs) || source.freshnessMs <= 0);
  const freshnessMs = freshnessInvalid || !freshnessPresent ? 15 * 60 * 1000 : source.freshnessMs;
  const goalsContainerInvalid = hasOwn(source, 'goals') && !Array.isArray(source.goals);
  const proofHeadsContainerInvalid = hasOwn(source, 'proofHeadShas') && !Array.isArray(source.proofHeadShas);
  const rawProofHeads = Array.isArray(source.proofHeadShas) ? source.proofHeadShas : [];
  const normalizedProofHeads = rawProofHeads.map(sha);
  const invalidProofHeads = rawProofHeads.filter((_, index) => !normalizedProofHeads[index]).map(String);
  const provenHeads = new Set(normalizedProofHeads.filter(Boolean));
  const goals = (Array.isArray(source.goals) ? source.goals : []).map(normalizeGoal);
  const issueCounts = new Map();
  for (const goal of goals) if (goal.issue) issueCounts.set(goal.issue, (issueCounts.get(goal.issue) ?? 0) + 1);
  const duplicateIssueIds = [...issueCounts].filter(([, count]) => count > 1).map(([issue]) => issue);
  const goalsByIssue = new Map(goals.filter((goal) => goal.issue && issueCounts.get(goal.issue) === 1).map((goal) => [goal.issue, goal]));
  const staleByGoal = new Map(goals.map((goal) => { const at = goal.evidenceAt ? Date.parse(goal.evidenceAt) : NaN; return [goal, !Number.isFinite(at) || nowMs - at > freshnessMs || at - nowMs > 60_000]; }));
  const claimed = goals.filter((goal) => ACTIVE_STATES.has(goal.state));
  const authoritative = []; const rejectedActiveClaims = new Set(); const contradictions = [];
  if (publicInputInvalid) contradictions.push({ code:'INVALID_PUBLIC_INPUT' });
  if (nowInvalid || freshnessInvalid) contradictions.push({ code:'INVALID_SCHEDULER_CLOCK', invalidNow:nowInvalid, invalidFreshnessMs:freshnessInvalid });
  if (goalsContainerInvalid) contradictions.push({ code:'INVALID_GOALS_CONTAINER' });
  if (proofHeadsContainerInvalid || invalidProofHeads.length) contradictions.push({ code:'INVALID_PROOF_HEAD_EVIDENCE', invalidProofHeads });
  for (const issue of duplicateIssueIds) contradictions.push({ code:'DUPLICATE_GOAL_IDENTITY', issue });
  for (const goal of goals) if (goal.invalidOperatorPriority) contradictions.push({ code:'INVALID_OPERATOR_PRIORITY_EVIDENCE', issue:goal.issue });
  for (const goal of claimed) {
    if (!goal.issue) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_GOAL_IDENTITY_MISSING', issue:null }); }
    else if (issueCounts.get(goal.issue) > 1) { rejectedActiveClaims.add(goal); }
    else if (goal.invalidApprovalRequired) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_APPROVAL_GATE_INVALID', issue:goal.issue }); }
    else if (goal.invalidOperatorPriority) { rejectedActiveClaims.add(goal); }
    else if (goal.invalidRepairCycleCount || goal.invalidFlywheelEvidenceContainers.length) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_FLYWHEEL_EVIDENCE_INVALID', issue:goal.issue }); }
    else if (!goal.convergenceEvidenceComplete) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_STRUCTURAL_REVIEW_REQUIRED', issue:goal.issue }); }
    else if (hasMalformedRelations(goal)) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_RELATION_EVIDENCE_INVALID', issue:goal.issue }); }
    else if (goal.duplicateOf || goal.supersededBy) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_GOAL_INVALIDATED', issue:goal.issue }); }
    else if (staleByGoal.get(goal)) { rejectedActiveClaims.add(goal); contradictions.push({ code:'STALE_ACTIVE_EVIDENCE', issue:goal.issue }); }
    else if (!goal.activePr && !goal.branch) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_LANE_IDENTITY_MISSING', issue:goal.issue }); }
    else if (goal.route === 'BLOCKED_UNSAFE_OR_UNKNOWN' || goal.route === 'WAITING_FOR_EXTERNAL_CONDITION') { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_ROUTE_NOT_EXECUTABLE', issue:goal.issue, route:goal.route }); }
    else if (dependencyStatus(goal, goalsByIssue, staleByGoal) !== 'SATISFIED') { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_DEPENDENCY_UNSATISFIED', issue:goal.issue }); }
    else authoritative.push(goal);
  }
  if (authoritative.length > 1) contradictions.push({ code:'MULTIPLE_ACTIVE_LANES', issues:authoritative.map((goal) => goal.issue) });
  for (const cycle of detectCycles(goalsByIssue)) contradictions.push({ code:'DEPENDENCY_CYCLE', issues:cycle });
  const activeGoals = new Set(contradictions.length === 0 && authoritative.length === 1 ? authoritative : []);
  const portfolio = goals.map((goal) => freeze({ ...goal, lifecycle:classify(goal, goalsByIssue, activeGoals, rejectedActiveClaims, staleByGoal, staleByGoal.get(goal), provenHeads), evidenceFreshness:staleByGoal.get(goal) ? 'STALE' : 'FRESH' }));
  const ready = portfolio.filter((goal) => goal.lifecycle === 'READY').sort(compareReady);
  const mergeReady = portfolio.filter((goal) => goal.lifecycle === 'MERGE_READY').sort(compareReady);
  const closeReady = portfolio.filter((goal) => goal.lifecycle === 'CLOSE_READY').sort(compareReady);
  const approvalGoals = portfolio.filter((goal) => goal.lifecycle === 'APPROVAL_REQUIRED');
  const failClosed = contradictions.length > 0;
  const activeClaim = !failClosed && authoritative.length === 1 ? authoritative[0] : null;
  const active = activeClaim ? portfolio[goals.indexOf(activeClaim)] : null;
  const action = failClosed || active ? null : mergeReady[0] ?? ready[0] ?? closeReady[0] ?? null;
  const operatorNeeded = approvalGoals.length > 0 || Boolean(active?.approvalRequired || active?.route === 'OPERATOR_APPROVAL' || action?.route === 'OPERATOR_APPROVAL');
  const blockers = freeze([...contradictions, ...lifecycleBlockers(portfolio)]);
  const programmeStatus = failClosed ? 'BLOCKED' : active ? 'IN_PROGRESS' : action?.lifecycle === 'MERGE_READY' ? 'MERGE_READY' : action?.lifecycle === 'CLOSE_READY' ? 'CLOSE_READY' : action ? 'READY_TO_ADVANCE' : operatorNeeded ? 'APPROVAL_REQUIRED' : 'WAITING';
  const actionable = [...mergeReady, ...ready, ...closeReady];
  return freeze({
    schemaVersion:'stephanos.mission-scheduler.v1', readOnly:true, failClosed, contradictions, blockers,
    programmeStatus,
    activeGoal:active?.issue ? `#${active.issue}` : null,
    activeLane:active?.activePr ? `PR #${active.activePr}` : active?.branch ?? null,
    whyNow:failClosed ? `Scheduling failed closed: ${contradictions.map(({code}) => code).join(', ')}.` : active ? 'Existing fresh, identified active lane remains authoritative.' : action?.lifecycle === 'MERGE_READY' ? 'Exact-head-proven and exact-head-approved implementation is ready for guarded merge.' : action?.lifecycle === 'CLOSE_READY' ? 'Completed goal is ready for guarded closure.' : action ? selectionRationale(action) : operatorNeeded ? 'Operator approval is required before work can advance.' : 'No eligible lane is currently available.',
    selectedGoal:action?.issue ? `#${action.issue}` : null,
    selectedRoute:action?.route ?? null,
    selectedLifecycle:action?.lifecycle ?? null,
    nextEligible:failClosed ? [] : actionable.filter((goal) => goal !== action).slice(0,3).map((goal) => `#${goal.issue}`),
    operatorNeeded,
    operatorAction:operatorNeeded ? 'OPERATOR_APPROVAL_REQUIRED' : 'NO_OPERATOR_ACTION_REQUIRED',
    portfolio,
    decisionReceipt:{ correlationId:text(source.correlationId, `scheduler-${nowMs}`), decidedAt:new Date(nowMs).toISOString(), status:failClosed ? 'BLOCKED_FAIL_CLOSED' : active ? 'ACTIVE_LANE' : action?.lifecycle === 'MERGE_READY' ? 'MERGE_READY' : action?.lifecycle === 'CLOSE_READY' ? 'CLOSE_READY' : action ? 'LANE_SELECTED' : operatorNeeded ? 'APPROVAL_REQUIRED' : 'WAITING', failClosed, contradictionCodes:contradictions.map(({code}) => code), selectedIssue:action?.issue ?? null, selectedLifecycle:action?.lifecycle ?? null, activeIssue:active?.issue ?? null, route:failClosed ? 'BLOCKED_UNSAFE_OR_UNKNOWN' : action?.route ?? active?.route ?? (operatorNeeded ? 'OPERATOR_APPROVAL' : 'WAITING_FOR_EXTERNAL_CONDITION'), proofRefs:Array.isArray(source.proofRefs) ? source.proofRefs.map(String) : [], proofHeadShas:[...provenHeads] }
  });
}

export function answerMissionQuery(input = {}, query = '') {
  const scheduler = buildMissionScheduler(input); const normalized = text(query).toLowerCase();
  const evidenceFreshness = scheduler.portfolio.length === 0 ? 'NO_EVIDENCE' : scheduler.portfolio.some((goal) => goal.evidenceFreshness === 'STALE') ? 'MIXED_OR_STALE' : 'FRESH';
  const blockersTotal = scheduler.blockers.length;
  const proofRefsTotal = scheduler.decisionReceipt.proofRefs.length;
  const base = {
    programmeStatus:scheduler.programmeStatus,
    activeGoal:scheduler.activeGoal,
    activeLane:scheduler.activeLane,
    whyNow:scheduler.whyNow,
    selectedGoal:scheduler.selectedGoal,
    selectedRoute:scheduler.selectedRoute,
    selectedLifecycle:scheduler.selectedLifecycle,
    blockers:scheduler.blockers.slice(0, CHAT_EVIDENCE_LIMIT).map(compactBlocker),
    blockersTotal,
    nextEligible:scheduler.nextEligible,
    operatorNeeded:scheduler.operatorNeeded,
    operatorAction:scheduler.operatorAction,
    evidenceFreshness,
    proofRefs:scheduler.decisionReceipt.proofRefs.slice(0, CHAT_EVIDENCE_LIMIT).map(compactString),
    proofRefsTotal,
  };
  if (normalized.includes('blocked')) return freeze({ ...base, focus:'BLOCKERS' });
  if (normalized.includes('next')) return freeze({ ...base, focus:'NEXT_ELIGIBLE' });
  if (normalized.includes('need anything') || normalized.includes('operator')) return freeze({ ...base, focus:'OPERATOR_ACTION' });
  return freeze({ ...base, focus:'PROGRAMME_STATUS' });
}