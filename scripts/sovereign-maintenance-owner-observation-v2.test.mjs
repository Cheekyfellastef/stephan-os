import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readMaintenanceOwnerObservationV2 } from './sovereign-maintenance-owner-observation-v2.mjs';
const native = () => ({ schemaVersion: 'stephanos.maintenance-owner-native-observation.v2',
  pid: 10, createdAtUtc: new Date(Date.now() - 60_000).toISOString(),
  commandSha256: 'a'.repeat(64), imageSha256: 'b'.repeat(64), observedAtUtc: new Date().toISOString() });
const held = () => ({ ok: true, service: 'stephanos-sovereign-commander', continuousRepairGuardian: {
  timeoutCustodyHeld: true, running: false, maintenanceInFlight: false, scheduled: false, currentCycleId: '',
  lastBlocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
  lastCycleId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lastStartedAtUtc: new Date(Date.now() - 30_000).toISOString() } });
test('owner observation binds stable native birth and exact held attempt without executing an action', async () => {
  const n = native(), h = held(); const r = await readMaintenanceOwnerObservationV2({
    nativeReader: () => ({ ...n, observedAtUtc: new Date().toISOString() }),
    fetchFn: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:18791/health'); assert.equal(options.redirect, 'error');
      assert.equal(options.method, undefined); return Response.json(h);
    } });
  assert.equal(r.observation.pid, n.pid); assert.equal(r.observation.lastCycleId, h.continuousRepairGuardian.lastCycleId);
  assert.equal(r.digest, createHash('sha256').update(JSON.stringify(r.observation)).digest('hex'));
});
test('owner drift, stale observations, active work and malformed health all refuse', async () => {
  for (const scenario of ['pid', 'birth', 'stale', 'running', 'scheduled', 'wrong-service', 'cycle', 'unheld']) {
    const n = native(), h = held(); let calls = 0;
    if (scenario === 'running') h.continuousRepairGuardian.running = true;
    if (scenario === 'scheduled') h.continuousRepairGuardian.scheduled = true;
    if (scenario === 'wrong-service') h.service = 'other';
    if (scenario === 'cycle') h.continuousRepairGuardian.lastCycleId = 'unknown';
    if (scenario === 'unheld') h.continuousRepairGuardian.timeoutCustodyHeld = false;
    await assert.rejects(readMaintenanceOwnerObservationV2({
      nativeReader: () => { calls++; return { ...n,
        ...(scenario === 'pid' && calls > 1 ? { pid: 11 } : {}),
        ...(scenario === 'birth' && calls > 1 ? { createdAtUtc: new Date(Date.now() - 1000).toISOString() } : {}),
        ...(scenario === 'stale' ? { observedAtUtc: new Date(Date.now() - 20_000).toISOString() } : {}) }; },
      fetchFn: async () => Response.json(h) }), /OWNER_UNPROVEN/, scenario);
  }
});
test('health body limits and unsuccessful responses fail before accepting owner evidence', async () => {
  const n = native();
  await assert.rejects(readMaintenanceOwnerObservationV2({ nativeReader: () => n,
    fetchFn: async () => new Response('x'.repeat(65537)) }), /OWNER_UNPROVEN/);
  await assert.rejects(readMaintenanceOwnerObservationV2({ nativeReader: () => n,
    fetchFn: async () => new Response('{}', { status: 503 }) }), /OWNER_UNPROVEN/);
});

