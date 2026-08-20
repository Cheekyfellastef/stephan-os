import { validateSpatialAssetRecord, validateSpatialBuildOrder } from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_SEMANTIC_WORLD_CHAMBER_SCHEMA = 'stephanos.spatial-world-foundry.semantic-world-chamber.v1';
export const SPATIAL_SEMANTIC_WORLD_STATUS = Object.freeze({
  PASS: 'SEMANTIC_WORLD_PASS',
  REQUIRED: 'SEMANTIC_WORLD_EVIDENCE_REQUIRED',
  FAILED: 'SEMANTIC_WORLD_VALIDATION_FAILED',
  INVALID: 'SEMANTIC_WORLD_EVIDENCE_INVALID',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const OBSERVATION_KINDS = new Set(['ANCHOR_PRESENT','AFFORDANCE_BOUND','REGION_TRAVERSABLE','REGION_BLOCKED','WORLD_STATE_LABEL']);

function text(value, max = 256) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max && !CONTROL.test(value) ? value : '';
}
function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function authority() {
  return freeze({ validatorExecutionAllowed:false, sourceMutationAllowed:false, assetMutationAllowed:false,
    registryMutationAllowed:false, promotionAllowed:false, mergeAllowed:false, deploymentAllowed:false,
    runtimeMutationAllowed:false, headsetActionAllowed:false, worldMutationAllowed:false,
    arbitraryCommandAllowed:false, evidenceOnly:true });
}
function invalid(errors) { return freeze({ schemaVersion:SPATIAL_SEMANTIC_WORLD_CHAMBER_SCHEMA, status:SPATIAL_SEMANTIC_WORLD_STATUS.INVALID, errors:[...new Set(errors)], evidence:null, authority:authority() }); }
function output(status, errors, evidence = null) { return freeze({ schemaVersion:SPATIAL_SEMANTIC_WORLD_CHAMBER_SCHEMA, status, errors:[...new Set(errors)], evidence, authority:authority() }); }

function normalizeRequired(value, name, errors) {
  if (!dense(value) || value.length > 128) { errors.push(`${name}-invalid`); return null; }
  const entries = value.map((entry) => text(entry, 128));
  if (entries.some((entry) => !SAFE_ID.test(entry)) || new Set(entries).size !== entries.length) { errors.push(`${name}-invalid`); return null; }
  return [...entries].sort();
}
function normalizeObservation(value, index, identity, errors) {
  const prefix = `observation-${index + 1}`;
  const keys = ['observationId','evaluatorId','evaluatorVersion','kind','semanticId','targetId','verdict','spatialBuildOrderId','assetId','assetVersion','sourceHead','evidenceRef','observedAtUtc'];
  if (!plain(value) || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) { errors.push(`${prefix}-shape-invalid`); return null; }
  if (!SAFE_ID.test(text(value.observationId,128)) || value.evaluatorId !== identity.evaluatorId
    || value.evaluatorVersion !== identity.evaluatorVersion || !OBSERVATION_KINDS.has(value.kind)
    || !SAFE_ID.test(text(value.semanticId,128)) || (value.targetId !== '' && !SAFE_ID.test(text(value.targetId,128)))
    || !['PASS','FAIL'].includes(value.verdict)
    || value.spatialBuildOrderId !== identity.spatialBuildOrderId || value.assetId !== identity.assetId
    || value.assetVersion !== identity.assetVersion || text(value.sourceHead,40).toLowerCase() !== identity.sourceHead
    || !text(value.evidenceRef,1024)) { errors.push(`${prefix}-identity-invalid`); return null; }
  const observed = Date.parse(text(value.observedAtUtc,64));
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== value.observedAtUtc) { errors.push(`${prefix}-time-invalid`); return null; }
  return freeze({ ...value, sourceHead:identity.sourceHead });
}

export function evaluateSpatialSemanticWorldChamber(buildOrder = {}, assetRecord = {}, input = {}) {
  const build = validateSpatialBuildOrder(buildOrder);
  if (!build.valid) return invalid(build.errors);
  const asset = validateSpatialAssetRecord(assetRecord);
  if (!asset.valid) return invalid(asset.errors);
  if (assetRecord.creatingBuildOrderId !== buildOrder.spatialBuildOrderId || assetRecord.planetId !== buildOrder.planetId || assetRecord.regionId !== buildOrder.regionId) return invalid(['asset-build-order-binding-mismatch']);
  if (!plain(input)) return invalid(['input-not-data-only']);
  const allowed = ['sourceHead','evaluatorId','evaluatorVersion','requiredAnchors','requiredAffordances','requiredWorldStates','observations'];
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !allowed.includes(key))) return invalid(['input-shape-invalid']);
  const sourceHead = text(input.sourceHead,40).toLowerCase();
  const evaluatorId = text(input.evaluatorId,128);
  const evaluatorVersion = text(input.evaluatorVersion,128);
  if (!SHA.test(sourceHead) || !SAFE_ID.test(evaluatorId) || !SAFE_VERSION.test(evaluatorVersion)) return invalid(['evaluator-or-source-identity-invalid']);
  const errors = [];
  const requiredAnchors = normalizeRequired(input.requiredAnchors,'requiredAnchors',errors);
  const requiredAffordances = normalizeRequired(input.requiredAffordances,'requiredAffordances',errors);
  const requiredWorldStates = normalizeRequired(input.requiredWorldStates,'requiredWorldStates',errors);
  if (errors.length) return invalid(errors);
  if (!dense(input.observations) || input.observations.length > 512) return invalid(['observations-invalid']);
  const identity = { evaluatorId, evaluatorVersion, spatialBuildOrderId:buildOrder.spatialBuildOrderId,
    assetId:assetRecord.assetId, assetVersion:assetRecord.version, sourceHead };
  const observations = input.observations.map((entry,index) => normalizeObservation(entry,index,identity,errors)).filter(Boolean);
  if (errors.length) return invalid(errors);
  const ids = observations.map((entry) => entry.observationId);
  if (new Set(ids).size !== ids.length) return invalid(['duplicate-observation-id']);

  const failed = observations.filter((entry) => entry.verdict === 'FAIL');
  const semanticContradictions = new Map();
  for (const entry of observations.filter((item) => ['REGION_TRAVERSABLE','REGION_BLOCKED'].includes(item.kind))) {
    const prior = semanticContradictions.get(entry.semanticId);
    if (prior && prior !== entry.kind) return output(SPATIAL_SEMANTIC_WORLD_STATUS.FAILED,[`region-semantics-contradict:${entry.semanticId}`]);
    semanticContradictions.set(entry.semanticId,entry.kind);
  }
  if (failed.length) return output(SPATIAL_SEMANTIC_WORLD_STATUS.FAILED,failed.map((entry) => `failed:${entry.kind}:${entry.semanticId}`));

  const has = (kind,id) => observations.some((entry) => entry.kind === kind && entry.semanticId === id && entry.verdict === 'PASS');
  const missing = [];
  for (const id of requiredAnchors) if (!has('ANCHOR_PRESENT',id)) missing.push(`anchor:${id}`);
  for (const id of requiredAffordances) {
    const matches = observations.filter((entry) => entry.kind === 'AFFORDANCE_BOUND' && entry.semanticId === id && entry.verdict === 'PASS' && SAFE_ID.test(text(entry.targetId,128)));
    if (matches.length !== 1) missing.push(`affordance:${id}`);
  }
  for (const id of requiredWorldStates) if (!has('WORLD_STATE_LABEL',id)) missing.push(`world-state:${id}`);
  if (missing.length) return output(SPATIAL_SEMANTIC_WORLD_STATUS.REQUIRED,missing);

  const evidence = freeze({ validatorId:evaluatorId, validatorVersion:evaluatorVersion, class:'SEMANTIC_WORLD', verdict:'PASS',
    spatialBuildOrderId:buildOrder.spatialBuildOrderId, assetId:assetRecord.assetId, assetVersion:assetRecord.version,
    sourceHead, evidenceRef:`semantic-world:${evaluatorId}:${assetRecord.assetId}:${sourceHead.slice(0,12)}`,
    observedAtUtc:observations.map((entry) => entry.observedAtUtc).sort().at(-1) });
  return output(SPATIAL_SEMANTIC_WORLD_STATUS.PASS,[],evidence);
}
