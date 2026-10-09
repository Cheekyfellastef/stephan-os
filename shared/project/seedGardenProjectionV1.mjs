import { createSeedProjectProgressModel, getProjectStatusScore } from './projectProgressModel.mjs';
import { buildStarfieldVrOutcomeOwnershipContractV1 } from '../runtime/starfieldVrOutcomeOwnershipContractV1.mjs';
import { buildAutonomousProjectStewardshipSeedV1 } from '../runtime/autonomousProjectStewardshipSeedV1.mjs';
import { buildConversationalIntelligenceSeedV1 } from '../runtime/conversationalIntelligenceSeedV1.mjs';
import { buildSovereignCommanderParitySeedV1 } from '../runtime/sovereignCommanderParitySeedV1.mjs';
import { buildWorkspaceIntegritySeedV1 } from '../runtime/workspaceIntegritySeedV1.mjs';
import { buildGoalConveyorFleetCareSeedV1 } from '../runtime/goalConveyorFleetCareSeedV1.mjs';

export const SEED_GARDEN_PROJECTION_SCHEMA_V1 = 'stephanos.seed-garden-projection.v1';

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildHighLevelFlywheelSeedsV1() {
  const starfield = buildStarfieldVrOutcomeOwnershipContractV1();
  const projectStewardship = buildAutonomousProjectStewardshipSeedV1();
  const conversationalIntelligence = buildConversationalIntelligenceSeedV1();
  const sovereignCommanderParity = buildSovereignCommanderParitySeedV1();
  const workspaceIntegrity = buildWorkspaceIntegritySeedV1();
  const fleetCare = buildGoalConveyorFleetCareSeedV1();
  return Object.freeze([
    Object.freeze({
      seedId: starfield.missionId,
      title: starfield.title,
      seedKind: 'outcome-ownership',
      issue: '#2655',
      northStar: starfield.northStar,
      source: 'shared/runtime/starfieldVrOutcomeOwnershipContractV1.mjs',
    }),
    Object.freeze({
      seedId: 'stephanos-whole-system-capability-closure',
      title: 'Stephanos Whole-System Capability Closure',
      seedKind: 'whole-system-capability-closure',
      issue: '#2670',
      northStar: 'Continuously discover, diagnose, own and close material gaps across Stephanos while preserving canonical ownership, evidence-backed truth and operator approval boundaries.',
      source: 'shared/runtime/upliftWorkspaceProjectionV1.mjs',
    }),
    Object.freeze({
      seedId: projectStewardship.missionId,
      title: projectStewardship.title,
      seedKind: projectStewardship.seedKind,
      issue: projectStewardship.issueRef,
      northStar: projectStewardship.northStar,
      operatingLoop: projectStewardship.operatingLoop,
      growthRungs: projectStewardship.growthRungs,
      source: 'shared/runtime/autonomousProjectStewardshipSeedV1.mjs',
    }),
    Object.freeze({
      seedId: conversationalIntelligence.missionId,
      title: conversationalIntelligence.title,
      seedKind: conversationalIntelligence.seedKind,
      issue: conversationalIntelligence.issueRef,
      northStar: conversationalIntelligence.northStar,
      operatingLoop: conversationalIntelligence.operatingLoop,
      growthRungs: conversationalIntelligence.growthRungs,
      source: 'shared/runtime/conversationalIntelligenceSeedV1.mjs',
    }),
    Object.freeze({
      seedId: sovereignCommanderParity.missionId,
      title: sovereignCommanderParity.title,
      seedKind: sovereignCommanderParity.seedKind,
      issue: sovereignCommanderParity.issueRef,
      northStar: sovereignCommanderParity.northStar,
      operatingLoop: sovereignCommanderParity.operatingLoop,
      growthRungs: sovereignCommanderParity.growthRungs,
      source: 'shared/runtime/sovereignCommanderParitySeedV1.mjs',
    }),
    Object.freeze({
      seedId: workspaceIntegrity.missionId,
      title: workspaceIntegrity.title,
      seedKind: workspaceIntegrity.seedKind,
      issue: workspaceIntegrity.issueRef,
      northStar: workspaceIntegrity.northStar,
      operatingLoop: workspaceIntegrity.operatingLoop,
      growthRungs: workspaceIntegrity.growthRungs,
      source: 'shared/runtime/workspaceIntegritySeedV1.mjs',
    }),
    Object.freeze({
      seedId: fleetCare.missionId,
      title: fleetCare.title,
      seedKind: fleetCare.seedKind,
      issue: fleetCare.issueRef,
      northStar: fleetCare.northStar,
      operatingLoop: fleetCare.operatingLoop,
      growthRungs: fleetCare.growthRungs,
      canonicalOwnerGoals: fleetCare.canonicalOwnerGoals,
      source: 'shared/runtime/goalConveyorFleetCareSeedV1.mjs',
    }),
  ]);
}

export const HIGH_LEVEL_FLYWHEEL_SEEDS_V1 = buildHighLevelFlywheelSeedsV1();

function highLevelSeed(seed) {
  return Object.freeze({ ...seed });
}

function actionForLane(lane, nextBestActions) {
  const laneKeys = new Set([normalizeKey(lane.id), normalizeKey(lane.title)].filter(Boolean));
  return nextBestActions.find((action) => {
    const targets = [action?.laneId, action?.seedId, ...(Array.isArray(action?.blocks) ? action.blocks : [])]
      .map(normalizeKey)
      .filter(Boolean);
    return targets.some((target) => laneKeys.has(target));
  }) || null;
}

export function buildSeedGardenProjectionV1({ progressModel, observedAtUtc, source = 'shared-project-progress' } = {}) {
  const hasAdjudicatedModel = Boolean(progressModel && Array.isArray(progressModel.lanes));
  const model = hasAdjudicatedModel ? progressModel : createSeedProjectProgressModel();
  const modelObservedAtUtc = text(progressModel?.generatedAtUtc || progressModel?.observedAtUtc || progressModel?.generatedAt);
  const projectionObservedAtUtc = text(observedAtUtc, modelObservedAtUtc);
  const explicitFreshness = text(progressModel?.freshness).toUpperCase();
  const projectionFreshness = hasAdjudicatedModel
    ? (explicitFreshness || 'UNKNOWN')
    : 'STATIC';
  const nextBestActions = hasAdjudicatedModel && Array.isArray(progressModel?.nextBestActions)
    ? progressModel.nextBestActions
    : [];

  const capabilitySeeds = model.lanes.map((lane) => {
    const canonicalAction = actionForLane(lane, nextBestActions);
    return Object.freeze({
      seedId: text(lane.id),
      title: text(lane.title, text(lane.id, 'Unknown seed')),
      seedKind: 'capability-lane',
      status: text(lane.status, 'unknown'),
      progressPercent: getProjectStatusScore(lane.status),
      confidence: Number.isFinite(Number(lane.confidence)) ? Number(lane.confidence) : null,
      weight: Number.isFinite(Number(lane.weight)) ? Number(lane.weight) : null,
      why: text(lane.why),
      blockers: Object.freeze(list(lane.blockers)),
      evidence: Object.freeze(list(lane.evidence)),
      dependsOn: Object.freeze(list(lane.dependsOn)),
      lastMilestone: text(lane.lastMilestone),
      nextAction: text(canonicalAction?.title),
      nextActionId: text(canonicalAction?.id),
    });
  });
  const highLevelSeeds = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.map(highLevelSeed);

  return Object.freeze({
    schemaVersion: SEED_GARDEN_PROJECTION_SCHEMA_V1,
    observedAtUtc: projectionObservedAtUtc,
    source: text(source, 'shared-project-progress'),
    freshness: projectionFreshness,
    highLevelSeedCount: highLevelSeeds.length,
    highLevelSeeds: Object.freeze(highLevelSeeds),
    capabilitySeedCount: capabilitySeeds.length,
    capabilitySeeds: Object.freeze(capabilitySeeds),
    nextBestActions: Object.freeze(nextBestActions.map((action) => Object.freeze({ ...action }))),
    seedCount: highLevelSeeds.length + capabilitySeeds.length,
    seeds: Object.freeze([...highLevelSeeds, ...capabilitySeeds]),
  });
}

export function summarizeSeedGardenForSharedWorkspaceV1(input = {}) {
  const garden = buildSeedGardenProjectionV1(input);
  return Object.freeze({ ...garden });
}
