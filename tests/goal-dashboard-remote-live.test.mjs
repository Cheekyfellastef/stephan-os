import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps/goal-dashboard/remote-live.js', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../.github/workflows/stephanos-deploy.yml', import.meta.url), 'utf8');
const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = Date.parse('2026-09-12T12:35:00.000Z');

function beacon(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-outbound-health-beacon.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1889,
    observedAtUtc: '2026-09-12T12:34:00.000Z',
    sourceHead: HEAD,
    freshness: 'FRESH',
    completeStateAnswerable: true,
    telemetryCompleteness: 'COMPLETE',
    blockerCount: 0,
    blockers: [],
    nextAutomaticAction: 'Continue canonical work.',
    telemetry: { answeredSurfaceCount: 7, requiredSurfaceCount: 7 },
    surfaces: [
      { id: 'missionWorker', state: 'BUILDING', observedAtUtc: '2026-09-12T12:34:30.000Z', head: HEAD },
      { id: 'workerWatchdog', state: 'WORKER_WATCHDOG_HEALTHY', observedAtUtc: '2026-09-12T12:34:30.000Z', head: HEAD },
    ],
    ...overrides,
  };
}

function beaconComment(record = beacon()) {
  return { body: `<!-- stephanos-battle-bridge-outbound-health-beacon -->\n\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\`` };
}

function makeContext({ hostname = 'localhost', fetchImpl = async () => ({ ok: false, status: 500 }) } = {}) {
  const timers = [];
  const fields = new Map();
  const grid = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
  const window = {
    location: { hostname },
    fetch: fetchImpl,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval() { return 1; },
    setField(key, value) { fields.set(key, String(value)); },
    setSourceBadge(value, truth) { fields.set('source-badge', String(value)); fields.set('source-truth', String(truth)); },
    applyProjection(projection, source, feedState) { window.applied = { projection, source, feedState }; },
  };
  const document = {
    visibilityState: 'visible',
    getElementById(id) { return id === 'goal-grid' ? grid : null; },
    querySelector() { return null; },
  };
  const context = { window, document, AbortController, Date, JSON, Math, Number, String, Array, Object, RegExp, Set, Error, console };
  vm.runInNewContext(source, context);
  return { api: window.__stephanosRemoteGoalDashboardV1, window, document, timers, fields, grid };
}

test('Pages deployment injects the remote adapter without changing the local dashboard source file', () => {
  assert.match(deployWorkflow, /Enable bounded remote Goal Dashboard projection/);
  assert.match(deployWorkflow, /<script src="\.\/remote-live\.js"><\/script>/);
  assert.match(deployWorkflow, /GOAL_DASHBOARD_REMOTE_LIVE_ADAPTER_MISSING/);
});

test('remote adapter accepts only the bounded outbound beacon contract', () => {
  const { api } = makeContext();
  assert.equal(api.parseBeaconComment(beaconComment())?.sourceHead, HEAD);
  assert.equal(api.parseBeaconComment(beaconComment(beacon({ repository: 'other/repo' }))), null);
  assert.equal(api.parseBeaconComment(beaconComment(beacon({ schemaVersion: 'wrong.schema' }))), null);
  assert.equal(api.parseBeaconComment({ body: 'not a beacon' }), null);
});

test('remote projection is current only with fresh exact-head complete evidence', () => {
  const { api } = makeContext();
  const projection = api.buildProjection({
    beacon: beacon(),
    ref: { object: { sha: HEAD } },
    issues: [{ number: 1282, title: 'Goal Dashboard', state: 'open', updated_at: '2026-09-12T12:33:00Z' }],
    nowMs: NOW,
  });
  assert.equal(projection.sourceTruth, 'CURRENT');
  assert.equal(projection.remoteProjection.exactHeadMatch, true);
  assert.equal(projection.remoteProjection.beaconFresh, true);
  assert.equal(projection.goals[0].statusTruth, 'CURRENT');
  assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
  assert.equal(projection.goals[0].source, 'github-public-issue');
});

test('remote projection stays degraded for partial telemetry and conflicting heads', () => {
  const { api } = makeContext();
  const partial = api.buildProjection({
    beacon: beacon({ completeStateAnswerable: false, freshness: 'DEGRADED', telemetryCompleteness: 'PARTIAL' }),
    ref: { object: { sha: HEAD } },
    issues: [],
    nowMs: NOW,
  });
  assert.equal(partial.sourceTruth, 'STALE');

  const conflicting = api.buildProjection({
    beacon: beacon(),
    ref: { object: { sha: OTHER_HEAD } },
    issues: [],
    nowMs: NOW,
  });
  assert.equal(conflicting.sourceTruth, 'CONFLICTING');
});

test('remote browser refresh reads public GitHub truth only and renders iPad-safe project state', async () => {
  const calls = [];
  const liveBeacon = beacon({ observedAtUtc: new Date().toISOString() });
  const responses = new Map([
    ['ref', { object: { sha: HEAD } }],
    ['comments', [beaconComment(liveBeacon)]],
    ['issues', [
      { number: 1282, title: 'Goal Dashboard', state: 'open', updated_at: '2026-09-12T12:33:00Z' },
      { number: 2188, title: 'Merged PR is filtered', state: 'open', pull_request: {}, updated_at: '2026-09-12T12:32:00Z' },
    ]],
  ]);
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/git/ref/heads/main')) return { ok: true, status: 200, json: async () => responses.get('ref') };
    if (String(url).includes('/issues/1889/comments')) return { ok: true, status: 200, json: async () => responses.get('comments') };
    if (String(url).includes('/issues?')) return { ok: true, status: 200, json: async () => responses.get('issues') };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { api, window, fields, grid } = makeContext({ hostname: 'cheekyfellastef.github.io', fetchImpl });
  const result = await api.refreshRemote();

  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.startsWith('https://api.github.com/repos/Cheekyfellastef/stephan-os/')));
  assert.ok(calls.every((url) => !/127\.0\.0\.1|localhost|8787/.test(url)));
  assert.equal(result.sourceTruth, 'CURRENT');
  assert.equal(result.goals.length, 1);
  assert.equal(window.applied.source, 'remote-github');
  assert.equal(window.applied.feedState, 'ready');
  assert.equal(fields.get('source-badge'), 'REMOTE LIVE');
  assert.match(fields.get('goal-data-source'), /REMOTE GitHub \+ Battle Bridge health beacon/);
  assert.match(fields.get('workspace-root'), /local workspace path intentionally private/);
  assert.equal(grid.attrs['data-goal-dashboard-source-state'], 'remote-github');
  assert.equal(grid.attrs['data-goal-dashboard-feed-state'], 'ready');
});

test('local Battle Bridge browser never uses the remote public adapter', async () => {
  let called = false;
  const { api } = makeContext({ hostname: '127.0.0.1', fetchImpl: async () => { called = true; return { ok: false, status: 500 }; } });
  const result = await api.refreshRemote();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'LOCAL_BACKEND_REMAINS_CANONICAL');
  assert.equal(called, false);
});
