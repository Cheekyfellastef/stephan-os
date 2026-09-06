import {
  validateSpatialAssetRecord,
  validateSpatialBuildOrder,
} from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_VALIDATOR_FRAMEWORK_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.validator-framework.v1';
export const SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.validation-plan.v1';

export const SPATIAL_VALIDATION_CLASSES = Object.freeze([
  'SOURCE_CONTRACT',
  'ASSET_INTEGRITY',
  'DEPENDENCY_INTEGRITY',
  'PERFORMANCE_BUDGET',
  'COMFORT_BUDGET',
  'SEMANTIC_WORLD',
  'PREVIEW',
]);

const DEFAULT_REQUIRED_CLASSES = Object.freeze([
  'SOURCE_CONTRACT',
  'ASSET_INTEGRITY',
  'DEPENDENCY_INTEGRITY',
  'PERFORMANCE_BUDGET',
  'COMFORT_BUDGET',
]);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(value, maximum = 1024) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value)
    ? value
    : '';
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
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = freeze(entry);
  return Object.freeze(output);
}

function authority() {
  return freeze({
    validatorExecutionAllowed: false,
    sourceMutationAllowed: false,
    assetMutationAllowed: false,
    promotionAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}

function validatorDescriptor(value, errors, index) {
  const prefix = `validator-${index + 1}`;
  if (!plain(value)) {
    errors.push(`${prefix}-must-be-data-only-object`);
    return null;
  }
  const allowed = ['validatorId', 'version', 'classes', 'deterministic', 'engineNeutral'];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) errors.push(`${prefix}-field-invalid`);
  }
  for (const key of allowed) if (!Object.hasOwn(value, key)) errors.push(`${prefix}-missing-field:${key}`);
  if (!SAFE_ID.test(text(value.validatorId, 128))) errors.push(`${prefix}-validatorId-invalid`);
  if (!SAFE_VERSION.test(text(value.version, 128))) errors.push(`${prefix}-version-invalid`);
  if (!dense(value.classes) || value.classes.length === 0 || value.classes.some((entry) => !SPATIAL_VALIDATION_CLASSES.includes(entry))) errors.push(`${prefix}-classes-invalid`);
  if (value.deterministic !== true && value.deterministic !== false) errors.push(`${prefix}-deterministic-invalid`);
  if (value.engineNeutral !== true && value.engineNeutral !== false) errors.push(`${prefix}-engineNeutral-invalid`);
  return errors.some((error) => error.startsWith(prefix)) ? null : freeze({
    validatorId: value.validatorId,
    version: value.version,
    classes: [...new Set(value.classes)].sort(),
    deterministic: value.deterministic,
    engineNeutral: value.engineNeutral,
  });
}

function evidenceRecord(value, errors, index) {
  const prefix = `evidence-${index + 1}`;
  if (!plain(value)) {
    errors.push(`${prefix}-must-be-data-only-object`);
    return null;
  }
  const keys = ['validatorId', 'validatorVersion', 'class', 'verdict', 'spatialBuildOrderId', 'assetId', 'assetVersion', 'sourceHead', 'evidenceRef', 'observedAtUtc'];
  for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !keys.includes(key)) errors.push(`${prefix}-field-invalid`);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${prefix}-missing-field:${key}`);
  if (!SAFE_ID.test(text(value.validatorId, 128))) errors.push(`${prefix}-validatorId-invalid`);
  if (!SAFE_VERSION.test(text(value.validatorVersion, 128))) errors.push(`${prefix}-validatorVersion-invalid`);
  if (!SPATIAL_VALIDATION_CLASSES.includes(value.class)) errors.push(`${prefix}-class-invalid`);
  if (!['PASS', 'FAIL'].includes(value.verdict)) errors.push(`${prefix}-verdict-invalid`);
  if (!SAFE_ID.test(text(value.spatialBuildOrderId, 128))) errors.push(`${prefix}-spatialBuildOrderId-invalid`);
  if (!SAFE_ID.test(text(value.assetId, 128))) errors.push(`${prefix}-assetId-invalid`);
  if (!SAFE_VERSION.test(text(value.assetVersion, 128))) errors.push(`${prefix}-assetVersion-invalid`);
  if (!SHA.test(text(value.sourceHead, 40))) errors.push(`${prefix}-sourceHead-invalid`);
  if (!text(value.evidenceRef, 1024)) errors.push(`${prefix}-evidenceRef-invalid`);
  const observed = Date.parse(text(value.observedAtUtc, 64));
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== value.observedAtUtc) errors.push(`${prefix}-observedAtUtc-invalid`);
  return errors.some((error) => error.startsWith(prefix)) ? null : freeze({ ...value });
}

export function planSpatialFoundryValidation(buildOrder = {}, assetRecord = {}, input = {}) {
  const errors = [];
  const buildOrderValidation = validateSpatialBuildOrder(buildOrder);
  if (!buildOrderValidation.valid) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_BUILD_ORDER', errors: buildOrderValidation.errors, authority: authority() });
  const assetValidation = validateSpatialAssetRecord(assetRecord);
  if (!assetValidation.valid) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_ASSET', errors: assetValidation.errors, authority: authority() });
  if (assetRecord.creatingBuildOrderId !== buildOrder.spatialBuildOrderId || assetRecord.planetId !== buildOrder.planetId || assetRecord.regionId !== buildOrder.regionId) {
    return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_IDENTITY_MISMATCH', errors: ['asset-build-order-binding-mismatch'], authority: authority() });
  }

  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  if (!SHA.test(sourceHead)) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_SOURCE_IDENTITY', errors: ['exact-source-head-required'], authority: authority() });
  const requiredClasses = [...DEFAULT_REQUIRED_CLASSES];
  if (input.requireSemantic === true) requiredClasses.push('SEMANTIC_WORLD');
  if (buildOrder.previewRequirement === 'REQUIRED') requiredClasses.push('PREVIEW');
  const required = [...new Set(requiredClasses)];

  if (!dense(input.validators)) errors.push('validators-must-be-dense-array');
  const validators = dense(input.validators) ? input.validators.map((entry, index) => validatorDescriptor(entry, errors, index)).filter(Boolean) : [];
  const validatorIdentities = new Set();
  for (const validator of validators) {
    const identity = `${validator.validatorId}@${validator.version}`;
    if (validatorIdentities.has(identity)) errors.push(`duplicate-validator:${identity}`);
    validatorIdentities.add(identity);
  }
  const missingImplementations = required.filter((validationClass) => !validators.some((validator) => validator.classes.includes(validationClass)));
  if (missingImplementations.length > 0) errors.push(`missing-validator-class:${missingImplementations.join(',')}`);
  if (errors.length > 0) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_VALIDATOR_CATALOGUE', requiredClasses: required, errors, authority: authority() });

  const evidenceErrors = [];
  if (!dense(input.evidence)) evidenceErrors.push('evidence-must-be-dense-array');
  const evidence = dense(input.evidence) ? input.evidence.map((entry, index) => evidenceRecord(entry, evidenceErrors, index)).filter(Boolean) : [];
  if (evidenceErrors.length > 0) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_EVIDENCE', requiredClasses: required, errors: evidenceErrors, authority: authority() });

  for (const entry of evidence) {
    const validator = validators.find((candidate) => candidate.validatorId === entry.validatorId && candidate.version === entry.validatorVersion);
    if (!validator || !validator.classes.includes(entry.class)) errors.push(`evidence-validator-binding-invalid:${entry.class}`);
    if (entry.spatialBuildOrderId !== buildOrder.spatialBuildOrderId || entry.assetId !== assetRecord.assetId || entry.assetVersion !== assetRecord.version || entry.sourceHead.toLowerCase() !== sourceHead) errors.push(`evidence-identity-mismatch:${entry.class}`);
  }
  if (errors.length > 0) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_EVIDENCE', requiredClasses: required, errors, authority: authority() });

  const evidenceByClass = new Map();
  for (const entry of evidence) {
    const existing = evidenceByClass.get(entry.class);
    if (existing) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_EVIDENCE', requiredClasses: required, errors: [`duplicate-evidence-class:${entry.class}`], authority: authority() });
    evidenceByClass.set(entry.class, entry);
  }
  const missingEvidence = required.filter((validationClass) => !evidenceByClass.has(validationClass));
  if (missingEvidence.length > 0) {
    return freeze({
      schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION,
      status: 'VALIDATION_REQUIRED',
      spatialBuildOrderId: buildOrder.spatialBuildOrderId,
      assetIdentity: `${assetRecord.assetId}@${assetRecord.version}`,
      sourceHead,
      requiredClasses: required,
      missingEvidence,
      plannedChecks: validators.filter((validator) => validator.classes.some((validationClass) => missingEvidence.includes(validationClass))),
      errors: [],
      authority: authority(),
    });
  }

  const failed = required.filter((validationClass) => evidenceByClass.get(validationClass)?.verdict === 'FAIL');
  if (failed.length > 0) return freeze({ schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION, status: 'VALIDATION_FAILED', spatialBuildOrderId: buildOrder.spatialBuildOrderId, assetIdentity: `${assetRecord.assetId}@${assetRecord.version}`, sourceHead, requiredClasses: required, failedClasses: failed, errors: [], authority: authority() });

  return freeze({
    schemaVersion: SPATIAL_VALIDATION_PLAN_SCHEMA_VERSION,
    status: 'READY_FOR_PROMOTION_REVIEW',
    spatialBuildOrderId: buildOrder.spatialBuildOrderId,
    assetIdentity: `${assetRecord.assetId}@${assetRecord.version}`,
    sourceHead,
    requiredClasses: required,
    evidenceRefs: required.map((validationClass) => evidenceByClass.get(validationClass).evidenceRef),
    errors: [],
    authority: authority(),
  });
}
