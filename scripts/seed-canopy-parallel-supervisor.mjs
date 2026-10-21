#!/usr/bin/env node
// Local-only independent Seed Canopy supervisor. No main scheduler, Mission Worker or daemon dependency.
import { readdir, readFile, mkdir, writeFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import {
  createBattleBridgeMinimalChildEnvironment,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../shared/project/seedGardenProjectionV1.mjs';
import { validateParallelSeedBuildRequestV1 } from '../shared/runtime/seedCanopyParallelForgeV1.mjs';
import {
  parallelSeedManifestHashV1, selectParallelSeedApprovedTaskV1,
  selectParallelSeedInventoryBatchTaskV1, projectParallelSeedReceiptStatusV1,
} from '../shared/runtime/seedCanopyParallelSupervisorV1.mjs';
import {
  SEED_PARALLEL_APPROVAL_REF_SCHEMA, validateSeedParallelApprovalReferenceV1,
  resolveSeedParallelOwnerIssueLabelV1, verifySeedParallelOwnerGitHubApprovalV1,
} from '../shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scope = createHash('sha256').update(root).digest('hex').slice(0, 12);
const stateRoot = join(homedir(), '.stephanos', 'seed-parallel', scope);
const safeFilename = (value) => /^[a-z0-9][a-z0-9-]{2,79}\.json$/.test(value);
const output = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const workerEnvironment = () => ({
  ...createBattleBridgeMinimalChildEnvironment(process.env),
  ...(process.platform !== 'win32' ? { HOME: homedir() } : {}),
  // Configuration is data, not a path or command. The worker independently
  // validates both values before contacting loopback Ollama.
  ...(process.env.STEPHANOS_SEED_LOCAL_PORT
    ? { STEPHANOS_SEED_LOCAL_PORT: process.env.STEPHANOS_SEED_LOCAL_PORT } : {}),
  ...(process.env.STEPHANOS_SEED_LOCAL_MODEL
    ? { STEPHANOS_SEED_LOCAL_MODEL: process.env.STEPHANOS_SEED_LOCAL_MODEL } : {}),
});
const pathFor = (kind, taskId, extension = '.json') => join(stateRoot, kind, taskId + extension);

async function maybeJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function files(kind, extension) {
  try { return (await readdir(join(stateRoot, kind))).filter((x) => x.endsWith(extension)).sort(); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
async function inboxCandidates() {
  const candidates = [];
  for (const name of await files('inbox', '.json')) {
    if (!safeFilename(name)) continue;
    const taskId = name.slice(0, -5);
    const path = join(stateRoot, 'inbox', name);
    // A bad manifest is not authority to block other disjoint tasks.
    try {
      const raw = await readFile(path, 'utf8');
      const request = JSON.parse(raw);
      if (request.taskId !== taskId) continue;
      const checked = validateParallelSeedBuildRequestV1(request, HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
      if (!checked.ok) continue;
      const manifestSha256 = parallelSeedManifestHashV1(raw);
      const existingClaim = Boolean(await maybeJson(pathFor('receipts', taskId, '.claim')));
      const existingReceipt = Boolean(await maybeJson(pathFor('receipts', taskId)));
      const reference = await maybeJson(pathFor('approvals', taskId));
      candidates.push({
        request, path, manifestSha256, reference, approval: null,
        existingClaim, existingReceipt,
      });
    } catch {
      // Keep other approved tasks progressing; malformed entry has no execution authority.
    }
  }
  // Cursor is untrusted availability state, never approval or execution proof.
  // Collect first, then rotate only eligible references. Rejected references
  // cannot monopolize every bounded sequential foreground invocation.
  const cursorPath = join(stateRoot, 'approval-verification-cursor.json');
  let after = '';
  try {
    const cursor = await maybeJson(cursorPath);
    if (cursor?.schemaVersion === 'stephanos.seed-approval-cursor.v1'
        && safeFilename(cursor.afterFilename)) after = cursor.afterFilename;
  } catch {
    // Corruption resets scheduling only. Every approval is still fetched fresh.
  }
  const eligible = candidates.filter((candidate) =>
    !candidate.existingClaim && !candidate.existingReceipt
    && validateSeedParallelApprovalReferenceV1(candidate.reference));
  const index = eligible.findIndex((candidate) => candidate.request.taskId + '.json' > after);
  const offset = index < 0 ? 0 : index;
  const ordered = [...eligible.slice(offset), ...eligible.slice(0, offset)].slice(0, 4);
  for (const candidate of ordered) {
    // Persist progress BEFORE lookup, including failure/timeout. Atomic rename
    // replaces the cursor entry instead of following an existing cursor link.
    // Concurrent invocations may overlap; this is not a claim or scheduler lock.
    await mkdir(stateRoot, { recursive: true });
    const temporary = join(stateRoot, '.approval-cursor-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({
        schemaVersion: 'stephanos.seed-approval-cursor.v1',
        afterFilename: candidate.request.taskId + '.json',
      }) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, cursorPath);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error; // No network request without saved scheduling progress.
    }
    try {
      const verification = await verifySeedParallelOwnerGitHubApprovalV1(candidate);
      if (verification.ok) candidate.approval = verification.approval;
    } catch {
      // Cursor already advanced; this reference has no approval authority.
    }
  }
  return candidates.map(({ reference, ...candidate }) => candidate);
}

async function status() {
  const claims = [];
  for (const name of await files('receipts', '.claim')) {
    if (!name.endsWith('.claim')) continue;
    const claim = await maybeJson(join(stateRoot, 'receipts', name));
    if (claim) claims.push({ ...claim, taskId: name.slice(0, -6) });
  }
  const receipts = [];
  for (const name of await files('receipts', '.json')) {
    if (!safeFilename(name)) continue;
    const receipt = await maybeJson(join(stateRoot, 'receipts', name));
    if (!receipt) continue;
    // Persisted receipts and Git metadata are same-account, untrusted data.
    // Until an independently admitted reader exists, status is passive only.
    // In particular, never run Git status/filters or use a local config audit
    // followed by a racy executable read to manufacture candidate provenance.
    const independentGitHeadVerified = false;
    receipts.push({ ...receipt, independentGitHeadVerified });
  }
  return projectParallelSeedReceiptStatusV1(claims, receipts);
}

async function approve(taskId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('APPROVAL_REQUIRES_LOCAL_INTERACTIVE_OPERATOR_TTY');
  const entry = (await inboxCandidates()).find((candidate) => candidate.request.taskId === taskId);
  if (!entry) throw new Error('NO_VALID_INBOX_TASK_WITH_THIS_ID');
  if (entry.existingClaim || entry.existingReceipt) throw new Error('EXISTING_TASK_CUSTODY');
  const phrase = 'APPROVE ' + taskId + ' ' + entry.manifestSha256.slice(0, 12);
  const issueLabel = await resolveSeedParallelOwnerIssueLabelV1(entry.request.ownerIssue);
  output({
    taskId, seedId: entry.request.seedId,
    owner: issueLabel.label,
    issueTitleTruth: issueLabel.issueTitleTruth,
    targetPath: entry.request.targetPath, baseSha: entry.request.baseSha,
    requestedTests: entry.request.testPaths,
    exactManifestSha256: entry.manifestSha256,
    warning: 'Local source proposal only. No merge, deploy or goal closure.',
    phraseToType: phrase,
  });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let typed = '';
  try { typed = await rl.question('Type the exact phrase to approve this single manifest: '); }
  finally { rl.close(); }
  if (typed !== phrase) throw new Error('OPERATOR_APPROVAL_PHRASE_MISMATCH');
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  let commentId = '';
  try { commentId = await rl2.question('Enter the owner-authored GitHub #3096 approval comment ID: '); }
  finally { rl2.close(); }
  const reference = { schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: Number(commentId) };
  const verified = await verifySeedParallelOwnerGitHubApprovalV1({
    request: entry.request, manifestSha256: entry.manifestSha256, reference,
  });
  if (!verified.ok) throw new Error('OWNER_SIGNED_APPROVAL_NOT_VERIFIED: ' + verified.reason);
  await mkdir(join(stateRoot, 'approvals'), { recursive: true });
  await writeFile(pathFor('approvals', taskId), JSON.stringify(reference, null, 2) + '\n', { flag: 'wx' });
  output({ approved: true, source: verified.source, taskId,
    commentId: verified.commentId, expiresAtUtc: verified.approval.expiresAtUtc });
}

async function runOnce() {
  const candidates = await inboxCandidates();
  const { selected, blocked, selectionTruth, eligibleCount } =
    selectParallelSeedApprovedTaskV1(candidates, Date.now());
  if (!selected) return output({ ran: false, selectionTruth, blocked, eligibleCount });
  // Exact bytes must be re-read before dispatch, preventing post-selection manifest edits.
  const rawNow = await readFile(selected.path, 'utf8');
  if (parallelSeedManifestHashV1(rawNow) !== selected.manifestSha256)
    throw new Error('APPROVED_MANIFEST_CHANGED_BEFORE_DISPATCH');
  const script = fileURLToPath(new URL('./seed-canopy-parallel-builder.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, 'build', selected.path, '--execute'], {
    cwd: root, env: workerEnvironment(), shell: false, windowsHide: true, stdio: 'inherit',
  });
  const code = await new Promise((resolveCode, reject) => {
    child.on('error', reject);
    child.on('close', resolveCode);
  });
  const issueLabel = await resolveSeedParallelOwnerIssueLabelV1(selected.request.ownerIssue);
  output({ ran: true, taskId: selected.request.taskId, childExitCode: code,
    owner: issueLabel.label,
    issueTitleTruth: issueLabel.issueTitleTruth,
    executionTruth: code === 0 ? 'SEE_EXACT_LOCAL_COMMIT_RECEIPT' : 'BLOCKED_CHECK_LOCAL_RECEIPT' });
  if (code !== 0) process.exitCode = 1;
}

// One local operator invocation may attempt at most two *independently*
// owner-approved documentation tasks. Blocked, stale or spoofed tasks keep
// their own durable custody and cannot starve a disjoint eligible task.
// This is a bounded foreground command, NOT a daemon or new scheduler.
async function runInventoryBatch() {
  const attemptedIds = [];
  const results = [];
  const MAX_INVENTORY_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_INVENTORY_ATTEMPTS; attempt += 1) {
    const candidates = await inboxCandidates();
    const selection = selectParallelSeedInventoryBatchTaskV1(
      candidates, Date.now(), attemptedIds);
    if (!selection.selected) break;
    const selected = selection.selected;
    const taskId = selected.request.taskId;
    attemptedIds.push(taskId);
    let reason = '';
    let exitCode = null;
    try {
      const rawNow = await readFile(selected.path, 'utf8');
      if (parallelSeedManifestHashV1(rawNow) !== selected.manifestSha256)
        throw new Error('APPROVED_MANIFEST_CHANGED_BEFORE_DISPATCH');
      const script = fileURLToPath(new URL('./seed-canopy-parallel-builder.mjs', import.meta.url));
      const child = spawn(process.execPath, [script, 'build', selected.path, '--execute'], {
        cwd: root, env: workerEnvironment(), shell: false,
        windowsHide: true, stdio: 'inherit',
      });
      exitCode = await new Promise((resolveCode, reject) => {
        child.once('error', reject);
        child.once('close', resolveCode);
      });
      if (exitCode !== 0) reason = 'WORKER_HELD_INSPECT_INDIVIDUAL_RECEIPT';
    } catch {
      // Never retry this task in the same batch or reinterpret a transient
      // error as source authority. A separate task may still be eligible.
      reason = 'TASK_DISPATCH_REFUSED';
    }
    const issueLabel = await resolveSeedParallelOwnerIssueLabelV1(selected.request.ownerIssue);
    results.push(Object.freeze({
      taskId,
      owner: issueLabel.label,
      issueTitleTruth: issueLabel.issueTitleTruth,
      childExitCode: exitCode,
      outcome: reason || 'WORKER_EXIT_ZERO_INDEPENDENT_COMMIT_VERIFICATION_REQUIRED',
    }));
  }
  const blockedCount = results.filter((item) =>
    item.outcome !== 'WORKER_EXIT_ZERO_INDEPENDENT_COMMIT_VERIFICATION_REQUIRED').length;
  output({
    route: 'MODEL_FREE_APPROVED_INVENTORY_ONLY',
    runMode: 'BOUNDED_FOREGROUND_NO_SCHEDULER',
    attemptedCount: results.length,
    maxAttempts: MAX_INVENTORY_ATTEMPTS,
    blockedCount,
    attempts: results,
    individualCommitVerificationRequired: true,
    originalR7LeaseTouched: false,
    protectedMergeOrDeploymentAllowed: false,
    liveSeedCompletionProven: false,
  });
  if (blockedCount) process.exitCode = 1;
}

async function main() {
  const [command, taskId] = process.argv.slice(2);
  if (command === 'status') return output(await status());
  if (command === 'inbox') {
    const candidates = await inboxCandidates();
    const s = selectParallelSeedApprovedTaskV1(candidates, Date.now());
    return output({ stateRoot, inboxCount: candidates.length, eligibleCount: s.eligibleCount,
      selected: s.selected?.request?.taskId || null, blocked: s.blocked });
  }
  if (command === 'approve' && taskId && /^[a-z0-9][a-z0-9-]{2,79}$/.test(taskId))
    return await approve(taskId);
  if (command === 'run-once') return await runOnce();
  if (command === 'run-inventory-batch' && !taskId && process.argv.length === 3)
    return await runInventoryBatch();
  throw new Error('Usage: node scripts/seed-canopy-parallel-supervisor.mjs status | inbox | approve <task-id> | run-once | run-inventory-batch');
}
main().catch((error) => {
  process.stderr.write('Seed Canopy independent supervisor: ' + String(error.message || error) + '\n');
  process.exitCode = 1;
});
