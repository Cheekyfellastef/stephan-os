#!/usr/bin/env node
// Local Ollama candidate calibration: fixed ten adversarial cases only.
// No GitHub, arbitrary command, Windows witness, approval or merge capability.
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { evaluateSovereignCalibrationV1 } from '../shared/agents/sovereignCalibrationV1.mjs';

const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SOURCE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/;
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
    const r = gitSpawn('/usr/bin/git', ['-C', sourceRoot, ...args], {
      encoding: 'utf8', shell: false, timeout: 12_000, maxBuffer: 4096,
      env: { PATH: '/usr/bin:/bin', HOME: '/tmp', GIT_CONFIG_NOSYSTEM: '1' },
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
    return Object.freeze({ ok: true, reason: '' });
  } catch {
    return Object.freeze({ ok: false, reason: 'CALIBRATION_SOURCE_GIT_UNPROVEN' });
  }
}
export async function runSovereignOllamaCalibrationV1(env = process.env, {
  fetchImpl = fetch, gitSpawn = spawnSync, platform = process.platform,
  sourceRoot = SOURCE_ROOT,
} = {}) {
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function') {
    return held('LOCAL_MODEL_NOT_CONFIGURED');
  }
  const gitProof = inspectLocalCalibrationGitIdentityV1(env, { gitSpawn, platform, sourceRoot });
  if (!gitProof.ok) return held(gitProof.reason);
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
  return evaluateSovereignCalibrationV1(input, {
    invokeModel: async prompt => {
      // No prompt, source, model output or token enters a GitHub receipt.
      const response = await fetchImpl('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, prompt, stream: false, format: 'json',
          options: { temperature: 0, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(45_000), // 10 cases, bounded within 570s WSL wall clock
      });
      if (!response?.ok || typeof response.text !== 'function') {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNAVAILABLE');
      }
      const bytes = await response.text();
      if (typeof bytes !== 'string' || Buffer.byteLength(bytes, 'utf8') > 64 * 1024) {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNBOUNDED');
      }
      const result = JSON.parse(bytes);
      if (typeof result?.response !== 'string'
        || Buffer.byteLength(result.response, 'utf8') > 12_288) {
        throw new Error('LOCAL_OLLAMA_RESPONSE_INVALID');
      }
      return result.response;
    },
  });
}
// Read-only model availability preflight. Ollama's /api/tags endpoint does
// NOT load a model or modify the host. No user path, URL, tokens, inventory,
// model metadata or credential fields are copied to public receipts.
export async function probeLocalSovereignOllamaV1(env = process.env, {
  fetchImpl = fetch,
} = {}) {
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function') {
    return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
      reason: 'LOCAL_MODEL_NOT_CONFIGURED', ...NO_AUTHORITY });
  }
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', {
      method: 'GET', signal: AbortSignal.timeout(6000),
    });
    if (!response?.ok || typeof response.text !== 'function') {
      return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
        reason: 'LOCAL_OLLAMA_NOT_REACHABLE', ...NO_AUTHORITY });
    }
    const raw = await response.text();
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32 * 1024) {
      return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
        reason: 'LOCAL_OLLAMA_MODEL_LIST_UNBOUNDED', ...NO_AUTHORITY });
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.models) || parsed.models.length > 256) {
      return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
        reason: 'LOCAL_OLLAMA_MODEL_LIST_INVALID', ...NO_AUTHORITY });
    }
    const available = parsed.models.some(x => x && typeof x === 'object'
      && (x.name === model || x.model === model));
    return Object.freeze({
      status: available ? 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED'
        : 'LOCAL_OLLAMA_PREFLIGHT_HELD',
      reason: available ? '' : 'SELECTED_LOCAL_MODEL_UNAVAILABLE',
      selectedModelPresent: available, ...NO_AUTHORITY,
    });
  } catch {
    return Object.freeze({ status: 'LOCAL_OLLAMA_PREFLIGHT_HELD',
      reason: 'LOCAL_OLLAMA_READ_ONLY_PROBE_FAILED', ...NO_AUTHORITY });
  }
}
export function projectSovereignOllamaCalibrationV1(result = {}) {
  const ok = result.status === 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED';
  const sha40 = /^[a-f0-9]{40}$/;
  const sha64 = /^[a-f0-9]{64}$/;
  return Object.freeze({
    status: ok ? 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED' : 'CALIBRATION_HELD',
    reason: ok ? '' : String(result.reason || 'CALIBRATION_UNQUALIFIED').slice(0, 120),
    repository: result.repository === 'Cheekyfellastef/stephan-os' ? result.repository : '',
    sourceHead: sha40.test(result.sourceHead ?? '') ? result.sourceHead : '',
    baseSha: sha40.test(result.baseSha ?? '') ? result.baseSha : '',
    completedCases: Number.isSafeInteger(result.completedCases) && result.completedCases >= 0
      && result.completedCases <= 10 ? result.completedCases : 0,
    passedCases: Number.isSafeInteger(result.passedCases) && result.passedCases >= 0
      && result.passedCases <= 10 ? result.passedCases : 0,
    manifestSha256: sha64.test(result.manifestSha256 ?? '') ? result.manifestSha256 : '',
    observationsSha256: sha64.test(result.observationsSha256 ?? '') ? result.observationsSha256 : '',
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
        const summary = projectSovereignOllamaCalibrationV1(result);
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
