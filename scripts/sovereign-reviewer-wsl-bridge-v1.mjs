#!/usr/bin/env node
// Fixed Windows -> WSL launcher for the existing Linux handle-pinned Sovereign
// Reviewer. This is a candidate producer, never an approval or merge channel.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sovereignExactCommitLoaderV1 } from '../shared/agents/sovereignExactCommitLoaderV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

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
  'shared/agents/sovereignReviewerV1.mjs',
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
  const git = args => {
    // No shell, user Git aliases, inherited Git config or mutable helper script.
    const result = run(['/usr/bin/env', '-i',
      'PATH=/usr/bin:/bin', 'HOME=/tmp', 'GIT_CONFIG_NOSYSTEM=1',
      'GIT_CONFIG_GLOBAL=/dev/null', 'GIT_NO_REPLACE_OBJECTS=1',
      'GIT_GRAFT_FILE=/dev/null', '/usr/bin/git', '-C', root,
      ...args], 12_000);
    if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string'
      || result.stdout.length > 4096) throw Error('REVIEWER_SOURCE_GIT_UNVERIFIED');
    return safe(result.stdout);
  };
  try {
    if (git(['rev-parse', 'HEAD']) !== reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD
      || git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== reviewEnv.STEPHANOS_REVIEW_EXACT_BRANCH
      || git(['status', '--porcelain', '--untracked-files=normal']) !== '') {
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
  const executable = mode === 'review' ? plan.reviewer
    : path.win32.join(plan.sourceRoot, 'scripts', 'sovereign-reviewer-ollama-calibration-v1.mjs');
  if (!exists(executable)) return error('CALIBRATION_SOURCE_UNAVAILABLE');
  // wslpath is a fixed executable, and paths are passed as argv, never a shell.
  // No caller-controlled distro, shell, executable or arbitrary command.
  const minimalEnv = {
    SystemRoot: text(env.SystemRoot || env.SYSTEMROOT) || 'C:\\Windows',
    WINDIR: text(env.WINDIR) || 'C:\\Windows',
    PATH: 'C:\\Windows\\System32;C:\\Windows',
    WSLENV: '',
  };
  const run = (args, timeoutMs = mode === 'calibration' ? 570_000 : 150_000) =>
    spawn(path.win32.resolve('C:/Windows/System32/wsl.exe'), ['--exec', ...args], {
    encoding: 'utf8', windowsHide: true, shell: false,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024,
    env: minimalEnv,
  });
  const linuxPaths = [];
  for (const windowsPath of [executable, plan.workspace]) {
    // A path-only conversion must never hold the long model-exam budget.
    const conversion = run(['/usr/bin/wslpath', '-u', windowsPath], 12_000);
    const output = text(conversion?.stdout);
    if (conversion?.error || conversion?.status !== 0 || !/^\/[^\r\n\0]+$/.test(output)) {
      return error('WSL_PATH_TRANSLATION_UNAVAILABLE');
    }
    linuxPaths.push(output);
  }
  if (mode === 'review') {
    // A tainted reviewer could fabricate its own clean status and receipt.
    // Independently read actual Git HEAD bytes using trusted WSL executables
    // before Node is allowed to load the reviewer or its policy imports.
    const attested = verifySource({
      run, reviewerPath: linuxPaths[0], reviewEnv: plan.reviewEnv,
    });
    if (attested?.ok !== true) return error(
      attested?.reason === 'REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE'
        ? 'REVIEWER_SOURCE_INDEX_FLAGS_UNSAFE'
        : attested?.reason === 'REVIEWER_SOURCE_BYTES_NOT_HEAD'
          ? 'REVIEWER_SOURCE_BYTES_NOT_HEAD'
          : 'REVIEWER_SOURCE_GIT_UNVERIFIED');
  }
  const args = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp',
    ...Object.entries(plan.reviewEnv).map(([key, value]) => key + '=' + value),
    'STEPHANOS_SHARED_AGENT_WORKSPACE=' + linuxPaths[1],
    '/usr/bin/node', '--experimental-loader', sovereignExactCommitLoaderV1({
      root: path.posix.resolve(linuxPaths[0], '../..'),
      head: plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD,
      files: REVIEWER_CRITICAL_SOURCE_PATHS,
      git: resolveBattleBridgeGitExecution({ platform: 'linux', environment: {} }),
    }), linuxPaths[0], ...(mode === 'preflight' ? ['--preflight']
      : mode === 'calibration' ? ['--once'] : [])];
  const executed = run(args);
  if (executed?.error) return error('WSL_REVIEWER_EXECUTION_HELD');
  const prefix = mode === 'calibration' ? 'SOVEREIGN_REVIEW_CALIBRATION_RESULT='
    : mode === 'preflight' ? 'SOVEREIGN_REVIEW_PREFLIGHT_RESULT='
    : 'SOVEREIGN_REVIEWER_RESULT=';
  // Only a fixed, unique receipt marker can be promoted. Other stdout never
  // enters the public status and a second marker is an ambiguous HOLD.
  const markers = String(executed?.stdout || '').split('\n')
    .filter(line => line.startsWith(prefix));
  if (mode === 'preflight' && executed?.status === 2) {
    if (markers.length !== 1) return error('WSL_REVIEWER_EXECUTION_HELD');
    let heldReceipt;
    try { heldReceipt = JSON.parse(markers[0].slice(prefix.length)); }
    catch { return error('WSL_REVIEWER_EXECUTION_HELD'); }
    if (heldReceipt?.status !== 'LOCAL_OLLAMA_PREFLIGHT_HELD'
      || !PREFLIGHT_SAFE_HOLD_REASONS.has(heldReceipt.reason)
      || heldReceipt.independentHostAttestation !== false
      || heldReceipt.signatureVerified !== false
      || heldReceipt.specialistAuthority !== false
      || heldReceipt.independentReviewSatisfied !== false
      || heldReceipt.protectedMergeAuthority !== false
      || heldReceipt.sourceMutationAuthority !== false
      || heldReceipt.leaseReleaseAuthority !== false
      || heldReceipt.windowsCommissioningAuthority !== false
      || heldReceipt.physicalPickupProven !== false) {
      return error('LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
    }
    return error(heldReceipt.reason);
  }
  if (executed?.status !== 0) return error('WSL_REVIEWER_EXECUTION_HELD');
  if (markers.length !== 1) return error('REVIEWER_RECEIPT_MISSING');
  let receipt;
  try { receipt = JSON.parse(markers[0].slice(prefix.length)); }
  catch { return error('REVIEWER_RECEIPT_INVALID'); }
  if (mode === 'preflight') {
    if (receipt.status !== 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED'
      || receipt.selectedModelPresent !== true
      || receipt.sourceVerified !== true || receipt.gamingClear !== true
      || !/^[a-f0-9]{64}$/.test(receipt.modelDigestSha256 ?? '')
      || receipt.independentHostAttestation !== false
      || receipt.signatureVerified !== false
      || receipt.specialistAuthority !== false
      || receipt.protectedMergeAuthority !== false
      || receipt.leaseReleaseAuthority !== false) {
      return error('LOCAL_OLLAMA_PREFLIGHT_UNQUALIFIED');
    }
    return Object.freeze({ ok: true, status: 'LOCAL_OLLAMA_MODEL_OBSERVED_UNATTESTED',
      qualification: 'PENDING_INDEPENDENT_ATTESTATION',
      approvalAuthority: false, mergeAuthority: false });
  }
  if (mode === 'calibration') {
    const expectedRef = 'proofs/sovereign-calibration-pr-'
      + plan.reviewEnv.STEPHANOS_REVIEW_PR + '-'
      + plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase().slice(0, 12)
      + '-' + String(receipt.observationsSha256 || '').slice(0, 12) + '.json';
    if (receipt.status !== 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
      || receipt.repository !== plan.reviewEnv.STEPHANOS_REVIEW_REPOSITORY
      || receipt.sourceHead !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase()
      || receipt.baseSha !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_BASE.toLowerCase()
      || receipt.completedCases !== 10 || receipt.passedCases !== 10
      || !/^[a-f0-9]{64}$/.test(receipt.manifestSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.observationsSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.modelDigestSha256 ?? '')
      || receipt.proofRef !== expectedRef
      || !/^[a-f0-9]{64}$/.test(receipt.proofSha256 ?? '')
      || receipt.qualification !== 'PENDING_INDEPENDENT_ATTESTATION'
      || receipt.independentHostAttestation !== false
      || receipt.signatureVerified !== false || receipt.specialistAuthority !== false
      || receipt.independentReviewSatisfied !== false
      || receipt.leaseReleaseAuthority !== false || receipt.protectedMergeAuthority !== false) {
      return error('CALIBRATION_EVIDENCE_UNQUALIFIED');
    }
    // Candidate status and a claimed digest alone do not prove a stored
    // artifact exists. Read the fixed Windows Shared Workspace proof back
    // through the same shell-free WSL boundary, with no caller path inputs.
    const proofFile = path.posix.join(linuxPaths[1], expectedRef);
    if (path.posix.normalize(linuxPaths[1]) !== linuxPaths[1]
      || !proofFile.startsWith(linuxPaths[1].replace(/\/+$/, '') + '/')) {
      return error('CALIBRATION_PROOF_PATH_UNSAFE');
    }
    // A malformed / replaced proof cannot tie up GPU-capable WSL for 570s.
    const observed = run(['/usr/bin/sha256sum', '--', proofFile], 12_000);
    if (observed?.error || observed?.status !== 0) {
      return error('CALIBRATION_PROOF_FILE_UNREADABLE');
    }
    const expectedLine = receipt.proofSha256 + '  ' + proofFile;
    if (text(observed?.stdout) !== expectedLine) {
      return error('CALIBRATION_PROOF_FILE_HASH_MISMATCH');
    }
    return Object.freeze({
      ok: true, status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
      sourceHead: receipt.sourceHead, completedCases: 10, passedCases: 10,
      observationsSha256: receipt.observationsSha256,
      modelDigestSha256: receipt.modelDigestSha256,
      proofRef: receipt.proofRef, proofSha256: receipt.proofSha256,
      qualification: 'PENDING_INDEPENDENT_ATTESTATION',
      approvalAuthority: false, mergeAuthority: false,
    });
  }
  const expectedProof = 'proofs/sovereign-review-pr-'
    + plan.reviewEnv.STEPHANOS_REVIEW_PR + '-'
    + plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase().slice(0, 12) + '.json';
  if (receipt.status !== 'LOCAL_REVIEW_EVIDENCE_READY'
    || receipt.repository !== plan.reviewEnv.STEPHANOS_REVIEW_REPOSITORY
    || receipt.evidenceSchema !== 'stephanos.sovereign-review-candidate-evidence.v1'
    || receipt.baseSha !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_BASE.toLowerCase()
    || receipt.qualification !== 'PENDING_INDEPENDENT_ATTESTATION'
    || receipt.riskTier !== 'standard'
    || !Number.isSafeInteger(receipt.findingsCount)
    || receipt.findingsCount < 0 || receipt.findingsCount > 64
    || ((receipt.verdict === 'clean') !== (receipt.findingsCount === 0))
    || !SHA.test(receipt.sourceHead)
    || receipt.sourceHead.toLowerCase() !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase()
    || receipt.prNumber !== Number(plan.reviewEnv.STEPHANOS_REVIEW_PR)
    || receipt.proofRef !== expectedProof
    || !/^[a-f0-9]{64}$/.test(receipt.proofSha256 ?? '')
    || !['clean', 'findings'].includes(receipt.verdict)
    || receipt.mergeAuthority !== false) return error('REVIEWER_RECEIPT_UNBOUND');
  // A positive stdout marker alone proves no persisted evidence exists.
  // Read the exact fixed artifact back through WSL before reporting READY.
  // Do not expose the document, private diff, absolute machine path or model text.
  const reviewWorkspace = path.posix.normalize(linuxPaths[1]);
  const reviewProofFile = path.posix.join(linuxPaths[1], expectedProof);
  if (reviewWorkspace !== linuxPaths[1]
    || !reviewProofFile.startsWith(reviewWorkspace.replace(/\/+$/, '') + '/')) {
    return error('REVIEWER_PROOF_PATH_UNSAFE');
  }
  const readback = run(['/usr/bin/sha256sum', '--', reviewProofFile], 12_000);
  if (readback?.error || readback?.status !== 0) {
    return error('REVIEWER_PROOF_FILE_UNREADABLE');
  }
  const hashMatch = String(readback.stdout || '').match(/^([a-f0-9]{64})  (.+)\r?\n?$/);
  if (!hashMatch || hashMatch[2] !== reviewProofFile) {
    return error('REVIEWER_PROOF_READBACK_INVALID');
  }
  if (hashMatch[1] !== receipt.proofSha256) {
    // The workspace file may have been replaced after the child published it.
    // A successfully hashed but unrelated same-path file is NOT evidence.
    return error('REVIEWER_PROOF_HASH_MISMATCH');
  }
  return Object.freeze({
    ok: true, status: 'LOCAL_REVIEW_EVIDENCE_READY',
    qualification: 'PENDING_INDEPENDENT_ATTESTATION',
    prNumber: receipt.prNumber, sourceHead: receipt.sourceHead,
    baseSha: receipt.baseSha, repository: receipt.repository,
    evidenceSchema: receipt.evidenceSchema, findingsCount: receipt.findingsCount,
    proofRef: receipt.proofRef, proofSha256: hashMatch[1], verdict: receipt.verdict,
    approvalAuthority: false, mergeAuthority: false,
  });
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
