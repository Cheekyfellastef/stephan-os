import { buildMissionScheduler } from './missionScheduler.mjs';

export const STEPHANOS_MISSION_ENGINE_SCHEMA_V1 = 'stephanos.mission-engine.v1';
export const STEPHANOS_MISSION_OUTCOME_CONTRACT_SCHEMA_V1 = 'stephanos.mission-outcome-contract.v1';
export const STEPHANOS_MISSION_GAP_SCHEMA_V1 = 'stephanos.mission-gap.v1';
export const STEPHANOS_MISSION_CANDIDATE_GOAL_SCHEMA_V1 = 'stephanos.mission-candidate-goal.v1';

const CRITERION_STATUSES = new Set(['SATISFIED', 'UNSATISFIED', 'UNKNOWN']);
const SEVERITY_WEIGHT = Object.freeze({ CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, ADVISORY: 1 });
const GOAL_KINDS = Object.freeze({
  UNKNOWN: 'INFORMATION',
  UNSATISFIED: 'OUTCOME_REPAIR',
});
const DEFAULT_OBSERVATION_FRESHNESS_MS = 15 * 60 * 1000;
const DEDUP_SUPPRESSING_STATES = new Set([
  'QUEUED',
  'READY',
  'ACTIVE',
  'IMPLEMENTING',
  'CI_REVIEW',
  'PROOF_RUNNING',
  'IMPLEMENTED',
  'APPROVAL_REQUIRED',
  'WAITING_FOR_EXTERNAL_CONDITION',
  'BLOCKED',
]);
const SAFE_ROUTE_HINTS = new Set([
  'CHATGPT_GITHUB',
  'OPENCLAW_LOCAL',
  'BATTLE_BRIDGE_FIXED_TEST',
  'REMOTE_CODEX',
  'OPERATOR_APPROVAL',
  'WAITING_FOR_EXTERNAL_CONDITION',
  'BLOCKED_UNSAFE_OR_UNKNOWN',
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function boundedText(value, fallback = '', max = 512) {
  return text(value, fallback).slice(0, max);
}

function list(value, limit = 100) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function stringList(value, limit = 100) {
  return list(value, limit)
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => entry.trim());
}

function unique(values) {
  return [...new Set(values)];
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function slug(value, fallback = 'item') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function stableHash(value) {
  const source = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function criterionId(candidate, index) {
  const explicit = text(candidate?.criterionId || candidate?.id);
  if (explicit) return slug(explicit, `criterion-${index + 1}`);
  return `criterion-${index + 1}-${stableHash(candidate?.title || candidate?.description || index)}`;
}

function normalizeCriterion(candidate = {}, index = 0) {
  const id = criterionId(candidate, index);
  const title = boundedText(candidate.title, id, 160);
  const severity = text(candidate.severity, 'MEDIUM').toUpperCase();
  const rawRouteHint = text(candidate.routeHint).toUpperCase();
  const routeHint = !rawRouteHint
    ? 'CHATGPT_GITHUB'
    : SAFE_ROUTE_HINTS.has(rawRouteHint)
      ? rawRouteHint
      : 'BLOCKED_UNSAFE_OR_UNKNOWN';
  return freeze({
    criterionId: id,
    title,
    description: boundedText(candidate.description, title, 512),
    severity: Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity) ? severity : 'MEDIUM',
    weight: clamp(candidate.weight, 1, 100) || 1,
    proofRequired: candidate.proofRequired !== false,
    dependencies: unique(stringList(candidate.dependencies).map((entry) => slug(entry))),
    routeHint,
    routeHintInvalid: Boolean(rawRouteHint && !SAFE_ROUTE_HINTS.has(rawRouteHint)),
    resourceIds: unique(stringList(candidate.resourceIds).map((entry) => entry.toLowerCase())),
    tags: unique(stringList(candidate.tags).map((entry) => entry.toLowerCase())),
  });
}

export function buildMissionOutcomeContractV1(input = {}) {
  const missionId = slug(input.missionId || input.title || input.desiredOutcome, 'mission');
  const desiredOutcome = boundedText(input.desiredOutcome || input.northStar || input.title, 'Mission outcome not yet defined.', 1000);
  const rawCriteria = list(input.outcomeContract || input.criteria, 200);
  const criteria = rawCriteria.map(normalizeCriterion);
  const duplicateIds = criteria
    .map((criterion) => criterion.criterionId)
    .filter((id, index, values) => values.indexOf(id) !== index);
  const valid = Boolean(missionId && desiredOutcome && criteria.length > 0 && duplicateIds.length === 0);
  return freeze({
    schemaVersion: STEPHANOS_MISSION_OUTCOME_CONTRACT_SCHEMA_V1,
    missionId,
    title: boundedText(input.title, desiredOutcome, 200),
    desiredOutcome,
    contractVersion: boundedText(input.contractVersion, 'v1', 40),
    criteria,
    valid,
    blockers: duplicateIds.length
      ? [{ code: 'MISSION_OUTCOME_CRITERION_ID_DUPLICATE', criterionIds: unique(duplicateIds) }]
      : criteria.length === 0
        ? [{ code: 'MISSION_OUTCOME_CRITERIA_REQUIRED' }]
        : [],
    authority: {
      sourceMutationGranted: false,
      runtimeMutationGranted: false,
      dispatchAuthorityGranted: false,
      mergeAuthorityGranted: false,
      approvalBypassGranted: false,
    },
  });
}

function explicitTimestampMs(value) {
  if (typeof value !== 'string') return NaN;
  const normalized = value.trim();
  if (!normalized || !/(?:Z|[+-]\\d{2}:\\d{2})$/i.test(normalized)) return NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeObservation(candidate = {}, criterion, options = {}) {
  const rawStatus = text(candidate.status, 'UNKNOWN').toUpperCase();
  const requestedStatus = CRITERION_STATUSES.has(rawStatus) ? rawStatus : 'UNKNOWN';
  const evidenceRefs = unique(stringList(candidate.evidenceRefs || candidate.proofRefs, 200));
  const confidence = clamp(candidate.confidence, 0, 1);
  const observedAt = boundedText(candidate.observedAt, '', 80) || null;
  const observedAtMs = explicitTimestampMs(observedAt);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const freshnessMs = Number.isFinite(options.freshnessMs) && options.freshnessMs > 0
    ? options.freshnessMs
    : DEFAULT_OBSERVATION_FRESHNESS_MS;
  const explicitFreshness = text(candidate.freshness).toUpperCase();
  const freshnessAllowed = new Set(['CURRENT', 'STALE', 'CONFLICTING', 'UNKNOWN']);
  let freshness = freshnessAllowed.has(explicitFreshness) ? explicitFreshness : 'UNKNOWN';
  if (!explicitFreshness && Number.isFinite(observedAtMs)) {
    freshness = nowMs >= observedAtMs && nowMs - observedAtMs <= freshnessMs ? 'CURRENT' : 'STALE';
  }
  if (Number.isFinite(observedAtMs)) {
    if (observedAtMs > nowMs + 5 * 60 * 1000) freshness = 'UNKNOWN';
    else if (nowMs - observedAtMs > freshnessMs) freshness = 'STALE';
  }
  const evidenceBacked = evidenceRefs.length > 0;
  const trustworthyClaim = requestedStatus === 'UNKNOWN'
    || (evidenceBacked && freshness === 'CURRENT');
  const status = trustworthyClaim ? requestedStatus : 'UNKNOWN';
  const proofSatisfied = status === 'SATISFIED'
    && evidenceBacked
    && freshness === 'CURRENT';
  return freeze({
    criterionId: criterion.criterionId,
    status,
    requestedStatus,
    summary: boundedText(candidate.summary, status === 'UNKNOWN' ? 'Current state is not yet evidenced.' : criterion.title, 512),
    evidenceRefs,
    confidence,
    freshness,
    evidenceBacked,
    proofSatisfied,
    observedAt,
  });
}

function observationMap(currentState, criteria, options = {}) {
  const raw = list(currentState, 1000);
  const byCriterion = new Map();
  for (const entry of raw) {
    const id = slug(entry?.criterionId || entry?.id || '', '');
    if (id && !byCriterion.has(id)) byCriterion.set(id, entry);
  }
  return new Map(criteria.map((criterion) => [
    criterion.criterionId,
    normalizeObservation(byCriterion.get(criterion.criterionId) || {}, criterion, options),
  ]));
}

function gapFor(criterion, observation) {
  if (observation.proofSatisfied) return null;
  const gapState = observation.status === 'UNSATISFIED' ? 'UNSATISFIED' : 'UNKNOWN';
  const gapId = `${criterion.criterionId}:${gapState.toLowerCase()}`;
  return freeze({
    schemaVersion: STEPHANOS_MISSION_GAP_SCHEMA_V1,
    gapId,
    criterionId: criterion.criterionId,
    title: criterion.title,
    state: gapState,
    severity: criterion.severity,
    weight: criterion.weight,
    summary: observation.summary,
    evidenceRefs: observation.evidenceRefs,
    confidence: observation.confidence,
    freshness: observation.freshness,
    dependencies: criterion.dependencies,
    routeHint: criterion.routeHint,
    resourceIds: criterion.resourceIds,
    proofRequired: criterion.proofRequired,
  });
}

function existingGoalIdentity(goal = {}) {
  return {
    candidateGoalId: text(goal.candidateGoalId || goal?.provenance?.candidateGoalId),
    missionId: slug(goal.missionId || goal?.provenance?.missionId || '', ''),
    gapId: text(goal.gapId || goal?.provenance?.gapId),
    title: text(goal.title).toLowerCase(),
    issue: Number.isSafeInteger(Number(goal.issue || goal.issueNumber)) ? Number(goal.issue || goal.issueNumber) : null,
    state: text(goal.state, 'UNKNOWN').toUpperCase(),
  };
}

function findDuplicate(candidate, existingGoals) {
  for (const raw of list(existingGoals, 5000)) {
    const goal = existingGoalIdentity(raw);
    if (!DEDUP_SUPPRESSING_STATES.has(goal.state)) continue;
    const sameMission = Boolean(goal.missionId) && goal.missionId === candidate.missionId;
    if (!sameMission) continue;
    if (
      (goal.candidateGoalId && goal.candidateGoalId === candidate.candidateGoalId)
      || (goal.gapId && goal.gapId === candidate.gapId)
      || (goal.title && goal.title === candidate.title.toLowerCase())
    ) return goal;
  }
  return null;
}

function dependencyVerdict(gap, observations) {
  if (!gap.dependencies.length) return { ready: true, missing: [] };
  const missing = gap.dependencies.filter((criterionId) => observations.get(criterionId)?.proofSatisfied !== true);
  return { ready: missing.length === 0, missing };
}

function candidateFromGap(mission, criterion, gap, observations, existingGoals) {
  const goalKind = GOAL_KINDS[gap.state] || 'INFORMATION';
  const candidateGoalId = `${mission.missionId}:${slug(gap.gapId)}:${goalKind.toLowerCase()}:v1`;
  const informationGoal = goalKind === 'INFORMATION';
  const title = informationGoal
    ? `Determine current truth: ${criterion.title}`
    : `Close mission gap: ${criterion.title}`;
  const dependency = dependencyVerdict(gap, observations);
  const severityScore = SEVERITY_WEIGHT[gap.severity] || SEVERITY_WEIGHT.MEDIUM;
  const informationValue = informationGoal ? Math.max(3, severityScore) : Math.max(1, severityScore - 1);
  const expectedMissionProgress = informationGoal ? 1 : Math.max(2, severityScore);
  const score = (
    criterion.weight * 100
    + severityScore * 25
    + informationValue * 20
    + expectedMissionProgress * 30
    - dependency.missing.length * 1000
  );
  const base = {
    schemaVersion: STEPHANOS_MISSION_CANDIDATE_GOAL_SCHEMA_V1,
    candidateGoalId,
    missionId: mission.missionId,
    gapId: gap.gapId,
    criterionId: criterion.criterionId,
    goalKind,
    title,
    reasonCreated: informationGoal
      ? `Outcome criterion "${criterion.title}" lacks enough current evidence to choose a repair safely.`
      : `Outcome criterion "${criterion.title}" is evidenced as unsatisfied.`,
    expectedOutcomeEffect: informationGoal
      ? 'Reduce mission uncertainty and produce evidence that can determine the next engineering goal.'
      : 'Move the named outcome criterion toward proven satisfaction.',
    dependencies: criterion.dependencies,
    missingDependencies: dependency.missing,
    informationValue,
    expectedMissionProgress,
    route: criterion.routeHint,
    resourceIds: criterion.resourceIds,
    proofRequired: informationGoal
      ? ['Fresh evidence that classifies the criterion as SATISFIED or UNSATISFIED.']
      : ['Fresh evidence that classifies the criterion as SATISFIED.', ...(criterion.proofRequired ? ['At least one durable proof reference.'] : [])],
    failureStrategy: informationGoal
      ? 'Retain the failed investigation as evidence, refine the hypothesis, and generate another bounded information goal.'
      : 'Retain failure evidence, re-open the gap, and generate the next bounded repair or information goal.',
    createdFromEvidenceRefs: gap.evidenceRefs,
    score,
    status: dependency.ready ? 'CANDIDATE' : 'HELD_DEPENDENCY',
    authorityWidened: false,
    dispatchRequested: false,
  };
  const duplicate = findDuplicate(base, existingGoals);
  return freeze({
    ...base,
    duplicateOf: duplicate
      ? {
          issue: duplicate.issue,
          candidateGoalId: duplicate.candidateGoalId || null,
          state: duplicate.state,
        }
      : null,
    status: duplicate ? 'DEDUPED_EXISTING_WORK' : base.status,
  });
}

function completion(contract, observations) {
  const results = contract.criteria.map((criterion) => observations.get(criterion.criterionId));
  const satisfied = results.filter((entry) => entry?.proofSatisfied === true).length;
  const unknown = results.filter((entry) => entry?.status === 'UNKNOWN' || !entry).length;
  const unsatisfied = results.filter((entry) => entry?.status === 'UNSATISFIED').length;
  const totalWeight = contract.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const achievedWeight = contract.criteria.reduce((sum, criterion) => {
    const observation = observations.get(criterion.criterionId);
    if (!observation?.proofSatisfied) return sum;
    return sum + criterion.weight * Math.max(0.25, observation.confidence || 1);
  }, 0);
  const confidence = totalWeight > 0 ? clamp(achievedWeight / totalWeight, 0, 1) : 0;
  const provenComplete = contract.valid && satisfied === contract.criteria.length;
  return freeze({
    verdict: provenComplete ? 'MISSION_OUTCOME_PROVEN' : 'MISSION_OUTCOME_NOT_YET_PROVEN',
    provenComplete,
    confidence,
    criteriaTotal: contract.criteria.length,
    satisfied,
    unsatisfied,
    unknown,
  });
}

function buildReplanEvent(input, mission, gaps, candidates, nextGoal, acceptance) {
  const trigger = text(input.trigger, 'MISSION_RECONCILIATION');
  const previous = input.previousProjection && typeof input.previousProjection === 'object'
    ? input.previousProjection
    : null;
  const previousNextGoalId = text(previous?.nextGoal?.candidateGoalId);
  const nextGoalId = text(nextGoal?.candidateGoalId);
  return freeze({
    eventKind: 'MISSION_REPLAN',
    trigger,
    missionId: mission.missionId,
    previousNextGoalId: previousNextGoalId || null,
    nextGoalId: nextGoalId || null,
    nextGoalChanged: Boolean(previous && previousNextGoalId !== nextGoalId),
    gapCount: gaps.length,
    candidateCount: candidates.length,
    outcomeVerdict: acceptance.verdict,
    reason: acceptance.provenComplete
      ? 'Every outcome criterion is satisfied with the required fresh proof.'
      : nextGoal
        ? nextGoal.reasonCreated
        : 'No new candidate goal is dispatchable from current evidence; existing work or dependencies must advance first.',
  });
}

function schedulerProjection(input) {
  const schedulerInput = input.schedulerInput && typeof input.schedulerInput === 'object'
    ? input.schedulerInput
    : {};
  const existingGoals = list(input.existingGoals, 5000).filter((goal) => Number.isSafeInteger(Number(goal?.issue || goal?.issueNumber)));
  return buildMissionScheduler({
    ...schedulerInput,
    goals: existingGoals,
  });
}

export function buildMissionEngineV1(input = {}) {
  const outcome = buildMissionOutcomeContractV1(input.mission || input);
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const freshnessMs = Number.isFinite(input.freshnessMs) && input.freshnessMs > 0
    ? input.freshnessMs
    : DEFAULT_OBSERVATION_FRESHNESS_MS;
  const observations = observationMap(input.currentState, outcome.criteria, { nowMs, freshnessMs });
  const gaps = outcome.valid
    ? outcome.criteria
      .map((criterion) => gapFor(criterion, observations.get(criterion.criterionId)))
      .filter(Boolean)
    : [];
  const candidateGoals = gaps
    .map((gap) => candidateFromGap(
      outcome,
      outcome.criteria.find((criterion) => criterion.criterionId === gap.criterionId),
      gap,
      observations,
      input.existingGoals,
    ))
    .sort((left, right) => right.score - left.score || left.candidateGoalId.localeCompare(right.candidateGoalId));
  const eligible = candidateGoals.filter((goal) => goal.status === 'CANDIDATE');
  const nextGoal = eligible[0] || null;
  const acceptance = completion(outcome, observations);
  const scheduler = schedulerProjection(input);
  const currentState = outcome.criteria.map((criterion) => observations.get(criterion.criterionId));
  const replanEvent = buildReplanEvent(input, outcome, gaps, candidateGoals, nextGoal, acceptance);

  return freeze({
    schemaVersion: STEPHANOS_MISSION_ENGINE_SCHEMA_V1,
    missionId: outcome.missionId,
    title: outcome.title,
    desiredOutcome: outcome.desiredOutcome,
    status: acceptance.provenComplete ? 'COMPLETE' : outcome.valid ? 'ACTIVE' : 'BLOCKED',
    outcomeContract: outcome,
    outcomeConfidence: acceptance.confidence,
    currentState,
    gaps,
    candidateGoals,
    activeGoals: scheduler.activeGoals,
    completedGoals: list(input.existingGoals, 5000)
      .filter((goal) => ['COMPLETE', 'CLOSED'].includes(text(goal?.state).toUpperCase()))
      .map((goal) => `#${goal.issue || goal.issueNumber}`),
    blockedGoals: scheduler.blockers,
    evidence: unique(currentState.flatMap((entry) => entry.evidenceRefs)),
    lessons: unique(stringList(input.lessons, 500)),
    nextGoal,
    nextGoalReason: nextGoal
      ? nextGoal.reasonCreated
      : acceptance.provenComplete
        ? 'Mission outcome is proven.'
        : 'No undeduplicated dependency-ready candidate is available from current evidence.',
    scheduler,
    replanEvent,
    acceptance,
    sharedWorkspaceProjection: {
      schemaVersion: 'stephanos.mission-engine-workspace-projection.v1',
      missionId: outcome.missionId,
      desiredOutcome: outcome.desiredOutcome,
      status: acceptance.provenComplete ? 'COMPLETE' : outcome.valid ? 'ACTIVE' : 'BLOCKED',
      outcomeConfidence: acceptance.confidence,
      acceptanceVerdict: acceptance.verdict,
      activeGoals: scheduler.activeGoals,
      candidateGoals: candidateGoals.map((goal) => ({
        candidateGoalId: goal.candidateGoalId,
        title: goal.title,
        goalKind: goal.goalKind,
        status: goal.status,
        gapId: goal.gapId,
        score: goal.score,
      })),
      blockedGaps: gaps.filter((gap) => dependencyVerdict(gap, observations).ready === false).map((gap) => gap.gapId),
      informationGoals: candidateGoals.filter((goal) => goal.goalKind === 'INFORMATION').map((goal) => goal.candidateGoalId),
      evidenceRefs: unique(currentState.flatMap((entry) => entry.evidenceRefs)),
      nextGoal: nextGoal
        ? { candidateGoalId: nextGoal.candidateGoalId, title: nextGoal.title, why: nextGoal.reasonCreated }
        : null,
      replanEvent,
    },
    authority: {
      readOnlyPlanning: true,
      dispatchAuthority: false,
      sourceMutationAuthority: false,
      runtimeMutationAuthority: false,
      mergeAuthority: false,
      approvalBypass: false,
      schedulerOwner: '#1556',
    },
    finalVerdict: acceptance.provenComplete
      ? 'STEPHANOS_MISSION_ENGINE_OUTCOME_PROVEN'
      : outcome.valid
        ? 'STEPHANOS_MISSION_ENGINE_REPLAN_READY'
        : 'STEPHANOS_MISSION_ENGINE_CONTRACT_BLOCKED',
  });
}
