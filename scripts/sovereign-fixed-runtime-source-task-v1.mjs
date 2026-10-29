// Internal stdin-only entry. The compiled fixed host alone selects this driver.
// This file produces data; it never claims, publishes escrow, or terminalizes work.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFile, lstat, open, link, unlink} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {produceProviderNeutralSourceBuildProposalV1} from '../stephanos-server/services/providerNeutralSourceBuilderService.js';
import {createBattleBridgeMinimalChildEnvironment, battleBridgeGitFixedConfigArgs} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import {inspectStephanosNativeCapacityGamingAdmissionV1} from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
const SCHEMA='stephanos.fixed-source-task-input.v1';
const QUEUE='C:\\Users\\Stephan Callear\\Documents\\OpenClaw-Standalone\\mission-runner\\orchestrator\\worker-queue';
const WORKSPACE='C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace';
const CANONICAL='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const MARKER='SOVEREIGN_RUNTIME_SOURCE_PROPOSAL_V1=';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1=4*1024*1024;
export function createFixedSourceTaskRunnerV1({worktreePath,processingPath,remainingMs}) {
  if(!Number.isSafeInteger(remainingMs) || remainingMs<60000 || remainingMs>1770000)
    throw new Error('SOURCE_TASK_NATIVE_WINDOW_REQUIRED');
  const end=performance.now()+remainingMs; let verificationSpent=0;
  const root=resolve(worktreePath),index=resolve(processingPath+'.source-artifact-index');
  return (executable,args,options={})=>{
    if(!Array.isArray(args) || args.some(a=>typeof a!=='string') || resolve(options.cwd||'')!==root)
      throw new Error('SOURCE_TASK_FIXED_RUNNER_IDENTITY_REQUIRED');
    const git=executable==='git.exe',node=executable==='node.exe';
    if(!git && !node) throw new Error('SOURCE_TASK_FIXED_EXECUTABLE_REQUIRED');
    const remaining=Math.floor(end-(node?30000:15000)-performance.now());
    const verificationRemaining=300000-verificationSpent;
    if(remaining<1) throw new Error('SOURCE_TASK_BOUNDED_EXECUTION_DEADLINE');
    const env={...createBattleBridgeMinimalChildEnvironment(process.env,{git})};
    if(git && options.env?.GIT_INDEX_FILE!==undefined) {
      if(resolve(options.env.GIT_INDEX_FILE)!==index) throw new Error('SOURCE_TASK_PRIVATE_INDEX_UNBOUND');
      env.GIT_INDEX_FILE=index;
    }
    if(node && verificationRemaining<1) throw new Error('SOURCE_TASK_VERIFICATION_BUDGET_EXHAUSTED');
    const started=performance.now();
    const result=spawnSync(git?'C:\\Program Files\\Git\\cmd\\git.exe':'C:\\Program Files\\nodejs\\node.exe',
      git?[...battleBridgeGitFixedConfigArgs(),...args]:args,
      {cwd:root,env,shell:false,windowsHide:true,encoding:options.encoding===null?null:'utf8',
        timeout:Math.max(1,Math.floor(Math.min(git?30000:verificationRemaining,remaining))),maxBuffer:4*1024*1024});
    if(node)verificationSpent+=performance.now()-started;
    return result;
  };
}
async function readInput() {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>32768)throw new Error('SOURCE_TASK_INPUT_BOUND');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function main() {
  let input;
  try {
    input=await readInput();
    if(input?.schemaVersion!==SCHEMA || Object.keys(input).sort().join(',')!==
      'actionId,claimSha256,frameSha256,missionId,remainingMs,requestId,schemaVersion,sourceHead' ||
      !['actionId','missionId','requestId'].every(k=>/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input[k]??'')) ||
      !['claimSha256','frameSha256'].every(k=>/^[a-f0-9]{64}$/.test(input[k]??'')) ||
      !/^[a-f0-9]{40}$/.test(input.sourceHead??'')) throw new Error('SOURCE_TASK_NATIVE_INPUT_UNPROVEN');
    const processingPath=join(QUEUE,'foundry-forge','processing',input.actionId+'.json');
    const info=await lstat(processingPath);
    if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>131072) throw new Error('SOURCE_TASK_CLAIM_UNSAFE');
    const bytes=await readFile(processingPath);
    if(hash(bytes)!==input.claimSha256) throw new Error('SOURCE_TASK_CLAIM_CHANGED');
    const item=JSON.parse(bytes), action=item.payload;
    if(item.actionId!==input.actionId || item.missionId!==input.missionId) throw new Error('SOURCE_TASK_CLAIM_IDENTITY_CHANGED');
    const admission=inspectStephanosNativeCapacityGamingAdmissionV1({workspaceRoot:WORKSPACE,repoRoot:CANONICAL});
    if(!admission.ok) throw new Error(admission.reason||'SOURCE_TASK_RESOURCE_ADMISSION_REQUIRED');
    const run=createFixedSourceTaskRunnerV1({worktreePath:action.worktreePath,processingPath,remainingMs:input.remainingMs});
    const end=performance.now()+input.remainingMs;
    const proposal=await produceProviderNeutralSourceBuildProposalV1({adapter:'foundry-forge',processingPath,item},{
      sharedWorkspaceRoot:WORKSPACE,repoRoot:CANONICAL,actionGrant:item.actionGrant,runCommand:run,
      localModelFetchImpl:(url,options)=>{
        const remaining=Math.floor(end-performance.now()-360000);
        if(remaining<1)throw new Error('SOURCE_TASK_MODEL_WINDOW_EXHAUSTED');
        const signal=AbortSignal.timeout(Math.min(600000,remaining));
        return fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,signal]):signal});
      },
    });
    const envelope={schemaVersion:'stephanos.fixed-source-task-proposal.v1',requestId:input.requestId,
      actionId:input.actionId,missionId:input.missionId,claimSha256:input.claimSha256,
      frameSha256:input.frameSha256,sourceHead:input.sourceHead,rootPid:process.pid,proposal};
    const content=Buffer.from(JSON.stringify(envelope));
    if(content.length>FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1)throw new Error('SOURCE_TASK_PROPOSAL_BOUND_EXCEEDED');
    // .proposal deliberately cannot be mistaken for a pending/processing queue item.
    const proposalPath=processingPath+'.source-task-'+input.requestId+'.proposal';
    const staging=proposalPath+'.pending';
    const file=await open(staging,'wx',0o600);
    try{await file.writeFile(content);await file.sync();}finally{await file.close();}
    // Atomic no-replace publication; cleanup completes before terminal output.
    // Interruption between link/unlink leaves nlink=2 and parent fails closed.
    await link(staging,proposalPath);
    await unlink(staging);
    console.log(MARKER+JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal-reference.v1',
      requestId:input.requestId,claimSha256:input.claimSha256,proposalSha256:hash(content),
      proposalBytes:content.length,proposalName:input.actionId+'.json.source-task-'+input.requestId+'.proposal',
      sourceState:proposal.sourceState,success:proposal.success===true}));
    process.exitCode=proposal.success===true?0:2;
  } catch(error) {
    console.log(MARKER+JSON.stringify({schemaVersion:'stephanos.fixed-source-task-proposal-reference.v1',
      requestId:input?.requestId??'',success:false,proposalAvailable:false,sourceState:'UNKNOWN',
      reason:/^[A-Z0-9_]{1,96}$/.test(error.message)?error.message:'SOURCE_TASK_PROPOSAL_INCOMPLETE'}));
    process.exitCode=2;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
