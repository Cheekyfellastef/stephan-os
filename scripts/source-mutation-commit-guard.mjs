#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateSourceMutationLease } from '../shared/agents/programmeAuthorityV1.mjs';
import { readSourceMutationLease } from '../stephanos-server/services/programmeAuthorityService.js';

export const SOURCE_MUTATION_COMMIT_GUARD_SCHEMA='stephanos.source-mutation-commit-guard.v1';
export const SOURCE_MUTATION_LEASE_SCHEMA='stephanos.source-mutation-lease.v1';
export const SOURCE_MUTATION_REPOSITORY='Cheekyfellastef/stephan-os';
const SHA=/^[0-9a-f]{40}$/i;
const text=(v)=>String(v??'').trim();
const fail=(blocker,details={})=>Object.freeze({ok:false,blocker,finalVerdict:'SOURCE_MUTATION_COMMIT_BLOCKED',...details,mergeAuthority:false,leaseSeizureAllowed:false});

export function evaluateSourceMutationCommitGuard({branch='',headSha='',lease=null,nowMs=Date.now(),leaseHeadIsAncestor=false}={}){
  const currentBranch=text(branch), currentHead=text(headSha).toLowerCase();
  if(!currentBranch)return fail('SOURCE_MUTATION_BRANCH_UNPROVEN');
  if(currentBranch==='main')return fail('SOURCE_MUTATION_ON_LOCAL_MAIN_FORBIDDEN');
  if(!SHA.test(currentHead))return fail('SOURCE_MUTATION_HEAD_UNPROVEN');
  if(!lease||typeof lease!=='object'||Array.isArray(lease))return fail('SOURCE_MUTATION_LEASE_MISSING');

  const nowUtc=new Date(nowMs).toISOString();
  const validation=validateSourceMutationLease(lease,{
    nowUtc,
    expected:{
      repository:SOURCE_MUTATION_REPOSITORY,
      branch:currentBranch,
    },
  });
  if(!validation.valid){
    return fail('SOURCE_MUTATION_LEASE_INVALID',{leaseErrors:validation.errors});
  }
  if(!validation.active)return fail('SOURCE_MUTATION_LEASE_EXPIRED');
  const leaseHead=text(lease.headSha).toLowerCase();
  if(!SHA.test(leaseHead)||leaseHeadIsAncestor!==true)return fail('SOURCE_MUTATION_LEASE_HEAD_NOT_ANCESTOR');
  return Object.freeze({
    ok:true,
    blocker:'',
    schemaVersion:SOURCE_MUTATION_COMMIT_GUARD_SCHEMA,
    branch:currentBranch,
    headSha:currentHead,
    leaseId:text(lease.leaseId),
    laneId:text(lease.laneId),
    ownerId:text(lease.ownerId),
    expiresAtUtc:text(lease.expiresAtUtc),
    finalVerdict:'SOURCE_MUTATION_COMMIT_ALLOWED',
    mergeAuthority:false,
    leaseSeizureAllowed:false,
  });
}
function git(root,args){
  const exe=process.platform==='win32'?'C:\\Program Files\\Git\\cmd\\git.exe':'git';
  const r=spawnSync(exe,['-C',root,...args],{encoding:'utf8',shell:false,windowsHide:true,timeout:30000,maxBuffer:256*1024});
  return Object.freeze({ok:!r.error&&r.status===0,stdout:String(r.stdout||'').trim()});
}
export async function runSourceMutationCommitGuard({
  repoRoot=resolve(fileURLToPath(new URL('..',import.meta.url))),
  workspaceRoot=process.env.STEPHANOS_SHARED_AGENT_WORKSPACE||process.env.STEPHANOS_SHARED_WORKSPACE_ROOT||join(process.env.USERPROFILE||homedir(),'Documents','Stephanos-openclaw-workspace'),
  nowMs=Date.now(),
}={}){
  const b=git(repoRoot,['branch','--show-current']), h=git(repoRoot,['rev-parse','HEAD']);
  if(!b.ok||!h.ok)return fail('SOURCE_MUTATION_GIT_IDENTITY_UNPROVEN');
  const branch=b.stdout, headSha=h.stdout.toLowerCase();
  if(branch==='main')return fail('SOURCE_MUTATION_ON_LOCAL_MAIN_FORBIDDEN',{branch,headSha});

  const observed=await readSourceMutationLease({
    root:workspaceRoot,
    repoRoot,
    nowUtc:new Date(nowMs).toISOString(),
  });
  if(!observed.ok||!observed.present){
    return fail(observed.reason||'SOURCE_MUTATION_LEASE_MISSING',{branch,headSha});
  }
  const lease=observed.record;
  const leaseHead=text(lease?.headSha).toLowerCase();
  const ancestry=SHA.test(leaseHead)?git(repoRoot,['merge-base','--is-ancestor',leaseHead,headSha]):{ok:false};
  return evaluateSourceMutationCommitGuard({branch,headSha,lease,nowMs,leaseHeadIsAncestor:ancestry.ok});
}
async function main(){const r=await runSourceMutationCommitGuard();process.stdout.write(JSON.stringify(r)+'\n');process.exitCode=r.ok?0:75;}
const invoked=process.argv[1]?resolve(process.argv[1]):'';
if(invoked&&invoked===resolve(fileURLToPath(import.meta.url)))main().catch((e)=>{process.stderr.write(String(e?.message||e)+'\n');process.exitCode=75;});
