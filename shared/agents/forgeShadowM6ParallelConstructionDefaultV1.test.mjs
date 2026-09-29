import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_M6_PARALLEL_DEFAULT_DECISION,
  planForgeM6ParallelConstructionDefault,
} from './forgeShadowM6ParallelConstructionDefaultV1.mjs';
import { FORGE_M5_ACCEPTANCE_SCHEMA, FORGE_M5_ACCEPTANCE_VERDICT } from './forgeShadowM5AcceptanceV1.mjs';

const head='a'.repeat(40);
const tree='b'.repeat(40);
function m5(overrides={}) { return { schemaVersion:FORGE_M5_ACCEPTANCE_SCHEMA, verdict:FORGE_M5_ACCEPTANCE_VERDICT.PASSED, accepted:true, reasons:[], repository:'Cheekyfellastef/stephan-os', canonicalMainHead:head, canonicalMainTree:tree, goalCount:2, acceptedGoalIds:['goal-a','goal-b'], acceptanceDigest:`sha256:${'c'.repeat(64)}`, forgeAuthorityReceiptIds:['receipt-m2','receipt-m3'], protectedGitHubIntegrationRequired:true, nextMilestone:'M6_PARALLEL_CONSTRUCTION_DEFAULT_REVIEW', authority:{ sourceMutation:false, branchMutation:false, publication:false, dispatch:false, merge:false, deployment:false, runtimeMutation:false, forgeExecution:false, podmanExecution:false, credentialAccess:false, arbitraryCommand:false, evidenceOnly:true }, ...overrides }; }
function candidate(overrides={}) { return { candidateId:'candidate-a', taskClass:'SOURCE_BUILD', repository:'Cheekyfellastef/stephan-os', canonicalMainHead:head, canonicalMainTree:tree, resourceScopes:['shared/agents/candidate-a'], operations:['READ_SOURCE','WRITE_SOURCE','RUN_FOCUSED_TESTS'], sourceOnly:true, requiresRuntime:false, requiresDeployment:false, requiresMerge:false, requiresCredentialAccess:false, estimatedParallelGainSeconds:120, proofRefs:['proofs/candidate-a'], ...overrides }; }
function active(overrides={}) { return { active:true, ownerRoute:'OPENCLAW', candidateId:'candidate-other', resourceScopes:['shared/agents/other'], proofRefs:['proofs/active-owner'], ...overrides }; }

test('requires genuine M5 acceptance before Forge can become the default',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:{}, candidate:candidate(), activeDispatch:null });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.M5_REQUIRED);
  assert.equal(out.recommendedRoute,null);
});
test('defaults an eligible positive-gain source candidate to FOUNDRY_FORGE',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(), activeDispatch:null });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.DEFAULT_FORGE);
  assert.equal(out.recommendedRoute,'FOUNDRY_FORGE');
  assert.equal(out.protectedIntegrationRoute,'CHATGPT_GITHUB');
  assert.equal(out.authority.dispatch,false);
});
test('preserves an active owner for the same candidate',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(), activeDispatch:active({candidateId:'candidate-a'}) });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.PRESERVE_ACTIVE_OWNER);
  assert.equal(out.recommendedRoute,'OPENCLAW');
});
test('preserves an active owner on overlapping resource scope',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(), activeDispatch:active({resourceScopes:['shared/agents/candidate-a']}) });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.PRESERVE_ACTIVE_OWNER);
});
test('allows a resource-disjoint active lane to coexist with the Forge recommendation',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(), activeDispatch:active() });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.DEFAULT_FORGE);
  assert.equal(out.activeDispatchDisjoint,true);
});
test('keeps zero-gain work on the GitHub route instead of manufacturing acceleration',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate({estimatedParallelGainSeconds:0}), activeDispatch:null });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.GITHUB_ONLY);
  assert.equal(out.recommendedRoute,'CHATGPT_GITHUB');
});
test('rejects runtime, deployment, merge and credential authority requests',()=>{
  for (const patch of [{requiresRuntime:true},{requiresDeployment:true},{requiresMerge:true},{requiresCredentialAccess:true}]) {
    const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(patch), activeDispatch:null });
    assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID);
  }
});
test('rejects unsupported operations or identity drift',()=>{
  assert.equal(planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate({operations:['EXECUTE_SHELL']}), activeDispatch:null }).decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID);
  assert.equal(planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate({canonicalMainHead:'d'.repeat(40)}), activeDispatch:null }).decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID);
});
test('fails widened input closed and never grants execution authority',()=>{
  const out=planForgeM6ParallelConstructionDefault({ m5Acceptance:m5(), candidate:candidate(), activeDispatch:null, command:'run-forge' });
  assert.equal(out.decision,FORGE_M6_PARALLEL_DEFAULT_DECISION.INVALID);
  assert.equal(out.authority.forgeExecution,false);
  assert.equal(out.authority.sourceMutation,false);
  assert.equal(out.authority.merge,false);
});
