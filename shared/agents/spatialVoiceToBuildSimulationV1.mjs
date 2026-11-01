import {
  SPATIAL_BUILD_ORDER_SCHEMA_VERSION,
  validateSpatialBuildOrder,
} from './spatialWorldFoundryContractsV1.mjs';

export const SPATIAL_VOICE_TO_BUILD_PROPOSAL_SCHEMA_VERSION = 'stephanos.spatial-voice-to-build-proposal.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(value, maximum = 8192) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value)
    ? value
    : '';
}

function safeId(value) {
  return SAFE_ID.test(text(value, 128));
}

function denseStrings(value, maximum = 1024) {
  if (!Array.isArray(value)) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const candidate = text(value[index], maximum);
    if (!candidate) return null;
    output.push(candidate);
  }
  return new Set(output).size === output.length ? output : null;
}

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
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
    rawVoiceExecutionAllowed: false,
    gazeAuthorityAllowed: false,
    controllerTargetAuthorityAllowed: false,
    sourceMutationAllowed: false,
    leaseIssueAllowed: false,
    assetGenerationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}

export function createSpatialVoiceBuildOrderProposal(input = {}) {
  const transcript = text(input.transcript);
  if (!transcript) return freeze({ schemaVersion: SPATIAL_VOICE_TO_BUILD_PROPOSAL_SCHEMA_VERSION, status: 'BLOCKED_INVALID_TRANSCRIPT', errors: ['transcript-invalid'], authority: authority() });

  const context = plain(input.context) ? input.context : {};
  const contextRefs = denseStrings(context.contextRefs || []) ?? null;
  const objectIds = denseStrings(context.objectIds || [], 128) ?? null;
  const ownedResourceScopes = denseStrings(input.proposedOwnedResourceScopes || []) ?? null;
  if (!safeId(input.spatialBuildOrderId)
    || !safeId(input.intentId)
    || !safeId(context.missionId)
    || !safeId(context.planetId)
    || !safeId(context.regionId)
    || !contextRefs
    || !objectIds
    || objectIds.some((id) => !safeId(id))
    || !ownedResourceScopes) {
    return freeze({ schemaVersion: SPATIAL_VOICE_TO_BUILD_PROPOSAL_SCHEMA_VERSION, status: 'BLOCKED_INVALID_CONTEXT', errors: ['bounded-spatial-context-invalid'], authority: authority() });
  }

  const buildOrder = freeze({
    schemaVersion: SPATIAL_BUILD_ORDER_SCHEMA_VERSION,
    spatialBuildOrderId: input.spatialBuildOrderId,
    intentId: input.intentId,
    missionId: context.missionId,
    planetId: context.planetId,
    regionId: context.regionId,
    objectIds,
    operatorRequest: transcript,
    interpretationSummary: input.interpretationSummary,
    designGenomeVersion: input.designGenomeVersion,
    researchRefs: Array.isArray(input.researchRefs) ? [...input.researchRefs] : [],
    requiredOutcome: input.requiredOutcome,
    assetClasses: Array.isArray(input.assetClasses) ? [...input.assetClasses] : [],
    codeClasses: Array.isArray(input.codeClasses) ? [...input.codeClasses] : [],
    dependencies: Array.isArray(input.dependencies) ? [...input.dependencies] : [],
    ownedResourceScopes,
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
    forbiddenOperations: ['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE', 'ARBITRARY_COMMAND'],
    requiredAgents: Array.isArray(input.requiredAgents) ? [...input.requiredAgents] : [],
    performanceBudget: plain(input.performanceBudget) ? { ...input.performanceBudget } : {},
    comfortBudget: plain(input.comfortBudget) ? { ...input.comfortBudget } : {},
    licenceAndProvenanceRequirements: input.licenceAndProvenanceRequirements,
    previewRequirement: input.previewRequirement || 'REQUIRED',
    verificationContract: input.verificationContract,
    approvalRequirement: input.approvalRequirement || 'OPERATOR_REQUIRED',
    rollbackTarget: plain(input.rollbackTarget) ? { ...input.rollbackTarget } : {},
    status: 'DRAFT',
    createdAtUtc: input.createdAtUtc,
  });

  const validation = validateSpatialBuildOrder(buildOrder);
  if (!validation.valid) {
    return freeze({
      schemaVersion: SPATIAL_VOICE_TO_BUILD_PROPOSAL_SCHEMA_VERSION,
      status: 'BLOCKED_INVALID_BUILD_ORDER_PROPOSAL',
      transcript,
      contextRefs,
      errors: validation.errors,
      authority: authority(),
    });
  }

  const scopeConfirmed = input.scopeConfirmed === true;
  return freeze({
    schemaVersion: SPATIAL_VOICE_TO_BUILD_PROPOSAL_SCHEMA_VERSION,
    status: scopeConfirmed ? 'BUILD_ORDER_PROPOSAL_READY' : 'SCOPE_CONFIRMATION_REQUIRED',
    transcript,
    contextRefs,
    context: {
      missionId: context.missionId,
      planetId: context.planetId,
      regionId: context.regionId,
      objectIds,
      selectedObjectRef: text(context.selectedObjectRef || '', 1024) || null,
      gazeTargetRef: text(context.gazeTargetRef || '', 1024) || null,
      controllerTargetRef: text(context.controllerTargetRef || '', 1024) || null,
    },
    proposedOwnedResourceScopes: ownedResourceScopes,
    scopeConfirmed,
    buildOrder,
    errors: [],
    authority: authority(),
  });
}
