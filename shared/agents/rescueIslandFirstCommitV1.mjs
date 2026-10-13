// #3103: bounded, isolated proof engine for a prospective Rescue Island run-once worker.
// Not a privileged entrypoint: no live inbox, GitHub approval adapter, daemon,
// scheduler, mailbox verb, merge, deployment, or unattended run is registered.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { inspectRescueIslandCandidateV1 } from './rescueIslandPreflightV1.mjs';

const SHA = /^[a-f0-9]{40}$/;
const TASK = /^[a-z0-9][a-z0-9-]{7,63}$/;
const SAFE_DOC = /^docs\/architecture\/rescue-island-pilot-[a-z0-9-]+\.md$/;
const REPO = 'Cheekyfellastef/stephan-os';

const digest = (s) => createHash('sha256').update(s).digest('hex');
const text = (s) => String(s ?? '').trim();
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function git(cwd, args, run = spawnSync) {
  const x = run('git', ['-C', cwd, ...args], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 30_000, maxBuffer: 128 * 1024,
  });
  if (x?.status !== 0 || x.error) fail('RESCUE_ISLAND_GIT_OPERATION_FAILED');
  return text(x.stdout);
}
function nodeTest(cwd, testFile, run = spawnSync) {
  const x = run(process.execPath, ['--test', testFile], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 60_000, maxBuffer: 128 * 1024,
  });
  if (x?.status !== 0 || x.error) fail('RESCUE_ISLAND_FOCUSED_TEST_FAILED');
  return digest(x.stdout || '');
}
const immutableFields = Object.freeze([
  'schemaVersion', 'repository', 'issueNumber', 'issueTitle', 'taskId',
  'workerId', 'baseHead', 'targetPath', 'content', 'testPath',
  'approvalSource', 'expiresAtUtc',
]);
const exactKeys = (v, keys) =>
  v && typeof v === 'object' && !Array.isArray(v)
    && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());

/**
 * Validate the complete externally authenticated approval and scoped source.
 * NOTE: a caller-supplied object is NEVER proof of GitHub authorship.
 * Production ingress must authenticate the original owner-authored GitHub
 * comment and independent ownership/OS observations BEFORE calling run.
 */
export function validateRescueIslandPilotTaskV1(task, nowUtc) {
  const now = Date.parse(nowUtc);
  const expires = Date.parse(task?.expiresAtUtc);
  return Boolean(exactKeys(task, immutableFields)
    && task.schemaVersion === 'stephanos.rescue-island-pilot-task.v1'
    && task.repository === REPO
    && task.issueNumber === 3103
    && task.issueTitle === 'Rescue Island: two independent proof-gated builders outside Goal Conveyor'
    && TASK.test(task.taskId)
    && task.workerId === 'rescue-island-01'
    && SHA.test(task.baseHead)
    && SAFE_DOC.test(task.targetPath)
    && task.targetPath === 'docs/architecture/rescue-island-pilot-' + task.taskId + '.md'
    && task.testPath === 'shared/agents/rescueIslandPreflightV1.test.mjs'
    && typeof task.content === 'string'
    && task.content.startsWith('# Rescue Island pilot\n')
    && task.content.length >= 40 && Buffer.byteLength(task.content, 'utf8') <= 8_192
    && !task.content.includes('\0')
    && task.approvalSource === 'EXTERNAL_OWNER_ATTESTATION_REQUIRED'
    && Number.isFinite(now) && Number.isFinite(expires)
    && expires > now && expires - now <= 10 * 60 * 1000);
}

function receipt(stage, task, extras = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.rescue-island-first-commit-receipt.v1',
    island: 'RESCUE_ISLAND',
    workerId: task.workerId,
    taskId: task.taskId,
    branch: 'rescue-island/pilot-' + task.taskId,
    sourceHead: task.baseHead,
    targetPath: task.targetPath,
    stage,
    sourceBuildProposalOnly: true,
    merged: false, deployed: false, goalCompleted: false,
    ...extras,
  });
}

/**
 * Testable bounded source engine. No public CLI or autonomous producer.
 * Trusted admission is intentionally a separate unsatisfied requirement.
 */
export async function constructIsolatedRescueIslandPilotV1({
  task, observed, nowUtc, repoRoot, worktreeRoot, receiptRoot,
  approvalAuthenticated = false, ownershipAuthenticated = false,
  runGit = spawnSync, runTest = spawnSync,
} = {}) {
  if (!validateRescueIslandPilotTaskV1(task, nowUtc))
    fail('RESCUE_ISLAND_EXTERNAL_TASK_INVALID');
  if (approvalAuthenticated !== true || ownershipAuthenticated !== true)
    fail('RESCUE_ISLAND_INDEPENDENT_AUTHORITY_NOT_PROVEN');
  const eligibility = inspectRescueIslandCandidateV1({
    task: {
      schemaVersion: 'stephanos.rescue-island-preflight.v1',
      repository: REPO, island: 'RESCUE_ISLAND',
      inbox: 'RESCUE_ISLAND_OPERATOR_ONLY', workerId: task.workerId,
      taskId: task.taskId, ownerIssueNumber: task.issueNumber,
      ownerIssueTitle: task.issueTitle, taskClass: 'BOUNDED_SOURCE_PROPOSAL',
      baseHead: task.baseHead, targetPaths: [task.targetPath],
      operatorApproval: 'EXTERNAL_OWNER_PROOF_REQUIRED',
      reviewPolicy: 'INDEPENDENT_PROTECTED_REVIEW_REQUIRED',
      allowMerge: false, allowDeploy: false, allowCanonicalLeaseBypass: false,
      allowArbitraryShell: false,
    },
    observations: observed, nowUtc,
  });
  if (eligibility.preflight !== 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
    fail('RESCUE_ISLAND_PREFLIGHT_HELD:' + eligibility.blockers.join(','));
  // This demonstration does not claim that the two booleans constitute
  // external authentication. Only separately reviewed trusted adapters may
  // supply them; do not expose this function as a remote mailbox action.
  const canonicalRoot = resolve(repoRoot || '');
  const treeRoot = resolve(worktreeRoot || '');
  const proofs = resolve(receiptRoot || '');
  if (!repoRoot || !worktreeRoot || !receiptRoot
      || canonicalRoot === treeRoot || canonicalRoot === proofs
      || treeRoot === proofs) fail('RESCUE_ISLAND_ROOT_BOUNDARY_INVALID');
  if (git(canonicalRoot, ['rev-parse', 'HEAD'], runGit) !== task.baseHead
      || git(canonicalRoot, ['rev-parse', 'origin/main'], runGit) !== task.baseHead)
    fail('RESCUE_ISLAND_BASE_NOT_CURRENT_MAIN');
  const existing = git(canonicalRoot, ['ls-tree', '--name-only', 'HEAD', '--', task.targetPath], runGit);
  if (existing) fail('RESCUE_ISLAND_TARGET_ALREADY_EXISTS');
  const branch = 'rescue-island/pilot-' + task.taskId;
  const worktree = join(treeRoot, task.taskId);
  const claimDir = join(proofs, 'claims');
  await mkdir(treeRoot, { recursive: true });
  await mkdir(claimDir, { recursive: true });
  const claim = await open(join(claimDir, task.taskId + '.json'), 'wx')
    .catch(() => fail('RESCUE_ISLAND_DUPLICATE_CLAIM'));
  const stages = [];
  const append = async (stage, extra = {}) => {
    const proof = receipt(stage, task, extra);
    stages.push(proof);
    await writeFile(join(proofs, 'claims', task.taskId + '.' + stage + '.json'),
      JSON.stringify(proof) + '\n', { flag: 'wx' });
  };
  try {
    await claim.writeFile(JSON.stringify({ taskId: task.taskId, head: task.baseHead }) + '\n');
    await claim.close();
    await append('SELECTED');
    await append('CLAIMED');
    // Git worktree add is restricted to the task-derived unique branch.
    // No force, no direct main update, no cleanup of pre-existing directories.
    git(canonicalRoot, ['worktree', 'add', '-b', branch, worktree, task.baseHead], runGit);
    await append('PHYSICAL_PICKUP', { worktreeCreated: true });
    const output = resolve(worktree, task.targetPath);
    if (!output.startsWith(resolve(worktree) + (process.platform === 'win32' ? '\\' : '/')))
      fail('RESCUE_ISLAND_PATH_ESCAPES_WORKTREE');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, task.content, { flag: 'wx' });
    await append('EDITED', { sha256: digest(task.content) });
    const testResultHash = nodeTest(worktree, task.testPath, runTest);
    await append('TESTED', { testResultHash });
    git(worktree, ['add', '--', task.targetPath], runGit);
    const staged = git(worktree, ['diff', '--cached', '--name-only'], runGit);
    if (staged !== task.targetPath) fail('RESCUE_ISLAND_STAGED_SCOPE_MISMATCH');
    git(worktree, ['-c', 'core.hooksPath=/dev/null',
      '-c', 'user.name=Rescue Island Proposal',
      '-c', 'user.email=rescue-island@users.noreply.github.com',
      'commit', '-m', 'Bounded Rescue Island pilot proposal (' + task.taskId + ')'], runGit);
    const head = git(worktree, ['rev-parse', 'HEAD'], runGit);
    const parent = git(worktree, ['rev-parse', 'HEAD^'], runGit);
    const changed = git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], runGit);
    const committedPathContent = await readFile(output, 'utf8');
    const dirty = git(worktree, ['status', '--porcelain'], runGit);
    if (!SHA.test(head) || parent !== task.baseHead
        || changed !== task.targetPath || dirty
        || committedPathContent !== task.content) {
      fail('RESCUE_ISLAND_COMMITTED_TREE_NOT_PROVEN');
    }
    const blob = git(worktree, ['rev-parse', 'HEAD:' + task.targetPath], runGit);
    const workingBlob = git(worktree, ['hash-object', '--', task.targetPath], runGit);
    if (!SHA.test(blob) || workingBlob !== blob)
      fail('RESCUE_ISLAND_COMMIT_BLOB_UNPROVEN');
    await append('ISOLATED_COMMIT', { commitHead: head, sourceBlob: blob,
      exactParentHead: parent, changedPath: changed });
    return Object.freeze({ ok: true, workerId: task.workerId, taskId: task.taskId,
      head, parent, changedPath: changed, testResultHash, receipts: stages,
      reviewRequired: true, published: false, merged: false, deployed: false });
  } catch (error) {
    await append('BLOCKED', { blocker: text(error?.code || error?.message).slice(0,160) })
      .catch(() => {});
    throw error;
  }
}
