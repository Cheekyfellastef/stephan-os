import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  classifyUpdateDirt,
  compareUpdateDirt,
  updateStephanosFromChat,
} from './stephanosChatUpdate.mjs';
import { runStephanChatUpdateCli } from '../../scripts/stephanos-chat-update.mjs';

function health(fullHead, servedCommit = fullHead.slice(0, 8)) {
  return {
    ok: true,
    status: 'DONE',
    verdict: 'PASS',
    fullHead,
    health: [{
      url: 'http://127.0.0.1:4173/__stephanos/health',
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: true, gitCommit: servedCommit, runtimeMarker: `live::${servedCommit}`, intendedMode: 'launcher-root' }),
      error: '',
    }],
  };
}

function scriptedSpawn({ before = '', after = before, ignitionStatus = 0 } = {}) {
  let statusReads = 0;
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'git' && args[0] === 'status') {
      const stdout = statusReads === 0 ? before : after;
      statusReads += 1;
      return { status: 0, stdout, stderr: '', signal: null };
    }
    if (command === process.execPath && basename(args[0]) === 'run-battle-bridge-ignition.mjs') {
      return { status: ignitionStatus, stdout: 'bounded ignition proof', stderr: '', signal: null };
    }
    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('chat update requires explicit operator approval before sync or runtime control', async () => {
  let syncCalled = false;
  const result = await updateStephanosFromChat({
    operatorApproval: '',
    syncFn: () => { syncCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(syncCalled, false);
  assert.equal(result.nextOperatorAction.includes('explicitly approve'), true);
});

test('chat update stops safely when fast-forward sync is blocked', async () => {
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    operatorApproval: 'operator-approved',
    syncFn: () => ({ ok: false, status: 'BLOCKED', blocker: 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE' }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE');
  assert.equal(result.runtimeRefreshAttempted, false);
  assert.equal(result.operatorPowerShellRequired, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update fast-forwards, runs the canonical ignition entry, and proves exact-head runtime without manual PowerShell', async () => {
  const head = '443e3bcb6f6da050961b881160f7d5a4ca463fee';
  const diagnostics = [health(head), health(head)];
  const spawnSyncFn = scriptedSpawn({
    before: ' M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
    after: ' M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
  });
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnSyncFn,
    syncFn: () => ({ ok: true, status: 'DONE', verdict: 'PASS', afterHead: head, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.servedUiProof.exactHead, true);
  assert.equal(result.sourceHeadUnchangedDuringRefresh, true);
  assert.equal(result.dirtDelta.sourceMutationDetected, false);
  assert.equal(result.operatorPowerShellRequired, false);
  assert.equal(result.codexChildUsed, false);
  assert.equal(result.processControlPerformed, true);
  const ignitionCall = spawnSyncFn.calls.find((call) => call.command === process.execPath);
  assert.ok(ignitionCall);
  assert.equal(basename(ignitionCall.args[0]), 'run-battle-bridge-ignition.mjs');
  assert.equal(spawnSyncFn.calls.some((call) => /powershell/i.test(call.command)), false);
});

test('chat update fails closed when the served runtime is not exact-head', async () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const diagnostics = [health(head, 'aaaaaaaa'), health(head, 'bbbbbbbb')];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn(),
    syncFn: () => ({ ok: true, afterHead: head, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SERVED_RUNTIME_NOT_EXACT_HEAD');
});

test('chat update blocks newly changed source dirt while allowing runtime dirt changes to be reported separately', async () => {
  const head = 'cccccccccccccccccccccccccccccccccccccccc';
  const diagnostics = [health(head), health(head)];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ before: '', after: ' M scripts/unsafe.mjs\n M apps/stephanos/dist/index.html\n' }),
    syncFn: () => ({ ok: true, afterHead: head, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'SOURCE_DIRT_CHANGED_DURING_UPDATE');
  assert.equal(result.dirtDelta.sourceMutationDetected, true);
});

test('runtime and source dirt classification remains deterministic', () => {
  const dreamRuntime = [
    '?? memory/.dreams/events.jsonl',
    '?? memory/.dreams/session-ingestion.json',
    '?? memory/dreaming/deep/2026-07-16.md',
    '?? memory/dreaming/light/2026-07-16.md',
    '?? memory/dreaming/rem/2026-07-16.md',
  ].join('\n');
  const before = classifyUpdateDirt(` M apps/stephanos/dist/index.html\n M scripts/source.mjs\n${dreamRuntime}\n`);
  const after = classifyUpdateDirt(` M apps/stephanos/dist/index.html\n M scripts/source.mjs\n${dreamRuntime}\n?? data/activity/events.json\n`);
  const delta = compareUpdateDirt(before, after);
  assert.equal(delta.sourceMutationDetected, false);
  assert.equal(delta.runtimeMutationDetected, true);
  assert.deepEqual(
    before.runtime.filter((path) => path.startsWith('memory/')),
    [
      'memory/.dreams/events.jsonl',
      'memory/.dreams/session-ingestion.json',
      'memory/dreaming/deep/2026-07-16.md',
      'memory/dreaming/light/2026-07-16.md',
      'memory/dreaming/rem/2026-07-16.md',
    ],
  );
  assert.deepEqual(classifyUpdateDirt('?? memory/source-contract.md\n').source, ['memory/source-contract.md']);
});

test('Codex Remote CLI maps update intent to the guarded update operation and does not require PowerShell', async () => {
  let received = null;
  const result = await runStephanChatUpdateCli(['update', '--operator-approved'], {
    updateFn: async (args) => { received = args; return { ok: true, status: 'DONE', verdict: 'PASS' }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received, { operatorApproval: 'operator-approved', expectedBranch: 'main' });
});
