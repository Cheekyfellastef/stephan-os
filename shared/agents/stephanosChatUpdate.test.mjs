import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import {
  classifyUpdateDirt,
  collectStephanosRuntimeEndpointDiagnostics,
  compareUpdateDirt,
  evaluateRuntimeProofAttempt,
  updateStephanosFromChat,
} from './stephanosChatUpdate.mjs';
import { runStephanChatUpdateCli } from '../../scripts/stephanos-chat-update.mjs';

function health(fullHead, servedCommit = fullHead, {
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
        body: JSON.stringify({
          ok: true,
          service: 'stephanos-dist-server',
          gitCommit: servedCommit,
          runtimeMarker: `antifriction-live-v3::${servedCommit}::fixture`,
          intendedMode: 'launcher-root',
        }),
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

function scriptedSpawn({
  before = '',
  after = before,
  ignitionStatus = 0,
  head = '',
  branch = 'main',
  statusReadError = -1,
  headSequence = null,
  trackedVisibility = 'H scripts/source.mjs\n',
} = {}) {
  let statusReads = 0;
  let headReads = 0;
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'git' && args[0] === 'status') {
      const stdout = statusReads === 0 ? before : after;
      if (statusReads === statusReadError) {
        statusReads += 1;
        return { status: 1, stdout: '', stderr: 'status failed', signal: null };
      }
      statusReads += 1;
      return { status: 0, stdout, stderr: '', signal: null };
    }
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
      const observedHead = Array.isArray(headSequence)
        ? (headSequence[Math.min(headReads, headSequence.length - 1)] || '')
        : head;
      headReads += 1;
      return { status: 0, stdout: `${observedHead}\n`, stderr: '', signal: null };
    }
    if (command === 'git' && args[0] === 'branch' && args[1] === '--show-current') {
      return { status: 0, stdout: `${branch}\n`, stderr: '', signal: null };
    }
    if (command === 'git' && args[0] === 'ls-files' && args[1] === '-v') {
      return { status: 0, stdout: trackedVisibility, stderr: '', signal: null };
    }
    if (command === process.execPath && basename(args[0]) === 'run-battle-bridge-ignition.mjs') {
      return { status: ignitionStatus, stdout: 'bounded ignition proof', stderr: '', signal: null };
    }
    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

function commandRunnerFor(spawnSyncFn) {
  return async (command, args, options) => {
    const result = spawnSyncFn(command, args, options);
    return Object.freeze({
      command,
      args: [...args],
      ok: !result?.error && result?.status === 0,
      status: result?.status ?? null,
      signal: result?.signal ?? null,
      stdout: String(result?.stdout || '').trim(),
      stderr: String(result?.stderr || '').trim(),
      error: result?.error?.message || '',
    });
  };
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
    before: '',
    after: ' M apps/stephanos/dist/index.html\n M stephanos-server/data/memory/durable-memory.json\n',
    head,
  });
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnSyncFn,
    commandRunnerFn: commandRunnerFor(spawnSyncFn),
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
    health(head, head, { backendOk: false }),
    health(head),
  ];
  const sleeps = [];
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn: scriptedSpawn({ head }),
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
    spawnSyncFn: scriptedSpawn({ head }),
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
    spawnSyncFn: scriptedSpawn({ head, headSequence: [head, changedHead, changedHead] }),
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
    spawnSyncFn: scriptedSpawn({ before: '', after: ' M scripts/unsafe.mjs\n M apps/stephanos/dist/index.html\n', head }),
    syncFn: () => ({ ok: true, afterHead: head, updated: true, restartRequired: false }),
    diagnosticsFn: async () => diagnostics.shift(),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'SOURCE_DIRT_PRESENT_AFTER_IGNITION');
  assert.equal(result.dirtDelta.sourceMutationDetected, true);
});

test('chat update never ignites when fixed pre-ignition checkout evidence is dirty, unreadable, or on another head', async () => {
  const head = 'abababababababababababababababababababab';
  for (const [spawnSyncFn, blocker] of [
    [scriptedSpawn({ before: '!! data/activity/private-key.txt\n', head }), 'CHECKOUT_DIRTY_BEFORE_IGNITION'],
    [scriptedSpawn({ head, statusReadError: 0 }), 'PRE_IGNITION_SOURCE_STATUS_UNPROVEN'],
    [scriptedSpawn({ head: 'cd'.repeat(20) }), 'SOURCE_HEAD_CHANGED_BEFORE_REFRESH'],
  ]) {
    const result = await updateStephanosFromChat({
      repoRoot: 'C:\\repo',
      expectedHead: head,
      operatorApproval: 'operator-approved',
      spawnSyncFn,
      syncFn: () => ({ ok: true, afterHead: head, updated: false, restartRequired: false }),
      diagnosticsFn: async () => health(head),
      runtimeProofAttempts: 1,
      sleepFn: noSleep,
    });
    assert.equal(result.ok, false, blocker);
    assert.equal(result.blocker, blocker);
    assert.equal(result.runtimeRefreshAttempted, false);
    assert.equal(spawnSyncFn.calls.some((call) => basename(call.args[0] || '') === 'run-battle-bridge-ignition.mjs'), false);
  }
});

test('chat update blocks skip-worktree and assume-unchanged tracked paths before ignition', async () => {
  const head = 'ac'.repeat(20);
  for (const trackedVisibility of ['S hidden-source.mjs\n', 'h assumed-source.mjs\n']) {
    const spawnSyncFn = scriptedSpawn({ head, trackedVisibility });
    const result = await updateStephanosFromChat({
      repoRoot: 'C:\\repo',
      expectedHead: head,
      operatorApproval: 'operator-approved',
      spawnSyncFn,
      syncFn: () => ({ ok: true, afterHead: head, branch: 'main', updated: false }),
      diagnosticsFn: async () => health(head),
      runtimeProofAttempts: 1,
      sleepFn: noSleep,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'HIDDEN_TRACKED_PATHS_PRESENT');
    assert.equal(spawnSyncFn.calls.some((call) => basename(call.args[0] || '') === 'run-battle-bridge-ignition.mjs'), false);
  }
});

test('post-spawn ignition failure remains nonterminal when process-tree closure is unproven', async () => {
  const head = 'bd'.repeat(20);
  const spawnSyncFn = scriptedSpawn({ head });
  const baseRunner = commandRunnerFor(spawnSyncFn);
  let diagnosticsCalls = 0;
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    platform: 'win32',
    spawnSyncFn,
    commandRunnerFn: async (command, args, options) => {
      if (command === process.execPath && basename(args[0] || '') === 'run-battle-bridge-ignition.mjs') {
        return Object.freeze({
          ok: false,
          status: null,
          signal: 'SIGTERM',
          stdout: '',
          stderr: 'BATTLE_BRIDGE_COMMAND_TIMEOUT',
          error: 'BATTLE_BRIDGE_COMMAND_TIMEOUT',
          processTreeClosureProven: false,
          executionStateUnproven: true,
        });
      }
      return baseRunner(command, args, options);
    },
    syncFn: () => ({ ok: true, afterHead: head, branch: 'main', updated: false }),
    diagnosticsFn: async () => { diagnosticsCalls += 1; return health(head); },
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.blocker, 'IGNITION_EXECUTION_STATE_UNPROVEN');
  assert.equal(result.executionStateUnproven, true);
  assert.equal(result.processTreeClosureProven, false);
  assert.equal(diagnosticsCalls, 1, 'only the pre-ignition endpoint snapshot is allowed');
});

test('chat update fails closed when post-ignition status cannot be read', async () => {
  const head = 'edededededededededededededededededededed';
  const spawnSyncFn = scriptedSpawn({ head, statusReadError: 1 });
  const result = await updateStephanosFromChat({
    repoRoot: 'C:\\repo',
    expectedHead: head,
    operatorApproval: 'operator-approved',
    spawnSyncFn,
    syncFn: () => ({ ok: true, afterHead: head, updated: false, restartRequired: false }),
    diagnosticsFn: async () => health(head),
    runtimeProofAttempts: 1,
    sleepFn: noSleep,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POST_IGNITION_SOURCE_STATUS_UNPROVEN');
});

test('runtime proof rejects short or unbound served commit metadata', () => {
  const head = '3434343434343434343434343434343434343434';
  const shortCommit = evaluateRuntimeProofAttempt(health(head, head.slice(0, 8)), {
    preSourceHead: head,
    expectedSourceHead: head,
  });
  assert.equal(shortCommit.servedUiProof.exactHead, false);
  assert.equal(shortCommit.failedPredicates.includes('SERVED_UI_EXACT_HEAD'), true);
  const wrongMarker = health(head);
  wrongMarker.health[0].body = JSON.stringify({
    ok: true,
    service: 'stephanos-dist-server',
    gitCommit: head,
    runtimeMarker: `antifriction-live-v3::${'5'.repeat(40)}::fixture`,
    intendedMode: 'launcher-root',
  });
  assert.equal(evaluateRuntimeProofAttempt(wrongMarker, {
    preSourceHead: head,
    expectedSourceHead: head,
  }).servedUiProof.exactHead, false);
});

test('runtime proof evaluation names exact predicates and endpoint evidence', () => {
  const head = '3333333333333333333333333333333333333333';
  const result = evaluateRuntimeProofAttempt(health(head, head, { openClawOk: false }), {
    preSourceHead: head,
    expectedSourceHead: head,
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedPredicates, ['POST_DIAGNOSTICS_OK']);
  assert.equal(result.endpointEvidence.find((entry) => entry.url.includes('18789')).error, 'gateway restarting');
});

test('runtime endpoint diagnostics bound response bodies and wall-clock timeout', async () => {
  const head = '7'.repeat(40);
  const oversized = await collectStephanosRuntimeEndpointDiagnostics({
    sourceHead: head,
    endpoints: ['http://127.0.0.1:4173/oversized'],
    timeoutMs: 50,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(2501) }),
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.health[0].error, 'RUNTIME_PROOF_RESPONSE_TOO_LARGE');

  const timedOut = await collectStephanosRuntimeEndpointDiagnostics({
    sourceHead: head,
    endpoints: ['http://127.0.0.1:4173/hung'],
    timeoutMs: 5,
    fetchFn: async () => new Promise(() => {}),
  });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.health[0].error, 'RUNTIME_PROOF_RESPONSE_TIMEOUT');
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
