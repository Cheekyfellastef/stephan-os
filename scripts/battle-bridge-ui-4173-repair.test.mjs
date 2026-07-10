import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUi4173Repair } from './battle-bridge-ui-4173-repair.mjs';

function report({ backend = true, ui = false, openclaw = true, workspace = true, verdict = 'partial-ui-missing', stale = [], safety = [] } = {}) {
  return {
    finalVerdict: verdict,
    observedServices: {
      backend: { ready: backend },
      'stephanos-ui': { ready: ui },
      'openclaw-gateway': { ready: openclaw },
      'shared-workspace': { ready: workspace },
    },
    staleWorkspaceRecords: stale,
    safetyBlockers: safety,
  };
}

test('fixture PARTIAL_UI_MISSING + backend/OpenClaw/shared workspace ready plans UI-only start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report(), dryRun: true });
  assert.equal(result.allowedToStart, true);
  assert.equal(result.action, 'dry-run-plan-ui-4173-start');
  assert.equal(result.authority.startsBackend8787, false);
  assert.equal(result.authority.startsOpenClawGateway18789, false);
  assert.equal(result.authority.killsProcesses, false);
});

test('fixture READY does not start or plan start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ ui: true, verdict: 'ready' }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /stephanos-ui-already-ready/);
});

test('fixture STALE_WORKSPACE blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ workspace: false, stale: ['proof stale'] }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /shared-workspace-not-fresh/);
});

test('fixture backend missing blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ backend: false }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /backend-8787-not-connected/);
});

test('fixture OpenClaw missing blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ openclaw: false }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /openclaw-gateway-18789-not-connected/);
});

test('fixture source dirt/safety blocker blocks start', () => {
  const result = evaluateUi4173Repair({ readinessReport: report({ safety: [{ id: 'dirty-source', detail: 'dirty' }] }), dryRun: true });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /safety-dirty-source/);
});

test('command allowlist prevents arbitrary shell', () => {
  const result = evaluateUi4173Repair({ readinessReport: report(), dryRun: true, commandIdentity: { commandText: 'bash -c rm -rf /', id: 'bad', source: 'test', purpose: 'test' } });
  assert.equal(result.allowedToStart, false);
  assert.match(result.blockers.map((b) => b.id).join(','), /command-not-allowlisted/);
});
