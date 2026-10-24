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
  // Porcelain's first two columns are data: trimming them corrupts tracked
  // modifications while untracked-only documentation happens to survive.
  return args[0] === 'status' ? String(x.stdout || '').trimEnd()
    : args[0] === 'show' ? String(x.stdout || '') : text(x.stdout);
}
function nodeTest(cwd, testFile, run = spawnSync) {
  const files = Array.isArray(testFile) ? testFile : [testFile];
  const x = run(process.execPath, ['--test', ...files], {
    cwd, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: Array.isArray(testFile) ? 120_000 : 60_000, maxBuffer: 128 * 1024,
    env: createBattleBridgeMinimalChildEnvironment(process.env),
  });
  return { ok: x?.status === 0 && !x.error,
    hash: digest(x?.stdout || ''), output: x?.stdout || '' };
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
  return constructRescueIslandPilotWithAdmission({
    task, observed, repoRoot, worktreeRoot, receiptRoot,
    sameOwnerRecoveryAuthenticated, runGit, runTest,
  });
}

async function constructRescueIslandPilotWithAdmission({
  task, observed, repoRoot, worktreeRoot, receiptRoot,
  sameOwnerRecoveryAuthenticated = false, runGit = spawnSync, runTest = spawnSync,
  recheck = async () => {}, receiptMetadata = {}, sourcePlan = null,
}) {
  let writes = sourcePlan?.writes || [{path:task.targetPath,beforeBlob:null,content:task.content}];
  const approvedPaths = writes.map(w=>w.path).sort();
  const allowed = path=>approvedPaths.includes(path);
  const expectedChanged = approvedPaths.join('\n');
  const testPaths = sourcePlan?.testPaths || [task.testPath];
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
  for (const change of writes) {
    const existing = git(canonicalRoot, ['ls-tree', 'HEAD', '--', change.path], runGit);
    if (change.beforeBlob === null && existing) fail('RESCUE_ISLAND_TARGET_ALREADY_EXISTS');
    if (change.beforeBlob !== null && !existing.startsWith('100644 blob '+change.beforeBlob+'\t'))
      fail('RESCUE_ISLAND_SOURCE_BEFORE_BLOB_CHANGED');
  }
  if(sourcePlan) writes=writes.map(change=>{
    if(!change.edits)return change;
    let content=git(canonicalRoot,['show',task.baseHead+':'+change.path],runGit);
    if(Buffer.byteLength(content,'utf8')>65536)fail('RESCUE_ISLAND_SOURCE_PATCH_SIZE_HELD');
    for(const edit of change.edits){
      if(content.split(edit.before).length!==2)fail('RESCUE_ISLAND_SOURCE_PATCH_NOT_UNIQUE');
      content=content.replace(edit.before,()=>edit.after);
    }
    if(!content.length || Buffer.byteLength(content,'utf8')>65536 || digest(content)!==change.afterSha256)
      fail('RESCUE_ISLAND_SOURCE_PATCH_CONTENT_MISMATCH');
    return Object.freeze({path:change.path,beforeBlob:change.beforeBlob,content});
  });
  if (sourcePlan) for (const testPath of testPaths) {
    if (!writes.some(w=>w.path===testPath)
        && !git(canonicalRoot,['ls-tree','--name-only','HEAD','--',testPath],runGit))
      fail('RESCUE_ISLAND_SOURCE_TEST_PLAN_MISSING');
  }
  const branch = 'rescue-island/pilot-' + task.taskId;
  const worktree = join(treeRoot, task.taskId);
  const claimDir = join(proofs, 'claims');
  if (lower(await physicalRoot(claimDir)) !== lower(claimDir))
    fail('RESCUE_ISLAND_CLAIMS_PHYSICAL_BOUNDARY_INVALID');
  await recheck('BEFORE_CLAIM');
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
    const proof = receipt(stage, task, { ...extra, ...receiptMetadata });
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
    const stageFile = await open(path, 'wx');
    try { await stageFile.writeFile(JSON.stringify(proof) + '\n'); await stageFile.sync(); }
    finally { await stageFile.close(); }
    stages.push(proof);
  };
  try {
    if (claim) {
      await claim.writeFile(JSON.stringify({
        taskId: task.taskId, head: task.baseHead,
        workerId: task.workerId, fingerprint: taskFingerprint,
      }) + '\n');
      await claim.sync();
      await claim.close();
    }
    if (recoveryLock) await recoveryLock.close();
    await append('SELECTED');
    await append('CLAIMED');
    // Atomically reserve an absent branch; a matching head never proves ownership.
    // A crash between reservation and receipt requires owner reconciliation,
    // never adoption of an unproven branch or a fresh mutation lane.
    await recheck('BEFORE_WORKTREE');
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
    await recheck('BEFORE_EDIT');
    const outputs = new Map();
    for (const change of writes) {
      const output = resolve(worktree, change.path);outputs.set(change.path,output);
      if (!output.startsWith(resolve(worktree) + (process.platform === 'win32' ? '\\' : '/')))
        fail('RESCUE_ISLAND_PATH_ESCAPES_WORKTREE');
      await mkdir(dirname(output), { recursive: true });
      if (lower(await physicalRoot(dirname(output))) !== lower(dirname(output))
          || overlaps(await physicalRoot(dirname(output)), canonicalRoot)
          || overlaps(await physicalRoot(dirname(output)), proofs))
        fail('RESCUE_ISLAND_TARGET_PARENT_BOUNDARY_INVALID');
      if (recovering && await exists(output)) {
        if (await readFile(output, 'utf8') !== change.content) fail('RESCUE_ISLAND_RECOVERY_SOURCE_MISMATCH');
      } else if (change.beforeBlob === null) {
        await writeFile(output, change.content, {flag:'wx'});
      } else {
        if (!(await lstat(output)).isFile() || lower(await physicalRoot(output)) !== lower(output)
            || git(worktree,['hash-object','--no-filters','--',change.path],runGit)!==change.beforeBlob)
          fail('RESCUE_ISLAND_SOURCE_BEFORE_BLOB_CHANGED');
        await writeFile(output,change.content,{flag:'w'});
      }
    }
    const approvedBytesMatch = async()=> {
      for(const change of writes) if(await readFile(outputs.get(change.path),'utf8')!==change.content)return false;
      return true;
    };
    await append('EDITED', {sha256:digest(task.content),
      ...(sourcePlan?{changedPaths:approvedPaths,sourceContentSha256:Object.fromEntries(writes.map(w=>[w.path,digest(w.content)]))}:{})});
    // Persisted recovery state is untrusted. Before executing any JavaScript,
    // prove every tracked delta and every untracked file is the approved doc.
    // This covers the test and its imported dependency graph, not just testPath.
    await recheck('BEFORE_TEST');
    const beforeTestHead = git(worktree, ['rev-parse', 'HEAD'], runGit);
    if (beforeTestHead !== task.baseHead && (!recovering
        || git(worktree, ['rev-parse', 'HEAD^'], runGit) !== task.baseHead
        || git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], runGit) !== expectedChanged))
      fail('RESCUE_ISLAND_RECOVERY_HEAD_UNTRUSTED');
    const deltas = git(worktree, ['diff', '--name-only', task.baseHead, '--'], runGit)
      .split('\n').filter(Boolean);
    const pendingPaths = git(worktree, ['status', '--porcelain', '--untracked-files=all'], runGit)
      .split('\n').filter(Boolean).map(line => line.slice(3).trim());
    if (deltas.some(path => !allowed(path))
        || pendingPaths.some(path => !allowed(path)))
      fail('RESCUE_ISLAND_RECOVERY_TEST_TREE_UNTRUSTED');
    for (const relative of [...new Set([...testPaths, 'shared/agents/rescueIslandPreflightV1.mjs'])].filter(p=>!sourcePlan || !allowed(p))) {
      const file = join(worktree, relative);
      if (lower(await physicalRoot(file)) !== lower(file) || !(await lstat(file)).isFile()
          || git(worktree, ['hash-object', '--no-filters', '--', relative], runGit)
            !== git(worktree, ['rev-parse', task.baseHead + ':' + relative], runGit))
        fail('RESCUE_ISLAND_RECOVERY_TEST_TREE_UNTRUSTED');
    }
    const testProof = nodeTest(worktree, sourcePlan ? testPaths : task.testPath, runTest);
    const testResultHash = testProof.hash;
    const testOutputRoot = join(proofs, 'test-output');
    await mkdir(testOutputRoot, { recursive: true });
    if (lower(await physicalRoot(testOutputRoot)) !== lower(testOutputRoot))
      fail('RESCUE_ISLAND_TEST_OUTPUT_BOUNDARY_CHANGED');
    const testOutputFile = task.taskId + '.' + testResultHash + '.log';
    const testOutputPath = join(testOutputRoot, testOutputFile);
    if (await exists(testOutputPath)) {
      if (digest(await readFile(testOutputPath)) !== testResultHash)
        fail('RESCUE_ISLAND_RECOVERY_TEST_OUTPUT_CHANGED');
    } else {
      const log = await open(testOutputPath, 'wx');
      try { await log.writeFile(testProof.output); await log.sync(); }
      finally { await log.close(); }
    }
    if (!testProof.ok) fail('RESCUE_ISLAND_FOCUSED_TEST_FAILED');
    await append('TESTED', { testResultHash, testExitCode: 0, testPath: task.testPath, testOutputFile, ...(sourcePlan?{testPaths}: {}) });
    await recheck('BEFORE_COMMIT');
    const currentHead = git(worktree, ['rev-parse', 'HEAD'], runGit);
    if (currentHead === task.baseHead) {
      // Re-observation can await I/O. Validate all actual deltas AFTER it and
      // after the test child, before creating a source commit.
      const commitDeltas = git(worktree, ['diff', '--name-only', task.baseHead, '--'], runGit)
        .split('\n').filter(Boolean);
      const commitPending = git(worktree, ['status', '--porcelain', '--untracked-files=all'], runGit)
        .split('\n').filter(Boolean).map(line => line.slice(3).trim());
      if (commitDeltas.some(path => !allowed(path))
          || commitPending.some(path => !allowed(path))
          || !await approvedBytesMatch())
        fail('RESCUE_ISLAND_PRECOMMIT_SCOPE_CHANGED');
      git(worktree, ['add', '--', ...approvedPaths], runGit);
      const staged = git(worktree, ['diff', '--cached', '--name-only'], runGit);
      if (staged !== expectedChanged) fail('RESCUE_ISLAND_STAGED_SCOPE_MISMATCH');
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
    const committedBytesMatch = await approvedBytesMatch();
    const dirty = git(worktree, ['status', '--porcelain'], runGit);
    if (!SHA.test(head) || parent !== task.baseHead
        || changed !== expectedChanged || dirty
        || !committedBytesMatch) {
      fail('RESCUE_ISLAND_COMMITTED_TREE_NOT_PROVEN');
    }
    const blobs={};
    for(const change of writes){
      const blob=git(worktree,['rev-parse','HEAD:'+change.path],runGit);
      const workingBlob=git(worktree,['hash-object','--no-filters','--',change.path],runGit);
      if(!SHA.test(blob)||workingBlob!==blob)fail('RESCUE_ISLAND_COMMIT_BLOB_UNPROVEN');
      blobs[change.path]=blob;
    }
    await append('ISOLATED_COMMIT',{commitHead:head,sourceBlob:blobs[task.targetPath],
      exactParentHead:parent,changedPath:task.targetPath,
      ...(sourcePlan?{changedPaths:approvedPaths,sourceBlobs:blobs}:{})});
    return Object.freeze({ ok: true, workerId: task.workerId, taskId: task.taskId,
      head, parent, changedPath: task.targetPath, testResultHash, receipts: stages,
      ...(sourcePlan?{changedPaths:approvedPaths,sourceBlobs:blobs,testPaths}:{ }),
      ...receiptMetadata,
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

const SUPERVISED_PROFILE = 'SUPERVISED_COOPERATIVE_V1';
const HOST_SNAPSHOT_SCHEMA = 'stephanos.rescue-island-supervised-host-observation.v1';
const SHA256 = /^[a-f0-9]{64}$/;

function copyPilotTask(task) {
  if (!task || Object.getPrototypeOf(task) !== Object.prototype
      || Reflect.ownKeys(task).length !== immutableFields.length)
    fail('RESCUE_ISLAND_SUPERVISED_TASK_NOT_PLAIN');
  const copy = {};
  for (const key of immutableFields) {
    const property = Object.getOwnPropertyDescriptor(task, key);
    if (!property || !Object.hasOwn(property, 'value')
        || !['string', 'number'].includes(typeof property.value))
      fail('RESCUE_ISLAND_SUPERVISED_TASK_NOT_PLAIN');
    copy[key] = property.value;
  }
  return Object.freeze(copy);
}

function sourcePlanClaimDisjoint(expected,claim) { return Array.isArray(expected.targetPaths) && claim.taskId !== expected.taskId; }

function assertSupervisedObservation(value, expected, rootIdentity) {
  const now = Date.now();
  const observed = Date.parse(value?.observedAtUtc);
  if (value?.schemaVersion !== HOST_SNAPSHOT_SCHEMA
      || value.assuranceProfile !== SUPERVISED_PROFILE
      || value.repository !== REPO || value.taskId !== expected.taskId
      || value.workerId !== 'rescue-island-01'
      || value.taskFingerprint !== expected.taskFingerprint
      || value.commentId !== expected.commentId || value.sourceHead !== expected.baseHead
      || value.targetPath !== expected.targetPath
      || value.sourceBranch !== 'rescue-island/pilot-' + expected.taskId
      || !Number.isFinite(observed) || observed > now || now - observed > 10_000
      || value.nonAdministrativeProcess !== true
      || value.runnerResourceMode !== 'CPU_ONLY'
      || value.gamingState !== 'IDLE_FRESH_VERIFIED'
      || Date.parse(value.resourceGrantExpiresAtUtc) <= now
      || !Number.isFinite(Date.parse(value.resourceGrantExpiresAtUtc))
      || value.existingOwnerAdmissionHeld !== true
      || value.canonicalCheckoutPreserved !== true
      || !SHA256.test(value.canonicalPreservationDigest || '')
      || !SHA256.test(value.worktreeIdentity || '')
      || !value.roots || Object.values(value.roots).some(v => typeof v !== 'string' || !isAbsolute(v)))
    fail('RESCUE_ISLAND_SUPERVISED_HOST_OBSERVATION_HELD');
  const roots = value.roots;
  if (Object.keys(roots).sort().join(',') !== 'canonicalRoot,receiptRoot,repoRoot,worktreeRoot')
    fail('RESCUE_ISLAND_SUPERVISED_ROOTS_UNPROVEN');
  // The existing engine may use linked worktrees ONLY under its separate Island
  // repository. It must not reserve refs or metadata in Battle Bridge's checkout.
  if (Object.entries(roots).some(([key, path]) => key !== 'canonicalRoot'
      && overlaps(resolve(path), resolve(roots.canonicalRoot))))
    fail('RESCUE_ISLAND_SUPERVISED_CANONICAL_METADATA_OVERLAP');
  if (rootIdentity && rootIdentity !== JSON.stringify([
    roots.canonicalRoot, roots.repoRoot, roots.worktreeRoot, roots.receiptRoot,
    value.worktreeIdentity, value.canonicalPreservationDigest,
  ])) fail('RESCUE_ISLAND_SUPERVISED_BOUNDARY_CHANGED');

  const inventories = [value.canonicalClaims, value.seedClaims, value.islandClaims];
  if (value.claimInventoriesComplete !== true
      || inventories.some(v => !Array.isArray(v) || v.length > 512))
    fail('RESCUE_ISLAND_SUPERVISED_CLAIMS_UNOBSERVED');
  let own = 0;
  for (const [domain, claims] of inventories.entries()) {
    for (const claim of claims) {
      if (!claim || typeof claim.taskId !== 'string'
          || !Number.isSafeInteger(claim.ownerIssueNumber) || claim.ownerIssueNumber < 1
          || typeof claim.worktreeBranch !== 'string'
          || typeof claim.worktreeIdentity !== 'string' || !SHA256.test(claim.worktreeIdentity)
          || !Array.isArray(claim.targetPaths) || !claim.targetPaths.length
          || claim.targetPaths.length > 6 || claim.targetPaths.some(path => typeof path !== 'string'
            || !/^[A-Za-z0-9][A-Za-z0-9._/-]{1,219}$/.test(path)
            || path.split('/').some(part => ['.', '..', '.git', ''].includes(part))))
        fail('RESCUE_ISLAND_SUPERVISED_CLAIM_INVALID');
      const isOwn = domain === 2 && claim.taskId === expected.taskId
        && claim.ownerIssueNumber === (expected.ownerIssueNumber || 3109) && claim.workerId === 'rescue-island-01'
        && claim.worktreeBranch === value.sourceBranch
        && claim.worktreeIdentity === value.worktreeIdentity
        && JSON.stringify(claim.targetPaths) === JSON.stringify(expected.targetPaths || [expected.targetPath]);
      if (isOwn) { own++; continue; }
      const clash = (a, b) => {
        a = a.toLowerCase(); b = b.toLowerCase();
        return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      };
      if (claim.taskId === expected.taskId || (!sourcePlanClaimDisjoint(expected,claim) && claim.ownerIssueNumber === 3109)
          || claim.worktreeBranch.toLowerCase() === value.sourceBranch.toLowerCase()
          || claim.worktreeIdentity.toLowerCase() === value.worktreeIdentity
          || claim.targetPaths.some(path => (expected.targetPaths || [expected.targetPath]).some(target=>clash(path,target))))
        fail('RESCUE_ISLAND_SUPERVISED_OWNER_CONFLICT');
    }
  }
  if (own !== 1) fail('RESCUE_ISLAND_SUPERVISED_EXISTING_OWNER_REQUIRED');
  return Object.freeze({ roots: Object.freeze({ ...roots }), worktreeIdentity: value.worktreeIdentity,
    identity: JSON.stringify([roots.canonicalRoot, roots.repoRoot, roots.worktreeRoot,
      roots.receiptRoot, value.worktreeIdentity, value.canonicalPreservationDigest]) });
}

/**
 * Existing-host bootstrap only, not a remote API and not hostile-writer
 * containment. The two adapters MUST be supplied by the reviewed installed
 * Island host, never deserialized from a task or supplied by an AI response.
 * This factory allocates no scheduler, queue, lease, Windows identity or key.
 * Missing adapters deliberately leave production startup unavailable.
 */
export function createRescueIslandSupervisedRunnerV1(host) {
  if (typeof host?.withExistingOwnerAdmission !== 'function'
      || typeof host?.observeSupervisedAdmission !== 'function')
    fail('RESCUE_ISLAND_SUPERVISED_HOST_NOT_CONNECTED');
  const withOwner = host.withExistingOwnerAdmission.bind(host);
  const observe = host.observeSupervisedAdmission.bind(host);
  return async function runSupervised(request) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype
        || Object.keys(request).sort().join(',') !== 'commentId,task'
        || !Number.isSafeInteger(request.commentId) || request.commentId < 1)
      fail('RESCUE_ISLAND_SUPERVISED_REQUEST_INVALID');
    const task = copyPilotTask(request.task);
    const sourcePlan = task.schemaVersion === 'stephanos.rescue-island-source-task.v1'
      ? (await import('./rescueIslandSourceTaskV1.mjs')).inspectRescueIslandSourceTaskV1(task) : null;
    if (sourcePlan ? !sourcePlan.valid
      : (!validateRescueIslandPilotTaskV1(task, new Date().toISOString()) || task.issueNumber !== 3109))
      fail('RESCUE_ISLAND_EXTERNAL_TASK_INVALID');
    const expected = Object.freeze({ commentId: request.commentId,
      taskId: task.taskId, taskFingerprint: fingerprint(task), baseHead: task.baseHead,
      targetPath: task.targetPath, assuranceProfile: SUPERVISED_PROFILE,
      ...(sourcePlan?{targetPaths:sourcePlan.targetPaths,ownerIssueNumber:task.issueNumber,taskKind:sourcePlan.taskKind}:{}) });
    let invoked = false;
    let completed = false;
    let outcome;
    const returned = await withOwner(expected, async () => {
      if (invoked) fail('RESCUE_ISLAND_SUPERVISED_CALLBACK_REPLAY');
      invoked = true;
      const { readRescueIslandSupervisedPilotGithubFactsV1 } =
        await import('./rescueIslandAuthenticatedGithubReadV1.mjs');
      const facts = await readRescueIslandSupervisedPilotGithubFactsV1({
        commentId: expected.commentId, task, nowUtc: new Date().toISOString(),
      });
      if (facts?.verdict !== 'GITHUB_FACTS_STRUCTURALLY_VERIFIED'
          || facts.assuranceProfile !== SUPERVISED_PROFILE
          || facts.sourceHead !== task.baseHead || facts.taskId !== task.taskId
          || facts.commentId !== expected.commentId)
        fail('RESCUE_ISLAND_SUPERVISED_OWNER_APPROVAL_UNPROVEN');
      let identity;
      let first;
      const recheck = async (stage) => {
        if (Date.now() >= Date.parse(task.expiresAtUtc))
          fail('RESCUE_ISLAND_SUPERVISED_APPROVAL_EXPIRED');
        const observed = await observe(Object.freeze({ ...expected, stage }));
        // Observation can await I/O: check the deadline AFTER it, too.
        if (Date.now() >= Date.parse(task.expiresAtUtc))
          fail('RESCUE_ISLAND_SUPERVISED_APPROVAL_EXPIRED');
        const checked = assertSupervisedObservation(observed, expected, identity);
        identity ||= checked.identity;
        first ||= checked;
      };
      await recheck('BEFORE_PREPARATION');
      for (const root of Object.values(first.roots)) {
        if (lower(await physicalRoot(root)) !== lower(resolve(root)))
          fail('RESCUE_ISLAND_SUPERVISED_REDIRECTED_ROOT');
      }
      outcome = await constructRescueIslandPilotWithAdmission({
        task, sourcePlan, observed: { worktreeIdentity: first.worktreeIdentity },
        repoRoot: first.roots.repoRoot, worktreeRoot: first.roots.worktreeRoot,
        receiptRoot: first.roots.receiptRoot, recheck,
        receiptMetadata: Object.freeze({ assuranceProfile: SUPERVISED_PROFILE,
          ownerCommentId: expected.commentId, taskFingerprint: expected.taskFingerprint,
          processId: process.pid, hostileWriterContainmentProven: false,
          ...(sourcePlan?{taskKind:sourcePlan.taskKind,taskOwnerIssueNumber:task.issueNumber,
            taskOwnerIssueTitle:task.issueTitle,executionOwnerIssueNumber:3109,
            approvedTargetPaths:sourcePlan.targetPaths,approvedContentSha256:digest(task.content)}:{}),
          independentlyCommissionedWorker: false, unattendedRefillsProven: false }),
      });
      completed = true;
      return outcome;
    });
    if (!completed || returned !== outcome)
      fail('RESCUE_ISLAND_SUPERVISED_EXECUTION_RESULT_UNPROVEN');
    return outcome;
  };
}
