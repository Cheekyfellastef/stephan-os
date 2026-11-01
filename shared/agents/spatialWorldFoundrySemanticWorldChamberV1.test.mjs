import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpatialSemanticWorldChamber, SPATIAL_SEMANTIC_WORLD_STATUS } from './spatialWorldFoundrySemanticWorldChamberV1.mjs';
import { planSpatialFoundryValidation } from './spatialWorldFoundryValidatorFrameworkV1.mjs';

const sourceHead = 'a'.repeat(40);
const contentHash = `sha256:${'b'.repeat(64)}`;
const buildOrder = { schemaVersion:'stephanos.spatial-build-order.v1', spatialBuildOrderId:'build-order-a', intentId:'intent-a', missionId:'mission-a', planetId:'planet-a', regionId:'region-a', objectIds:[], operatorRequest:'Create one bounded primitive candidate.', interpretationSummary:'One previewable test asset only.', designGenomeVersion:'genome-v1', researchRefs:['research:primitive'], requiredOutcome:'A validated preview candidate.', assetClasses:['mesh'], codeClasses:[], dependencies:[], ownedResourceScopes:['region:planet-a/region-a'], allowedOperations:['GENERATE_ASSET','WRITE_SANDBOX','RUN_VALIDATION'], forbiddenOperations:['MERGE','DEPLOY'], requiredAgents:['mesh'], performanceBudget:{ frameTimeMs:11.1 }, comfortBudget:{ flashingAllowed:false }, licenceAndProvenanceRequirements:'Generated with complete provenance.', previewRequirement:'REQUIRED', verificationContract:'Source, asset, budget and preview proof.', approvalRequirement:'OPERATOR_REQUIRED', rollbackTarget:{ scope:'REGION', snapshotId:null, targetId:'region-a' }, status:'DRAFT', createdAtUtc:'2026-08-17T15:00:00.000Z' };
const assetRecord = { schemaVersion:'stephanos.spatial-asset-registry-record.v1', assetId:'asset-a', assetType:'mesh', version:'v1', contentHash, sourceLocation:`cas://sha256/${'b'.repeat(64)}`, largeAssetLocation:null, creatorAgentId:'mesh-agent', creatingBuildOrderId:'build-order-a', planetId:'planet-a', regionId:'region-a', parentVersion:null, sourceAndInfluenceRefs:['research:primitive'], licenceAndRightsState:'GENERATED_WITH_PROVENANCE', dependencies:[], dependents:[], engineOrRuntimeCompatibility:['engine-neutral'], performanceClass:'small', validationState:'pending', integrationState:'DRAFT', liveState:'NOT_LIVE', rollbackRefs:[], createdAtUtc:'2026-08-17T15:00:00.000Z' };
function obs(kind, semanticId, n, targetId = '') { return { observationId:`obs-${n}`, evaluatorId:'semantic-chamber-v1', evaluatorVersion:'1.0.0', kind, semanticId, targetId, verdict:'PASS', spatialBuildOrderId:'build-order-a', assetId:'asset-a', assetVersion:'v1', sourceHead, evidenceRef:`proofs/semantic/${n}`, observedAtUtc:`2026-08-20T16:2${n}:00.000Z` }; }
function input() { return { sourceHead, evaluatorId:'semantic-chamber-v1', evaluatorVersion:'1.0.0', requiredAnchors:['entry-anchor'], requiredAffordances:['door-open'], requiredWorldStates:['safe-state'], observations:[obs('ANCHOR_PRESENT','entry-anchor',1),obs('AFFORDANCE_BOUND','door-open',2,'door-001'),obs('WORLD_STATE_LABEL','safe-state',3),obs('REGION_TRAVERSABLE','walk-zone',4)] }; }
function evidence(validationClass, validatorId) { return { validatorId, validatorVersion:'v1', class:validationClass, verdict:'PASS', spatialBuildOrderId:'build-order-a', assetId:'asset-a', assetVersion:'v1', sourceHead, evidenceRef:`proof:${validationClass.toLowerCase()}`, observedAtUtc:'2026-08-20T16:30:00.000Z' }; }

test('emits exact SEMANTIC_WORLD pass evidence for existing validator framework', () => {
  const out = evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,input());
  assert.equal(out.status,SPATIAL_SEMANTIC_WORLD_STATUS.PASS);
  assert.deepEqual(Object.keys(out.evidence).sort(), ['assetId','assetVersion','class','evidenceRef','observedAtUtc','sourceHead','spatialBuildOrderId','validatorId','validatorVersion','verdict']);
  assert.equal(out.authority.worldMutationAllowed,false);
});
test('existing validator framework accepts emitted semantic evidence shape', () => {
  const semantic = evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,input()).evidence;
  const validators = [
    { validatorId:'source-validator', version:'v1', classes:['SOURCE_CONTRACT','ASSET_INTEGRITY','DEPENDENCY_INTEGRITY'], deterministic:true, engineNeutral:true },
    { validatorId:'budget-validator', version:'v1', classes:['PERFORMANCE_BUDGET','COMFORT_BUDGET'], deterministic:true, engineNeutral:true },
    { validatorId:'semantic-chamber-v1', version:'1.0.0', classes:['SEMANTIC_WORLD'], deterministic:true, engineNeutral:true },
    { validatorId:'preview-validator', version:'v1', classes:['PREVIEW'], deterministic:false, engineNeutral:true },
  ];
  const allEvidence = [evidence('SOURCE_CONTRACT','source-validator'),evidence('ASSET_INTEGRITY','source-validator'),evidence('DEPENDENCY_INTEGRITY','source-validator'),evidence('PERFORMANCE_BUDGET','budget-validator'),evidence('COMFORT_BUDGET','budget-validator'),semantic,evidence('PREVIEW','preview-validator')];
  assert.equal(planSpatialFoundryValidation(buildOrder,assetRecord,{ sourceHead, validators, evidence:allEvidence, requireSemantic:true }).status,'READY_FOR_PROMOTION_REVIEW');
});
test('requires missing semantic anchor evidence', () => {
  const p=input(); p.observations=p.observations.filter((e)=>e.kind!=='ANCHOR_PRESENT');
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.REQUIRED);
});
test('requires one bound affordance target', () => {
  const p=input(); p.observations.find((e)=>e.kind==='AFFORDANCE_BOUND').targetId='';
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.REQUIRED);
});
test('fails explicit semantic evidence failure', () => {
  const p=input(); p.observations[0].verdict='FAIL';
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.FAILED);
});
test('fails contradictory region semantics', () => {
  const p=input(); p.observations.push(obs('REGION_BLOCKED','walk-zone',5));
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.FAILED);
});
test('rejects wrong exact source head', () => {
  const p=input(); p.observations[0].sourceHead='c'.repeat(40);
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.INVALID);
});
test('rejects duplicate observation identities', () => {
  const p=input(); p.observations[1].observationId=p.observations[0].observationId;
  assert.equal(evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p).status,SPATIAL_SEMANTIC_WORLD_STATUS.INVALID);
});
test('rejects authority-shaped widened input and remains inert', () => {
  const p=input(); p.command='run-engine';
  const out=evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,p);
  assert.equal(out.status,SPATIAL_SEMANTIC_WORLD_STATUS.INVALID);
  assert.equal(out.authority.runtimeMutationAllowed,false);
  assert.equal(out.authority.arbitraryCommandAllowed,false);
});
