import assert from 'node:assert/strict';
import test from 'node:test';
import { runSovereignCommanderHttpServer } from './sovereign-commander-http.mjs';

test('source outage retains HTTP health and denies maintenance without reserving custody', async () => {
  let reservations = 0;
  const token = 'isolated-observation-fixture-token-000000';
  const app = await runSovereignCommanderHttpServer({ port: 0, token,
    readRecoverySource: () => { throw new Error('fixture network outage'); },
    custodyStore: { status: () => ({ held: false }), reserve: () => { reservations++; return { ok: true }; } },
  });
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.continuousRepairGuardian.timeoutCustodyHeld, true);
    assert.equal(health.continuousRepairGuardian.scheduled, false);
    assert.equal(health.continuousRepairGuardian.running, false);
    assert.equal(reservations, 0);
    const observed = await fetch(`${base}/mcp`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'offline-proof', version: '1' } } }) });
    assert.equal(observed.status, 200);
    assert.ok((await observed.json()).result);
    const denied = await fetch(`${base}/maintenance-custody/recover-after-boot`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest: 'a'.repeat(64), expectedMain: 'b'.repeat(40), operatorApproval: 'operator-approved' }) });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).blocker, 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN');
    assert.equal(reservations, 0);
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});


test('source outage still consumes only a previously prepared custody recovery without enabling repair', async () => {
  let held = true, recoverCalls = 0, reservations = 0;
  const token = 'isolated-prepared-recovery-fixture-0000';
  const custodyStore = {
    status: () => held
      ? ({ held: true, digest: 'c'.repeat(64), reservationId: 'prepared-offline-cycle' })
      : ({ held: false, digest: 'd'.repeat(64), reservationId: 'prepared-offline-cycle' }),
    reserve: () => { reservations += 1; return { ok: true }; },
    recoverPreparedAfterBoot: async () => {
      recoverCalls += 1;
      held = false;
      return { ok: true, custodyReleased: true, reservationId: 'prepared-offline-cycle' };
    },
  };
  const app = await runSovereignCommanderHttpServer({ port: 0, token,
    readRecoverySource: () => { throw new Error('fixture network outage'); },
    custodyStore,
  });
  try {
    for (let attempt = 0; attempt < 20 && recoverCalls === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(recoverCalls, 1);
    assert.equal(reservations, 0);
    const health = await (await fetch(`http://127.0.0.1:${app.server.address().port}/health`)).json();
    assert.equal(health.continuousRepairGuardian.enabled, false);
    assert.equal(health.continuousRepairGuardian.timeoutCustodyHeld, false);
    assert.equal(health.continuousRepairGuardian.scheduled, false);
    assert.equal(health.continuousRepairGuardian.running, false);
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});
