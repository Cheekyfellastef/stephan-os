import assert from 'node:assert/strict';
import test from 'node:test';
import { API } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { currentFixture,READ_ONLY_FAKE } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { buildR7OwnerSourceReadbackInput as build, createR7ProtectedOwnerSourceReadback as create,
  r7OwnerPeerFromSourceInput } from './r7ProtectedOwnerSourceReadbackV1.mjs';
import { R7_FIRST_ROOT_INTAKE_AUDIENCE as peerPrefix, R7_FIRST_ROOT_PEER_PURPOSE as peerPurpose,
  R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE as provisioningPrefix,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE as provisioningPurpose } from './r7FirstRootOwnerIntakeProposalV1.mjs';

async function resolve(f, transport=f.fetch, operation='resolve') {
  const prior=globalThis.fetch;
  globalThis.fetch=transport;
  try { const reader=create({githubReadToken:READ_ONLY_FAKE}),wire=build(f.event,f.runtime);
    return operation==='resolve'?await reader.resolve(wire):await reader[operation](wire,f.nativeWindowWire); }
  finally { globalThis.fetch=prior; }
}
function held(out) {
  assert.equal(out.classification,'R7_PROTECTED_OWNER_SOURCE_READBACK_HELD');
  for(const flag of ['sourceEvidenceAuthenticated','protectedCurrentRunAuthenticated',
    'protectedEnvironmentOwnerDecisionAuthenticated','policyAdopted','nativeEndpointAuthenticated',
    'hostExecutionAuthorized','rootEnrollmentAuthorized','tokenIssuanceAuthorized',
    'oidcTokenRequestPerformed','canonicalLeaseReleaseAuthorized']) assert.equal(out[flag],false,flag);
}

test('authenticates actual source/owner/environment records but creates no native or credential authority',async()=>{
  const f=currentFixture(), out=await resolve(f);
  assert.equal(out.classification,'R7_PROTECTED_OWNER_SOURCE_EVIDENCE_AUTHENTICATED_NATIVE_HANDOFF_REQUIRED',JSON.stringify(out));
  assert.equal(out.sourceEvidenceAuthenticated,true);
  assert.equal(out.protectedCurrentRunAuthenticated,true);
  assert.equal(out.protectedEnvironmentOwnerDecisionAuthenticated,true);
  assert.equal(out.runId,'789'); assert.equal(out.runAttempt,'1'); assert.equal(out.jobId,'9006');
  assert.equal(out.tokenIssuanceAuthorized,false); assert.equal(out.nativeEndpointAuthenticated,false);
  assert.equal(out.oidcTokenRequestPerformed,false); assert.equal(out.credentialReturned,false);
  assert.equal(out.rootEnrollmentAuthorized,false); assert.equal(out.canonicalLeaseReleaseAuthorized,false);
  assert.match(out.protectedOwnerBindingSha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(out).includes(READ_ONLY_FAKE),false);
  assert.ok(f.calls.length>20);
  assert.ok(f.calls.every(call=>call.options.method==='GET'&&call.options.redirect==='manual'));
  assert.ok(f.calls.every(call=>!call.url.includes('idtoken')&&!call.url.includes('token.actions')));
  assert.ok(f.calls.filter(call=>!call.url.startsWith(API)).every(call=>!call.options.headers.Authorization));
});

test('trusted-job mapping rejects bot/branch/attempt/endpoint changes and any source-job OIDC permission',()=>{
  const f=currentFixture();
  for(const changes of [
    {GITHUB_ACTOR_ID:'41898282'},{GITHUB_TRIGGERING_ACTOR:'github-actions[bot]'},
    {GITHUB_REF:'refs/heads/untrusted'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_WORKFLOW_SHA:'a'.repeat(40)},
    {GITHUB_JOB:'operator-personal-repository-squash-merge'},{RUNNER_ENVIRONMENT:'self-hosted'},
    {GITHUB_API_URL:'https://other.invalid'},{GITHUB_RUN_ID:'9007199254740992'},
    {ACTIONS_ID_TOKEN_REQUEST_TOKEN:'NEVER_A_REAL_CREDENTIAL'},{ACTIONS_ID_TOKEN_REQUEST_URL:'https://other.invalid'},
  ]) assert.throws(()=>build(f.event,{...f.runtime,...changes}),/^Error: R7_/);
  for(const event of [
    {...f.event,sender:{...f.who,id:41898282}},
    {...f.event,inputs:{...f.event.inputs,authorization_comment_id:'902'}},
    {...f.event,inputs:{...f.event.inputs,arbitrary_native_approval:'true'}},
    {...f.event,inputs:{...f.event.inputs,mode:'user-owned-protected-squash'}},
    {...f.event,inputs:{...f.event.inputs,r7_source_references_json:''}},
  ]) assert.throws(()=>build(event,f.runtime),/^Error: R7_/);
});

test('binds the live run, fixed job and all skipped merge roles, not summary-only workflow names',async()=>{
  const mutations=[
    f=>{f.run.actor={...f.who,id:41898282};},
    f=>{f.run.triggering_actor={...f.who,login:'someone-else'};},
    f=>{f.run.run_attempt=2;}, f=>{f.run.head_sha='e'.repeat(40);},
    f=>{f.run.workflow_id=999;}, f=>{f.run.repository={...f.run.repository,id:123};},
    f=>{f.run.status='completed';f.run.conclusion='success';},
    f=>{f.ownerJob.run_attempt=2;}, f=>{f.ownerJob.head_sha='e'.repeat(40);},
    f=>{f.ownerJob.url=API+'/actions/jobs/9999';},
    f=>{f.ownerJob.runner_group_name='other';}, f=>{f.ownerJob.labels=['self-hosted','ubuntu-latest'];},
    f=>{f.jobs[4].status='in_progress';f.jobs[4].conclusion=null;},
    f=>{f.jobs[4].conclusion='success';}, f=>{f.jobs[4].name=f.jobs[3].name;},
    f=>{f.jobs[4].id=f.jobs[3].id;}, f=>{f.jobs.pop();},
  ];
  for(const mutate of mutations){const f=currentFixture();mutate(f);held(await resolve(f));}
});

test('owner approval is exact, non-bypassable and tied to this environment and first attempt',async()=>{
  const mutations=[
    f=>{f.resources.get(API+'/environments/operator-merge-approval').can_admins_bypass=true;},
    f=>{f.resources.get(API+'/environments/operator-merge-approval').protection_rules[0].reviewers[0].reviewer.id=1;},
    f=>{f.resources.get(API+'/environments/operator-merge-approval').protection_rules=[];},
    f=>{f.resources.get(API+'/environments/operator-merge-approval').deployment_branch_policy.custom_branch_policies=true;},
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].state='rejected';},
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].user={...f.who,type:'Bot'};},
    f=>{f.resources.get(API+'/actions/runs/789/approvals')[0].environments[0].id=92;},
    f=>{f.resources.get(API+'/actions/runs/789/approvals').push(structuredClone(f.resources.get(API+'/actions/runs/789/approvals')[0]));},
  ];
  for(const mutate of mutations){const f=currentFixture();mutate(f);held(await resolve(f));}
});

test('source review alone cannot stand in for source merge, exact package or current compatibility',async()=>{
  const mutations=[
    f=>{f.resources.get(API+'/pulls/3178').merged=false;},
    f=>{f.resources.get(API+'/git/ref/heads/main').object.sha='e'.repeat(40);},
    f=>{f.resources.get(API+'/actions/runs/654').head_sha='e'.repeat(40);},
    f=>{f.resources.get(API+'/actions/runs/123/artifacts?per_page=100&page=1').artifacts[0].digest='sha256:'+'e'.repeat(64);},
  ];
  for(const mutate of mutations){const f=currentFixture();mutate(f);held(await resolve(f));}
});

test('rechecks current authority after the full canonical artifact/package resolver',async()=>{
  const f=currentFixture();let reads=0;
  const out=await resolve(f,async(url,options)=>{
    if(url===API+'/actions/runs/789'&&++reads===2)f.run.triggering_actor={...f.who,id:999};
    return f.fetch(url,options);
  });
  held(out);assert.equal(reads,2);
});

test('redirections, oversized metadata, wrong media and transport failures cannot leak credentials or grant authority',async()=>{
  for(const mode of ['redirect','oversized','html','failure']){
    const f=currentFixture();
    const out=await resolve(f,async(url,options)=>{
      if(url===API+'/actions/runs/789'){
        if(mode==='failure')throw Error('UNTRUSTED_ERROR_'+READ_ONLY_FAKE);
        if(mode==='redirect')return f.response(url,null,{status:302,headers:{location:'https://not-github.invalid'}});
        if(mode==='oversized')return f.response(url,Buffer.from('{}'),{headers:{'content-length':'524289'}});
        return f.response(url,Buffer.from('{}'),{type:'text/html'});
      }
      return f.fetch(url,options);
    });
    held(out);assert.equal(JSON.stringify(out).includes(READ_ONLY_FAKE),false);
  }
});

test('closed canonical input rejects duplicate fields and missing provenance before any network read',async()=>{
  const f=currentFixture(),prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('SHOULD_NOT_RUN');};
  try{
    const resolver=create({githubReadToken:READ_ONLY_FAKE}),wire=build(f.event,f.runtime);
    for(const value of ['x'.repeat(49153),wire.slice(0,-1)+',"permitSha256":"bad"}',JSON.stringify({foo:'bar'})])held(await resolver.resolve(value));
    assert.equal(calls,0);
    assert.throws(()=>create({githubReadToken:READ_ONLY_FAKE,fetch:()=>{}}),/^Error: R7_/);
  }finally{globalThis.fetch=prior;}
});

test('prepares a fingerprint before owner decision without confusing pending or absent issuer jobs with execution',async()=>{
  for(const pendingIssuer of [true,false]){
    const f=currentFixture({stage:'prepare',pendingIssuer});
    f.set('/actions/runs/789/approvals',[]);
    const out=await resolve(f,f.fetch,'preparePeer');
    assert.equal(out.classification,'R7_OWNER_PEER_PREPARED_EXPLICIT_ENROLLMENT_REQUIRED',JSON.stringify(out));
    assert.equal(out.sourceEvidenceAuthenticated,true);assert.equal(out.protectedEnvironmentOwnerDecisionAuthenticated,false);
    assert.equal(out.ownerPeerEnrollmentAuthenticated,false);assert.equal(out.oidcTokenRequestPerformed,false);
    assert.match(out.peerBindingFingerprint,/^[a-f0-9]{64}$/);
    assert.equal(out.peerApprovalComment,'ENROLL_EPHEMERAL_R7_OWNER_POLICY_PEER_ONLY:'+out.peerBindingFingerprint);
    assert.equal(f.calls.some(call=>call.url===API+'/actions/runs/789/approvals'),false);
  }
});

test('enrollment requires the actual owner decision to match the computed complete peer, never generic approval',async()=>{
  for(const suffix of ['missing','space','different','exact']){
    const f=currentFixture(),wire=build(f.event,f.runtime),peer=r7OwnerPeerFromSourceInput(JSON.parse(wire),f.nativeWindowWire);
    const approval=f.resources.get(API+'/actions/runs/789/approvals')[0];
    if(suffix!=='missing')approval.comment=suffix==='exact'?peer.pairing.approvalComment:
      suffix==='space'?peer.pairing.approvalComment+' ':'ENROLL_EPHEMERAL_R7_OWNER_POLICY_PEER_ONLY:'+'f'.repeat(64);
    const out=await resolve(f,f.fetch,'authorizePeer');
    if(suffix!=='exact'){held(out);assert.equal(out.ownerPeerEnrollmentAuthenticated,false);continue;}
    assert.equal(out.classification,'R7_OWNER_EPHEMERAL_PEER_ENROLLMENT_AUTHENTICATED_NATIVE_DECISION_REQUIRED',JSON.stringify(out));
    assert.equal(out.ownerPeerEnrollmentAuthenticated,true);assert.equal(out.peerBindingFingerprint,peer.pairing.fingerprint);
    assert.equal(out.nativeEndpointAuthenticated,false);assert.equal(out.humanOsConsentProven,false);
    assert.equal(out.tokenIssuanceAuthorized,false);assert.equal(out.canonicalLeaseReleaseAuthorized,false);
  }
});

test('inactive-root preparation and owner readback require the exact new purpose without granting native authority',async()=>{
  const preparation=currentFixture({stage:'prepare'});
  preparation.event.inputs.r7_native_challenge_audience=preparation.event.inputs.r7_native_challenge_audience.replace(peerPrefix,provisioningPrefix);
  preparation.set('/actions/runs/789/approvals',[]);
  const prepared=await resolve(preparation,preparation.fetch,'preparePeer');
  assert.equal(prepared.classification,'R7_OWNER_PEER_PREPARED_EXPLICIT_ENROLLMENT_REQUIRED',JSON.stringify(prepared));
  assert.equal(prepared.nativeOperationPurpose,provisioningPurpose);
  assert.equal(prepared.peerApprovalComment,provisioningPurpose+':'+prepared.peerBindingFingerprint);
  assert.equal(prepared.ownerPeerEnrollmentAuthenticated,false);
  assert.equal(preparation.calls.some(call=>call.url===API+'/actions/runs/789/approvals'),false);
  for(const [prefix,wrongPurpose] of [[provisioningPrefix,peerPurpose],[peerPrefix,provisioningPurpose]]){
    for(const exact of [false,true]){
      const f=currentFixture();
      f.event.inputs.r7_native_challenge_audience=f.event.inputs.r7_native_challenge_audience.replace(peerPrefix,prefix);
      const peer=r7OwnerPeerFromSourceInput(JSON.parse(build(f.event,f.runtime)),f.nativeWindowWire);
      f.resources.get(API+'/actions/runs/789/approvals')[0].comment=exact?peer.pairing.approvalComment:wrongPurpose+':'+peer.pairing.fingerprint;
      const out=await resolve(f,f.fetch,'authorizePeer');
      if(!exact){held(out);assert.equal(out.ownerPeerEnrollmentAuthenticated,false);continue;}
      assert.equal(out.ownerPeerEnrollmentAuthenticated,true);
      assert.equal(out.nativeOperationPurpose,peer.pairing.values.purpose);
      for(const flag of ['nativeEndpointAuthenticated','humanOsConsentProven','hostExecutionAuthorized',
        'rootEnrollmentAuthorized','tokenIssuanceAuthorized','canonicalLeaseReleaseAuthorized'])assert.equal(out[flag],false);
    }
  }
});

test('purpose-changing owner approval during authoritative readback invalidates provisioning',async()=>{
  const f=currentFixture();
  f.event.inputs.r7_native_challenge_audience=f.event.inputs.r7_native_challenge_audience.replace(peerPrefix,provisioningPrefix);
  const peer=r7OwnerPeerFromSourceInput(JSON.parse(build(f.event,f.runtime)),f.nativeWindowWire);
  f.resources.get(API+'/actions/runs/789/approvals')[0].comment=peer.pairing.approvalComment;
  let reads=0;
  const out=await resolve(f,async(url,options)=>{
    if(url===API+'/actions/runs/789/approvals'&&++reads===2)
      f.resources.get(url)[0].comment=peerPurpose+':'+peer.pairing.fingerprint;
    return f.fetch(url,options);
  },'authorizePeer');
  held(out);assert.equal(reads,2);
});

test('changing the original native window invalidates an otherwise exact enrollment decision',async()=>{
  const f=currentFixture(),input=JSON.parse(build(f.event,f.runtime));
  const peer=r7OwnerPeerFromSourceInput(input,f.nativeWindowWire);
  f.resources.get(API+'/actions/runs/789/approvals')[0].comment=peer.pairing.approvalComment;
  const window=JSON.parse(f.nativeWindowWire);window.ExpiresAtUtc=new Date(Date.parse(window.ExpiresAtUtc)-1).toISOString();
  f.nativeWindowWire=JSON.stringify(window);
  held(await resolve(f,f.fetch,'authorizePeer'));
});

test('preparation cannot overlap an already executing protected issuer or accept a failed preparation predecessor',async()=>{
  const f=currentFixture({stage:'prepare'});f.ownerJob.status='in_progress';f.ownerJob.started_at=f.prepareJob.started_at;
  held(await resolve(f,f.fetch,'preparePeer'));
  const g=currentFixture();g.prepareJob.conclusion='failure';
  held(await resolve(g));
});

test('expired, aliased and overlong native windows fail before any API operation',async()=>{
  for(const value of ['{}','x'.repeat(161),'{"IssuedAtUtc":"x","IssuedAtUtc":"x","ExpiresAtUtc":"x"}',
    JSON.stringify({IssuedAtUtc:'2001-01-01T00:00:00.000Z',ExpiresAtUtc:'2001-01-01T00:05:00.000Z'})]){
    const f=currentFixture();f.nativeWindowWire=value;
    held(await resolve(f,f.fetch,'authorizePeer'));assert.equal(f.calls.length,0);
  }
});
