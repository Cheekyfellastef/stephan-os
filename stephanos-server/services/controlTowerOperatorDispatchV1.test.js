import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dispatchControlTowerOperatorIntentV1, prepareControlTowerOperatorIntentV1,
  isLocalControlTowerOperatorSurfaceV1, CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1 } from './controlTowerOperatorDispatchV1.js';

const NOW = Date.parse('2026-11-02T23:20:00.000Z');
const HEAD = 'a'.repeat(40);
const OWNER = 'Cheekyfellastef';
const WORKFLOW = 'stephanos-control-tower-build.yml';
const BASE = 'https://api.github.com/repos/Cheekyfellastef/stephan-os';
const headers = Object.freeze({ origin: 'http://127.0.0.1:4173',
  host: '127.0.0.1:8787', 'sec-fetch-site': 'same-site',
  'content-type': 'application/json', 'x-stephanos-operator-click': 'confirmed-v1' });
const localRequest = (change = {}) => ({ socket: { remoteAddress: '127.0.0.1', ...(change.socket || {}) },
  headers: { ...headers, ...(change.headers || {}) } });
function conversation(operation = 'OBSERVE_CONTROL_SYSTEM') {
  return { handoff: { handoffId: randomUUID(), state: 'NOT_SUBMITTED',
    operation, createdAtUtc: new Date(NOW).toISOString(),
    expiresAtUtc: new Date(NOW + 600000).toISOString(),
    workflowUrl: 'https://github.com/Cheekyfellastef/stephan-os/actions/workflows/' + WORKFLOW,
    workflowRef: 'main', workflowInputs: { operation },
    requestSubmitted: false, executionAuthority: false, reusableAuthority: false,
    authenticatedOwnerSubmissionRequired: true, singleAuthenticatedRunRequired: true,
    submissionBlockedReason: '' } };
}
function intent(operation) {
  const issued = prepareControlTowerOperatorIntentV1(localRequest(), conversation(operation),
    { sourceHead: HEAD, nowMs: NOW });
  assert.ok(issued);
  return Object.fromEntries(['schemaVersion', 'handoffId', 'operation', 'sourceHead', 'expiresAtUtc', 'signature']
    .map(key => [key, issued[key]]));
}
function fixture(operation = 'OBSERVE_CONTROL_SYSTEM', overrides = {}) {
  const seen = [], reserved = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, method: init.method, redirect: init.redirect, body: init.body });
    if (url === 'https://api.github.com/user') return { ok: true, status: 200,
      text: async () => JSON.stringify({ login: OWNER, id: 267490109 }) };
    if (url === BASE + '/git/ref/heads/main') return { ok: true, status: 200,
      text: async () => JSON.stringify({ ref: 'refs/heads/main', object: { sha: HEAD } }) };
    if (url === BASE + '/actions/workflows/' + WORKFLOW) return { ok: true, status: 200,
      text: async () => JSON.stringify({ id: 123, state: 'active', path: '.github/workflows/' + WORKFLOW }) };
    if (url === BASE + '/actions/workflows/' + WORKFLOW + '/dispatches')
      return { ok: true, status: 204 };
    throw Error('UNEXPECTED_NETWORK_TARGET');
  };
  const options = { testOnly: true, env: { STEPHANOS_BACKEND_SOURCE_HEAD: HEAD },
    nowMs: () => NOW, observe: async () => ({
      commander: { observed: true }, controlTower: { observed: true, exactHeadMatch: true },
    }), resolveAuth: async () => ({ token: 'a'.repeat(40) }),
    safeLedger: async () => true,
    reserve: async (...args) => { reserved.push(args); },
    fetchFn, ...overrides };
  return { body: intent(operation), options, seen, reserved };
}

test('only real local operator surface can receive an inert signed action', () => {
  const good = prepareControlTowerOperatorIntentV1(localRequest(), conversation(),
    { sourceHead: HEAD, nowMs: NOW });
  assert.equal(good.schemaVersion, CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1);
  assert.match(good.signature, /^[a-f0-9]{64}$/);
  assert.equal(good.workflowRequestAccepted, false);
  assert.equal(good.nativeActionSubmitted, false);
  for (const bad of [
    localRequest({ socket: { remoteAddress: '192.168.1.2' } }),
    localRequest({ headers: { origin: 'https://cheekyfellastef.github.io' } }),
    localRequest({ headers: { 'sec-fetch-site': 'cross-site' } }),
    localRequest({ headers: { 'x-forwarded-for': '127.0.0.1' } }),
    localRequest({ headers: { host: 'evil.invalid:8787' } }),
    localRequest({ headers: { origin: '' } }),
  ]) {
    assert.equal(isLocalControlTowerOperatorSurfaceV1(bad), false);
    assert.equal(prepareControlTowerOperatorIntentV1(bad, conversation(),
      { sourceHead: HEAD, nowMs: NOW }), null);
  }
  for (const change of [
    h => { h.submissionBlockedReason = 'SOVEREIGN_MAINTENANCE_OWNER_BUSY'; },
    h => { h.workflowRef = 'feature'; },
    h => { h.workflowInputs.shell = 'whoami'; },
    h => { h.requestSubmitted = true; },
    h => { h.workflowUrl = 'https://evil.invalid'; },
    h => { h.operation = 'REBOOT_WINDOWS'; },
  ]) {
    const value = conversation(); change(value.handoff);
    assert.equal(prepareControlTowerOperatorIntentV1(localRequest(), value,
      { sourceHead: HEAD, nowMs: NOW }), null);
  }
});

test('one explicit local click authenticates exact owner/main/workflow and dispatches one fixed request', async () => {
  const f = fixture('BUILD_NEXT_ELIGIBLE_GOAL');
  const result = await dispatchControlTowerOperatorIntentV1(localRequest(), f.body, f.options);
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.state, 'DISPATCH_ACCEPTED_UNCORRELATED');
  assert.equal(result.workflowRequestAccepted, true);
  assert.equal(result.nativeActionSubmitted, false);
  assert.equal(result.nativePickupProven, false);
  assert.equal(f.seen.length, 4);
  assert.deepEqual(f.seen.map(row => row.url), [
    'https://api.github.com/user', BASE + '/git/ref/heads/main',
    BASE + '/actions/workflows/' + WORKFLOW,
    BASE + '/actions/workflows/' + WORKFLOW + '/dispatches',
  ]);
  assert.deepEqual(JSON.parse(f.seen[3].body), { ref: 'main', inputs: { operation: 'BUILD_NEXT_ELIGIBLE_GOAL' } });
  assert.equal(f.seen[3].redirect, 'error');
  assert.equal(f.reserved.length, 1);
  const replay = await dispatchControlTowerOperatorIntentV1(localRequest(), f.body, f.options);
  assert.equal(replay.ok, false); assert.equal(replay.status, 409);
  assert.equal(f.seen.length, 4);
});

test('missing local click, bad content type, extra body or forged signatures never dispatch', async () => {
  for (const changes of [
    { request: localRequest({ headers: { 'x-stephanos-operator-click': undefined } }) },
    { request: localRequest({ headers: { 'content-type': 'text/plain' } }) },
    { request: localRequest({ headers: { origin: 'http://evil.invalid' } }) },
    { edit: b => { b.command = 'arbitrary-script'; } },
    { edit: b => { b.signature = '0'.repeat(64); } },
    { edit: b => { b.sourceHead = 'b'.repeat(40); } },
    { edit: b => { b.operation = 'REBOOT_WINDOWS'; } },
    { edit: b => { b.expiresAtUtc = new Date(NOW - 1000).toISOString(); } },
  ]) {
    const f = fixture();
    changes.edit?.(f.body);
    const denied = await dispatchControlTowerOperatorIntentV1(changes.request || localRequest(), f.body, f.options);
    assert.equal(denied.ok, false);
    assert.equal(f.seen.length, 0);
    assert.equal(f.reserved.length, 0);
  }
});

test('live observation, unresolved prior build and wrong owner/main refuse before reservation', async () => {
  const cases = [
    { observe: async () => ({ commander: { observed: false }, controlTower: { observed: true, exactHeadMatch: true } }) },
    { safeLedger: async () => false },
    { resolveAuth: async () => ({ token: '' }) },
    { fetchFn: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ login: 'someone-else', id: 1 }) }) },
  ];
  for (const overrides of cases) {
    const f = fixture('BUILD_NEXT_ELIGIBLE_GOAL', overrides);
    const result = await dispatchControlTowerOperatorIntentV1(localRequest(), f.body, f.options);
    assert.equal(result.ok, false);
    assert.equal(f.reserved.length, 0);
  }
});

test('uncertain GitHub dispatch keeps original reservation and cannot replay', async () => {
  const f = fixture('OBSERVE_CONTROL_SYSTEM', {
    fetchFn: async (url, init) => {
      if (init.method === 'POST') throw Error('UNVERIFIED_TRANSPORT');
      if (url === 'https://api.github.com/user') return { ok: true, status: 200,
        text: async () => JSON.stringify({ login: OWNER, id: 267490109 }) };
      if (url.endsWith('/git/ref/heads/main')) return { ok: true, status: 200,
        text: async () => JSON.stringify({ ref: 'refs/heads/main', object: { sha: HEAD } }) };
      return { ok: true, status: 200,
        text: async () => JSON.stringify({ id: 123, state: 'active', path: '.github/workflows/' + WORKFLOW }) };
    },
  });
  const failed = await dispatchControlTowerOperatorIntentV1(localRequest(), f.body, f.options);
  assert.equal(failed.blocker, 'CONTROL_TOWER_GITHUB_DISPATCH_OUTCOME_UNVERIFIED');
  assert.equal(f.reserved.length, 1);
  const replay = await dispatchControlTowerOperatorIntentV1(localRequest(), f.body, f.options);
  assert.equal(replay.blocker, 'CONTROL_TOWER_INTENT_ALREADY_RESERVED');
});

test('healthy backend cannot silently issue a workflow through read-only conversation', async () => {
  const conversationText = conversation();
  const signed = prepareControlTowerOperatorIntentV1(localRequest(), conversationText,
    { sourceHead: HEAD, nowMs: NOW });
  assert.equal(signed.workflowRequestAccepted, false);
  assert.equal(signed.operatorClickRequired, true);
});
