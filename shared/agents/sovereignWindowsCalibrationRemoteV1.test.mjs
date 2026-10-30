import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sovereignWindowsCalibrationManifestV1 } from './sovereignWindowsCalibrationV1.mjs';
import {
  projectWindowsCalibrationForRemoteV1 as project,
  parseWindowsCalibrationRemoteV1 as parse,
  validateWindowsCalibrationRemoteProjectionV1 as validate,
  WINDOWS_CALIBRATION_REMOTE_ACTION as action,
  WINDOWS_CALIBRATION_REMOTE_MARKER as marker,
} from './sovereignWindowsCalibrationRemoteV1.mjs';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const denial = Object.fromEntries(Object.entries(project()).filter(([,v])=>v===false));
function candidate(patch={}) { return {
  status:'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED', reason:'',
  repository:'Cheekyfellastef/stephan-os',sourceHead:head,baseSha:base,
  manifestSha256:sovereignWindowsCalibrationManifestV1().manifestSha256,
  observationsSha256:'c'.repeat(64),modelDigestSha256:'d'.repeat(64),
  completedCases:13,passedCases:13,
  qualification:'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',
  ...denial,...patch,
}; }
function envelope(value=project(candidate()), patch={}) { return {
  ok:true,finalVerdict:'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',proofHash:'e'.repeat(64),
  command:{plan:{processId:action,reviewIdentity:{baseSha:base}}},
  structuredContent:{status:0,stdout:marker+JSON.stringify(value)+'\n'},...patch,
}; }
test('candidate success is bounded, exact-head and never specialist authority',()=>{
  const output=project({...candidate(),reviewerPrincipal:'PRIVATE-SID',reviewerSessionId:'PRIVATE-SESSION',
    missed:['PRIVATE-CASE'],rawTranscript:'PRIVATE-TEXT'});
  assert.equal(validate(output),true);
  assert.deepEqual(parse(envelope(output),head,base),output);
  assert.doesNotMatch(JSON.stringify(output),/PRIVATE/);
  for(const key of Object.keys(denial)) assert.equal(output[key],false);
});
test('forged success, authority flags and incomplete exams fail closed',()=>{
  for(const patch of [{passedCases:12},{completedCases:12},{modelDigestSha256:''},
    {manifestSha256:'f'.repeat(64)},{observationsSha256:''},{baseSha:head},
    ...Object.keys(denial).map(key=>({[key]:true}))]) {
    assert.equal(project(candidate(patch)).status,'WINDOWS_CALIBRATION_HELD');
  }
  assert.equal(parse(envelope(),base,base),null);
  assert.equal(parse(envelope(undefined,{proofHash:''}),head,base),null);
  assert.equal(parse(envelope(undefined,{ok:false}),head,base),null);
  assert.equal(parse(envelope(undefined,{command:{plan:{processId:'other'}}}),head,base),null);
  assert.equal(parse(envelope(undefined,{structuredContent:{status:2,stdout:envelope().structuredContent.stdout}}),head,base),null);
});
test('native PASS must bind the authenticated request base as well as its head',()=>{
  const good=envelope();
  assert.equal(parse(good,head,base)?.baseSha,base,base);
  for(const requested of [head,'c'.repeat(40),'',null,undefined,[base],{}]) {
    const changed=envelope(undefined,{command:{plan:{
      processId:action,reviewIdentity:{baseSha:requested},
    }}});
    assert.equal(parse(changed,head,base),null,'unbound or different request base');
  }
  assert.equal(parse(envelope(undefined,{
    command:{plan:{processId:action}},
  }),head,base),null,'missing review identity cannot supply expected base');
  assert.equal(parse(envelope(project(candidate({baseSha:'c'.repeat(40)}))),head,base),null,
    'valid but substituted result base is not the requested source pair');
});
test('held native prerequisites retain their typed result without borrowing completion proof',()=>{
  const value=project({status:'WINDOWS_CALIBRATION_HELD',reason:'EXACT_LOCAL_SOURCE_UNPROVEN',...denial});
  const failed=envelope(value,{ok:false,finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    proofHash:undefined,structuredContent:{status:2,stdout:marker+JSON.stringify(value)}});
  assert.equal(parse(failed,head,base)?.reason,'EXACT_LOCAL_SOURCE_UNPROVEN');
  assert.equal(parse(envelope(value),head,base),null);
});
test('private and unbounded transport payloads cannot enter public receipts',()=>{
  for(const patch of [{secret:'PRIVATE'},{reason:'C:\\PRIVATE\\key'},
    {sourceHead:['a'.repeat(40)]},{baseSha:'PRIVATE'}, {modelDigestSha256:'PRIVATE'},
    {completedCases:14},{passedCases:99},{leaseReleaseAuthority:true}]) {
    assert.equal(validate({...project(candidate()),...patch}),false);
  }
  for(const stdout of ['x\n'+envelope().structuredContent.stdout,
    envelope().structuredContent.stdout+marker+'{}', 'x'.repeat(4097),marker+'not-json']) {
    assert.equal(parse(envelope(undefined,{structuredContent:{status:0,stdout}}),head,base),null);
  }
});
test('fixed action has no caller command and fits the existing transport timeout',()=>{
  const registry=readFileSync(new URL('./sovereignCommanderV1.mjs',import.meta.url),'utf8');
  const mcp=readFileSync(new URL('../../scripts/sovereign-commander-mcp.mjs',import.meta.url),'utf8');
  const remote=readFileSync(new URL('./sovereignCommanderRemoteMailboxV1.mjs',import.meta.url),'utf8');
  assert.match(registry,/'sovereign-windows-reviewer-calibration':[\s\S]*?--commander-once[\s\S]*?timeoutMs: 180_000/);
  assert.ok(mcp.includes("'"+action+"'"));
  assert.ok(remote.includes("'"+action+"'"));
  assert.match(remote,/parseWindowsCalibrationRemoteV1/);
});
