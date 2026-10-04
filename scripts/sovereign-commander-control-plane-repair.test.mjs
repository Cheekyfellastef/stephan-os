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
