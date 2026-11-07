#!/usr/bin/env node
// Read-only local source/candidate producer for Battle Bridge. This is NOT a
// qualified independent specialist or a protected GitHub review author.
import { spawnSync } from 'node:child_process';
import { openSync, readFileSync, fstatSync, closeSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { captureAuthenticatedReviewDiffV1 } from '../shared/agents/sovereignAuthenticatedReviewDiffV1.mjs';
import { classifyDirt } from './battle-bridge-github-sync-policy.mjs';
import { admitSovereignLocalOllamaBindingV1, matchesSovereignLocalOllamaCompletionV1, sovereignLocalOllamaFailureReasonV1 } from '../shared/agents/sovereignReviewerOllamaBindingV1.mjs';

import { resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration } from
  '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { evaluateSovereignHighRiskCandidateV1, evaluateSovereignCompleteReviewCandidateV1,
  COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1 } from
  '../shared/agents/sovereignHighRiskReviewCandidateV1.mjs';
import {
  createSharedWorkspaceStatusRecord, writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[a-f0-9]{40}$/;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const text = x => String(x ?? '').trim();
// Git status alone can hide altered executable bytes with skip-worktree or
// assume-unchanged flags. Pin the candidate producer and critical policies
// to the exact HEAD before and after any private model inference.
export const HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS = Object.freeze([
  'scripts/sovereign-high-risk-advisory-v1.mjs',
  'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
  'shared/agents/sovereignHighRiskReviewCandidateV1.mjs',
  'shared/agents/sovereignReviewerOllamaBindingV1.mjs',
  'shared/agents/sovereignReviewCoverageV1.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
  'shared/agents/sharedAgentWorkspaceStore.mjs',
]);


export function captureHighRiskAdvisorySnapshotV1(env = process.env, {
  platform = process.platform, spawn = spawnSync,
  resolveGit = resolveBattleBridgeGitExecution,
  captureDiff = captureAuthenticatedReviewDiffV1,
  root = repoRoot,
} = {}) {
  const head = text(env.STEPHANOS_REVIEW_EXACT_HEAD).toLowerCase();
  const base = text(env.STEPHANOS_REVIEW_EXACT_BASE).toLowerCase();
  const branch = text(env.STEPHANOS_REVIEW_EXACT_BRANCH);
  if (!SHA.test(head) || !SHA.test(base) || head === base) {
    throw Error('EXACT_HEAD_AND_BASE_REQUIRED');
  }
  const platformPath = platform === 'win32' ? win32 : posix;
  const git = (args, maxBuffer = 512 * 1024) => {
    const execution = resolveGit({ platform, environment: env });
    const result = spawn(execution.executable, [
      ...execution.fixedConfigArgs,
      '--git-dir=' + platformPath.join(root, '.git'), '--work-tree=' + root, ...args,
    ], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 12_000,
      maxBuffer, env: execution.environment,
    });
    if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string') {
      throw Error('EXACT_LOCAL_GIT_READ_UNVERIFIED');
    }
    return result.stdout;
  };
  // Status can invoke attribute-driven helpers. Admit the canonical raw local
  // configuration before source scans, without following configuration includes.
  const localConfig = git(['config','--local','--null','--list','--no-includes'], 16 * 1024);
  if (!validateBattleBridgeLocalGitConfiguration(localConfig).ok) {
    throw Error('HIGH_RISK_REVIEWER_GIT_CONFIGURATION_UNSAFE');
  }
  if (git(['rev-parse','HEAD']).trim().toLowerCase() !== head) throw Error('LOCAL_REVIEW_HEAD_MISMATCH');
  if (git(['symbolic-ref','--quiet','--short','HEAD']).trim() !== branch) {
    throw Error('LOCAL_REVIEW_BRANCH_MISMATCH');
  }
  const statusLines = git(['-c','status.renames=false','status','--porcelain','--untracked-files=normal'])
    .split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line).filter(Boolean);
  if (classifyDirt(statusLines).blocksSync) throw Error('DIRTY_REVIEW_CHECKOUT');
  if (git(['rev-parse','--verify',base+'^{commit}']).trim().toLowerCase() !== base) {
    throw Error('BASE_COMMIT_NOT_PROVEN');
  }
  git(['merge-base','--is-ancestor',base,head]);
  for (const path of HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS) {
    if (git(['ls-files', '-v', '--', path]).trim() !== 'H ' + path) {
      throw Error('HIGH_RISK_REVIEWER_INDEX_FLAGS_UNSAFE');
    }
    const expected = git(['rev-parse', 'HEAD:' + path]).trim().toLowerCase();
    const actual = git(['hash-object', '--no-filters', '--', path]).trim().toLowerCase();
    if (!SHA.test(expected) || actual !== expected) {
      throw Error('HIGH_RISK_REVIEWER_EXECUTABLE_BYTES_NOT_HEAD');
    }
  }
  const captured=captureDiff({root,head,base,
    git:resolveGit({platform,environment:env}),run:spawn});
  return Object.freeze({
    ...captured,
    repository: text(env.STEPHANOS_REVIEW_REPOSITORY),
    issueNumber: Number(env.STEPHANOS_REVIEW_ISSUE),
    prNumber: Number(env.STEPHANOS_REVIEW_PR),
    branch, sourceHead: head, baseSha: base,
    reviewerSessionId: text(env.STEPHANOS_REVIEW_SESSION),
    implementerSessionId: text(env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION),
    implementerProvider: text(env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER),
    modelClass: text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS || 'qwen-14b'),
  });
}

// The same independently written VR/flat governor protects ordinary local
// reviews, Windows exams and this high-risk advisory. Any missing, stale or
// malformed observation is a HOLD, never permission to load a heavy model.
export function inspectHighRiskGamingPermissionV1(env = process.env, {
  nowMs = Date.now(), platform = process.platform,
  openFile = openSync, readFile = readFileSync,
  statFile = fstatSync, closeFile = closeSync,
} = {}) {
  const workspace = text(env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  if (platform !== 'linux' || !workspace.startsWith('/') || !posix.isAbsolute(workspace)
    || posix.normalize(workspace) !== workspace || /[\0\r\n]/.test(workspace)
    || !Number.isSafeInteger(nowMs)) {
    return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_PATH_UNTRUSTED' });
  }
  let fd;
  try {
    fd = openFile(posix.join(workspace, 'vr', 'vr-resource-governor-current.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = statFile(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > 32768)
      return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_FILE_INVALID' });
    const raw = readFile(fd, 'utf8');
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32768)
      return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_FILE_INVALID' });
    const state = JSON.parse(raw);
    const when = Date.parse(state?.updatedAtUtc);
    const flags = ['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive',
      'virtualAirLinkTestActive', 'prepareLeaseActive',
      'localModelAllowed', 'heavyModelAllowed'];
    if (state?.schemaVersion !== 'stephanos.vr-resource-governor.v1'
      || state.governorVersion !== 3
      || flags.some(k => typeof state[k] !== 'boolean')
      || !['balanced','cool','off'].includes(state.ollamaLoadMode)
      || !Number.isFinite(when) || nowMs - when > 30000 || when - nowMs > 5000)
      return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_STALE_OR_INVALID' });
    if (state.active || state.flatGameActive || state.airLinkActive
      || state.realAirLinkActive || state.virtualAirLinkTestActive || state.prepareLeaseActive
      || !state.localModelAllowed || !state.heavyModelAllowed
      || state.ollamaLoadMode !== 'balanced')
      return Object.freeze({ ok: false, reason: 'HIGH_RISK_GAMING_RESOURCE_PROTECTED' });
    return Object.freeze({ ok: true, reason: '' });
  } catch {
    return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_UNAVAILABLE' });
  } finally {
    if (fd !== undefined) {
      try { closeFile(fd); } catch { /* no permissions inferred from close failure */ }
    }
  }
}

// Tag names can be replaced while the reviewer is running. Resolve only an
// observed local digest, never a caller's unverified model identifier.
export async function observeHighRiskOllamaDigestV1(model, { fetchImpl = fetch } = {}) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model) || typeof fetchImpl !== 'function')
    return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_NAME_UNSAFE' });
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(6000),
    });
    if (!response?.ok || typeof response.text !== 'function')
      return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_INVENTORY_UNAVAILABLE' });
    const raw = await response.text();
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32768)
      return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_INVENTORY_UNBOUNDED' });
    const models = JSON.parse(raw)?.models;
    if (!Array.isArray(models) || models.length > 256)
      return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_INVENTORY_INVALID' });
    const matches = models.filter(x => x && typeof x === 'object'
      && (x.name === model || x.model === model));
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0]?.digest ?? ''))
      return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_DIGEST_UNVERIFIED' });
    return Object.freeze({ ok: true, reason: '', digest: matches[0].digest });
  } catch {
    return Object.freeze({ ok: false, reason: 'LOCAL_MODEL_DIGEST_READ_FAILED' });
  }
}

export async function localHighRiskModelV1(prompt, chunk, env = process.env, {
  fetchImpl = fetch,
  gamingGuard = inspectHighRiskGamingPermissionV1,
  modelPin = observeHighRiskOllamaDigestV1,
  startPolling = setInterval, stopPolling = clearInterval,
  platform = process.platform,
} = {}) {
  const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model))
    throw Error('UNSAFE_LOCAL_MODEL_NAME');
  const allowed = () => gamingGuard(env, { platform })?.ok === true;
  if (!allowed()) throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
  const pinned = await modelPin(model, { fetchImpl });
  if (!pinned?.ok || !/^[a-f0-9]{64}$/.test(pinned.digest ?? ''))
    throw Error('HIGH_RISK_MODEL_DIGEST_UNVERIFIED');
  if (chunk?.modelDigestSha256 && pinned.digest !== chunk.modelDigestSha256)
    throw Error('HIGH_RISK_REVIEW_MODEL_DIGEST_CHANGED');
  if (!allowed()) throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
  const before = await modelPin(model, { fetchImpl });
  if (!before?.ok || before.digest !== pinned.digest)
    throw Error('HIGH_RISK_MODEL_DIGEST_CHANGED');
  const controller = new AbortController();
  let preempted = false;
  const monitor = startPolling(() => {
    try {
      if (!allowed()) {
        preempted = true;
        controller.abort(Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED'));
      }
    } catch {
      preempted = true;
      controller.abort(Error('HIGH_RISK_GAMING_RESOURCE_UNPROVEN'));
    }
  }, 500);
  try {
    const binding = await admitSovereignLocalOllamaBindingV1(pinned.digest, {
      fetchImpl, signal: controller.signal,
    });
    if (preempted || controller.signal.aborted || !allowed()) {
      throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
    }
    const response = await fetchImpl(OLLAMA_URL, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: binding.model, prompt, stream: false, format: 'json',
        keep_alive: 0,
        options: { temperature: 0, num_ctx: 8192 },
      }),
      signal: AbortSignal.any([AbortSignal.timeout(120000), controller.signal]),
    });
    if (!response?.ok || typeof response.text !== 'function')
      throw Error('LOCAL_MODEL_REQUEST_FAILED');
    const raw = await response.text();
    if (preempted || controller.signal.aborted || !allowed())
      throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 65536)
      throw Error('LOCAL_MODEL_OUTPUT_TOO_LARGE');
    const parsed = JSON.parse(raw);
    if (!matchesSovereignLocalOllamaCompletionV1(parsed, binding)
      || parsed?.done !== true || parsed?.done_reason !== 'stop'
      || typeof parsed?.response !== 'string'
      || Buffer.byteLength(parsed.response, 'utf8') > 12288)
      throw Error('LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN');
    const after = await modelPin(model, { fetchImpl });
    if (!after?.ok || after.digest !== pinned.digest || !allowed())
      throw Error('HIGH_RISK_MODEL_OR_GAMING_CHANGED_DURING_INFERENCE');
    return Object.freeze({ response: parsed.response, modelDigestSha256: pinned.digest,
      chunkId: chunk?.chunkId, contentSha256: chunk?.contentSha256 });
  } catch (error) {
    if (preempted || controller.signal.aborted) {
      throw Error('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
    }
    throw error;
  } finally {
    stopPolling(monitor);
  }
}

const completeHash = value => createHash('sha256').update(value).digest('hex');
const COMPLETE_LOOPBACK_PATHS = new Set(['/api/version','/api/tags','/api/show','/api/ps','/api/generate']);
const completeFailure = code => new Error(code);
function completeUntilAbort(promise, signal) {
  return new Promise((resolveValue,reject) => {
    const pending=Promise.resolve(promise);
    const abort=()=>reject(completeFailure('COMPLETE_REVIEW_REQUEST_DEADLINE'));
    if(signal.aborted){pending.catch(()=>{});abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    pending.then(value=>{
      signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolveValue(value);
    },error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
async function completeFetch(url,options,fetchImpl,signal) {
  if(typeof fetchImpl!=='function' || !COMPLETE_LOOPBACK_PATHS.has(url.slice('http://127.0.0.1:11434'.length))
    || !url.startsWith('http://127.0.0.1:11434/api/') || signal.aborted)
    throw completeFailure('COMPLETE_REVIEW_TRANSPORT_SCOPE_INVALID');
  const pending=Promise.resolve(fetchImpl(url,{...options,redirect:'error',signal})).then(response=>{
    if(signal.aborted){
      try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}
      throw completeFailure('COMPLETE_REVIEW_REQUEST_DEADLINE');
    }
    return response;
  });
  const response=await completeUntilAbort(pending,signal);
  if(response?.status!==200 || response.ok!==true || response.redirected!==false || response.url!==url){
    try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}
    throw completeFailure('COMPLETE_REVIEW_RESPONSE_INVALID');
  }
  return response;
}
async function completeReadJson(path,{body,fetchImpl=fetch,signal,maximum=32768,timeoutMs=6000}={}) {
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  const url='http://127.0.0.1:11434'+path;
  const response=await completeFetch(url,{method:body===undefined?'GET':'POST',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})},fetchImpl,bounded);
  const declared=response.headers?.get('content-length'),encoding=response.headers?.get('content-encoding')||'';
  if(!['','identity','gzip','deflate','br'].includes(encoding.toLowerCase())
    || (declared!=null && (!/^(0|[1-9][0-9]*)$/.test(declared)
      || !Number.isSafeInteger(Number(declared)) || Number(declared)>maximum))
    || typeof response.body?.getReader!=='function'){
    try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}
    throw completeFailure('COMPLETE_REVIEW_RESPONSE_UNBOUNDED');
  }
  const reader=response.body.getReader(),chunks=[];let bytes=0,count=0,complete=false;
  try {
    for(;;){
      const item=await completeUntilAbort(reader.read(),bounded);
      if(item.done===true){complete=true;break;}
      if(item.done!==false || !(item.value instanceof Uint8Array) || !item.value.byteLength
        || ++count>32768 || bytes+item.value.byteLength>maximum)
        throw completeFailure('COMPLETE_REVIEW_RESPONSE_UNBOUNDED');
      bytes+=item.value.byteLength;chunks.push(Buffer.from(item.value));
    }
    if(bounded.aborted || ((!encoding||encoding==='identity') && declared!=null && Number(declared)!==bytes))
      throw completeFailure('COMPLETE_REVIEW_RESPONSE_INCOMPLETE');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
  } catch(error) {
    if(typeof error?.message==='string' && /^COMPLETE_REVIEW_[A-Z_]+$/.test(error.message))throw error;
    throw completeFailure('COMPLETE_REVIEW_RESPONSE_INVALID');
  } finally {
    if(!complete){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
    try{reader.releaseLock();}catch{}
  }
}

export async function observeCompleteHighRiskOllamaDigestV1(model,{fetchImpl=fetch,signal}={}) {
  if(!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model))
    return Object.freeze({ok:false,reason:'COMPLETE_REVIEW_MODEL_NAME_INVALID'});
  try {
    const result=await completeReadJson('/api/tags',{fetchImpl,signal});
    if(!Array.isArray(result?.models)||result.models.length>256)
      throw completeFailure('COMPLETE_REVIEW_MODEL_INVENTORY_INVALID');
    const matches=result.models.filter(row=>row && typeof row==='object' && (row.name===model||row.model===model));
    if(matches.length!==1||!/^[a-f0-9]{64}$/.test(matches[0]?.digest??''))
      throw completeFailure('COMPLETE_REVIEW_MODEL_DIGEST_UNPROVEN');
    return Object.freeze({ok:true,reason:'',digest:matches[0].digest});
  }catch(error){return Object.freeze({ok:false,reason:/^COMPLETE_REVIEW_[A-Z_]+$/.test(error?.message??'')
    ?error.message:'COMPLETE_REVIEW_MODEL_INVENTORY_UNPROVEN'});}
}

// Full-prompt protocol is source-reviewed at Ollama 0.40.0 commit
// 0d0720e51fb2fd9aa58781c3d720c06d720c2e7b: api/types.go GenerateRequest,
// server/routes.go GenerateHandler/PsHandler and llm/server.go. raw bypasses
// hidden templates, truncate:false refuses a partial prompt, and shift:false
// refuses context eviction. The existing digest binding admits only stable
// 0.40.x; unknown/older protocols never receive the review prompt.
export async function localCompleteHighRiskModelV1(prompt,packet,env=process.env,{
  fetchImpl=fetch,gamingGuard=inspectHighRiskGamingPermissionV1,platform=process.platform,
  signal,startPolling=setInterval,stopPolling=clearInterval,clock=()=>performance.now(),
}={}) {
  const limits=COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1;
  const bytes=typeof prompt==='string'?Buffer.byteLength(prompt,'utf8'):0;
  if(!bytes || bytes!==packet?.promptBytes || completeHash(prompt)!==packet.promptSha256
    || packet.inputTokenUpperBound!==bytes || packet.outputTokenReserve!==limits.outputTokenReserve
    || !/^[a-f0-9]{64}$/.test(packet.modelDigestSha256??''))
    throw completeFailure('COMPLETE_REVIEW_PROMPT_BINDING_INVALID');
  // There is no atomic require-resident/no-reload request in this protocol.
  // A /ps snapshot must not authorize a large cold load after a concurrent
  // unload. Do not expose a caller option or cached flag that opens this gate.
  if(bytes+limits.outputTokenReserve>limits.coldContextTokens)
    throw completeFailure('COMPLETE_REVIEW_LARGE_CONTEXT_CUSTODY_UNPROVEN');
  const model=text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL||'qwen:14b');
  if(!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model))throw completeFailure('COMPLETE_REVIEW_MODEL_NAME_INVALID');
  const controller=new AbortController(),started=clock(),startedAtUtc=new Date().toISOString();
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const deadline=setTimeout(()=>controller.abort(),limits.aggregateTimeoutMs);deadline.unref?.();
  let monitor,lastCheck=started,maximumGap=0,checkCount=0,interrupted=0;
  let chain=completeHash('stephanos.complete-review-gaming-observations.v1');
  const elapsed=()=>{const value=Math.ceil(clock()-started);
    if(!Number.isSafeInteger(value)||value<0||value>=limits.aggregateTimeoutMs)
      throw completeFailure('COMPLETE_REVIEW_AGGREGATE_DEADLINE');return value;};
  const check=()=>{
    let allowed=false,at=clock();
    try{allowed=gamingGuard(env,{platform})?.ok===true;}catch{}
    const gap=Math.ceil(at-lastCheck);lastCheck=at;maximumGap=Math.max(maximumGap,gap);
    if(!Number.isFinite(at)||!Number.isSafeInteger(gap)||gap<0||maximumGap>limits.maximumGovernorGapMs
      || ++checkCount>20000)allowed=false;
    chain=completeHash(JSON.stringify([chain,Math.ceil(at-started),allowed]));
    if(!allowed){interrupted++;controller.abort();}
    return allowed && !combined.aborted;
  };
  const requireGaming=()=>{if(!check())throw completeFailure('HIGH_RISK_GAMING_RESOURCE_PROTECTED');elapsed();};
  const pin=async()=>{
    requireGaming();
    const observed=await observeCompleteHighRiskOllamaDigestV1(model,{fetchImpl,signal:combined});
    if(!observed.ok)throw completeFailure(observed.reason);
    if(observed.digest!==packet.modelDigestSha256)throw completeFailure('COMPLETE_REVIEW_MODEL_DIGEST_CHANGED');
    requireGaming();return observed.digest;
  };
  let generationSettled=false,observedContextTokens=null,contextFailure='';
  try {
    requireGaming();monitor=startPolling(()=>{check();},limits.governorIntervalMs);
    await pin();
    const binding=await admitSovereignLocalOllamaBindingV1(packet.modelDigestSha256,{
      signal:combined,fetchImpl:(url,options)=>completeFetch(url,options,fetchImpl,
        AbortSignal.any([combined,options.signal])),
    });
    requireGaming();
    const info=await completeReadJson('/api/show',{fetchImpl,signal:combined,maximum:256*1024,
      body:{model:binding.model}});
    const architecture=info?.model_info?.['general.architecture'];
    const modelContextTokens=typeof architecture==='string' && /^[a-z0-9_]{1,80}$/.test(architecture)
      ?info.model_info[architecture+'.context_length']:null;
    if(!Array.isArray(info?.capabilities)||!info.capabilities.includes('completion')
      || !Number.isSafeInteger(modelContextTokens)||modelContextTokens<limits.coldContextTokens
      ||modelContextTokens>limits.maximumContextTokens
      ||Object.hasOwn(info,'remote_host')||Object.hasOwn(info,'remote_model'))
      throw completeFailure('COMPLETE_REVIEW_MODEL_CONTEXT_UNPROVEN');
    const resident=async()=>{
      const reply=await completeReadJson('/api/ps',{fetchImpl,signal:combined});
      if(!Array.isArray(reply?.models)||reply.models.length>256)
        throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_UNPROVEN');
      const matches=reply.models.filter(row=>row && row.digest===packet.modelDigestSha256);
      if(matches.length>1)throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_AMBIGUOUS');
      if(!matches.length)return null;
      const value=matches[0];
      if(!Number.isSafeInteger(value.context_length)||value.context_length<1
        ||value.context_length>limits.maximumContextTokens||Object.hasOwn(value,'remote_host')
        ||Object.hasOwn(value,'remote_model'))throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_UNPROVEN');
      return value.context_length;
    };
    const preexistingContextTokens=await resident();
    await pin();requireGaming();
    const requestStarted=clock();
    const generation=completeReadJson('/api/generate',{fetchImpl,signal:combined,maximum:65536,
      timeoutMs:limits.requestTimeoutMs,body:{model:binding.model,prompt,stream:false,format:'json',
        raw:true,truncate:false,shift:false,keep_alive:0,
        options:{temperature:0,num_ctx:limits.coldContextTokens,num_predict:limits.outputTokenReserve}}})
      .then(value=>{generationSettled=true;return value;},error=>{generationSettled=true;throw error;});
    const observeRunning=(async()=>{
      do {
        const observed=await resident();requireGaming();
        if(observed!==null){
          if(observed!==limits.coldContextTokens)
            throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_CHANGED');
          observedContextTokens=observed;
        }else if(observedContextTokens!==null&&!generationSettled)
          throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_CHANGED');
        if(generationSettled)break;
        await completeUntilAbort(new Promise(resolveWait=>setTimeout(resolveWait,500)),combined);
      }while(!generationSettled);
    })().catch(error=>{
      if(!combined.aborted && /^COMPLETE_REVIEW_[A-Z_]+$/.test(error?.message??''))contextFailure=error.message;
      controller.abort();throw error;
    });
    const [reply]=await Promise.all([generation,observeRunning]);
    requireGaming();const requestDurationMs=Math.ceil(clock()-requestStarted);
    if(!Number.isSafeInteger(requestDurationMs)||requestDurationMs<0||requestDurationMs>=limits.requestTimeoutMs)
      throw completeFailure('COMPLETE_REVIEW_REQUEST_DEADLINE');
    if(observedContextTokens!==limits.coldContextTokens)
      throw completeFailure('COMPLETE_REVIEW_RUNNING_CONTEXT_UNPROVEN');
    if(!matchesSovereignLocalOllamaCompletionV1(reply,binding)||reply.done!==true||reply.done_reason!=='stop'
      ||typeof reply.response!=='string'||Buffer.byteLength(reply.response,'utf8')>limits.responseBytes
      ||Object.hasOwn(reply,'context')||Object.hasOwn(reply,'debug_info')
      ||!Number.isSafeInteger(reply.prompt_eval_count)||reply.prompt_eval_count<1||reply.prompt_eval_count>bytes
      ||!Number.isSafeInteger(reply.eval_count)||reply.eval_count<1||reply.eval_count>limits.outputTokenReserve)
      throw completeFailure('COMPLETE_REVIEW_COMPLETION_UNPROVEN');
    await pin();requireGaming();
    const durationMs=elapsed(),finishedAtUtc=new Date().toISOString();
    return Object.freeze({reviewId:packet.reviewId,modelDigestSha256:packet.modelDigestSha256,response:reply.response,
      executionObservation:Object.freeze({schemaVersion:'stephanos.sovereign-complete-inference-observation.v1',
        protocolVersion:binding.protocolVersion,modelSelector:binding.model,
        promptSha256:packet.promptSha256,promptBytes:bytes,inputTokenUpperBound:bytes,
        outputTokenReserve:limits.outputTokenReserve,contextTokens:limits.coldContextTokens,
        observedContextTokens,modelContextTokens,preexistingContextTokens,
        contextAdmission:'FIXED_8K_BASELINE',residencyCustodyObserved:false,
        rawPrompt:true,promptTruncationDisabled:true,contextShiftDisabled:true,
        actualPromptTokens:reply.prompt_eval_count,actualOutputTokens:reply.eval_count,doneReason:reply.done_reason,
        responseSha256:completeHash(reply.response),startedAtUtc,finishedAtUtc,durationMs,requestDurationMs,
        gamingCheckCount:checkCount,gamingInterruptedCount:interrupted,maximumGamingCheckGapMs:maximumGap,
        gamingObservationChainSha256:chain})});
  } catch(error) {
    if(interrupted)throw completeFailure('HIGH_RISK_GAMING_RESOURCE_PROTECTED');
    if(signal?.aborted)throw completeFailure('COMPLETE_REVIEW_AGGREGATE_DEADLINE');
    if(contextFailure)throw completeFailure(contextFailure);
    if(typeof error?.message==='string' && /^(?:COMPLETE_REVIEW_[A-Z_]+|LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED|LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN)$/.test(error.message))throw error;
    throw completeFailure('COMPLETE_REVIEW_INFERENCE_UNPROVEN');
  } finally {
    if(monitor!==undefined)stopPolling(monitor);clearTimeout(deadline);controller.abort();
  }
}

// Re-read the fixed Git evidence AFTER model inference: a stale review must
// never be published as a candidate for a changed source, diff or principal.
function sameReviewSource(before, after) {
  const fields = ['repository', 'issueNumber', 'prNumber', 'branch',
    'sourceHead', 'baseSha', 'diff', 'reviewerSessionId',
    'implementerSessionId', 'implementerProvider', 'modelClass','reviewedObjectClosureSha256'];
  return Boolean(before && after && fields.every(key => before[key] === after[key])
    && Array.isArray(before.changedFiles) && Array.isArray(after.changedFiles)
    && JSON.stringify(before.changedFiles) === JSON.stringify(after.changedFiles)
    && ['baseTree','sourceTree','representation','fullDiff','fullDiffSha256','fullDiffBytes'].every(key=>before[key]===after[key])
    && JSON.stringify(before.changedPaths)===JSON.stringify(after.changedPaths)
    && JSON.stringify(before.sourceEvidence)===JSON.stringify(after.sourceEvidence));
}

export async function runSovereignHighRiskAdvisoryV1({
  env = process.env, now = new Date(),
  root = repoRoot,
  snapshot = captureHighRiskAdvisorySnapshotV1,
  observeModel,
  invokeModel = (prompt, chunk) => localHighRiskModelV1(prompt, chunk, env),
  reviewMode = 'legacy-chunks',
  invokeCompleteModel = (prompt, packet, options) => localCompleteHighRiskModelV1(prompt, packet, env, options),
  publish = writeAtomicJson,
} = {}) {
  let result;
  let identity = {};
  const complete = reviewMode==='complete-diff';
  const started=Date.now(),controller=complete?new AbortController():null;
  const deadline=complete?setTimeout(()=>controller.abort(),COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1.aggregateTimeoutMs):null;
  deadline?.unref?.();
  const checkDeadline=()=>{if(complete && (controller.signal.aborted || Date.now()<started
    ||Date.now()-started>=COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1.aggregateTimeoutMs))
    throw completeFailure('COMPLETE_REVIEW_AGGREGATE_DEADLINE');};
  const observe=observeModel||(complete?observeCompleteHighRiskOllamaDigestV1:observeHighRiskOllamaDigestV1);
  const readModel=async model=>{
    checkDeadline();const pending=observe(model,complete?{signal:controller.signal}:undefined);
    const value=complete?await completeUntilAbort(pending,controller.signal):await pending;checkDeadline();return value;
  };
  try {
    if(!['legacy-chunks','complete-diff'].includes(reviewMode))throw Error('COMPLETE_REVIEW_MODE_INVALID');
    identity = snapshot(env, {root});
    checkDeadline();
    const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
    const modelBefore = await readModel(model);
    if (!modelBefore?.ok || !/^[a-f0-9]{64}$/.test(modelBefore.digest ?? ''))
      throw Error('HIGH_RISK_REVIEW_MODEL_DIGEST_UNVERIFIED');
    let bindingFailure = '';
    result = complete ? await evaluateSovereignCompleteReviewCandidateV1(identity,{
      modelDigestSha256:modelBefore.digest,signal:controller.signal,
      invokeModel:(prompt,packet,options)=>completeUntilAbort(invokeCompleteModel(prompt,packet,options),controller.signal),
    }) : await evaluateSovereignHighRiskCandidateV1(identity, {
      modelDigestSha256:modelBefore.digest,
      invokeModel:async (...args) => {
        try { return await invokeModel(...args); }
        catch (error) { bindingFailure = sovereignLocalOllamaFailureReasonV1(error); throw error; }
      },
    });
    if (bindingFailure && result.status === 'SOVEREIGN_HIGH_RISK_REVIEW_HELD'
      && result.reason === 'LOCAL_MODEL_UNAVAILABLE') {
      result = { ...result, reason: bindingFailure };
    }
    checkDeadline();
    const modelAfter = await readModel(model);
    if (!modelAfter?.ok || modelAfter.digest !== modelBefore.digest)
      throw Error('HIGH_RISK_REVIEW_MODEL_DIGEST_CHANGED');
    let after;
    try { after = snapshot(env, {root}); }
    catch { throw Error('REVIEW_SOURCE_CHANGED_DURING_INFERENCE'); }
    if (!sameReviewSource(identity, after)) {
      throw Error('REVIEW_SOURCE_CHANGED_DURING_INFERENCE');
    }
    checkDeadline();
  } catch (error) {
    result = {
      status: 'SOVEREIGN_HIGH_RISK_REVIEW_HELD',
      reason: error?.message === 'REVIEW_SOURCE_CHANGED_DURING_INFERENCE'
        ? 'REVIEW_SOURCE_CHANGED_DURING_INFERENCE'
        : complete && /^COMPLETE_REVIEW_[A-Z_]+$/.test(error?.message??'') ? error.message
        : 'LOCAL_EXACT_SOURCE_OR_MODEL_UNVERIFIED',
      approvalAuthority: false, mergeAuthority: false,
      specialistAuthority: false, independentAttestationProven: false,
    };
  }
  const candidate = result.candidateEvidence;
  const prNumber = Number(env.STEPHANOS_REVIEW_PR);
  const safePr = Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : 0;
  const profile = text(env.USERPROFILE || env.HOME || homedir());
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || join(profile, 'Documents', 'Stephanos-openclaw-workspace'));
  const status = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'sovereign-high-risk-advisory-' + (safePr || 'unknown'),
      participantId: 'sovereign-high-risk-reviewer',
      relatedIssue: '#1574',
      relatedPr: safePr ? '#' + safePr : '',
      timestampUtc: now.toISOString(),
      status: 'HELD',
      summary: 'Unqualified local high-risk review candidate; protected specialist review still required.',
    }),
    highRiskAdvisory: {
      status: result.status,
      reason: text(result.reason || ''),
      sourceHead: text(identity.sourceHead || ''),
      baseSha: text(identity.baseSha || ''),
      reviewPacketSha256: text(candidate?.reviewPacketSha256 || result.reviewPacketSha256 || ''),
      modelDigestSha256: text(candidate?.modelDigestSha256 || ''),
      chunkCount: Number(candidate?.chunkCount || 0),
      findingCount: Number(candidate?.findings?.length || 0),
      reviewMode,
      completeCrossFileReviewObserved:candidate?.completeCrossFileReviewObserved===true,
      reviewedDiffBytes:candidate?.completeCrossFileReviewObserved===true?candidate.diffBytes:0,
      reviewedPathCount:candidate?.completeCrossFileReviewObserved===true?candidate.changedFiles.length:0,
      completeExecutionSha256:candidate?.executionObservation?completeHash(JSON.stringify(candidate.executionObservation)):'',
      independentAttestationProven: false,
      specialistAuthority: false,
      mergeAuthority: false,
      approvalAuthority: false,
    },
  };
  let publication;
  try {
    checkDeadline();
    const pending = publish(workspaceRoot,
      ['status',status.statusId+'.json'],status,{repoRoot:root});
    publication = complete?await completeUntilAbort(pending,controller.signal):await pending;
    checkDeadline();
  } catch {
    publication = {ok:false,reason:'SAFE_STATUS_WRITE_UNVERIFIED'};
  } finally {
    if(deadline)clearTimeout(deadline);controller?.abort();
  }
  return Object.freeze({
    status: result.status,
    reason: text(result.reason || ''),
    reviewPacketSha256: text(candidate?.reviewPacketSha256 || result.reviewPacketSha256 || ''),
    modelDigestSha256: text(candidate?.modelDigestSha256 || ''),
    reviewedChunkCount: candidate?.reviewedChunks?.length || 0,
    findingCount: candidate?.findings?.length || 0,
    reviewMode,
    completeCrossFileReviewObserved:candidate?.completeCrossFileReviewObserved===true,
    reviewedDiffBytes:candidate?.completeCrossFileReviewObserved===true?candidate.diffBytes:0,
    reviewedPathCount:candidate?.completeCrossFileReviewObserved===true?candidate.changedFiles.length:0,
    // Only bounded hashes, counters and protocol observations leave the private
    // inference call. Neither the full prompt nor source/model prose is emitted.
    completeReviewExecution:candidate?.executionObservation||null,
    publicationOk: publication?.ok === true,
    publicationReason: publication?.ok === true ? '' : text(publication?.reason || 'NOT_PUBLISHED'),
    qualification: 'PENDING_INDEPENDENT_SPECIALIST_ATTESTATION',
    mergeAuthority: false, approvalAuthority: false, specialistAuthority: false,
    runtimeDeploymentProven: false,
  });
}

// Library code is evaluated only through the trusted closed-graph launcher on
// admitted production routes. A direct source-checkout invocation is unsupported
// and cannot run inference or publish a candidate. It is not a trust bootstrap.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write('SOVEREIGN_HIGH_RISK_ADVISORY_RESULT='+JSON.stringify({
    status:'SOVEREIGN_HIGH_RISK_REVIEW_HELD',reason:'TRUSTED_PREEXECUTION_LAUNCHER_REQUIRED',
    approvalAuthority:false,mergeAuthority:false,specialistAuthority:false,
    independentAttestationProven:false,runtimeDeploymentProven:false,
  })+'\n'); process.exitCode=1;
}
