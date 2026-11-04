#!/usr/bin/env node
// Native Windows *candidate* competency exam for existing Sovereign Reviewer.
// No Windows service operation, lease mutation, deployment or GitHub approval.
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHighRiskAdvisorySnapshotV1 } from './sovereign-high-risk-advisory-v1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { evaluateSovereignWindowsCalibrationV1 } from '../shared/agents/sovereignWindowsCalibrationV1.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILES = Object.freeze([
  'scripts/sovereign-windows-review-calibration-v1.mjs',
  'shared/agents/sovereignWindowsCalibrationV1.mjs',
  'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  'shared/agents/sovereignHighRiskReviewCandidateV1.mjs',
  'shared/agents/sovereignReviewCoverageV1.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
  'scripts/sovereign-high-risk-advisory-v1.mjs',
]);
const MODEL = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SHA64 = /^[a-f0-9]{64}$/;
const NO_AUTHORITY = Object.freeze({
  qualifiedWindowsSpecialist: false, independentSecurityReviewSatisfied: false,
  independentHostAttestation: false, signatureVerified: false,
  protectedMergeAuthority: false, serviceInstallationAuthority: false,
  sourceMutationAuthority: false, leaseReleaseAuthority: false,
  signedWindowsCustodyProven: false, physicalPickupProven: false,
});
const held = reason => Object.freeze({
  status: 'WINDOWS_CALIBRATION_HELD', reason, ...NO_AUTHORITY,
});

export function inspectWindowsCalibrationSourceV1(env = process.env, {
  spawn = spawnSync, platform = process.platform, root = ROOT,
  resolveGit = resolveBattleBridgeGitExecution,
} = {}) {
  if (platform !== 'win32') return false;
  try {
    const git = args => {
      const execution = resolveGit({platform, environment: env});
      const result = spawn(execution.executable, [
        ...execution.fixedConfigArgs,
        '--git-dir=' + join(root, '.git'), '--work-tree=' + root, ...args,
      ], { encoding: 'utf8', shell: false, windowsHide: true,
        timeout: 12_000, maxBuffer: 4096, env: {
          ...execution.environment,
          GIT_NO_REPLACE_OBJECTS: '1',
          GIT_GRAFT_FILE: 'NUL',
        } });
      if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string') {
        throw Error('GIT_READ_UNAVAILABLE');
      }
      return result.stdout.trim();
    };
    // Neither status --porcelain nor an untrusted provided SHA is sufficient:
    // index skip-worktree and assume-unchanged can hide local file mutations.
    for (const path of FILES) {
      if (git(['ls-files', '-v', '--', path]) !== 'H ' + path) return false;
      const expected = git(['rev-parse', 'HEAD:' + path]);
      const actual = git(['hash-object', '--no-filters', '--', path]);
      if (!/^[a-f0-9]{40}$/i.test(expected) || actual !== expected) return false;
    }
    return true;
  } catch { return false; }
}

export function inspectWindowsCalibrationGamingGuardV1(env = process.env, {
  nowMs = Date.now(), stat = lstatSync, read = readFileSync,
} = {}) {
  const root = String(env.STEPHANOS_SHARED_AGENT_WORKSPACE ?? '');
  if (!/^[a-z]:\\/i.test(root) || /[\0\r\n]/.test(root)
    || win32.resolve(root).toLowerCase() !== root.replace(/[\\]+$/, '').toLowerCase()
    || !Number.isSafeInteger(nowMs)) return false;
  try {
    const file = join(root, 'vr', 'vr-resource-governor-current.json');
    const info = stat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > 32_768) return false;
    const raw = read(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 32_768) return false;
    const state = JSON.parse(raw);
    const flags = ['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive',
      'virtualAirLinkTestActive', 'prepareLeaseActive', 'localModelAllowed',
      'heavyModelAllowed'];
    const observed = Date.parse(state?.updatedAtUtc);
    return state?.schemaVersion === 'stephanos.vr-resource-governor.v1'
      && state.governorVersion === 3
      && flags.every(x => typeof state[x] === 'boolean')
      && Number.isFinite(observed)
      && nowMs - observed >= 0 && nowMs - observed <= 30_000
      && !state.active && !state.flatGameActive && !state.airLinkActive
      && !state.realAirLinkActive && !state.virtualAirLinkTestActive
      && !state.prepareLeaseActive && state.localModelAllowed
      && state.heavyModelAllowed && state.ollamaLoadMode === 'balanced';
  } catch { return false; }
}

export async function observeWindowsCalibrationModelDigestV1(model, fetchImpl = fetch) {
  if (!MODEL.test(model)) return '';
  try {
    const r = await fetchImpl('http://127.0.0.1:11434/api/tags', {
      method:'GET', redirect:'error', signal:AbortSignal.timeout(6_000),
    });
    if (!r?.ok) return '';
    const raw = await r.text();
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32_768) return '';
    const models = JSON.parse(raw)?.models;
    if (!Array.isArray(models) || models.length > 256) return '';
    const matches = models.filter(x => x?.name === model || x?.model === model);
    const digest = matches.length === 1 ? matches[0].digest : '';
    return SHA64.test(digest ?? '') ? digest : '';
  } catch { return ''; }
}

export async function runWindowsCalibrationCandidateV1(env = process.env, {
  platform = process.platform, snapshot = captureHighRiskAdvisorySnapshotV1,
  sourceCheck = inspectWindowsCalibrationSourceV1,
  gamingGuard = inspectWindowsCalibrationGamingGuardV1,
  digest = observeWindowsCalibrationModelDigestV1, fetchImpl = fetch,
  poll = setInterval, clearPoll = clearInterval, clock = () => performance.now(),
} = {}) {
  const deadline = clock() + 150_000;
  const expired = () => clock() >= deadline;
  if (platform !== 'win32') return held('NATIVE_WINDOWS_HOST_REQUIRED');
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL.test(model)) return held('MODEL_INVALID');
  let before;
  try { before = snapshot(env, {platform}); }
  catch { return held('EXACT_LOCAL_SOURCE_UNPROVEN'); }
  if (!sourceCheck(env, {platform})) return held('REVIEWER_EXECUTABLE_BYTES_UNPROVEN');
  if (!gamingGuard(env)) return held('GAMING_RESOURCE_UNAVAILABLE_OR_PROTECTED');
  const firstDigest = await digest(model, fetchImpl);
  if (!SHA64.test(firstDigest)) return held('LOCAL_MODEL_DIGEST_UNPROVEN');
  if (expired()) return held('CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
  const identity = {
    repository: before.repository, sourceHead: before.sourceHead, baseSha: before.baseSha,
    implementerPrincipal: env.STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL,
    reviewerPrincipal: env.STEPHANOS_REVIEW_REVIEWER_PRINCIPAL,
    implementerProvider: before.implementerProvider,
    reviewerProvider: 'sovereign-local-ollama',
    reviewerSessionId: before.reviewerSessionId,
  };
  const result = await evaluateSovereignWindowsCalibrationV1(identity, {
    invokeModel: async prompt => {
      if (expired()) throw Error('CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
      if (!gamingGuard(env) || await digest(model, fetchImpl) !== firstDigest) {
        throw Error('GAMING_OR_MODEL_DIGEST_CHANGED');
      }
      if (expired()) throw Error('CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
      const controller = new AbortController();
      const monitor = poll(() => {
        if (expired() || !gamingGuard(env)) controller.abort();
      }, 500);
      try {
        const r = await fetchImpl('http://127.0.0.1:11434/api/generate', {
          method:'POST', redirect:'error',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ model:'sha256:' + firstDigest, prompt, stream:false, format:'json',
            keep_alive:0, options:{temperature:0,num_ctx:8192} }),
          signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(45_000, Math.floor(deadline - clock())))), controller.signal]),
        });
        if (!r?.ok || controller.signal.aborted) throw Error('LOCAL_MODEL_UNAVAILABLE');
        const raw = await r.text();
        if (controller.signal.aborted || typeof raw !== 'string'
          || Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw Error('LOCAL_MODEL_OUTPUT_UNSAFE');
        const response = JSON.parse(raw);
        if (!['sha256:' + firstDigest, 'sha256-' + firstDigest].includes(response?.model) || response?.done !== true
          || response?.done_reason !== 'stop' || typeof response.response !== 'string') {
          throw Error('MODEL_COMPLETION_IDENTITY_UNPROVEN');
        }
        return response.response;
      } finally { clearPoll(monitor); }
    },
  });
  if (expired()) return held('CALIBRATION_TOTAL_DEADLINE_EXCEEDED');
  // Head/base, source bytes, governor and model identity must remain stable.
  let after;
  try { after = snapshot(env, {platform}); }
  catch { return held('SOURCE_CHANGED_DURING_CALIBRATION'); }
  if (JSON.stringify([before.sourceHead,before.baseSha,before.branch])
      !== JSON.stringify([after.sourceHead,after.baseSha,after.branch])
    || !sourceCheck(env, {platform}) || !gamingGuard(env)
    || await digest(model, fetchImpl) !== firstDigest || expired()) {
    return held('SOURCE_MODEL_OR_GAMING_CHANGED_DURING_CALIBRATION');
  }
  return Object.freeze({
    ...result,
    modelDigestSha256: firstDigest,
    qualification: 'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',
    ...NO_AUTHORITY,
  });
}
