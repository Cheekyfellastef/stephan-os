#!/usr/bin/env node
// Local-only independent Seed Canopy supervisor. No main scheduler, Mission Worker or daemon dependency.
import { readdir, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import {
  createBattleBridgeMinimalChildEnvironment, resolveBattleBridgeGitExecutable,
  inspectBattleBridgeGitTopology,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../shared/project/seedGardenProjectionV1.mjs';
import { validateParallelSeedBuildRequestV1 } from '../shared/runtime/seedCanopyParallelForgeV1.mjs';
import {
  parallelSeedManifestHashV1, selectParallelSeedApprovedTaskV1,
  projectParallelSeedReceiptStatusV1,
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
const fixedGit = resolveBattleBridgeGitExecutable();
const fixedGitEnvironment = () => ({
  ...createBattleBridgeMinimalChildEnvironment(process.env, { git: true }),
  ...(process.platform !== 'win32' ? { HOME: homedir() } : {}),
});
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
  let approvalVerifications = 0;
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
      const shouldVerify = !existingClaim && !existingReceipt
        && validateSeedParallelApprovalReferenceV1(reference)
        && approvalVerifications < 4;
      if (shouldVerify) approvalVerifications += 1;
      const verification = shouldVerify
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
    if (!safeFilename(name)) continue;
    const receipt = await maybeJson(join(stateRoot, 'receipts', name));
    if (!receipt) continue;
    let independentGitHeadVerified = false;
    const expectedClaim = claims.find((claim) => claim.taskId === receipt.taskId);
    if (expectedClaim && receipt.stage === 'COMMITTED'
      && receipt.taskId === name.slice(0, -5)
      && /^[a-f0-9]{40}$/.test(receipt.commitSha || '')
      && /^[a-f0-9]{64}$/.test(receipt.proposedSha256 || '')
      && /^[a-f0-9]{40}$/.test(expectedClaim.baseSha || '')
      && receipt.seedId === expectedClaim.seedId
      && receipt.targetPath === expectedClaim.targetPath) {
      const worktree = pathFor('worktrees', expectedClaim.taskId, '');
      const readGit = (cwd, ...args) => {
        const result = spawnSync(fixedGit, ['-C', cwd, ...args], {
          encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
          env: fixedGitEnvironment(),
        });
        return result.status === 0 ? result.stdout.trim() : null;
      };
      const verifyGit = (...args) => readGit(worktree, ...args);
      let authorityAndWorktreeVerified = false;
      try {
        const rawManifest = await readFile(pathFor('inbox', receipt.taskId), 'utf8');
        const request = JSON.parse(rawManifest);
        const checked = validateParallelSeedBuildRequestV1(request, HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
        const reference = await maybeJson(pathFor('approvals', receipt.taskId));
        const exactManifest = checked.ok && request.taskId === receipt.taskId
          && request.seedId === expectedClaim.seedId && request.ownerIssue === expectedClaim.ownerIssue
          && request.ownerIssue === receipt.ownerIssue && request.baseSha === expectedClaim.baseSha
          && request.targetPath === expectedClaim.targetPath;
        const approval = exactManifest ? await verifySeedParallelOwnerGitHubApprovalV1({
          request, manifestSha256: parallelSeedManifestHashV1(rawManifest), reference,
          nowMs: Date.now(),
        }) : null;
        // A valid exact approval grants only source proposal scope. Also prove
        // this is the canonical registered worktree, not a fabricated clean clone.
        const canonicalTopology = inspectBattleBridgeGitTopology(root);
        if (!canonicalTopology.ok) throw new Error(canonicalTopology.blocker || 'CANONICAL_GIT_TOPOLOGY_UNPROVEN');
        const canonicalTop = readGit(root, 'rev-parse', '--show-toplevel');
        const treeTop = verifyGit('rev-parse', '--show-toplevel');
        const canonicalCommon = readGit(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
        const treeCommon = verifyGit('rev-parse', '--path-format=absolute', '--git-common-dir');
        const samePhysical = async (a, b) => Boolean(a && b
          && (await realpath(a)).toLowerCase() === (await realpath(b)).toLowerCase());
        const registered = readGit(root, 'worktree', 'list', '--porcelain')?.split('\n\n') || [];
        let exactRegistration = false;
        for (const record of registered) {
          const lines = record.split('\n');
          const path = lines.find(line => line.startsWith('worktree '))?.slice(9);
          if (path && await samePhysical(path, worktree)
              && lines.includes('branch refs/heads/seed-parallel/' + request.seedId + '/' + request.taskId)
              && lines.includes('HEAD ' + receipt.commitSha)) exactRegistration = true;
        }
        authorityAndWorktreeVerified = approval?.ok === true && exactRegistration
          && await samePhysical(canonicalTop, root) && await samePhysical(treeTop, worktree)
          && await samePhysical(canonicalCommon, treeCommon);
      } catch {
        authorityAndWorktreeVerified = false;
      }
      const head = verifyGit('rev-parse', 'HEAD');
      const branch = verifyGit('branch', '--show-current');
      const clean = verifyGit('status', '--porcelain', '--untracked-files=all');
      const parentLine = verifyGit('rev-list', '--parents', '-n', '1', 'HEAD');
      const parents = parentLine?.split(' ') || [];
      const committedPaths = verifyGit('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD');
      const committedTree = verifyGit('rev-parse', 'HEAD^{tree}');
      let contentSha256 = null;
      try {
        // A mutable receipt or unrelated second commit must never impersonate the
        // original single-file, exact-base source proposal.
        const content = await readFile(join(worktree, expectedClaim.targetPath));
        contentSha256 = createHash('sha256').update(content).digest('hex');
      } catch {
        contentSha256 = null;
      }
      independentGitHeadVerified = Boolean(authorityAndWorktreeVerified && head === receipt.commitSha
        && branch === 'seed-parallel/' + expectedClaim.seedId + '/' + expectedClaim.taskId
        && clean === '' && receipt.exactBaseSha === expectedClaim.baseSha
        && parents.length === 2 && parents[0] === head && parents[1] === expectedClaim.baseSha
        && committedPaths === expectedClaim.targetPath
        && /^[a-f0-9]{40}$/.test(committedTree || '')
        && contentSha256 === receipt.proposedSha256);
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
