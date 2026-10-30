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
