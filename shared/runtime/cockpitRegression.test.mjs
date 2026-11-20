import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCockpitServices, inspectCockpitRegression, installCockpitRegressionMonitor } from './cockpitRegression.mjs';

const nowMs = Date.parse('2026-10-25T23:00:00Z');
const receipt = { backendReachable: true, lastCheckedAt: new Date(nowMs).toISOString(), meta: { ok: true, service: 'stephanos-server', schemaVersion: 'stephanos.backend-health.v1', backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' } } };
test('serving UI, healthy backend, missing mission proof and absent telemetry remain independent', () => {
  const result = projectCockpitServices({ apiStatus: receipt, mission: { missingProofCount: 6 }, nowMs });
  assert.equal(result.frontend, 'serving');
  assert.equal(result.backendHealth, 'healthy');
  assert.equal(result.reachable, 'reachable');
  assert.equal(result.missionProof, 'missing');
  assert.equal(result.lastTelemetry, 'not received');
});
test('unchecked, foreign, stale, future and failed transport never assert healthy service', () => {
  for (const apiStatus of [{ backendReachable: false }, { ...receipt, meta: {} }, { ...receipt, lastCheckedAt: new Date(nowMs - 120001).toISOString() }, { ...receipt, lastCheckedAt: new Date(nowMs + 1).toISOString() }, { ...receipt, backendReachable: false }]) {
    assert.equal(projectCockpitServices({ apiStatus, nowMs }).backendHealth, 'unknown');
  }
  assert.equal(projectCockpitServices({ apiStatus: { ...receipt, backendReachable: false }, nowMs }).reachable, 'unreachable');
  assert.equal(projectCockpitServices({ apiStatus: { ...receipt, meta: { ...receipt.meta, ok: false } }, nowMs }).backendHealth, 'unhealthy');
});
test('last telemetry uses newest real timestamp and rejects malformed/future entries', () => {
  const result = projectCockpitServices({ telemetryEntries: [{ timestamp: 'invalid' }, { timestamp: new Date(nowMs + 1).toISOString() }, { timestampUtc: new Date(nowMs - 5000).toISOString() }], nowMs });
  assert.equal(result.lastTelemetry, new Date(nowMs - 5000).toISOString());
});
function fixture() {
  const dashboard = { getBoundingClientRect: () => ({ width: 400, height: 100 }) };
  const node = { getAttribute: () => 'alive', classList: { contains: value => value === 'truth-alive' } };
  const documentRef = { querySelectorAll: selector => selector.includes('cockpitPanel') ? [{}] : selector.includes('primary-dashboard') ? [dashboard] : [], querySelector: selector => selector.includes('cockpit-node') ? node : { textContent: 'healthy' }, documentElement: { scrollWidth: 400 } };
  const windowRef = { innerWidth: 400 }; windowRef.self = windowRef; windowRef.top = windowRef;
  return { documentRef, windowRef, expectedBackendState: 'alive', services: { backendHealth: 'healthy' }, standalone: true, nowMs };
}
test('regression checks reject nested documents, duplicate roots, hidden dashboards, overflow and rendered health drift', () => {
  assert.equal(inspectCockpitRegression(fixture()).verdict, 'PASS');
  const nested = fixture(); nested.windowRef.top = {}; assert.ok(inspectCockpitRegression(nested).failures.includes('COCKPIT_NESTED_DOCUMENT'));
  const overflow = fixture(); overflow.documentRef.documentElement.scrollWidth = 600; assert.ok(inspectCockpitRegression(overflow).failures.includes('COCKPIT_HORIZONTAL_OVERFLOW'));
  const drift = fixture(); drift.expectedBackendState = 'dead'; drift.services.backendHealth = 'unknown'; assert.deepEqual(inspectCockpitRegression(drift).failures, ['COCKPIT_BACKEND_RENDER_DRIFT', 'COCKPIT_HEALTH_RENDER_DRIFT']);
  const absent = fixture(); absent.documentRef.querySelectorAll = () => []; assert.deepEqual(inspectCockpitRegression(absent).failures, ['COCKPIT_PANEL_CARDINALITY','COCKPIT_DASHBOARD_CARDINALITY','COCKPIT_DASHBOARD_HIDDEN']);
});
test('monitor coalesces DOM changes, pauses while hidden and releases listeners and timers', () => {
  const f = fixture(); let callback, pending, disconnected = false, published = 0; const listeners = new Map();
  f.documentRef.body = {}; f.documentRef.visibilityState = 'visible';
  f.windowRef.MutationObserver = class { constructor(cb) { callback = cb; } observe() {} disconnect() { disconnected = true; } };
  f.windowRef.setTimeout = cb => { pending = cb; return 1; }; f.windowRef.clearTimeout = () => { pending = null; };
  for (const target of [f.windowRef, f.documentRef]) { target.addEventListener = (name, cb) => listeners.set(name, cb); target.removeEventListener = name => listeners.delete(name); }
  const stop = installCockpitRegressionMonitor({ ...f, readExpected: () => f, publish: () => published++ });
  const first = pending; callback(); callback(); assert.equal(pending, first); pending(); assert.equal(published, 1);
  f.documentRef.visibilityState = 'hidden'; callback(); pending(); assert.equal(published, 1);
  f.documentRef.visibilityState = 'visible'; listeners.get('visibilitychange')(); pending(); assert.equal(published, 2);
  callback(); stop(); assert.equal(pending, null); assert.equal(disconnected, true); assert.equal(listeners.size, 0);
});
