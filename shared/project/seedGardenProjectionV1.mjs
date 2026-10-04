import { createSeedProjectProgressModel, getProjectStatusScore } from './projectProgressModel.mjs';

export const SEED_GARDEN_PROJECTION_SCHEMA_V1 = 'stephanos.seed-garden-projection.v1';

function text(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

export function buildSeedGardenProjectionV1({ progressModel, observedAtUtc = new Date().toISOString(), source = 'shared-project-progress' } = {}) {
  const model = progressModel && Array.isArray(progressModel.lanes)
    ? progressModel
    : createSeedProjectProgressModel();

  const seeds = model.lanes.map((lane) => Object.freeze({
    seedId: text(lane.id),
    title: text(lane.title, text(lane.id, 'Unknown seed')),
    status: text(lane.status, 'unknown'),
    progressPercent: getProjectStatusScore(lane.status),
    confidence: Number.isFinite(Number(lane.confidence)) ? Number(lane.confidence) : null,
    weight: Number.isFinite(Number(lane.weight)) ? Number(lane.weight) : null,
    why: text(lane.why),
    blockers: Object.freeze(list(lane.blockers)),
    evidence: Object.freeze(list(lane.evidence)),
    dependsOn: Object.freeze(list(lane.dependsOn)),
    lastMilestone: text(lane.lastMilestone),
    nextAction: list(lane.blockers)[0] || '',
  }));

  return Object.freeze({
    schemaVersion: SEED_GARDEN_PROJECTION_SCHEMA_V1,
    observedAtUtc: text(observedAtUtc),
    source: text(source, 'shared-project-progress'),
    freshness: 'CURRENT',
    seedCount: seeds.length,
    seeds: Object.freeze(seeds),
  });
}

export function summarizeSeedGardenForSharedWorkspaceV1(input = {}) {
  const garden = buildSeedGardenProjectionV1(input);
  return Object.freeze({
    schemaVersion: garden.schemaVersion,
    observedAtUtc: garden.observedAtUtc,
    source: garden.source,
    freshness: garden.freshness,
    seedCount: garden.seedCount,
    seeds: garden.seeds,
  });
}
