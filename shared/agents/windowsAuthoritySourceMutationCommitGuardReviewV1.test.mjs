import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1,
  analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1,
} from './windowsAuthoritySourceMutationCommitGuardReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const repository='Cheekyfellastef/stephan-os';
const path=WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1[0];
const head='a'.repeat(40);
// Use the canonical merged installer bytes directly so this proof cannot drift through
// hand-reconstructed PowerShell escaping or line-ending conversion.
const installer=await readFile(new URL('../../scripts/windows/install-source-mutation-commit-guard.ps1',import.meta.url),'utf8');

function source(content=installer){
  const bytes=Buffer.from(content,'utf8');
  return {
    schemaVersion:'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref:head,
    exists:true,
    size:bytes.length,
    blobSha:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),
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

function input(overrides={}){
  return {
    repository,
    prNumber:2863,
    branch:'repair/source-mutation-lease-commit-guard-20261007',
    sourceHead:head,
    baseSha:'b'.repeat(40),
    analysis:analysis(),
    sources:[source()],
    ...overrides,
  };
}

test('canonical merged installer bytes match the immutable specialist pin',()=>{
  assert.equal(source().blobSha,'5f6184f23b3d9e3758c78c1debfca9052524e67b');
});

test('specialist is scoped to exactly the source mutation guard installer',()=>{
  assert.deepEqual(WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1,[path]);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({prNumber:2864})).eligible,false);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({branch:'other'})).eligible,false);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({analysis:{findings:[]}})).eligible,false);
});

test('positive fixture is the immutable reviewed installer blob',()=>{
  assert.equal(source().blobSha,'5f6184f23b3d9e3758c78c1debfca9052524e67b');
  assert.equal(source().ref,head);
});

test('top-level specialist routes the exact #2863 escalation before fallback',()=>{
  const result=analyzeWindowsAuthoritySpecialistReview(input());
  assert.equal(result.eligible,true);
  assert.equal(result.clean,true,JSON.stringify(result.findings));
  assert.equal(result.finalVerdict,'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths,[path]);
});

test('specialist requires the immutable reviewed installer blob',()=>{
  const changed=installer.replace('mergeAuthority=$false','mergeAuthority=$true');
  const result=analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({sources:[source(changed)]}));
  assert.equal(result.eligible,true);
  assert.equal(result.clean,false);
  assert.equal(result.findings[0]?.code,'windows-authority-source-mutation-commit-guard-source-evidence-invalid');
});

test('specialist source contains bounded authority checks and hostile guards',async()=>{
  const specialist=await readFile(new URL('./windowsAuthoritySourceMutationCommitGuardReviewV1.mjs',import.meta.url),'utf8');
  for(const token of [
    'source-mutation-guard-pre-merge-mode-proof-missing',
    'source-mutation-guard-executable-mode-gate-missing',
    'source-mutation-guard-hooks-path-proof-missing',
    'source-mutation-guard-dynamic-execution-forbidden',
    'source-mutation-guard-git-authority-widened',
    'source-mutation-guard-host-authority-widened',
    'source-mutation-guard-network-authority-forbidden',
    '5f6184f23b3d9e3758c78c1debfca9052524e67b',
  ]) assert.ok(specialist.includes(token),token);
});// Read the exact reviewed installer from this branch so the positive proof uses Git's canonical bytes.
const installer=await readFile(new URL('../../scripts/windows/install-source-mutation-commit-guard.ps1',import.meta.url),'utf8');

function source(content=installer){
  const bytes=Buffer.from(content,'utf8');
  return {
    schemaVersion:'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref:head,
    exists:true,
    size:bytes.length,
    blobSha:createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex'),
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

function input(overrides={}){
  return {
    repository,
    prNumber:2863,
    branch:'repair/source-mutation-lease-commit-guard-20261007',
    sourceHead:head,
    baseSha:'b'.repeat(40),
    analysis:analysis(),
    sources:[source()],
    ...overrides,
  };
}

test('canonical merged installer bytes match the immutable specialist pin',()=>{
  assert.equal(source().blobSha,'5f6184f23b3d9e3758c78c1debfca9052524e67b');
});

test('specialist is scoped to exactly the source mutation guard installer',()=>{
  assert.deepEqual(WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_PATHS_V1,[path]);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({prNumber:2864})).eligible,false);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({branch:'other'})).eligible,false);
  assert.equal(analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({analysis:{findings:[]}})).eligible,false);
});

test('positive fixture is the immutable reviewed installer blob',()=>{
  assert.equal(source().blobSha,'5f6184f23b3d9e3758c78c1debfca9052524e67b');
  assert.equal(source().ref,head);
});

test('top-level specialist routes the exact #2863 escalation before fallback',()=>{
  const result=analyzeWindowsAuthoritySpecialistReview(input());
  assert.equal(result.eligible,true);
  assert.equal(result.clean,true,JSON.stringify(result.findings));
  assert.equal(result.finalVerdict,'WINDOWS_AUTHORITY_SOURCE_MUTATION_COMMIT_GUARD_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths,[path]);
});

test('specialist requires the immutable reviewed installer blob',()=>{
  const changed=installer.replace('mergeAuthority=$false','mergeAuthority=$true');
  const result=analyzeWindowsAuthoritySourceMutationCommitGuardReviewV1(input({sources:[source(changed)]}));
  assert.equal(result.eligible,true);
  assert.equal(result.clean,false);
  assert.equal(result.findings[0]?.code,'windows-authority-source-mutation-commit-guard-source-evidence-invalid');
});

test('specialist source contains bounded authority checks and hostile guards',async()=>{
  const specialist=await readFile(new URL('./windowsAuthoritySourceMutationCommitGuardReviewV1.mjs',import.meta.url),'utf8');
  for(const token of [
    'source-mutation-guard-pre-merge-mode-proof-missing',
    'source-mutation-guard-executable-mode-gate-missing',
    'source-mutation-guard-hooks-path-proof-missing',
    'source-mutation-guard-dynamic-execution-forbidden',
    'source-mutation-guard-git-authority-widened',
    'source-mutation-guard-host-authority-widened',
    'source-mutation-guard-network-authority-forbidden',
    '5f6184f23b3d9e3758c78c1debfca9052524e67b',
  ]) assert.ok(specialist.includes(token),token);
});
