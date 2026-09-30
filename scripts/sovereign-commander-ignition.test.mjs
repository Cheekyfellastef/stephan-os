import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureSovereignCommanderAtIgnitionWithDeps } from './ignite-stephanos-local.mjs';

function health(ok) {
  return {
    ok,
    async json() {
      return ok
        ? {
          ok: true,
          service: 'stephanos-sovereign-commander',
          vendorMeterRequired: false,
          externalSaasRelayRequired: false,
        }
        : { ok: false };
    },
  };
}

test('ignition reuses an already healthy Sovereign Commander without duplicate start', async () => {
  let launches = 0;
  const result = await ensureSovereignCommanderAtIgnitionWithDeps({
    platform: 'win32',
    fetchFn: async () => health(true),
    captureStep: () => { launches += 1; },
    log: () => {},
  });
  assert.equal(result.healthy, true);
  assert.equal(result.state, 'sovereign-commander-reused-existing-runtime');
  assert.equal(result.startupAttempted, false);
  assert.equal(launches, 0);
});

test('ignition runs only the fixed hidden watchdog when Sovereign Commander is down', async () => {
  let probe = 0;
  const calls = [];
  const result = await ensureSovereignCommanderAtIgnitionWithDeps({
    platform: 'win32',
    fetchFn: async () => {
      probe += 1;
      return health(probe > 1);
    },
    captureStep: (label, command, args) => {
      calls.push({ label, command, args });
      return { stdout: '{"healthy":true}', stderr: '' };
    },
    log: () => {},
  });

  assert.equal(result.healthy, true);
  assert.equal(result.state, 'sovereign-commander-watchdog-started');
  assert.equal(result.startupAttempted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'sovereign-commander-watchdog');
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(calls[0].args.some((arg) => String(arg).endsWith('run-sovereign-commander-hidden.ps1')));
  assert.equal(calls[0].args.includes('-NonInteractive'), true);
});

test('non-Windows ignition does not attempt Sovereign Commander startup', async () => {
  let launches = 0;
  const result = await ensureSovereignCommanderAtIgnitionWithDeps({
    platform: 'linux',
    fetchFn: async () => { throw new Error('should not probe'); },
    captureStep: () => { launches += 1; },
    log: () => {},
  });
  assert.equal(result.required, false);
  assert.equal(launches, 0);
});
