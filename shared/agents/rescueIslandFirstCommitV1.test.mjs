import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  constructIsolatedRescueIslandPilotV1 as build,
  validateRescueIslandPilotTaskV1 as validate,
} from './rescueIslandFirstCommitV1.mjs';

const NOW = '2026-10-13T23:10:00.000Z';
const ISSUE_TITLE = 'Rescue Island: two independent proof-gated builders outside Goal Conveyor';
const CONTENT = '# Rescue Island pilot\n\nA scoped, verified first source proposal.\n';
const status = (command, args, cwd) => {
  const x = spawnSync(command, args, { cwd, shell: false, encoding: 'utf8' });
  assert.equal(x.status, 0, command + ' ' + args.join(' ') + ': ' + x.stderr);
  return (x.stdout || '').trim();
};
const git = (cwd, ...args) => status('git', ['-C', cwd, ...args], cwd);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rescue-island-3103-'));
  const repoRoot = join(root, 'checkout');
  const worktreeRoot = join(root, 'isolated-worktrees');
  const receiptRoot = join(root, 'island-private-receipts');
  await mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true });
  const targets = ['rescueIslandPreflightV1.mjs', 'rescueIslandPreflightV1.test.mjs'];
  for (const target of targets) {
    const source = await readFile(new URL('./' + target, import.meta.url), 'utf8');
    await writeFile(join(repoRoot, 'shared', 'agents', target), source);
  }
  git(repoRoot, 'init', '-b', 'main');
  git(repoRoot, 'config', 'user.name', 'Island Test');
  git(repoRoot, 'config', 'user.email', 'island-test@example.invalid');
  git(repoRoot, 'remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git');
  git(repoRoot, 'add', '--', 'shared/agents/rescueIslandPreflightV1.mjs',
    'shared/agents/rescueIslandPreflightV1.test.mjs');
  git(repoRoot, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'preflight baseline');
  const head = git(repoRoot, 'rev-parse', 'HEAD');
  git(repoRoot, 'update-ref', 'refs/remotes/origin/main', head);
  const task = {
    schemaVersion: 'stephanos.rescue-island-pilot-task.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3103, issueTitle: ISSUE_TITLE,
    workerId: 'rescue-island-01', taskId: 'pilot-3103-01',
    baseHead: head,
    targetPath: 'docs/architecture/rescue-island-pilot-pilot-3103-01.md',
    content: CONTENT,
    testPath: 'shared/agents/rescueIslandPreflightV1.test.mjs',
    approvalSource: 'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
    expiresAtUtc: '2026-10-13T23:15:00.000Z',
  };
  const observed = {
    repository: task.repository, mainHead: head, observedAtUtc: NOW,
    worktreeHead: head, worktreeBranch: 'rescue-island/pilot-' + task.taskId,
    scopeResolutionScan: 'INDEPENDENT_READ_ONLY',
    scopeResolutions: [{ path: task.targetPath, canonicalPath: task.targetPath, repositoryContained: true }],
    canonicalOwnerScan: 'INDEPENDENT_READ_ONLY',
    seedOwnerScan: 'INDEPENDENT_READ_ONLY',
    islandOwnerScan: 'INDEPENDENT_READ_ONLY',
    canonicalClaims: [], seedClaims: [], islandClaims: [],
    scopeInventoryDigest: 'b'.repeat(64),
    gamingState: 'IDLE_FRESH_VERIFIED',
    runnerResourceMode: 'CPU_ONLY',
    localGamingResourceBudgetVerified: true,
    isolatedWorktreeClean: true,
    independentRunnerQualified: true,
    firstWorkerMaterialProof: false,
  };
  return {
    repoRoot, worktreeRoot, receiptRoot, task, observed, nowUtc: NOW,
    approvalAuthenticated: true, ownershipAuthenticated: true,
  };
}

test('isolated real Git source build proves physical pickup, actual Node tests, exact scoped commit and no main mutation', async () => {
  const ctx = await fixture();
  const result = await build(ctx);
  assert.equal(result.ok, true);
  assert.equal(result.workerId, 'rescue-island-01');
  assert.equal(result.reviewRequired, true);
  assert.equal(result.merged, false);
  assert.deepEqual(result.receipts.map(x => x.stage), [
    'SELECTED', 'CLAIMED', 'BRANCH_RESERVED', 'PHYSICAL_PICKUP', 'EDITED', 'TESTED', 'ISOLATED_COMMIT',
  ]);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  const tree = join(ctx.worktreeRoot, ctx.task.taskId);
  assert.equal(git(tree, 'rev-parse', 'HEAD'), result.head);
  assert.equal(git(tree, 'rev-parse', 'HEAD^'), result.parent);
  assert.equal(git(tree, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    ctx.task.targetPath);
  assert.equal(git(tree, 'status', '--porcelain'), '');
  assert.equal(await readFile(join(tree, ctx.task.targetPath), 'utf8'), CONTENT);
  const committedReceipt = JSON.parse(await readFile(join(ctx.receiptRoot,
    'claims', ctx.task.taskId + '.ISOLATED_COMMIT.json'), 'utf8'));
  assert.equal(committedReceipt.commitHead, result.head);
  assert.equal(committedReceipt.changedPath, ctx.task.targetPath);
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_DUPLICATE_CLAIM/);
});

test('missing authenticator is held BEFORE any Git source mutation or claim', async () => {
  const ctx = await fixture();
  await assert.rejects(() => build({ ...ctx, approvalAuthenticated: false }),
    /RESCUE_ISLAND_INDEPENDENT_AUTHORITY_NOT_PROVEN/);
  await assert.rejects(() => build({ ...ctx, ownershipAuthenticated: false }),
    /RESCUE_ISLAND_INDEPENDENT_AUTHORITY_NOT_PROVEN/);
});

test('wrong head, path collision and original/seed ownership stop before claim', async () => {
  const ctx = await fixture();
  await assert.rejects(() => build({ ...ctx, task: { ...ctx.task, baseHead: 'a'.repeat(40) } }),
    /RESCUE_ISLAND_PREFLIGHT_HELD/);
  await assert.rejects(() => build({
    ...ctx, observed: { ...ctx.observed, canonicalClaims: [{
      taskId: 'canonical-claim-001', ownerIssueNumber: 3103, targetPaths: [ctx.task.targetPath],
    }] },
  }), /RESCUE_ISLAND_PREFLIGHT_HELD/);
  await assert.rejects(() => build({
    ...ctx, observed: { ...ctx.observed, seedClaims: [{
      taskId: 'seed-claim-001', ownerIssueNumber: 3103, targetPaths: ['docs/architecture'],
    }] },
  }), /RESCUE_ISLAND_PREFLIGHT_HELD/);
});

test('untrusted manifest, scope, gaming and approval paths remain held', async () => {
  const ctx = await fixture();
  assert.equal(validate(ctx.task, ctx.nowUtc), true);
  for (const bad of [
    { content: '# unrelated\n' },
    { targetPath: '../bad.md' },
    { workerId: 'rescue-island-02' },
    { approvalSource: 'self-approved' },
    { issueTitle: '' },
    { expiresAtUtc: '2026-10-13T23:00:00.000Z' },
  ]) assert.equal(validate({ ...ctx.task, ...bad }, ctx.nowUtc), false);
  await assert.rejects(() => build({
    ...ctx, observed: { ...ctx.observed, gamingState: 'ACTIVE' },
  }), /RESCUE_ISLAND_PREFLIGHT_HELD/);
  await assert.rejects(() => build({
    ...ctx, observed: { ...ctx.observed, runnerResourceMode: 'GPU' },
  }), /RESCUE_ISLAND_PREFLIGHT_HELD/);
});


test('read-only preflight refuses nested or symlink-aliased receipt/worktree roots BEFORE source mutation', async () => {
  const ctx = await fixture();
  for (const patch of [
    { receiptRoot: join(ctx.repoRoot, '.private-receipts') },
    { worktreeRoot: join(ctx.repoRoot, 'private-worktrees') },
    { receiptRoot: join(ctx.worktreeRoot, 'receipts') },
  ]) await assert.rejects(() => build({ ...ctx, ...patch }),
    /RESCUE_ISLAND_ROOT_BOUNDARY_INVALID/);
  const alias = join(ctx.worktreeRoot, '..', 'repo-link');
  await symlink(ctx.repoRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => build({ ...ctx, receiptRoot: join(alias, 'hidden-receipts') }),
    /RESCUE_ISLAND_ROOT_BOUNDARY_INVALID/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('same-task transient test failure is recoverable by explicitly authorised same owner, never via a duplicate claim', async () => {
  const ctx = await fixture();
  let failedOnce = false;
  const failingRunner = (cmd, args, options) => {
    if (!failedOnce) {
      failedOnce = true;
      return { status: 1, stdout: '', stderr: 'one-time test outage' };
    }
    return spawnSync(cmd, args, options);
  };
  await assert.rejects(() => build({ ...ctx, runTest: failingRunner }),
    /RESCUE_ISLAND_FOCUSED_TEST_FAILED/);
  const before = git(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  assert.match(before, /rescue-island\/pilot-pilot-3103-01/);
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_DUPLICATE_CLAIM/);
  const result = await build({ ...ctx, sameOwnerRecoveryAuthenticated: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.receipts.map(r => r.stage), [
    'SELECTED', 'CLAIMED', 'BRANCH_RESERVED', 'PHYSICAL_PICKUP', 'EDITED', 'TESTED', 'ISOLATED_COMMIT',
  ]);
  const after = git(ctx.repoRoot, 'worktree', 'list', '--porcelain');
  assert.equal((after.match(/branch refs\/heads\/rescue-island\/pilot-pilot-3103-01/g) || []).length, 1);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  await assert.rejects(() => build({ ...ctx, sameOwnerRecoveryAuthenticated: true }),
    /RESCUE_ISLAND_ALREADY_COMMITTED/);
});

test('same-owner recovery denies changed task fingerprint and missing blocked proof', async () => {
  const ctx = await fixture();
  let failedOnce = false;
  await assert.rejects(() => build({
    ...ctx, runTest: (cmd, args, options) => {
      if (!failedOnce) {
        failedOnce = true;
        return { status: 1, stderr: 'outage' };
      }
      return spawnSync(cmd, args, options);
    },
  }), /RESCUE_ISLAND_FOCUSED_TEST_FAILED/);
  await assert.rejects(() => build({
    ...ctx, sameOwnerRecoveryAuthenticated: true,
    task: { ...ctx.task, content: CONTENT + '\nSILENTLY ALTERED\n' },
  }), /RESCUE_ISLAND_RECOVERY_OWNER_OR_TASK_MISMATCH/);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
});


test('symlinked claims folder cannot redirect receipts into the canonical checkout', async () => {
  const ctx = await fixture();
  await mkdir(ctx.receiptRoot, { recursive: true });
  await symlink(ctx.repoRoot, join(ctx.receiptRoot, 'claims'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_CLAIMS_PHYSICAL_BOUNDARY_INVALID/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('branch retained after interrupted Git worktree add can resume under same immutable owner', async () => {
  const ctx = await fixture();
  let interrupted = false;
  const branch = 'rescue-island/pilot-' + ctx.task.taskId;
  const incompleteGit = (command, args, options) => {
    if (!interrupted && args.includes('worktree') && args.includes('add')) {
      interrupted = true;
      return { status: 1, stdout: '', stderr: 'simulated interrupted worktree add' };
    }
    return spawnSync(command, args, options);
  };
  await assert.rejects(() => build({ ...ctx, runGit: incompleteGit }),
    /RESCUE_ISLAND_GIT_OPERATION_FAILED/);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'refs/heads/' + branch), ctx.task.baseHead);
  const result = await build({ ...ctx, sameOwnerRecoveryAuthenticated: true });
  assert.equal(result.ok, true);
  assert.equal(result.parent, ctx.task.baseHead);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  assert.equal(git(join(ctx.worktreeRoot, ctx.task.taskId), 'rev-parse', 'HEAD'), result.head);
  assert.equal(result.receipts.filter(x => x.stage === 'ISOLATED_COMMIT').length, 1);
});

test('Git top-level, not a caller subdirectory, owns the isolation boundary', async () => {
  const ctx = await fixture();
  const sub = join(ctx.repoRoot, 'shared');
  await assert.rejects(() => build({ ...ctx, repoRoot: sub,
    receiptRoot: join(ctx.repoRoot, 'hidden-receipts') }), /RESCUE_ISLAND_REPOSITORY_TOP_LEVEL_MISMATCH/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('local Git filters cannot execute at the source mutation boundary', async () => {
  const ctx = await fixture();
  git(ctx.repoRoot, 'config', 'filter.untrusted.clean', 'arbitrary-command');
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_GIT_CONFIGURATION_UNTRUSTED/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('recovery rejects changed test or dependency content BEFORE invoking Node', async () => {
  for (const relative of ['shared/agents/rescueIslandPreflightV1.test.mjs',
    'shared/agents/rescueIslandPreflightV1.mjs']) {
    const ctx = await fixture();
    await assert.rejects(() => build({ ...ctx, runTest: () => ({ status: 1 }) }),
      /RESCUE_ISLAND_FOCUSED_TEST_FAILED/);
    await writeFile(join(ctx.worktreeRoot, ctx.task.taskId, relative), 'throw new Error("untrusted");\n');
    let executed = false;
    await assert.rejects(() => build({ ...ctx, sameOwnerRecoveryAuthenticated: true,
      runTest: () => { executed = true; return { status: 0 }; } }),
      /RESCUE_ISLAND_RECOVERY_TEST_TREE_UNTRUSTED/);
    assert.equal(executed, false);
    assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
  }
});

test('existing exact-base branch cannot be adopted as a newly owned mutation lane', async () => {
  const ctx = await fixture();
  const branch = 'rescue-island/pilot-' + ctx.task.taskId;
  git(ctx.repoRoot, 'branch', branch, ctx.task.baseHead);
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_BRANCH_OWNERSHIP_UNPROVEN/);
  await assert.rejects(() => build({ ...ctx, sameOwnerRecoveryAuthenticated: true }),
    /RESCUE_ISLAND_BRANCH_OWNERSHIP_UNPROVEN/);
  assert.equal(git(ctx.repoRoot, 'rev-parse', branch), ctx.task.baseHead);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('recovery rejects a clean unrelated commit BEFORE invoking Node', async () => {
  const ctx = await fixture();
  await assert.rejects(() => build({ ...ctx, runTest: () => ({ status: 1 }) }),
    /RESCUE_ISLAND_FOCUSED_TEST_FAILED/);
  const tree = join(ctx.worktreeRoot, ctx.task.taskId);
  await writeFile(join(tree, 'extra.md'), 'unapproved\n');
  git(tree, 'add', '.');
  git(tree, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'untrusted extra');
  let executed = false;
  await assert.rejects(() => build({ ...ctx, sameOwnerRecoveryAuthenticated: true,
    runTest: () => { executed = true; return { status: 0 }; } }), /RESCUE_ISLAND_RECOVERY_HEAD_UNTRUSTED/);
  assert.equal(executed, false);
});

test('worktree task directory cannot point to another checkout by symlink alias', async () => {
  const ctx = await fixture();
  await mkdir(ctx.worktreeRoot, { recursive: true });
  await symlink(ctx.repoRoot, join(ctx.worktreeRoot, ctx.task.taskId),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_ROOT_BOUNDARY_CHANGED/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('no privileged public CLI, scheduler, mailbox, network write, merge or lease authority exists in pilot module', async () => {
  const source = await readFile(new URL('./rescueIslandFirstCommitV1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:force-push|push --force|Stop-Process)\b/i);
  assert.doesNotMatch(source, /fetch\s*\(|https\.request\s*\(|execSync\s*\(/);
  assert.match(source, /sourceBuildProposalOnly: true/);
  assert.match(source, /merge[dA-Za-z]*: false/);
  assert.doesNotMatch(source, /missionOrchestratorWorker|seedCanopyParallelBuilder|criticalBacklogConveyor/);
});
