import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  bindCanonicalSourceTruthToOwnerApproval,
  createSupervisorHousekeepRunStep,
  captureFixedAuthorityGitStep,
  ensureBackend8787ConvergedBeforeSupervisor,
  ensureLiveUiConvergedBeforeSupervisor,
  main,
  probeCanonicalBackendHealth,
  readOwnerIgnitionApprovalFromPipe,
  runSupervisorHousekeepPreservingLiveDist,
  runSupervisorHousekeepPreservingLiveRuntime,
  writePreSupervisorFailureStatus,
} from './run-battle-bridge-ignition.mjs';
import { BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS, battleBridgeCanonicalRepositoryArgs } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA } from '../shared/agents/battleBridgeExactHeadAsyncUpdateV1.mjs';

function backendHealthResponse(sourceHead, {
  status = 200,
  schemaVersion = 'stephanos.backend-health.v1',
  runtimeId = 'stephanos-battle-bridge-backend',
} = {}) {
  return {
    status,
    async json() {
      return {
        schemaVersion,
        backendIdentity: { runtimeId, sourceHead },
      };
    },
  };
}

test('supervisor housekeeping preserves exact-head dist and runtime-owned durable memory', () => {
  const delegated = [];
  const runStepFn = (label, command, args) => {
    delegated.push({ label, command, args });
    return true;
  };

  const guarded = createSupervisorHousekeepRunStep({ runStepFn });
  guarded('git-restore-auto-generated', 'git', ['restore', '--', 'apps/stephanos/dist/index.html']);
  guarded('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
  guarded('git-restore-runtime-tracked', 'git', ['restore', '--', 'stephanos-server/data/memory/durable-memory.json']);
  guarded('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);

  assert.deepEqual(delegated.map((entry) => entry.label), []);
});

test('supervisor housekeeping injects the live-runtime-preserving run step into the existing housekeeper', () => {
  const delegated = [];
  let receivedOptions = null;
  const housekeepFn = (options) => {
    receivedOptions = options;
    options.runStepFn('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
    options.runStepFn('git-restore-runtime-tracked', 'git', ['restore', '--', 'stephanos-server/data/memory/durable-memory.json']);
    options.runStepFn('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);
    const move = options.moveRootOpenClawWorkspaceDirtFn({ paths: ['openclaw-workspace/attacker.txt'] });
    return { ok: true, move };
  };

  const result = runSupervisorHousekeepPreservingLiveRuntime(
    { dryRun: false, compact: true },
    {
      housekeepFn,
      runStepFn: (label) => {
        delegated.push(label);
        return true;
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    move: {
      destinationRoot: null,
      migrationDirectory: null,
      moved: [],
      skipped: [{ path: 'openclaw-workspace/attacker.txt', reason: 'recovery-lane-move-authority-disabled' }],
    },
  });
  assert.equal(receivedOptions.dryRun, false);
  assert.equal(receivedOptions.compact, true);
  assert.deepEqual(delegated, []);
  assert.equal(runSupervisorHousekeepPreservingLiveDist, runSupervisorHousekeepPreservingLiveRuntime);
});

test('owner ignition approval is accepted only from the bound one-use pipe payload', () => {
  const expectedHead = 'a'.repeat(40);
  const receiptId = 'c'.repeat(32);
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA,
    action: 'RUN_EXACT_HEAD_IGNITION',
    expectedHead,
    parentPid: 120,
    childPid: 121,
    nonce: 'b'.repeat(32),
    receiptId,
  }));
  const boundedReader = (bytes) => {
    let offset = 0;
    return (_fd, buffer, bufferOffset, length) => {
      if (offset >= bytes.length) return 0;
      const count = Math.min(length, bytes.length - offset);
      bytes.copy(buffer, bufferOffset, offset, offset + count);
      offset += count;
      return count;
    };
  };
  const valid = readOwnerIgnitionApprovalFromPipe({
    parentPid: 120,
    childPid: 121,
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: boundedReader(payload),
  });
  assert.deepEqual(valid, {
    approved: true,
    action: 'RUN_EXACT_HEAD_IGNITION',
    expectedHead,
    receiptId,
    parentPid: 120,
    childPid: 121,
  });
  const wrongParent = readOwnerIgnitionApprovalFromPipe({
    parentPid: 999,
    childPid: 121,
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: boundedReader(payload),
  });
  assert.equal(wrongParent.approved, false);
  assert.equal(wrongParent.pipePresent, true);
  assert.equal(wrongParent.reason, 'OWNER_IGNITION_APPROVAL_BINDING_INVALID');
  const wrongType = readOwnerIgnitionApprovalFromPipe({
    fstatFn: () => ({ isFIFO: () => false, isSocket: () => false }),
    readSyncFn: () => { throw new Error('non-pipe must never be read'); },
  });
  assert.equal(wrongType.reason, 'OWNER_IGNITION_APPROVAL_PIPE_TYPE_INVALID');
  const oversized = readOwnerIgnitionApprovalFromPipe({
    parentPid: 120,
    childPid: 121,
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: boundedReader(Buffer.alloc(4097, 0x61)),
  });
  assert.equal(oversized.reason, 'OWNER_IGNITION_APPROVAL_FRAME_INVALID');
  const absentError = Object.assign(new Error('descriptor absent'), { code: 'EBADF' });
  assert.equal(readOwnerIgnitionApprovalFromPipe({ fstatFn: () => { throw absentError; } }), null);
  assert.equal(readOwnerIgnitionApprovalFromPipe({
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: () => 0,
  }).reason, 'OWNER_IGNITION_APPROVAL_FRAME_INVALID');
  assert.equal(readOwnerIgnitionApprovalFromPipe({
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: boundedReader(Buffer.from('{"schemaVersion":')),
  }).reason, 'OWNER_IGNITION_APPROVAL_JSON_INVALID');
  assert.equal(readOwnerIgnitionApprovalFromPipe({
    fstatFn: () => ({ isFIFO: () => true, isSocket: () => false }),
    readSyncFn: () => { throw new Error('read failed'); },
  }).reason, 'OWNER_IGNITION_APPROVAL_READ_FAILED');
});

test('fixed authority Git capture prepends the canonical isolation config', () => {
  const calls = [];
  const result = captureFixedAuthorityGitStep('source-status', 'git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ], {
    cwd: 'C:\\repo',
    env: { GIT_CONFIG_NOSYSTEM: '1' },
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.stdout, '');
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.git);
  assert.deepEqual(calls[0].args, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    ...battleBridgeCanonicalRepositoryArgs('C:\\repo'),
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching',
  ]);
  assert.equal(calls[0].options.shell, false);
});

test('backend startup source tolerates exact runtime memory plus unstaged modified/deleted generated dist with fixed Node command forms', async () => {
  const starter = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  assert.match(starter, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(starter, /\$runtimeDistPrefix = 'apps\/stephanos\/dist\/'/);
  assert.match(starter, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(starter, /function Test-RuntimeUiDistStatus[\s\S]*\$Status -eq ' M' -or \$Status -eq ' D'/);
  assert.match(starter, /Test-RuntimeUiDistStatus -Status \$status[\s\S]*\$path\.StartsWith\(\$runtimeDistPrefix, \[System\.StringComparison\]::Ordinal\)/);
  assert.match(starter, /Backend startup requires source-tracked files to be unmodified at exact head/);
  assert.match(starter, /runtimeMemoryDirtTolerated = \$RuntimeMemoryDirty/);
  assert.match(starter, /runtimeDistDirtTolerated = \$RuntimeDistDirty/);
  assert.match(starter, /trackedWorktreeClean = -not \(\$RuntimeMemoryDirty -or \$RuntimeDistDirty\)/);
  assert.match(starter, /sourceWorktreeClean = \$true/);
  assert.match(starter, /-replace '\\s\+', ' '/);
  assert.match(starter, /'node stephanos-server\/server\.js'/);
  assert.match(starter, /'node\.exe stephanos-server\/server\.js'/);
  assert.match(starter, /function Convert-ProcessCreationDateToUtcText[\s\S]*CreationDate -is \[DateTime\][\s\S]*ManagementDateTimeConverter\]::ToDateTime/);
  assert.match(starter, /Convert-ProcessCreationDateToUtcText -CreationDate \$process\.CreationDate/);
  assert.doesNotMatch(starter, /ManagementDateTimeConverter\]::ToDateTime\(\[string\]\$process\.CreationDate\)/);
  assert.doesNotMatch(starter, /CommandLine -match|Invoke-Expression|Start-Process[^\n]*-ArgumentList[^\n]*\$CommandLine/i);
  assert.doesNotMatch(starter, /Stop-Process|taskkill|wmic\s+process/i);
});

test('canonical backend health probe accepts only the fixed runtime identity with a valid source head', async () => {
  const head = 'a'.repeat(40);
  const clean = await probeCanonicalBackendHealth({ fetchFn: async () => backendHealthResponse(head) });
  assert.equal(clean.canonical, true);
  assert.equal(clean.sourceHead, head);

  const foreign = await probeCanonicalBackendHealth({
    fetchFn: async () => backendHealthResponse(head, { runtimeId: 'other-backend' }),
  });
  assert.equal(foreign.canonical, false);
  assert.equal(foreign.sourceHead, '');

  const malformed = await probeCanonicalBackendHealth({ fetchFn: async () => backendHealthResponse('not-a-sha') });
  assert.equal(malformed.canonical, false);
});

test('backend preflight success never invokes approved restart or health fallback', async () => {
  const calls = [];
  let fetchCalls = 0;
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    runStepFn: (label, command, args) => {
      calls.push({ label, command, args });
      return true;
    },
    currentHeadFn: () => 'b'.repeat(40),
    fetchFn: async () => {
      fetchCalls += 1;
      return backendHealthResponse('a'.repeat(40));
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'backend-preflight-pass');
  assert.equal(result.restartAttempted, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'backend-8787-preflight');
  assert.equal(fetchCalls, 0);
});

test('failed preflight delegates a proven stale canonical backend only to the approved exact-head restart primitive', async () => {
  const oldHead = 'a'.repeat(40);
  const currentHead = 'b'.repeat(40);
  const calls = [];
  const health = [backendHealthResponse(oldHead), backendHealthResponse(currentHead)];
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    currentHeadFn: () => currentHead,
    fetchFn: async () => health.shift(),
    runStepFn: (label, command, args) => {
      calls.push({ label, command, args });
      return label === 'backend-8787-approved-stale-restart';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'backend-approved-stale-restart-pass');
  assert.equal(result.replacedSourceHead, oldHead);
  assert.equal(result.currentHead, currentHead);
  assert.equal(result.restartAttempted, true);
  assert.deepEqual(calls.map((entry) => entry.label), [
    'backend-8787-preflight',
    'backend-8787-approved-stale-restart',
  ]);
  assert.equal(calls[1].command, BATTLE_BRIDGE_WINDOWS_HOST.powershell);
  assert.ok(calls[1].args.some((arg) => String(arg).replace(/\\/g, '/').endsWith('/scripts/windows/restart-approved-stephanos-runtime.ps1')));
  assert.deepEqual(calls[1].args.slice(-6), ['-Target', 'backend', '-ExpectedHead', currentHead, '-TimeoutSeconds', '90']);
});

test('same-head or noncanonical 8787 failures remain fail closed without restart authority', async () => {
  const currentHead = 'b'.repeat(40);
  for (const fixture of [
    {
      response: backendHealthResponse(currentHead),
      blocker: 'BACKEND_8787_SAME_HEAD_PREFLIGHT_FAILED',
    },
    {
      response: backendHealthResponse('a'.repeat(40), { runtimeId: 'foreign-runtime' }),
      blocker: 'BACKEND_8787_STALE_LISTENER_NOT_QUALIFIED',
    },
  ]) {
    const calls = [];
    const result = await ensureBackend8787ConvergedBeforeSupervisor({
      platform: 'win32',
      currentHeadFn: () => currentHead,
      fetchFn: async () => fixture.response,
      runStepFn: (label, command, args) => {
        calls.push({ label, command, args });
        return false;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.blocker);
    assert.equal(result.restartAttempted, false);
    assert.deepEqual(calls.map((entry) => entry.label), ['backend-8787-preflight']);
  }
});

test('approved restart must produce exact-current backend health before Ignition proceeds', async () => {
  const oldHead = 'a'.repeat(40);
  const currentHead = 'b'.repeat(40);
  const health = [backendHealthResponse(oldHead), backendHealthResponse(oldHead)];
  const result = await ensureBackend8787ConvergedBeforeSupervisor({
    platform: 'win32',
    currentHeadFn: () => currentHead,
    fetchFn: async () => health.shift(),
    runStepFn: (label) => label === 'backend-8787-approved-stale-restart',
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BACKEND_8787_APPROVED_RESTART_EXACT_HEAD_PROOF_FAILED');
  assert.equal(result.restartAttempted, true);
});

test('Recovery Mesh shares the exact runtime-memory, generated-dist and backend listener identity rules', async () => {
  const probe = await readFile(new URL('./windows/probe-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
  assert.match(probe, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(probe, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(probe, /function Test-RuntimeUiDistStatus[\s\S]*\$Status -eq ' M' -or \$Status -eq ' D'/);
  assert.match(probe, /Test-RuntimeUiDistStatus -Status \$status[\s\S]*\$path\.StartsWith\(\$runtimeUiDistPrefix/);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_SOURCE_WORKTREE_DIRTY/);
  assert.match(probe, /runtimeMemoryDirtTolerated = \[bool\]\$afterWorktree\.RuntimeMemoryDirty/);
  assert.match(probe, /sourceWorktreeClean = \$true/);
  assert.match(probe, /\$receiptSourceClean/);
  assert.match(probe, /\$receiptTrackedTruth/);
  assert.match(probe, /-replace '\\s\+', ' '/);
  assert.match(probe, /'node stephanos-server\/server\.js'/);
  assert.match(probe, /'node\.exe stephanos-server\/server\.js'/);
  assert.match(probe, /function Convert-ProcessCreationDateToUtcText[\s\S]*CreationDate -is \[DateTime\][\s\S]*ManagementDateTimeConverter\]::ToDateTime/);
  assert.match(probe, /Convert-ProcessCreationDateToUtcText -CreationDate \$process\.CreationDate/);
  assert.doesNotMatch(probe, /ManagementDateTimeConverter\]::ToDateTime\(\[string\]\$process\.CreationDate\)/);
  assert.doesNotMatch(probe, /CommandLine -match|Invoke-Expression/i);
});

test('pre-supervisor failures publish a fresh terminal red ignition record instead of leaving the launcher blue', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'stephanos-pre-supervisor-'));
  try {
    const result = await writePreSupervisorFailureStatus({
      sharedWorkspace: workspace,
      phase: 'backend 8787',
      blockerId: 'backend-preflight-test-blocker',
      detail: 'backend preflight failed before supervisor start',
      nextOperatorAction: 'repair the backend preflight, then retry Ignition',
    });
    const status = JSON.parse(await readFile(result.statusPath, 'utf8'));
    assert.equal(status.trafficLight, 'red');
    assert.equal(status.currentPhase, 'backend 8787');
    assert.equal(status.blockerId, 'backend-preflight-test-blocker');
    assert.equal(status.phases['backend 8787'].state, 'blocked');
    assert.match(status.nextOperatorAction, /retry Ignition/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('canonical source truth blocks the click path before backend, UI, or supervisor mutation', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-ignition-source-gate-'));
  const previousArgs = process.argv;
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      approvalFn: () => null,
      sourceTruthFn: () => ({
        branch: 'main',
        detachedHead: false,
        hasUpstream: true,
        upstreamBranch: 'origin/main',
        workingTreeDirty: false,
        aheadCount: 1,
        behindCount: 1,
        headPublished: false,
        blockedForRemoteTruth: true,
        publicationState: 'diverged',
        head: 'a'.repeat(40),
        originHead: 'b'.repeat(40),
      }),
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(calls, []);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.phases['source truth'].state, 'blocked');
    assert.equal(status.blockerId, 'source-head-truth-unproven');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('wrapper and standalone supervisor share the same canonical source collector', async () => {
  const sourceTruthFn = () => ({
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head: 'a'.repeat(40),
    originHead: 'a'.repeat(40),
  });
  let supervisorOptions = null;
  const exitCode = await main({
    platform: 'linux',
    approvalFn: () => null,
    sourceTruthFn,
    uiPreflightFn: async () => {},
    supervisorFn: async (options) => {
      supervisorOptions = options;
      return { ok: true };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(supervisorOptions.sourceTruthFn, sourceTruthFn);
  assert.equal(typeof supervisorOptions.housekeepFn, 'function');
});

test('one-use owner approval re-proves source immediately before backend mutation', async () => {
  const expectedHead = 'a'.repeat(40);
  const changedHead = 'b'.repeat(40);
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-owner-preflight-source-'));
  const previousArgs = process.argv;
  let sourceCalls = 0;
  const canonicalTruth = (head) => ({
    ok: true,
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head,
    originHead: head,
  });
  const approval = {
    approved: true,
    action: 'RUN_EXACT_HEAD_IGNITION',
    expectedHead,
    receiptId: 'c'.repeat(32),
    parentPid: 120,
    childPid: 121,
  };
  const sourceTruthFn = () => canonicalTruth(sourceCalls++ === 0 ? expectedHead : changedHead);
  const bound = bindCanonicalSourceTruthToOwnerApproval({ sourceTruthFn, approval });
  assert.equal(bound().head, expectedHead);
  assert.equal(bound().blocker.id, 'owner-ignition-exact-head-mismatch');

  sourceCalls = 0;
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      approvalFn: () => approval,
      currentHeadFn: () => expectedHead,
      sourceTruthFn,
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(exitCode, 2);
    assert.equal(sourceCalls, 2);
    assert.deepEqual(calls, []);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.blockerId, 'owner-ignition-exact-head-mismatch');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('one-use owner approval re-proves source again before UI mutation', async () => {
  const expectedHead = 'a'.repeat(40);
  const changedHead = 'b'.repeat(40);
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-owner-ui-source-'));
  const previousArgs = process.argv;
  const approval = {
    approved: true,
    action: 'RUN_EXACT_HEAD_IGNITION',
    expectedHead,
    receiptId: 'c'.repeat(32),
    parentPid: 120,
    childPid: 121,
  };
  const heads = [expectedHead, expectedHead, changedHead];
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      approvalFn: () => approval,
      currentHeadFn: () => expectedHead,
      sourceTruthFn: () => ({
        ok: true,
        branch: 'main',
        detachedHead: false,
        hasUpstream: true,
        upstreamBranch: 'origin/main',
        workingTreeDirty: false,
        aheadCount: 0,
        behindCount: 0,
        headPublished: true,
        blockedForRemoteTruth: false,
        publicationState: 'healthy-synced',
        head: heads.shift(),
        originHead: heads.length === 0 ? changedHead : expectedHead,
      }),
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(calls, ['backend']);
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('present invalid approval pipe blocks while a truly absent descriptor preserves direct Ignition', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-invalid-owner-pipe-'));
  const previousArgs = process.argv;
  const calls = [];
  const canonicalTruth = {
    branch: 'main', detachedHead: false, hasUpstream: true, upstreamBranch: 'origin/main',
    workingTreeDirty: false, aheadCount: 0, behindCount: 0, headPublished: true,
    blockedForRemoteTruth: false, publicationState: 'healthy-synced',
    head: 'a'.repeat(40), originHead: 'a'.repeat(40),
  };
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const invalidExit = await main({
      platform: 'linux',
      approvalFn: () => ({
        approved: false,
        pipePresent: true,
        blocker: 'OWNER_IGNITION_APPROVAL_INVALID',
        reason: 'OWNER_IGNITION_APPROVAL_JSON_INVALID',
      }),
      sourceTruthFn: () => { calls.push('source'); return canonicalTruth; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(invalidExit, 1);
    assert.deepEqual(calls, []);

    const directExit = await main({
      platform: 'linux',
      approvalFn: () => null,
      sourceTruthFn: () => { calls.push('source'); return canonicalTruth; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(directExit, 0);
    assert.deepEqual(calls, ['source', 'ui', 'supervisor']);
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('owner current-head read failure publishes red source truth and invokes no mutator', async () => {
  const sharedWorkspace = await mkdtemp(path.join(tmpdir(), 'bb-owner-head-read-'));
  const previousArgs = process.argv;
  const calls = [];
  process.argv = [previousArgs[0], previousArgs[1], '--shared-workspace', sharedWorkspace];
  try {
    const exitCode = await main({
      platform: 'win32',
      approvalFn: () => ({
        approved: true,
        action: 'RUN_EXACT_HEAD_IGNITION',
        expectedHead: 'a'.repeat(40),
        receiptId: 'c'.repeat(32),
        parentPid: 120,
        childPid: 121,
      }),
      currentHeadFn: () => { throw new Error('fixed Git unavailable'); },
      sourceTruthFn: () => { calls.push('source'); return {}; },
      backendPreflightFn: async () => { calls.push('backend'); return { ok: true }; },
      uiPreflightFn: async () => { calls.push('ui'); },
      supervisorFn: async () => { calls.push('supervisor'); return { ok: true }; },
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(calls, []);
    const status = JSON.parse(await readFile(path.join(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json'), 'utf8'));
    assert.equal(status.trafficLight, 'red');
    assert.equal(status.blockerId, 'owner-ignition-current-head-unproven');
    assert.equal(status.phases['source truth'].state, 'blocked');
  } finally {
    process.argv = previousArgs;
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('canonical ignition pins repository-sensitive housekeeping to the source-derived repo root', async () => {
  const entry = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');
  assert.match(entry, /const repoRoot = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)/);
  assert.match(entry, /export async function main[\s\S]*process\.chdir\(repoRoot\)/);
  assert.match(entry, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(entry, /'-Target',[\s\S]*'backend',[\s\S]*'-ExpectedHead',[\s\S]*currentHead/);
  assert.doesNotMatch(entry, /Stop-Process|taskkill|wmic\s+process|Invoke-Expression/i);
  assert.doesNotMatch(entry, /process\.chdir\([^)]*process\.argv|process\.chdir\([^)]*env/i);
});

test('second press reuses an existing exact-head UI without spawning another refresh', async () => {
  const refreshCalls = [];
  const proof = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => proof,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'reuse-exact-head-ui');
  assert.equal(result.after, proof);
  assert.equal(refreshCalls.length, 0);
});

test('live stale UI uses the bounded refresh helper and must converge before supervisor starts', async () => {
  const refreshCalls = [];
  const before = { reachable: true, ready: false, currentHead: 'abc1234', proof: { ready: false } };
  const after = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };

  const result = await ensureLiveUiConvergedBeforeSupervisor({
    platform: 'win32',
    probeFn: async () => before,
    waitFn: async () => after,
    runStepFn: (label, command, args) => {
      refreshCalls.push({ label, command, args });
      return true;
    },
  });

  assert.equal(result.action, 'refreshed-stale-ui');
  assert.equal(result.after, after);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].label, 'refresh-stale-ui-4173');
  assert.equal(refreshCalls[0].command, process.execPath);
  assert.equal(refreshCalls[0].args.length, 1);
  assert.match(refreshCalls[0].args[0].replace(/\\/g, '/'), /scripts\/refresh-stephanos-ui-4173\.mjs$/);
});

test('cold start remains delegated to the complete existing supervisor flow', async () => {
  const refreshCalls = [];
  const before = { reachable: false, ready: false, currentHead: 'abc1234', error: 'connection refused' };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => before,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'defer-cold-start-to-supervisor');
  assert.equal(refreshCalls.length, 0);
});

test('stale refresh without exact-head convergence fails closed', async () => {
  await assert.rejects(
    ensureLiveUiConvergedBeforeSupervisor({
      platform: 'win32',
      probeFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234' }),
      waitFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234', error: 'still stale' }),
      runStepFn: () => true,
    }),
    /without exact-head browser proof/,
  );
});
