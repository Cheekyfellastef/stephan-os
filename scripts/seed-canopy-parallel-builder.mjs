#!/usr/bin/env node
// Bounded parallel source authoring through an already resident local llama.cpp router.
// Its per-request autoload=false contract prevents an evicted model reloading.
// Deliberately does not call the canonical scheduler, Goal Worker or Core Daemon.
import { readFile, mkdir, writeFile, rename, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  createBattleBridgeMinimalChildEnvironment, resolveBattleBridgeGitExecutable,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
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
import { parallelSeedManifestHashV1 } from '../shared/runtime/seedCanopyParallelSupervisorV1.mjs';
import { verifySeedParallelOwnerGitHubApprovalV1 } from '../shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs';
import { checkParallelSeedModelResourceV1, isParallelSeedGovernorSnapshotFreshV1 } from '../shared/runtime/seedCanopyParallelResourceV1.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const scope = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
const stateRoot = join(homedir(), '.stephanos', 'seed-parallel', scope);
const output = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const governorFile = join(homedir(), 'Documents', 'Stephanos-openclaw-workspace', 'vr',
  'vr-resource-governor-current.json');

async function processExec(bin, args, cwd = repoRoot, timeoutMs = 120000) {
  const git = bin === 'git';
  const executable = git ? resolveBattleBridgeGitExecutable()
    : bin === 'powershell.exe' && process.platform === 'win32'
      ? BATTLE_BRIDGE_WINDOWS_HOST.powershell
      : bin === process.execPath ? process.execPath : null;
  if (!executable) throw new Error('SEED_FORGE_UNAPPROVED_CHILD_EXECUTABLE');
  const env = {
    ...createBattleBridgeMinimalChildEnvironment(process.env, { git }),
    ...(process.platform !== 'win32' ? { HOME: homedir() } : {}),
  };
  return await new Promise((res, rej) => {
    const child = spawn(executable, args, {
      cwd, shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk).slice(0, 32768); stdout = stdout.slice(-65536); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 32768); stderr = stderr.slice(-65536); });
    child.on('error', (error) => { clearTimeout(timer); rej(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) res(stdout.trim());
      else rej(new Error(executable + ' failed (' + code + '): ' + stderr.slice(-1500)));
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

async function localModelPreflight() {
  const selectedModel = process.env.STEPHANOS_SEED_LOCAL_MODEL || 'qwen3-coder:30b';
  const port = Number(process.env.STEPHANOS_SEED_LOCAL_PORT || 8080);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('LOCAL_MODEL_PORT_INVALID');
  let governor;
  try {
    governor = JSON.parse(await readFile(governorFile, 'utf8'));
  } catch {
    throw new Error('VR_GOVERNOR_TRUTH_MISSING');
  }
  // A recently written idle snapshot is NOT live gaming evidence. Reconcile
  // on every Windows preflight, including the final pre-inference check.
  // On non-Windows fixtures, fail closed when the observed state is stale.
  if (process.platform === 'win32') {
    const canonicalGovernor = join(repoRoot, 'scripts', 'windows', 'run-vr-resource-governor.ps1');
    try {
      await processExec('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', canonicalGovernor, '-Action', 'Reconcile'],
        repoRoot, 18000);
      governor = JSON.parse(await readFile(governorFile, 'utf8'));
    } catch {
      throw new Error('VR_GOVERNOR_LIVE_RECONCILE_FAILED');
    }
  } else if (!isParallelSeedGovernorSnapshotFreshV1(governor)) {
    throw new Error('VR_GOVERNOR_SNAPSHOT_STALE_OR_UNPROVEN');
  }
  let modelInventory;
  try {
    // Router /models includes an explicit loaded/unloaded status. A dedicated
    // llama.cpp endpoint must be configured locally; the Ollama API is not an
    // admissible fallback because it can implicitly reload a stopped model.
    const response = await fetch('http://127.0.0.1:' + port + '/models', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('RESIDENT_ROUTER_MODELS_UNAVAILABLE');
    modelInventory = await response.json();
  } catch {
    throw new Error('RESIDENT_MODEL_PROOF_UNAVAILABLE');
  }
  const verdict = checkParallelSeedModelResourceV1({
    governor, modelInventory, selectedModel,
  });
  if (!verdict.ok) throw new Error('PARALLEL_FORGE_RESOURCE_HOLD: ' + verdict.reasonCodes.join(','));
  return { model: selectedModel, port };
}

async function localModelWrite(request, existingContent, seed, preflight) {
  // Recheck immediately before inference in case the VR governor changed during task setup.
  const current = await localModelPreflight();
  if (current.model !== preflight.model || current.port !== preflight.port)
    throw new Error('LOCAL_MODEL_PREFLIGHT_CHANGED');
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
  const port = current.port;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let resourceAbort = '';
  let governorCheckInFlight = false;
  // VR/flat-game starts must cancel work already in progress, not merely
  // prohibit the next request. The local governor remains the eviction owner.
  const gameWatch = setInterval(async () => {
    if (governorCheckInFlight || resourceAbort) return;
    governorCheckInFlight = true;
    try {
      const state = JSON.parse(await readFile(governorFile, 'utf8'));
      if (state.schemaVersion !== 'stephanos.vr-resource-governor.v1'
        || state.active !== false || state.localModelAllowed !== true
        || !isParallelSeedGovernorSnapshotFreshV1(state)) {
        resourceAbort = 'GAME_PRIORITY_ABORTED_LOCAL_INFERENCE';
        controller.abort();
      }
    } catch {
      resourceAbort = 'GAME_PRIORITY_GOVERNOR_TRUTH_UNAVAILABLE';
      controller.abort();
    } finally {
      governorCheckInFlight = false;
    }
  }, 500);
  try {
    // Unlike Ollama /api/generate, llama.cpp router honours autoload=false
    // atomically at dispatch. An evicted model cannot reload via this request.
    const response = await fetch('http://127.0.0.1:' + port + '/v1/completions?autoload=false', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: current.model, prompt, stream: false,
        temperature: 0.1, max_tokens: 4096,
      }),
    });
    if (resourceAbort) throw new Error(resourceAbort);
    if (!response.ok) throw new Error('RESIDENT_MODEL_UNAVAILABLE_HTTP_' + response.status);
    const data = await response.json();
    if (resourceAbort) throw new Error(resourceAbort);
    const generated = data?.choices?.[0]?.text;
    if (typeof generated !== 'string' || generated.length > 150000)
      throw new Error('LOCAL_MODEL_RESPONSE_INVALID');
    return parseParallelSeedModelResponseV1(generated, request.targetPath);
  } catch (error) {
    if (resourceAbort) throw new Error(resourceAbort);
    throw error;
  } finally {
    clearInterval(gameWatch);
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

async function build(request, manifestSha256) {
  const checked = validateParallelSeedBuildRequestV1(request, HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
  if (!checked.ok) throw new Error('REQUEST_REJECTED: ' + checked.errors.join(','));
  // Enforced at the actual mutating worker boundary, not merely by the supervisor.
  // Direct invocation cannot waive the operator's exact manifest approval.
  let approvalReference = null;
  try {
    approvalReference = JSON.parse(await readFile(join(stateRoot, 'approvals', request.taskId + '.json'), 'utf8'));
  } catch {
    throw new Error('EXACT_LOCAL_OPERATOR_APPROVAL_MISSING_OR_UNREADABLE');
  }
  // The local file is NOT authority. Authenticate a short-lived exact task grant
  // against an owner-authored GitHub comment at the actual worker boundary.
  const approved = await verifySeedParallelOwnerGitHubApprovalV1({
    request, manifestSha256, reference: approvalReference, nowMs: Date.now(),
  });
  if (!approved.ok) throw new Error('EXTERNAL_OWNER_APPROVAL_REJECTED: ' + approved.reason);
  const resource = await localModelPreflight();
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
    const proposal = await localModelWrite(request, current, checked.seed, resource);
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
    // Hooks are not trusted task writers. A dedicated empty hooks directory prevents
    // inherited hooksPath or local hooks adding unrelated files to this commit.
    const hooksDir = join(stateRoot, 'empty-hooks');
    await mkdir(hooksDir, { recursive: true });
    const exactTree = await processExec('git', ['write-tree'], worktree);
    await processExec('git', ['-c', 'core.hooksPath=' + hooksDir, 'commit', '-m',
      'Seed Canopy parallel candidate: ' + request.taskId + ' (' + request.ownerIssue + ')'], worktree);
    const commitSha = await processExec('git', ['rev-parse', 'HEAD'], worktree);
    const parents = (await processExec('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], worktree)).split(' ');
    const committedPaths = await processExec('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], worktree);
    const committedTree = await processExec('git', ['rev-parse', 'HEAD^{tree}'], worktree);
    const workingStatus = await processExec('git', ['status', '--porcelain', '--untracked-files=all'], worktree);
    if (parents.length !== 2 || parents[0] !== commitSha || parents[1] !== request.baseSha
      || committedPaths !== request.targetPath || committedTree !== exactTree || workingStatus !== '')
      throw new Error('COMMIT_SCOPE_OR_PARENT_MISMATCH');
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
  const rawManifest = await readFile(resolve(filename), 'utf8');
  const manifestSha256 = parallelSeedManifestHashV1(rawManifest);
  const request = JSON.parse(rawManifest);
  output(await build(request, manifestSha256));
}
main().catch((error) => {
  process.stderr.write('Seed Canopy parallel lane BLOCKED: ' + String(error.message || error) + '\n');
  process.exitCode = 1;
});
