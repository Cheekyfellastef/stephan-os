import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSpatialPlanetDesignGenome,
  planSpatialPlanetDesignGenomeBinding,
  SPATIAL_PLANET_DESIGN_DIMENSIONS,
  validateSpatialPlanetDesignGenome,
} from './spatialPlanetDesignGenomeV1.mjs';

const SOURCE_HEAD = 'a'.repeat(40);

function validDimensions() {
  return Object.fromEntries(SPATIAL_PLANET_DESIGN_DIMENSIONS.map((key) => [key, `${key} principle set`]));
}

function validGenomeInput(overrides = {}) {
  return {
    genomeId: 'planet-a-genome',
    planetId: 'planet-a',
    version: 'genome-v1',
    sourceHead: SOURCE_HEAD,
    researchRefs: ['research:vr-world-design'],
    influences: [
      { sourceRef: 'influence:no-mans-sky', principles: ['exploration cadence', 'distant landmark pull'] },
      { sourceRef: 'influence:skyrim', principles: ['environmental density', 'sense of place'] },
    ],
    dimensions: validDimensions(),
    performanceBudget: { frameTimeMs: 11.1, memoryMb: 2048 },
    comfortBudget: { locomotion: 'seated-compatible', horizonStability: true },
    licencePolicy: 'Extract principles only; never copy proprietary assets, source code, level data, characters or trade dress.',
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    ...overrides,
  };
}

function validBuildOrder(overrides = {}) {
  return {
    schemaVersion: 'stephanos.spatial-build-order.v1',
    spatialBuildOrderId: 'build-order-a',
    intentId: 'intent-a',
    missionId: 'mission-a',
    planetId: 'planet-a',
    regionId: 'region-a',
    objectIds: [],
    operatorRequest: 'Create a calm exploratory test area.',
    interpretationSummary: 'Build a bounded test area guided by the current genome.',
    designGenomeVersion: 'genome-v1',
    researchRefs: ['research:vr-world-design'],
    requiredOutcome: 'A bounded candidate environment ready for validation.',
    assetClasses: ['mesh'],
    codeClasses: [],
    dependencies: [],
    ownedResourceScopes: ['region:planet-a/region-a'],
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
    forbiddenOperations: ['MERGE', 'DEPLOY', 'RUNTIME_MUTATE'],
    requiredAgents: ['world_design'],
    performanceBudget: { frameTimeMs: 11.1 },
    comfortBudget: { locomotion: 'seated-compatible' },
    licenceAndProvenanceRequirements: 'Generated with full provenance; no copied proprietary material.',
    previewRequirement: 'REQUIRED',
    verificationContract: 'Deterministic source and preview validation required.',
    approvalRequirement: 'OPERATOR_REQUIRED',
    rollbackTarget: { scope: 'REGION', snapshotId: null, targetId: 'region-a' },
    status: 'DRAFT',
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    ...overrides,
  };
}

test('creates a complete engine-neutral Planet Design Genome', () => {
  const created = createSpatialPlanetDesignGenome(validGenomeInput());
  assert.equal(created.valid, true, created.validation.errors.join('\n'));
  assert.equal(created.genome.influences.every((entry) => entry.copyingAllowed === false), true);
  assert.deepEqual(Object.keys(created.genome.dimensions).sort(), [...SPATIAL_PLANET_DESIGN_DIMENSIONS].sort());
});

test('rejects influence records that claim copying authority', () => {
  const created = createSpatialPlanetDesignGenome(validGenomeInput());
  const unsafe = {
    ...created.genome,
    influences: [{ sourceRef: 'influence:game', principles: ['copy the level'], copyingAllowed: true }],
  };
  const validation = validateSpatialPlanetDesignGenome(unsafe);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.includes('copyingAllowed-must-be-false')), true);
});

test('binds only the exact planet and genome version requested by the build order', () => {
  const created = createSpatialPlanetDesignGenome(validGenomeInput());
  const bound = planSpatialPlanetDesignGenomeBinding(validBuildOrder(), created.genome);
  assert.equal(bound.status, 'BOUND_FOR_SPATIAL_BUILD_ORDER');
  assert.equal(bound.authority.assetGenerationAllowed, false);
  assert.equal(bound.authority.runtimeMutationAllowed, false);

  const wrongPlanet = planSpatialPlanetDesignGenomeBinding(validBuildOrder({ planetId: 'planet-b', ownedResourceScopes: ['region:planet-b/region-a'] }), created.genome);
  assert.equal(wrongPlanet.status, 'BLOCKED_PLANET_MISMATCH');

  const wrongVersion = planSpatialPlanetDesignGenomeBinding(validBuildOrder({ designGenomeVersion: 'genome-v2' }), created.genome);
  assert.equal(wrongVersion.status, 'BLOCKED_GENOME_VERSION_MISMATCH');
});

test('fails closed on accessor-backed and throwing Spatial Genome input without invoking getters', () => {
  let getterCalls = 0;
  const accessorInput = validGenomeInput();
  Object.defineProperty(accessorInput.dimensions, 'explorationRhythm', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });

  const created = createSpatialPlanetDesignGenome(accessorInput);
  assert.equal(created.valid, false);
  assert.equal(created.genome, null);
  assert.equal(getterCalls, 0);

  const validation = validateSpatialPlanetDesignGenome(accessorInput);
  assert.equal(validation.valid, false);
  assert.equal(getterCalls, 0);

  const target = validGenomeInput();
  const revoked = Proxy.revocable(target, {});
  revoked.revoke();
  assert.doesNotThrow(() => createSpatialPlanetDesignGenome(revoked.proxy));
  assert.equal(createSpatialPlanetDesignGenome(revoked.proxy).valid, false);
});
