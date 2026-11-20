import test from 'node:test';
import assert from 'node:assert/strict';
import { submitGoalThroughStephanosV1 } from './submitGoalTool.js';
import { parseCommand, resolveRoute } from './commandRouter.js';

function twin(){return { schemaVersion:'test-prepared-knowledge-twin',visibleItems:[] };}
const ack={
  state:'DELEGATION_PUBLISHED',
  handoff:{record:{handoffId:'canonical-handoff-2002'}},
  publication:{ok:true},
  canonicalIngress:{ok:true,executiveIngressAcceptance:{
    accepted:true,acceptedGoalIssue:2002,selectedGoal:'#2002',
  }},
  acknowledgement:{ok:true},
};
test('submitGoal rejects malformed, extra and coercing request fields without entering the conveyor',async()=>{
  let calls=0;const bridge=async()=>{calls++;return ack;};
  const cases=[{},null,[],{goalIssue:0},{goalIssue:'-1'},{goalIssue:'2abc'},
    {goalIssue:'0002'},{goalIssue:'#2 #3'},{goalIssue:2002,command:'shell'},
    {goalIssue:{toString:()=> '#2002'}},{goalIssue:1000000000}];
  for(const args of cases) {
    const result=await submitGoalThroughStephanosV1(args,{knowledgeTwin:twin()},{testOnly:true,bridge});
    assert.equal(result.data.state,'HELD');
    assert.equal(result.data.canonicalGoalIngressAccepted,false);
    assert.equal(result.data.workerStartedProven,false);
  }
  assert.equal(calls,0);
});
test('submitGoal requires actual alignment provenance and does not invent authority',async()=>{
  let calls=0;const bridge=async()=>{calls++;return ack;};
  const result=await submitGoalThroughStephanosV1({goalIssue:'#2002'},{},{testOnly:true,bridge});
  assert.equal(result.data.blocker,'OPERATOR_ALIGNMENT_EVIDENCE_REQUIRED');
  assert.equal(calls,0);
  await assert.rejects(()=>submitGoalThroughStephanosV1({goalIssue:2002},{knowledgeTwin:twin()},{bridge}),TypeError);
});
test('submitGoal uses original executive bridge and only records exact acknowledged ingress',async()=>{
  const inputs=[];const bridge=async input=>{inputs.push(input);return ack;};
  const context={knowledgeTwin:twin(),requestId:'one-chat-turn',sharedThreadId:'thread-one',operatorTurnId:'turn-one'};
  const result=await submitGoalThroughStephanosV1({goalIssue:'#2002'},context,{testOnly:true,bridge});
  assert.equal(inputs.length,1);
  assert.equal(inputs[0].requestedGoalIssue,2002);
  assert.equal(inputs[0].knowledgeTwin,context.knowledgeTwin);
  assert.match(inputs[0].prompt,/goal #2002/);
  assert.equal(result.data.canonicalGoalIngressAccepted,true);
  assert.equal(result.data.handoffId,'canonical-handoff-2002');
  assert.equal(result.data.workerClaimProven,false);
  assert.equal(result.data.workerStartedProven,false);
  assert.equal(result.data.controlTowerBuildRequestSubmitted,false);
  assert.equal(result.data.sourceMutationAllowed,false);
});
test('submitGoal cannot promote other goal, absent receipt or handoff into an accepted build',async()=>{
  for(const changed of [
    {canonicalIngress:{...ack.canonicalIngress,executiveIngressAcceptance:{...ack.canonicalIngress.executiveIngressAcceptance,acceptedGoalIssue:2961}}},
    {canonicalIngress:{...ack.canonicalIngress,executiveIngressAcceptance:{...ack.canonicalIngress.executiveIngressAcceptance,selectedGoal:'#2961'}}},
    {acknowledgement:{ok:false}},
    {handoff:{record:{}}},
    {canonicalIngress:{ok:false}},
    {state:'SAFE_HOLD',blocker:'SOVEREIGN_MAINTENANCE_OWNER_BUSY'},
  ]) {
    const outcome={...ack,...changed};
    const result=await submitGoalThroughStephanosV1({goalIssue:2002},
      {knowledgeTwin:twin()},{testOnly:true,bridge:async()=>outcome});
    assert.equal(result.data.canonicalGoalIngressAccepted,false);
    assert.equal(result.data.workerStartedProven,false);
    assert.equal(result.data.duplicateRequestAllowed,false);
  }
});
test('submitGoal records uncertain exception without retry or guessed native proof',async()=>{
  let calls=0;
  const result=await submitGoalThroughStephanosV1({goalIssue:2002},
    {knowledgeTwin:twin()},{testOnly:true,bridge:async()=>{calls++;throw Error('private information');}});
  assert.equal(calls,1);
  assert.equal(result.data.executionOutcomeUncertain,true);
  assert.equal(result.data.blocker,'CANONICAL_GOAL_INGRESS_OUTCOME_UNKNOWN');
  assert.doesNotMatch(JSON.stringify(result),/private information/);
});
test('slash route identifies one exact goal and rejects command injection or absent goal',()=>{
  for(const command of ['/submitgoal #2002','/submitgoal 2002']){
    const d=resolveRoute(parseCommand(command),command);
    assert.equal(d.tool,'submitGoal');assert.deepEqual(d.args,{goalIssue:command.split(' ')[1]});
    assert.equal(d.needsAI,false);
  }
  for(const command of ['/submitgoal','/submitgoal #2002 --force','/submitgoal #2002 #2961',
    '/submitgoal 0','/submitgoal abc','/submitgoal #0002']){
    const d=resolveRoute(parseCommand(command),command);
    assert.equal(d.action,'invalid_command');
  }
});
