#!/usr/bin/env node
// Bounded parallel source authoring through an already resident local llama.cpp router.
// Its per-request autoload=false contract prevents an evicted model reloading.
// Deliberately does not call the canonical scheduler, Goal Worker or Core Daemon.
import { readFile, mkdir, writeFile, rename, lstat, realpath, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  createBattleBridgeMinimalChildEnvironment, resolveBattleBridgeGitExecutable,
  inspectBattleBridgeGitTopology, validateBattleBridgeLocalGitConfiguration,
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
  renderParallelSeedCanonicalInventoryV1,
} from '../shared/runtime/seedCanopyParallelForgeV1.mjs';
import { parallelSeedManifestHashV1 } from '../shared/runtime/seedCanopyParallelSupervisorV1.mjs';
import { verifySeedParallelOwnerGitHubApprovalV1 } from '../shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs';
import { checkParallelSeedModelResourceV1, isParallelSeedGovernorSnapshotFreshV1, isParallelSeedLocalWorkAllowedV1, SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED, SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED } from '../shared/runtime/seedCanopyParallelResourceV1.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const scope = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
const stateRoot = join(homedir(), '.stephanos', 'seed-parallel', scope);
const output = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const governorFile = join(homedir(), 'Documents', 'Stephanos-openclaw-workspace', 'vr',
  'vr-resource-governor-current.json');

async function assertHeavyLocalGamingHeadroom() {
  let governor;
  try { governor = JSON.parse(await readFile(governorFile, 'utf8')); }
  catch { throw new Error('GAME_PRIORITY_LOCAL_TEST_GOVERNOR_UNAVAILABLE'); }
  if (!isParallelSeedLocalWorkAllowedV1(governor))
    throw new Error('GAME_PRIORITY_LOCAL_TEST_PARKED');
}

async function processExec(bin, args, cwd = repoRoot, timeoutMs = 120000, gamingGuarded = false, rawOutput = false) {
  if (gamingGuarded) await assertHeavyLocalGamingHeadroom();
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
    // Git's local configuration and status are trust-boundary inputs.
    // Truncating a successful child response could conceal a hostile trailing
    // filter/hook setting. Fail closed on overflow instead of clipping bytes.
    const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
    const stdoutChunks = [], stderrChunks = [];
    let stdoutBytes = 0, stderrBytes = 0, outputOverflow = false;
    const capture = (chunks, bytes, chunk) => {
      if (outputOverflow) return bytes;
      const next = bytes + chunk.length;
      if (next > MAX_CHILD_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill();
        return next;
      }
      chunks.push(chunk);
      return next;
    };
    let abortOnGaming = false;
    let checkingGaming = false;
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const gameWatch = gamingGuarded ? setInterval(async () => {
      if (checkingGaming || abortOnGaming) return;
      checkingGaming = true;
      try { await assertHeavyLocalGamingHeadroom(); }
      catch {
        abortOnGaming = true;
        // This is only the explicitly approved, fixed Node test child.
        // Never terminate unrelated Windows processes or seize their leases.
        child.kill();
      } finally { checkingGaming = false; }
    }, 500) : null;
    const cleanup = () => {
      clearTimeout(timer);
      if (gameWatch) clearInterval(gameWatch);
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes = capture(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = capture(stderrChunks, stderrBytes, chunk);
    });
    child.on('error', (error) => { cleanup(); rej(error); });
    child.on('close', (code) => {
      cleanup();
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (outputOverflow) rej(new Error('SEED_CHILD_OUTPUT_LIMIT_EXCEEDED'));
      else if (abortOnGaming) rej(new Error('GAME_PRIORITY_LOCAL_TEST_ABORTED'));
      // Git porcelain uses leading spaces as status columns. Remove only
      // the terminal line ending; trimming whitespace corrupts tracked paths.
      else if (code === 0) {
        const stdout = Buffer.concat(stdoutChunks);
        res(rawOutput ? stdout : stdout.toString('utf8').replace(/\r?\n$/, ''));
      }
      else rej(new Error(executable + ' failed (' + code + '): ' + stderr.slice(-1500)));
    });
  });
}

// The first deterministic inventory rung uses no GPU or model process. It
// still reconciles the *existing* Windows gaming governor and fails closed on
// missing/active/stale protection truth before any source or test work.
async function deterministicInventoryPreflight() {
  if (process.platform === 'win32') {
    const canonicalGovernor = join(repoRoot, 'scripts', 'windows', 'run-vr-resource-governor.ps1');
    try {
      await processExec('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', canonicalGovernor, '-Action', 'Reconcile'],
        repoRoot, 18000);
    } catch {
      throw new Error('SEED_INVENTORY_GOVERNOR_RECONCILE_FAILED');
    }
  }
  await assertHeavyLocalGamingHeadroom();
  return Object.freeze({ generationMode: 'CANONICAL_INVENTORY_V1', usesLocalModel: false });
}

async function assertTrustedGitBoundary(cwd = repoRoot) {
  // The canonical source Git directory and local config remain untrusted data.
  // Recheck both before any new worktree and after potentially long inference.
  const topology = inspectBattleBridgeGitTopology(repoRoot);
  if (!topology.ok) throw new Error(topology.blocker || 'CANONICAL_GIT_TOPOLOGY_UNPROVEN');
  const localConfig = await processExec('git', ['config', '--local', '--null', '--list'], cwd);
  const config = validateBattleBridgeLocalGitConfiguration(localConfig);
  if (!config.ok) throw new Error(config.blocker || 'CANONICAL_GIT_CONFIGURATION_INVALID');
}

// A successful initial claim is not perpetual permission to author against an
// old base. Re-read the canonical local main immediately before the source
// write, before committing and before declaring success. No global lease,
// R7 repair or remote mutation is performed by this comparison.
async function assertSeedMainDidNotMove(expectedBase) {
  // Recheck both local source and its locally tracked origin before each edit
  // and commit. This does NOT certify remote GitHub freshness: the guarded
  // host sync must separately attest that origin/main is current.
  const observed = await processExec('git', ['rev-parse', '--verify', 'refs/heads/main']);
  if (observed !== expectedBase) throw new Error('SEED_SOURCE_MAIN_ADVANCED_DURING_BUILD');
  let trackedOrigin;
  try {
    trackedOrigin = await processExec('git',
      ['rev-parse', '--verify', 'refs/remotes/origin/main']);
  } catch {
    throw new Error('SEED_SOURCE_ORIGIN_MAIN_UNOBSERVED');
  }
  if (trackedOrigin !== expectedBase)
    throw new Error('SEED_SOURCE_TRACKED_ORIGIN_MAIN_MISMATCH');
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
  // Hold BEFORE endpoint access, governor reconcile, claim, worktree or inference.
  // Aborting HTTP cannot evict an unmanaged router's GPU/VRAM residency.
  if (!SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED)
    throw new Error('RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED');
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
      // Loopback-only model inventory must not follow a redirect to another host.
      redirect: 'error',
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
        || state.active !== false || state.phase !== 'NORMAL' || state.localModelAllowed !== true
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
  // The canonical governor's normal idle Watch loop does not continuously
  // rewrite its snapshot. Without live refresh a healthy 30B inference takes
  // >30 seconds and our freshness watcher aborts it even with no game open.
  // Refresh through the same bounded Windows Reconcile entry point. Keep this
  // separate from the 500ms watcher so the heavy reconcile never delays an
  // observed game transition or an unreadable-state abort.
  let governorRefreshInFlight = false;
  const refreshWatch = process.platform === 'win32' ? setInterval(async () => {
    if (governorRefreshInFlight || resourceAbort) return;
    governorRefreshInFlight = true;
    try {
      const canonicalGovernor = join(repoRoot, 'scripts', 'windows', 'run-vr-resource-governor.ps1');
      await processExec('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', canonicalGovernor, '-Action', 'Reconcile'],
        repoRoot, 18000);
      const state = JSON.parse(await readFile(governorFile, 'utf8'));
      if (state.schemaVersion !== 'stephanos.vr-resource-governor.v1'
        || state.active !== false || state.phase !== 'NORMAL' || state.localModelAllowed !== true
        || !isParallelSeedGovernorSnapshotFreshV1(state)) {
        resourceAbort = 'GAME_PRIORITY_ABORTED_LOCAL_INFERENCE';
        controller.abort();
      }
    } catch {
      resourceAbort = 'GAME_PRIORITY_GOVERNOR_LIVE_REFRESH_FAILED';
      controller.abort();
    } finally {
      governorRefreshInFlight = false;
    }
  }, 15000) : null;
  try {
    // Unlike Ollama /api/generate, llama.cpp router honours autoload=false
    // atomically at dispatch. An evicted model cannot reload via this request.
    const response = await fetch('http://127.0.0.1:' + port + '/v1/completions?autoload=false', {
      // Model prompts and source snippets may never be redirected off-loopback.
      redirect: 'error',
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
    if (refreshWatch) clearInterval(refreshWatch);
    clearTimeout(timer);
  }
}

async function safeTarget(worktree, targetPath) {
  const root = resolve(worktree);
  const physicalMatch = (a, b) => {
    const left = resolve(a), right = resolve(b);
    return process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase() : left === right;
  };
  // Git's isolated worktree must itself be a real physical directory, not a
  // redirected or replacement path. A .git file is valid inside a worktree.
  if (!physicalMatch(await realpath(root), root))
    throw new Error('SEED_WORKTREE_ROOT_REDIRECTED');
  const full = resolve(root, targetPath);
  if (!full.startsWith(root + sep)) throw new Error('TARGET_ESCAPES_WORKTREE');
  let current = dirname(full);
  while (current.startsWith(root + sep)) {
    try {
      const item = await lstat(current);
      if (item.isSymbolicLink()) throw new Error('SYMLINK_TARGET_PARENT');
      if (!item.isDirectory()) throw new Error('SEED_TARGET_PARENT_NOT_DIRECTORY');
      // Windows junctions/reparse points can resolve elsewhere even when
      // lstat().isSymbolicLink() is not sufficient to describe the alias.
      if (!physicalMatch(await realpath(current), current))
        throw new Error('SEED_TARGET_PARENT_PHYSICAL_REDIRECT');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
  try {
    const item = await lstat(full);
    if (item.isSymbolicLink()) throw new Error('SYMLINK_TARGET');
    if (!item.isFile()) throw new Error('SEED_TARGET_LEAF_NOT_FILE');
    if (!physicalMatch(await realpath(full), full))
      throw new Error('SEED_TARGET_LEAF_PHYSICAL_REDIRECT');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return full;
}

// Defense in depth before running the one fixed Node test command. The
// disjoint documentation proposal must be the ONLY changed file. In
// particular, no mutable test module supplied by another source writer may
// turn this route into unapproved JavaScript execution. This does not replace
// a separate OS-secured process sandbox or native Windows stable-handle proof.
async function assertSeedTestInputsTrusted(worktree, request) {
  await assertTrustedGitBoundary(worktree);
  const head = await processExec('git', ['rev-parse', '--verify', 'HEAD'], worktree);
  if (head !== request.baseSha) throw new Error('SEED_TEST_HEAD_NOT_APPROVED_BASE');
  const status = await processExec('git',
    ['status', '--porcelain', '--untracked-files=all'], worktree);
  const changed = status.split('\n').filter(Boolean)
    .map((row) => row.slice(3).replace(/\\/g, '/'));
  if (changed.length !== 1 || changed[0] !== request.targetPath)
    throw new Error('SEED_TEST_SOURCE_SCOPE_UNTRUSTED');
  for (const path of request.testPaths) {
    // Re-use the physical no-redirect guard already used for target paths.
    await safeTarget(worktree, path);
    let expected, actual;
    try {
      expected = await processExec('git',
        ['rev-parse', '--verify', request.baseSha + ':' + path], worktree);
      actual = await processExec('git', ['hash-object', '--path=' + path, '--', path], worktree);
    } catch {
      throw new Error('SEED_TEST_SOURCE_BLOB_UNVERIFIABLE');
    }
    if (!/^[a-f0-9]{40}$/.test(expected) || actual !== expected)
      throw new Error('SEED_TEST_SOURCE_BLOB_CHANGED');
  }
}

// Also inspect pre-upgrade raw-case claim filenames. Hashing only the new
// folded spelling would otherwise overlook a historical claim persisted by
// the previous worker revision. A malformed or redirected claim inventory is
// untrusted custody, not permission to create another owner.
async function assertNoLegacySeedTargetAlias(claimDirectory, targetPath) {
  let entries;
  try { entries = await readdir(claimDirectory, { withFileTypes: true }); }
  catch { throw new Error('SEED_TARGET_CLAIM_INVENTORY_UNAVAILABLE'); }
  if (entries.length > 512) throw new Error('SEED_TARGET_CLAIM_INVENTORY_UNBOUNDED');
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.claim$/.test(entry.name))
      throw new Error('SEED_TARGET_CLAIM_INVENTORY_UNTRUSTED');
    let claim;
    try { claim = JSON.parse(await readFile(join(claimDirectory, entry.name), 'utf8')); }
    catch { throw new Error('SEED_TARGET_CLAIM_INVENTORY_UNREADABLE'); }
    if (typeof claim?.targetPath !== 'string'
        || !claim.targetPath.startsWith('docs/architecture/')
        || !/^[a-zA-Z0-9/_-]+\.md$/.test(claim.targetPath.slice('docs/architecture/'.length)))
      throw new Error('SEED_TARGET_CLAIM_INVENTORY_UNTRUSTED');
    if (claim.targetPath.toLowerCase() === targetPath.toLowerCase())
      throw new Error('TARGET_ALREADY_OWNED_BY_PARALLEL_TASK');
  }
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
  // Owner approval and model-free generation do not close the final pathname
  // write race. Hold BEFORE reserving a task/path, creating a worktree, issuing
  // physical-pickup evidence or generating/writing proposed source bytes.
  if (!SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED)
    throw new Error('SEED_TARGET_WRITE_CUSTODY_UNIMPLEMENTED');
  const resource = request.generationMode === 'CANONICAL_INVENTORY_V1'
    ? await deterministicInventoryPreflight()
    : await localModelPreflight();
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
    // Windows path identity is case-insensitive; even on POSIX, reserve the
    // folded spelling so this queue cannot later fork duplicate owners on PC.
    const targetKey = createHash('sha256').update(request.targetPath.toLowerCase()).digest('hex');
    const targetClaims = join(stateRoot, 'target-claims');
    await mkdir(targetClaims, { recursive: true });
    await assertNoLegacySeedTargetAlias(targetClaims, request.targetPath);
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
    await assertTrustedGitBoundary();
    const head = await processExec('git', ['rev-parse', '--verify', 'refs/heads/main']);
    if (head !== request.baseSha) throw new Error('EXACT_BASE_MAIN_MOVED');
    const isRepo = await processExec('git', ['rev-parse', '--show-toplevel']);
    if ((await realpath(isRepo)).toLowerCase() !== (await realpath(repoRoot)).toLowerCase())
      throw new Error('NOT_EXPECTED_REPOSITORY');
    await mkdir(dirname(worktree), { recursive: true });
    // Worktree + separate seed-forge branch is the claim. Never touch a shared source lease.
    await processExec('git', ['worktree', 'add', '-b', branch, worktree, request.baseSha]);
    stage = 'CLAIMED';
    await saveReceipt(request, stage, { worktree, claimProof: branch + '@' + head });
    // An issued worktree command is not physical pickup. Check the newly
    // created physical checkout, exact Git branch and exact parent first.
    // This readback is local source evidence, not Windows OS custody,
    // independent review, permission to release R7 or proof of unattended work.
    const pickupHead = await processExec('git', ['rev-parse', '--verify', 'HEAD'], worktree);
    const pickupBranch = await processExec('git', ['symbolic-ref', '--short', 'HEAD'], worktree);
    const pickupTop = await processExec('git', ['rev-parse', '--show-toplevel'], worktree);
    const observedTop = await realpath(pickupTop);
    const expectedTop = await realpath(worktree);
    if (pickupHead !== request.baseSha || pickupBranch !== branch
        || observedTop.toLowerCase() !== expectedTop.toLowerCase())
      throw new Error('SEED_PHYSICAL_PICKUP_WORKTREE_UNPROVEN');
    await safeTarget(worktree, request.targetPath);
    const pickupProof = Object.freeze({
      gitHead: pickupHead,
      gitBranch: pickupBranch,
      worktree: expectedTop,
      localSourceReadback: 'VERIFIED',
      independentHostCustody: 'NOT_PROVEN',
      unattendedBuildQualified: false,
    });
    stage = 'PHYSICAL_PICKUP';
    await saveReceipt(request, stage, { worktree, pickupProof });
    const target = await safeTarget(worktree, request.targetPath);
    let current = '';
    let targetExisted = false;
    try {
      current = await readFile(target, 'utf8');
      targetExisted = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let sha = null;
    if (targetExisted) {
      // Bind approval to the exact immutable base blob, not whichever LF/CRLF
      // materialization Git chose for this Windows worktree. First prove the
      // physical checkout canonicalizes back to that exact approved blob.
      const expectedBlob = await processExec('git',
        ['rev-parse', '--verify', request.baseSha + ':' + request.targetPath], worktree);
      const materializedBlob = await processExec('git',
        ['hash-object', '--path=' + request.targetPath, '--', request.targetPath], worktree);
      if (!/^[a-f0-9]{40}$/.test(expectedBlob) || materializedBlob !== expectedBlob)
        throw new Error('TARGET_CONTENT_BLOB_CHANGED');
      const canonicalBytes = await processExec('git',
        ['cat-file', 'blob', expectedBlob], worktree, 120000, false, true);
      sha = createHash('sha256').update(canonicalBytes).digest('hex');
    }
    if (sha !== request.expectedTargetSha256) throw new Error('TARGET_CONTENT_HASH_MISMATCH');
    // Only the exactly approved deterministic documentation mode may omit
    // model inference. No task-controlled executable, endpoint or command.
    const proposal = request.generationMode === 'CANONICAL_INVENTORY_V1'
      ? renderParallelSeedCanonicalInventoryV1(request, checked.seed)
      : await localModelWrite(request, current, checked.seed, resource);
    if (request.generationMode === 'CANONICAL_INVENTORY_V1')
      await deterministicInventoryPreflight();
    await mkdir(dirname(target), { recursive: true });
    // A long model call or directory creation can change the physical path.
    // Revalidate immediately before the narrowly scoped write. A separate
    // native stable-handle fence is still required for hostile Windows races.
    await assertSeedMainDidNotMove(request.baseSha);
    const writeTarget = await safeTarget(worktree, request.targetPath);
    if (writeTarget !== target) throw new Error('TARGET_IDENTITY_MOVED');
    await writeFile(writeTarget, proposal.content, { flag: sha === null ? 'wx' : 'w' });
    stage = 'EDITED';
    const proposedSha = createHash('sha256').update(proposal.content).digest('hex');
    await saveReceipt(request, stage, { worktree, proposedSha256: proposedSha });
    for (const path of request.testPaths) {
      // Model generation may take minutes. Never run even an allowlisted test
      // if the checked-out test source, HEAD, or any other file has changed.
      // A local path is data until physical and blob custody are re-proven.
      await assertSeedTestInputsTrusted(worktree, request);
      await processExec(process.execPath, ['--test', path], worktree, 120000, true);
    }
    await assertTrustedGitBoundary(worktree);
    const status = await processExec('git', ['status', '--porcelain', '--untracked-files=all'], worktree);
    const changed = status.split('\n').filter(Boolean).map((line) => line.slice(3).replace(/\\/g, '/'));
    if (changed.length !== 1 || changed[0] !== request.targetPath) throw new Error('OUT_OF_SCOPE_WORKTREE_CHANGES');
    stage = 'TESTED';
    await assertSeedMainDidNotMove(request.baseSha);
    await saveReceipt(request, stage, { worktree, proposedSha256: proposedSha, testPaths: request.testPaths });
    // A passing test is not authority to replace the approved generated file.
    // Recheck physical file type and the complete proposed bytes immediately
    // before staging. The native Windows stable-handle/reparse-race gate is
    // still separately required for real hostile-process commissioning.
    const testOutput = await safeTarget(worktree, request.targetPath);
    if (testOutput !== target || await readFile(testOutput, 'utf8') !== proposal.content)
      throw new Error('SEED_OUTPUT_CHANGED_AFTER_TEST');
    const expectedOutputBlob = createHash('sha1')
      .update('blob ' + Buffer.byteLength(proposal.content, 'utf8') + '\0')
      .update(proposal.content, 'utf8').digest('hex');
    const observedOutputBlob = await processExec('git',
      ['hash-object', '--no-filters', '--', request.targetPath], worktree);
    if (observedOutputBlob !== expectedOutputBlob)
      throw new Error('SEED_OUTPUT_BLOB_CHANGED_AFTER_TEST');
    await processExec('git', ['add', '--', request.targetPath], worktree);
    const staged = await processExec('git', ['diff', '--cached', '--name-only'], worktree);
    if (staged !== request.targetPath) throw new Error('OUT_OF_SCOPE_STAGED_FILES');
    // Hardened child environment disables all hooks using the OS null device;
    // never override it with an attacker-populatable persistent directory.
    const exactTree = await processExec('git', ['write-tree'], worktree);
    await assertTrustedGitBoundary(worktree);
    await processExec('git', ['commit', '-m',
      'Seed Canopy parallel candidate: ' + request.taskId + ' (' + request.ownerIssue + ')'], worktree);
    const commitSha = await processExec('git', ['rev-parse', 'HEAD'], worktree);
    const parents = (await processExec('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], worktree)).split(' ');
    const committedPaths = await processExec('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], worktree);
    const committedTree = await processExec('git', ['rev-parse', 'HEAD^{tree}'], worktree);
    const workingStatus = await processExec('git', ['status', '--porcelain', '--untracked-files=all'], worktree);
    if (parents.length !== 2 || parents[0] !== commitSha || parents[1] !== request.baseSha
      || committedPaths !== request.targetPath || committedTree !== exactTree || workingStatus !== '')
      throw new Error('COMMIT_SCOPE_OR_PARENT_MISMATCH');
    // Prove the committed Git object is the one exact regular-file proposal,
    // not a post-test symlink, executable mode or same-path substitute.
    const expectedTreeEntry = '100644 blob ' + expectedOutputBlob + '\t' + request.targetPath;
    const committedEntry = await processExec('git',
      ['ls-tree', 'HEAD', '--', request.targetPath], worktree);
    if (committedEntry !== expectedTreeEntry)
      throw new Error('SEED_COMMITTED_SOURCE_BLOB_OR_MODE_MISMATCH');
    const committedOutput = await safeTarget(worktree, request.targetPath);
    if (committedOutput !== target || await readFile(committedOutput, 'utf8') !== proposal.content)
      throw new Error('SEED_COMMITTED_WORKTREE_CONTENT_MISMATCH');
    // A valid isolated commit is still held if canonical main advanced.
    await assertSeedMainDidNotMove(request.baseSha);
    stage = 'COMMITTED';
    return await saveReceipt(request, stage, {
      worktree, pickupProof, proposedSha256: proposedSha, commitSha, testPaths: request.testPaths,
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
