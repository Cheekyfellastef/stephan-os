import assert from 'node:assert/strict';
import test from 'node:test';
import { createR7FirstRootSourceEvidenceResolver as create } from './r7FirstRootSourceEvidenceResolverV1.mjs';
import { inspectR7UntrustedSourcePackage as inspect } from './r7UntrustedSourcePackageV1.mjs';
import { fixture,API,STORAGE,hash,zip } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
import { otherRecipientSpkiBase64 } from './r7FirstRootSourceEvidenceResolverV1.fixture.mjs';
const TOKEN='FIXTURE_TOKEN_NEVER_AUTHENTIC';
async function run(f,mutateFetch=null,input=f.input()){
  const original=globalThis.fetch;
  try{globalThis.fetch=mutateFetch??f.fetch;return await create({githubReadToken:TOKEN}).resolve(input);}
  finally{globalThis.fetch=original;}
}
function noAuthority(r){for(const k of ['policyAdopted','sourceMergeAuthorized','hostExecutionAuthorized','humanOsConsentProven','executorAdmitted','rootEnrollmentAuthorized',
  'tokenIssuanceAuthorized','independentSignatureProven','canonicalLeaseReleaseAuthorized','approvalCardCreated','nativeChallengeFreshnessAuthenticated'])assert.equal(r[k],false,k);}
function rejected(r){assert.equal(r.sourceAdoptionAuthenticated,false);assert.equal(r.reviewArtifactAuthenticated,false);noAuthority(r);}
test('offline positive exact-main fixture validates genuine-shaped source records and bytes, granting zero host authority',async()=>{
  const f=fixture(),r=await run(f);assert.equal(r.reviewArtifactAuthenticated,true,JSON.stringify(r));assert.equal(r.nativeImageProvenanceAuthenticated,true);
  assert.equal(r.protectedSourceApprovalAuthenticated,true);assert.equal(r.sourceMergeReadbackAuthenticated,true);assert.equal(r.sourceAdoptionAuthenticated,true);noAuthority(r);
  assert.ok(r.blockers.includes('R7_FIRST_ROOT_POLICY_ADOPTION_NOT_PROVEN'));
  for(const call of f.calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'manual');
    if(call.url.startsWith(API))assert.equal(call.options.headers.Authorization,'Bearer '+TOKEN);
    else assert.equal(Object.keys(call.options.headers).some(x=>x.toLowerCase()==='authorization'),false);}
  assert.equal(JSON.stringify(r).includes(TOKEN),false);assert.equal(JSON.stringify(r).includes('sig='),false);
});
test('real main movement reports historical completion/ancestry but holds current compatibility',async()=>{
  const r=await run(fixture({moved:true}));assert.equal(r.reviewArtifactAuthenticated,true,JSON.stringify(r));assert.equal(r.historicalSourceCompletionAuthenticated,true);
  assert.equal(r.forwardMainAncestryObserved,true);assert.equal(r.sourceAdoptionAuthenticated,false);assert.ok(r.blockers.includes('R7_POST_MERGE_CURRENT_COMPATIBILITY_NOT_PROVEN'));noAuthority(r);
});
test('unmerged source can have package/review provenance without source adoption',async()=>{
  const r=await run(fixture({merged:false}));assert.equal(r.reviewArtifactAuthenticated,true,JSON.stringify(r));assert.equal(r.nativeImageProvenanceAuthenticated,true);
  assert.equal(r.protectedSourceApprovalAuthenticated,false);assert.equal(r.sourceAdoptionAuthenticated,false);assert.ok(r.blockers.includes('R7_EXACT_SOURCE_MERGE_NOT_OBSERVED'));noAuthority(r);
});
test('missing proposed locators preserve authenticated review and explicitly hold downstream proof',async()=>{
  const f=fixture(),i=f.input();delete i.referencesWire;delete i.referencesSha256;const r=await run(f,null,i);
  assert.equal(r.reviewArtifactAuthenticated,true,JSON.stringify(r));assert.equal(r.sourceAdoptionAuthenticated,false);assert.ok(r.blockers.includes('R7_PROPOSED_SOURCE_PROVENANCE_REFERENCES_MISSING'));noAuthority(r);
});
test('substituted run/attempt/head/base/job/artifact/repository/approval/comment/native records fail closed',async()=>{
  const cases=[
    ['',x=>x.id++],['/pulls/3178',x=>x.head.sha='e'.repeat(40)],['/git/commits/'+'a'.repeat(40),x=>x.tree.sha='e'.repeat(40)],
    ['/actions/runs/123',x=>x.run_attempt++],['/actions/runs/123',x=>x.pull_requests[0].base.sha='e'.repeat(40)],
    ['/actions/workflows/independent-merge-security-review.yml',x=>x.path='other.yml'],
    ['/actions/runs/123/attempts/2/jobs?filter=all&per_page=100&page=1',x=>x.jobs[0].run_id++],
    ['/actions/runs/123/artifacts?per_page=100&page=1',x=>x.artifacts[0].expired=true],
    ['/actions/runs/123/artifacts?per_page=100&page=1',x=>x.artifacts[0].size_in_bytes++],
    ['/actions/runs/654',x=>x.head_sha='e'.repeat(40)],['/actions/runs/654',x=>x.run_attempt++],
    ['/actions/runs/654/attempts/1/jobs?filter=all&per_page=100&page=1',x=>x.jobs[0].id++],
    ['/actions/runs/654/artifacts?per_page=100&page=1',x=>x.artifacts[0].digest='sha256:'+'f'.repeat(64)],
    ['/actions/runs/654/artifacts?per_page=100&page=1',x=>x.artifacts[0].created_at='2000-01-01T00:00:00Z'],
    ['/actions/runs/321',x=>x.run_attempt=2],['/actions/runs/321',x=>x.display_title='R7 first-root owner policy intake forged'],
    ['/actions/runs/321/approvals',x=>x[0].user.id++],['/actions/runs/321/approvals',x=>x[0].state='rejected'],
    ['/environments/operator-merge-approval',x=>x.can_admins_bypass=true],['/issues/comments/901',x=>x.performed_via_github_app.id++],
    ['/issues/comments/901',x=>x.updated_at='2099-01-01T00:00:00Z'],['/issues/comments/902',x=>x.user.id++],
    ['/git/commits/'+'d'.repeat(40),x=>x.parents[0].sha='e'.repeat(40)],
  ];
  for(const [suffix,mutate] of cases){const f=fixture();mutate(f.resources.get(API+suffix));const r=await run(f);rejected(r);assert.ok(r.blockers.length,suffix);}
});
test('record movement during hydration invalidates previously good snapshots',async()=>{
  for(const target of ['/git/ref/heads/main','/actions/runs/123','/issues/comments/902','/actions/runs/654']) {
    const f=fixture();let seen=0;const wrapper=async(url,opt)=>{if(url===API+target&&++seen===2){const obj=f.resources.get(url);if(obj.object)obj.object.sha='e'.repeat(40);else if(obj.body)obj.updated_at='2099-01-01T00:00:00Z';else obj.run_attempt++;}return f.fetch(url,opt);};
    rejected(await run(f,wrapper));
  }
});
test('metadata pages cannot silently truncate, duplicate or exceed fixed budget',async()=>{
  for(const mutate of [x=>x.total_count=101,x=>x.total_count=401,x=>{x.jobs.push(x.jobs[0]);x.total_count=2;}]) {
    const f=fixture();mutate(f.resources.get(API+'/actions/runs/123/attempts/2/jobs?filter=all&per_page=100&page=1'));rejected(await run(f));
  }
});
test('GitHub redirects, bad origins, oversized bodies, bad JSON and thrown credential strings are sanitized',async()=>{
  const variants=[{url:'https://attacker.example/x'},{redirected:true},{status:302},{body:Buffer.from('{')},
    {body:Buffer.alloc(512*1024+1,120)},{throw:TOKEN+' https://attacker.example/?sig=secret'}];
  for(const v of variants){const f=fixture(),wrapper=async(url,opt)=>{if(url!==API)return f.fetch(url,opt);if(v.throw)throw new Error(v.throw);
      return f.response(v.url??url,v.body??Buffer.from(JSON.stringify(f.resources.get(url))),v);};
    const r=await run(f,wrapper);rejected(r);assert.equal(JSON.stringify(r).includes(TOKEN),false);assert.equal(JSON.stringify(r).includes('attacker'),false);}
});
test('artifact storage never receives bearer and refuses redirected or malicious storage host',async()=>{
  for(const wrongLocation of [true,false]){const f=fixture();const wrapper=async(url,opt)=>{
      if(wrongLocation&&url===API+'/actions/artifacts/987/zip')return f.response(url,null,{status:302,headers:{location:'https://attacker.example/archive.zip'}});
      if(!wrongLocation&&url.startsWith('https://productionresultssa17.')){const response=await f.fetch(url,opt);Object.defineProperty(response,'redirected',{value:true,configurable:true});return response;}
      return f.fetch(url,opt);};rejected(await run(f,wrapper));assert.equal(f.calls.some(x=>x.url.startsWith('https://attacker')),false);}
});
test('packet/reference substitution, unsafe IDs, forged extra authority or expiration cannot trigger reads',async()=>{
  for(const mutate of [f=>{f.packet.review.runId='18446744073709551615';},f=>{f.packet.expiresAtUtc=f.packet.issuedAtUtc;},
    f=>{f.references.sourceCompletion.hostExecutionAuthorized=true;},f=>{f.references.nativePackage.artifactId='1e3';}]) {
    const f=fixture();mutate(f);const r=await run(f);rejected(r);assert.equal(f.calls.length,0);
  }
});
test('package bytes support BOM/CRLF, notices, deflate/data descriptors and refuse dangerous entries/manifests',()=>{
  for(const opts of [{},{bom:false},{compressed:true,descriptor:true}]){const f=fixture(opts);const r=inspect(f.nativeZip,f.packet.candidate);assert.equal(r.entryCount,3);noAuthority({...r,
    policyAdopted:false,sourceMergeAuthorized:false,humanOsConsentProven:false,executorAdmitted:false,tokenIssuanceAuthorized:false,approvalCardCreated:false,nativeChallengeFreshnessAuthenticated:false});}
  const f=fixture();const changes=[entries=>entries.push(['../escape.exe','x']),entries=>entries[2][0]='evil.dll',entries=>entries.push(entries[0]),
    entries=>{entries[1][1]=Buffer.from(entries[1][1].toString().replace('originalLeaseReleased=false','originalLeaseReleased=true'));},
    entries=>{entries[1][1]=Buffer.concat([entries[1][1],Buffer.from('imageSha256='+'a'.repeat(64)+'\r\n')]);}];
  for(const change of changes){const entries=f.packageEntries.map(([n,b])=>[n,Buffer.from(b)]);change(entries);const bytes=zip(entries);const expected={...f.packet.candidate,bundleSha256:hash(bytes),manifestSha256:hash(entries[1][1])};assert.throws(()=>inspect(bytes,expected));}
  const bytes=Buffer.from(f.nativeZip);bytes[70]^=1;assert.throws(()=>inspect(bytes,{...f.packet.candidate,bundleSha256:hash(bytes)}));
});
test('factory cannot accept transport/header/URL injection or discover a credential implicitly',()=>{
  for(const options of [{},{githubReadToken:'bad\r\nheader'},{githubReadToken:TOKEN,fetch:()=>{}},{githubReadToken:TOKEN,url:'https://attacker'}])assert.throws(()=>create(options));
});
test('all manifest source/authority fields bind exact raw bytes and fail closed after recomputed digests',()=>{
  const f=fixture(),original=f.packageEntries[1][1].toString('utf8');
  const names=original.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split('=')[0]);
  for(const name of names){const entries=f.packageEntries.map(([n,b])=>[n,Buffer.from(b)]);
    entries[1][1]=Buffer.from(original.replace(new RegExp('('+name+'=)[^\\r\\n]*'),'$1FORGED'));
    const bytes=zip(entries);assert.throws(()=>inspect(bytes,{...f.packet.candidate,bundleSha256:hash(bytes),manifestSha256:hash(entries[1][1])}),name);}
});
test('structural ZIP mutations are rejected even with a matching archive hash',()=>{
  const f=fixture({compressed:true,descriptor:true}),end=f.nativeZip.length-22,central=f.nativeZip.readUInt32LE(end+16);
  const mutations=[b=>b.writeUInt16LE(1,end+4),b=>b.writeUInt16LE(1,end+20),b=>b.writeUInt32LE(0xffffffff,end+16),
    b=>b.writeUInt16LE(4,end+8),b=>b.writeUInt16LE(99,central+6),b=>b.writeUInt16LE(1,central+8),
    b=>b.writeUInt16LE(9,central+10),b=>b.writeUInt32LE(128*1024*1024+1,central+24),
    b=>b.writeUInt16LE(1,central+30),b=>b.writeUInt16LE(1,central+32),b=>b.writeUInt16LE(1,central+34),
    b=>b.writeUInt32LE(0xa0000000,central+38),b=>b.writeUInt32LE(1,central+42),b=>b.writeUInt16LE(1,6),
    b=>b.writeUInt16LE(1,10),b=>b.writeUInt16LE(1,28),b=>b.writeUInt32LE(1,18)];
  for(const mutate of mutations){const bytes=Buffer.from(f.nativeZip);mutate(bytes);assert.throws(()=>inspect(bytes,{...f.packet.candidate,bundleSha256:hash(bytes)}));}
  // Truncation, archive suffix, duplicate BOM and raw manifest normalization all hold.
  for(const bytes of [f.nativeZip.subarray(0,-1),Buffer.concat([f.nativeZip,Buffer.from([0])])])assert.throws(()=>inspect(bytes,{...f.packet.candidate,bundleSha256:hash(bytes)}));
  assert.throws(()=>inspect(f.nativeZip,{...f.packet.candidate,manifestSha256:hash(Buffer.from(f.packageEntries[1][1].toString().replace(/^\uFEFF/,'').replaceAll('\r\n','\n')))}));
});
test('terminal late review/branch movement and owner-environment changes invalidate all positive flags',async()=>{
  for(const target of ['/actions/runs/123','/git/ref/heads/'+fixture().packet.candidate.branch,'/environments/operator-merge-approval']) {
    const f=fixture();let seen=0;const wrapper=async(url,opt)=>{if(url===API+target&&++seen===(target.includes('/runs/')?3:target.includes('/environments/')?2:3)){
        const obj=f.resources.get(url);if(obj.object)obj.object.sha='e'.repeat(40);else if(obj.run_attempt)obj.run_attempt++;else obj.can_admins_bypass=true;}return f.fetch(url,opt);};
    rejected(await run(f,wrapper));
  }
});
test('expiry during authenticated reads cannot produce a positive result',async()=>{
  const f=fixture(),input=f.input(),original=Date.now,base=original();let advance=false;
  Date.now=()=>advance?base+6*60*1000:base;
  try{const wrapper=async(url,opt)=>{const response=await f.fetch(url,opt);if(url.startsWith('https://productionresultssa17.'))advance=true;return response;};
    rejected(await run(f,wrapper,input));}finally{Date.now=original;}
});
test('recipient-key/audience substitutions and caller authentication flags fail before any GitHub read',async()=>{
  const changes=[i=>{i.nativeRecipientSpkiBase64=otherRecipientSpkiBase64;i.dispatch.r7_native_recipient_spki_base64=otherRecipientSpkiBase64;},
    i=>{i.nativeAudience=i.nativeAudience.slice(0,-65);i.dispatch.r7_native_challenge_audience=i.nativeAudience;},
    i=>{i.nativeAudience=i.nativeAudience.slice(0,-64)+'0'.repeat(64);i.dispatch.r7_native_challenge_audience=i.nativeAudience;},
    i=>{i.nativeAudience+=':extra';i.dispatch.r7_native_challenge_audience=i.nativeAudience;},
    i=>{delete i.nativeRecipientSpkiBase64;},i=>{i.nativeEndpointAuthenticated=true;},
    i=>{i.dispatch.r7_native_recipient_spki_base64=otherRecipientSpkiBase64;}];
  for(const change of changes){const f=fixture(),input=f.input();change(input);rejected(await run(f,null,input));assert.equal(f.calls.length,0);}
});
test('self-consistent WHOLE challenge replacement authenticates no endpoint or host authority',async()=>{
  const f=fixture(),input=f.input();input.nativeRecipientSpkiBase64=otherRecipientSpkiBase64;
  input.nativeAudience=input.nativeAudience.slice(0,-64)+hash(Buffer.from(otherRecipientSpkiBase64,'base64'));
  input.dispatch.r7_native_recipient_spki_base64=input.nativeRecipientSpkiBase64;
  input.dispatch.r7_native_challenge_audience=input.nativeAudience;
  const r=await run(f,null,input);assert.equal(r.reviewArtifactAuthenticated,true,JSON.stringify(r));noAuthority(r);
  assert.equal(r.nativeChallengeFreshnessAuthenticated,false);
  assert.ok(r.blockers.includes('R7_FIRST_ROOT_PRIVATE_NATIVE_CHALLENGE_HANDOFF_NOT_IMPLEMENTED'));
});
