import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_MARKER,
  SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_SCHEMA,
  runSovereignCommanderPowercutBootHardening,
} from '../../scripts/sovereign-commander-powercut-boot-hardening.mjs';

const HEAD = 'a'.repeat(40);

function provenReceipt() {
  return {
    schemaVersion: 'stephanos.sovereign-boot-daemon-bootstrap.v1',
    ok: true,
    finalVerdict: 'SOVEREIGN_BOOT_DAEMON_TASKS_INSTALLED_AND_PROVEN',
    blocker: '',
    expectedHead: HEAD,
    oneTimeElevationOnly: true,
    standingElevatedTaskCreated: false,
    pcRestartAuthority: false,
    sourceMutationAllowed: false,
    tasks: [
      { taskName: 'Stephanos Sovereign Commander', bootSafe: true },
      { taskName: 'Stephanos Battle Bridge Recovery Mesh', bootSafe: true },
      { taskName: 'Stephanos Battle Bridge Recovery Mesh Guardian', bootSafe: true },
    ],
  };
}

test('power-cut hardening derives exact main head and invokes only the fixed approved bootstrap', () => {
  const calls = [];
  const result = runSovereignCommanderPowercutBootHardening({
    fileExists: () => true,
    runFixed(executable, args, timeoutMs) {
      calls.push({ executable, args, timeoutMs });
      if (args.includes('branch')) return { ok: true, status: 0, stdout: 'main\n', errorCode: '' };
      if (args.includes('rev-parse')) return { ok: true, status: 0, stdout: HEAD + '\n', errorCode: '' };
      return {
        ok: true,
        status: 0,
        stdout: JSON.stringify(provenReceipt()),
        errorCode: '',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_SCHEMA);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.bootSafeTaskCount, 3);
  assert.equal(result.expectedBootSafeTaskCount, 3);
  assert.equal(result.operatorApprovalBound, true);
  assert.equal(result.exactHeadBound, true);
  assert.equal(result.oneTimeElevationOnly, true);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.callerSelectedPathAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.pcRestartAuthority, false);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_PROVEN');

  assert.equal(calls.length, 3);
  const bootstrap = calls[2];
  assert.match(bootstrap.executable, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(bootstrap.args.includes('-OperatorApproved'));
  assert.ok(bootstrap.args.includes('-ExpectedHead'));
  assert.ok(bootstrap.args.includes(HEAD));
  assert.ok(bootstrap.args.some((arg) => /install-sovereign-boot-daemon-tasks-elevated\.ps1$/i.test(arg)));
  assert.equal(bootstrap.timeoutMs, 250_000);
  assert.equal(SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_MARKER.endsWith('RESULT='), true);
});

test('power-cut hardening refuses a non-main checkout before elevation', () => {
  const calls = [];
  const result = runSovereignCommanderPowercutBootHardening({
    fileExists: () => true,
    runFixed(executable, args, timeoutMs) {
      calls.push({ executable, args, timeoutMs });
      return { ok: true, status: 0, stdout: 'repair/branch\n', errorCode: '' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POWERCUT_BOOT_HARDENING_CANONICAL_MAIN_REQUIRED');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_POWERCUT_BOOT_HARDENING_BLOCKED');
  assert.equal(calls.length, 1);
});

test('power-cut hardening fails closed unless all three boot-safe task proofs are present', () => {
  const receipt = provenReceipt();
  receipt.tasks = receipt.tasks.slice(0, 2);
  const result = runSovereignCommanderPowercutBootHardening({
    fileExists: () => true,
    runFixed(_executable, args) {
      if (args.includes('branch')) return { ok: true, status: 0, stdout: 'main\n', errorCode: '' };
      if (args.includes('rev-parse')) return { ok: true, status: 0, stdout: HEAD + '\n', errorCode: '' };
      return { ok: true, status: 0, stdout: JSON.stringify(receipt), errorCode: '' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'POWERCUT_BOOT_HARDENING_BOOTSTRAP_UNPROVEN');
  assert.equal(result.bootSafeTaskCount, 2);
});
