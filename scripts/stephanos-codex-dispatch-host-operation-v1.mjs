#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { battleBridgeCanonicalRepositoryArgs, resolveBattleBridgeGitExecution,
  createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const FRESH_HOST_OPERATION_SCHEMA = 'stephanos.codex-dispatch-fresh-host-operation.v1';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha = /^[a-f0-9]{40}$/;
const operations = new Set(['sync', 'update']);
export function validateFreshHostOperation(operation, args) {
  if (!operations.has(operation) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('HOST_OPERATION_NOT_ALLOWED');
  const allowed = operation === 'sync'
    ? ['operatorApproval','expectedBranch','preservationProfile','preservationApproval'] : ['operatorApproval','expectedBranch'];
  if (Object.keys(args).some(k=>!allowed.includes(k)) || args.operatorApproval !== 'operator-approved'
    || (args.expectedBranch !== undefined && args.expectedBranch !== 'main')
    || (args.preservationProfile !== undefined && args.preservationProfile !== 'battle-bridge-runtime-data-v1')
    || (args.preservationProfile && args.preservationApproval !== 'operator-approved')
    || (args.preservationApproval !== undefined && !args.preservationProfile)) throw new Error('HOST_OPERATION_ARGUMENTS_INVALID');
  return { ...args, expectedBranch: 'main' };
}

// Only this fixed adapter runs in the long-lived MCP process. Source operations
// get a fresh module graph, including the canonical epoch, for every request.
export function runFreshCanonicalHostOperation(operation, args, { spawnSyncFn = spawnSync } = {}) {
  const normalized = validateFreshHostOperation(operation,args);
  const result = spawnSyncFn(process.execPath, [fileURLToPath(import.meta.url), operation,
    Buffer.from(JSON.stringify(normalized)).toString('base64url')], {
    cwd:root,shell:false,windowsHide:true,encoding:'utf8',timeout:20*60*1000,maxBuffer:4*1024*1024,
    stdio:['ignore','pipe','pipe'],env:createBattleBridgeMinimalChildEnvironment(process.env,{git:true}),
  });
  const fail = blocker => ({ok:false,blocker,hostOperationAdapter:FRESH_HOST_OPERATION_SCHEMA,operation});
  if (result.error) return fail('HOST_OPERATION_CHILD_EXECUTION_UNPROVEN');
  let value;
  try { value=JSON.parse(result.stdout); } catch { return fail('HOST_OPERATION_CHILD_RESULT_UNPROVEN'); }
  if (value?.hostOperationAdapter !== FRESH_HOST_OPERATION_SCHEMA || value.operation !== operation
    || !sha.test(value.hostOperationProcessSourceHead || '')) return fail('HOST_OPERATION_CHILD_SOURCE_UNPROVEN');
  if ((value.ok === true && result.status !== 0) || ![0,1].includes(result.status)) return fail('HOST_OPERATION_CHILD_EXIT_FAILED');
  return value;
}

export async function executeFreshCanonicalHostOperation(operation,args,{
  platform=process.platform, repoRoot=root,
  readHead=()=>{
    const git=resolveBattleBridgeGitExecution({platform});
    return execFileSync(git.executable,[...git.fixedConfigArgs,...battleBridgeCanonicalRepositoryArgs(repoRoot),'rev-parse','HEAD'],
      {env:git.environment,encoding:'utf8',windowsHide:true,timeout:15000}).trim().toLowerCase();
  },
  loadHostOps=()=>import('../shared/agents/codexDispatchHostOps.mjs'),
  loadUpdate=()=>import('../shared/agents/stephanosChatUpdate.mjs'),
}={}) {
  const normalized=validateFreshHostOperation(operation,args);
  const expectedRoot=resolve(process.env.USERPROFILE||homedir(),'Documents','GitHub','stephan-os');
  if (platform!=='win32' || resolve(repoRoot).toLowerCase()!==expectedRoot.toLowerCase()) throw new Error('HOST_OPERATION_CANONICAL_WINDOWS_REQUIRED');
  const before=readHead();
  if(!sha.test(before)) throw new Error('HOST_OPERATION_PROCESS_SOURCE_UNPROVEN');
  const handler=operation==='sync'?(await loadHostOps()).syncCodexDispatchBridge:(await loadUpdate()).updateStephanosFromChat;
  if (readHead()!==before) throw new Error('HOST_OPERATION_SOURCE_CHANGED_DURING_IMPORT');
  const result=await handler(normalized);
  return {...result,hostOperationAdapter:FRESH_HOST_OPERATION_SCHEMA,operation,hostOperationProcessSourceHead:before};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let result;
  try {
    if(process.argv.length!==4 || process.argv[3].length>4096 || !/^[A-Za-z0-9_-]+$/.test(process.argv[3])) throw new Error('HOST_OPERATION_CLI_INVALID');
    result=await executeFreshCanonicalHostOperation(process.argv[2],JSON.parse(Buffer.from(process.argv[3],'base64url').toString('utf8')));
  } catch(error) { result={ok:false,blocker:/^[A-Z0-9_]+$/.test(error?.message||'')?error.message:'HOST_OPERATION_FAILED_CLOSED'}; }
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:1;
}
