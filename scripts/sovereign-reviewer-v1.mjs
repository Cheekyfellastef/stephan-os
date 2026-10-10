#!/usr/bin/env node
// Run on Battle Bridge with a checked-out, exact, clean commit. No GitHub,
// Codex, browser, remote API, merge, deployment or arbitrary command channel.
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSovereignReviewSnapshot } from '../shared/agents/sovereignReviewerV1.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const SHA = /^[0-9a-f]{40}$/i;
const text = value => String(value ?? '').trim();
const maximumOutput = 128 * 1024;

function git(args, maxBuffer = 256 * 1024) {
  const result = spawnSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 12_000,
    maxBuffer, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result?.error || result?.status !== 0) throw new Error('LOCAL_GIT_PROOF_UNAVAILABLE');
  return text(result.stdout);
}
function exactLocalSnapshot(env) {
  const sourceHead = text(env.STEPHANOS_REVIEW_EXACT_HEAD).toLowerCase();
  const baseSha = text(env.STEPHANOS_REVIEW_EXACT_BASE).toLowerCase();
  const branch = text(env.STEPHANOS_REVIEW_EXACT_BRANCH);
  if (!SHA.test(sourceHead) || !SHA.test(baseSha)) throw new Error('EXACT_SOURCE_IDS_REQUIRED');
  if (git(['rev-parse', 'HEAD']).toLowerCase() !== sourceHead) throw new Error('REVIEWED_HEAD_NOT_CHECKED_OUT');
  if (git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) throw new Error('REVIEW_BRANCH_NOT_CHECKED_OUT');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('REVIEW_WORKTREE_NOT_CLEAN');
  if (git(['rev-parse', '--verify', `${baseSha}^{commit}`]).toLowerCase() !== baseSha) throw new Error('REVIEW_BASE_UNPROVEN');
  git(['merge-base', '--is-ancestor', baseSha, sourceHead]);
  const changedFiles = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', baseSha, sourceHead, '--']).split('\n').filter(Boolean);
  const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', baseSha, sourceHead, '--'], 128 * 1024);
  return {
    repository: text(env.STEPHANOS_REVIEW_REPOSITORY),
    issueNumber: Number(env.STEPHANOS_REVIEW_ISSUE),
    prNumber: Number(env.STEPHANOS_REVIEW_PR),
    branch, sourceHead, baseSha, changedFiles, diff,
    implementerProvider: text(env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER),
    implementerSessionId: text(env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION),
    reviewerSessionId: text(env.STEPHANOS_REVIEW_SESSION),
    modelClass: text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS || 'qwen-14b'),
    timestampUtc: new Date().toISOString(),
  };
}
async function localModel(prompt, env) {
  const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model)) throw new Error('UNSAFE_LOCAL_MODEL');
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false, format: 'json',
      options: { temperature: 0, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error('LOCAL_MODEL_REQUEST_FAILED');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > maximumOutput) throw new Error('LOCAL_MODEL_OUTPUT_UNBOUNDED');
  const parsed = JSON.parse(raw);
  if (typeof parsed?.response !== 'string') throw new Error('LOCAL_MODEL_OUTPUT_INVALID');
  return parsed.response;
}
function persistReview(result, env) {
  const workspace = text(env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  if (!workspace) throw new Error('SHARED_WORKSPACE_REQUIRED');
  const root = resolve(workspace);
  if (!fs.statSync(root).isDirectory() || !fs.statSync(join(root, 'status')).isDirectory()) {
    throw new Error('SHARED_WORKSPACE_UNAVAILABLE');
  }
  if (result.status !== 'LOCAL_REVIEW_EVIDENCE_READY') return false;
  const proofRoot = join(root, 'proofs');
  fs.mkdirSync(proofRoot, { recursive: true });
  const file = join(proofRoot, result.proofRef.split('/')[1]);
  // Immutable proof: a second run on the same PR/head must not silently replace
  // a review by a different model/session or turn findings into 'clean'.
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n', {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  const statusPath = join(root, 'status', `sovereign-review-pr-${result.reviewReceipt.prNumber}.json`);
  const record = {
    schemaVersion: 'stephanos.sovereign-review-status.v1',
    participantId: 'sovereign-reviewer',
    participantStatusId: 'sovereign-reviewer',
    observedAtUtc: result.reviewReceipt.timestampUtc,
    status: 'LOCAL_EVIDENCE_PENDING_INDEPENDENT_ATTESTATION',
    sourceHead: result.reviewReceipt.sourceHead,
    prNumber: result.reviewReceipt.prNumber,
    proofRef: result.proofRef,
    verdict: result.reviewReceipt.verdict,
    mergeAuthority: false,
    runtimeDeploymentProven: false,
  };
  const temp = statusPath + `.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  fs.renameSync(temp, statusPath);
  return true;
}

export async function main(env = process.env, dependencies = {}) {
  const capture = dependencies.snapshot || exactLocalSnapshot;
  const invoke = dependencies.invokeModel || ((prompt) => localModel(prompt, env));
  const publish = dependencies.persist || persistReview;
  let result;
  try {
    result = await evaluateSovereignReviewSnapshot(capture(env), { invokeModel: invoke });
  } catch (error) {
    result = {
      status: 'SOVEREIGN_REVIEW_HELD',
      reason: text(error?.message || 'LOCAL_SNAPSHOT_UNAVAILABLE').slice(0, 120),
      mergeAuthority: false,
    };
  }
  if (result.status === 'LOCAL_REVIEW_EVIDENCE_READY') {
    try { publish(result, env); }
    catch { result = { status: 'SOVEREIGN_REVIEW_HELD', reason: 'SHARED_WORKSPACE_PUBLICATION_FAILED', mergeAuthority: false }; }
  }
  const summary = {
    status: result.status,
    reason: result.reason || '',
    prNumber: result.reviewReceipt?.prNumber ?? null,
    sourceHead: result.reviewReceipt?.sourceHead || '',
    proofRef: result.proofRef || '',
    verdict: result.reviewReceipt?.verdict || '',
    mergeAuthority: false,
  };
  process.stdout.write(`SOVEREIGN_REVIEWER_RESULT=${JSON.stringify(summary)}\n`);
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(result => {
    if (result.status !== 'LOCAL_REVIEW_EVIDENCE_READY') process.exitCode = 2;
  }).catch(() => { process.stderr.write('SOVEREIGN_REVIEWER_HELD=UNEXPECTED_ERROR\n'); process.exitCode = 2; });
}
