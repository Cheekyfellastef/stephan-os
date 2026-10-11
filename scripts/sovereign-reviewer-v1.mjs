#!/usr/bin/env node
// Run on Battle Bridge with a checked-out, exact, clean commit. No GitHub,
// Codex, browser, remote API, merge, deployment or arbitrary command channel.
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSovereignReviewSnapshot } from '../shared/agents/sovereignReviewerV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const SHA = /^[0-9a-f]{40}$/i;
const text = value => String(value ?? '').trim();
const maximumOutput = 128 * 1024;

function git(args, maxBuffer = 256 * 1024, dependencies = {}) {
  const execution = (dependencies.resolveGit || resolveBattleBridgeGitExecution)({
    platform: dependencies.platform || process.platform,
    environment: dependencies.environment || process.env,
  });
  const result = (dependencies.spawn || spawnSync)(execution.executable, [
    ...execution.fixedConfigArgs, `--git-dir=${join(ROOT, '.git')}`, `--work-tree=${ROOT}`, ...args,
  ], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 12_000,
    maxBuffer, env: execution.environment,
  });
  if (result?.error || result?.status !== 0) throw new Error('LOCAL_GIT_PROOF_UNAVAILABLE');
  return text(result.stdout);
}
function exactLocalSnapshot(env, dependencies = {}) {
  const sourceHead = text(env.STEPHANOS_REVIEW_EXACT_HEAD).toLowerCase();
  const baseSha = text(env.STEPHANOS_REVIEW_EXACT_BASE).toLowerCase();
  const branch = text(env.STEPHANOS_REVIEW_EXACT_BRANCH);
  if (!SHA.test(sourceHead) || !SHA.test(baseSha)) throw new Error('EXACT_SOURCE_IDS_REQUIRED');
  const runGit = (args, maxBuffer) => git(args, maxBuffer, dependencies);
  if (runGit(['rev-parse', 'HEAD']).toLowerCase() !== sourceHead) throw new Error('REVIEWED_HEAD_NOT_CHECKED_OUT');
  if (runGit(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) throw new Error('REVIEW_BRANCH_NOT_CHECKED_OUT');
  if (runGit(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('REVIEW_WORKTREE_NOT_CLEAN');
  if (runGit(['rev-parse', '--verify', `${baseSha}^{commit}`]).toLowerCase() !== baseSha) throw new Error('REVIEW_BASE_UNPROVEN');
  runGit(['merge-base', '--is-ancestor', baseSha, sourceHead]);
  const changedFiles = runGit(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', baseSha, sourceHead, '--']).split('\n').filter(Boolean);
  const diff = runGit(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', baseSha, sourceHead, '--'], 128 * 1024);
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
function pinDirectory(path) {
  const absolute = resolve(path);
  const parsed = absolute.split(/[\\/]+/).filter(Boolean);
  let cursor = absolute.startsWith('/') ? '/' : parsed.shift();
  for (const part of parsed) {
    cursor = join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error('SHARED_WORKSPACE_LINKED_PATH');
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory()) throw new Error('SHARED_WORKSPACE_UNAVAILABLE');
  return Object.freeze({ path: absolute, dev: stat.dev, ino: stat.ino });
}
function openStableDirectory(path, platform = process.platform) {
  if (platform !== 'linux' || !Number.isInteger(fs.constants.O_DIRECTORY)
    || !Number.isInteger(fs.constants.O_NOFOLLOW)) {
    throw new Error('STABLE_WORKSPACE_WRITER_UNAVAILABLE');
  }
  const pin = pinDirectory(path);
  const fd = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const opened = fs.fstatSync(fd);
  if (opened.dev !== pin.dev || opened.ino !== pin.ino) {
    fs.closeSync(fd);
    throw new Error('SHARED_WORKSPACE_DIRECTORY_REPLACED');
  }
  return { fd, path: `/proc/self/fd/${fd}`, canonicalPath: pin.path, dev: opened.dev, ino: opened.ino };
}
function openStableChildDirectory(parent, name, canonicalPath = '') {
  const childPath = join(parent.path, name);
  const fd = fs.openSync(childPath, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const opened = fs.fstatSync(fd);
  return { fd, path: `/proc/self/fd/${fd}`, canonicalPath, dev: opened.dev, ino: opened.ino };
}
function assertStableDirectory(directory) {
  const current = fs.lstatSync(directory.canonicalPath);
  if (current.isSymbolicLink() || !current.isDirectory()
    || current.dev !== directory.dev || current.ino !== directory.ino) {
    throw new Error('SHARED_WORKSPACE_DIRECTORY_REPLACED');
  }
}
function syncDirectory(directory) { fs.fsyncSync(directory.fd); }
function publishNoReplace(name, body, directory, dependencies = {}) {
  const tempName = `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  const temp = join(directory.path, tempName);
  const file = join(directory.path, name);
  let fd;
  try {
    dependencies.beforeStableOperation?.('proof-temp-open');
    assertStableDirectory(directory);
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.linkSync(temp, file);
    syncDirectory(directory);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}
export function persistReview(result, env, dependencies = {}) {
  const workspace = text(env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  if (!workspace) throw new Error('SHARED_WORKSPACE_REQUIRED');
  const root = resolve(workspace);
  const rootDirectory = openStableDirectory(root, dependencies.platform);
  let statusDirectory;
  let proofDirectory;
  try {
    statusDirectory = openStableChildDirectory(rootDirectory, 'status', join(root, 'status'));
  const evidence = result.candidateEvidence;
  const prNumber = evidence?.prNumber || Number(env.STEPHANOS_REVIEW_PR);
  const safePr = Number.isSafeInteger(prNumber) && prNumber > 0 && prNumber <= 999999999 ? prNumber : null;
  if (result.status === 'LOCAL_REVIEW_EVIDENCE_READY') {
    const proofRoot = join(rootDirectory.path, 'proofs');
    try { fs.mkdirSync(proofRoot, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    proofDirectory = openStableChildDirectory(rootDirectory, 'proofs', join(root, 'proofs'));
    // Immutable same-PR/head evidence. A later model run cannot rewrite
    // findings into a clean verdict, nor silently replace reviewer identity.
    publishNoReplace(result.proofRef.split('/')[1], JSON.stringify(result, null, 2) + '\n', proofDirectory, dependencies);
  }
  const statusName = safePr ? `sovereign-review-pr-${safePr}.json` : 'sovereign-reviewer.json';
  const statusPath = join(statusDirectory.path, statusName);
  const record = {
    schemaVersion: 'stephanos.sovereign-review-status.v1',
    participantId: 'sovereign-reviewer',
    participantStatusId: 'sovereign-reviewer',
    observedAtUtc: new Date().toISOString(),
    status: result.status === 'LOCAL_REVIEW_EVIDENCE_READY'
      ? 'LOCAL_EVIDENCE_PENDING_INDEPENDENT_ATTESTATION'
      : 'REVIEW_HELD',
    blocker: result.status === 'LOCAL_REVIEW_EVIDENCE_READY' ? '' : text(result.reason).slice(0, 120),
    sourceHead: evidence?.sourceHead || result.reviewObservation?.sourceHead || '',
    requestedSourceHead: result.reviewObservation?.requestedSourceHead || '',
    prNumber: safePr,
    proofRef: result.proofRef || '',
    verdict: evidence?.verdict || '',
    mergeAuthority: false,
    runtimeDeploymentProven: false,
  };
  const lock = join(statusDirectory.path, `${statusName}.lock`);
  dependencies.beforeStableOperation?.('status-lock-create');
  assertStableDirectory(statusDirectory);
  fs.mkdirSync(lock);
  const lockDirectory = openStableChildDirectory(statusDirectory, `${statusName}.lock`);
  let statusTemp = '';
  try {
    let current = null;
    try { current = JSON.parse(fs.readFileSync(statusPath, 'utf8')); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const candidateTime = Date.parse(evidence?.timestampUtc || result.reviewObservation?.capturedAtUtc || '');
    const currentTime = Date.parse(current?.candidateObservedAtUtc || current?.observedAtUtc || '');
    if (Number.isFinite(currentTime) && (!Number.isFinite(candidateTime) || candidateTime <= currentTime)) {
      throw new Error('STALE_REVIEW_STATUS');
    }
    record.candidateObservedAtUtc = new Date(candidateTime).toISOString();
    const temp = join(statusDirectory.path, `${statusName}.${process.pid}.tmp`);
    statusTemp = temp;
    dependencies.beforeStableOperation?.('status-temp-open');
    assertStableDirectory(statusDirectory);
    fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, statusPath);
    syncDirectory(statusDirectory);
  } finally {
    try { if (statusTemp) fs.unlinkSync(statusTemp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    dependencies.beforeStableOperation?.('status-lock-cleanup');
    const lockStat = fs.lstatSync(lock);
    if (lockStat.dev !== lockDirectory.dev || lockStat.ino !== lockDirectory.ino) {
      fs.closeSync(lockDirectory.fd);
      throw new Error('SHARED_WORKSPACE_LOCK_REPLACED');
    }
    fs.closeSync(lockDirectory.fd);
    fs.rmdirSync(lock);
  }
  return true;
  } finally {
    if (proofDirectory) fs.closeSync(proofDirectory.fd);
    if (statusDirectory) fs.closeSync(statusDirectory.fd);
    fs.closeSync(rootDirectory.fd);
  }
}

export async function main(env = process.env, dependencies = {}) {
  const capture = dependencies.snapshot || ((input) => exactLocalSnapshot(input, dependencies));
  const invoke = dependencies.invokeModel || ((prompt) => localModel(prompt, env));
  const publish = dependencies.persist || persistReview;
  const capturedAtUtc = new Date().toISOString();
  const requestedSourceHead = SHA.test(text(env.STEPHANOS_REVIEW_EXACT_HEAD))
    ? text(env.STEPHANOS_REVIEW_EXACT_HEAD).toLowerCase() : '';
  let result;
  let snapshot;
  try {
    snapshot = capture(env);
    result = await evaluateSovereignReviewSnapshot(snapshot, { invokeModel: invoke });
  } catch (error) {
    result = {
      status: 'SOVEREIGN_REVIEW_HELD',
      reason: text(error?.message || 'LOCAL_SNAPSHOT_UNAVAILABLE').slice(0, 120),
      mergeAuthority: false,
    };
  }
  result = { ...result, reviewObservation: {
    capturedAtUtc: snapshot?.timestampUtc || capturedAtUtc,
    sourceHead: SHA.test(text(snapshot?.sourceHead)) ? text(snapshot.sourceHead).toLowerCase() : '',
    requestedSourceHead,
  } };
  try { publish(result, env, dependencies); }
  catch { result = { status: 'SOVEREIGN_REVIEW_HELD', reason: 'SHARED_WORKSPACE_PUBLICATION_FAILED', mergeAuthority: false }; }
  const summary = {
    status: result.status,
    reason: result.reason || '',
    prNumber: result.candidateEvidence?.prNumber ?? null,
    sourceHead: result.candidateEvidence?.sourceHead || '',
    proofRef: result.proofRef || '',
    verdict: result.candidateEvidence?.verdict || '',
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
