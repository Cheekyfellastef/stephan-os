import { validateSpatialBuildOrder } from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_PLANET_DESIGN_GENOME_SCHEMA_VERSION = 'stephanos.spatial-planet-design-genome.v1';
export const SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION = 'stephanos.spatial-planet-design-genome-binding.v1';

export const SPATIAL_PLANET_DESIGN_DIMENSIONS = Object.freeze([
  'explorationRhythm',
  'spatialScaleAndLandmarking',
  'architectureAndSettlementGrammar',
  'lightingAndAtmosphere',
  'worldInteraction',
  'soundscapeAndAmbience',
  'proceduralAuthoredBalance',
  'activityDensity',
  'navigationAndDiscoverability',
  'persistenceAndWorldEvolution',
  'vrEmbodimentAndComfort',
  'performancePosture',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const GENOME_KEYS = Object.freeze([
  'schemaVersion',
  'genomeId',
  'planetId',
  'version',
  'sourceHead',
  'researchRefs',
  'influences',
  'dimensions',
  'performanceBudget',
  'comfortBudget',
  'licencePolicy',
  'createdAtUtc',
]);
const INFLUENCE_KEYS = Object.freeze(['sourceRef', 'principles', 'copyingAllowed']);
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function plain(value) {
  try {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  } catch {
    return false;
  }
}

function snapshotData(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  try {
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== 'string')) return null;
      const allowed = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
      if (keys.some((key) => !allowed.has(key))) return null;
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor)) return null;
        const captured = snapshotData(descriptor.value, seen);
        if (captured === null && descriptor.value !== null) return null;
        output.push(captured);
      }
      return output;
    }
    if (!plain(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || PROTOTYPE_KEYS.has(key))) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) return null;
      const captured = snapshotData(descriptor.value, seen);
      if (captured === null && descriptor.value !== null) return null;
      Object.defineProperty(output, key, { value: captured, enumerable: true, configurable: false, writable: false });
    }
    return output;
  } catch {
    return null;
  }
}

function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function text(value, maximum = 4096) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value)
    ? value
    : '';
}

function exactShape(value, keys, errors, prefix) {
  if (!plain(value)) {
    errors.push(`${prefix}-must-be-data-only-object`);
    return false;
  }
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) {
    errors.push(`${prefix}-symbol-keys-forbidden`);
    return false;
  }
  for (const key of actual) if (!keys.includes(key)) errors.push(`${prefix}-unknown-field:${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${prefix}-missing-field:${key}`);
  return errors.length === 0;
}

function stringList(value, field, errors, minimum = 0) {
  if (!dense(value)) {
    errors.push(`${field}-must-be-dense-array`);
    return [];
  }
  const output = [];
  for (const item of value) {
    const candidate = text(item, 1024);
    if (!candidate) errors.push(`${field}-contains-invalid-value`);
    else output.push(candidate);
  }
  if (new Set(output).size !== output.length) errors.push(`${field}-contains-duplicate`);
  if (output.length < minimum) errors.push(`${field}-requires-${minimum}`);
  return output;
}

function timestamp(value) {
  if (!text(value, 64)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function budget(value, field, errors) {
  if (!plain(value) || Object.keys(value).length === 0 || Object.keys(value).length > 16) {
    errors.push(`${field}-invalid`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(key)) errors.push(`${field}-key-invalid`);
    if (typeof entry === 'number' && Number.isFinite(entry)) continue;
    if (typeof entry === 'boolean') continue;
    if (text(entry, 256)) continue;
    errors.push(`${field}-value-invalid`);
  }
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = frozen(entry);
  return Object.freeze(output);
}

export function validateSpatialPlanetDesignGenome(genome = {}) {
  const errors = [];
  const candidate = snapshotData(genome);
  if (!candidate || Array.isArray(candidate)) {
    errors.push('genome-must-be-data-only-object');
    return Object.freeze({ valid: false, errors: Object.freeze(errors), refusalReason: errors[0] });
  }
  if (!exactShape(candidate, GENOME_KEYS, errors, 'genome')) return Object.freeze({ valid: false, errors: Object.freeze(errors), refusalReason: errors[0] || '' });
  if (candidate.schemaVersion !== SPATIAL_PLANET_DESIGN_GENOME_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!SAFE_ID.test(text(candidate.genomeId, 128))) errors.push('genomeId-invalid');
  if (!SAFE_ID.test(text(candidate.planetId, 128))) errors.push('planetId-invalid');
  if (!SAFE_VERSION.test(text(candidate.version, 128))) errors.push('version-invalid');
  if (!SHA.test(text(candidate.sourceHead, 40))) errors.push('sourceHead-invalid');
  stringList(candidate.researchRefs, 'researchRefs', errors, 1);

  if (!dense(candidate.influences) || candidate.influences.length === 0) errors.push('influences-must-be-non-empty-dense-array');
  else {
    for (let index = 0; index < candidate.influences.length; index += 1) {
      const influence = candidate.influences[index];
      const prefix = `influence-${index + 1}`;
      const local = [];
      exactShape(influence, INFLUENCE_KEYS, local, prefix);
      if (!text(influence?.sourceRef, 1024)) local.push(`${prefix}-sourceRef-invalid`);
      stringList(influence?.principles, `${prefix}-principles`, local, 1);
      if (influence?.copyingAllowed !== false) local.push(`${prefix}-copyingAllowed-must-be-false`);
      errors.push(...local);
    }
  }

  if (!plain(candidate.dimensions)) errors.push('dimensions-must-be-data-only-object');
  else {
    const keys = Object.keys(candidate.dimensions);
    for (const key of keys) if (!SPATIAL_PLANET_DESIGN_DIMENSIONS.includes(key)) errors.push(`dimensions-unknown-field:${key}`);
    for (const key of SPATIAL_PLANET_DESIGN_DIMENSIONS) {
      if (!Object.hasOwn(candidate.dimensions, key)) errors.push(`dimensions-missing-field:${key}`);
      else if (!text(candidate.dimensions[key], 4096)) errors.push(`dimensions-${key}-invalid`);
    }
  }

  budget(candidate.performanceBudget, 'performanceBudget', errors);
  budget(candidate.comfortBudget, 'comfortBudget', errors);
  if (!text(candidate.licencePolicy, 4096)) errors.push('licencePolicy-invalid');
  if (!timestamp(candidate.createdAtUtc)) errors.push('createdAtUtc-invalid');
  const unique = [...new Set(errors)];
  return Object.freeze({ valid: unique.length === 0, errors: Object.freeze(unique), refusalReason: unique[0] || '' });
}

export function createSpatialPlanetDesignGenome(input = {}) {
  const source = snapshotData(input);
  if (!source || Array.isArray(source)) {
    const validation = Object.freeze({ valid: false, errors: Object.freeze(['genome-input-must-be-data-only-object']), refusalReason: 'genome-input-must-be-data-only-object' });
    return frozen({ valid: false, genome: null, validation });
  }
  const genome = frozen({
    schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_SCHEMA_VERSION,
    genomeId: source.genomeId,
    planetId: source.planetId,
    version: source.version,
    sourceHead: source.sourceHead,
    researchRefs: Array.isArray(source.researchRefs) ? [...source.researchRefs] : [],
    influences: Array.isArray(source.influences) ? source.influences.map((entry) => ({
      sourceRef: entry?.sourceRef,
      principles: Array.isArray(entry?.principles) ? [...entry.principles] : [],
      copyingAllowed: false,
    })) : [],
    dimensions: plain(source.dimensions) ? { ...source.dimensions } : {},
    performanceBudget: plain(source.performanceBudget) ? { ...source.performanceBudget } : {},
    comfortBudget: plain(source.comfortBudget) ? { ...source.comfortBudget } : {},
    licencePolicy: source.licencePolicy,
    createdAtUtc: source.createdAtUtc,
  });
  const validation = validateSpatialPlanetDesignGenome(genome);
  return frozen({ valid: validation.valid, genome: validation.valid ? genome : null, validation });
}

export function planSpatialPlanetDesignGenomeBinding(buildOrder = {}, genome = {}) {
  const authority = frozen({
    sourceMutationAllowed: false,
    assetGenerationAllowed: false,
    storageWriteAllowed: false,
    leaseIssueAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    voiceExecutionAllowed: false,
  });
  const buildOrderValidation = validateSpatialBuildOrder(buildOrder);
  if (!buildOrderValidation.valid) return frozen({ schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION, status: 'BLOCKED_INVALID_BUILD_ORDER', errors: buildOrderValidation.errors, authority });
  const genomeValidation = validateSpatialPlanetDesignGenome(genome);
  if (!genomeValidation.valid) return frozen({ schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION, status: 'BLOCKED_INVALID_GENOME', errors: genomeValidation.errors, authority });
  const safeGenome = snapshotData(genome);
  if (!safeGenome || Array.isArray(safeGenome)) return frozen({ schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION, status: 'BLOCKED_INVALID_GENOME', errors: Object.freeze(['genome-must-be-data-only-object']), authority });
  if (buildOrder.planetId !== safeGenome.planetId) return frozen({ schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION, status: 'BLOCKED_PLANET_MISMATCH', errors: Object.freeze(['planetId-mismatch']), authority });
  if (buildOrder.designGenomeVersion !== safeGenome.version) return frozen({ schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION, status: 'BLOCKED_GENOME_VERSION_MISMATCH', errors: Object.freeze(['designGenomeVersion-mismatch']), authority });
  return frozen({
    schemaVersion: SPATIAL_PLANET_DESIGN_GENOME_BINDING_SCHEMA_VERSION,
    status: 'BOUND_FOR_SPATIAL_BUILD_ORDER',
    spatialBuildOrderId: buildOrder.spatialBuildOrderId,
    planetId: safeGenome.planetId,
    genomeId: safeGenome.genomeId,
    genomeVersion: safeGenome.version,
    genomeSourceHead: safeGenome.sourceHead,
    researchRefs: safeGenome.researchRefs,
    errors: Object.freeze([]),
    authority,
  });
}
