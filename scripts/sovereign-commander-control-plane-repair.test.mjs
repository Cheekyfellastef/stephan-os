import test from 'node:test';
import assert from 'node:assert/strict';

import { runSovereignCommanderControlPlaneRepair, sovereignControlPlaneGamingSafeV1 } from './sovereign-commander-control-plane-repair.mjs';

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

function idleGovernor(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    governorVersion: 3, phase: 'NORMAL', active: false,
    flatGameActive: false, airLinkActive: false,
    realAirLinkActive: false, virtualAirLinkTestActive: false,
    prepareLeaseActive: false, updatedAtUtc: '2026-10-20T20:00:00.000Z',
    ...overrides,
  });
}
function fileStat(overrides = {}) {
  return { isFile: () => true, isSymbolicLink: () => false, size: 320, ...overrides };
}
const NOW = Date.parse('2026-10-20T20:00:04.000Z');

test('unattended Windows guardian needs fresh exact governor evidence', () => {
  const input = { workspaceRoot: 'C:\\test', nowMs: NOW, stat: () => fileStat() };
  assert.equal(sovereignControlPlaneGamingSafeV1({
    ...input, read: () => idleGovernor(),
  }), true);
  for (const overrides of [
    { active: true }, { phase: 'GAMING' }, { flatGameActive: true },
    { airLinkActive: true }, { realAirLinkActive: true },
    { virtualAirLinkTestActive: true }, { prepareLeaseActive: true },
    { updatedAtUtc: '2026-10-20T19:59:00.000Z' },
    { updatedAtUtc: '2026-10-20T20:00:05.000Z' },
    { schemaVersion: 'unknown' }, { governorVersion: 4 },
    { active: null }, { flatGameActive: undefined },
  ]) {
    assert.equal(sovereignControlPlaneGamingSafeV1({
      ...input, read: () => idleGovernor(overrides),
    }), false, JSON.stringify(overrides));
  }
  assert.equal(sovereignControlPlaneGamingSafeV1({
    ...input, read: () => '{invalid',
  }), false);
  assert.equal(sovereignControlPlaneGamingSafeV1({
    ...input, read: () => idleGovernor(), stat: () => fileStat({ isSymbolicLink: () => true }),
  }), false);
  assert.equal(sovereignControlPlaneGamingSafeV1({
    ...input, read: () => idleGovernor(), stat: () => fileStat({ size: 32769 }),
  }), false);
  assert.equal(sovereignControlPlaneGamingSafeV1({
    ...input, read: () => { throw Error('read refused'); },
  }), false);
});

test('unattended repair rejects unproven gaming state before invoking reconciler', () => {
  let reconcilerCalls = 0;
  const repaired = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo', platform: 'win32', spawnSyncFn: spawnFor(),
    unattendedGamingGuard: true, gamingSafe: () => false,
    reconciler: () => { reconcilerCalls++; throw Error('should not execute'); },
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED');
  assert.equal(reconcilerCalls, 0);
  assert.equal(repaired.pcRestartAllowed, false);
});

test('unattended Windows repair contains a governor read exception without launching', () => {
  let called = false;
  const repaired = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo', platform: 'win32', spawnSyncFn: spawnFor(),
    unattendedGamingGuard: true,
    gamingSafe: () => { throw Error('transient state write'); },
    reconciler: () => { called = true; throw Error('must not enter'); },
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED');
  assert.equal(called, false);
});

test('unattended repair rechecks live gaming before every child launch and fails closed', () => {
  let checks = 0;
  let executed = 0;
  const repaired = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo', platform: 'win32',
    spawnSyncFn: (...args) => {
      const probe = spawnFor()(...args);
      if (probe.status === 0) return probe;
      executed++;
      return { status: 0, stdout: 'installer completed' };
    },
    unattendedGamingGuard: true,
    gamingSafe: () => ++checks === 1,
    reconciler: ({ spawnSyncFn, expectedHead }) => {
      // Simulates a game activating between the initial idle sample and
      // installer launch, not a true Windows installer.
      spawnSyncFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-File', 'fixed.ps1'], {});
      return {
        ok: true, sourceHead: expectedHead, sourceMutationAllowed: false,
        gitMutationAllowed: false, arbitraryShellAllowed: false, pcRestartAllowed: false,
      };
    },
  });
  assert.equal(repaired.ok, false);
  assert.equal(repaired.blocker, 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED');
  assert.equal(executed, 0);
  assert.equal(checks, 2);
});

test('unattended repair allows only an observed continuous idle gate', () => {
  let checks = 0;
  const repaired = runSovereignCommanderControlPlaneRepair({
    repoRoot: 'C:\\repo', platform: 'win32', spawnSyncFn: spawnFor(),
    unattendedGamingGuard: true, gamingSafe: () => { checks++; return true; },
    reconciler: ({ spawnSyncFn, expectedHead }) => {
      const child = spawnSyncFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-File', 'fixed.ps1'], {});
      assert.equal(child.status, 1); // Fixture cannot execute PowerShell.
      return {
        ok: true, sourceHead: expectedHead,
        sourceMutationAllowed: false, gitMutationAllowed: false,
        arbitraryShellAllowed: false, pcRestartAllowed: false,
      };
    },
  });
  assert.equal(repaired.ok, true);
  assert.equal(checks, 3);
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
