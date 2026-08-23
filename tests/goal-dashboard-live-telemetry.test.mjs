import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';

function runDashboard({ fetchImpl, hostname = 'localhost', protocol = 'http:', port = '' } = {}) {
  const telemetry = new Map();
  const grid = {
    textContent: '',
    children: [],
    attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    appendChild(node) { this.children.push(node); },
  };
  const document = {
    getElementById(id) { return id === 'goal-grid' ? grid : null; },
    createElement(tag) {
      return { tag, className: '', attrs: {}, innerHTML: '', setAttribute(key, value) { this.attrs[key] = value; } };
    },
    querySelector(selector) {
      const match = String(selector).match(/data-live-telemetry-field="([^"]+)"/);
      if (!match) return null;
      const key = match[1];
      if (!telemetry.has(key)) telemetry.set(key, { textContent: '' });
      return telemetry.get(key);
    },
  };
  const context = {
    document,
    window: {
      location: { hostname, protocol, port },
      fetch: fetchImpl,
      setTimeout: (_fn) => 1,
      clearTimeout: () => {},
    },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  };
  vm.runInNewContext(script, context);
  return { telemetry, grid };
}

test('standalone Goal Dashboard static fallback remains honest when backend unavailable', async () => {
  const { telemetry, grid } = runDashboard({ fetchImpl: async () => ({ ok: false }) });
  await Promise.resolve();
  assert.equal(telemetry.get('goal-data-source').textContent, 'Seeded / source-controlled · BACKEND_UNAVAILABLE_STATIC_SEED_ONLY');
  assert.equal(telemetry.get('github-state').textContent, 'Not live in browser');
  assert.match(telemetry.get('telemetry-blocker').textContent, /BACKEND_UNAVAILABLE_STATIC_SEED_ONLY/);
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'static-seed');
});

test('standalone Goal Dashboard renders live telemetry from approved endpoint', async () => {
  const calls = [];
  const { telemetry, grid } = runDashboard({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({
        schemaVersion: 'stephanos.live-goal-projection.v1',
        sourceTruth: 'live',
        nextOperatorAction: 'Continue one active proof lane.',
        currentAgentStates: { github: { state: 'adapter-provided' }, stephanos: { state: 'backend_reachable' } },
        proofTruth: { local: 'unknown' },
        buildConciergeStatus: { roadmap: { phases: [{ version: 'V1', status: 'landed' }, { version: 'V8', status: 'implemented_guarded' }] }, executionEngine: { status: 'blocked_or_manual', watchedGoalCount: 1, classifiedGoalCount: 1, manualDispatchRequiredCount: 1, enrichedCandidates: [{ candidateId: 'bc-goal-live', classification: 'ui_surface_goal', dispatchReadiness: 'MANUAL_DISPATCH_REQUIRED' }] } },
        missions: [{ mission: { missionId: 'mission-live', title: '<script>alert(1)</script>', state: 'RUNNING', currentPhase: 'proof', nextAction: 'Inspect proof.' }, agent: { label: 'Codex' } }],
        queuedCandidates: [{ candidateId: 'bc-goal-live' }],
        activeProofLane: [{ candidateId: 'bc-goal-live' }],
        blockedCandidates: [{ candidateId: 'bc-goal-blocked' }],
        completedCandidates: [{ candidateId: 'bc-goal-done' }],
      }) };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].url, '/api/shared-workspace/dashboard-feed');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].url, '/api/goal-projection/live');
  assert.equal(telemetry.get('goal-data-source').textContent, 'LIVE backend telemetry · /api/goal-projection/live');
  assert.equal(telemetry.get('github-state').textContent, 'adapter-provided');
  assert.equal(telemetry.get('automation-state').textContent, 'backend_reachable');
  assert.equal(telemetry.get('active-goal-queue').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('active-proof-lane').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('blocked-goals').textContent, 'bc-goal-blocked');
  assert.equal(telemetry.get('completed-goals').textContent, 'bc-goal-done');
  assert.match(telemetry.get('build-concierge-v1-v8-status').textContent, /V8:implemented_guarded/);
  assert.match(telemetry.get('build-concierge-v9-execution-engine').textContent, /classified 1/);
  assert.match(telemetry.get('build-concierge-v9-enriched-candidates').textContent, /ui_surface_goal/);
  assert.equal(telemetry.get('next-operator-action').textContent, 'Continue one active proof lane.');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-backend');
  assert.match(script, /function escapeHtml/);
  assert.match(script, /escapeHtml\(goal\.title\)/);
});


test('standalone Goal Dashboard resolves 4173 to backend 8787 shared workspace feed', async () => {
  const calls = [];
  runDashboard({ hostname: '127.0.0.1', protocol: 'http:', port: '4173', fetchImpl: async (url) => { calls.push(url); return { ok: false, json: async () => ({}) }; } });
  await Promise.resolve();
  assert.equal(calls[0], 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed');
});


test('standalone Goal Dashboard renders ready Shared Workspace feed before static fallback', async () => {
  const { telemetry, grid } = runDashboard({
    fetchImpl: async (url) => url.includes('shared-workspace') ? { ok: true, json: async () => ({
      schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1',
      state: 'ready',
      reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
      workspaceRoot: '/tmp/shared-workspace-live',
      exactNextAction: 'Review live proof refs.',
      polling: { pollIntervalMs: 15000 },
      projection: {
        sourceTruth: 'CURRENT',
        finalVerdict: 'LANDING_GOAL_DASHBOARD_CURRENT',
        queueDispatcher: { dispatcherState: 'RUNNING', queueDepth: 1, currentJob: 'job-1', capabilityMode: 'automated_dispatch_supported' },
        battleBridgeSupervisor: { overallState: 'CURRENT', services: [{ serviceId: 'publisher-loop', state: 'CURRENT' }] },
        openClawCapabilityLadder: { canRunNow: ['read-only-proof'], needsApproval: ['windows-action'], blocked: [] },
        operatorAttention: { approvals: [], localProofNeeded: [], blockers: [], exactNextAction: 'Review live proof refs.' },
        goals: [{ issue: '#1290', title: 'Shared Agent Workspace', statusTruth: 'CURRENT', proofTruth: 'CURRENT', blockers: [], exactNextAction: 'Continue.' }],
      },
    }) } : { ok: false, json: async () => ({}) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(telemetry.get('source-badge').textContent, 'READY');
  assert.match(telemetry.get('goal-data-source').textContent, /READY Shared Agent Workspace feed/);
  assert.equal(telemetry.get('proof-state').textContent, 'CURRENT');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-shared-workspace');
});

test('standalone Goal Dashboard does not claim live proof without backend data and gates non-local fetches', async () => {
  const calls = [];
  const { telemetry, grid } = runDashboard({ hostname: 'example.com', fetchImpl: async () => { calls.push('called'); return { ok: true }; } });
  await Promise.resolve();
  assert.equal(calls.length, 0);
  assert.equal(telemetry.get('github-state').textContent, 'Not live in browser');
  assert.match(telemetry.get('telemetry-blocker').textContent, /No live GitHub proof, local proof, browser proof/);
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'static-seed');
});
