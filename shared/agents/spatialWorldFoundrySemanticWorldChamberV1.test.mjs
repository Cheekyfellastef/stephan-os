import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSpatialSemanticWorldChamber, SPATIAL_SEMANTIC_WORLD_STATUS } from './spatialWorldFoundrySemanticWorldChamberV1.mjs';

const sourceHead = 'a'.repeat(40);
const buildOrder = { schemaVersion:'stephanos.spatial-world-foundry.build-order.v1', spatialBuildOrderId:'build-001', planetId:'planet-001', regionId:'region-001', requestedBy:'operator', intent:'build chamber', sourceBaseSha:sourceHead, branch:'agent/chamber', ownedResourceScopes:['region-001'], assetRequests:[{ assetId:'asset-001', kind:'primitive', requestedVersion:'1.0.0' }], previewRequirement:'NONE', promotionTarget:'DRAFT', approvalPosture:'NONE', authority:{ merge:false, deploy:false, runtimeMutation:false, leaseSeize:false, approve:false, voiceExecute:false } };
const assetRecord = { schemaVersion:'stephanos.spatial-world-foundry.asset-record.v1', assetId:'asset-001', version:'1.0.0', kind:'primitive', status:'DRAFT', planetId:'planet-001', regionId:'region-001', creatingBuildOrderId:'build-001', sourceBaseSha:sourceHead, sourceArtifactDigest:'sha256:'+'b'.repeat(64), provenance:{ sourceType:'ORIGINAL', sourceRef:'proofs/assets/001', license:'internal-original' }, dependencies:[], promotionEvidence:[], live:false };
function obs(kind, semanticId, n, targetId = '') { return { observationId:`obs-${n}`, evaluatorId:'semantic-chamber-v1', evaluatorVersion:'1.0.0', kind, semanticId, targetId, verdict:'PASS', spatialBuildOrderId:'build-001', assetId:'asset-001', assetVersion:'1.0.0', sourceHead, evidenceRef:`proofs/semantic/${n}`, observedAtUtc:`2026-08-20T16:2${n}:00.000Z` }; }
function input() { return { sourceHead, evaluatorId:'semantic-chamber-v1', evaluatorVersion:'1.0.0', requiredAnchors:['entry-anchor'], requiredAffordances:['door-open'], requiredWorldStates:['safe-state'], observations:[obs('ANCHOR_PRESENT','entry-anchor',1),obs('AFFORDANCE_BOUND','door-open',2,'door-001'),obs('WORLD_STATE_LABEL','safe-state',3),obs('REGION_TRAVERSABLE','walk-zone',4)] }; }

test('emits exact SEMANTIC_WORLD pass evidence for existing validator framework', () => {
  const out = evaluateSpatialSemanticWorldChamber(buildOrder,assetRecord,input());
  assert.equal(out.status,SPATIAL_SEMANTIC_WORLD_STATUS.PASS);
  assert.equal(out.evidence.class,'SEMANTIC_WORLD');
  assert.equal(out.evidence.verdict,'PASS');
  assert.equal(out.authority.worldMutationAllowed,false);
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
