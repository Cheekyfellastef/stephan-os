import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  executeApprovedBackendRestartOnBattleBridge,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';

const HEAD = 'a'.repeat(40);
const STALE = 'b'.repeat(40);

function command() {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'legacy-backend-migration-0001',
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-08-23T08:00:00.000Z',
  };
}

function blockedRestart() {
  return {
    schemaVersion: 'stephanos.approved-runtime-restart.v1',
    ok: false,
    blocker: 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED',
    finalVerdict: 'APPROVED_RUNTIME_RESTART_BLOCKED',
  };
}

function migrationPass(overrides = {}) {
  return {
    schemaVersion: 'stephanos.legacy-backend-listener-migration.v1',
    ok: true,
    finalVerdict: 'LEGACY_BACKEND_LISTENER_MIGRATED',
    expectedHead: HEAD,
    replacedSourceHead: STALE,
    canonicalNodeVerified: true,
    legacyCommandVerified: true,
    healthIdentityVerified: true,
    staleSourceAncestor: true,
    stableProcessIdentity: true,
    terminatedVerifiedOwnedProcess: true,
    arbitraryPidAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryCommandAllowed: false,
    arbitraryTaskAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    liveOpenClawUpdatePerformed: false,
    ...overrides,
  };
}

function runtimePass(overrides = {}) {
  return {
    schemaVersion: 'stephanos.approved-runtime-restart.v1',
    target: 'backend',
    taskName: 'Stephanos Battle Bridge Backend',
    expectedHead: HEAD,
    sourceHead: HEAD,
    exactHeadProofOk: true,
    canonicalActionVerified: true,
    proofKind: 'backend-health-and-runtime-receipt',
    proofFresh: true,
    terminatedVerifiedOwnedProcess: false,
    unrelatedTasksChanged: false,
    arbitraryTaskTargetAllowed: false,
    arbitraryProcessKillAllowed: false,
    verifiedOwnedProcessTerminationOnly: true,
    liveOpenClawUpdatePerformed: false,
    ok: true,
    finalVerdict: 'APPROVED_RUNTIME_RESTART_PASS',
    ...overrides,
  };
}

function windowsOptions(responses) {
  const calls = [];
  return {
    calls,
    options: {
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Stephan', SystemRoot: 'C:\\Windows' },
      home: 'C:\\Users\\Stephan',
      existsSyncFn: () => true,
      spawnSyncFn: (executable, args, options) => {
        calls.push({ executable, args: [...args], options: { ...options } });
        const next = responses.shift();
        return {
          status: next.status,
          stdout: `${JSON.stringify(next.payload)}\n`,
          stderr: '',
          error: null,
        };
      },
    },
  };
}

test('exact non-allowlisted legacy listener routes through one fixed migration then re-enters the existing restart primitive', async () => {
  const setup = windowsOptions([
    { status: 1, payload: blockedRestart() },
    { status: 0, payload: migrationPass() },
    { status: 0, payload: runtimePass() },
  ]);
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), setup.options);
  assert.equal(result.ok, true);
  assert.equal(result.legacyMigrationPerformed, true);
  assert.equal(result.legacyReplacedSourceHead, STALE);
  assert.equal(result.exactHeadProofOk, true);
  assert.equal(result.verifiedOwnedProcessTerminationOnly, true);
  assert.equal(result.arbitraryProcessKillAllowed, false);
  assert.equal(setup.calls.length, 3);
  assert.match(setup.calls[0].args.join(' '), /restart-approved-stephanos-runtime\.ps1\s+-Target backend\s+-ExpectedHead a{40}\s+-TimeoutSeconds 90/);
  assert.deepEqual(setup.calls[1].args, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os\\scripts\\windows\\migrate-legacy-stephanos-backend-listener-v1.ps1',
    '-ExpectedHead', HEAD,
  ]);
  assert.deepEqual(setup.calls[2].args, setup.calls[0].args);
  assert.ok(setup.calls.every((call) => call.options.shell === false && call.options.windowsHide === true));
});

test('migration is unreachable for any other restart failure', async () => {
  const setup = windowsOptions([
    { status: 1, payload: { ...blockedRestart(), blocker: 'BACKEND_TASK_ACTION_NOT_CANONICAL' } },
  ]);
  const result = await executeApprovedBackendRestartOnBattleBridge(command(), setup.options);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BACKEND_TASK_ACTION_NOT_CANONICAL');
  assert.equal(setup.calls.length, 1);
});

test('malformed, non-ancestor or widened migration proof fails closed before canonical restart re-entry', async () => {
  for (const payload of [
    migrationPass({ staleSourceAncestor: false }),
    migrationPass({ stableProcessIdentity: false }),
    migrationPass({ arbitraryPidAllowed: true }),
    migrationPass({ replacedSourceHead: HEAD }),
  ]) {
    const setup = windowsOptions([
      { status: 1, payload: blockedRestart() },
      { status: 0, payload },
    ]);
    const result = await executeApprovedBackendRestartOnBattleBridge(command(), setup.options);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'LEGACY_BACKEND_MIGRATION_PROOF_INVALID');
    assert.equal(setup.calls.length, 2);
  }
});

test('legacy migration PowerShell is a closed-world one-listener migration with exact ancestry and stable-identity gates', () => {
  const source = readFileSync(new URL('../../scripts/windows/migrate-legacy-stephanos-backend-listener-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, /ValidatePattern\('\^\[0-9a-fA-F\]\{40\}\$'\)/);
  assert.match(source, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(source, /processIds\.Count -ne 1/);
  assert.match(source, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.match(source, /node stephanos-server\/server\.js/);
  assert.match(source, /node\.exe stephanos-server\/server\.js/);
  assert.match(source, /stephanos\.backend-health\.v1/);
  assert.match(source, /stephanos-battle-bridge-backend/);
  assert.match(source, /merge-base --is-ancestor \$health\.SourceHead \$ExpectedHead/);
  assert.match(source, /listenerAfter\.ProcessId -ne \$listenerBefore\.ProcessId/);
  assert.match(source, /listenerAfter\.CreationTimeUtc -ne \$listenerBefore\.CreationTimeUtc/);
  assert.match(source, /Stop-Process -Id \$listenerAfter\.ProcessId -Force/);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|Register-ScheduledTask|Restart-Computer|shutdown\.exe/i);
  assert.doesNotMatch(source, /git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i);
});
