import test from 'node:test';
import assert from 'node:assert/strict';

import { createFixedPostSyncRuntimeAdapter } from './battle-bridge-post-sync-refresh.mjs';

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

test('post-sync mission-worker restart carries one bounded deadline while backend remains unchanged', () => {
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

  const workerArgs = calls[0].args;
  const deadlineIndex = workerArgs.indexOf('-DeadlineUtc');
  assert.ok(deadlineIndex >= 0);
  assert.equal(workerArgs.filter((value) => value === '-DeadlineUtc').length, 1);
  const deadlineMs = Date.parse(workerArgs[deadlineIndex + 1]);
  assert.ok(Number.isFinite(deadlineMs));
  assert.ok(deadlineMs >= before + 89_000);
  assert.ok(deadlineMs <= after + 91_000);
  assert.equal(workerArgs[workerArgs.indexOf('-Target') + 1], 'mission-worker');
  assert.equal(workerArgs[workerArgs.indexOf('-ExpectedHead') + 1], HEAD);

  assert.equal(calls[1].args.includes('-DeadlineUtc'), false);
  assert.equal(calls[1].args[calls[1].args.indexOf('-Target') + 1], 'backend');
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[1].command, 'powershell.exe');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});
