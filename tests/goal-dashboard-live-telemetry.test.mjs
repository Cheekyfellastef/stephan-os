import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';

function runDashboard({ fetchImpl, hostname = 'localhost', protocol = 'http:' } = {}) {
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
      location: { hostname, protocol },
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
        buildConciergeStatus: { roadmap: { phases: [{ version: 'V1', status: 'landed' }, { version: 'V8', status: 'implemented_guarded' }] } },
        missions: [{ mission: { missionId: 'mission-live', title: 'Live goal', state: 'RUNNING', currentPhase: 'proof', nextAction: 'Inspect proof.' }, agent: { label: 'Codex' } }],
        queuedCandidates: [{ candidateId: 'bc-goal-live' }],
        activeProofLane: [{ candidateId: 'bc-goal-live' }],
        blockedCandidates: [{ candidateId: 'bc-goal-blocked' }],
        completedCandidates: [{ candidateId: 'bc-goal-done' }],
      }) };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].url, '/api/goal-projection/live');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(telemetry.get('goal-data-source').textContent, 'LIVE backend telemetry · /api/goal-projection/live');
  assert.equal(telemetry.get('github-state').textContent, 'adapter-provided');
  assert.equal(telemetry.get('automation-state').textContent, 'backend_reachable');
  assert.equal(telemetry.get('active-goal-queue').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('active-proof-lane').textContent, 'bc-goal-live');
  assert.equal(telemetry.get('blocked-goals').textContent, 'bc-goal-blocked');
  assert.equal(telemetry.get('completed-goals').textContent, 'bc-goal-done');
  assert.match(telemetry.get('build-concierge-v1-v8-status').textContent, /V8:implemented_guarded/);
  assert.equal(telemetry.get('next-operator-action').textContent, 'Continue one active proof lane.');
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'live-backend');
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
