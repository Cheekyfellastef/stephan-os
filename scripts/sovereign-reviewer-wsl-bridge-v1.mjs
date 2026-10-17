#!/usr/bin/env node
// Fixed Windows -> WSL launcher for the existing Linux handle-pinned Sovereign
// Reviewer. This is a candidate producer, never an approval or merge channel.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

export function runWindowsSovereignReviewerV1(env = process.env, {
  platform = process.platform, sourceRoot = SOURCE_ROOT, exists = existsSync,
  spawn = spawnSync, mode = 'review',
} = {}) {
  const plan = planWindowsSovereignReviewerV1(env, { platform, sourceRoot, exists });
  if (!plan.ok) return plan;
  if (!['review', 'calibration'].includes(mode)) return error('REVIEW_MODE_UNSUPPORTED');
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
  const run = args => spawn(path.win32.resolve('C:/Windows/System32/wsl.exe'), ['--exec', ...args], {
    encoding: 'utf8', windowsHide: true, shell: false,
    timeout: 150_000, maxBuffer: 16 * 1024,
    env: minimalEnv,
  });
  const linuxPaths = [];
  for (const windowsPath of [executable, plan.workspace]) {
    const conversion = run(['/usr/bin/wslpath', '-u', windowsPath]);
    const output = text(conversion?.stdout);
    if (conversion?.error || conversion?.status !== 0 || !/^\/[^\r\n\0]+$/.test(output)) {
      return error('WSL_PATH_TRANSLATION_UNAVAILABLE');
    }
    linuxPaths.push(output);
  }
  const args = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp',
    ...Object.entries(plan.reviewEnv).map(([key, value]) => key + '=' + value),
    'STEPHANOS_SHARED_AGENT_WORKSPACE=' + linuxPaths[1],
    '/usr/bin/node', linuxPaths[0]];
  const executed = run(args);
  if (executed?.error || executed?.status !== 0) return error('WSL_REVIEWER_EXECUTION_HELD');
  const prefix = mode === 'calibration'
    ? 'SOVEREIGN_REVIEW_CALIBRATION_RESULT=' : 'SOVEREIGN_REVIEWER_RESULT=';
  const marker = String(executed.stdout || '').split('\n')
    .find(line => line.startsWith(prefix));
  if (!marker) return error('REVIEWER_RECEIPT_MISSING');
  let receipt;
  try { receipt = JSON.parse(marker.slice(prefix.length)); }
  catch { return error('REVIEWER_RECEIPT_INVALID'); }
  if (mode === 'calibration') {
    if (receipt.status !== 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED'
      || receipt.repository !== plan.reviewEnv.STEPHANOS_REVIEW_REPOSITORY
      || receipt.sourceHead !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase()
      || receipt.baseSha !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_BASE.toLowerCase()
      || receipt.completedCases !== 10 || receipt.passedCases !== 10
      || !/^[a-f0-9]{64}$/.test(receipt.manifestSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(receipt.observationsSha256 ?? '')
      || receipt.independentHostAttestation !== false
      || receipt.signatureVerified !== false || receipt.specialistAuthority !== false
      || receipt.independentReviewSatisfied !== false
      || receipt.leaseReleaseAuthority !== false || receipt.protectedMergeAuthority !== false) {
      return error('CALIBRATION_EVIDENCE_UNQUALIFIED');
    }
    return Object.freeze({
      ok: true, status: 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED',
      sourceHead: receipt.sourceHead, completedCases: 10, passedCases: 10,
      observationsSha256: receipt.observationsSha256,
      qualification: 'PENDING_INDEPENDENT_ATTESTATION',
      approvalAuthority: false, mergeAuthority: false,
    });
  }
  const expectedProof = 'proofs/sovereign-review-pr-'
    + plan.reviewEnv.STEPHANOS_REVIEW_PR + '-'
    + plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase().slice(0, 12) + '.json';
  if (receipt.status !== 'LOCAL_REVIEW_EVIDENCE_READY'
    || !SHA.test(receipt.sourceHead)
    || receipt.sourceHead.toLowerCase() !== plan.reviewEnv.STEPHANOS_REVIEW_EXACT_HEAD.toLowerCase()
    || receipt.prNumber !== Number(plan.reviewEnv.STEPHANOS_REVIEW_PR)
    || receipt.proofRef !== expectedProof
    || !['clean', 'findings'].includes(receipt.verdict)
    || receipt.mergeAuthority !== false) return error('REVIEWER_RECEIPT_UNBOUND');
  return Object.freeze({
    ok: true, status: 'LOCAL_REVIEW_EVIDENCE_READY',
    qualification: 'PENDING_INDEPENDENT_ATTESTATION',
    prNumber: receipt.prNumber, sourceHead: receipt.sourceHead,
    proofRef: receipt.proofRef, verdict: receipt.verdict,
    approvalAuthority: false, mergeAuthority: false,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--once', '--calibrate'].includes(process.argv[2])) {
    process.stderr.write('SOVEREIGN_REVIEW_WSL_HELD=FIXED_MODE_ONLY\n');
    process.exitCode = 2;
  } else {
    const result = runWindowsSovereignReviewerV1(process.env, {
      mode: process.argv[2] === '--calibrate' ? 'calibration' : 'review',
    });
    process.stdout.write('SOVEREIGN_REVIEW_WSL_RESULT=' + JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 2;
  }
}
