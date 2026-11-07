#!/usr/bin/env node
// Fixed entry of the protected native reviewer profile. Review heads are DATA;
// all producer/model/calibration logic comes from the installed closed graph.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureAuthenticatedReviewDiffV1 } from '../shared/agents/sovereignAuthenticatedReviewDiffV1.mjs';
import { resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration }
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { installedReviewerRequestEnvironmentV1, SOVEREIGN_INSTALLED_REVIEWER_HOST_V1,
  SOVEREIGN_REVIEWER_DATA_ROOT_V1, SOVEREIGN_REVIEWER_WORKSPACE_V1 }
  from '../shared/agents/sovereignInstalledReviewerProfileV1.mjs';
import { runSovereignHighRiskAdvisoryV1, localCompleteHighRiskModelV1, observeCompleteHighRiskOllamaDigestV1 }
  from './sovereign-high-risk-advisory-v1.mjs';
import { runWindowsCalibrationCandidateV1 } from './sovereign-windows-review-calibration-v1-engine.mjs';
import { runSovereignReviewCoverageV1 } from './sovereign-review-coverage-v1-engine.mjs';
import { projectWindowsCalibrationForRemoteV1 } from '../shared/agents/sovereignWindowsCalibrationRemoteV1.mjs';

export function captureInstalledReviewerDataV1(input=process.env, {
  root=SOVEREIGN_REVIEWER_DATA_ROOT_V1, platform=process.platform, run=spawnSync,
  git=resolveBattleBridgeGitExecution({platform,environment:{}}),
}={}) {
  const env=installedReviewerRequestEnvironmentV1(input);
  const read=args=>{
    const r=run(git.executable,[...git.fixedConfigArgs,'-C',root,...args],
      {encoding:'utf8',shell:false,windowsHide:true,env:git.environment,timeout:12000,maxBuffer:16384});
    if(r.error||r.status!==0||typeof r.stdout!=='string')throw Error('INSTALLED_REVIEWER_DATA_UNPROVEN');
    return r.stdout;
  };
  if(!validateBattleBridgeLocalGitConfiguration(read(['config','--local','--null','--list','--no-includes'])).ok)
    throw Error('INSTALLED_REVIEWER_GIT_CONFIGURATION_UNSAFE');
  const head=env.STEPHANOS_REVIEW_EXACT_HEAD,base=env.STEPHANOS_REVIEW_EXACT_BASE;
  // A candidate branch may coexist with canonical main. It is never checked
  // out or imported. Its remote ref is metadata; every object is rehashed below.
  if(read(['rev-parse','--verify','refs/remotes/origin/'+env.STEPHANOS_REVIEW_EXACT_BRANCH]).trim()!==head)
    throw Error('INSTALLED_REVIEWER_BRANCH_HEAD_CHANGED');
  read(['merge-base','--is-ancestor',base,head]);
  const data=captureAuthenticatedReviewDiffV1({root,head,base,git,run});
  return Object.freeze({...data,repository:env.STEPHANOS_REVIEW_REPOSITORY,
    issueNumber:Number(env.STEPHANOS_REVIEW_ISSUE),prNumber:Number(env.STEPHANOS_REVIEW_PR),
    branch:env.STEPHANOS_REVIEW_EXACT_BRANCH,sourceHead:head,baseSha:base,
    reviewerSessionId:env.STEPHANOS_REVIEW_SESSION,
    implementerSessionId:env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION,
    // An alias/digest observation does not prove architecture or parameter size.
    implementerProvider:env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER,modelClass:'unqualified-local-ollama'});
}

function nativeRead(mode,{run=spawnSync,platform=process.platform}={}) {
  if(platform!=='win32')throw Error('INSTALLED_REVIEWER_NATIVE_REQUIRED');
  const prefix=mode==='inspect'?'SOVEREIGN_REVIEWER_PROFILE_V1=':'SOVEREIGN_REVIEWER_GOVERNOR_V1=';
  const r=run(SOVEREIGN_INSTALLED_REVIEWER_HOST_V1,['--'+mode],{encoding:'utf8',shell:false,
    windowsHide:true,timeout:mode==='governor'?1000:10000,maxBuffer:16384,
    env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:'C:\\Windows\\System32;C:\\Windows'}});
  if(r.error||r.status!==0||typeof r.stdout!=='string')throw Error('INSTALLED_REVIEWER_NATIVE_READ_UNPROVEN');
  const lines=r.stdout.trim().split(/\r?\n/);
  if(lines.length!==1||!lines[0].startsWith(prefix))throw Error('INSTALLED_REVIEWER_NATIVE_READ_UNPROVEN');
  const result=JSON.parse(lines[0].slice(prefix.length));
  if(!result||result.qualified!==false||result.independentPrincipalObserved!==false)
    throw Error('INSTALLED_REVIEWER_NATIVE_READ_UNPROVEN');
  return result;
}
export function inspectInstalledReviewerSourceV1(expectedHead, options={}) {
  try{
    const r=nativeRead('inspect',options);
    return r.schemaVersion==='stephanos.reviewer-profile-observation.v1'
      && r.codeCustodyObserved===true&&r.sourceHead===expectedHead
      && r.principalMatchesProfile===true&&r.principalAdministrator===false;
  }catch{return false;}
}
export function inspectInstalledReviewerGamingV1(_env,options={}) {
  try{
    const r=nativeRead('governor',options);
    const schema=r.schemaVersion==='stephanos.reviewer-governor-observation.v1';
    const standard=schema&&r.allowed===true&&r.largeContextCustodyObserved===false&&r.contextTokens===8192;
    const large=schema&&r.allowed===true&&r.largeContextCustodyObserved===true&&r.contextTokens===262144;
    const ok=standard||large;
    return Object.freeze({ok,reason:ok?'':'HIGH_RISK_GAMING_RESOURCE_PROTECTED',
      largeContextCustodyObserved:large,contextTokens:ok?r.contextTokens:0});
  }catch{return Object.freeze({ok:false,reason:'HIGH_RISK_GOVERNOR_UNAVAILABLE',
    largeContextCustodyObserved:false,contextTokens:0});}
}

async function main() {
  const entry=process.argv[2];
  if(process.argv.length!==3||!['advisory','windows-calibration','windows-calibration-remote','coverage'].includes(entry))
    throw Error('INSTALLED_REVIEWER_FIXED_ENTRY_REQUIRED');
  const manifest=JSON.parse(readFileSync(new URL('../../manifest.json',import.meta.url),'utf8'));
  const expectedHead=manifest.SourceHead;
  const sourceCheck=()=>inspectInstalledReviewerSourceV1(expectedHead);
  if(!sourceCheck())throw Error('INSTALLED_REVIEWER_CODE_CUSTODY_UNPROVEN');
  const env={...installedReviewerRequestEnvironmentV1(process.env),
    STEPHANOS_SHARED_AGENT_WORKSPACE:SOVEREIGN_REVIEWER_WORKSPACE_V1};
  const snapshot=()=>captureInstalledReviewerDataV1(env);
  const gamingGuard=()=>inspectInstalledReviewerGamingV1(env).ok;
  let result;
  if(entry==='advisory') {
    const observeModel=async (model,options)=>{
      if(!gamingGuard())throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
      return observeCompleteHighRiskOllamaDigestV1(model,options);
    };
    result=await runSovereignHighRiskAdvisoryV1({env,root:SOVEREIGN_REVIEWER_DATA_ROOT_V1,snapshot,
      reviewMode:'complete-diff',observeModel,
      invokeCompleteModel:(prompt,packet,options)=>localCompleteHighRiskModelV1(prompt,packet,env,
        {...options,platform:'win32',gamingGuard:inspectInstalledReviewerGamingV1})});
  }else if(entry==='coverage') {
    result=runSovereignReviewCoverageV1(env,{snapshot});
  }else{
    result=await runWindowsCalibrationCandidateV1(env,{platform:'win32',snapshot,sourceCheck,
      gamingGuard});
    if(entry==='windows-calibration-remote')result=projectWindowsCalibrationForRemoteV1(result);
  }
  // The host independently supplies profile observation on --inspect only.
  // Candidate receipts preserve their original closed schema and false authority.
  if(!sourceCheck())throw Error('INSTALLED_REVIEWER_CODE_CUSTODY_CHANGED');
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(()=>{process.exitCode=1;});
}
