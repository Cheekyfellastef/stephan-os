const SHA_RE = /^[0-9a-f]{40}$/i;
const EXPLICIT_TZ_RE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ACTIVE_STATES = new Set(['ACTIVE', 'IMPLEMENTING', 'CI_REVIEW', 'PROOF_RUNNING']);
const RUNNABLE_STATES = new Set(['QUEUED', 'READY']);
const COMPLETION_STATES = new Set(['COMPLETE', 'CLOSED']);
const TERMINAL_STATES = new Set(['COMPLETE', 'CLOSED', 'SUPERSEDED', 'DUPLICATE']);
const ROUTES = new Set(['CHATGPT_GITHUB','OPENCLAW_LOCAL','BATTLE_BRIDGE_FIXED_TEST','REMOTE_CODEX','OPERATOR_APPROVAL','WAITING_FOR_EXTERNAL_CONDITION','BLOCKED_UNSAFE_OR_UNKNOWN']);
const CHAT_EVIDENCE_LIMIT = 20;
const CHAT_NESTED_LIMIT = 20;
const CHAT_STRING_LIMIT = 512;
const CONTRADICTION_SUMMARY_LIMIT = 5;
const MAX_PORTFOLIO_GOALS = 1000;
const MAX_PREREQUISITES_PER_GOAL = 1000;
const MAX_TOTAL_PREREQUISITES = 10000;
const MAX_EVIDENCE_ITEMS = 10000;
const MAX_CYCLE_EVIDENCE = 20;
const MAX_CYCLE_PATH_ISSUES = 20;
const MAX_LANE_IDENTITY_LENGTH = CHAT_STRING_LIMIT;
const AUTHORITY_BEARING_LIFECYCLES = new Set(['READY', 'MERGE_READY', 'CLOSE_READY', 'APPROVAL_REQUIRED']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(Array.from({ length:value.length }, (_, index) => freeze(value[index])));
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
function positiveNumber(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback; }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function normalizeStringEvidenceArray(object, key) {
  const present = hasOwn(object, key);
  const container = present ? object[key] : undefined;
  const invalidContainer = present && !Array.isArray(container);
  const boundExceeded = Array.isArray(container) && container.length > MAX_EVIDENCE_ITEMS;
  const raw = Array.isArray(container) && !boundExceeded ? container : [];
  const values = [];
  const invalidEntries = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (!hasOwn(raw, index) || typeof raw[index] !== 'string' || !raw[index].trim()) invalidEntries.push({ key, index });
    else values.push(raw[index].trim());
  }
  return { values, invalidContainer, invalidEntries, boundExceeded, suppliedCount:Array.isArray(container) ? container.length : 0 };
}
function normalizeBindingReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { receipt:null, invalid:value !== undefined && value !== null };
  const issue = issueNumber(value.issue ?? value.issueNumber);
  const activePr = issueNumber(value.activePr ?? value.pr);
  const headSha = sha(value.headSha);
  const invalid = !issue || !activePr || !headSha;
  return { receipt:invalid ? null : freeze({ issue, activePr, headSha }), invalid };
}
function bindingKey(issue, activePr, headSha) { return `${issue}:${activePr}:${headSha}`; }
function explicitTimestampMs(value) {
  if (typeof value !== 'string') return NaN;
  const normalized = value.trim();
  if (!normalized || !EXPLICIT_TZ_RE.test(normalized)) return NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeGoal(candidate = {}) {
  const goal = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const number = issueNumber(goal.issue ?? goal.issueNumber);
  const prerequisitesPresent = hasOwn(goal, 'prerequisites');
  const invalidPrerequisiteContainer = prerequisitesPresent && !Array.isArray(goal.prerequisites);
  const suppliedPrerequisiteCount = Array.isArray(goal.prerequisites) ? goal.prerequisites.length : 0;
  const prerequisiteBoundExceeded = suppliedPrerequisiteCount > MAX_PREREQUISITES_PER_GOAL;
  const rawPrerequisites = Array.isArray(goal.prerequisites) && !prerequisiteBoundExceeded ? goal.prerequisites : [];
  const normalizedPrerequisites = Array.from({ length:rawPrerequisites.length }, (_, index) => issueNumber(rawPrerequisites[index]));
  const prerequisites = [...new Set(normalizedPrerequisites.filter(Boolean))];
  const invalidPrerequisites = [];
  for (let index = 0; index < rawPrerequisites.length; index += 1) if (!hasOwn(rawPrerequisites, index) || !normalizedPrerequisites[index]) invalidPrerequisites.push(`index:${index}`);
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
  const resultEvidence = normalizeStringEvidenceArray(goal, 'resultProofRefs');
  const structuralEvidence = normalizeStringEvidenceArray(goal, 'structuralReviewProofRefs');
  const modelEvidence = normalizeStringEvidenceArray(goal, 'modelTestProofRefs');
  const resultProofRefs = resultEvidence.values;
  const structuralReviewProofRefs = structuralEvidence.values;
  const modelTestProofRefs = modelEvidence.values;
  const invalidFlywheelEvidenceContainers = [
    ...(resultEvidence.invalidContainer ? ['resultProofRefs'] : []),
    ...(structuralEvidence.invalidContainer ? ['structuralReviewProofRefs'] : []),
    ...(modelEvidence.invalidContainer ? ['modelTestProofRefs'] : []),
  ];
  const boundExceededFlywheelEvidence = [
    ...(resultEvidence.boundExceeded ? [{ key:'resultProofRefs', suppliedCount:resultEvidence.suppliedCount }] : []),
    ...(structuralEvidence.boundExceeded ? [{ key:'structuralReviewProofRefs', suppliedCount:structuralEvidence.suppliedCount }] : []),
    ...(modelEvidence.boundExceeded ? [{ key:'modelTestProofRefs', suppliedCount:modelEvidence.suppliedCount }] : []),
  ];
  const invalidFlywheelEvidenceEntries = [...resultEvidence.invalidEntries, ...structuralEvidence.invalidEntries, ...modelEvidence.invalidEntries];
  const reusableCapabilityId = text(goal.reusableCapabilityId) || null;
  const sharedLessonId = text(goal.sharedLessonId) || null;
  const flywheelOutputsComplete = resultProofRefs.length > 0 && Boolean(reusableCapabilityId) && Boolean(sharedLessonId);
  const convergenceReviewRequired = repairCycleCount >= 3;
  const convergenceEvidenceComplete = !convergenceReviewRequired || (structuralReviewProofRefs.length > 0 && modelTestProofRefs.length > 0);
  const state = text(goal.state, 'UNKNOWN').toUpperCase();
  const route = ROUTES.has(goal.route) ? goal.route : 'BLOCKED_UNSAFE_OR_UNKNOWN';
  const activePr = issueNumber(goal.activePr);
  const headSha = sha(goal.headSha);
  const rawBranch = text(goal.branch) || null;
  const branchBoundExceeded = Boolean(rawBranch && rawBranch.length > MAX_LANE_IDENTITY_LENGTH);
  const branch = branchBoundExceeded ? null : rawBranch;
  const approvalBinding = normalizeBindingReceipt(goal.operatorApprovalReceipt);
  const operatorApprovalReceipt = approvalBinding.receipt;
  const invalidOperatorApprovalReceipt = approvalBinding.invalid;
  const exactHeadApprovalSatisfied = Boolean(operatorApprovalReceipt && number && activePr && headSha && bindingKey(operatorApprovalReceipt.issue, operatorApprovalReceipt.activePr, operatorApprovalReceipt.headSha) === bindingKey(number, activePr, headSha));
  return freeze({ issue:number, title:text(goal.title, number ? `Goal #${number}` : 'Unknown goal'), state, prerequisites, invalidPrerequisites, invalidPrerequisiteContainer, prerequisiteBoundExceeded, suppliedPrerequisiteCount, invalidInvalidationClaims, invalidApprovalRequired, invalidOperatorPriority, invalidRepairCycleCount, invalidFlywheelEvidenceContainers, boundExceededFlywheelEvidence, invalidFlywheelEvidenceEntries, invalidOperatorApprovalReceipt, branchBoundExceeded, priority:positiveNumber(goal.priority), criticalPathWeight:positiveNumber(goal.criticalPathWeight), reversibility:text(goal.reversibility, 'UNKNOWN').toUpperCase(), route, activePr, branch, headSha, proofState:text(goal.proofState, 'UNKNOWN').toUpperCase(), approvalRequired:goal.approvalRequired === true, operatorPriority:goal.operatorPriority === true, operatorApprovalReceipt, exactHeadApprovalSatisfied, duplicateOf, supersededBy, evidenceAt:text(goal.evidenceAt) || null, resultProofRefs, reusableCapabilityId, sharedLessonId, flywheelOutputsComplete, repairCycleCount, convergenceReviewRequired, structuralReviewProofRefs, modelTestProofRefs, convergenceEvidenceComplete });
}

function cycleEvidence(path, start, dependency) {
  const fullLength = path.length - start + 1;
  if (fullLength <= MAX_CYCLE_PATH_ISSUES) return { issues:[...path.slice(start), dependency], truncated:false, totalIssues:fullLength };
  return { issues:path.slice(start, start + MAX_CYCLE_PATH_ISSUES), truncated:true, totalIssues:fullLength, closesTo:dependency };
}
function detectCycles(goalsByIssue) {
  const state = new Map();
  const cycles = [];
  let detectedBackEdges = 0;
  for (const root of goalsByIssue.keys()) {
    if (state.get(root) === 2) continue;
    const stack = [{ issue:root, dependencies:null, index:0 }];
    const path = [];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.dependencies === null) {
        if (state.get(frame.issue) === 2) { stack.pop(); continue; }
        state.set(frame.issue, 1);
        path.push(frame.issue);
        frame.dependencies = (goalsByIssue.get(frame.issue)?.prerequisites ?? []).filter((dependency) => goalsByIssue.has(dependency));
      }
      if (frame.index >= frame.dependencies.length) {
        state.set(frame.issue, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const dependency = frame.dependencies[frame.index++];
      if (state.get(dependency) === 1) {
        detectedBackEdges += 1;
        if (cycles.length < MAX_CYCLE_EVIDENCE) {
          const start = path.indexOf(dependency);
          cycles.push(cycleEvidence(path, start, dependency));
        }
      } else if (state.get(dependency) !== 2) stack.push({ issue:dependency, dependencies:null, index:0 });
    }
  }
  return { cycles, detectedBackEdges };
}
function hasMalformedRelations(goal) { return goal.invalidPrerequisiteContainer || goal.prerequisiteBoundExceeded || goal.invalidPrerequisites.length || goal.invalidInvalidationClaims.length; }
function hasMalformedEvidence(goal) { return hasMalformedRelations(goal) || goal.invalidApprovalRequired || goal.invalidOperatorPriority || goal.invalidRepairCycleCount || goal.invalidFlywheelEvidenceContainers.length || goal.boundExceededFlywheelEvidence.length || goal.invalidFlywheelEvidenceEntries.length || goal.invalidOperatorApprovalReceipt || goal.branchBoundExceeded; }
function completionOutputsSatisfied(goal) { return goal.flywheelOutputsComplete && goal.convergenceEvidenceComplete; }
function createDependencyAdjudicator(goalsByIssue, staleByGoal) {
  const memo = new Map(); const visiting = new Set();
  function dependencyComplete(goal) {
    if (!goal?.issue) return false;
    if (memo.has(goal.issue)) return memo.get(goal.issue);
    if (visiting.has(goal.issue)) return false;
    const finalGateBlocked = goal.approvalRequired === true || goal.route === 'OPERATOR_APPROVAL' || goal.route === 'WAITING_FOR_EXTERNAL_CONDITION' || goal.route === 'BLOCKED_UNSAFE_OR_UNKNOWN';
    if (hasMalformedEvidence(goal) || staleByGoal.get(goal) || goal.duplicateOf || goal.supersededBy || finalGateBlocked || !COMPLETION_STATES.has(goal.state) || !completionOutputsSatisfied(goal)) { memo.set(goal.issue, false); return false; }
    visiting.add(goal.issue);
    const complete = goal.prerequisites.every((issue) => dependencyComplete(goalsByIssue.get(issue)));
    visiting.delete(goal.issue); memo.set(goal.issue, complete); return complete;
  }
  return dependencyComplete;
}
function dependencyStatus(goal, goalsByIssue, dependencyComplete) {
  if (goal.invalidPrerequisiteContainer || goal.prerequisiteBoundExceeded || goal.invalidPrerequisites.length) return 'INVALID';
  if (goal.prerequisites.some((issue) => !goalsByIssue.has(issue))) return 'MISSING';
  if (goal.prerequisites.some((issue) => !dependencyComplete(goalsByIssue.get(issue)))) return 'INCOMPLETE';
  return 'SATISFIED';
}
function classify(goal, goalsByIssue, activeGoals, rejectedActiveClaims, stale, provenBindings, dependencyComplete) {
  if (!goal.issue || hasMalformedEvidence(goal)) return 'BLOCKED';
  if (!goal.convergenceEvidenceComplete) return 'STRUCTURAL_REVIEW_REQUIRED';
  if (goal.duplicateOf) return 'DUPLICATE';
  if (goal.supersededBy) return 'SUPERSEDED';
  if (stale) return 'STALLED';
  if (rejectedActiveClaims.has(goal)) return 'BLOCKED';
  const dependencies = dependencyStatus(goal, goalsByIssue, dependencyComplete);
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
    const exactHeadProven = Boolean(goal.issue && goal.activePr && goal.headSha && provenBindings.has(bindingKey(goal.issue, goal.activePr, goal.headSha)));
    if (!(goal.proofState === 'PASS' && goal.activePr && exactHeadProven)) return 'IMPLEMENTED_NEEDS_PROOF';
    return goal.exactHeadApprovalSatisfied ? 'MERGE_READY' : 'APPROVAL_REQUIRED';
  }
  if (!RUNNABLE_STATES.has(goal.state)) return 'BLOCKED';
  return 'READY';
}
function compareDescendingNumber(a, b) { return a === b ? 0 : a > b ? -1 : 1; }
function compareReady(a, b) {
  if (a.operatorPriority !== b.operatorPriority) return a.operatorPriority ? -1 : 1;
  const priorityOrder = compareDescendingNumber(a.priority, b.priority); if (priorityOrder) return priorityOrder;
  const criticalPathOrder = compareDescendingNumber(a.criticalPathWeight, b.criticalPathWeight); if (criticalPathOrder) return criticalPathOrder;
  const reversibilityRank = { HIGH:2, MEDIUM:1 };
  const reversibilityOrder = compareDescendingNumber(reversibilityRank[a.reversibility] ?? 0, reversibilityRank[b.reversibility] ?? 0); if (reversibilityOrder) return reversibilityOrder;
  const githubFirstOrder = compareDescendingNumber(a.route === 'CHATGPT_GITHUB' ? 1 : 0, b.route === 'CHATGPT_GITHUB' ? 1 : 0);
  return githubFirstOrder || a.issue - b.issue;
}
function selectionRationale(goal) { const criteria = [goal.operatorPriority ? 'operator priority' : null, `priority ${goal.priority}`, `critical-path weight ${goal.criticalPathWeight}`, `reversibility ${goal.reversibility}`, `route ${goal.route}`].filter(Boolean); return `Selected by lexicographic scheduler order: ${criteria.join(', ')}.`; }
function contradictionRationale(contradictions) { const visibleCodes = contradictions.slice(0, CONTRADICTION_SUMMARY_LIMIT).map(({ code }) => code); const hiddenCount = contradictions.length - visibleCodes.length; const hiddenSummary = hiddenCount > 0 ? `, plus ${hiddenCount} more contradiction${hiddenCount === 1 ? '' : 's'}` : ''; return `Scheduling failed closed: ${visibleCodes.join(', ')}${hiddenSummary}.`; }
function lifecycleBlockers(portfolio) {
  const blocked = new Set(['BLOCKED','STALLED','WAITING_FOR_DEPENDENCY','WAITING_FOR_EXTERNAL_CONDITION','APPROVAL_REQUIRED','IMPLEMENTED_NEEDS_PROOF','FLYWHEEL_OUTPUTS_REQUIRED','STRUCTURAL_REVIEW_REQUIRED']);
  return portfolio.filter((goal) => blocked.has(goal.lifecycle)).map((goal) => ({ code:`GOAL_${goal.lifecycle}`, issue:goal.issue, route:goal.route, candidateLifecycle:goal.candidateLifecycle ?? null, prerequisites:goal.prerequisites, invalidPrerequisites:goal.invalidPrerequisites, invalidPrerequisiteContainer:goal.invalidPrerequisiteContainer, prerequisiteBoundExceeded:goal.prerequisiteBoundExceeded, suppliedPrerequisiteCount:goal.suppliedPrerequisiteCount, invalidInvalidationClaims:goal.invalidInvalidationClaims, invalidApprovalRequired:goal.invalidApprovalRequired, invalidOperatorPriority:goal.invalidOperatorPriority, invalidRepairCycleCount:goal.invalidRepairCycleCount, invalidFlywheelEvidenceContainers:goal.invalidFlywheelEvidenceContainers, boundExceededFlywheelEvidence:goal.boundExceededFlywheelEvidence, invalidFlywheelEvidenceEntries:goal.invalidFlywheelEvidenceEntries, flywheelOutputsComplete:goal.flywheelOutputsComplete, exactHeadApprovalSatisfied:goal.exactHeadApprovalSatisfied, repairCycleCount:goal.repairCycleCount, convergenceReviewRequired:goal.convergenceReviewRequired, convergenceEvidenceComplete:goal.convergenceEvidenceComplete, evidenceFreshness:goal.evidenceFreshness }));
}
function compactString(value) { const normalized = String(value); return normalized.length <= CHAT_STRING_LIMIT ? normalized : `${normalized.slice(0, CHAT_STRING_LIMIT)}…`; }
function compactArray(values) { return Array.isArray(values) ? values.slice(0, CHAT_NESTED_LIMIT).map((entry) => typeof entry === 'string' ? compactString(entry) : entry) : values; }
function compactBlocker(blocker) { return Object.fromEntries(Object.entries(blocker).map(([key, value]) => [key, Array.isArray(value) ? compactArray(value) : typeof value === 'string' ? compactString(value) : value])); }

export function buildMissionScheduler(input = {}) {
  const publicInputInvalid = !input || typeof input !== 'object' || Array.isArray(input);
  const source = publicInputInvalid ? {} : input;
  const nowPresent = hasOwn(source, 'now');
  const parsedNowMs = nowPresent ? explicitTimestampMs(source.now) : NaN;
  const nowInvalid = nowPresent && !Number.isFinite(parsedNowMs);
  const nowMs = nowInvalid || !nowPresent ? Date.now() : parsedNowMs;
  const freshnessPresent = hasOwn(source, 'freshnessMs');
  const freshnessInvalid = freshnessPresent && (typeof source.freshnessMs !== 'number' || !Number.isFinite(source.freshnessMs) || source.freshnessMs <= 0);
  const freshnessMs = freshnessInvalid || !freshnessPresent ? 15 * 60 * 1000 : source.freshnessMs;
  const goalsContainerInvalid = hasOwn(source, 'goals') && !Array.isArray(source.goals);
  const proofHeadsContainerInvalid = hasOwn(source, 'proofHeadShas') && !Array.isArray(source.proofHeadShas);
  const proofHeadsBoundExceeded = Array.isArray(source.proofHeadShas) && source.proofHeadShas.length > MAX_EVIDENCE_ITEMS;
  const rawProofHeads = Array.isArray(source.proofHeadShas) && !proofHeadsBoundExceeded ? source.proofHeadShas : [];
  const normalizedProofHeads = Array.from({ length:rawProofHeads.length }, (_, index) => sha(rawProofHeads[index]));
  const invalidProofHeads = [];
  for (let index = 0; index < rawProofHeads.length; index += 1) if (!hasOwn(rawProofHeads, index) || !normalizedProofHeads[index]) invalidProofHeads.push({ index });
  const provenHeads = new Set(normalizedProofHeads.filter(Boolean));
  const proofReceiptsContainerInvalid = hasOwn(source, 'proofReceipts') && !Array.isArray(source.proofReceipts);
  const proofReceiptsBoundExceeded = Array.isArray(source.proofReceipts) && source.proofReceipts.length > MAX_EVIDENCE_ITEMS;
  const rawProofReceipts = Array.isArray(source.proofReceipts) && !proofReceiptsBoundExceeded ? source.proofReceipts : [];
  const proofReceipts = [];
  const invalidProofReceipts = [];
  for (let index = 0; index < rawProofReceipts.length; index += 1) {
    if (!hasOwn(rawProofReceipts, index)) { invalidProofReceipts.push({ index }); continue; }
    const normalized = normalizeBindingReceipt(rawProofReceipts[index]);
    if (normalized.invalid || !normalized.receipt) invalidProofReceipts.push({ index });
    else proofReceipts.push(normalized.receipt);
  }
  const provenBindings = new Set(proofReceipts.map(({ issue, activePr, headSha }) => bindingKey(issue, activePr, headSha)));
  const proofRefEvidence = normalizeStringEvidenceArray(source, 'proofRefs');
  const proofRefsContainerInvalid = proofRefEvidence.invalidContainer;
  const proofRefsBoundExceeded = proofRefEvidence.boundExceeded;
  const invalidProofRefs = proofRefEvidence.invalidEntries;
  const proofRefs = proofRefEvidence.values;
  const rawGoals = Array.isArray(source.goals) ? source.goals : [];
  const portfolioBoundExceeded = rawGoals.length > MAX_PORTFOLIO_GOALS;
  let totalPrerequisites = 0;
  let totalPrerequisiteBoundExceeded = false;
  if (!portfolioBoundExceeded) {
    for (const candidate of rawGoals) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !Array.isArray(candidate.prerequisites)) continue;
      totalPrerequisites += candidate.prerequisites.length;
    }
    totalPrerequisiteBoundExceeded = totalPrerequisites > MAX_TOTAL_PREREQUISITES;
  }
  const goals = portfolioBoundExceeded || totalPrerequisiteBoundExceeded ? [] : Array.from({ length:rawGoals.length }, (_, index) => normalizeGoal(rawGoals[index]));
  const issueCounts = new Map();
  for (const goal of goals) if (goal.issue) issueCounts.set(goal.issue, (issueCounts.get(goal.issue) ?? 0) + 1);
  const duplicateIssueIds = [...issueCounts].filter(([, count]) => count > 1).map(([issue]) => issue);
  const goalsByIssue = new Map(goals.filter((goal) => goal.issue && issueCounts.get(goal.issue) === 1).map((goal) => [goal.issue, goal]));
  const staleByGoal = new Map(goals.map((goal) => { const at = goal.evidenceAt ? explicitTimestampMs(goal.evidenceAt) : NaN; return [goal, !Number.isFinite(at) || nowMs - at > freshnessMs || at - nowMs > 60_000]; }));
  const dependencyComplete = createDependencyAdjudicator(goalsByIssue, staleByGoal);
  const claimed = goals.filter((goal) => ACTIVE_STATES.has(goal.state));
  const authoritative = []; const rejectedActiveClaims = new Set(); const contradictions = [];
  if (publicInputInvalid) contradictions.push({ code:'INVALID_PUBLIC_INPUT' });
  if (nowInvalid || freshnessInvalid) contradictions.push({ code:'INVALID_SCHEDULER_CLOCK', invalidNow:nowInvalid, invalidFreshnessMs:freshnessInvalid });
  if (goalsContainerInvalid) contradictions.push({ code:'INVALID_GOALS_CONTAINER' });
  if (portfolioBoundExceeded) contradictions.push({ code:'PORTFOLIO_BOUND_EXCEEDED', suppliedGoalCount:rawGoals.length, maximumGoalCount:MAX_PORTFOLIO_GOALS });
  if (totalPrerequisiteBoundExceeded) contradictions.push({ code:'TOTAL_PREREQUISITE_BOUND_EXCEEDED', suppliedPrerequisiteCount:totalPrerequisites, maximumPrerequisiteCount:MAX_TOTAL_PREREQUISITES });
  if (proofHeadsContainerInvalid || invalidProofHeads.length || proofHeadsBoundExceeded) contradictions.push({ code:'INVALID_PROOF_HEAD_EVIDENCE', invalidProofHeads, boundExceeded:proofHeadsBoundExceeded, suppliedCount:Array.isArray(source.proofHeadShas) ? source.proofHeadShas.length : 0, maximumCount:MAX_EVIDENCE_ITEMS });
  if (proofReceiptsContainerInvalid || invalidProofReceipts.length || proofReceiptsBoundExceeded) contradictions.push({ code:'INVALID_PROOF_RECEIPT_EVIDENCE', invalidProofReceipts, boundExceeded:proofReceiptsBoundExceeded, suppliedCount:Array.isArray(source.proofReceipts) ? source.proofReceipts.length : 0, maximumCount:MAX_EVIDENCE_ITEMS });
  if (proofRefsContainerInvalid || invalidProofRefs.length || proofRefsBoundExceeded) contradictions.push({ code:'INVALID_PROOF_REFERENCE_EVIDENCE', invalidProofRefs, boundExceeded:proofRefsBoundExceeded, suppliedCount:proofRefEvidence.suppliedCount, maximumCount:MAX_EVIDENCE_ITEMS });
  for (const issue of duplicateIssueIds) contradictions.push({ code:'DUPLICATE_GOAL_IDENTITY', issue });
  for (const [index, goal] of goals.entries()) if (!goal.issue) contradictions.push({ code:'INVALID_GOAL_IDENTITY', index });
  for (const goal of goals) if (goal.prerequisiteBoundExceeded) contradictions.push({ code:'PREREQUISITE_BOUND_EXCEEDED', issue:goal.issue, suppliedPrerequisiteCount:goal.suppliedPrerequisiteCount, maximumPrerequisiteCount:MAX_PREREQUISITES_PER_GOAL });
  for (const goal of goals) if (goal.invalidOperatorPriority) contradictions.push({ code:'INVALID_OPERATOR_PRIORITY_EVIDENCE', issue:goal.issue });
  for (const goal of goals) if (goal.invalidOperatorApprovalReceipt) contradictions.push({ code:'INVALID_OPERATOR_APPROVAL_RECEIPT', issue:goal.issue });
  for (const goal of goals) if (goal.branchBoundExceeded) contradictions.push({ code:'LANE_IDENTITY_BOUND_EXCEEDED', issue:goal.issue, maximumLength:MAX_LANE_IDENTITY_LENGTH });
  for (const goal of goals) if (goal.boundExceededFlywheelEvidence.length) contradictions.push({ code:'GOAL_PROOF_REFERENCE_EVIDENCE_BOUND_EXCEEDED', issue:goal.issue, evidence:goal.boundExceededFlywheelEvidence, maximumCount:MAX_EVIDENCE_ITEMS });
  for (const goal of goals) if (goal.invalidFlywheelEvidenceEntries.length) contradictions.push({ code:'INVALID_GOAL_PROOF_REFERENCE_EVIDENCE', issue:goal.issue, invalidEntries:goal.invalidFlywheelEvidenceEntries });
  for (const goal of goals) if (goal.evidenceAt && !Number.isFinite(explicitTimestampMs(goal.evidenceAt))) contradictions.push({ code:'INVALID_EVIDENCE_TIMESTAMP', issue:goal.issue });
  for (const goal of claimed) {
    if (!goal.issue) rejectedActiveClaims.add(goal);
    else if (issueCounts.get(goal.issue) > 1) rejectedActiveClaims.add(goal);
    else if (goal.invalidApprovalRequired) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_APPROVAL_GATE_INVALID', issue:goal.issue }); }
    else if (goal.invalidOperatorPriority) rejectedActiveClaims.add(goal);
    else if (goal.invalidRepairCycleCount || goal.invalidFlywheelEvidenceContainers.length || goal.boundExceededFlywheelEvidence.length || goal.invalidFlywheelEvidenceEntries.length) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_FLYWHEEL_EVIDENCE_INVALID', issue:goal.issue }); }
    else if (!goal.convergenceEvidenceComplete) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_STRUCTURAL_REVIEW_REQUIRED', issue:goal.issue }); }
    else if (hasMalformedRelations(goal)) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_RELATION_EVIDENCE_INVALID', issue:goal.issue }); }
    else if (goal.duplicateOf || goal.supersededBy) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_GOAL_INVALIDATED', issue:goal.issue }); }
    else if (staleByGoal.get(goal)) { rejectedActiveClaims.add(goal); contradictions.push({ code:'STALE_ACTIVE_EVIDENCE', issue:goal.issue }); }
    else if (!goal.activePr && !goal.branch) { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_LANE_IDENTITY_MISSING', issue:goal.issue }); }
    else if (goal.route === 'BLOCKED_UNSAFE_OR_UNKNOWN' || goal.route === 'WAITING_FOR_EXTERNAL_CONDITION') { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_ROUTE_NOT_EXECUTABLE', issue:goal.issue, route:goal.route }); }
    else if (dependencyStatus(goal, goalsByIssue, dependencyComplete) !== 'SATISFIED') { rejectedActiveClaims.add(goal); contradictions.push({ code:'ACTIVE_DEPENDENCY_UNSATISFIED', issue:goal.issue }); }
    else authoritative.push(goal);
  }
  if (authoritative.length > 1) contradictions.push({ code:'MULTIPLE_ACTIVE_LANES', issues:authoritative.map((goal) => goal.issue) });
  if (!portfolioBoundExceeded && !totalPrerequisiteBoundExceeded) {
    const cycleEvidenceResult = detectCycles(goalsByIssue);
    if (cycleEvidenceResult.detectedBackEdges > 0) contradictions.push({ code:'DEPENDENCY_CYCLE', cycles:cycleEvidenceResult.cycles, detectedBackEdges:cycleEvidenceResult.detectedBackEdges, cycleEvidenceSemantics:'DFS_BACK_EDGES_LOWER_BOUND', cyclesShown:cycleEvidenceResult.cycles.length, maximumCyclesShown:MAX_CYCLE_EVIDENCE, maximumIssuesPerCycle:MAX_CYCLE_PATH_ISSUES });
  }
  const failClosed = contradictions.length > 0;
  const activeGoals = new Set(!failClosed && authoritative.length === 1 ? authoritative : []);
  const classifiedPortfolio = goals.map((goal) => freeze({ ...goal, lifecycle:classify(goal, goalsByIssue, activeGoals, rejectedActiveClaims, staleByGoal.get(goal), provenBindings, dependencyComplete), evidenceFreshness:staleByGoal.get(goal) ? 'STALE' : 'FRESH' }));
  const portfolio = failClosed ? classifiedPortfolio.map((goal) => AUTHORITY_BEARING_LIFECYCLES.has(goal.lifecycle) ? freeze({ ...goal, candidateLifecycle:goal.lifecycle, lifecycle:'BLOCKED' }) : goal) : classifiedPortfolio;
  const ready = portfolio.filter((goal) => goal.lifecycle === 'READY').sort(compareReady);
  const mergeReady = portfolio.filter((goal) => goal.lifecycle === 'MERGE_READY').sort(compareReady);
  const closeReady = portfolio.filter((goal) => goal.lifecycle === 'CLOSE_READY').sort(compareReady);
  const approvalGoals = portfolio.filter((goal) => goal.lifecycle === 'APPROVAL_REQUIRED');
  const activeClaim = !failClosed && authoritative.length === 1 ? authoritative[0] : null;
  const active = activeClaim ? portfolio[goals.indexOf(activeClaim)] : null;
  const action = failClosed || active ? null : mergeReady[0] ?? ready[0] ?? closeReady[0] ?? null;
  const operatorNeeded = approvalGoals.length > 0 || Boolean(active?.approvalRequired || active?.route === 'OPERATOR_APPROVAL' || action?.route === 'OPERATOR_APPROVAL');
  const blockers = freeze([...contradictions, ...lifecycleBlockers(portfolio)]);
  const programmeStatus = failClosed ? 'BLOCKED' : active ? 'IN_PROGRESS' : action?.lifecycle === 'MERGE_READY' ? 'MERGE_READY' : action?.lifecycle === 'CLOSE_READY' ? 'CLOSE_READY' : action ? 'READY_TO_ADVANCE' : operatorNeeded ? 'APPROVAL_REQUIRED' : 'WAITING';
  const actionable = [...mergeReady, ...ready, ...closeReady];
  return freeze({ schemaVersion:'stephanos.mission-scheduler.v1', readOnly:true, failClosed, contradictions, contradictionsTotal:contradictions.length, blockers, programmeStatus, activeGoal:active?.issue ? `#${active.issue}` : null, activeLane:active?.activePr ? `PR #${active.activePr}` : active?.branch ? compactString(active.branch) : null, whyNow:failClosed ? contradictionRationale(contradictions) : active ? 'Existing fresh, identified active lane remains authoritative.' : action?.lifecycle === 'MERGE_READY' ? 'Exact-head-proven and exact-head-approved implementation is ready for guarded merge.' : action?.lifecycle === 'CLOSE_READY' ? 'Completed goal is ready for guarded closure.' : action ? selectionRationale(action) : operatorNeeded ? 'Operator approval is required before work can advance.' : 'No eligible lane is currently available.', selectedGoal:action?.issue ? `#${action.issue}` : null, selectedRoute:action?.route ?? null, selectedLifecycle:action?.lifecycle ?? null, nextEligible:failClosed ? [] : actionable.filter((goal) => goal !== action).slice(0,3).map((goal) => `#${goal.issue}`), operatorNeeded, operatorAction:operatorNeeded ? 'OPERATOR_APPROVAL_REQUIRED' : 'NO_OPERATOR_ACTION_REQUIRED', portfolio, decisionReceipt:{ correlationId:text(source.correlationId, `scheduler-${nowMs}`), decidedAt:new Date(nowMs).toISOString(), status:failClosed ? 'BLOCKED_FAIL_CLOSED' : active ? 'ACTIVE_LANE' : action?.lifecycle === 'MERGE_READY' ? 'MERGE_READY' : action?.lifecycle === 'CLOSE_READY' ? 'CLOSE_READY' : action ? 'LANE_SELECTED' : operatorNeeded ? 'APPROVAL_REQUIRED' : 'WAITING', failClosed, contradictionCodes:contradictions.map(({code}) => code), selectedIssue:action?.issue ?? null, selectedLifecycle:action?.lifecycle ?? null, activeIssue:active?.issue ?? null, route:failClosed ? 'BLOCKED_UNSAFE_OR_UNKNOWN' : action?.route ?? active?.route ?? (operatorNeeded ? 'OPERATOR_APPROVAL' : 'WAITING_FOR_EXTERNAL_CONDITION'), proofRefs, proofHeadShas:[...provenHeads], proofReceipts } });
}

export function answerMissionQuery(input = {}, query = '') {
  const scheduler = buildMissionScheduler(input); const normalized = text(query).toLowerCase();
  const evidenceFreshness = scheduler.portfolio.length === 0 ? 'NO_EVIDENCE' : scheduler.portfolio.some((goal) => goal.evidenceFreshness === 'STALE') ? 'MIXED_OR_STALE' : 'FRESH';
  const blockersTotal = scheduler.blockers.length;
  const proofRefsTotal = scheduler.decisionReceipt.proofRefs.length;
  const base = { programmeStatus:scheduler.programmeStatus, activeGoal:scheduler.activeGoal, activeLane:scheduler.activeLane, whyNow:compactString(scheduler.whyNow), selectedGoal:scheduler.selectedGoal, selectedRoute:scheduler.selectedRoute, selectedLifecycle:scheduler.selectedLifecycle, contradictionsTotal:scheduler.contradictionsTotal, blockers:scheduler.blockers.slice(0, CHAT_EVIDENCE_LIMIT).map(compactBlocker), blockersTotal, nextEligible:scheduler.nextEligible, operatorNeeded:scheduler.operatorNeeded, operatorAction:scheduler.operatorAction, evidenceFreshness, proofRefs:scheduler.decisionReceipt.proofRefs.slice(0, CHAT_EVIDENCE_LIMIT).map(compactString), proofRefsTotal };
  if (normalized.includes('blocked')) return freeze({ ...base, focus:'BLOCKERS' });
  if (normalized.includes('next')) return freeze({ ...base, focus:'NEXT_ELIGIBLE' });
  if (normalized.includes('need anything') || normalized.includes('operator')) return freeze({ ...base, focus:'OPERATOR_ACTION' });
  return freeze({ ...base, focus:'PROGRAMME_STATUS' });
}
