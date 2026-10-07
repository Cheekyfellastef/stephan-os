import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';

export const SEED_GROWTH_WORK_SCHEMA_V1 = 'stephanos.seed-growth-work.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const currentTime = (record, nowMs) => Number.isFinite(Date.parse(record?.timestampUtc))
  && Date.parse(record.timestampUtc) <= nowMs && nowMs - Date.parse(record.timestampUtc) <= 60 * 60 * 1000;

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
      && (record.missionId === seed.seedId || record.relatedIssue === seed.issue)
      && record.closedLoopLearning?.telemetry?.retryReady !== true) : null;
    if (gap && !gapEvidence) return [];
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
