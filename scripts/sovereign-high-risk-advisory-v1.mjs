#!/usr/bin/env node
// Read-only local source/candidate producer for Battle Bridge. This is NOT a
// qualified independent specialist or a protected GitHub review author.
import { spawnSync } from 'node:child_process';
import { openSync, readFileSync, fstatSync, closeSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { captureAuthenticatedReviewDiffV1 } from '../shared/agents/sovereignAuthenticatedReviewDiffV1.mjs';

import { resolveBattleBridgeGitExecution } from
  '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { evaluateSovereignHighRiskCandidateV1 } from
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
  const git = args => {
    const execution = resolveGit({ platform, environment: env });
    const result = spawn(execution.executable, [
      ...execution.fixedConfigArgs,
      '--git-dir=' + join(root, '.git'), '--work-tree=' + root, ...args,
    ], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 12_000,
      maxBuffer: 512 * 1024, env: execution.environment,
    });
    if (result?.error || result?.status !== 0) throw Error('EXACT_LOCAL_GIT_READ_UNVERIFIED');
    return String(result.stdout || '');
  };
  if (git(['rev-parse','HEAD']).trim().toLowerCase() !== head) throw Error('LOCAL_REVIEW_HEAD_MISMATCH');
  if (git(['symbolic-ref','--quiet','--short','HEAD']).trim() !== branch) {
    throw Error('LOCAL_REVIEW_BRANCH_MISMATCH');
  }
  if (git(['status','--porcelain','--untracked-files=normal']).trim()) throw Error('DIRTY_REVIEW_CHECKOUT');
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
  const {changedFiles,diff,reviewedObjectClosureSha256}=captureDiff({root,head,base,
    git:resolveGit({platform,environment:env}),run:spawn});
  return Object.freeze({
    repository: text(env.STEPHANOS_REVIEW_REPOSITORY),
    issueNumber: Number(env.STEPHANOS_REVIEW_ISSUE),
    prNumber: Number(env.STEPHANOS_REVIEW_PR),
    branch, sourceHead: head, baseSha: base, changedFiles,
    diff,reviewedObjectClosureSha256,
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
  if (platform !== 'linux' || !workspace.startsWith('/') || !isAbsolute(workspace)
    || normalize(workspace) !== workspace || /[\0\r\n]/.test(workspace)
    || !Number.isSafeInteger(nowMs)) {
    return Object.freeze({ ok: false, reason: 'HIGH_RISK_GOVERNOR_PATH_UNTRUSTED' });
  }
  let fd;
  try {
    fd = openFile(join(workspace, 'vr', 'vr-resource-governor-current.json'),
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
  const immutableModel = 'sha256:' + pinned.digest;
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
    const response = await fetchImpl(OLLAMA_URL, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: immutableModel, prompt, stream: false, format: 'json',
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
    const returnedModel = text(parsed?.model).toLowerCase();
    if (![immutableModel, 'sha256-' + pinned.digest].includes(returnedModel)
      || parsed?.done !== true || parsed?.done_reason !== 'stop'
      || typeof parsed?.response !== 'string'
      || Buffer.byteLength(parsed.response, 'utf8') > 12288)
      throw Error('LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN');
    const after = await modelPin(model, { fetchImpl });
    if (!after?.ok || after.digest !== pinned.digest || !allowed())
      throw Error('HIGH_RISK_MODEL_OR_GAMING_CHANGED_DURING_INFERENCE');
    return Object.freeze({ response: parsed.response, modelDigestSha256: pinned.digest,
      chunkId: chunk?.chunkId, contentSha256: chunk?.contentSha256 });
  } finally {
    stopPolling(monitor);
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
    && JSON.stringify(before.changedFiles) === JSON.stringify(after.changedFiles));
}

export async function runSovereignHighRiskAdvisoryV1({
  env = process.env, now = new Date(),
  root = repoRoot,
  snapshot = captureHighRiskAdvisorySnapshotV1,
  observeModel = observeHighRiskOllamaDigestV1,
  invokeModel = (prompt, chunk) => localHighRiskModelV1(prompt, chunk, env),
  publish = writeAtomicJson,
} = {}) {
  let result;
  let identity = {};
  try {
    identity = snapshot(env, {root});
    const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
    const modelBefore = await observeModel(model);
    if (!modelBefore?.ok || !/^[a-f0-9]{64}$/.test(modelBefore.digest ?? ''))
      throw Error('HIGH_RISK_REVIEW_MODEL_DIGEST_UNVERIFIED');
    result = await evaluateSovereignHighRiskCandidateV1(identity, {invokeModel, modelDigestSha256:modelBefore.digest});
    const modelAfter = await observeModel(model);
    if (!modelAfter?.ok || modelAfter.digest !== modelBefore.digest)
      throw Error('HIGH_RISK_REVIEW_MODEL_DIGEST_CHANGED');
    let after;
    try { after = snapshot(env, {root}); }
    catch { throw Error('REVIEW_SOURCE_CHANGED_DURING_INFERENCE'); }
    if (!sameReviewSource(identity, after)) {
      throw Error('REVIEW_SOURCE_CHANGED_DURING_INFERENCE');
    }
  } catch (error) {
    result = {
      status: 'SOVEREIGN_HIGH_RISK_REVIEW_HELD',
      reason: error?.message === 'REVIEW_SOURCE_CHANGED_DURING_INFERENCE'
        ? 'REVIEW_SOURCE_CHANGED_DURING_INFERENCE'
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
      independentAttestationProven: false,
      specialistAuthority: false,
      mergeAuthority: false,
      approvalAuthority: false,
    },
  };
  let publication;
  try {
    publication = await publish(workspaceRoot,
      ['status',status.statusId+'.json'],status,{repoRoot:root});
  } catch {
    publication = {ok:false,reason:'SAFE_STATUS_WRITE_UNVERIFIED'};
  }
  return Object.freeze({
    status: result.status,
    reason: text(result.reason || ''),
    reviewPacketSha256: text(candidate?.reviewPacketSha256 || result.reviewPacketSha256 || ''),
    modelDigestSha256: text(candidate?.modelDigestSha256 || ''),
    reviewedChunkCount: candidate?.reviewedChunks?.length || 0,
    findingCount: candidate?.findings?.length || 0,
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
