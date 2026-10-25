#!/usr/bin/env node
// Run on Battle Bridge with a checked-out, exact, clean commit. No GitHub,
// Codex, browser, remote API, merge, deployment or arbitrary command channel.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSovereignReviewSnapshot } from '../shared/agents/sovereignReviewerV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { inspectLocalSovereignGamingPermissionV1, observeLocalSovereignOllamaDigestV1 } from './sovereign-reviewer-ollama-calibration-v1.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const SHA = /^[0-9a-f]{40}$/i;
const text = value => String(value ?? '').trim();
const maximumOutput = 128 * 1024;

function git(args, maxBuffer = 256 * 1024, dependencies = {}, raw = false) {
  const execution = (dependencies.resolveGit || resolveBattleBridgeGitExecution)({
    platform: dependencies.platform || process.platform,
    environment: dependencies.environment || process.env,
  });
  const result = (dependencies.spawn || spawnSync)(execution.executable, [
    ...execution.fixedConfigArgs, `--git-dir=${join(ROOT, '.git')}`, `--work-tree=${ROOT}`, ...args,
  ], {
    encoding: raw ? null : 'utf8', shell: false, windowsHide: true, timeout: 12_000,
    maxBuffer, env: execution.environment,
  });
  if (result?.error || result?.status !== 0) throw new Error('LOCAL_GIT_PROOF_UNAVAILABLE');
  if (raw && !Buffer.isBuffer(result.stdout)) throw new Error('LOCAL_GIT_RAW_OBJECT_REQUIRED');
  return raw ? result.stdout : text(result.stdout);
}

// Derive review input solely from hash-authenticated bytes. Git diff/status
// do not authenticate loose objects and must never supply the model's diff.
export function authenticatedReviewDiff(baseSha, sourceHead, readObject) {
  const cache = new Map();
  let capturedBytes = 0;
  function object(type, sha) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('REVIEW_OBJECT_ID_INVALID');
    const key = type + ':' + sha;
    if (cache.has(key)) return cache.get(key);
    const bytes = readObject(type, sha);
    if (!Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024)
      throw Error('REVIEW_OBJECT_UNBOUNDED');
    const owned = Buffer.from(bytes);
    if (createHash('sha1').update(type + ' ' + owned.length + '\0').update(owned).digest('hex') !== sha)
      throw Error('REVIEW_OBJECT_HASH_MISMATCH');
    capturedBytes += owned.length;
    if (capturedBytes > 16 * 1024 * 1024) throw Error('REVIEW_OBJECT_CLOSURE_UNBOUNDED');
    cache.set(key, owned);
    return owned;
  }
  function filesAt(commitSha) {
    const commit = object('commit', commitSha).toString('utf8');
    const tree = /^tree ([a-f0-9]{40})\n/.exec(commit)?.[1];
    if (!tree) throw Error('REVIEW_COMMIT_TREE_INVALID');
    const files = new Map();
    let entries = 0;
    function walk(sha, prefix, depth) {
      if (depth > 32) throw Error('REVIEW_TREE_DEPTH_UNBOUNDED');
      const bytes = object('tree', sha);
      const names = new Set();
      for (let i = 0; i < bytes.length;) {
        const space = bytes.indexOf(32, i), nul = bytes.indexOf(0, space + 1);
        if (space < i || nul < space || nul + 21 > bytes.length)
          throw Error('REVIEW_TREE_INVALID');
        const mode = bytes.toString('ascii', i, space);
        const name = bytes.toString('utf8', space + 1, nul);
        if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..' || names.has(name))
          throw Error('REVIEW_TREE_PATH_UNSUPPORTED');
        names.add(name);
        const id = bytes.subarray(nul + 1, nul + 21).toString('hex');
        const path = prefix + name;
        if (++entries > 40000 || path.length > 240) throw Error('REVIEW_TREE_UNBOUNDED');
        if (mode === '40000') walk(id, path + '/', depth + 1);
        else if (['100644', '100755', '120000', '160000'].includes(mode)) files.set(path, { mode, sha: id });
        else throw Error('REVIEW_TREE_MODE_UNSUPPORTED');
        i = nul + 21;
      }
    }
    walk(tree, '', 0);
    return files;
  }
  const before = filesAt(baseSha), after = filesAt(sourceHead);
  const changedFiles = [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter(path => before.get(path)?.sha !== after.get(path)?.sha || before.get(path)?.mode !== after.get(path)?.mode);
  if (changedFiles.length > 100) throw Error('REVIEW_CHANGED_FILES_UNBOUNDED');
  function lines(entry) {
    if (!entry) return [];
    if (entry.mode === '160000') throw Error('REVIEW_SUBMODULE_DIFF_UNSUPPORTED');
    const bytes = object('blob', entry.sha), value = bytes.toString('utf8');
    if (bytes.includes(0) || !Buffer.from(value, 'utf8').equals(bytes)) throw Error('REVIEW_BINARY_DIFF_UNSUPPORTED');
    return value.match(/[^\n]*\n|[^\n]+$/g) || [];
  }
  const patches = [];
  for (const path of changedFiles) {
    const old = before.get(path), current = after.get(path);
    const a = lines(old), b = lines(current);
    let patch = `diff --git a/${path} b/${path}\n`;
    if (!old) patch += `new file mode ${current.mode}\n`;
    else if (!current) patch += `deleted file mode ${old.mode}\n`;
    else if (old.mode !== current.mode) patch += `old mode ${old.mode}\nnew mode ${current.mode}\n`;
    if (old?.sha !== current?.sha) {
      patch += `index ${old?.sha || '0'.repeat(40)}..${current?.sha || '0'.repeat(40)}\n`;
      patch += `--- ${old ? 'a/' + path : '/dev/null'}\n+++ ${current ? 'b/' + path : '/dev/null'}\n`;
      let prefix = 0, suffix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
      while (suffix < a.length - prefix && suffix < b.length - prefix
        && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
      const start = Math.max(0, prefix - 3);
      const endA = a.length - Math.max(0, suffix - 3), endB = b.length - Math.max(0, suffix - 3);
      patch += `@@ -${endA === start ? start : start + 1},${endA - start} +${endB === start ? start : start + 1},${endB - start} @@\n`;
      const append = (marker, value) => { patch += marker + value + (value.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'); };
      for (let i = start; i < prefix; i++) append(' ', a[i]);
      for (let i = prefix; i < a.length - suffix; i++) append('-', a[i]);
      for (let i = prefix; i < b.length - suffix; i++) append('+', b[i]);
      for (let i = a.length - suffix; i < endA; i++) append(' ', a[i]);
    }
    patches.push(patch);
    if (Buffer.byteLength(patches.join(''), 'utf8') > 128 * 1024) throw Error('REVIEW_DIFF_UNBOUNDED');
  }
  return { changedFiles, diff: patches.join('') };
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
  const { changedFiles, diff } = authenticatedReviewDiff(baseSha, sourceHead,
    (type, sha) => git(['cat-file', type, sha], 2 * 1024 * 1024, dependencies, true));
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
export async function localModel(prompt, env, {
  fetchImpl = fetch,
  gamingGuard = inspectLocalSovereignGamingPermissionV1,
  modelPin = observeLocalSovereignOllamaDigestV1,
  startPolling = setInterval, stopPolling = clearInterval,
  platform = process.platform,
} = {}) {
  const model = text(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b');
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model)) throw new Error('UNSAFE_LOCAL_MODEL');
  const allowed = () => gamingGuard(env, { platform })?.ok === true;
  // One real evidence-generating inference must obey the same resource, model,
  // redirect and unload checks as local calibration. Claimed session labels
  // alone never confer independent review or Windows authority.
  if (!allowed()) throw new Error('LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED');
  const pinned = await modelPin(model, { fetchImpl });
  if (!pinned?.ok || !/^[a-f0-9]{64}$/.test(pinned.digest ?? '')) {
    throw new Error('LOCAL_REVIEW_MODEL_DIGEST_UNPROVEN');
  }
  if (!allowed()) throw new Error('LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED');
  const duringPin = await modelPin(model, { fetchImpl });
  if (!duringPin?.ok || duringPin.digest !== pinned.digest) {
    throw new Error('LOCAL_REVIEW_MODEL_DIGEST_CHANGED');
  }
  // Never send sensitive review input to a mutable Ollama model tag.
  // Ollama versions with immutable manifest digest references can resolve the
  // digest directly. Older versions must fail CLOSED, not retry with 'model'.
  // The digest comes from a bounded exact local /api/tags observation.
  const immutableModel = 'sha256:' + pinned.digest;
  const abort = new AbortController();
  let preempted = false;
  const monitor = startPolling(() => {
    try {
      if (!allowed()) {
        preempted = true;
        abort.abort(new Error('LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED'));
      }
    } catch {
      preempted = true;
      abort.abort(new Error('LOCAL_REVIEW_GAMING_RESOURCE_UNPROVEN'));
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
      signal: AbortSignal.any([AbortSignal.timeout(120_000), abort.signal]),
    });
    if (!response?.ok || typeof response.text !== 'function') {
      throw new Error('LOCAL_MODEL_REQUEST_FAILED');
    }
    const raw = await response.text();
    if (preempted || abort.signal.aborted || !allowed()) {
      throw new Error('LOCAL_REVIEW_GAMING_RESOURCE_PROTECTED');
    }
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maximumOutput) {
      throw new Error('LOCAL_MODEL_OUTPUT_UNBOUNDED');
    }
    const parsed = JSON.parse(raw);
    // A reply echoing only the caller-selected mutable tag is not proof of
    // which manifest actually generated this private code-review verdict.
    // Require an exact digest-addressed completion on supported Ollama.
    const returned = String(parsed?.model ?? '').toLowerCase();
    if (![immutableModel, 'sha256-' + pinned.digest].includes(returned)
      || parsed?.done !== true
      || parsed?.done_reason !== 'stop' || typeof parsed?.response !== 'string'
      || Buffer.byteLength(parsed.response, 'utf8') > 12_288) {
      throw new Error('LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN');
    }
    const afterPin = await modelPin(model, { fetchImpl });
    if (!afterPin?.ok || afterPin.digest !== pinned.digest || !allowed()) {
      throw new Error('LOCAL_REVIEW_MODEL_OR_GAMING_CHANGED_DURING_INFERENCE');
    }
    return parsed.response;
  } finally {
    stopPolling(monitor);
  }
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
  // Pin the exact bytes published through the stable no-replace proof writer.
  // A later WSL readback must match THIS digest, never a digest of arbitrary
  // same-name content supplied after child exit. Candidate only, not audit.
  const proofSha256 = result.status === 'LOCAL_REVIEW_EVIDENCE_READY'
    ? createHash('sha256').update(JSON.stringify(result, null, 2) + '\n').digest('hex') : '';
  const summary = {
    status: result.status,
    reason: result.reason || '',
    repository: result.candidateEvidence?.repository || '',
    evidenceSchema: result.candidateEvidence?.schemaVersion || '',
    baseSha: result.candidateEvidence?.baseSha || '',
    prNumber: result.candidateEvidence?.prNumber ?? null,
    sourceHead: result.candidateEvidence?.sourceHead || '',
    findingsCount: Array.isArray(result.candidateEvidence?.findings)
      ? result.candidateEvidence.findings.length : null,
    riskTier: result.candidateEvidence?.claimedRiskTier || '',
    qualification: result.candidateEvidence?.qualification || '',
    proofRef: result.proofRef || '',
    proofSha256,
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
