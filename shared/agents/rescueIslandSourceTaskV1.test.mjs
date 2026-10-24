import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRescueIslandSourceTaskV1 as inspect,RESCUE_ISLAND_SOURCE_TASK_SCHEMA,
  RESCUE_ISLAND_SOURCE_PLANS} from './rescueIslandSourceTaskV1.mjs';
const now='2026-10-24T17:30:00Z';
function fixture(){
  const content={scopeId:'ISLAND_BUILDERS_V1',changes:[
    {path:'shared/agents/rescueIslandSecondLaneV1.mjs',beforeBlob:null,content:'export const lane = 2;\n'},
    {path:'shared/agents/rescueIslandSecondLaneV1.test.mjs',beforeBlob:null,content:'// exact approved tests\n'},
  ]};
  return {schemaVersion:RESCUE_ISLAND_SOURCE_TASK_SCHEMA,repository:'Cheekyfellastef/stephan-os',
    issueNumber:3109,issueTitle:RESCUE_ISLAND_SOURCE_PLANS.ISLAND_BUILDERS_V1.issueTitle,
    taskId:'second-lane-first-source',workerId:'rescue-island-01',baseHead:'a'.repeat(40),
    targetPath:content.changes[0].path,content:JSON.stringify(content),
    testPath:'shared/agents/rescueIslandPreflightV1.test.mjs',
    approvalSource:'EXTERNAL_OWNER_ATTESTATION_REQUIRED',expiresAtUtc:'2026-10-24T17:35:00Z'};
}
const mutate=(task,fn)=>{const m=JSON.parse(task.content);fn(m);task.content=JSON.stringify(m);return task;};
test('finite source plan binds exact owner, scope, before-blobs and fixed tests without authority',()=>{
  const r=inspect(fixture(),now);assert.equal(r.valid,true);assert.equal(r.executionAuthority,false);
  assert.equal(r.writes.length,2);assert.ok(r.testPaths.includes('shared/agents/rescueIslandSecondLaneV1.test.mjs'));
  assert.ok(Object.isFrozen(r.writes));assert.ok(Object.isFrozen(r.writes[0]));
});
test('source plan rejects arbitrary paths, runner inputs, duplicate and widened changes',()=>{
  for(const path of ['../evil.mjs','C:/evil.mjs','shared/agents/durableFlywheelControllerVNext.mjs',
    '.git/config','scripts/windows/run-vr-resource-governor.ps1','shared/runtime/unregistered.mjs']){
    assert.equal(inspect(mutate(fixture(),m=>m.changes[0].path=path),now).valid,false,path);
  }
  for(const change of [{runner:'arbitrary'}, {beforeBlob:'bad'}, {content:''}, {content:'\0'}]){
    assert.equal(inspect(mutate(fixture(),m=>Object.assign(m.changes[0],change)),now).valid,false);
  }
  assert.equal(inspect(mutate(fixture(),m=>m.changes.push(m.changes[0])),now).valid,false);
});
test('source task retains exact clock, head, worker and owner identity',()=>{
  for(const patch of [{workerId:'rescue-island-02'},{baseHead:'main'},{issueNumber:2961},
    {issueTitle:'invented owner'},{expiresAtUtc:now},{testPath:'arbitrary.test.mjs'},
    {schemaVersion:'stephanos.rescue-island-pilot-task.v1'},{approvalSource:'operator-approved'}])
    assert.equal(inspect({...fixture(),...patch},now).valid,false,JSON.stringify(patch));
});
test('Seed source proposals retain Seed owner and do not activate its disabled runtime',()=>{
  const t=fixture();t.issueNumber=3096;t.issueTitle=RESCUE_ISLAND_SOURCE_PLANS.SEED_FORGE_V1.issueTitle;
  t.targetPath='shared/runtime/seedCanopyParallelResourceV1.mjs';
  t.content=JSON.stringify({scopeId:'SEED_FORGE_V1',changes:[{path:t.targetPath,beforeBlob:'b'.repeat(40),
    content:'export const executionEnabled = false;\n'}]});
  const r=inspect(t,now);assert.equal(r.valid,true);assert.equal(r.issueNumber,3096);
  assert.ok(r.testPaths.includes('shared/runtime/seedCanopyParallelResourceV1.test.mjs'));
  assert.equal(r.executionAuthority,false);
});
test('source task refuses accessor authority, unknown fields and prototype plans',()=>{
  const t=fixture();Object.defineProperty(t,'content',{get(){assert.fail('getter invoked');}});
  assert.equal(inspect(t,now).valid,false);
  assert.equal(inspect({...fixture(),approvalAuthenticated:true},now).valid,false);
  assert.equal(inspect(mutate(fixture(),m=>m.scopeId='__proto__'),now).valid,false);
  assert.equal(inspect(mutate(fixture(),m=>m.changes.reverse()),now).valid,false);
});

import {createHash} from 'node:crypto';
import {inspectRescueIslandSupervisedOwnerIntakeV1 as intake} from './rescueIslandPilotOwnerIntakeV1.mjs';

test('source patch plan permits only exact before/after strings and a bound full-content digest',()=>{
  const task=fixture();
  const change={path:task.targetPath,beforeBlob:'b'.repeat(40),afterSha256:'c'.repeat(64),
    edits:[{before:'const lane=1;',after:'const lane=2;'}]};
  task.content=JSON.stringify({scopeId:'ISLAND_BUILDERS_V1',changes:[change]});
  const result=inspect(task,now);assert.equal(result.valid,true);
  assert.ok(Object.isFrozen(result.writes[0].edits[0]));
  for(const patch of [{beforeBlob:null},{afterSha256:'bad'},{edits:[{before:'',after:'x'}]},
    {edits:[{before:'x',after:'y',runner:'arbitrary'}]},{content:'both formats'}]){
    const bad={...task,content:JSON.stringify({scopeId:'ISLAND_BUILDERS_V1',changes:[{...change,...patch}]})};
    assert.equal(inspect(bad,now).valid,false);
  }
});
test('Seed proposal consent must come from the actual Seed issue and explicit source grammar',()=>{
  const task=fixture();task.issueNumber=3096;task.issueTitle=RESCUE_ISLAND_SOURCE_PLANS.SEED_FORGE_V1.issueTitle;
  task.targetPath='shared/runtime/seedCanopyParallelResourceV1.mjs';
  task.content=JSON.stringify({scopeId:'SEED_FORGE_V1',changes:[{path:task.targetPath,beforeBlob:'b'.repeat(40),content:'export const held = true;\n'}]});
  const issueUrl='https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3096',commentId=6380000055;
  const comment={id:commentId,url:'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/'+commentId,
    issue_url:issueUrl,user:{login:'Cheekyfellastef',type:'User',id:267490109},author_association:'OWNER',
    created_at:now,updated_at:now,body:'/rescue-island-01 supervised-source-cooperative '+task.baseHead+' '+task.taskId+' '+createHash('sha256').update(task.content).digest('hex')};
  const facts={task,issue:{number:3096,title:task.issueTitle,state:'open',url:issueUrl},
    comment,commentId,mainHead:task.baseHead,nowUtc:now};
  const admitted=intake(facts);
  assert.equal(admitted.disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(admitted.issueNumber,3096);assert.equal(admitted.approvalAuthenticated,false);
  assert.equal(intake({...facts,comment:{...comment,issue_url:issueUrl.replace('3096','3109')}}).disposition,'HELD');
  assert.equal(intake({...facts,comment:{...comment,body:comment.body.replace('supervised-source-cooperative','supervised-cooperative')}}).disposition,'HELD');
});
