import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS,
  MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS,
  createFixedPostSyncRuntimeAdapter,
} from './battle-bridge-post-sync-refresh.mjs';
import {
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

const HEAD = 'a'.repeat(40);
const paths = {
  repoRoot: 'C:\\repo',
  restartScript: 'C:\\repo\\scripts\\windows\\restart-approved-stephanos-runtime.ps1',
};

function successPayload() {
  return JSON.stringify({
    ok: true,
    blocker: '',
    sourceHead: HEAD,
    exactHeadProofOk: true,
    proofKind: 'test',
    canonicalActionVerified: true,
    unrelatedTasksChanged: false,
  });
}

test('post-sync restart coordinator delivery selects the existing Mission Worker target', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-post-sync-refresh.mjs',
    'scripts/battle-bridge-worker-watchdog-post-sync-deadline.test.mjs',
  ]);

  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.noRuntimePathCount, 1);
});

test('post-sync mission-worker restart binds child lifetime to the same bounded deadline while backend remains unchanged', () => {
  const calls = [];
  const spawnSyncFn = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    return { status: 0, stdout: `${successPayload()}\n`, stderr: '' };
  };
  const adapter = createFixedPostSyncRuntimeAdapter({ spawnSyncFn });

  const before = Date.now();
  const workerResult = adapter.restartApprovedTarget({ target: 'mission-worker', afterHead: HEAD, paths });
  const after = Date.now();
  const backendResult = adapter.restartApprovedTarget({ target: 'backend', afterHead: HEAD, paths });

  assert.equal(workerResult.ok, true);
  assert.equal(backendResult.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS, 90_000);
  assert.equal(MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS, 10_000);

  const workerArgs = calls[0].args;
  const deadlineIndex = workerArgs.indexOf('-DeadlineUtc');
  assert.ok(deadlineIndex >= 0);
  assert.equal(workerArgs.filter((value) => value === '-DeadlineUtc').length, 1);
  const deadlineMs = Date.parse(workerArgs[deadlineIndex + 1]);
  assert.ok(Number.isFinite(deadlineMs));
  assert.ok(deadlineMs >= before + MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS - 1_000);
  assert.ok(deadlineMs <= after + MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS + 1_000);
  assert.equal(workerArgs[workerArgs.indexOf('-Target') + 1], 'mission-worker');
  assert.equal(workerArgs[workerArgs.indexOf('-ExpectedHead') + 1], HEAD);

  const workerChildTimeoutMs = calls[0].options.timeout;
  assert.ok(workerChildTimeoutMs >= MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS + MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS - 1_000);
  assert.ok(workerChildTimeoutMs <= MISSION_WORKER_POST_SYNC_RESTART_BUDGET_MS + MISSION_WORKER_POST_SYNC_CHILD_EXIT_RESERVE_MS);
  assert.ok(workerChildTimeoutMs < 240_000);

  assert.equal(calls[1].args.includes('-DeadlineUtc'), false);
  assert.equal(calls[1].args[calls[1].args.indexOf('-Target') + 1], 'backend');
  assert.equal(calls[1].options.timeout, 240_000);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[1].command, 'powershell.exe');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});
