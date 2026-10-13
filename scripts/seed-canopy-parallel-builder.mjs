#!/usr/bin/env node
// Bounded parallel source authoring via an operator-controlled LOCAL Ollama instance.
// Deliberately does not call the canonical scheduler, Goal Worker or Core Daemon.
import { readFile, mkdir, writeFile, rename, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../shared/project/seedGardenProjectionV1.mjs';
import {
  listParallelSeedCandidatesV1,
  draftParallelSeedGoalV1,
  makeParallelSeedReceiptV1,
  parallelSeedBranchNameV1,
  parseParallelSeedModelResponseV1,
  validateParallelSeedBuildRequestV1,
} from '../shared/runtime/seedCanopyParallelForgeV1.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const scope = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
const stateRoot = join(homedir(), '.stephanos', 'seed-parallel', scope);
const output = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

async function processExec(bin, args, cwd = repoRoot, timeoutMs = 120000) {
  return await new Promise((res, rej) => {
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true, env: process.env });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk).slice(0, 32768); stdout = stdout.slice(-65536); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 32768); stderr = stderr.slice(-65536); });
    child.on('error', (error) => { clearTimeout(timer); rej(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) res(stdout.trim());
      else rej(new Error(bin + ' failed (' + code + '): ' + stderr.slice(-1500)));
    });
  });
}

async function saveReceipt(request, stage, more = {}) {
  const receipt = makeParallelSeedReceiptV1(request, stage, {
    recordedAtUtc: new Date().toISOString(), ...more,
  });
  const dir = join(stateRoot, 'receipts');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, request.taskId + '.json');
  const pending = dest + '.writing';
  await writeFile(pending, JSON.stringify(receipt, null, 2) + '\n', { flag: 'w' });
  await rename(pending, dest);
  return receipt;
}

async function localModelWrite(request, existingContent, seed) {
  const prompt = [
    'You are drafting ONE bounded source proposal for Stephanos OS in an isolated Git worktree.',
    'Return only valid JSON with exactly these fields: {"path":"target","content":"complete file contents"}.',
    'No markdown fencing, commands, instructions to execute code, extra file edits or implicit permissions.',
    'Never disable security, bypass review, change leases, request credentials, weaken tests or alter main.',
    'Canonical seed: ' + seed.title + ' (' + seed.seedId + ').',
    'Owner: ' + seed.issue + '. Source: ' + seed.source + '.',
    'Target: ' + request.targetPath + '.',
    'Task: ' + request.intent,
    'Current contents of this exact target (may be empty for a new file):',
    existingContent.slice(0, 24000),
  ].join('\n\n');
  // Loopback only, including fixture ports. Never let a task request a remote endpoint.
  const port = Number(process.env.STEPHANOS_SEED_LOCAL_PORT || 11434);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('LOCAL_MODEL_PORT_INVALID');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/api/generate', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.STEPHANOS_SEED_LOCAL_MODEL || 'qwen:14b',
        prompt, stream: false, format: 'json',
        options: { temperature: 0.1, num_predict: 4096 },
      }),
    });
    if (!response.ok) throw new Error('LOCAL_MODEL_UNAVAILABLE_HTTP_' + response.status);
    const data = await response.json();
    if (typeof data.response !== 'string' || data.response.length > 150000)
      throw new Error('LOCAL_MODEL_RESPONSE_INVALID');
    return parseParallelSeedModelResponseV1(data.response, request.targetPath);
  } finally {
    clearTimeout(timer);
  }
}

async function safeTarget(worktree, targetPath) {
  const full = resolve(worktree, targetPath);
  if (!full.startsWith(resolve(worktree) + sep)) throw new Error('TARGET_ESCAPES_WORKTREE');
  let current = dirname(full);
  while (current.startsWith(resolve(worktree) + sep)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK_TARGET_PARENT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
  try {
    if ((await lstat(full)).isSymbolicLink()) throw new Error('SYMLINK_TARGET');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return full;
}

async function build(request) {
  const checked = validateParallelSeedBuildRequestV1(request, HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
  if (!checked.ok) throw new Error('REQUEST_REJECTED: ' + checked.errors.join(','));
  const branch = parallelSeedBranchNameV1(request);
  const worktree = join(stateRoot, 'worktrees', request.taskId);
  const receiptPath = join(stateRoot, 'receipts', request.taskId + '.json');
  try {
    await lstat(receiptPath);
    throw new Error('TASK_ALREADY_HAS_A_RECEIPT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Exclusive per-task reservation, not a global source lease. Concurrent attempts
  // cannot overwrite a receipt or silently rerun an unfinished candidate.
  await mkdir(dirname(receiptPath), { recursive: true });
  try {
    await writeFile(join(dirname(receiptPath), request.taskId + '.claim'),
      JSON.stringify({ seedId: request.seedId, ownerIssue: request.ownerIssue,
        baseSha: request.baseSha, targetPath: request.targetPath,
        createdAtUtc: new Date().toISOString() }) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('TASK_ALREADY_CLAIMED_INSPECT_EXISTING_ARTIFACT');
    throw error;
  }
  let stage = 'SELECTED';
  try {
    // Target-level custody is deliberately independent from the old goal lease.
    // One failed path cannot block another seed or another non-overlapping path.
    const targetKey = createHash('sha256').update(request.targetPath).digest('hex');
    const targetClaims = join(stateRoot, 'target-claims');
    await mkdir(targetClaims, { recursive: true });
    try {
      await writeFile(join(targetClaims, targetKey + '.claim'), JSON.stringify({
        taskId: request.taskId, seedId: request.seedId, ownerIssue: request.ownerIssue,
        targetPath: request.targetPath, baseSha: request.baseSha, createdAtUtc: new Date().toISOString(),
      }) + '\n', { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('TARGET_ALREADY_OWNED_BY_PARALLEL_TASK');
      throw error;
    }
    await saveReceipt(request, stage);
    const head = await processExec('git', ['rev-parse', '--verify', 'refs/heads/main']);
    if (head !== request.baseSha) throw new Error('EXACT_BASE_MAIN_MOVED');
    const isRepo = await processExec('git', ['rev-parse', '--show-toplevel']);
    if (resolve(isRepo).toLowerCase() !== repoRoot.toLowerCase()) throw new Error('NOT_EXPECTED_REPOSITORY');
    await mkdir(dirname(worktree), { recursive: true });
    // Worktree + separate seed-forge branch is the claim. Never touch a shared source lease.
    await processExec('git', ['worktree', 'add', '-b', branch, worktree, request.baseSha]);
    stage = 'CLAIMED';
    await saveReceipt(request, stage, { worktree, claimProof: branch + '@' + head });
    const target = await safeTarget(worktree, request.targetPath);
    let current = '';
    let targetExisted = false;
    try {
      current = await readFile(target, 'utf8');
      targetExisted = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const sha = targetExisted ? createHash('sha256').update(current).digest('hex') : null;
    if (sha !== request.expectedTargetSha256) throw new Error('TARGET_CONTENT_HASH_MISMATCH');
    const proposal = await localModelWrite(request, current, checked.seed);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, proposal.content, { flag: sha === null ? 'wx' : 'w' });
    stage = 'EDITED';
    const proposedSha = createHash('sha256').update(proposal.content).digest('hex');
    await saveReceipt(request, stage, { worktree, proposedSha256: proposedSha });
    for (const path of request.testPaths) {
      // Test paths are exact allowlisted filenames. No shell, arbitrary script or globbing.
      await processExec(process.execPath, ['--test', path], worktree);
    }
    const status = await processExec('git', ['status', '--porcelain', '--untracked-files=all'], worktree);
    const changed = status.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/\\/g, '/'));
    if (changed.length !== 1 || changed[0] !== request.targetPath) throw new Error('OUT_OF_SCOPE_WORKTREE_CHANGES');
    stage = 'TESTED';
    await saveReceipt(request, stage, { worktree, proposedSha256: proposedSha, testPaths: request.testPaths });
    await processExec('git', ['add', '--', request.targetPath], worktree);
    const staged = await processExec('git', ['diff', '--cached', '--name-only'], worktree);
    if (staged !== request.targetPath) throw new Error('OUT_OF_SCOPE_STAGED_FILES');
    await processExec('git', ['commit', '-m', 'Seed Canopy parallel candidate: ' + request.taskId + ' (' + request.ownerIssue + ')'], worktree);
    const commitSha = await processExec('git', ['rev-parse', 'HEAD'], worktree);
    stage = 'COMMITTED';
    return await saveReceipt(request, stage, {
      worktree, proposedSha256: proposedSha, commitSha, testPaths: request.testPaths,
      publication: 'NOT_PUBLISHED', independentReview: 'NOT_PROVEN',
    });
  } catch (error) {
    await saveReceipt(request, 'BLOCKED', {
      failedStage: stage, reason: String(error.message || error).slice(0, 500),
      worktree: stage === 'SELECTED' ? null : worktree,
    });
    throw error;
  }
}

async function main() {
  const [operation, filename, confirmation] = process.argv.slice(2);
  if (operation === 'list') return output({
    route: 'PARALLEL_SOURCE_PROPOSALS_ONLY',
    seeds: listParallelSeedCandidatesV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1),
  });
  if (operation === 'plan' && filename) {
    const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((item) => item.seedId === filename);
    if (!seed) throw new Error('UNKNOWN_SEED');
    return output(draftParallelSeedGoalV1(seed));
  }
  if (operation !== 'build' || !filename || confirmation !== '--execute') {
    throw new Error('Usage: node scripts/seed-canopy-parallel-builder.mjs list | plan <seed-id> | build <request.json> --execute');
  }
  const request = JSON.parse(await readFile(resolve(filename), 'utf8'));
  output(await build(request));
}
main().catch((error) => {
  process.stderr.write('Seed Canopy parallel lane BLOCKED: ' + String(error.message || error) + '\n');
  process.exitCode = 1;
});
