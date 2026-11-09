import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROTATION_V2_STATES, ROTATION_V2_OPERATIONS, ROTATION_V2_STRUCTURAL_MATRIX,
  classifySaturatedMailboxRotationPhaseV2,
} from './canonicalMailboxSaturatedPhaseModelV2.mjs';
const PREP='a'.repeat(40), PREPTREE='b'.repeat(40), CLOSURE='c'.repeat(64);
const MERGED='d'.repeat(40), MERGETREE='e'.repeat(40);
const ACTIVATION='f'.repeat(40), OLD='1'.repeat(40), ACTTREE='2'.repeat(40);
function fixture(state,operation) {
  const pre = state === 'PRE_MERGE' || state === 'CANCELLED';
  const installed = state === 'MERGED_NOT_ADOPTED' ? PREP : pre ? PREP : MERGED;
  const installedTree = state === 'MERGED_NOT_ADOPTED' ? PREPTREE : pre ? PREPTREE : MERGETREE;
  return {
    state,operation,
    source: {
      protectedMainHead: pre ? PREP : MERGED,
      protectedMainTreeSha: pre ? PREPTREE : MERGETREE,
      installedHead: installed, installedTreeSha: installedTree,
      installedClosureSha256: CLOSURE,sourceRole: state === 'VERIFIED' || state === 'ADOPTED_NOT_VERIFIED' ? 'ADOPTED' : 'PREPARATION',
    },
    activation:{headSha:ACTIVATION,baseSha:pre?PREP:OLD,treeSha:ACTTREE,
      mergeCommitSha:pre?null:MERGED,mergeTreeSha:pre?null:MERGETREE,
      state:pre?'OPEN':'MERGED'},
    epoch:{predecessorIssue:3149,successorIssue:3258,
      activeIssue:state==='VERIFIED'||state==='ADOPTED_NOT_VERIFIED'?3258:3149,
      retiredPredecessor:state==='VERIFIED'||state==='ADOPTED_NOT_VERIFIED'},
    preparation:{headSha:PREP,treeSha:PREPTREE,closureSha256:CLOSURE,
      originalFrozenAuthenticated:!pre},
  };
}
function validate(r){
  for(const flag of ['consentAuthenticated','nativeProducerQualified','signedNativeEvidenceVerified','nativeExecutionAuthorized','sourceMutationAuthorized','protectedMergeAuthorized','freezeCertified','epochAdoptionAuthorized'])
    assert.equal(r[flag],false,`${flag} must never be granted by a structural model`);
}
for (const state of ROTATION_V2_STATES) for(const operation of ROTATION_V2_OPERATIONS){
  test(`complete 5x5 rotation matrix: ${state}/${operation}`,()=>{
    const wanted=ROTATION_V2_STRUCTURAL_MATRIX[state][operation];
    const result=classifySaturatedMailboxRotationPhaseV2(fixture(state,operation));
    if(wanted==='DENY'){
      assert.equal(result.ok,false);assert.equal(result.blocker,'ROTATION_OPERATION_DENIED_FOR_PHASE');
    }else{
      assert.equal(result.ok,true);assert.equal(result.mode,wanted);
    }
    validate(result);
  });
}
const invalid=[
 ['unknown phase', x=>x.state='PREPARATION'],
 ['unknown operation',x=>x.operation='REPLAY'],
 ['unknown extra input',x=>x.untrusted=true],
 ['extra source field',x=>x.source.signer='caller'],
 ['unknown predecessor epoch',x=>x.epoch.predecessorIssue=2808],
 ['swapped successor',x=>x.epoch.successorIssue=3149],
 ['forged active issue',x=>x.epoch.activeIssue=3258],
 ['forged retired state',x=>x.epoch.retiredPredecessor=true],
 ['moved protected main after merge',x=>x.source.protectedMainHead='3'.repeat(40)],
 ['changed merged tree',x=>x.source.protectedMainTreeSha='3'.repeat(40)],
 ['changed preparation checkout',x=>x.source.installedHead='4'.repeat(40)],
 ['changed preparation tree',x=>x.source.installedTreeSha='4'.repeat(40)],
 ['changed preparation closure',x=>x.source.installedClosureSha256='7'.repeat(64)],
 ['missing historical FROZEN signature',x=>x.preparation.originalFrozenAuthenticated=false],
 ['false adopted role',x=>x.source.sourceRole='ADOPTED'],
 ['stray merged source identity',x=>x.activation.mergeCommitSha='4'.repeat(40)],
 ['missing merge tree identity',x=>x.activation.mergeTreeSha=null],
 ['unknown activation state',x=>x.activation.state='DRAFT'],
 ['invalid sha',x=>x.source.protectedMainHead='z'.repeat(40)],
 ['unsafe closure',x=>x.source.installedClosureSha256='bad'],
 ['accessor injection',x=>Object.defineProperty(x.source,'sourceRole',{get(){return 'PREPARATION'}, configurable:true})],
 ['symbol injection',x=>x.source[Symbol.for('stephanos-forged')]=true],
];
for(const [name,mutate] of invalid)test(`merged-but-not-adopted STATUS refuses ${name}`,()=>{
  const x=fixture('MERGED_NOT_ADOPTED','STATUS');mutate(x);
  const r=classifySaturatedMailboxRotationPhaseV2(x);
  assert.equal(r.ok,false,JSON.stringify(r));validate(r);
});
test('only STATUS is a structural candidate in merged-but-not-adopted',()=>{
  for(const op of ROTATION_V2_OPERATIONS){const r=classifySaturatedMailboxRotationPhaseV2(fixture('MERGED_NOT_ADOPTED',op));
    assert.equal(r.structuralCandidate,op==='STATUS');validate(r);}
});
test('no prototype/object accessor injection can confer a positive phase',()=>{
  const malicious=Object.create({state:'MERGED_NOT_ADOPTED'}); malicious.operation='STATUS';
  let result=classifySaturatedMailboxRotationPhaseV2(malicious);
  assert.equal(result.ok,false);validate(result);
});
test('all matrix rows and columns are exact and frozen',()=>{
  assert.equal(ROTATION_V2_STATES.length,5);assert.equal(ROTATION_V2_OPERATIONS.length,5);
  assert.deepEqual(Object.keys(ROTATION_V2_STRUCTURAL_MATRIX),ROTATION_V2_STATES);
  for(const state of ROTATION_V2_STATES){
    assert.deepEqual(Object.keys(ROTATION_V2_STRUCTURAL_MATRIX[state]),ROTATION_V2_OPERATIONS);
    assert.equal(Object.isFrozen(ROTATION_V2_STRUCTURAL_MATRIX[state]),true);
  }
});
