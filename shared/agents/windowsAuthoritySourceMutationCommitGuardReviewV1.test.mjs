import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1,
  analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1,
} from './windowsAuthoritySourceMutationCommitGuardReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const repository='Cheekyfellastef/stephan-os';
const path=WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1[0];
const head='a'.repeat(40);

function blobSha(content){
  const bytes=Buffer.from(content,'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\\0`).update(bytes).digest('hex');
}

function source(content, blobShaOverride=''){
  return {
    schemaVersion:'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref:head,
    exists:true,
    size:Buffer.byteLength(content,'utf8'),
    blobSha:blobShaOverride || blobSha(content),
    content,
  };
}

function analysis(){
  return {
    schemaVersion:'stephanos.independent-security-analysis.v1',
    findings:[{severity:'P0',code:'unsupported-high-risk-surface',summary:'Separate qualified specialist review required.',path}],
    counts:{P0:1,P1:0,P2:0},
    verdict:'findings',
    proofRefs:[],
    finalVerdict:'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  };
}

function input(content, overrides={}){
  return {
    repository,
    prNumber:2863,
    branch:'repair/source-mutation-lease-commit-guard-20261007',
    sourceHead:head,
    baseSha:'b'.repeat(40),
    analysis:analysis(),
    sources:[source(content, '5f6184f23b3d9e3758c78c1debfca9052524e67b')],
    ...overrides,
  };
}

test('specialist is scoped to exactly the source mutation guard installer',()=>{
  assert.deepEqual(WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1,[path]);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input('',{prNumber:2864})).eligible,false);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input('',{branch:'other'})).eligible,false);
});

test('top-level specialist routes the exact #2863 escalation before fallback', async()=>{
  const { readFile }=await import('node:fs/promises');
  const content=await readFile(new URL('../../scripts/windows/install-source-mutation-commit-guard.ps1',import.meta.url),'utf8');
  const result=analyzeWindowsAuthoritySpecialistReview(input(content));
  assert.equal(result.eligible,true);
  assert.equal(result.clean,true,JSON.stringify(result.findings));
  assert.equal(result.finalVerdict,'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths,[path]);
});

test('specialist rejects widened installer authority', async()=>{
  const { readFile }=await import('node:fs/promises');
  const content=await readFile(new URL('../../scripts/windows/install-source-mutation-commit-guard.ps1',import.meta.url),'utf8');
  for(const [mutation,expected] of [
    [content+'\nStart-Process powershell.exe\n','source-mutation-guard-dynamic-execution-forbidden'],
    [content+'\ngit push origin main\n','source-mutation-guard-git-authority-widened'],
    [content.replace("mergeAuthority=$false","mergeAuthority=$true"),'source-mutation-guard-merge-authority-denial-missing'],
    [content.replace("ls-files --stage '.githooks/pre-merge-commit'","ls-files '.githooks/pre-merge-commit'"),'source-mutation-guard-pre-merge-mode-proof-missing'],
  ]){
    const result=analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input(mutation,{sources:[source(mutation)]}));
    assert.equal(result.eligible,true);
    assert.equal(result.clean,false);
    assert.ok(result.findings.some(item=>item.code===expected),expected);
  }
});
