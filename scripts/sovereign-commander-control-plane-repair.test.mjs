import test from 'node:test';
import assert from 'node:assert/strict';

import { runSovereignCommanderControlPlaneRepair } from './sovereign-commander-control-plane-repair.mjs';

const HEAD = 'a'.repeat(40);

function spawnFor({ branch = 'main', head = HEAD } = {}) {
  return (_exe, args) => {
    const command = args.slice(-2).join(' ');
    if (command.endsWith('branch --show-current')) return { status: 0, stdout: branch + '\n', stderr: '' };
    if (command.endsWith('rev-parse HEAD')) return { status: 0, stdout: head + '\n', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
}

test('Sovereign Commander control-plane repair accepts only safe exact-main reconciliation', () => {
  const result = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo',
    platform: 'win32',
    spawnSyncFn: spawnFor(),
    reconciler: ({ expectedHead }) => ({
      ok: true,
      sourceHead: expectedHead,
      sourceMutationAllowed: false,
      gitMutationAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
      finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
});

test('Sovereign Commander control-plane repair blocks non-main checkout and authority widening', () => {
  const nonMain = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo',
    platform: 'win32',
    spawnSyncFn: spawnFor({ branch: 'feature' }),
    reconciler: () => { throw new Error('must not run'); },
  });
  assert.equal(nonMain.ok, false);
  assert.equal(nonMain.blocker, 'SOVEREIGN_COMMANDER_CANONICAL_MAIN_REQUIRED');

  const widened = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo',
    platform: 'win32',
    spawnSyncFn: spawnFor(),
    reconciler: ({ expectedHead }) => ({
      ok: true,
      sourceHead: expectedHead,
      sourceMutationAllowed: true,
      gitMutationAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
    }),
  });
  assert.equal(widened.ok, false);
  assert.equal(widened.finalVerdict, 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_BLOCKED');
});

test('actual control-plane wrapper retains raw child custody before lower projections lose it', () => {
  for (const mode of ['timeout', 'abort', 'signal', 'throw', 'buffer-error', 'reconciler-throw']) {
    let launches = 0;
    const result = runSovereignCommanderControlPlaneRepair({
      repoRoot: 'C:\\repo', platform: 'win32',
      spawnSyncFn: (exe, args) => {
        if (exe.includes('Git')) return spawnFor()(exe, args);
        launches++;
        if (mode === 'throw') throw Error('PRIVATE_RAW_ERROR');
        if (mode === 'reconciler-throw') return { status: 0, stdout: '' };
        return { status: mode === 'signal' ? 0 : mode === 'buffer-error' ? 1 : null,
          signal: mode === 'signal' ? 'SIGTERM' : '', stdout: 'PRIVATE_PARTIAL_OUTPUT',
          ...(mode === 'signal' ? {} : { error: { code: mode === 'timeout' ? 'ETIMEDOUT'
            : mode === 'abort' ? 'ABORT_ERR' : 'ENOBUFS' } }) };
      },
      reconciler: ({ spawnSyncFn, expectedHead }) => {
        spawnSyncFn('fixed-installer', []);
        if (mode === 'reconciler-throw') throw Error('PRIVATE_RECONCILER_ERROR');
        spawnSyncFn('fixed-caretaker', []); // Must never launch after lost custody.
        return { ok: true, sourceHead: expectedHead, blocker: 'GENERIC_COMPACTED_RESULT',
          sourceMutationAllowed: false, gitMutationAllowed: false, arbitraryShellAllowed: false, pcRestartAllowed: false };
      },
    });
    assert.equal(launches, 1, mode);
    assert.equal(result.ok, false, mode);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN', mode);
    assert.equal(result.executionEvidence.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    assert.equal(result.sourceMutationAllowed, false);
  }
});
