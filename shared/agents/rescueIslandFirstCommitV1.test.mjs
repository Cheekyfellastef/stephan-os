import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  constructIsolatedRescueIslandPilotV1 as productionBuild,
  validateRescueIslandPilotTaskV1 as validate,
} from './rescueIslandFirstCommitV1.mjs';

// The installed export is ALWAYS held. Construction regressions exercise only
// an in-memory test copy with the single missing-custody guard removed. There
// is no production option/export/environment flag to activate that copy.
const sourceUrl = new URL('./rescueIslandFirstCommitV1.mjs', import.meta.url);
const guard = "  fail('RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED');";
const installedSource = await readFile(sourceUrl, 'utf8');
assert.equal(installedSource.split(guard).length, 2);
let fixtureSource = installedSource.replace(guard,
  '// UNCOMMISSIONED DISPOSABLE FIXTURE ONLY: native custody is not provided.');
for (const dependency of ['./rescueIslandPreflightV1.mjs', './battleBridgeExecutionBoundaryV1.mjs']) {
  fixtureSource = fixtureSource.replace("from '" + dependency + "'",
    "from '" + new URL(dependency, sourceUrl).href + "'");
}
fixtureSource = fixtureSource.replace('sourceBuildProposalOnly: true,',
  'sourceBuildProposalOnly: true, fixtureOnly: true,');
const { constructIsolatedRescueIslandPilotV1: build } = await import(
  'data:text/javascript;base64,' + Buffer.from(fixtureSource).toString('base64'));
const test = (name, fn) => nodeTest('uncommissioned disposable fixture: ' + name, fn);

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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rescue-island-3103-')));
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
    worktreeIdentity: createHash('sha256').update(process.platform === 'win32'
      ? join(worktreeRoot, task.taskId).toLowerCase() : join(worktreeRoot, task.taskId)).digest('hex'),
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
  assert.ok(result.receipts.every(receipt => receipt.fixtureOnly === true));
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
  assert.ok(result.receipts.every(receipt => receipt.fixtureOnly === true));
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
  assert.ok(result.receipts.every(receipt => receipt.fixtureOnly === true));
  assert.equal(result.parent, ctx.task.baseHead);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  assert.equal(git(join(ctx.worktreeRoot, ctx.task.taskId), 'rev-parse', 'HEAD'), result.head);
  assert.equal(result.receipts.filter(x => x.stage === 'ISOLATED_COMMIT').length, 1);
});

test('Git top-level, not a caller subdirectory, owns the isolation boundary', async () => {
  const ctx = await fixture();
  const sub = join(ctx.repoRoot, 'shared');
  await assert.rejects(() => build({ ...ctx, repoRoot: sub,
    receiptRoot: join(ctx.repoRoot, 'hidden-receipts') }), /RESCUE_ISLAND_GIT_METADATA_BOUNDARY_INVALID|RESCUE_ISLAND_REPOSITORY_TOP_LEVEL_MISMATCH/);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('Git metadata aliases cannot mutate another checkout', async () => {
  const ctx = await fixture();
  const aliasCheckout = join(ctx.repoRoot, '..', 'false-checkout');
  await mkdir(aliasCheckout);
  await symlink(join(ctx.repoRoot, '.git'), join(aliasCheckout, '.git'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => build({ ...ctx, repoRoot: aliasCheckout }),
    /RESCUE_ISLAND_GIT_METADATA_BOUNDARY_INVALID/);
  assert.equal(git(ctx.repoRoot, 'branch', '--list', 'rescue-island/*'), '');
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('nested Git ref reparse points cannot redirect a task branch outside custody', async () => {
  const ctx = await fixture();
  const externalRefs = join(ctx.repoRoot, '..', 'outside-task-refs');
  await mkdir(externalRefs);
  await symlink(externalRefs, join(ctx.repoRoot, '.git', 'refs', 'heads', 'rescue-island'),
    process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_GIT_METADATA_BOUNDARY_INVALID/);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
});

test('config-driven SSH signing cannot invoke another executable', async () => {
  const ctx = await fixture();
  git(ctx.repoRoot, 'config', 'commit.gpgSign', 'true');
  git(ctx.repoRoot, 'config', 'gpg.format', 'ssh');
  git(ctx.repoRoot, 'config', 'gpg.ssh.program', 'arbitrary-executable');
  let testsExecuted = false;
  await assert.rejects(() => build({ ...ctx,
    runTest: () => { testsExecuted = true; return { status: 0 }; } }), /RESCUE_ISLAND_GIT_CONFIGURATION_UNTRUSTED/);
  assert.equal(testsExecuted, false);
  assert.equal(git(ctx.repoRoot, 'branch', '--list', 'rescue-island/*'), '');
});

test('Git CRLF normalization cannot replace the exact approved committed bytes', async () => {
  const ctx = await fixture();
  ctx.task.content = '# Rescue Island pilot\n\nExact approved CRLF bytes.\r\nSecond line.\r\n';
  git(ctx.repoRoot, 'config', 'core.autocrlf', 'input');
  await assert.rejects(() => build(ctx), /RESCUE_ISLAND_COMMIT_BLOB_UNPROVEN/);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
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

test('pilot task identities and expiry must be primitive before coercive parsing', async () => {
  const ctx = await fixture();
  const throwOnCoercion = { [Symbol.toPrimitive]() { throw new Error('UNTRUSTED_COERCION_CALLED'); } };
  const invalidTasks = [
    { taskId: [ctx.task.taskId] },
    { baseHead: [ctx.task.baseHead] },
    { targetPath: throwOnCoercion },
    { expiresAtUtc: [ctx.task.expiresAtUtc] },
    { expiresAtUtc: throwOnCoercion },
    { expiresAtUtc: new Date(ctx.task.expiresAtUtc) },
  ];
  for (const variant of invalidTasks) {
    const task = { ...ctx.task, ...variant };
    assert.equal(validate(task, NOW), false, Object.keys(variant).join(','));
    await assert.rejects(() => build({ ...ctx, task }),
      /RESCUE_ISLAND_EXTERNAL_TASK_INVALID/);
  }
  assert.equal(validate(ctx.task, throwOnCoercion), false);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

test('selected child issue #3109 physically constructs one scoped isolated source commit in test checkout', async () => {
  const ctx = await fixture();
  const taskId = 'pilot-3109-01';
  const targetPath = 'docs/architecture/rescue-island-pilot-' + taskId + '.md';
  ctx.task = {
    ...ctx.task,
    issueNumber: 3109,
    issueTitle: 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
    taskId,
    targetPath,
  };
  ctx.observed = {
    ...ctx.observed,
    worktreeBranch: 'rescue-island/pilot-' + taskId,
    worktreeIdentity: createHash('sha256').update(process.platform === 'win32'
      ? join(ctx.worktreeRoot, taskId).toLowerCase() : join(ctx.worktreeRoot, taskId)).digest('hex'),
    scopeResolutions: [{ path: targetPath, canonicalPath: targetPath, repositoryContained: true }],
  };
  assert.equal(validate(ctx.task, ctx.nowUtc), true);
  const result = await build(ctx);
  assert.equal(result.ok, true);
  assert.ok(result.receipts.every(receipt => receipt.fixtureOnly === true));
  assert.equal(result.reviewRequired, true);
  assert.equal(result.merged, false);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  assert.equal(git(join(ctx.worktreeRoot, taskId), 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), targetPath);
  assert.ok(result.receipts.some(x => x.stage === 'PHYSICAL_PICKUP'));
  assert.ok(result.receipts.some(x => x.stage === 'ISOLATED_COMMIT'));
});

test('pilot issue expansion remains exact-id-and-title and rejects unrelated issue', async () => {
  const ctx = await fixture();
  assert.equal(validate({ ...ctx.task, issueNumber: 3109 }, ctx.nowUtc), false);
  assert.equal(validate({
    ...ctx.task, issueNumber: 3110,
    issueTitle: 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
  }, ctx.nowUtc), false);
});


nodeTest('installed admission denies forged custody and recovery before claims, Git or Node on a real checkout', async () => {
  const ctx = await fixture();
  const before = git(ctx.repoRoot, 'status', '--porcelain');
  const branches = git(ctx.repoRoot, 'for-each-ref', '--format=%(refname):%(objectname)');
  let gitCalls = 0, testCalls = 0;
  for (const variant of [
    {},
    { sameOwnerRecoveryAuthenticated: true },
    { executionCustodyAuthenticated: true, originalWriterExcluded: true,
      targetWriteCustodyAuthenticated: true, nativeCustodyQualified: true },
  ]) {
    await assert.rejects(() => productionBuild({ ...ctx, ...variant,
      runGit: () => { gitCalls++; throw new Error('GIT_MUST_NOT_RUN'); },
      runTest: () => { testCalls++; throw new Error('NODE_MUST_NOT_RUN'); },
    }), { code: 'RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED' });
  }
  assert.equal(gitCalls, 0);
  assert.equal(testCalls, 0);
  assert.equal(git(ctx.repoRoot, 'rev-parse', 'HEAD'), ctx.task.baseHead);
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), before);
  assert.equal(git(ctx.repoRoot, 'for-each-ref', '--format=%(refname):%(objectname)'), branches);
  for (const path of [ctx.receiptRoot, ctx.worktreeRoot]) {
    await assert.rejects(access(path), { code: 'ENOENT' });
  }
});

nodeTest('installed custody hold cannot be bypassed by omitted or redirected roots', async () => {
  const ctx = await fixture();
  for (const roots of [
    { repoRoot: undefined, worktreeRoot: undefined, receiptRoot: undefined },
    { worktreeRoot: ctx.repoRoot, receiptRoot: ctx.repoRoot },
  ]) await assert.rejects(() => productionBuild({ ...ctx, ...roots }),
    { code: 'RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED' });
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});

nodeTest('installed same-owner recovery preserves previous claims and blocked evidence without executing', async () => {
  const ctx = await fixture();
  const claims = join(ctx.receiptRoot, 'claims');
  await mkdir(claims, { recursive: true });
  const claim = join(claims, ctx.task.taskId + '.json');
  const blocked = join(claims, ctx.task.taskId + '.BLOCKED.json');
  const bytes = '{"historicalOwner":"preserve-exactly"}\n';
  await writeFile(claim, bytes);
  await writeFile(blocked, bytes);
  await assert.rejects(() => productionBuild({ ...ctx,
    sameOwnerRecoveryAuthenticated: true,
    runGit: () => { throw new Error('RECOVERY_GIT_MUST_NOT_RUN'); },
    runTest: () => { throw new Error('RECOVERY_NODE_MUST_NOT_RUN'); },
  }), { code: 'RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED' });
  assert.equal(await readFile(claim, 'utf8'), bytes);
  assert.equal(await readFile(blocked, 'utf8'), bytes);
  await assert.rejects(access(join(claims, ctx.task.taskId + '.recovery.lock')), { code: 'ENOENT' });
  await assert.rejects(access(ctx.worktreeRoot), { code: 'ENOENT' });
  assert.equal(git(ctx.repoRoot, 'status', '--porcelain'), '');
});
