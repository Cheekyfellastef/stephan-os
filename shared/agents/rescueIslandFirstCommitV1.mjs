// #3103: bounded, isolated proof engine for a prospective Rescue Island run-once worker.
// Not a privileged entrypoint: no live inbox, GitHub approval adapter, daemon,
// scheduler, mailbox verb, merge, deployment, or unattended run is registered.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { inspectRescueIslandCandidateV1 } from './rescueIslandPreflightV1.mjs';
import { resolveBattleBridgeGitExecutable, createBattleBridgeMinimalChildEnvironment,
  battleBridgeGitFixedConfigArgs, validateBattleBridgeLocalGitConfiguration,
  inspectBattleBridgeGitTopology } from './battleBridgeExecutionBoundaryV1.mjs';

const SHA = /^[a-f0-9]{40}$/;
const TASK = /^[a-z0-9][a-z0-9-]{7,63}$/;
const SAFE_DOC = /^docs\/architecture\/rescue-island-pilot-[a-z0-9-]+\.md$/;
const REPO = 'Cheekyfellastef/stephan-os';
const PILOT_ISSUES = Object.freeze({
  3103: 'Rescue Island: two independent proof-gated builders outside Goal Conveyor',
  3109: 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
});

const digest = (s) => createHash('sha256').update(s).digest('hex');
const fingerprint = (task) => digest(JSON.stringify(immutableFields.map((key) => task[key])));
async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const text = (s) => String(s ?? '').trim();
const lower = (v) => process.platform === 'win32' ? v.toLowerCase() : v;
const overlaps = (left, right) => {
  const a = lower(left), b = lower(right);
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
};
// Resolve existing ancestors, including symlink aliases, without creating a directory.
async function physicalRoot(raw) {
  if (typeof raw !== 'string' || !isAbsolute(raw)) fail('RESCUE_ISLAND_ROOT_MUST_BE_ABSOLUTE');
  let probe = resolve(raw);
  const missing = [];
  for (;;) {
    try { return resolve(await realpath(probe), ...missing.reverse()); }
    catch (err) {
      if (err.code !== 'ENOENT') fail('RESCUE_ISLAND_ROOT_UNVERIFIABLE');
      const parent = dirname(probe);
      if (parent === probe) fail('RESCUE_ISLAND_ROOT_UNVERIFIABLE');
      missing.push(basename(probe));
      probe = parent;
    }
  }
}
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function branchExists(cwd, branch, run = spawnSync) {
  const result = run(resolveBattleBridgeGitExecutable(), [...battleBridgeGitFixedConfigArgs(), '-C', cwd, 'show-ref', '--verify', '--quiet',
    'refs/heads/' + branch], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 30_000, maxBuffer: 128 * 1024,
    env: createBattleBridgeMinimalChildEnvironment(process.env, { git: true }),
  });
  if (result?.error || (result?.status !== 0 && result?.status !== 1))
    fail('RESCUE_ISLAND_BRANCH_OBSERVATION_FAILED');
  return result.status === 0;
}
function git(cwd, args, run = spawnSync) {
  const x = run(resolveBattleBridgeGitExecutable(), [...battleBridgeGitFixedConfigArgs(), '-C', cwd, ...args], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 30_000, maxBuffer: 128 * 1024,
    env: createBattleBridgeMinimalChildEnvironment(process.env, { git: true }),
  });
  if (x?.status !== 0 || x.error) fail('RESCUE_ISLAND_GIT_OPERATION_FAILED');
  return text(x.stdout);
}
function nodeTest(cwd, testFile, run = spawnSync) {
  const x = run(process.execPath, ['--test', testFile], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 60_000, maxBuffer: 128 * 1024,
    env: createBattleBridgeMinimalChildEnvironment(process.env),
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
  const now = typeof nowUtc === 'string' ? Date.parse(nowUtc) : NaN;
  const expires = typeof task?.expiresAtUtc === 'string'
    ? Date.parse(task.expiresAtUtc) : NaN;
  return Boolean(exactKeys(task, immutableFields)
    && task.schemaVersion === 'stephanos.rescue-island-pilot-task.v1'
    && task.repository === REPO
    && Number.isSafeInteger(task.issueNumber)
    && Object.hasOwn(PILOT_ISSUES, task.issueNumber)
    && task.issueTitle === PILOT_ISSUES[task.issueNumber]
    && typeof task.taskId === 'string' && TASK.test(task.taskId)
    && task.workerId === 'rescue-island-01'
    && typeof task.baseHead === 'string' && SHA.test(task.baseHead)
    && typeof task.targetPath === 'string' && SAFE_DOC.test(task.targetPath)
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
 * Uncommissioned bounded source engine. No public CLI or autonomous producer.
 * Owner/claim observations do not exclude a same-principal source writer.
 * Native execution custody is a separate, unsatisfied admission requirement.
 */
export async function constructIsolatedRescueIslandPilotV1({
  task, observed, nowUtc, repoRoot, worktreeRoot, receiptRoot,
  approvalAuthenticated = false, ownershipAuthenticated = false,
  sameOwnerRecoveryAuthenticated = false,
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
      worktreeBranch: 'rescue-island/pilot-' + task.taskId,
      worktreeIdentity: observed?.worktreeIdentity,
      operatorApproval: 'EXTERNAL_OWNER_PROOF_REQUIRED',
      reviewPolicy: 'INDEPENDENT_PROTECTED_REVIEW_REQUIRED',
      allowMerge: false, allowDeploy: false, allowCanonicalLeaseBypass: false,
      allowArbitraryShell: false,
    },
    observations: observed, nowUtc,
  });
  if (eligibility.preflight !== 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
    fail('RESCUE_ISLAND_PREFLIGHT_HELD:' + eligibility.blockers.join(','));
  // A realpath/hash scan authenticates an instant, not the subsequent use.
  // Another same-principal writer can replace Git metadata, test code, target
  // parents or receipt roots after inspection. Post-commit rejection is too
  // late to contain code already executed by Node or an out-of-scope write.
  // No caller flag, injected runner, platform or recovery path can waive this.
  // Keep this before ALL filesystem/Git activity, claims and pickup receipts.
  // Replace only with an independently reviewed native custody implementation
  // covering the complete execution estate; see rescue-island-execution-custody.
  fail('RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED');
  // This demonstration does not claim that the two booleans constitute
  // external authentication. Only separately reviewed trusted adapters may
  // supply them; do not expose this function as a remote mailbox action.
  if (!repoRoot || !worktreeRoot || !receiptRoot)
    fail('RESCUE_ISLAND_ROOT_BOUNDARY_INVALID');
  const canonicalRoot = await physicalRoot(repoRoot);
  // Cover metadata authority, not just Git's advertised working top-level.
  // The canonical checkout must own a physical .git directory, without gitfile,
  // junction/symlink, common-dir, graft or object-alternate redirections.
  if (!inspectBattleBridgeGitTopology(canonicalRoot).ok)
    fail('RESCUE_ISLAND_GIT_METADATA_BOUNDARY_INVALID');
  const gitTopLevel = await physicalRoot(git(canonicalRoot, ['rev-parse', '--show-toplevel'], runGit));
  if (lower(gitTopLevel) !== lower(canonicalRoot))
    fail('RESCUE_ISLAND_REPOSITORY_TOP_LEVEL_MISMATCH');
  if (!validateBattleBridgeLocalGitConfiguration(git(canonicalRoot,
    ['config', '--local', '--null', '--list'], runGit)).ok)
    fail('RESCUE_ISLAND_GIT_CONFIGURATION_UNTRUSTED');
  const treeRoot = await physicalRoot(worktreeRoot);
  const proofs = await physicalRoot(receiptRoot);
  if (overlaps(canonicalRoot, treeRoot) || overlaps(canonicalRoot, proofs)
      || overlaps(treeRoot, proofs)) fail('RESCUE_ISLAND_ROOT_BOUNDARY_INVALID');
  if (observed.worktreeIdentity !== digest(lower(join(treeRoot, task.taskId))))
    fail('RESCUE_ISLAND_WORKTREE_IDENTITY_MISMATCH');
  if (await physicalRoot(repoRoot) !== canonicalRoot)
    fail('RESCUE_ISLAND_CANONICAL_ROOT_MOVED');
  if (git(canonicalRoot, ['rev-parse', 'HEAD'], runGit) !== task.baseHead
      || git(canonicalRoot, ['rev-parse', 'origin/main'], runGit) !== task.baseHead)
    fail('RESCUE_ISLAND_BASE_NOT_CURRENT_MAIN');
  const existing = git(canonicalRoot, ['ls-tree', '--name-only', 'HEAD', '--', task.targetPath], runGit);
  if (existing) fail('RESCUE_ISLAND_TARGET_ALREADY_EXISTS');
  const branch = 'rescue-island/pilot-' + task.taskId;
  const worktree = join(treeRoot, task.taskId);
  const claimDir = join(proofs, 'claims');
  if (lower(await physicalRoot(claimDir)) !== lower(claimDir))
    fail('RESCUE_ISLAND_CLAIMS_PHYSICAL_BOUNDARY_INVALID');
  await mkdir(treeRoot, { recursive: true });
  await mkdir(claimDir, { recursive: true });
  if (lower(await physicalRoot(worktreeRoot)) !== lower(treeRoot)
      || lower(await physicalRoot(receiptRoot)) !== lower(proofs)
      || lower(await physicalRoot(claimDir)) !== lower(join(proofs, 'claims'))
      || overlaps(await physicalRoot(repoRoot), treeRoot)
      || overlaps(await physicalRoot(repoRoot), proofs)
      || overlaps(await physicalRoot(worktree), canonicalRoot))
    fail('RESCUE_ISLAND_ROOT_BOUNDARY_CHANGED');
  const claimPath = join(claimDir, task.taskId + '.json');
  const recoveryLockPath = join(claimDir, task.taskId + '.recovery.lock');
  const taskFingerprint = fingerprint(task);
  let claim;
  let recovering = false;
  let recoveryLock;
  try { claim = await open(claimPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') fail('RESCUE_ISLAND_CLAIM_IO_FAILED');
    if (sameOwnerRecoveryAuthenticated !== true)
      fail('RESCUE_ISLAND_DUPLICATE_CLAIM');
    let previous;
    try { previous = JSON.parse(await readFile(claimPath, 'utf8')); }
    catch { fail('RESCUE_ISLAND_PREVIOUS_CLAIM_UNREADABLE'); }
    if (previous.taskId !== task.taskId || previous.head !== task.baseHead
        || previous.workerId !== task.workerId
        || previous.fingerprint !== taskFingerprint)
      fail('RESCUE_ISLAND_RECOVERY_OWNER_OR_TASK_MISMATCH');
    if (await exists(join(claimDir, task.taskId + '.ISOLATED_COMMIT.json')))
      fail('RESCUE_ISLAND_ALREADY_COMMITTED');
    if (!await exists(join(claimDir, task.taskId + '.BLOCKED.json')))
      fail('RESCUE_ISLAND_CLAIM_IN_FLIGHT');
    try { recoveryLock = await open(recoveryLockPath, 'wx'); }
    catch { fail('RESCUE_ISLAND_RECOVERY_ALREADY_IN_PROGRESS'); }
    recovering = true;
  }
  const stages = [];
  const append = async (stage, extra = {}) => {
    const proof = receipt(stage, task, extra);
    const path = join(claimDir, task.taskId + '.' + stage + '.json');
    if (recovering && await exists(path)) {
      let previous;
      try { previous = JSON.parse(await readFile(path, 'utf8')); }
      catch { fail('RESCUE_ISLAND_RECOVERY_RECEIPT_UNREADABLE'); }
      if (previous.schemaVersion !== proof.schemaVersion
          || previous.workerId !== proof.workerId
          || previous.taskId !== proof.taskId
          || previous.sourceHead !== proof.sourceHead
          || previous.targetPath !== proof.targetPath
          || previous.stage !== stage)
        fail('RESCUE_ISLAND_RECOVERY_RECEIPT_MISMATCH');
      stages.push(Object.freeze(previous));
      return;
    }
    await writeFile(path, JSON.stringify(proof) + '\n', { flag: 'wx' });
    stages.push(proof);
  };
  try {
    if (claim) {
      await claim.writeFile(JSON.stringify({
        taskId: task.taskId, head: task.baseHead,
        workerId: task.workerId, fingerprint: taskFingerprint,
      }) + '\n');
      await claim.close();
    }
    if (recoveryLock) await recoveryLock.close();
    await append('SELECTED');
    await append('CLAIMED');
    // Atomically reserve an absent branch; a matching head never proves ownership.
    // A crash between reservation and receipt requires owner reconciliation,
    // never adoption of an unproven branch or a fresh mutation lane.
    const branchProofPath = join(claimDir, task.taskId + '.BRANCH_RESERVED.json');
    if (recovering && await exists(branchProofPath)) {
      const proof = JSON.parse(await readFile(branchProofPath, 'utf8'));
      if (proof.stage !== 'BRANCH_RESERVED' || proof.taskId !== task.taskId
          || proof.workerId !== task.workerId || proof.sourceHead !== task.baseHead
          || proof.branch !== branch || proof.taskFingerprint !== taskFingerprint)
        fail('RESCUE_ISLAND_BRANCH_OWNERSHIP_UNPROVEN');
      await append('BRANCH_RESERVED');
    } else {
      if (branchExists(canonicalRoot, branch, runGit))
        fail('RESCUE_ISLAND_BRANCH_OWNERSHIP_UNPROVEN');
      git(canonicalRoot, ['update-ref', 'refs/heads/' + branch, task.baseHead, '0'.repeat(40)], runGit);
      await append('BRANCH_RESERVED', { taskFingerprint });
    }
    if (recovering && await exists(worktree)) {
      const checkedOutBranch = git(worktree, ['symbolic-ref', '--short', 'HEAD'], runGit);
      const existingHead = git(worktree, ['rev-parse', 'HEAD'], runGit);
      if (checkedOutBranch !== branch || !SHA.test(existingHead)
          || lower(await physicalRoot(git(worktree, ['rev-parse', '--show-toplevel'], runGit))) !== lower(worktree))
        fail('RESCUE_ISLAND_RECOVERY_WORKTREE_MISMATCH');
    } else {
      // A failed Git checkout may leave the branch but no worktree.
      // Reclaim only the same exact-base unmodified branch. Never reset or delete it.
      if (git(canonicalRoot, ['rev-parse', 'refs/heads/' + branch], runGit) !== task.baseHead)
        fail('RESCUE_ISLAND_RECOVERY_BRANCH_HEAD_MISMATCH');
      git(canonicalRoot, ['worktree', 'add', worktree, branch], runGit);
    }
    if (lower(await physicalRoot(worktree)) !== lower(worktree)
        || overlaps(await physicalRoot(worktree), canonicalRoot)
        || overlaps(await physicalRoot(worktree), proofs))
      fail('RESCUE_ISLAND_WORKTREE_PHYSICAL_BOUNDARY_INVALID');
    await append('PHYSICAL_PICKUP', { worktreeCreated: true });
    const output = resolve(worktree, task.targetPath);
    if (!output.startsWith(resolve(worktree) + (process.platform === 'win32' ? '\\' : '/')))
      fail('RESCUE_ISLAND_PATH_ESCAPES_WORKTREE');
    await mkdir(dirname(output), { recursive: true });
    if (lower(await physicalRoot(dirname(output))) !== lower(dirname(output))
        || overlaps(await physicalRoot(dirname(output)), canonicalRoot)
        || overlaps(await physicalRoot(dirname(output)), proofs))
      fail('RESCUE_ISLAND_TARGET_PARENT_BOUNDARY_INVALID');
    if (recovering && await exists(output)) {
      if (await readFile(output, 'utf8') !== task.content)
        fail('RESCUE_ISLAND_RECOVERY_SOURCE_MISMATCH');
    } else {
      await writeFile(output, task.content, { flag: 'wx' });
    }
    await append('EDITED', { sha256: digest(task.content) });
    // Persisted recovery state is untrusted. Before executing any JavaScript,
    // prove every tracked delta and every untracked file is the approved doc.
    // This covers the test and its imported dependency graph, not just testPath.
    const beforeTestHead = git(worktree, ['rev-parse', 'HEAD'], runGit);
    if (beforeTestHead !== task.baseHead && (!recovering
        || git(worktree, ['rev-parse', 'HEAD^'], runGit) !== task.baseHead
        || git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], runGit) !== task.targetPath))
      fail('RESCUE_ISLAND_RECOVERY_HEAD_UNTRUSTED');
    const deltas = git(worktree, ['diff', '--name-only', task.baseHead, '--'], runGit)
      .split('\n').filter(Boolean);
    const pendingPaths = git(worktree, ['status', '--porcelain', '--untracked-files=all'], runGit)
      .split('\n').filter(Boolean).map(line => line.slice(3).trim());
    if (deltas.some(path => path !== task.targetPath)
        || pendingPaths.some(path => path !== task.targetPath))
      fail('RESCUE_ISLAND_RECOVERY_TEST_TREE_UNTRUSTED');
    for (const relative of [task.testPath, 'shared/agents/rescueIslandPreflightV1.mjs']) {
      const file = join(worktree, relative);
      if (lower(await physicalRoot(file)) !== lower(file) || !(await lstat(file)).isFile()
          || git(worktree, ['hash-object', '--no-filters', '--', relative], runGit)
            !== git(worktree, ['rev-parse', task.baseHead + ':' + relative], runGit))
        fail('RESCUE_ISLAND_RECOVERY_TEST_TREE_UNTRUSTED');
    }
    const testResultHash = nodeTest(worktree, task.testPath, runTest);
    await append('TESTED', { testResultHash });
    const currentHead = git(worktree, ['rev-parse', 'HEAD'], runGit);
    if (currentHead === task.baseHead) {
      git(worktree, ['add', '--', task.targetPath], runGit);
      const staged = git(worktree, ['diff', '--cached', '--name-only'], runGit);
      if (staged !== task.targetPath) fail('RESCUE_ISLAND_STAGED_SCOPE_MISMATCH');
      git(worktree, ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
        '-c', 'user.name=Rescue Island Proposal',
        '-c', 'user.email=rescue-island@users.noreply.github.com',
        'commit', '-m', 'Bounded Rescue Island pilot proposal (' + task.taskId + ')'], runGit);
    } else if (!recovering) {
      fail('RESCUE_ISLAND_UNEXPECTED_WORKTREE_HEAD');
    }
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
    // Compare the exact approved bytes. Filter-aware hashing can silently
    // normalize CRLF or apply attributes while hiding a changed committed blob.
    const workingBlob = git(worktree, ['hash-object', '--no-filters', '--', task.targetPath], runGit);
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
  } finally {
    // A crash retains a recovery lock and requires operator-owned reconciliation.
    // No branch/worktree/claim deletion, no lease seizure or fresh owner minted.
    if (recovering) await unlink(recoveryLockPath).catch(() => {});
  }
}
