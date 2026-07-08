import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCaptainsBridgeRuntimeHealth } from './captainsBridgeRuntimeHealth.mjs';
const now = Date.parse('2026-07-08T00:00:00.000Z');

test('G15 projects green traffic lights for fresh ready runtime records', () => {
  const healthRecords = ['backend','dashboard','publisher-loop','shared-workspace-feed','openclaw-gateway','mission-worker','supervisor'].map((serviceId) => ({ serviceId, status: 'READY', timestampUtc: '2026-07-08T00:00:00.000Z' }));
  const p = projectCaptainsBridgeRuntimeHealth({ nowMs: now, healthRecords });
  assert.equal(p.overallTrafficLight, 'GREEN');
  assert.equal(p.processKillingAllowed, false);
  assert.equal(p.restartImplementationAllowed, false);
});

test('G15 marks stale and failed runtime health with exact next action', () => {
  const stale = projectCaptainsBridgeRuntimeHealth({ nowMs: now, staleAfterMs: 1000, healthRecords: [{ serviceId: 'backend', status: 'READY', timestampUtc: '2026-07-07T23:00:00.000Z' }] });
  assert.equal(stale.services.find((s) => s.serviceId === 'backend').trafficLight, 'AMBER');
  const failed = projectCaptainsBridgeRuntimeHealth({ nowMs: now, healthRecords: [{ serviceId: 'backend', status: 'FAILED', timestampUtc: '2026-07-08T00:00:00.000Z', exactNextAction: 'Escalate backend proof.' }] });
  assert.equal(failed.overallTrafficLight, 'RED');
  assert.match(failed.exactNextAction, /Escalate backend proof/);
});
