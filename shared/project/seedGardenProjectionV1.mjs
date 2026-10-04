import { createSeedProjectProgressModel, getProjectStatusScore } from './projectProgressModel.mjs';

export const SEED_GARDEN_PROJECTION_SCHEMA_V1 = 'stephanos.seed-garden-projection.v1';

export const HIGH_LEVEL_FLYWHEEL_SEEDS_V1 = Object.freeze([
  Object.freeze({
    seedId: 'starfield-vr-outcome-ownership',
    title: 'Starfield VR Excellence',
    seedKind: 'outcome-ownership',
    issue: '#2655',
    northStar: 'Take Starfield and make it the best VR experience it can be.',
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
]);

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function highLevelSeed(seed) {
  return Object.freeze({
    seedId: seed.seedId,
    title: seed.title,
    seedKind: seed.seedKind,
    issue: seed.issue,
    northStar: seed.northStar,
    source: seed.source,
  });
}

export function buildSeedGardenProjectionV1({ progressModel, observedAtUtc, source = 'shared-project-progress' } = {}) {
  const hasAdjudicatedModel = Boolean(progressModel && Array.isArray(progressModel.lanes));
  const model = hasAdjudicatedModel ? progressModel : createSeedProjectProgressModel();
  const modelObservedAtUtc = text(progressModel?.generatedAtUtc || progressModel?.observedAtUtc);
  const projectionObservedAtUtc = text(observedAtUtc, modelObservedAtUtc || new Date().toISOString());
  const projectionFreshness = hasAdjudicatedModel
    ? text(progressModel?.freshness, 'CURRENT')
    : 'STATIC';

  const capabilitySeeds = model.lanes.map((lane) => Object.freeze({
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
    nextAction: text(lane.nextAction),
  }));
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
    seedCount: highLevelSeeds.length + capabilitySeeds.length,
    seeds: Object.freeze([...highLevelSeeds, ...capabilitySeeds]),
  });
}

export function summarizeSeedGardenForSharedWorkspaceV1(input = {}) {
  const garden = buildSeedGardenProjectionV1(input);
  return Object.freeze({
    schemaVersion: garden.schemaVersion,
    observedAtUtc: garden.observedAtUtc,
    source: garden.source,
    freshness: garden.freshness,
    highLevelSeedCount: garden.highLevelSeedCount,
    highLevelSeeds: garden.highLevelSeeds,
    capabilitySeedCount: garden.capabilitySeedCount,
    capabilitySeeds: garden.capabilitySeeds,
    seedCount: garden.seedCount,
    seeds: garden.seeds,
  });
}
