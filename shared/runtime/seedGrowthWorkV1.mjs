import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import { GOAL_CONVEYOR_FLEET_CARE_ISSUE, GOAL_CONVEYOR_FLEET_CARE_OWNER_GOALS_V1 } from './goalConveyorFleetCareSeedV1.mjs';

export const SEED_GROWTH_WORK_SCHEMA_V1 = 'stephanos.seed-growth-work.v1';
export const SEED_SOURCE_WORK_DESCRIPTOR_SCHEMA_V1 = 'stephanos.seed-source-work-descriptor.v1';
export const SOURCE_SCOPE_RECONCILIATION_REQUIRED = 'SOURCE_SCOPE_RECONCILIATION_REQUIRED';

// Identity is checked before normalization at every executable adapter. A
// spelling variant of the canonical family cannot become unrelated work.
export function classifyElasticMissionIdentityV1(value, branch) {
  // A lexical projection reserves the entire namespace. It can only refuse;
  // normalization never supplies a canonical identity or branch acceptance.
  const familyKey = input => input.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const branchLike = typeof branch === 'string' && familyKey(branch).startsWith('openclawelasticgoal');
  if (typeof value !== 'string') return Object.freeze({ kind: branchLike ? 'NONCANONICAL_ELASTIC' : 'OTHER', issueNumber: null });
  const match = /^critical-([1-9][0-9]*)-elastic-goal$/.exec(value);
  const issueNumber = match ? Number(match[1]) : NaN;
  const canonical = Boolean(match && Number.isSafeInteger(issueNumber));
  if ((branchLike && (!canonical || branch !== `openclaw/elastic-goal-${issueNumber}`))
      || (canonical && branch !== undefined && branch !== `openclaw/elastic-goal-${issueNumber}`))
    return Object.freeze({ kind: 'NONCANONICAL_ELASTIC', issueNumber: null });
  if (canonical) return Object.freeze({ kind: 'CANONICAL_ELASTIC', issueNumber });
  const key = familyKey(value);
  const elasticLike = key.startsWith('critical') && key.slice('critical'.length).includes('elastic');
  return Object.freeze({ kind: elasticLike ? 'NONCANONICAL_ELASTIC' : 'OTHER', issueNumber: null });
}
const SOURCE_DESCRIPTOR_KEYS = Object.freeze(['schemaVersion', 'executionRelationship',
  'seedId', 'ownerIssueRef', 'declarationSource', 'pressureKey', 'targetRung',
  'childIssueNumber', 'missionId', 'branch', 'allowedFiles', 'requiredTests',
  'authorityPlanFingerprint', 'runtimePolicyHead', 'executionParentHead',
  'executionParentTree', 'correctionEvidenceRef', 'acceptanceContractRef']);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const currentTime = (record, nowMs) => Number.isFinite(Date.parse(record?.timestampUtc))
  && Date.parse(record.timestampUtc) <= nowMs && nowMs - Date.parse(record.timestampUtc) <= 60 * 60 * 1000;

// Browser projections receive serialized canonical data. This is only a shape
// check: references and hashes cannot authenticate source authority or proof.
// The Node producer must reject non-data inputs before reading their fields.
export function validateSeedSourceWorkDescriptorShapeV1(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== SOURCE_DESCRIPTOR_KEYS.length
      || keys.some(key => !SOURCE_DESCRIPTOR_KEYS.includes(key))) return false;
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find(item => item.seedId === value.seedId);
  const strings = SOURCE_DESCRIPTOR_KEYS.filter(key => !['childIssueNumber', 'allowedFiles', 'requiredTests'].includes(key));
  if (strings.some(key => typeof value[key] !== 'string' || !value[key]
      || value[key] !== value[key].trim() || value[key].length > 256)) return false;
  if (!seed || value.schemaVersion !== SEED_SOURCE_WORK_DESCRIPTOR_SCHEMA_V1
      || value.executionRelationship !== 'SELF' || value.ownerIssueRef !== seed.issue
      || value.declarationSource !== seed.source
      || !/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(value.pressureKey)
      || !value.pressureKey.startsWith(`seed-${seed.issue.slice(1)}:`)
      || !Number.isSafeInteger(value.childIssueNumber) || value.childIssueNumber < 1
      || value.missionId !== `critical-${value.childIssueNumber}-elastic-goal`
      || value.branch !== `openclaw/elastic-goal-${value.childIssueNumber}`
      || !/^[0-9a-f]{64}$/.test(value.authorityPlanFingerprint)
      || ['runtimePolicyHead', 'executionParentHead', 'executionParentTree']
        .some(key => !/^[0-9a-f]{40}$/.test(value[key]))) return false;
  const paths = value.allowedFiles, tests = value.requiredTests;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 64
      || paths.some(path => typeof path !== 'string' || !path || path.length > 256
        || path !== path.trim() || path.includes('\\') || path.startsWith('/')
        || path.split('/').some(segment => !segment || ['.', '..'].includes(segment)))
      || new Set(paths.map(path => path.toLowerCase())).size !== paths.length
      || !Array.isArray(tests) || tests.length < 1 || tests.length > 16
      || tests.some(command => typeof command !== 'string' || !command
        || command !== command.trim() || command.length > 256)
      || new Set(tests).size !== tests.length) return false;
  return true;
}

export function projectSeedSourceWorkRequirementV1(goal = {}) {
  const work = goal?.seedGrowthWork;
  const known = validateSeedGrowthWorkV1(work || {});
  const descriptor = goal?.seedSourceWorkDescriptor;
  return Object.freeze({
    classification: known ? 'SEED' : 'UNKNOWN',
    declarationSource: known ? work.contractSource : '',
    descriptorShapeValid: known && validateSeedSourceWorkDescriptorShapeV1(descriptor)
      && descriptor.seedId === work.seedId && descriptor.pressureKey === work.pressureKey
      && descriptor.targetRung === work.targetRung
      && descriptor.childIssueNumber === goal.issueNumber,
    // Even a well-shaped descriptor is data. Only a fixed authenticated server
    // producer and phase-bound grant can establish executable source authority.
    sourceMutationAuthority: false,
    blocker: SOURCE_SCOPE_RECONCILIATION_REQUIRED,
  });
}

// Conservative association projection, not a non-seed or authority proof.
// Retained seed hints cannot disappear just because a mirror omits metadata.
export function projectSeedSourceAssociationV1(input = {}) {
  if (input.seedGrowthWork !== undefined) {
    return Object.freeze({ classification: validateSeedGrowthWorkV1(input.seedGrowthWork || {})
      ? 'SEED' : 'UNKNOWN', associated: true, reason: 'SEED_METADATA_PRESENT' });
  }
  const corpus = [input.operatorIntent, input.issueBody, input.retainedHistory]
    .filter(value => typeof value === 'string').join('\n');
  if (/\bseed-[1-9][0-9]*:(?:gap|rung):|Seed owner\s*:?\s*#[1-9][0-9]*|stephanos-flywheel-gap:seed-/i.test(corpus)) {
    return Object.freeze({ classification: 'SEED', associated: true, reason: 'RETAINED_SEED_ASSOCIATION' });
  }
  const declarations = new Set(HIGH_LEVEL_FLYWHEEL_SEEDS_V1.map(seed => seed.source));
  if (Array.isArray(input.allowedFiles) && input.allowedFiles.some(path => typeof path === 'string'
      && declarations.has(path.endsWith('/**') ? path.slice(0, -3) : path))) {
    return Object.freeze({ classification: 'UNKNOWN', associated: true, reason: 'SEED_DECLARATION_SCOPE_REQUIRES_RECONCILIATION' });
  }
  return Object.freeze({ classification: 'UNKNOWN', associated: false, reason: 'CURRENT_OWNER_PLAN_REQUIRED' });
}

export function seedSourceEffectPhaseV1(state = {}) {
  return ['CREATE_WORKTREE', 'AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED', 'GITHUB_COMMIT',
    'GITHUB_PUSH', 'OPEN_PULL_REQUEST', 'MERGE_PULL_REQUEST', 'LOCAL_DEPLOYMENT']
    .includes(state.currentPhase);
}

export function projectMissionSeedSourcePlanShapeV1(state = {}) {
  const identity = classifyElasticMissionIdentityV1(state.missionId, state.git?.branch || state.branch);
  const applicable = identity.kind !== 'OTHER'
    || /^openclaw\/elastic-goal-[1-9][0-9]*$/.test(String(state.git?.branch || ''))
    || state.seedGrowthWork != null || state.seedSourceWorkDescriptor != null;
  const seed = state.seedSourceWorkDescriptor;
  const ordinary = state.currentOrdinarySourcePlan;
  const seedShape = validateSeedSourceWorkDescriptorShapeV1(seed);
  const ordinaryShape = ordinary?.schemaVersion === 'stephanos.current-ordinary-source-plan.v1'
    && ordinary.purpose === 'REAFFIRM_EXISTING_ORDINARY_SOURCE_PLAN'
    && ordinary.missionId === state.missionId && ordinary.branch === state.git?.branch
    && typeof ordinary.authorityPlanFingerprint === 'string'
    && /^[0-9a-f]{64}$/.test(ordinary.authorityPlanFingerprint);
  const valid = identity.kind !== 'NONCANONICAL_ELASTIC'
    && Boolean(Boolean(seedShape) !== Boolean(ordinaryShape) && (seedShape || ordinaryShape));
  return Object.freeze({ applicable, valid,
    sourcePlanKind: valid ? (seedShape ? 'SEED_SELF' : 'CURRENT_ORDINARY_SOURCE_PLAN') : '',
    authorityPlanFingerprint: valid ? (seedShape ? seed.authorityPlanFingerprint : ordinary.authorityPlanFingerprint) : '',
    blocker: applicable && !valid ? SOURCE_SCOPE_RECONCILIATION_REQUIRED : '',
  });
}

export function validateSeedGrowthWorkV1(work = {}) {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((item) => item.seedId === work.seedId);
  return Boolean(seed && work.schemaVersion === SEED_GROWTH_WORK_SCHEMA_V1
    && work.ownerIssueRef === seed.issue && work.contractSource === seed.source
    && /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(text(work.pressureKey))
    && work.pressureKey.startsWith(`seed-${seed.issue.slice(1)}:`)
    && text(work.nextBestAction) && text(work.nextBestAction).length <= 1600
    && (!work.capabilityGapId || /^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(work.capabilityGapId))
    && list(work.evidenceRefs).length > 0);
}

function canonicalWorkGoal(goal, seedId, nowMs) {
  const number = Number(goal?.issueNumber);
  return goal?.schemaVersion === 'shared-agent-workspace-record.v1'
    && Number.isFinite(Date.parse(goal.timestampUtc)) && Date.parse(goal.timestampUtc) <= nowMs
    && goal.kind === 'stephanos.shared_workspace.goal'
    && Number.isSafeInteger(number) && number > 0 && goal.goalId === `goal-${number}`
    && goal.repository === REPOSITORY && goal.seedGrowthWork?.seedId === seedId
    && validateSeedGrowthWorkV1(goal.seedGrowthWork);
}

// Completion is the canonical goal's result/capability/lesson contract. A
// queue entry, dispatch, closed issue or heartbeat alone cannot satisfy it.
export function seedGrowthGoalCompletedV1(goal = {}) {
  const complete = text(goal.status).toUpperCase() === 'COMPLETE'
    && (!goal.state || text(goal.state).toUpperCase() === 'COMPLETE');
  const closedWithReceipt = text(goal.status).toUpperCase() === 'CLOSED'
    && ['CLOSED_COMPLETED', 'ALREADY_CLOSED'].includes(goal.goalClosureState)
    && Boolean(text(goal.goalClosureReceiptId));
  return (complete || closedWithReceipt)
    && list(goal.resultProofRefs).length > 0
    && goal.resultProofRefs.every((ref) => typeof ref === 'string' && text(ref))
    && Boolean(text(goal.reusableCapabilityId) && text(goal.sharedLessonId));
}

export function projectSeedGrowthWorkV1(seedId, goals = [], nowMs = Date.now()) {
  const work = list(goals).filter((goal) => canonicalWorkGoal(goal, seedId, nowMs));
  return Object.freeze({
    completedGoalCount: work.filter(seedGrowthGoalCompletedV1).length,
    goals: Object.freeze(work.map((goal) => Object.freeze({
      issueNumber: goal.issueNumber,
      pressureKey: goal.seedGrowthWork.pressureKey,
      targetRung: goal.seedGrowthWork.targetRung,
      state: text(goal.status),
      sourceTruth: currentTime(goal, nowMs) ? 'CURRENT' : 'STALE',
      completed: seedGrowthGoalCompletedV1(goal),
      resultProofRefs: Object.freeze(seedGrowthGoalCompletedV1(goal) ? [...goal.resultProofRefs] : []),
      reusableCapabilityId: seedGrowthGoalCompletedV1(goal) ? goal.reusableCapabilityId : '',
      sharedLessonId: seedGrowthGoalCompletedV1(goal) ? goal.sharedLessonId : '',
    }))),
  });
}

export function planSeedGrowthWorkV1(view = {}, feed = {}, nowMs = Date.now()) {
  if (!view.valid || view.sourceTruth !== 'CURRENT' || feed.state !== 'ready'
    || list(feed.errors).length) return [];
  return HIGH_LEVEL_FLYWHEEL_SEEDS_V1.flatMap((seed) => {
    const growth = list(view.outcomeSeeds).find((item) => item.missionId === seed.seedId);
    const heartbeat = list(feed.records?.statusRecords).find((record) => record.statusId === seed.seedId);
    if (!growth?.planted || growth.sourceTruth !== 'CURRENT' || !heartbeat) return [];
    if (!currentTime(heartbeat, nowMs)) return [];
    const heartbeatBound = seed.issue === '#2655'
      ? heartbeat.outcomeOwnershipSeed?.missionId === seed.seedId
      : heartbeat.seedHeartbeat?.schemaVersion === 'stephanos.high-level-flywheel-seed-heartbeat.v1'
        && heartbeat.seedHeartbeat.missionId === seed.seedId
        && heartbeat.seedHeartbeat.issueRef === seed.issue
        && heartbeat.seedHeartbeat.contractSource === seed.source;
    if (!heartbeatBound) return [];
    const gap = list(growth.currentGaps)[0];
    const gapEvidence = gap ? list(feed.records?.eventRecords).find((record) =>
      currentTime(record, nowMs)
      && text(record.capabilityId || record.closedLoopLearning?.capabilityId || record.eventKind) === text(gap.capabilityId)
      && (record.missionId === seed.seedId
        || record.relatedIssue === seed.issue
        || (Array.isArray(seed.linkedGoalIssueRefs)
          && seed.linkedGoalIssueRefs.includes(record.relatedIssue))
        || (seed.issue === GOAL_CONVEYOR_FLEET_CARE_ISSUE
          && GOAL_CONVEYOR_FLEET_CARE_OWNER_GOALS_V1.some((owner) => owner.issue === record.relatedIssue)))
      && record.closedLoopLearning?.telemetry?.retryReady !== true) : null;
    if (gap && !gapEvidence) return [];
    // A heartbeat alone must not invent maintenance work: require proven fleet inventory or a scoped fault.
    if (seed.issue === GOAL_CONVEYOR_FLEET_CARE_ISSUE && !gap && !growth.fleetObservationProofCount) return [];
    const nextRung = growth.nextGrowthRung;
    // Healthy continuous observation is not an invitation to invent repair work.
    if (!gap && !nextRung && seed.issue === '#2670') return [];
    if (!gap && list(growth.growthRungs).length && !nextRung) return [];
    const targetRung = text(nextRung || growth.stage);
    const target = gap ? `gap:${text(gap.capabilityId)}` : `rung:${targetRung.toLowerCase()}`;
    const work = {
      schemaVersion: SEED_GROWTH_WORK_SCHEMA_V1,
      seedId: seed.seedId,
      ownerIssueRef: seed.issue,
      contractSource: seed.source,
      pressureKey: `seed-${seed.issue.slice(1)}:${target}`,
      targetRung,
      capabilityGapId: gap ? text(gap.capabilityId) : '',
      nextBestAction: text(growth.nextBestAction),
      evidenceRefs: [`status/${heartbeat.statusId}.json`, seed.source,
        ...(gapEvidence ? [`events/${gapEvidence.eventId}.json`] : [])],
    };
    if (!validateSeedGrowthWorkV1(work)) return [];
    const existing = list(feed.records?.goalRecords).filter((goal) =>
      canonicalWorkGoal(goal, seed.seedId, nowMs) && goal.seedGrowthWork.pressureKey === work.pressureKey);
    return [Object.freeze({ ...work, existingGoal: existing.length === 1 ? existing[0] : null,
      identityConflict: existing.length > 1 })];
  });
}
