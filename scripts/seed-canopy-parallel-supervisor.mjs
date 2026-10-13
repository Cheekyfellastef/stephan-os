#!/usr/bin/env node
// Local-only independent Seed Canopy supervisor. No main scheduler, Mission Worker or daemon dependency.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../shared/project/seedGardenProjectionV1.mjs';
import { validateParallelSeedBuildRequestV1 } from '../shared/runtime/seedCanopyParallelForgeV1.mjs';
import {
  parallelSeedManifestHashV1, selectParallelSeedApprovedTaskV1,
  projectParallelSeedReceiptStatusV1,
} from '../shared/runtime/seedCanopyParallelSupervisorV1.mjs';
import {
  SEED_PARALLEL_APPROVAL_REF_SCHEMA, verifySeedParallelOwnerGitHubApprovalV1,
} from '../shared/runtime/seedCanopyParallelGitHubApprovalV1.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scope = createHash('sha256').update(root).digest('hex').slice(0, 12);
const stateRoot = join(homedir(), '.stephanos', 'seed-parallel', scope);
const safeFilename = (value) => /^[a-z0-9][a-z0-9-]{2,79}\.json$/.test(value);
const output = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
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
      // Limit GitHub traffic: only a small batch of eligible, unclaimed task references
      // is authenticated per supervisor cycle. Never continuously poll for approval.
      const verification = !existingClaim && !existingReceipt && reference && candidates.length < 4
        ? await verifySeedParallelOwnerGitHubApprovalV1({ request, manifestSha256, reference })
        : null;
      candidates.push({
        request, path, manifestSha256,
        approval: verification?.ok ? verification.approval : null,
        existingClaim, existingReceipt,
      });
    } catch {
      // Keep other approved tasks progressing; malformed entry has no execution authority.
    }
  }
  return candidates;
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
    const receipt = await maybeJson(join(stateRoot, 'receipts', name));
    if (!receipt) continue;
    let independentGitHeadVerified = false;
    const expectedClaim = claims.find((claim) => claim.taskId === receipt.taskId);
    if (expectedClaim && receipt.stage === 'COMMITTED'
      && /^[a-f0-9]{40}$/.test(receipt.commitSha || '')
      && receipt.seedId === expectedClaim.seedId
      && receipt.targetPath === expectedClaim.targetPath) {
      const worktree = pathFor('worktrees', expectedClaim.taskId, '');
      const verifyGit = (...args) => {
        const result = spawnSync('git', ['-C', worktree, ...args], {
          encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
        });
        return result.status === 0 ? result.stdout.trim() : null;
      };
      const head = verifyGit('rev-parse', 'HEAD');
      const branch = verifyGit('branch', '--show-current');
      const clean = verifyGit('status', '--porcelain', '--untracked-files=all');
      independentGitHeadVerified = Boolean(head === receipt.commitSha
        && branch === 'seed-parallel/' + expectedClaim.seedId + '/' + expectedClaim.taskId
        && clean === '' && receipt.exactBaseSha === expectedClaim.baseSha);
    }
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
  output({
    taskId, seedId: entry.request.seedId,
    owner: entry.request.ownerIssue + ' — title unavailable from current evidence',
    issueTitleTruth: 'UNAVAILABLE',
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
    cwd: root, env: process.env, shell: false, windowsHide: true, stdio: 'inherit',
  });
  const code = await new Promise((resolveCode, reject) => {
    child.on('error', reject);
    child.on('close', resolveCode);
  });
  output({ ran: true, taskId: selected.request.taskId, childExitCode: code,
    owner: selected.request.ownerIssue,
    executionTruth: code === 0 ? 'SEE_EXACT_LOCAL_COMMIT_RECEIPT' : 'BLOCKED_CHECK_LOCAL_RECEIPT' });
  if (code !== 0) process.exitCode = 1;
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
  throw new Error('Usage: node scripts/seed-canopy-parallel-supervisor.mjs status | inbox | approve <task-id> | run-once');
}
main().catch((error) => {
  process.stderr.write('Seed Canopy independent supervisor: ' + String(error.message || error) + '\n');
  process.exitCode = 1;
});
