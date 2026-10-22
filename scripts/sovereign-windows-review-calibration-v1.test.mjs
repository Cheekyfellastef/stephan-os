import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWindowsCalibrationCandidateV1 as run,
  inspectWindowsCalibrationSourceV1 as sourceCheck,
  inspectWindowsCalibrationGamingGuardV1 as governor,
} from './sovereign-windows-review-calibration-v1-engine.mjs';

const env = {
  STEPHANOS_SOVEREIGN_REVIEW_MODEL: 'qwen:14b',
  STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL: 'windows-builder-01',
  STEPHANOS_REVIEW_REVIEWER_PRINCIPAL: 'windows-reviewer-02',
};
const observed = {
  repository:'Cheekyfellastef/stephan-os', sourceHead:'a'.repeat(40),
  baseSha:'b'.repeat(40), branch:'test/reviewer',
  implementerProvider:'source-builder', reviewerSessionId:'review-session-02',
};
const unsafe = [
  ['return Verified();','service-status-is-not-custody'],
  ['GetDaclText(sourcePath)','acl-text-does-not-prove-denial'],
  ['if (false) return Hold()','task-reentry-not-excluded'],
  ['GetProcessesByName(','writable-handle-not-excluded'],
  ['"/witness.key"','signer-isolation-broken'],
  ['ReleaseLease(originalLeaseId)','lease-cas-bypass'],
  ['!DirectLaunchDenied(oldWriterSid)) return Hold()','wmi-com-reentry-not-excluded'],
  ['AcceptMissingHistoricalReceiptAsSuccess(','historical-receipt-fabricated'],
  ['!WitnessValid(witnessDigest)) return Hold()','independent-operator-signature-bypassed'],
  ['NegativeWriteTest(currentServiceSid,','original-writer-principal-not-tested'],
];
const mockFetch = async (url, args) => {
  assert.equal(url, 'http://127.0.0.1:11434/api/generate');
  assert.equal(args.redirect, 'error');
  const parsed = JSON.parse(args.body);
  assert.equal(parsed.keep_alive, 0);
  assert.equal(parsed.model, 'sha256:' + 'c'.repeat(64));
  const match = parsed.prompt.match(/Case: (win-[a-f0-9]{32})\nSHA256: ([a-f0-9]{64})/);
  assert.ok(match);
  const file = parsed.prompt.match(/\+\+\+ b\/(src\/windows\/Case[a-f0-9]{32}\.(?:cs|ps1))/)?.[1];
  const code = unsafe.find(([needle])=>parsed.prompt.includes(needle))?.[1];
  const findings = code ? [{ code, path:file, severity:'P1',
    summary:'The changed source has this serious Windows security regression.' }] : [];
  return {ok:true, text:async()=>JSON.stringify({
    model:'sha256:' + 'c'.repeat(64), done:true, done_reason:'stop',
    response:JSON.stringify({
      caseId:match[1],patchSha256:match[2],
      verdict:findings.length?'findings':'clean',findings,
    }),
  })};
};
const dependencies = {
  platform:'win32', snapshot:()=>observed, sourceCheck:()=>true,
  gamingGuard:()=>true, digest:async()=> 'c'.repeat(64),
  fetchImpl:mockFetch, poll:()=>1, clearPoll:()=>{},
};
function noAuthority(r) {
  for (const f of ['qualifiedWindowsSpecialist','independentSecurityReviewSatisfied',
    'independentHostAttestation','signatureVerified','protectedMergeAuthority',
    'serviceInstallationAuthority','sourceMutationAuthority','leaseReleaseAuthority',
    'signedWindowsCustodyProven','physicalPickupProven']) assert.equal(r[f],false,f);
}
test('non-Windows cannot take Windows review path',async()=>{
  const r=await run(env,{...dependencies,platform:'linux'});
  assert.equal(r.reason,'NATIVE_WINDOWS_HOST_REQUIRED');noAuthority(r);
});
test('Windows host model score remains candidate evidence with no privileges',async()=>{
  const r=await run(env,dependencies);
  assert.equal(r.status,'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED');
  assert.equal(r.passedCases,13);
  assert.equal(r.modelDigestSha256,'c'.repeat(64));
  noAuthority(r);
});
test('native thirteen-case exam rejects a mutable-tag model completion',async()=>{
  const r=await run(env,{...dependencies,fetchImpl:async(url,args)=>{
    const response=await mockFetch(url,args);
    const body=JSON.parse(await response.text());
    return {ok:true,text:async()=>JSON.stringify({...body,model:'qwen:14b'})};
  }});
  assert.equal(r.status,'WINDOWS_CALIBRATION_HELD');noAuthority(r);
});
test('source unverified or gaming active blocks before any inference',async()=>{
  let invokes=0;
  for(const patch of [{sourceCheck:()=>false},{gamingGuard:()=>false}]){
    const r=await run(env,{...dependencies,...patch,fetchImpl:()=>{invokes++;throw Error('must not execute')}});
    assert.equal(r.status,'WINDOWS_CALIBRATION_HELD');noAuthority(r);
  }
  assert.equal(invokes,0);
});
test('mid-exam game or model identity change fails closed',async()=>{
  let calls=0;
  const r=await run(env,{...dependencies, gamingGuard:()=>{
    calls++;return calls < 6;
  }});
  assert.equal(r.status,'WINDOWS_CALIBRATION_HELD');noAuthority(r);
  let digestReads=0;
  const r2=await run(env,{...dependencies,digest:async()=> {
    digestReads++;return digestReads < 3 ? 'c'.repeat(64) : 'd'.repeat(64);
  }});
  assert.equal(r2.status,'WINDOWS_CALIBRATION_HELD');noAuthority(r2);
});
test('executable bytes require H-index flags and exact tracked HEAD hash',()=>{
  const fileChecks = [];
  const mockSpawn = (_cmd,args,options)=>{
    assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, '1');
    assert.equal(options.env.GIT_GRAFT_FILE, 'NUL');
    const i=args.indexOf('--work-tree=C:\\trusted');
    assert.notEqual(i,-1);
    const tail=args.slice(i+1);
    fileChecks.push(tail);
    if(tail[0]==='ls-files') return {status:0,stdout:'H '+tail.at(-1)+'\n'};
    if(tail[0]==='rev-parse') return {status:0,stdout:'a'.repeat(40)+'\n'};
    if(tail[0]==='hash-object') return {status:0,stdout:'a'.repeat(40)+'\n'};
    return {status:2,stdout:''};
  };
  const git = ()=>({executable:'git.exe',fixedConfigArgs:[],environment:{}});
  assert.equal(sourceCheck({}, {platform:'win32',root:'C:\\trusted',
    resolveGit:git,spawn:mockSpawn}),true);
  assert.equal(fileChecks.length,21);
  const swapped=(_cmd,args)=>args.includes('ls-files')
    ? {status:0,stdout:'S '+args.at(-1)+'\n'} : {status:0,stdout:'a'.repeat(40)+'\n'};
  assert.equal(sourceCheck({}, {platform:'win32',root:'C:\\trusted',
    resolveGit:git,spawn:swapped}),false);
});
test('gaming governor rejects absent state, stale state and active VR',()=>{
  assert.equal(governor({STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\workspace'},
    {stat:()=>{throw Error('missing')}}),false);
  const state={
    schemaVersion:'stephanos.vr-resource-governor.v1',governorVersion:3,
    updatedAtUtc:new Date(1_000_000).toISOString(),ollamaLoadMode:'balanced',
    active:false,flatGameActive:false,airLinkActive:false,realAirLinkActive:false,
    virtualAirLinkTestActive:false,prepareLeaseActive:false,
    localModelAllowed:true,heavyModelAllowed:true,
  };
  const stats={isFile:()=>true,isSymbolicLink:()=>false,size:100};
  const options={nowMs:1_000_000,stat:()=>stats,read:()=>JSON.stringify(state)};
  assert.equal(governor({STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\workspace'},options),true);
  assert.equal(governor({STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\workspace'},
    {...options,read:()=>JSON.stringify({...state,active:true})}),false);
  assert.equal(governor({STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\workspace'},
    {...options,nowMs:1_100_000}),false);
});

test('total deadline stops inference after slow preflight or model identity read',async()=>{
  let elapsed=0, invokes=0;
  const r=await run(env,{...dependencies,clock:()=>elapsed,
    digest:async()=>{elapsed=150_000;return 'c'.repeat(64)},
    fetchImpl:async()=>{invokes++;throw Error('after deadline')}});
  assert.equal(r.reason,'CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
  assert.equal(invokes,0);noAuthority(r);
  elapsed=0;let digests=0;
  const r2=await run(env,{...dependencies,clock:()=>elapsed,
    digest:async()=>{if(++digests===2)elapsed=150_000;return 'c'.repeat(64)},
    fetchImpl:async()=>{invokes++;throw Error('after deadline')}});
  assert.equal(r2.reason,'CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
  assert.equal(invokes,0);noAuthority(r2);
});

test('deadline monitor aborts an inference already in progress',async()=>{
  let elapsed=0,monitor;
  const r=await run(env,{...dependencies,clock:()=>elapsed,
    poll:fn=>{monitor=fn;return 1;},
    fetchImpl:async(_url,args)=>{
      elapsed=150_000;monitor();
      assert.equal(args.signal.aborted,true);
      throw Error('deadline');
    }});
  assert.equal(r.reason,'CALIBRATION_TOTAL_DEADLINE_EXCEEDED');noAuthority(r);
});
