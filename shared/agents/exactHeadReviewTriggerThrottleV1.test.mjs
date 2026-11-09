import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  admitExactHeadReviewTriggerV1 as admit,
  EXACT_HEAD_REVIEW_THROTTLE_SCHEMA,
  TRUSTED_INDEPENDENT_SECURITY_WORKFLOW_ID,
} from './exactHeadReviewTriggerThrottleV1.mjs';
import { EXACT_HEAD_DISCOVERY_WINDOW_MS } from './exactHeadReviewDiscoveryWindowV1.mjs';

const root=Date.parse('2026-10-12T14:30:00.000Z');
const trusted=()=>({
  workflow_run:{
    id:38262391491,workflow_id:TRUSTED_INDEPENDENT_SECURITY_WORKFLOW_ID,
    name:'Independent Merge Security Review',status:'completed',conclusion:'success',
  }
});
test('scheduled scans make one bounded attempt per 15-minute bucket, not every 5 minutes',()=>{
  assert.equal(EXACT_HEAD_DISCOVERY_WINDOW_MS,15*60_000);
  let tries=0;
  for(let i=0;i<15;i+=5){
    const v=admit({eventName:'schedule',planOnly:true,nowMs:root+i*60_000});
    if(v.allowDiscovery)tries++;
    assert.equal(v.apiCallsAllowed,v.allowDiscovery);
    assert.equal(v.mergeAuthority,false);
    assert.equal(v.reviewAuthority,false);
  }
  assert.equal(tries,1);
  assert.equal(admit({eventName:'schedule',planOnly:true,nowMs:root+15*60_000}).allowDiscovery,true);
  assert.equal(admit({eventName:'schedule',planOnly:true,nowMs:NaN}).allowDiscovery,false);
  assert.equal(admit({eventName:'schedule',planOnly:true,nowMs:-1}).allowDiscovery,false);
});

test('repeated ordinary CI completions never enter GitHub PR-estate discovery',()=>{
  for(const name of [
    'OpenClaw GitHub Operator','PR Clean Guard','Build Stephanos UI',
    'Battle Bridge Publisher Proof','Codex Dispatch Queue Proof'
  ]){
    const v=admit({
      eventName:'workflow_run',planOnly:true,event:{
        workflow_run:{...trusted().workflow_run,name,workflow_id:318073449}
      },
    });
    assert.equal(v.allowDiscovery,false);
    assert.equal(v.reason,'NON_QUALIFIED_WORKFLOW_COMPLETION');
  }
});
test('only completed qualified independent review wakes immediate authenticated discovery',()=>{
  const good=admit({eventName:'workflow_run',planOnly:true,event:trusted()});
  assert.equal(good.allowDiscovery,true);
  assert.equal(good.reason,'QUALIFIED_INDEPENDENT_REVIEW_EVENT');
  assert.equal(good.reviewAuthority,false);
  assert.equal(good.mergeAuthority,false);
  for(const data of [
    {},
    {workflow_run:{...trusted().workflow_run,name:'different'}},
    {workflow_run:{...trusted().workflow_run,workflow_id:318073449}},
    {workflow_run:{...trusted().workflow_run,status:'in_progress'}},
    {workflow_run:{...trusted().workflow_run,conclusion:'failure'}},
    {workflow_run:{...trusted().workflow_run,id:0}},
  ]){
    assert.equal(admit({eventName:'workflow_run',planOnly:true,event:data}).allowDiscovery,false);
  }
});
test('manual owner PR requests and direct review execution are not throttled',()=>{
  for(const eventName of ['workflow_dispatch','issue_comment','pull_request']){
    const v=admit({eventName,planOnly:true,nowMs:root+10*60_000});
    assert.equal(v.allowDiscovery,true);
    assert.equal(v.mergeAuthority,false);
  }
  assert.equal(admit({eventName:'schedule',planOnly:true,manuallyRequestedPr:true,nowMs:root+10*60_000}).allowDiscovery,true);
  assert.equal(admit({eventName:'workflow_run',planOnly:false,event:{}}).allowDiscovery,true);
});
test('GitHub workflows and protected merge gates remain entirely unchanged by the throttle',()=>{
  const entry=readFileSync(new URL('../../scripts/exact-head-review-dispatch.mjs',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../../.github/workflows/exact-head-review-dispatch.yml',import.meta.url),'utf8');
  const check=readFileSync(new URL('../../.github/workflows/stephanos-exact-head-review.yml',import.meta.url),'utf8');
  assert.ok(entry.indexOf('const trigger = admitExactHeadReviewTriggerV1(')>0);
  assert.ok(entry.indexOf('if (!trigger.allowDiscovery)')<entry.indexOf('const contexts = await contextLoader('));
  assert.ok(entry.indexOf("appendOutput('targets', '[]')")<entry.indexOf('const contexts = await contextLoader('));
  assert.equal(EXACT_HEAD_REVIEW_THROTTLE_SCHEMA,'stephanos.exact-head-review-trigger-throttle.v1');
  assert.match(workflow,/cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow,/max-parallel: 4/);
  assert.match(workflow,/name: Check out trusted default-branch coordinator/);
  assert.match(check,/name: Resolve immutable review identity/);
  assert.match(check,/name: Admit exact current-main review target/);
});
