import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MAX_HIGH_RISK_CHUNK_BYTES, MAX_HIGH_RISK_DIFF_BYTES,
  prepareSovereignHighRiskCandidateV1 as prepare,
  evaluateSovereignHighRiskCandidateV1 as evaluateRaw,
  prepareSovereignCompleteReviewCandidateV1 as prepareComplete,
  evaluateSovereignCompleteReviewCandidateV1 as evaluateComplete,
  COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1 as completeLimits,
} from './sovereignHighRiskReviewCandidateV1.mjs';
import { formatAuthenticatedReviewDiffV1 } from './sovereignAuthenticatedReviewDiffV1.mjs';
import { validateProviderNeutralReviewReceipt } from './providerNeutralReviewV1.mjs';

const diffOne = (path, body='-old\n+new\n') =>
  'diff --git a/' + path + ' b/' + path + '\n' +
  'index aaaaaaa..bbbbbbb 100644\n' +
  '--- a/' + path + '\n+++ b/' + path + '\n@@ -1 +1 @@\n' + body;
const input = (changes = {}) => ({
  repository: 'Cheekyfellastef/stephan-os', issueNumber: 1574,
  prNumber: 3047, branch: 'rescue/lease-observer-20261012',
  sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
  reviewedObjectClosureSha256:'c'.repeat(64),
  changedFiles: ['scripts/battle-bridge-recovery-mesh.mjs'],
  diff: diffOne('scripts/battle-bridge-recovery-mesh.mjs'),
  reviewerSessionId: 'sovereign-review-session', implementerSessionId: 'github-author-session',
  implementerProvider: 'github-builder', modelClass: 'qwen-14b',
  ...changes,
});
const digest = value => createHash('sha256').update(value).digest('hex');
const modelPin='d'.repeat(64);
const evaluate=(sample, options={})=>evaluateRaw(sample,{...options,modelDigestSha256:modelPin,
  invokeModel:typeof options.invokeModel==='function'?async(prompt,chunk)=>{
    const response=await options.invokeModel(prompt,chunk);
    return typeof response==='string'?{response,modelDigestSha256:modelPin,
      chunkId:chunk.chunkId,contentSha256:chunk.contentSha256}:response;
  }:options.invokeModel});
const clean = (_prompt, chunk) => JSON.stringify({
  chunkId: chunk.chunkId, contentSha256: chunk.contentSha256,
  verdict: 'clean', findings: [],
});
const assertNoAuthority = result => {
  for (const name of [
    'approvalAuthority', 'mergeAuthority', 'specialistAuthority',
    'sourceMutationAllowed', 'runtimeMutationAllowed', 'dispatchAuthority',
    'independentAttestationProven',
  ]) assert.equal(result[name], false, name);
};

test('high-risk rescue code is analyzed as an advisory but never given specialist or merge status', async () => {
  const result = await evaluate(input(), { invokeModel: clean });
  assert.equal(result.status, 'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(result.candidateEvidence.riskTier, 'high');
  assert.equal(result.candidateEvidence.verdict, 'candidate-clean');
  assert.equal(result.qualification, 'PENDING_INDEPENDENT_SPECIALIST_ATTESTATION');
  assertNoAuthority(result); assertNoAuthority(result.candidateEvidence);
  assert.equal(validateProviderNeutralReviewReceipt(result.candidateEvidence).valid, false);
  assert.equal(result.reviewReceipt, undefined);
});

test('one observed model digest binds every chunk and final packet; drift/forged receipt holds', async () => {
  const sample=input({diff:diffOne('scripts/battle-bridge-recovery-mesh.mjs','+bounded code\n'.repeat(700))});
  const invoke=pin=>async(prompt,chunk)=>({response:clean(prompt,chunk),modelDigestSha256:pin,
    chunkId:chunk.chunkId,contentSha256:chunk.contentSha256});
  const first=await evaluateRaw(sample,{modelDigestSha256:modelPin,invokeModel:invoke(modelPin)});
  const other='e'.repeat(64);
  const second=await evaluateRaw(sample,{modelDigestSha256:other,invokeModel:invoke(other)});
  assert.equal(first.status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(first.candidateEvidence.modelDigestSha256,modelPin);
  assert.ok(first.candidateEvidence.reviewedChunks.every(c=>c.modelDigestSha256===modelPin));
  assert.notEqual(first.candidateEvidence.reviewPacketSha256,second.candidateEvidence.reviewPacketSha256);
  const finding=summary=>async(prompt,chunk)=>({modelDigestSha256:modelPin,
    chunkId:chunk.chunkId,contentSha256:chunk.contentSha256,response:JSON.stringify({
      chunkId:chunk.chunkId,contentSha256:chunk.contentSha256,verdict:'findings',
      findings:[{severity:'P2',code:'source-finding',path:chunk.path,summary}],
    })});
  const resultA=await evaluateRaw(input(),{modelDigestSha256:modelPin,invokeModel:finding('First independently retained source finding.')});
  const resultB=await evaluateRaw(input(),{modelDigestSha256:modelPin,invokeModel:finding('Second independently retained source finding.')});
  assert.notEqual(resultA.candidateEvidence.reviewPacketSha256,resultB.candidateEvidence.reviewPacketSha256,
    'equal finding counts cannot substitute result content under the same packet hash');
  assertNoAuthority(first.candidateEvidence);
  let n=0;
  const changed=await evaluateRaw(sample,{modelDigestSha256:modelPin,invokeModel:async(p,c)=>
    invoke(++n===1?modelPin:other)(p,c)});
  assert.equal(changed.reason,'REVIEW_MODEL_OR_CHUNK_IDENTITY_CHANGED');
  assert.equal(changed.reviewedChunkCount,1); assertNoAuthority(changed);
  assert.equal((await evaluateRaw(sample,{invokeModel:invoke(modelPin)})).reason,'REVIEW_MODEL_DIGEST_UNVERIFIED');
  assert.equal((await evaluateRaw(sample,{modelDigestSha256:modelPin,invokeModel:clean})).reason,
    'REVIEW_MODEL_OR_CHUNK_IDENTITY_CHANGED');
});

test('an approximately 30 KB patch is reviewed in complete, ordered, bounded chunks', async () => {
  const path = 'scripts/battle-bridge-recovery-mesh.mjs';
  const huge = diffOne(path, Array.from({length: 1250}, (_, i) =>
    '+bounded code line ' + String(i).padStart(4,'0') + ' content\n').join(''));
  assert.equal(Buffer.byteLength(huge) > 30_000, true);
  const snapshot = input({diff: huge});
  const packet = prepare(snapshot);
  assert.equal(packet.status, 'HIGH_RISK_CANDIDATE_PREPARED');
  assert.ok(packet.chunks.length >= 5);
  assert.ok(packet.chunks.every(x => x.bytes <= MAX_HIGH_RISK_CHUNK_BYTES));
  assert.equal(packet.chunks.map(x => x.content).join(''), huge);
  assert.equal(packet.fullDiffSha256, digest(huge));
  const seen = [];
  const result = await evaluate(snapshot, {
    invokeModel: async (prompt, chunk) => {
      seen.push(chunk.chunkId);
      assert.match(prompt, /<UNTRUSTED_PATCH>/);
      assert.ok(Buffer.byteLength(prompt) <= MAX_HIGH_RISK_CHUNK_BYTES + 2000);
      return clean(prompt, chunk);
    },
  });
  assert.equal(result.status, 'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.deepEqual(seen, packet.chunks.map(x => x.chunkId));
  assert.equal(result.candidateEvidence.reviewedChunks.length, packet.chunkCount);
  assertNoAuthority(result.candidateEvidence);
});

test('multi-file source estate must exactly match Git diff file headers', async () => {
  const path1 = 'scripts/battle-bridge-recovery-mesh.mjs';
  const path2 = 'shared/agents/sovereignReviewerV1.mjs';
  const sample = input({changedFiles: [path1,path2], diff: diffOne(path1) + diffOne(path2)});
  const packet = prepare(sample);
  assert.equal(packet.status, 'HIGH_RISK_CANDIDATE_PREPARED');
  assert.deepEqual(packet.changedFiles,[path1,path2]);
  assert.equal(packet.chunks.map(x=>x.content).join(''),sample.diff);
  assert.equal((await evaluate(sample,{invokeModel:clean})).status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  for(const overrides of [
    {changedFiles:[path1]},
    {changedFiles:[path1,path1]},
    {changedFiles:[path1,'src/unrelated.mjs']},
    {diff:diffOne(path1) + 'diff --git a/../../foo b/../../foo\n'},
    {diff:diffOne(path1) + 'diff --git a/x y b/x y\n'},
    {diff:diffOne(path1) + 'diff --git a/' + path2 + ' b/' + path1 + '\n@@ -1 +1 @@\n-old\n+new\n'},
    {diff:diffOne(path1) + 'diff --git a/' + path2 + ' b/' + path2 + '\nGIT binary patch\n'},
  ]) {
    assert.equal(prepare({...sample,...overrides}).status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  }
});

test('a missing, duplicated, oversize or in-flight chunk does not become a clean review', async () => {
  for(const invokeModel of [
    async ()=>'{',
    async ()=>JSON.stringify({chunkId:'wrong',contentSha256:'a'.repeat(64),verdict:'clean',findings:[]}),
    async (p,c)=>JSON.stringify({chunkId:c.chunkId,contentSha256:'0'.repeat(64),verdict:'clean',findings:[]}),
    async (p,c)=>JSON.stringify({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'clean',findings:[],mergeAuthority:true}),
    async ()=>{throw Error('offline')},
  ]) {
    const result=await evaluate(input(),{invokeModel});
    assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
    assertNoAuthority(result);
  }
});

test('partial review failure after one chunk keeps candidate held', async()=>{
  const huge=diffOne('scripts/battle-bridge-recovery-mesh.mjs',
    '+small content\n'.repeat(700));
  let calls=0;
  const result=await evaluate(input({diff:huge}),{invokeModel:async (p,c)=>{
    calls++;
    return calls===1?clean(p,c):'{broken';
  }});
  assert.equal(calls,2);
  assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  assert.equal(result.reviewedChunkCount,1);
  assertNoAuthority(result);
});

test('P0 and P1 findings from all chunks remain visible in complete candidate', async()=>{
  const patch=diffOne('scripts/battle-bridge-recovery-mesh.mjs','+new thing\n'.repeat(650));
  let count=0;
  const result=await evaluate(input({diff:patch}),{invokeModel:async (prompt, chunk)=>{
    count++;
    return JSON.stringify({
      chunkId:chunk.chunkId, contentSha256:chunk.contentSha256,
      verdict:count<=2?'findings':'clean',
      findings: count<=2?[{
        severity:count===1?'P0':'P1',code:'review-gap',
        path:chunk.path,summary:'This local source needs qualified specialist review.'
      }]:[],
    });
  }});
  assert.equal(result.status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(result.candidateEvidence.verdict,'findings');
  assert.equal(result.candidateEvidence.findings.length,2);
  assert.deepEqual(result.candidateEvidence.findings.map(f=>f.severity),['P0','P1']);
  assertNoAuthority(result);
});

test('malicious or contradictory local model claims are rejected',async()=>{
  const cases=[
    (c)=>({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'clean',findings:[{severity:'P0',code:'bad',path:c.path,summary:'A critical error exists in this file.'}]}),
    (c)=>({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'findings',findings:[]}),
    (c)=>({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'findings',findings:[{severity:'P0',code:'issue',path:'.github/other.yml',summary:'Critical spoofed finding outside file.'}]}),
    (c)=>({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'findings',findings:[{severity:'P0',code:'issue',path:c.path,summary:'short'}]}),
    (c)=>({chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'approved',findings:[]}),
  ];
  for(const make of cases){
    const result=await evaluate(input(),{invokeModel:async (_,c)=>JSON.stringify(make(c))});
    assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
    assertNoAuthority(result);
  }
});

test('rejects binary changes, overlong lines, misleading paths and missing exact source',()=>{
  const path='scripts/battle-bridge-recovery-mesh.mjs';
  for(const snapshot of [
    input({sourceHead:'changed'}),
    input({baseSha:'changed'}),
    input({diff:diffOne(path)+'Binary files differ\n'}),
    input({diff:diffOne(path)+'rename from x\n'}),
    input({diff:diffOne(path)+'GIT binary patch\n'}),
    input({diff:diffOne(path,'+'+'a'.repeat(MAX_HIGH_RISK_CHUNK_BYTES+1)+'\n')}),
    input({diff:diffOne(path,'+'+'a'.repeat(MAX_HIGH_RISK_DIFF_BYTES)+'\n')}),
    input({implementerProvider:'sovereign-local-ollama',
      implementerSessionId:'sovereign-review-session'}),
    input({changedFiles:['../secrets']}),
  ]){
    const value=prepare(snapshot);
    assert.equal(value.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
    assertNoAuthority(value);
  }
});

test('local high-risk reviewer applies relevant cross-domain security checks without claiming approval',async()=>{
  const paths=[
    'src/windows/Stephanos.OriginalR7CustodyWitness/Program.cs',
    'plugins/openclaw-local/SKILL.md',
    'shared/agents/originalSourceLeaseV1.mjs',
    'shared/agents/qualifiedSpecialistReviewV1.mjs',
  ];
  const snapshot=input({changedFiles:paths,diff:paths.map(path=>diffOne(path)).join('')});
  const focus=[];
  const result=await evaluate(snapshot,{invokeModel:(prompt,chunk)=>{
    focus.push(prompt);
    return clean(prompt,chunk);
  }});
  assert.equal(result.status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(focus.length,paths.length);
  assert.match(focus[0],/SCM service\/token SID verification/);
  assert.match(focus[1],/agent role separation/);
  assert.match(focus[2],/compare-and-swap digests/);
  assert.match(focus[3],/reviewer independence/);
  assert.ok(focus.every(p=>p.includes('do not claim physical proof')));
  assertNoAuthority(result);assertNoAuthority(result.candidateEvidence);
});

function completeInput(contents = {
  'shared/agents/producer.mjs':'export const publishedUnit = "seconds";\n',
  'shared/agents/consumer.mjs':'import { publishedUnit } from "./producer.mjs";\nconsumeAsMilliseconds(publishedUnit);\n',
}) {
  const base='b'.repeat(40),head='a'.repeat(40),blobs=new Map(),after=new Map();
  for (const [path,content] of Object.entries(contents)) {
    const bytes=Buffer.from(content),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    blobs.set(sha,bytes);after.set(path,{mode:'100644',sha});
  }
  const rendered=formatAuthenticatedReviewDiffV1({base,head,before:new Map(),after,blobs,
    authenticatedObjectIds:['commit:'+base,'commit:'+head,'tree:'+'e'.repeat(40),
      ...[...blobs.keys()].map(sha=>'blob:'+sha)]});
  return input({...rendered,baseTree:'e'.repeat(40),sourceTree:'f'.repeat(40)});
}
function completeObservation(packet,response,overrides={}) {
  const contextTokens=packet.promptBytes+packet.outputTokenReserve<=8192?8192:524288;
  return {schemaVersion:'stephanos.sovereign-complete-inference-observation.v1',
    protocolVersion:'0.40.0',modelSelector:'sha256:'+modelPin+':local',
    promptSha256:packet.promptSha256,promptBytes:packet.promptBytes,inputTokenUpperBound:packet.promptBytes,
    outputTokenReserve:packet.outputTokenReserve,contextTokens,observedContextTokens:contextTokens,
    modelContextTokens:1048576,contextAdmission:'FIXED_8K_BASELINE',residencyCustodyObserved:false,
    preexistingContextTokens:contextTokens===8192?null:contextTokens,
    rawPrompt:true,promptTruncationDisabled:true,contextShiftDisabled:true,
    actualPromptTokens:Math.ceil(packet.promptBytes/3),actualOutputTokens:120,
    doneReason:'stop',responseSha256:digest(response),durationMs:2,requestDurationMs:1,
    startedAtUtc:'2026-11-07T15:00:00.000Z',finishedAtUtc:'2026-11-07T15:00:00.002Z',
    gamingCheckCount:7,gamingInterruptedCount:0,maximumGamingCheckGapMs:1,
    gamingObservationChainSha256:'1'.repeat(64),...overrides};
}
const completeClean=packet=>JSON.stringify({reviewId:packet.reviewId,fullDiffSha256:packet.fullDiffSha256,
  reviewedPathsSha256:packet.reviewedPathsSha256,verdict:'clean',findings:[]});
const completeReply=(packet,response=completeClean(packet),overrides={})=>({reviewId:packet.reviewId,
  modelDigestSha256:modelPin,response,executionObservation:completeObservation(packet,response,overrides)});

test('complete planning retains the entire 435KB-class diff and holds unowned large-context execution',async()=>{
  const snapshot=completeInput({
    'scripts/starfield-producer.mjs':'const sourceBoundary = "ENTIRE_PRODUCER_START";\n'
      +'// bounded original source line\n'.repeat(14500)+'const sourceEnd = "ENTIRE_PRODUCER_END";\n',
    'scripts/starfield-consumer.mjs':'const consumerBoundary = "ENTIRE_CONSUMER_END";\n',
  });
  assert(snapshot.fullDiffBytes>435000 && snapshot.fullDiffBytes<completeLimits.diffBytes);
  const prepared=prepareComplete(snapshot);
  assert.equal(prepared.status,'COMPLETE_HIGH_RISK_CANDIDATE_PREPARED');
  assert(prepared.prompt.includes(snapshot.fullDiff));
  assert.equal(prepared.promptBytes,Buffer.byteLength(prepared.prompt));
  assert.equal(prepared.inputTokenUpperBound,prepared.promptBytes);
  assert.equal(prepared.promptSha256,digest(prepared.prompt));
  assertNoAuthority(prepared);
  let calls=0;
  const result=await evaluateComplete(snapshot,{modelDigestSha256:modelPin,invokeModel:async(prompt,packet)=>{
    calls++;assert.fail('a resident observation cannot grant a large-context allocation');
  }});
  assert.equal(calls,0);
  assert.equal(result.reason,'COMPLETE_REVIEW_LARGE_CONTEXT_CUSTODY_UNPROVEN');
  assert.equal(result.completeCrossFileReviewObserved,false);
  assert.equal(result.preparedDiffBytes,snapshot.fullDiffBytes);assert.equal(result.reviewedDiffBytes,0);
  assertNoAuthority(result);
});

test('complete review keeps a cross-file finding and binds its actual content, not a count',async()=>{
  const snapshot=completeInput(),responses=[];
  for (const summary of ['The producer emits seconds while the consumer expects milliseconds.',
    'The caller uses a different unit from the producer contract.']) {
    responses.push(await evaluateComplete(snapshot,{modelDigestSha256:modelPin,invokeModel:async(prompt,packet)=>{
      assert(prompt.includes('publishedUnit') && prompt.includes('consumeAsMilliseconds'));
      const response=JSON.stringify({...JSON.parse(completeClean(packet)),verdict:'findings',findings:[{
        severity:'P1',code:'cross-file-unit-mismatch',path:'shared/agents/consumer.mjs',summary,
      }]});return completeReply(packet,response);
    }}));
  }
  assert(responses.every(row=>row.candidateEvidence.findings.length===1));
  assert(responses.every(row=>row.candidateEvidence.stage==='COMPLETE_CROSS_FILE_REVIEW'));
  assert.equal(responses[0].candidateEvidence.qualifiedExecutionWitness,false);
  assert.equal(validateProviderNeutralReviewReceipt(responses[0].candidateEvidence).valid,false);
  assertNoAuthority(responses[0]);assertNoAuthority(responses[0].candidateEvidence);
  assert.notEqual(responses[0].candidateEvidence.reviewPacketSha256,responses[1].candidateEvidence.reviewPacketSha256);
});

test('raw patch, omitted canonical member, changed object identity and path gaps never enter complete inference',async()=>{
  const snapshot=completeInput();
  const bad=[{representation:'git-diff'},{fullDiff:snapshot.diff+'+omitted\n'},
    {fullDiffSha256:'0'.repeat(64)},{fullDiffBytes:snapshot.fullDiffBytes-1},
    {changedPaths:snapshot.changedPaths.slice(1)},{sourceEvidence:snapshot.sourceEvidence.slice(1)},
    {baseTree:''},{changedFiles:Array(2)},
    {sourceEvidence:snapshot.sourceEvidence.map((row,i)=>i?row:{...row,newBlobSha:'not-object'})}];
  for(const patch of bad){
    let calls=0;const result=await evaluateComplete({...snapshot,...patch},{modelDigestSha256:modelPin,
      invokeModel:()=>{calls++;assert.fail('invalid source must not be sent')}});
    assert.equal(calls,0);assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');assertNoAuthority(result);
  }
});

test('complete inference refuses insufficient context, truncation and forged completion observations',async()=>{
  const snapshot=completeInput();
  const prepared=prepareComplete(snapshot);assert(prepared.promptBytes<8192);
  for(const patch of [
    {contextTokens:4096,observedContextTokens:4096},{contextAdmission:'CALLER_FLAG'},
    {contextAdmission:'EXISTING_RESIDENT_EXACT_DIGEST'},{residencyCustodyObserved:true},
    {preexistingContextTokens:1048577},
    {observedContextTokens:4096},{protocolVersion:'0.39.9'},
    {promptSha256:'0'.repeat(64)},{inputTokenUpperBound:1},{outputTokenReserve:1},
    {modelSelector:'qwen:14b'},{actualPromptTokens:prepared.promptBytes+1},
    {actualOutputTokens:completeLimits.outputTokenReserve+1},{doneReason:'length'},
    {rawPrompt:false},{promptTruncationDisabled:false},{contextShiftDisabled:false},
    {durationMs:completeLimits.aggregateTimeoutMs},{requestDurationMs:completeLimits.requestTimeoutMs},
    {gamingCheckCount:1},{gamingInterruptedCount:1},{maximumGamingCheckGapMs:1001},
  ]) {
    const result=await evaluateComplete(snapshot,{modelDigestSha256:modelPin,
      invokeModel:(_prompt,packet)=>completeReply(packet,completeClean(packet),patch)});
    assert.equal(result.reason,'COMPLETE_REVIEW_INFERENCE_OBSERVATION_UNPROVEN',JSON.stringify(patch));
    assertNoAuthority(result);
  }
});

test('complete result refuses missing paths, extra authority, wrong review identity and unsupported finding paths',async()=>{
  const snapshot=completeInput();
  for (const amend of [r=>({...r,reviewedPathsSha256:'0'.repeat(64)}),r=>({...r,reviewId:'old-review'}),
    r=>({...r,mergeAuthority:true}),r=>({...r,verdict:'approved'}),
    r=>({...r,verdict:'findings',findings:[{severity:'P0',code:'outside',path:'unreviewed.mjs',summary:'This file was never part of the source estate.'}]})]) {
    const result=await evaluateComplete(snapshot,{modelDigestSha256:modelPin,invokeModel:(_prompt,packet)=>{
      const response=JSON.stringify(amend(JSON.parse(completeClean(packet))));return completeReply(packet,response);
    }});
    assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');assertNoAuthority(result);
  }
});

test('complete request cannot outlive aggregate cancellation or turn a partial response into review',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const result=await evaluateComplete(completeInput(),{modelDigestSha256:modelPin,signal:controller.signal,
    invokeModel:()=>{calls++;assert.fail('cancelled')}});
  assert.equal(calls,0);assert.equal(result.reason,'COMPLETE_REVIEW_AGGREGATE_DEADLINE');
  const changed=new AbortController();
  const after=await evaluateComplete(completeInput(),{modelDigestSha256:modelPin,signal:changed.signal,
    invokeModel:(_prompt,packet)=>{changed.abort();return completeReply(packet);}});
  assert.equal(after.reason,'COMPLETE_REVIEW_AGGREGATE_DEADLINE');assertNoAuthority(after);
});
