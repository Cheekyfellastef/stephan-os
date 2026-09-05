import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  CODEX_DISPATCH_TEST_ARGS,
  parseTapTestSummary,
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';
import { BATTLE_BRIDGE_RUNTIME_DATA_PATHS } from './battleBridgeDirtyDataPreservationV1.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceMutationLeaseRecord,
  createSourceMutationLeaseReleaseRecord,
} from './programmeAuthorityV1.mjs';

function scriptedSpawn(script) {
  const calls = [];
  const queues = new Map(Object.entries(script).map(([key, values]) => [key, Array.isArray(values) ? [...values] : [values]]));
  const spawn = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    calls.push(key);
    const queue = queues.get(key);
    if (!queue?.length) throw new Error(`Unexpected command: ${key}`);
    const value = queue.shift();
    return {
      status: value.status ?? 0,
      stdout: value.stdout ?? '',
      stderr: value.stderr ?? '',
      signal: value.signal ?? null,
      error: value.error,
    };
  };
  spawn.calls = calls;
  return spawn;
}

function nodeTestCommand(nodeCommand = 'node.exe') {
  return `${nodeCommand} ${CODEX_DISPATCH_TEST_ARGS.join(' ')}`;
}

test('sync bridge fast-forwards latest canonical main and runs tests through the current Node runtime', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'old-head\n' }, { stdout: 'new-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [
      { stdout: ' M stephanos-server/data/memory/durable-memory.json\n' },
      { stdout: ' M stephanos-server/data/memory/durable-memory.json\n' },
    ],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'new-head\n' },
    'git rev-list --left-right --count HEAD...new-head': { stdout: '0\t1\n' },
    'git merge --ff-only new-head': { stdout: 'Updating old-head..new-head\nFast-forward\n' },
    'git diff --name-only old-head..new-head': { stdout: 'scripts/stephanos-codex-dispatch-worker.mjs\n' },
    [nodeTestCommand()]: { stdout: '# tests 22\n# pass 22\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.beforeHead, 'old-head');
  assert.equal(result.remoteHead, 'new-head');
  assert.equal(result.afterHead, 'new-head');
  assert.equal(result.approvedTargetHead, 'new-head');
  assert.equal(result.approvalScope, 'latest-canonical-origin-main-observed-after-fetch');
  assert.equal(result.updated, true);
  assert.equal(result.preExistingDirt, true);
  assert.equal(result.restartRequired, false);
  assert.equal(result.destructiveCleanupPerformed, false);
  assert.equal(result.tests.command, 'node.exe');
  assert.deepEqual(result.tests.args, CODEX_DISPATCH_TEST_ARGS);
  assert.equal(result.tests.args.includes('--test-reporter=tap'), true);
  assert.deepEqual(result.tests.tapSummary, {
    summaryComplete: true,
    tests: 22,
    pass: 22,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    failingTests: [],
  });
  assert.equal(spawnSyncFn.calls.includes('git rev-list --left-right --count HEAD...new-head'), true);
  assert.equal(spawnSyncFn.calls.includes('git merge --ff-only new-head'), true);
  assert.equal(spawnSyncFn.calls.includes('git merge --ff-only origin/main'), false);
  assert.equal(spawnSyncFn.calls.some((call) => /npm(?:\.cmd)?/i.test(call)), false);
  assert.equal(spawnSyncFn.calls.some((call) => /powershell/i.test(call)), false);
  assert.equal(spawnSyncFn.calls.some((call) => /reset|clean|stash|checkout/i.test(call)), false);
});

test('TAP summary is extracted before stdout is bounded', () => {
  const output = `${'ok 1 - noisy passing test\n'.repeat(400)}not ok 401 - late Windows-only failure\n# tests 401\n# pass 400\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n`;
  assert.ok(output.length > 6000);
  assert.deepEqual(parseTapTestSummary(output), {
    summaryComplete: true,
    tests: 401,
    pass: 400,
    fail: 1,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    failingTests: ['late Windows-only failure'],
  });
});

test('incomplete TAP output preserves partial failures and marks missing totals unknown', () => {
  assert.deepEqual(parseTapTestSummary('ok 1 - completed\nnot ok 2 - process ended before trailer\n'), {
    summaryComplete: false,
    tests: null,
    pass: null,
    fail: null,
    cancelled: null,
    skipped: null,
    todo: null,
    failingTests: ['process ended before trailer'],
  });
});

test('sync bridge pins fast-forward safety and mutation to the exact head observed after fetch', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'old-head\n' }, { stdout: 'approved-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [{ stdout: '' }, { stdout: '' }],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'approved-head\n' },
    'git rev-list --left-right --count HEAD...approved-head': { stdout: '0\t1\n' },
    'git merge --ff-only approved-head': { stdout: 'Fast-forward\n' },
    'git diff --name-only old-head..approved-head': { stdout: '' },
    [nodeTestCommand()]: { stdout: 'pass\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.approvedTargetHead, 'approved-head');
  assert.equal(spawnSyncFn.calls.includes('git rev-list --left-right --count HEAD...origin/main'), false);
  assert.equal(spawnSyncFn.calls.includes('git merge --ff-only origin/main'), false);
});

test('sync bridge fails if the post-merge HEAD is not the exact origin/main observed after fetch', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'old-head\n' }, { stdout: 'unexpected-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [{ stdout: '' }, { stdout: '' }],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'approved-head\n' },
    'git rev-list --left-right --count HEAD...approved-head': { stdout: '0\t1\n' },
    'git merge --ff-only approved-head': { stdout: 'Fast-forward\n' },
    'git diff --name-only old-head..unexpected-head': { stdout: '' },
    [nodeTestCommand()]: { stdout: 'pass\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.approvedTargetHead, 'approved-head');
  assert.equal(result.afterHead, 'unexpected-head');
  assert.equal(result.blocker, 'POST_SYNC_HEAD_MISMATCH');
});

test('sync bridge accepts an already-current main checkout and names verification failure exactly', () => {
  const baseScript = {
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'current-head\n' }, { stdout: 'current-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [
      { stdout: ' M apps/stephanos/dist/index.html\n' },
      { stdout: ' M apps/stephanos/dist/index.html\n' },
    ],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'current-head\n' },
    'git rev-list --left-right --count HEAD...current-head': { stdout: '0\t0\n' },
    [nodeTestCommand()]: { status: 1, stderr: 'focused verification failed\n' },
  };
  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo', operatorApproval: 'operator-approved', expectedBranch: 'main', nodeCommand: 'node.exe',
    spawnSyncFn: scriptedSpawn(baseScript),
  });
  assert.equal(result.updated, false);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_FAILED');
  assert.equal(result.statusBefore, ' M apps/stephanos/dist/index.html');
  assert.equal(result.statusAfter, ' M apps/stephanos/dist/index.html');
});

test('sync bridge preserves both Git porcelain status columns for runtime-only dirt', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'current-head\n' }, { stdout: 'current-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [
      { stdout: ' M apps/stephanos/dist/index.html\n' },
      { stdout: ' M apps/stephanos/dist/index.html\n' },
    ],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'current-head\n' },
    'git rev-list --left-right --count HEAD...current-head': { stdout: '0\t0\n' },
    [nodeTestCommand()]: { stdout: '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' },
  });
  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusBefore, ' M apps/stephanos/dist/index.html');
  assert.equal(result.statusAfter, ' M apps/stephanos/dist/index.html');
});

test('sync bridge blocks local commits or divergence instead of forcing main', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: 'local-head\n' },
    'git status --porcelain=v1 --untracked-files=all': { stdout: '' },
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'remote-head\n' },
    'git rev-list --left-right --count HEAD...remote-head': { stdout: '1\t2\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    nodeCommand: 'node.exe',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE');
  assert.equal(spawnSyncFn.calls.some((call) => call.includes('merge --ff-only')), false);
});

test('sync bridge refuses to mutate without explicit operator approval', () => {
  const result = syncCodexDispatchBridge({ operatorApproval: '' });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_APPROVAL_REQUIRED');
});

test('sync bridge preserves the fixed runtime-data estate before entering existing ff-only convergence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stephanos-sync-preserve-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(repoRoot);
  await mkdir(workspaceRoot);
  for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ relativePath })}\n`);
  }
  const dirty = BATTLE_BRIDGE_RUNTIME_DATA_PATHS.map((relativePath) => `?? ${relativePath}`).join('\n');
  const oldHead = 'a'.repeat(40);
  const newHead = 'b'.repeat(40);
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: `${oldHead}\n` }, { stdout: `${oldHead}\n` }, { stdout: `${newHead}\n` }],
    'git rev-parse --show-toplevel': { stdout: `${repoRoot}\n` },
    'git remote get-url origin': { stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n' },
    'git status --porcelain=v1 --untracked-files=all': [
      { stdout: `${dirty}\n M apps/stephanos/dist/index.html\n` },
      { stdout: ' M apps/stephanos/dist/index.html\n' },
      { stdout: ' M apps/stephanos/dist/index.html\n' },
    ],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: `${newHead}\n` },
    [`git rev-list --left-right --count HEAD...${newHead}`]: { stdout: '0\t1\n' },
    [`git merge --ff-only ${newHead}`]: { stdout: 'Fast-forward\n' },
    [`git diff --name-only ${oldHead}..${newHead}`]: { stdout: 'shared/agents/battleBridgeDirtyDataPreservationV1.mjs\n' },
    [nodeTestCommand()]: { stdout: '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' },
  });
  try {
    const result = syncCodexDispatchBridge({
      repoRoot,
      workspaceRoot,
      expectedPreservationPaths: { repoRoot, workspaceRoot },
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      nodeCommand: 'node.exe',
      preservationProfile: 'battle-bridge-runtime-data-v1',
      preservationApproval: 'operator-approved',
      nowFn: () => new Date('2026-08-24T07:00:00.000Z'),
      spawnSyncFn,
    });
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.preservation.ok, true);
    assert.equal(result.preservation.receipt.itemCount, 6);
    assert.equal(result.statusBeforeSync, ' M apps/stephanos/dist/index.html');
    assert.equal(result.afterHead, newHead);
    assert.equal(result.restartRequired, true);
    assert.equal(result.destructiveCleanupPerformed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sync bridge blocks preservation if HEAD changes after the initial dirt snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stephanos-sync-head-drift-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(repoRoot);
  await mkdir(workspaceRoot);
  for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ relativePath })}\n`);
  }
  const dirty = BATTLE_BRIDGE_RUNTIME_DATA_PATHS.map((relativePath) => `?? ${relativePath}`).join('\n');
  const oldHead = 'a'.repeat(40);
  const changedHead = 'c'.repeat(40);
  const targetHead = 'b'.repeat(40);
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: `${oldHead}\n` }, { stdout: `${changedHead}\n` }],
    'git rev-parse --show-toplevel': { stdout: `${repoRoot}\n` },
    'git remote get-url origin': { stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n' },
    'git status --porcelain=v1 --untracked-files=all': { stdout: `${dirty}\n` },
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: `${targetHead}\n` },
    [`git rev-list --left-right --count HEAD...${targetHead}`]: { stdout: '0\t1\n' },
  });
  try {
    const result = syncCodexDispatchBridge({
      repoRoot,
      workspaceRoot,
      expectedPreservationPaths: { repoRoot, workspaceRoot },
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      preservationProfile: 'battle-bridge-runtime-data-v1',
      preservationApproval: 'operator-approved',
      spawnSyncFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.blocker, 'PRESERVATION_SOURCE_HEAD_CHANGED');
    assert.equal(result.beforeHead, oldHead);
    assert.equal(result.preservationHead, changedHead);
    assert.equal(result.fileMovePerformed, false);
    assert.equal(result.destructiveCleanupPerformed, false);
    for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
      assert.equal(existsSync(path.join(repoRoot, relativePath)), true);
    }
    assert.equal(existsSync(path.join(workspaceRoot, 'preserved-source-dirt')), false);
    assert.equal(spawnSyncFn.calls.some((call) => call.includes('merge --ff-only')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sync bridge proves non-divergence before the fixed preservation profile may move data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stephanos-sync-diverged-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(repoRoot);
  await mkdir(workspaceRoot);
  for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ relativePath })}\n`);
  }
  const dirty = BATTLE_BRIDGE_RUNTIME_DATA_PATHS.map((relativePath) => `?? ${relativePath}`).join('\n');
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: 'local-head\n' },
    'git status --porcelain=v1 --untracked-files=all': { stdout: `${dirty}\n` },
    'git rev-parse --show-toplevel': { stdout: `${repoRoot}\n` },
    'git remote get-url origin': { stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n' },
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'remote-head\n' },
    'git rev-list --left-right --count HEAD...remote-head': { stdout: '1\t1\n' },
  });
  try {
    const result = syncCodexDispatchBridge({
      repoRoot,
      workspaceRoot,
      expectedPreservationPaths: { repoRoot, workspaceRoot },
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      preservationProfile: 'battle-bridge-runtime-data-v1',
      preservationApproval: 'operator-approved',
      spawnSyncFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE');
    for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
      assert.equal(existsSync(path.join(repoRoot, relativePath)), true);
    }
    assert.equal(existsSync(path.join(workspaceRoot, 'preserved-source-dirt')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('direct diagnostics fail closed when Git and endpoint health pass but worker evidence is absent', async () => {
  const spawnSyncFn = scriptedSpawn({
    'git rev-parse --show-toplevel': { stdout: 'C:\\repo\n' },
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: 'abc123\n' },
    'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
    'git status --branch --untracked-files=all': { stdout: 'On branch main\nYour branch is up to date with origin/main.\n' },
    'git rev-list --left-right --count HEAD...@{upstream}': { stdout: '0\t0\n' },
  });
  const fetchFn = async (url) => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ ok: true, url }); },
  });

  const result = await runBattleBridgeDiagnostics({
    repoRoot: 'C:\\repo',
    endpoints: ['http://127.0.0.1:4173/health', 'http://127.0.0.1:8787/health'],
    platform: 'linux',
    spawnSyncFn,
    fetchFn,
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.blocker, 'WINDOWS_REQUIRED');
  assert.equal(result.fullHead, 'abc123');
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
  assert.equal(result.health.length, 2);
  assert.equal(result.execution.codexChildUsed, false);
  assert.equal(result.execution.shellPolicyDependency, false);
  assert.equal(result.safety.sourceMutationDetected, false);
  assert.equal(result.workerTelemetry.ok, false);
  assert.equal(result.operatorActionRequired, false);
});

test('direct diagnostics report live worker telemetry only when canonical evidence is present', async () => {
  const fullHead = 'a'.repeat(40);
  const nowUtc = '2026-07-31T16:00:00.000Z';
  const repository = '/repo';
  const lease = createSourceMutationLeaseRecord({
    laneId: 'lane-goal-1507-pr-1631',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    prNumber: 1631,
    branch: 'main',
    headSha: fullHead,
    ownerId: 'worker-1631',
    acquiredAtUtc: '2026-07-31T15:59:00.000Z',
    renewedAtUtc: '2026-07-31T15:59:30.000Z',
    expiresAtUtc: '2026-07-31T17:00:00.000Z',
  });
  const heartbeat = {
    schemaVersion: 'stephanos.mission-orchestrator-worker-heartbeat.v1',
    timestampUtc: '2026-07-31T15:59:30.000Z',
    repositoryRoot: repository,
    branch: 'main',
    headSha: fullHead,
    taskName: 'Stephanos Mission Orchestrator Worker',
    pid: 1631,
    launchIdentityId: '1'.repeat(64),
    workerStartedAtUtc: '2026-07-31T15:58:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
  };
  const task = {
    status: 'RUNNING',
    taskId: 'task-1631',
    goalId: '#1507',
    issueNumber: 1507,
    prNumber: 1631,
    branch: 'main',
    headSha: fullHead,
    phase: 'WINDOWS_PROOF',
    expectedNextAction: 'Collect final exact-head browser proof.',
    tests: { state: 'PASS', allGreen: true, proofRefs: ['proof/tests'] },
    checks: { state: 'PASS', allGreen: true },
    review: { state: 'PASS', allGreen: true },
  };
  const receipt = {
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    prNumber: 1631,
    branch: 'main',
    sourceHead: fullHead,
    workerId: 'worker-1631',
    workerType: 'battle-bridge',
    executionId: 'exec-1631',
    leaseKey: lease.leaseId,
    state: 'RUNNING',
    phase: 'WINDOWS_PROOF',
    sequence: 4,
    timestampUtc: '2026-07-31T15:59:45.000Z',
    heartbeatExpiresAtUtc: '2026-07-31T16:01:45.000Z',
    expectedNextAction: 'Collect final exact-head browser proof.',
    proofRefs: ['proof/tests'],
  };
  const readRecord = (filePath) => {
    if (filePath.endsWith('mission-orchestrator-worker-heartbeat.json')) return { state: 'present', value: heartbeat };
    if (filePath.endsWith('source-mutation-lease-current.json')) return { state: 'present', value: lease };
    if (filePath.endsWith('codex-dispatch/current.json')) return { state: 'present', value: task };
    if (filePath.endsWith('codex-dispatch/tasks/task-1631/result.json')) return { state: 'present', value: receipt };
    if (filePath.endsWith('battle-bridge-mailbox-receipt-index.json')) return { state: 'present', value: { recentReceipts: [receipt] } };
    return { state: 'absent', value: null };
  };
  const spawnSyncFn = scriptedSpawn({
    'git rev-parse --show-toplevel': { stdout: `${repository}\n` },
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: `${fullHead}\n` },
    'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
    'git status --branch --untracked-files=all': { stdout: 'On branch main\nYour branch is up to date with origin/main.\n' },
    'git rev-list --left-right --count HEAD...@{upstream}': { stdout: '0\t0\n' },
  });

  const result = await runBattleBridgeDiagnostics({
    repoRoot: repository,
    endpoints: [],
    spawnSyncFn,
    nowFn: () => new Date(nowUtc),
    workspaceRoot: '/telemetry-fixture',
    workerInspection: {
      ok: true,
      blocker: '',
      observation: {
        scheduledTask: {
          taskName: 'Stephanos Mission Orchestrator Worker',
          status: 'Running',
          actionMatchesCanonicalWorker: true,
        },
        process: {
          running: true,
          pid: 1631,
          taskName: 'Stephanos Mission Orchestrator Worker',
          commandLineMatchesCanonicalWorker: true,
        },
      },
    },
    readRecord,
  });

  assert.equal(result.status, 'DONE');
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.workerTelemetry.ok, true);
  assert.equal(result.workerTelemetry.workerActive, true);
  assert.equal(result.workerTelemetry.worker.pid, 1631);
  assert.equal(result.workerTelemetry.task.prNumber, 1631);
  assert.equal(result.workerTelemetry.task.headSha, fullHead);
  assert.equal(result.workerTelemetry.lease.active, true);
  assert.equal(result.workerTelemetry.latestExecutionReceipt.executionId, 'exec-1631');
  assert.equal(result.workerTelemetry.operatorActionRequired, false);
});

test('direct diagnostics treat only an exact release record as safely inactive lease evidence', async () => {
  const fullHead = 'd'.repeat(40);
  const nowUtc = '2026-07-31T16:00:00.000Z';
  const repository = '/repo';
  const lease = createSourceMutationLeaseRecord({
    laneId: 'lane-goal-1507-pr-1631',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    prNumber: 1631,
    branch: 'main',
    headSha: fullHead,
    ownerId: 'worker-1631',
    acquiredAtUtc: '2026-07-31T15:59:00.000Z',
    renewedAtUtc: '2026-07-31T15:59:30.000Z',
    expiresAtUtc: '2026-07-31T17:00:00.000Z',
  });
  const release = createSourceMutationLeaseReleaseRecord(lease, { timestampUtc: nowUtc });
  const heartbeat = {
    schemaVersion: 'stephanos.mission-orchestrator-worker-heartbeat.v1',
    timestampUtc: '2026-07-31T15:59:30.000Z',
    repositoryRoot: repository,
    branch: 'main',
    headSha: fullHead,
    taskName: 'Stephanos Mission Orchestrator Worker',
    pid: 1631,
    launchIdentityId: '2'.repeat(64),
    workerStartedAtUtc: '2026-07-31T15:58:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
  };
  const spawnSyncFn = scriptedSpawn({
    'git rev-parse --show-toplevel': { stdout: `${repository}\n` },
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: `${fullHead}\n` },
    'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
    'git status --branch --untracked-files=all': { stdout: 'On branch main\nYour branch is up to date with origin/main.\n' },
    'git rev-list --left-right --count HEAD...@{upstream}': { stdout: '0\t0\n' },
  });
  const workerInspection = {
    ok: true,
    blocker: '',
    observation: {
      scheduledTask: {
        taskName: 'Stephanos Mission Orchestrator Worker',
        status: 'Running',
        actionMatchesCanonicalWorker: true,
      },
      process: {
        running: true,
        pid: 1631,
        taskName: 'Stephanos Mission Orchestrator Worker',
        commandLineMatchesCanonicalWorker: true,
      },
    },
  };
  const readWithRelease = (releaseRecord) => (filePath) => {
    if (filePath.endsWith('mission-orchestrator-worker-heartbeat.json')) return { state: 'present', value: heartbeat };
    if (filePath.endsWith('source-mutation-lease-current.json')) return { state: 'present', value: lease };
    if (filePath.endsWith(`${release.statusId}.json`)) return { state: 'present', value: releaseRecord };
    return { state: 'absent', value: null };
  };

  const accepted = await runBattleBridgeDiagnostics({
    repoRoot: repository,
    endpoints: [],
    spawnSyncFn,
    nowFn: () => new Date(nowUtc),
    workspaceRoot: '/telemetry-fixture',
    workerInspection,
    readRecord: readWithRelease(release),
  });
  assert.equal(accepted.status, 'DONE');
  assert.equal(accepted.workerTelemetry.ok, true);
  assert.equal(accepted.workerTelemetry.workerStatus, 'IDLE');
  assert.equal(accepted.workerTelemetry.lease.active, false);
  assert.equal(accepted.workerTelemetry.lease.released, true);
  assert.equal(accepted.workerTelemetry.lease.releaseRecordValid, true);
  assert.deepEqual(accepted.workerTelemetry.blockers, []);

  const rejected = await runBattleBridgeDiagnostics({
    repoRoot: repository,
    endpoints: [],
    spawnSyncFn: scriptedSpawn({
      'git rev-parse --show-toplevel': { stdout: `${repository}\n` },
      'git branch --show-current': { stdout: 'main\n' },
      'git rev-parse HEAD': { stdout: `${fullHead}\n` },
      'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
      'git status --branch --untracked-files=all': { stdout: 'On branch main\nYour branch is up to date with origin/main.\n' },
      'git rev-list --left-right --count HEAD...@{upstream}': { stdout: '0\t0\n' },
    }),
    nowFn: () => new Date(nowUtc),
    workspaceRoot: '/telemetry-fixture',
    workerInspection,
    readRecord: readWithRelease({ ...release, headSha: 'e'.repeat(40) }),
  });
  assert.equal(rejected.workerTelemetry.ok, false);
  assert.ok(rejected.workerTelemetry.blockers.includes('SOURCE_MUTATION_LEASE_RELEASE_RECORD_INVALID'));
  assert.equal(rejected.workerTelemetry.lease.released, false);
});
