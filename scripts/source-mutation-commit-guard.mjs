#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SOURCE_MUTATION_COMMIT_GUARD_SCHEMA='stephanos.source-mutation-commit-guard.v1';
export const SOURCE_MUTATION_LEASE_SCHEMA='stephanos.source-mutation-lease.v1';
export const SOURCE_MUTATION_REPOSITORY='Cheekyfellastef/stephan-os';
const SHA=/^[0-9a-f]{40}$/i;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/;
const text=(v)=>String(v??'').trim();
const fail=(blocker,details={})=>Object.freeze({ok:false,blocker,finalVerdict:'SOURCE_MUTATION_COMMIT_BLOCKED',...details,mergeAuthority:false,leaseSeizureAllowed:false});
const time=(v)=>{const ms=Date.parse(text(v));return Number.isFinite(ms)?ms:NaN;};

export function evaluateSourceMutationCommitGuard({branch='',headSha='',lease=null,nowMs=Date.now(),leaseHeadIsAncestor=false}={}){
  const currentBranch=text(branch), currentHead=text(headSha).toLowerCase();
  if(!currentBranch)return fail('SOURCE_MUTATION_BRANCH_UNPROVEN');
  if(currentBranch==='main')return fail('SOURCE_MUTATION_ON_LOCAL_MAIN_FORBIDDEN');
  if(!SHA.test(currentHead))return fail('SOURCE_MUTATION_HEAD_UNPROVEN');
  if(!lease||typeof lease!=='object'||Array.isArray(lease))return fail('SOURCE_MUTATION_LEASE_MISSING');
  if(lease.schema!==SOURCE_MUTATION_LEASE_SCHEMA)return fail('SOURCE_MUTATION_LEASE_SCHEMA_INVALID');
  if(text(lease.status).toUpperCase()!=='ACTIVE')return fail('SOURCE_MUTATION_LEASE_NOT_ACTIVE');
  if(text(lease.repository)!==SOURCE_MUTATION_REPOSITORY)return fail('SOURCE_MUTATION_LEASE_REPOSITORY_MISMATCH');
  if(text(lease.branch)!==currentBranch)return fail('SOURCE_MUTATION_LEASE_BRANCH_MISMATCH');
  const leaseHead=text(lease.headSha).toLowerCase();
  if(!SHA.test(leaseHead)||leaseHeadIsAncestor!==true)return fail('SOURCE_MUTATION_LEASE_HEAD_NOT_ANCESTOR');
  if(!TOKEN.test(text(lease.leaseId))||!TOKEN.test(text(lease.laneId))||!TOKEN.test(text(lease.ownerId)))return fail('SOURCE_MUTATION_LEASE_IDENTITY_INVALID');
  const acquired=time(lease.acquiredAtUtc), renewed=time(lease.renewedAtUtc), expires=time(lease.expiresAtUtc);
  if(![acquired,renewed,expires].every(Number.isFinite))return fail('SOURCE_MUTATION_LEASE_TIME_INVALID');
  if(acquired>nowMs+30000||renewed>nowMs+30000)return fail('SOURCE_MUTATION_LEASE_FROM_FUTURE');
  if(expires<=nowMs)return fail('SOURCE_MUTATION_LEASE_EXPIRED');
  if(renewed<acquired||expires<=renewed)return fail('SOURCE_MUTATION_LEASE_TIME_ORDER_INVALID');
  if(lease.mergeAuthority!==false||lease.leaseSeizureAllowed!==false)return fail('SOURCE_MUTATION_LEASE_AUTHORITY_WIDENED');
  return Object.freeze({ok:true,blocker:'',schemaVersion:SOURCE_MUTATION_COMMIT_GUARD_SCHEMA,branch:currentBranch,headSha:currentHead,leaseId:text(lease.leaseId),laneId:text(lease.laneId),ownerId:text(lease.ownerId),expiresAtUtc:new Date(expires).toISOString(),finalVerdict:'SOURCE_MUTATION_COMMIT_ALLOWED',mergeAuthority:false,leaseSeizureAllowed:false});
}
function git(root,args){
  const exe=process.platform==='win32'?'C:\\Program Files\\Git\\cmd\\git.exe':'git';
  const r=spawnSync(exe,['-C',root,...args],{encoding:'utf8',shell:false,windowsHide:true,timeout:30000,maxBuffer:256*1024});
  return Object.freeze({ok:!r.error&&r.status===0,stdout:String(r.stdout||'').trim()});
}
export function runSourceMutationCommitGuard({repoRoot=resolve(fileURLToPath(new URL('..',import.meta.url))),workspaceRoot=process.env.STEPHANOS_SHARED_AGENT_WORKSPACE||process.env.STEPHANOS_SHARED_WORKSPACE_ROOT||join(process.env.USERPROFILE||homedir(),'Documents','Stephanos-openclaw-workspace'),nowMs=Date.now()}={}){
  const b=git(repoRoot,['branch','--show-current']), h=git(repoRoot,['rev-parse','HEAD']);
  if(!b.ok||!h.ok)return fail('SOURCE_MUTATION_GIT_IDENTITY_UNPROVEN');
  const branch=b.stdout, headSha=h.stdout.toLowerCase(), leasePath=join(workspaceRoot,'status','source-mutation-lease-current.json');
  let lease; try{lease=JSON.parse(readFileSync(leasePath,'utf8'));}catch{return fail('SOURCE_MUTATION_LEASE_MISSING',{branch,headSha});}
  const leaseHead=text(lease?.headSha).toLowerCase();
  const ancestry=SHA.test(leaseHead)?git(repoRoot,['merge-base','--is-ancestor',leaseHead,headSha]):{ok:false};
  return evaluateSourceMutationCommitGuard({branch,headSha,lease,nowMs,leaseHeadIsAncestor:ancestry.ok});
}
async function main(){const r=runSourceMutationCommitGuard();process.stdout.write(JSON.stringify(r)+'\n');process.exitCode=r.ok?0:75;}
const invoked=process.argv[1]?resolve(process.argv[1]):'';
if(invoked&&invoked===resolve(fileURLToPath(import.meta.url)))main().catch((e)=>{process.stderr.write(String(e?.message||e)+'\n');process.exitCode=75;});
