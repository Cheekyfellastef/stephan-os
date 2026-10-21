#!/usr/bin/env node
// Local Ollama candidate calibration: fixed ten adversarial cases only.
// No GitHub, arbitrary command, Windows witness, approval or merge capability.
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openSync, readFileSync, closeSync, constants, fstatSync, writeFileSync, fsyncSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, isAbsolute, normalize } from 'node:path';
import { resolve } from 'node:path';
import { evaluateSovereignCalibrationV1, SOVEREIGN_CALIBRATION_MANIFEST_SHA256 } from '../shared/agents/sovereignCalibrationV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SOURCE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/;
// At minimum the actual executable, scorer, and imported reviewer policy
// bytes must match HEAD, regardless of skip-worktree/assume-unchanged flags.
const CRITICAL_REVIEW_FILES = Object.freeze([
  'scripts/sovereign-reviewer-ollama-calibration-v1.mjs',
  'shared/agents/sovereignCalibrationV1.mjs',
  'scripts/sovereign-reviewer-v1.mjs',
  'shared/agents/providerNeutralReviewV1.mjs',
]);
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const NO_AUTHORITY = Object.freeze({
  independentHostAttestation: false, signatureVerified: false,
  specialistAuthority: false, independentReviewSatisfied: false,
  protectedMergeAuthority: false, sourceMutationAuthority: false,
  leaseReleaseAuthority: false, windowsCommissioningAuthority: false,
  physicalPickupProven: false,
});
function held(reason) {
  return Object.freeze({
    status: 'CALIBRATION_HELD', reason, ...NO_AUTHORITY,
  });
}
// No calibration can bind to a caller-declared SHA alone. The WSL checkout
// must be the clean exact HEAD and branch before the local model is invoked.
// These fixed Git reads NEVER checkout/reset/stash/clean the operator's files.
export function inspectLocalCalibrationGitIdentityV1(env = process.env, {
  gitSpawn = spawnSync, platform = process.platform, sourceRoot = SOURCE_ROOT,
} = {}) {
  const head = String(env.STEPHANOS_REVIEW_EXACT_HEAD ?? '').toLowerCase();
  const base = String(env.STEPHANOS_REVIEW_EXACT_BASE ?? '').toLowerCase();
  const branch = String(env.STEPHANOS_REVIEW_EXACT_BRANCH ?? '');
  if (platform !== 'linux' || !SHA40.test(head) || !SHA40.test(base)
    || head === base || !BRANCH.test(branch)
    || branch.includes('..') || branch.endsWith('/')) {
    return Object.freeze({ ok: false, reason: 'CALIBRATION_EXACT_SOURCE_IDENTITY_INVALID' });
  }
  const readGit = args => {
    const execution = resolveBattleBridgeGitExecution({ platform: 'linux', environment: env });
    const r = gitSpawn(execution.executable, [...execution.fixedConfigArgs, '-C', sourceRoot, ...args], {
      encoding: 'utf8', shell: false, timeout: 12_000, maxBuffer: 4096,
      env: execution.environment,
    });
    if (r?.error || r?.status !== 0 || typeof r.stdout !== 'string')
      throw new Error('LOCAL_GIT_UNAVAILABLE');
    return r.stdout.trim();
  };
  try {
    if (readGit(['rev-parse', 'HEAD']).toLowerCase() !== head
      || readGit(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch
      || readGit(['status', '--porcelain', '--untracked-files=normal']) !== '') {
      return Object.freeze({ ok: false, reason: 'CALIBRATION_CLEAN_EXACT_CHECKOUT_REQUIRED' });
    }
    readGit(['merge-base', '--is-ancestor', base, head]);
    for (const file of CRITICAL_REVIEW_FILES) {
      // Git status alone can hide modifications through index flags.
      // Verify normal tracked index flags and hash actual on-disk bytes,
      // comparing to the exact committed object. Never checkout/reset.
      const flags = readGit(['ls-files', '-v', '--', file]);
      if (flags !== 'H ' + file) {
        return Object.freeze({ ok: false,
          reason: 'CALIBRATION_EXECUTABLE_INDEX_FLAGS_UNSAFE' });
      }
      const expectedBlob = readGit(['rev-parse', 'HEAD:' + file]);
      const observedBlob = readGit(['hash-object', '--no-filters', '--', file]);
      if (!SHA40.test(expectedBlob) || observedBlob !== expectedBlob) {
        return Object.freeze({ ok: false,
          reason: 'CALIBRATION_EXECUTABLE_BYTES_NOT_HEAD' });
      }
    }
    return Object.freeze({ ok: true, reason: '' });
  } catch {
    return Object.freeze({ ok: false, reason: 'CALIBRATION_SOURCE_GIT_UNPROVEN' });
  }
}
// Protect Battle Bridge VR/flat gaming. Calibrating a local model consumes GPU
// and CPU, and MUST stop if the independent Windows gaming governor is active,
// stale, missing or denies heavy models. This only reads its existing state;
// it never changes game, GPU, Ollama, or daemon operation.
export function inspectLocalSovereignGamingPermissionV1(env = process.env, {
  nowMs = Date.now(), openFile = openSync, readFile = readFileSync,
  statFile = fstatSync, closeFile = closeSync, platform = process.platform,
} = {}) {
  const workspace = String(env.STEPHANOS_SHARED_AGENT_WORKSPACE ?? '');
  if (platform !== 'linux' || !workspace.startsWith('/') || !isAbsolute(workspace)
    || normalize(workspace) !== workspace
    || workspace.includes('\0') || workspace.includes('\n')
    || workspace.includes('\r') || !Number.isSafeInteger(nowMs)) {
    return Object.freeze({ ok: false, reason: 'CALIBRATION_GOVERNOR_PATH_UNTRUSTED' });
  }
  const file = join(workspace, 'vr', 'vr-resource-governor-current.json');
  let fd;
  try {
    fd = openFile(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = statFile(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > 32_768) {
      return Object.freeze({ ok: false, reason: 'CALIBRATION_GOVERNOR_FILE_INVALID' });
    }
    const raw = readFile(fd, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 32_768) {
      return Object.freeze({ ok: false, reason: 'CALIBRATION_GOVERNOR_FILE_INVALID' });
    }
    const state = JSON.parse(raw);
    const when = Date.parse(state?.updatedAtUtc);
    // Missing or stringified gaming indicators must never be interpreted as
    // a safe idle state. The Windows writer always emits these as booleans.
    const mandatoryGamingFlags = [
      'active', 'flatGameActive', 'airLinkActive',
      'realAirLinkActive', 'virtualAirLinkTestActive', 'prepareLeaseActive',
      'localModelAllowed', 'heavyModelAllowed',
    ];
    if (state?.schemaVersion !== 'stephanos.vr-resource-governor.v1'
      || state.governorVersion !== 3
      || mandatoryGamingFlags.some(key => typeof state[key] !== 'boolean')
      || !['balanced', 'cool', 'off'].includes(state.ollamaLoadMode)
      || !Number.isFinite(when) || nowMs - when > 30_000
      || when - nowMs > 5_000) {
      return Object.freeze({ ok: false, reason: 'CALIBRATION_GOVERNOR_STALE_OR_INVALID' });
    }
    if (state.active || state.flatGameActive === true || state.airLinkActive === true
      || state.virtualAirLinkTestActive === true
      || state.realAirLinkActive === true || state.prepareLeaseActive === true
      || state.localModelAllowed !== true || state.heavyModelAllowed !== true
      || state.ollamaLoadMode !== 'balanced') {
      return Object.freeze({ ok: false, reason: 'CALIBRATION_GAMING_RESOURCE_PROTECTED' });
    }
    return Object.freeze({ ok: true, reason: '' });
  } catch {
    return Object.freeze({ ok: false, reason: 'CALIBRATION_GOVERNOR_UNAVAILABLE' });
  } finally {
    if (fd !== undefined) {
      try { closeFile(fd); } catch { /* fail-closed caller still rechecks */ }
    }
  }
}
// Model names are mutable tags. Bind a candidate to the same exact 64-hex
// Ollama digest before and after the exam, with no model load or raw inventory
// in public evidence. Digest is NOT independent supply-chain attestation.
export async function observeLocalSovereignOllamaDigestV1(model, {fetchImpl=fetch}={}) {
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function')
    return Object.freeze({ok:false,reason:'LOCAL_MODEL_NOT_CONFIGURED'});
  try {
    const response=await fetchImpl('http://127.0.0.1:11434/api/tags',
      {method:'GET',redirect:'error',signal:AbortSignal.timeout(6000)});
    if (!response?.ok || typeof response.text !== 'function')
      return Object.freeze({ok:false,reason:'LOCAL_OLLAMA_NOT_REACHABLE'});
    const raw=await response.text();
    if (typeof raw !== 'string' || Buffer.byteLength(raw,'utf8')>32768)
      return Object.freeze({ok:false,reason:'LOCAL_OLLAMA_MODEL_LIST_UNBOUNDED'});
    const models=JSON.parse(raw)?.models;
    if (!Array.isArray(models) || models.length>256)
      return Object.freeze({ok:false,reason:'LOCAL_OLLAMA_MODEL_LIST_INVALID'});
    const matches=models.filter(x=>x && typeof x==='object'
      && (x.name===model || x.model===model));
    if (matches.length!==1 || !/^[a-f0-9]{64}$/.test(matches[0]?.digest??''))
      return Object.freeze({ok:false,reason:'LOCAL_OLLAMA_MODEL_DIGEST_UNPROVEN'});
    return Object.freeze({ok:true,reason:'',digest:matches[0].digest});
  } catch {
    return Object.freeze({ok:false,reason:'LOCAL_OLLAMA_DIGEST_READ_UNAVAILABLE'});
  }
}
export async function runSovereignOllamaCalibrationV1(env = process.env, {
  fetchImpl = fetch, gitSpawn = spawnSync, platform = process.platform,
  sourceRoot = SOURCE_ROOT, gamingGuard = inspectLocalSovereignGamingPermissionV1,
  modelPin = observeLocalSovereignOllamaDigestV1,
  startPolling = setInterval, stopPolling = clearInterval,
} = {}) {
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function') {
    return held('LOCAL_MODEL_NOT_CONFIGURED');
  }
  const gitProof = inspectLocalCalibrationGitIdentityV1(env, { gitSpawn, platform, sourceRoot });
  if (!gitProof.ok) return held(gitProof.reason);
  const gaming = gamingGuard(env, { platform });
  if (!gaming?.ok) return held(gaming?.reason || 'CALIBRATION_GAMING_RESOURCE_UNPROVEN');
  const beforePin = await modelPin(model, {fetchImpl});
  if (!beforePin?.ok || !/^[a-f0-9]{64}$/.test(beforePin.digest??''))
    return held(beforePin?.reason || 'CALIBRATION_MODEL_DIGEST_UNPROVEN');
  const immutableModel = 'sha256:' + beforePin.digest;
  const input = {
    repository: env.STEPHANOS_REVIEW_REPOSITORY,
    sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    baseSha: env.STEPHANOS_REVIEW_EXACT_BASE,
    implementerPrincipal: env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION,
    reviewerPrincipal: env.STEPHANOS_REVIEW_SESSION,
    implementerProvider: env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER,
    reviewerProvider: 'sovereign-local-ollama',
    reviewerSessionId: env.STEPHANOS_REVIEW_SESSION,
  };
  const evaluation = await evaluateSovereignCalibrationV1(input, {
    invokeModel: async prompt => {
      // Every candidate inference rechecks the real live gaming governor.
      const currentGaming = gamingGuard(env, { platform });
      if (!currentGaming?.ok) throw new Error('CALIBRATION_GAMING_RESOURCE_PROTECTED');
      // A tag can be re-pointed in the middle of ten questions and later
      // restored. Pin the same observed digest immediately before EVERY
      // inference, not only the beginning and end of the complete exam.
      const currentPin = await modelPin(model, { fetchImpl });
      if (!currentPin?.ok || currentPin.digest !== beforePin.digest) {
        throw new Error('CALIBRATION_MODEL_DIGEST_CHANGED_DURING_EXAM');
      }
      // No prompt, source, model output or token enters a GitHub receipt.
      // Keep the real VR/flat governor in control *during* each inference,
      // not just before the request: an active generation may last 45s.
      // The independent governor's own model eviction remains authoritative.
      const gamingAbort = new AbortController();
      let gamingDenied = false;
      const monitor = startPolling(() => {
        try {
          const live = gamingGuard(env, { platform });
          if (!live?.ok) {
            gamingDenied = true;
            gamingAbort.abort(new Error('CALIBRATION_GAMING_RESOURCE_PROTECTED'));
          }
        } catch {
          gamingDenied = true;
          gamingAbort.abort(new Error('CALIBRATION_GAMING_RESOURCE_UNPROVEN'));
        }
      }, 500);
      try {
      const response = await fetchImpl('http://127.0.0.1:11434/api/generate', {
        // Never follow a redirect to a nonlocal endpoint with private diff text.
        // Node fetch follows 3xx by default, including cross-origin redirects.
        redirect: 'error',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: immutableModel, prompt, stream: false, format: 'json',
          // Release GPU residency after each bounded candidate challenge.
          keep_alive: 0,
          options: { temperature: 0, num_ctx: 8192 },
        }),
        signal: AbortSignal.any([AbortSignal.timeout(45_000), gamingAbort.signal]),
        // Ten cases, bounded within 570s WSL wall clock.
      });
      if (!response?.ok || typeof response.text !== 'function') {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNAVAILABLE');
      }
      const bytes = await response.text();
      if (gamingDenied || gamingAbort.signal.aborted) {
        throw new Error('CALIBRATION_GAMING_RESOURCE_PROTECTED');
      }
      if (typeof bytes !== 'string' || Buffer.byteLength(bytes, 'utf8') > 64 * 1024) {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNBOUNDED');
      }
      const result = JSON.parse(bytes);
      // An incomplete/truncated response or different actual model cannot
      // substantiate the claimed ten-case security qualification exam.
      const completedModel = String(result?.model ?? '').toLowerCase();
      if (![immutableModel, 'sha256-' + beforePin.digest].includes(completedModel)
        || result?.done !== true
        || result?.done_reason !== 'stop'
        || typeof result.response !== 'string'
        || Buffer.byteLength(result.response, 'utf8') > 12_288) {
        throw new Error('LOCAL_OLLAMA_COMPLETED_MODEL_IDENTITY_UNPROVEN');
      }
      return result.response;
      } finally {
        // Also clear the monitor on timeout, offline Ollama, malformed JSON,
        // and an in-flight game-preemption abort. Never leave a polling task.
        stopPolling(monitor);
      }
    },
  });
  // A ten-case exam can span minutes. Never publish a valid candidate if a
  // concurrent process changed branch, HEAD, base ancestry or worktree.
  // This second native check is read-only and does not reset local changes.
  const after = inspectLocalCalibrationGitIdentityV1(env, { gitSpawn, platform, sourceRoot });
  if (!after.ok) return held('CALIBRATION_SOURCE_CHANGED_DURING_EXAM');
  const finalGaming = gamingGuard(env, { platform });
  if (!finalGaming?.ok) return held(finalGaming?.reason || 'CALIBRATION_GAMING_RESOURCE_UNPROVEN');
  const afterPin=await modelPin(model,{fetchImpl});
  if (!afterPin?.ok || afterPin.digest!==beforePin.digest)
    return held('CALIBRATION_MODEL_DIGEST_CHANGED_OR_UNOBSERVED');
  return Object.freeze({...evaluation,modelDigestSha256:beforePin.digest});
}
// Read-only model availability preflight. Ollama's /api/tags endpoint does
// NOT load a model or modify the host. No user path, URL, tokens, inventory,
// model metadata or credential fields are copied to public receipts.
export async function probeLocalSovereignOllamaV1(env = process.env, {
  fetchImpl = fetch, gitSpawn = spawnSync, platform = process.platform,
  sourceRoot = SOURCE_ROOT, gamingGuard = inspectLocalSovereignGamingPermissionV1,
} = {}) {
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function') {
    return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
      reason: 'LOCAL_MODEL_NOT_CONFIGURED', ...NO_AUTHORITY });
  }
  const source = inspectLocalCalibrationGitIdentityV1(env, { gitSpawn, platform, sourceRoot });
  if (!source.ok) return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: source.reason, ...NO_AUTHORITY });
  const gaming = gamingGuard(env, { platform });
  if (!gaming?.ok) return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason: gaming?.reason || 'CALIBRATION_GAMING_RESOURCE_UNPROVEN', ...NO_AUTHORITY });
  const observed=await observeLocalSovereignOllamaDigestV1(model,{fetchImpl});
  return Object.freeze({
    status:observed.ok?'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED':'LOCAL_OLLAMA_PREFLIGHT_HELD',
    reason:observed.reason,selectedModelPresent:observed.ok,
    sourceVerified:observed.ok,gamingClear:observed.ok,
    modelDigestSha256:observed.ok?observed.digest:'',...NO_AUTHORITY,
  });
}
// A model result is only an untrusted candidate. Preserve a bounded, exact
// source-bound observation for an independent auditor in the existing Shared
// Workspace/proofs directory, using native O_EXCL: never overwrite an older
// exam receipt or modify the source checkout. This does NOT sign the record.
export function persistSovereignCalibrationCandidateV1(result, env = process.env) {
  const candidate = projectSovereignOllamaCalibrationV1(result);
  const workspace = String(env.STEPHANOS_SHARED_AGENT_WORKSPACE ?? '');
  const pr = Number(env.STEPHANOS_REVIEW_PR);
  if (candidate.status !== 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
    || !Number.isSafeInteger(pr) || pr < 1 || pr > 999_999_999
    || !workspace.startsWith('/') || !isAbsolute(workspace)
    || normalize(workspace) !== workspace || /[\0\r\n]/.test(workspace)) {
    throw new Error('CALIBRATION_CANDIDATE_PUBLICATION_NOT_ADMITTED');
  }
  const name = 'sovereign-calibration-pr-' + pr + '-'
    + candidate.sourceHead.slice(0, 12) + '-'
    + candidate.observationsSha256.slice(0, 12) + '.json';
  const proofRef = 'proofs/' + name;
  const record = {
    schemaVersion: 'stephanos.sovereign-reviewer-calibration-candidate.v1',
    ...candidate,
    prNumber: pr,
    observedAtUtc: new Date().toISOString(),
    qualification: 'PENDING_INDEPENDENT_ATTESTATION',
    auditAuthority: false,
    protectedReviewSatisfied: false,
  };
  const json = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(json, 'utf8') > 4096) {
    throw new Error('CALIBRATION_CANDIDATE_PUBLICATION_UNBOUNDED');
  }
  const digest = createHash('sha256').update(json).digest('hex');
  let rootFd; let proofsFd; let outputFd;
  try {
    rootFd = openSync(workspace,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    proofsFd = openSync('/proc/self/fd/' + rootFd + '/proofs',
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    outputFd = openSync('/proc/self/fd/' + proofsFd + '/' + name,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(outputFd, json, 'utf8');
    fsyncSync(outputFd);
  } finally {
    if (outputFd !== undefined) closeSync(outputFd);
    if (proofsFd !== undefined) closeSync(proofsFd);
    if (rootFd !== undefined) closeSync(rootFd);
  }
  return Object.freeze({
    ...candidate,
    proofRef,
    proofSha256: digest,
    qualification: 'PENDING_INDEPENDENT_ATTESTATION',
  });
}
export function projectSovereignOllamaCalibrationV1(result = {}) {
  const sha40 = /^[a-f0-9]{40}$/;
  const sha64 = /^[a-f0-9]{64}$/;
  // A displayable candidate must be structurally consistent with the real
  // private ten-case scorer, not just an untrusted {status:'passed'} object.
  // Even an internally consistent projection is NOT an auditor signature.
  const ok = result.status === 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
    && result.repository === 'Cheekyfellastef/stephan-os'
    && sha40.test(result.sourceHead ?? '') && sha40.test(result.baseSha ?? '')
    && result.sourceHead !== result.baseSha
    && result.completedCases === 10 && result.passedCases === 10
    && result.manifestSha256 === SOVEREIGN_CALIBRATION_MANIFEST_SHA256
    && sha64.test(result.observationsSha256 ?? '')
    && sha64.test(result.modelDigestSha256 ?? '')
    && result.independentHostAttestation === false
    && result.signatureVerified === false
    && result.specialistAuthority === false
    && result.independentReviewSatisfied === false
    && result.protectedMergeAuthority === false
    && result.sourceMutationAuthority === false
    && result.leaseReleaseAuthority === false
    && result.windowsCommissioningAuthority === false
    && result.physicalPickupProven === false;
  return Object.freeze({
    status: ok ? 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED' : 'CALIBRATION_HELD',
    reason: ok ? '' : String(result.status === 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
      ? 'CALIBRATION_RESULT_INCONSISTENT' : result.reason || 'CALIBRATION_UNQUALIFIED').slice(0, 120),
    repository: result.repository === 'Cheekyfellastef/stephan-os' ? result.repository : '',
    sourceHead: sha40.test(result.sourceHead ?? '') ? result.sourceHead : '',
    baseSha: sha40.test(result.baseSha ?? '') ? result.baseSha : '',
    completedCases: Number.isSafeInteger(result.completedCases) && result.completedCases >= 0
      && result.completedCases <= 10 ? result.completedCases : 0,
    passedCases: Number.isSafeInteger(result.passedCases) && result.passedCases >= 0
      && result.passedCases <= 10 ? result.passedCases : 0,
    manifestSha256: sha64.test(result.manifestSha256 ?? '') ? result.manifestSha256 : '',
    observationsSha256: sha64.test(result.observationsSha256 ?? '') ? result.observationsSha256 : '',
    modelDigestSha256: sha64.test(result.modelDigestSha256 ?? '') ? result.modelDigestSha256 : '',
    ...NO_AUTHORITY,
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--once', '--preflight'].includes(process.argv[2])) {
    process.stderr.write('SOVEREIGN_CALIBRATION_HELD=FIXED_ONCE_ONLY\n');
    process.exitCode = 2;
  } else if (process.argv[2] === '--preflight') {
    probeLocalSovereignOllamaV1()
      .then(result => {
        process.stdout.write('SOVEREIGN_REVIEW_PREFLIGHT_RESULT=' + JSON.stringify(result) + '\n');
        if (result.status !== 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED') process.exitCode = 2;
      })
      .catch(() => {
        process.stdout.write('SOVEREIGN_REVIEW_PREFLIGHT_RESULT=' + JSON.stringify({
          status: 'LOCAL_OLLAMA_PREFLIGHT_HELD', reason: 'LOCAL_OLLAMA_READ_ONLY_PROBE_FAILED',
          ...NO_AUTHORITY,
        }) + '\n');
        process.exitCode = 2;
      });
  } else {
    runSovereignOllamaCalibrationV1()
      .then(result => {
        const candidate = projectSovereignOllamaCalibrationV1(result);
        let summary = candidate;
        if (candidate.status === 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED') {
          try { summary = persistSovereignCalibrationCandidateV1(result); }
          catch { summary = projectSovereignOllamaCalibrationV1(held('CALIBRATION_CANDIDATE_PUBLICATION_FAILED')); }
        }
        process.stdout.write('SOVEREIGN_REVIEW_CALIBRATION_RESULT=' + JSON.stringify(summary) + '\n');
        if (summary.status !== 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED') process.exitCode = 2;
      })
      .catch(() => {
        process.stdout.write('SOVEREIGN_REVIEW_CALIBRATION_RESULT='
          + JSON.stringify(projectSovereignOllamaCalibrationV1(held('LOCAL_MODEL_EXECUTION_FAILED'))) + '\n');
        process.exitCode = 2;
      });
  }
}
