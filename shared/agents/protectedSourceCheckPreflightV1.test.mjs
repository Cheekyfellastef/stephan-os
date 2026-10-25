import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {buildIndependentReviewArtifact} from './operatorMergeReviewArtifactV1.mjs';
import {INDEPENDENT_REVIEW_WORKFLOW_NAME,INDEPENDENT_REVIEW_WORKFLOW_PATH} from './operatorMergeApprovalGate.mjs';
import {independentReviewWorkflowDispatchRunNameV1} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {inspectProtectedSourceCheckPreflightV1 as inspect} from './protectedSourceCheckPreflightV1.mjs';

const repository='Cheekyfellastef/stephan-os',head='a'.repeat(40),base='b'.repeat(40),branch='feature/preflight-fixture';
const identity={prNumber:999,branch,sourceHead:head,baseSha:base};
const reviewPath='.github/workflows/stephanos-exact-head-review.yml';
function run(id,conclusion='success',path=reviewPath,name='Stephanos Exact-Head Review') {
 return {id,run_attempt:1,workflow_id:10,check_suite_id:id+1000,name,display_title:name,path,
 event:'pull_request_target',repository:{full_name:repository},head_sha:head,status:'completed',conclusion,
 pull_requests:[{number:999,head:{sha:head,ref:branch},base:{sha:base,ref:'main'}}]};
}
function check(workflow,conclusion=workflow.conclusion) {
 const id=workflow.id+2000;
 return {id,name:'exact-head-review',head_sha:head,status:'completed',conclusion,
 app:{id:15368,slug:'github-actions'},check_suite:{id:workflow.check_suite_id},
 details_url:'https://github.com/'+repository+'/actions/runs/'+workflow.id+'/job/'+id};
}
function snapshot(runs=[run(100)]) {
 return {repository,identity,mergeStateStatus:'CLEAN',workflowRuns:runs,checkRuns:runs.map(r=>check(r)),commitStatuses:[]};
}
function reviewEvidence() {
 const workflowRunId=900,workflowRunAttempt=1;
 const artifact=buildIndependentReviewArtifact({repository,prNumber:999,branch,sourceHead:head,baseSha:base,
 workflowRunId,workflowRunAttempt,createdAtUtc:'2026-10-23T12:00:00Z',
 analysis:{schemaVersion:'stephanos.independent-security-analysis.v1',findings:[],counts:{P0:0,P1:0,P2:0},
 verdict:'clean',proofRefs:['proofs/diff/complete'],finalVerdict:'INDEPENDENT_SECURITY_REVIEW_CLEAN'}});
 const archiveBytes=singleEntryZip({payload:JSON.stringify(artifact)}).archive;
 const digest='sha256:'+createHash('sha256').update(archiveBytes).digest('hex');
 const name=independentReviewWorkflowDispatchRunNameV1({prNumber:999,sourceHead:head,handoffBindingSha256:'legacy-pull-request-target'});
 return {definition:{id:10,name:INDEPENDENT_REVIEW_WORKFLOW_NAME,path:INDEPENDENT_REVIEW_WORKFLOW_PATH,state:'active'},
 run:run(workflowRunId,'success',INDEPENDENT_REVIEW_WORKFLOW_PATH,name),
 jobs:[{id:901,name:'independent-security-review',run_attempt:1,status:'completed',conclusion:'success',
 run_url:'https://api.github.com/repos/'+repository+'/actions/runs/'+workflowRunId}],
 artifacts:{total_count:1,artifacts:[{id:902,name:artifact.artifactName,expired:false,size_in_bytes:archiveBytes.length,
 digest,workflow_run:{id:workflowRunId}}]},
 selection:{runId:workflowRunId,runAttempt:1,artifactId:902,archiveDigest:digest,payloadSha256:artifact.payloadSha256},
 archiveBytes};
}

test('exact green snapshot is advisory and never grants approval or mutation',()=>{
 const result=inspect(snapshot());
 assert.equal(result.checkSnapshotAdmissible,true,JSON.stringify(result.blockers));
 for(const key of ['operatorApproval','mergeAuthority','runtimeAuthority'])assert.equal(result[key],false);
 assert.equal(result.advisoryOnly,true);
 assert.equal(result.finalRevalidationRequired,true);
});
test('clean exact review never converts a lone draft skip into a pass',()=>{
 const result=inspect({...snapshot([run(100,'skipped')]),independentReview:reviewEvidence()});
 assert.equal(result.reviewEvidenceConsistent,true,JSON.stringify(result.blockers));
 assert.equal(result.checkSnapshotAdmissible,false);
 assert.ok(result.blockers.includes('personal-repository-check-run-not-exact-green'));
});
test('later exact success supersedes only the bound older draft skip',()=>{
 const input=snapshot([run(100,'skipped'),run(101)]);
 assert.equal(inspect(input).checkSnapshotAdmissible,true);
 for(const mutate of [
  r=>{r.pull_requests[0].base.sha='c'.repeat(40);},r=>{r.path='.github/workflows/other.yml';},
  r=>{r.event='issue_comment';},r=>{r.head_sha='c'.repeat(40);},
 ]) {
  const hostile=structuredClone(input);mutate(hostile.workflowRuns[1]);
  assert.equal(inspect(hostile).checkSnapshotAdmissible,false);
 }
});
test('reviewed failure escalation uses real validated review evidence, never a caller boolean',()=>{
 const input={...snapshot([run(100,'failure')]),mergeStateStatus:'UNSTABLE'};
 assert.equal(inspect({...input,cleanIndependentReviewProved:true}).checkSnapshotAdmissible,false);
 const result=inspect({...input,independentReview:reviewEvidence()});
 assert.equal(result.checkSnapshotAdmissible,true,JSON.stringify(result.blockers));
 assert.equal(result.checkEvidence[0].disposition,'clean-independent-review');
 assert.equal(inspect({...input,mergeStateStatus:'CLEAN',independentReview:reviewEvidence()}).checkSnapshotAdmissible,false);
});
test('archive identity, immutable artifact selection and review binding all fail closed',()=>{
 for(const mutate of [
  r=>{r.archiveBytes=Buffer.from('malformed');},
  r=>{r.selection.payloadSha256='0'.repeat(64);},
  r=>{r.selection.artifactId++;},
  r=>{r.artifacts.artifacts[0].expired=true;},
  r=>{r.run.pull_requests[0].base.sha='c'.repeat(40);},
  r=>{r.jobs[0].conclusion='failure';},
  r=>{r.definition.path='.github/workflows/other.yml';},
 ]) {
  const review=reviewEvidence();mutate(review);
  const result=inspect({...snapshot(),independentReview:review});
  assert.equal(result.checkSnapshotAdmissible,false,JSON.stringify(result));
  assert.equal(result.reviewEvidenceConsistent,false);
 }
});
test('missing collections, stale heads, untrusted Apps and pending checks are held',()=>{
 for(const mutate of [
  s=>{delete s.commitStatuses;},s=>{delete s.workflowRuns;},s=>{s.checkRuns=[];},
  s=>{s.checkRuns[0].app.id=1;},s=>{s.checkRuns[0].head_sha='c'.repeat(40);},
  s=>{s.checkRuns[0].status='in_progress';s.checkRuns[0].conclusion=null;},
  s=>{s.commitStatuses=[{sha:head,state:'failure'}];},
 ]) {const input=snapshot();mutate(input);assert.equal(inspect(input).checkSnapshotAdmissible,false);}
});

const ARTIFACT_FILE = 'independent-review-result.json';
const TEST_CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TEST_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function singleEntryZip({ payload = '{"ready":true}', fileName = ARTIFACT_FILE, method = 8, flags = 0, dataDescriptor = false } = {}) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const compressed = method === 8 ? deflateRawSync(plain) : Buffer.from(plain);
  const name = Buffer.from(fileName, 'utf8');
  const crc = testCrc32(plain);
  const version = method === 8 ? 20 : 10;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(version, 4);
  const resolvedFlags = flags | (dataDescriptor ? 0x0008 : 0);
  local.writeUInt16LE(resolvedFlags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(dataDescriptor ? 0 : crc, 14);
  local.writeUInt32LE(dataDescriptor ? 0 : compressed.length, 18);
  local.writeUInt32LE(dataDescriptor ? 0 : plain.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const descriptor = dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (dataDescriptor) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(plain.length, 12);
  }
  const centralOffset = local.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(version, 6);
  central.writeUInt16LE(resolvedFlags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Object.freeze({
    archive: Buffer.concat([local, compressed, descriptor, central, end]),
    compressed,
    offsets: Object.freeze({
      data: local.length,
      central: centralOffset,
      end: centralOffset + central.length,
    }),
    plain,
  });
}

test('trusted-main dispatch review retains its separate exact execution model',()=>{
 const evidence=reviewEvidence();
 evidence.run={...evidence.run,event:'workflow_dispatch',head_branch:'main',head_sha:base,pull_requests:[],
  name:INDEPENDENT_REVIEW_WORKFLOW_NAME,
  display_title:independentReviewWorkflowDispatchRunNameV1({prNumber:999,sourceHead:head,handoffBindingSha256:'c'.repeat(64)})};
 const result=inspect({...snapshot([run(100,'failure')]),mergeStateStatus:'UNSTABLE',independentReview:evidence});
 assert.equal(result.reviewEvidenceConsistent,true,JSON.stringify(result.blockers));
 assert.equal(result.checkSnapshotAdmissible,true);
 evidence.run.head_sha=head;
 assert.equal(inspect({...snapshot(),independentReview:evidence}).checkSnapshotAdmissible,false);
});
test('every non-object JSON review payload remains held despite matching archive metadata',()=>{
 for(const payload of [null,false,0,'',true,42,'text',[],['text']]){
  const review=reviewEvidence();
  const bytes=singleEntryZip({payload:JSON.stringify(payload)}).archive;
  const digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  review.archiveBytes=bytes;
  review.selection.archiveDigest=digest;
  review.artifacts.artifacts[0].digest=digest;
  review.artifacts.artifacts[0].size_in_bytes=bytes.length;
  const result=inspect({...snapshot([run(100,'failure')]),mergeStateStatus:'UNSTABLE',independentReview:review});
  assert.equal(result.reviewEvidenceConsistent,false,JSON.stringify(payload));
  assert.equal(result.checkSnapshotAdmissible,false,JSON.stringify(payload));
  assert.ok(result.blockers.includes('preflight-review-payload-not-object'),JSON.stringify(payload));
 }
});
