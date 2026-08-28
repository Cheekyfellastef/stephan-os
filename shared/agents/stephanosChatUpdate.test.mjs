import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  classifyUpdateDirt,
  compareUpdateDirt,
  evaluateRuntimeProofAttempt,
  updateStephanosFromChat,
} from './stephanosChatUpdate.mjs';
import { runStephanChatUpdateCli } from '../../scripts/stephanos-chat-update.mjs';

function health(fullHead, servedCommit = fullHead.slice(0, 8), {
  backendOk = true,
  openClawOk = true,
} = {}) {
  return {
    ok: backendOk && openClawOk,
    status: backendOk && openClawOk ? 'DONE' : 'FAILED',
    verdict: backendOk && openClawOk ? 'PASS' : 'FAIL',
    fullHead,
    health: [
      {
        url: 'http://127.0.0.1:4173/__stephanos/health',
        ok: true,
        status: 200,
        body: JSON.stringify({ ok: true, gitCommit: servedCommit, runtimeMarker: `live::${servedCommit}`, intendedMode: 'launcher-root' }),
        error: '',
      },
      {
        url: 'http://127.0.0.1:8787/api/health',
        ok: backendOk,
        status: backendOk ? 200 : 503,
        body: '',
        error: backendOk ? '' : 'backend restarting',
      },
      {
        url: 'http://127.0.0.1:18789/health',
        ok: openClawOk,
        status: openClawOk ? 200 : 503,
        body: '',
        error: openClawOk ? '' : 'gateway restarting',
      },
    ],
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

const noSleep = async () => {};

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

test('chat update preserves exact installed source truth when post-sync verification blocks runtime refresh', async () => {
  const head = '10ce35ad3d9542694f02e6727954b965d3de4f6b';
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    expectedHead: head,
    operatorApproval: 'operator-approved',
    syncFn: () => ({
      ok: false,
      status: 'FAILED',
      blocker: 'POST_SYNC_VERIFICATION_FAILED',
      branch: 'main',
      afterHead: head,
      tests: { ok: false, status: 1 },
    }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_FAILED');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.sourceHead, head);
  assert.equal(result.branch, 'main');
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeRefreshAttempted, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update fast-forwards, runs the canonical ignition entry, and proves exact-head runtime without manual PowerShell', async () => {
  const head = '443e3bcb6f6da050961b881160f7d5a4ca463fee';
  const diagnostics = [health(head), health(head)];
  const spawnSyncFn = scriptedSpawn({
    before: ' D apps/stephanos/dist/assets/old-build.js\n M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
    after: ' D apps/stephanos/dist/assets/old-build.js\n M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
  });
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnSyncFn,
    syncFn: () => ({ ok: true, status: 'DONE', verdict: 'PASS', afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.finalVerdict, 'SOURCE_AND_RUNTIME_EXACT_HEAD');
  assert.equal(result.servedUiProof.exactHead, true);
  assert.equal(result.sourceHeadUnchangedDuringRefresh, true);
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.runtimeProofPassed, true);
  assert.equal(result.runtimeProof.attemptCount, 1);
  assert.equal(result.dirtDelta.sourceMutationDetected, false);
  assert.deepEqual(result.dirtBefore.source, []);
  assert.deepEqual(result.dirtBefore.runtime, [
    'apps/stephanos/dist/assets/old-build.js',
    'apps/stephanos/dist/index.html',
    'stephanos-server/data/memory/durable-memory.json',
  ]);
  assert.equal(result.dirtBefore.entries[0].status, ' D');
  assert.equal(result.operatorPowerShellRequired, false);
  assert.equal(result.codexChildUsed, false);
  assert.equal(result.processControlPerformed, true);
  const ignitionCall = spawnSyncFn.calls.find((call) => call.command === process.execPath);
  assert.ok(ignitionCall);
  assert.equal(basename(ignitionCall.args[0]), 'run-battle-bridge-ignition.mjs');
  assert.equal(spawnSyncFn.calls.some((call) => /powershell/i.test(call.command)), false);
});

test('chat update retries transient runtime health failure and passes when exact-head proof settles', async () => {
  const head = 'dddddddddddddddddddddddddddddddddddddddd';
  const diagnostics = [
    health(head),
    health(head, head.slice(0, 8), { backendOk: false }),
    health(head),
  ];
  const sleeps = [];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn(),
    syncFn: () => ({ ok: true, afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 3,
    runtimeProofDelayMs: 25,
    sleepFn: async (delayMs) => { sleeps.push(delayMs); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.runtimeProof.attemptCount, 2);
  assert.deepEqual(sleeps, [25]);
  assert.equal(result.runtimeProof.attempts[0].failedPredicates.includes('POST_DIAGNOSTICS_OK'), true);
  assert.equal(result.runtimeProof.attempts[0].endpointEvidence.find((entry) => entry.url.includes('8787')).status, 503);
  assert.deepEqual(result.runtimeProof.failedPredicates, []);
});

test('chat update reports source-installed runtime-proof-pending after bounded retries instead of a hard Git failure', async () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const diagnostics = [
    health(head),
    health(head, 'bbbbbbbb'),
    health(head, 'bbbbbbbb'),
  ];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn(),
    syncFn: () => ({ ok: true, afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 2,
    runtimeProofDelayMs: 0,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.verdict, 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING');
  assert.equal(result.finalVerdict, 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING');
  assert.equal(result.blocker, '');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.sourceHead, head);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.runtimeProofPending, true);
  assert.equal(result.runtimeProof.exhausted, true);
  assert.equal(result.runtimeProof.attemptCount, 2);
  assert.equal(result.runtimeProof.failedPredicates.includes('SERVED_UI_EXACT_HEAD'), true);
  assert.equal(result.servedUiProof.endpoint.includes('4173'), true);
  assert.equal(result.nextOperatorAction.includes('Re-run bounded read-only exact-head runtime proof'), true);
});

test('chat update hard-fails when diagnostics prove source head changed during refresh', async () => {
  const head = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const changedHead = 'ffffffffffffffffffffffffffffffffffffffff';
  const diagnostics = [health(head), health(changedHead)];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn(),
    syncFn: () => ({ ok: true, afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOURCE_HEAD_CHANGED_DURING_REFRESH');
  assert.equal(result.runtimeProofPending, false);
  assert.equal(result.runtimeProof.failedPredicates.includes('SOURCE_MATCHES_SYNC'), true);
});

test('chat update blocks when the fetched head differs from the operator-approved exact head', async () => {
  const approvedHead = '1111111111111111111111111111111111111111';
  const observedHead = '2222222222222222222222222222222222222222';
  let diagnosticsCalled = false;
  const result = await updateStephanosFromChat({
    expectedHead: approvedHead,
    operatorApproval: 'operator-approved',
    syncFn: () => ({ ok: true, afterHead: observedHead, updated: true }),
    diagnosticsFn: () => { diagnosticsCalled = true; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SYNC_AFTER_HEAD_MISMATCH');
  assert.equal(result.sourceInstalled, true);
  assert.equal(result.expectedHeadMatch, false);
  assert.equal(diagnosticsCalled, false);
});

test('chat update blocks newly changed source dirt while allowing runtime dirt changes to be reported separately', async () => {
  const head = 'cccccccccccccccccccccccccccccccccccccccc';
  const diagnostics = [health(head), health(head)];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ before: '', after: ' M scripts/unsafe.mjs\n M apps/stephanos/dist/index.html\n' }),
    syncFn: () => ({ ok: true, afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'SOURCE_DIRT_CHANGED_DURING_UPDATE');
  assert.equal(result.dirtDelta.sourceMutationDetected, true);
});

test('runtime proof evaluation names exact predicates and endpoint evidence', () => {
  const head = '3333333333333333333333333333333333333333';
  const result = evaluateRuntimeProofAttempt(health(head, head.slice(0, 8), { openClawOk: false }), {
    preSourceHead: head,
    expectedSourceHead: head,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedPredicates, ['POST_DIAGNOSTICS_OK']);
  assert.equal(result.endpointEvidence.find((entry) => entry.url.includes('18789')).error, 'gateway restarting');
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
