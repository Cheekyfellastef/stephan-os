import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1 as PATHS,
  WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_BLOBS_V1 as BLOBS,
  analyzeWindowsAuthoritySovereignReviewerProfileReviewV1 as analyze,
} from './windowsAuthoritySovereignReviewerProfileReviewV1.mjs';

const REPOSITORY='Cheekyfellastef/stephan-os';
const BRANCH='fix/sovereign-reviewer-win32-wsl-proof-bridge-20261012';
const HEAD='a'.repeat(40), BASE='b'.repeat(40);
const FIXTURES=Object.freeze({
  'scripts/windows/SovereignReviewerHostV1.cs':'./fixtures/sovereignReviewerHostV1.fixture.txt',
  'scripts/windows/SovereignReviewerProfileV1.cs':'./fixtures/sovereignReviewerProfileV1.fixture.txt',
  'scripts/windows/install-sovereign-reviewer-profile-v1.ps1':'./fixtures/installSovereignReviewerProfileV1.fixture.txt',
});
function blob(content){const bytes=Buffer.from(content,'utf8');return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
async function exactSources(){
  const rows=[];
  for(const path of PATHS){
    const content=await readFile(new URL(FIXTURES[path],import.meta.url),'utf8');
    assert.equal(blob(content),BLOBS[path],path);
    rows.push({schemaVersion:'stephanos.windows-authority-source.v1',repository:REPOSITORY,
      path,ref:HEAD,exists:true,size:Buffer.byteLength(content,'utf8'),blobSha:blob(content),content});
  }
  return rows;
}
function lineage(overrides={}){
  return {schemaVersion:'stephanos.windows-authority-reconciliation-lineage.v1',repository:REPOSITORY,
    sourceHead:HEAD,sourceCommitSha:HEAD,baseSha:BASE,liveMainBeforeSha:BASE,liveMainAfterSha:BASE,
    parents:['c'.repeat(40)],comparison:{status:'ahead',aheadBy:2,behindBy:0,baseCommitSha:BASE,mergeBaseCommitSha:BASE},...overrides};
}
function input(overrides={}){
  return {repository:REPOSITORY,prNumber:3439,branch:BRANCH,sourceHead:HEAD,baseSha:BASE,
    analysis:{findings:PATHS.map(path=>({severity:'P0',code:'unsupported-high-risk-surface',path})),
      counts:{P0:3,P1:0,P2:0}},lineageEvidence:lineage(),sources:[],...overrides};
}

test('exact #3439 Reviewer Windows bootstrap is clean only for the pinned three-file estate',async()=>{
  const result=analyze(input({sources:await exactSources()}));
  assert.equal(result.eligible,true);assert.equal(result.clean,true,JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths,PATHS);
  for(const key of ['sourceMutationAllowed','mergeAuthority','runtimeMutationAllowed','providerQualificationAuthority',
    'installerExecutionAuthority','accountCreationAuthority','signingAuthority']) assert.equal(result[key],false,key);
});

test('missing altered or extra source evidence fails closed',async()=>{
  const sources=await exactSources();
  for(let i=0;i<sources.length;i+=1){
    const changed=sources.map(row=>({...row}));
    changed[i].content+='\n// changed\n';changed[i].size=Buffer.byteLength(changed[i].content,'utf8');changed[i].blobSha=blob(changed[i].content);
    const result=analyze(input({sources:changed}));
    assert.equal(result.eligible,true);assert.equal(result.clean,false);
    assert.ok(result.findings.some(x=>x.code==='reviewer-profile-specialist-exact-source-not-pinned'));
  }
  assert.equal(analyze(input({sources:sources.slice(1)})).clean,false);
  assert.equal(analyze(input({sources:[...sources,{...sources[0],path:'scripts/windows/extra.ps1'}]})).clean,false);
});

test('wrong PR branch escalation or moving-main lineage never enters the profile',async()=>{
  const sources=await exactSources();
  assert.equal(analyze(input({prNumber:3440,sources})).eligible,false);
  assert.equal(analyze(input({branch:'other',sources})).eligible,false);
  const partial=input({sources});partial.analysis={findings:partial.analysis.findings.slice(0,2),counts:{P0:2,P1:0,P2:0}};
  assert.equal(analyze(partial).eligible,false);
  assert.equal(analyze(input({sources,lineageEvidence:lineage({liveMainAfterSha:'d'.repeat(40)})})).eligible,false);
});
