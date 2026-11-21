#!/usr/bin/env node
// Fixed Windows -> WSL launcher for the existing Linux handle-pinned Sovereign
// Reviewer. This is a candidate producer, never an approval or merge channel.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sovereignExactCommitLoaderV1 } from '../shared/agents/sovereignExactCommitLoaderV1.mjs';
import { resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { classifyDirt } from './battle-bridge-github-sync-policy.mjs';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const REVIEWER = path.join(SOURCE_ROOT, 'scripts', 'sovereign-reviewer-v1.mjs');
const SHA = /^[a-f0-9]{40}$/i;
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const ID = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const text = value => String(value ?? '').trim();
const VALID_KEYS = Object.freeze([
  'STEPHANOS_REVIEW_EXACT_HEAD', 'STEPHANOS_REVIEW_EXACT_BASE',
  'STEPHANOS_REVIEW_EXACT_BRANCH', 'STEPHANOS_REVIEW_REPOSITORY',
  'STEPHANOS_REVIEW_ISSUE', 'STEPHANOS_REVIEW_PR',
  'STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER',
  'STEPHANOS_REVIEW_IMPLEMENTER_SESSION', 'STEPHANOS_REVIEW_SESSION',
  'STEPHANOS_SOVEREIGN_REVIEW_MODEL',
  'STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS',
]);
// Closed-list, non-secret reasons returned ONLY from the fixed read-only
// local preflight. Never surface arbitrary Linux stdout, paths, identities,
// model inventory, exception text or caller-supplied reason strings.
const PREFLIGHT_SAFE_HOLD_REASONS = new Set([
  'LOCAL_MODEL_NOT_CONFIGURED',
  'CALIBRATION_EXACT_SOURCE_IDENTITY_INVALID',
  'CALIBRATION_CLEAN_EXACT_CHECKOUT_REQUIRED',
  'CALIBRATION_EXECUTABLE_INDEX_FLAGS_UNSAFE',
  'CALIBRATION_EXECUTABLE_BYTES_NOT_HEAD',
  'CALIBRATION_SOURCE_GIT_UNPROVEN',
  'CALIBRATION_GOVERNOR_PATH_UNTRUSTED',
  'CALIBRATION_GOVERNOR_FILE_INVALID',
  'CALIBRATION_GOVERNOR_STALE_OR_INVALID',
  'CALIBRATION_GAMING_RESOURCE_PROTECTED',
  'CALIBRATION_GOVERNOR_UNAVAILABLE',
  'CALIBRATION_GAMING_RESOURCE_UNPROVEN',
  'LOCAL_OLLAMA_NOT_REACHABLE',
  'LOCAL_OLLAMA_MODEL_LIST_UNBOUNDED',
  'LOCAL_OLLAMA_MODEL_LIST_INVALID',
  'LOCAL_OLLAMA_MODEL_DIGEST_UNPROVEN',
  'LOCAL_OLLAMA_DIGEST_READ_UNAVAILABLE',
  'LOCAL_OLLAMA_READ_ONLY_PROBE_FAILED',
  'SELECTED_LOCAL_MODEL_UNAVAILABLE',
]);
const error = reason => Object.freeze({ ok: false, reason, approvalAuthority: false, mergeAuthority: false });

export function planWindowsSovereignReviewerV1(env, {
  platform = process.platform, sourceRoot = SOURCE_ROOT,
  exists = existsSync,
} = {}) {
  if (platform !== 'win32') return error('WINDOWS_HOST_REQUIRED');
  const root = path.win32.resolve(sourceRoot);
  const reviewer = path.win32.join(root, 'scripts', 'sovereign-reviewer-v1.mjs');
  if (!path.win32.isAbsolute(root) || !/^[a-z]:\\/i.test(root)
    || !exists(reviewer)) return error('REVIEWER_SOURCE_UNAVAILABLE');
  const workspace = text(env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  if (!/^[a-z]:\\/i.test(workspace) || /[\0\r\n]/.test(workspace)) {
    return error('LOCAL_WORKSPACE_REQUIRED');
  }
  const head = text(env.STEPHANOS_REVIEW_EXACT_HEAD);
  const base = text(env.STEPHANOS_REVIEW_EXACT_BASE);
  const branch = text(env.STEPHANOS_REVIEW_EXACT_BRANCH);
  const repo = text(env.STEPHANOS_REVIEW_REPOSITORY);
  if (!SHA.test(head) || !SHA.test(base) || head.toLowerCase() === base.toLowerCase()
    || !BRANCH.test(branch) || branch.includes('..') || !REPO.test(repo)) {
    return error('EXACT_GIT_IDENTITY_REQUIRED');
  }
  if (![env.STEPHANOS_REVIEW_ISSUE, env.STEPHANOS_REVIEW_PR].every(value => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && String(n) === String(value);
  })) return error('REVIEW_ISSUE_AND_PR_REQUIRED');
  if (![env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER, env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION,
    env.STEPHANOS_REVIEW_SESSION].every(value => ID.test(text(value)))) {
    return error('INDEPENDENT_REVIEW_IDENTITIES_REQUIRED');
  }
  // A callback-provided identity cannot make one session independent of itself.
  // Check the explicit session collision even before invoking WSL or Ollama.
  if (text(env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION).toLowerCase()
    === text(env.STEPHANOS_REVIEW_SESSION).toLowerCase()) {
    return error('REVIEWER_IMPLEMENTER_SESSION_COLLISION');
  }
  if (env.STEPHANOS_SOVEREIGN_REVIEW_MODEL
    && !/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL))) {
    return error('UNSAFE_LOCAL_MODEL');
  }
  if (env.STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS
    && !ID.test(text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS))) {
    return error('INVALID_MODEL_CLASS');
  }
  return Object.freeze({
    ok: true, sourceRoot: root, reviewer, workspace,
    reviewEnv: Object.freeze(Object.fromEntries(VALID_KEYS
      .filter(key => text(env[key]))
      .map(key => [key, text(env[key])] ))),
    approvalAuthority: false, mergeAuthority: false,
  });
}

// This runs via fixed trusted WSL git BEFORE the reviewer script is executed.
// In particular, git status alone ignores assume-unchanged and skip-worktree.
// Every executable/policy dependency in this bounded reviewer import closure
// must match HEAD byte-for-byte, with no index masking of modifications.
export const REVIEWER_CRITICAL_SOURCE_PATHS = Object.freeze([
  'scripts/sovereign-reviewer-v1.mjs',
  'scripts/sovereign-reviewer-ollama-calibration-v1.mjs',
  'scripts/battle-bridge-github-sync-policy.mjs',
  'shared/agents/sovereignReviewerV1.mjs',
  'shared/agents/sovereignReviewerOllamaBindingV1.mjs',
  'shared/agents/sovereignCalibrationV1.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
  'shared/agents/battleBridgeWindowsHosts.mjs',
  'shared/agents/providerNeutralReviewV1.mjs',
  'shared/agents/executionReceiptV1.mjs',
  'shared/agents/sharedAgentWorkspaceStore.mjs',
  'shared/agents/sharedWorkspaceRuntimeConfig.mjs',
  'shared/agents/sharedAgentWorkspace.mjs',
  'shared/agents/engineeringIncidentMethodMemoryV1.mjs',
  'shared/agents/closedLoopLearningV1.mjs',
]);
export function verifyWslReviewerExecutableBytesV1({ run, reviewerPath, reviewEnv }) {
  const safe = value => typeof value === 'string' ? value.trim() : '';
  const suffix = '/scripts/sovereign-reviewer-v1.mjs';
  if (typeof run !== 'function' || typeof reviewerPath !== 'string'
    || !reviewerPath.startsWith('/') || !reviewerPath.endsWith(suffix)
    || reviewerPath.includes('/../') || reviewerPath.includes('/./')) {
    return error('REVIEWER_SOURCE_BYTES_UNVERIFIED');
  }
  const root = reviewerPath.slice(0, -suffix.length);
  if (!root || root === '/') return error('REVIEWER_SOURCE_BYTES_UNVERIFIED');
  const execution = resolveBattleBridgeGitExecution({ platform: 'linux', environment: {} });
  const gitEnvironment = Object.entries(execution.environment).map(([key, value]) => key + '=' + value);
  const git = (args, raw = false) => {
    // Environment clearing alone does not disable repository-local fsmonitor
    // or helpers. Apply the same fixed Git boundary as every other reviewer.
    const result = run(['/usr/bin/env', '-i', 'HOME=/tmp', ...gitEnvironment,
      execution.executable, ...execution.fixedConfigArgs, '-C', root, ...args], 12_000);
    if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string'
      || result.stdout.length > 4096) throw Error('REVIEWER_SOURCE_GIT_UNVERIFIED');
    return raw ? result.stdout : safe(result.stdout);
  };
  try {
    const localConfig = git(['config', '--local', '--null', '--list', '--no-includes'], true);
    if (!validateBattleBridgeLocalGitConfiguration(localConfig).ok) {
      return error('REVIEWER_SOURCE_GIT_UNVERIFIED');
    }
    if (git(['rev-parse', 'HEAD']) !== reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD
      || git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== reviewEnv.STEPHANOS_REVIEW_EXACT_BRANCH) {
      return error('REVIEWER_SOURCE_HEAD_OR_WORKTREE_UNVERIFIED');
    }
    // Do not trim porcelain's status columns or collapse a staged rename:
    // source dirt still holds, while the canonical runtime-only policy applies.
    const statusOutput = git(['-c', 'status.renames=false', 'status', '--porcelain', '--untracked-files=normal'], true);
    const statusLines = statusOutput === '' ? [] : statusOutput.replace(/\r?\n$/, '').split(/\r?\n/);
    if (statusLines.some(line => !/^(?:[ MADTU]{2}|\?\?) [^\x00-\x1f\x7f]+$/.test(line)
      || line.startsWith('  ') || line.slice(3) !== line.slice(3).trim()
      || line.slice(3).split('/').some(part => part === '.' || part === '..'))
      || classifyDirt(statusLines).blocksSync) {
      return error('REVIEWER_SOURCE_HEAD_OR_WORKTREE_UNVERIFIED');
    }
    git(['merge-base', '--is-ancestor', reviewEnv.STEPHANOS_REVIEW_EXACT_BASE,
      reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD]);
    for (const file of REVIEWER_CRITICAL_SOURCE_PATHS) {
      // H = ordinary tracked entry. lowercase/skip-worktree variants are
      // never accepted even if hash-object happens to match at this instant.
      if (git(['ls-files', '-v', '--', file]) !== 'H ' + file) {
        return error('REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE');
      }
      const expected = git(['rev-parse', 'HEAD:' + file]);
      const actual = git(['hash-object', '--no-filters', '--', file]);
      if (!/^[0-9a-f]{40}$/.test(expected) || actual !== expected) {
        return error('REVIEWER_SOURCE_BYTES_NOT_HEAD');
      }
    }
    return Object.freeze({ ok: true, sourceHead: reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD });
  } catch {
    return error('REVIEWER_SOURCE_GIT_UNVERIFIED');
  }
}

export function runWindowsSovereignReviewerV1(env = process.env, {
  platform = process.platform, sourceRoot = SOURCE_ROOT, exists = existsSync,
  spawn = spawnSync, mode = 'review',
  verifySource = verifyWslReviewerExecutableBytesV1,
} = {}) {
  const plan = planWindowsSovereignReviewerV1(env, { platform, sourceRoot, exists });
  if (!plan.ok) return plan;
  if (!['review', 'calibration', 'preflight'].includes(mode)) return error('REVIEW_MODE_UNSUPPORTED');
  // This legacy route selected executable producer code from the PR head. The
  // Windows installed profile cannot attest WSL binaries/principal/custody.
  // Preserve this explicit boundary until a purpose-correct WSL profile exists;
  // no path conversion, candidate evaluation, Ollama or publication occurs.
  return error('WSL_INSTALLED_REVIEWER_PROFILE_REQUIRED');

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--once', '--calibrate', '--preflight'].includes(process.argv[2])) {
    process.stderr.write('SOVEREIGN_REVIEW_WSL_HELD=FIXED_MODE_ONLY\n');
    process.exitCode = 2;
  } else {
    const result = runWindowsSovereignReviewerV1(process.env, {
      mode: process.argv[2] === '--calibrate' ? 'calibration'
        : process.argv[2] === '--preflight' ? 'preflight' : 'review',
    });
    process.stdout.write('SOVEREIGN_REVIEW_WSL_RESULT=' + JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 2;
  }
}
