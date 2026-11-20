import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSovereignCommanderHttpServer } from './sovereign-commander-http.mjs';
import { mobileDevicePairingCreateOptionsV1, mobileDevicePairingSetupDescriptorV1 }
  from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { makeMobileDevicePairingFixtureV1 } from './fixtures/mobile-device-pairing-v1.mjs';

const NOW = Date.parse('2026-11-14T23:00:00.000Z'), TOKEN = 'p'.repeat(48), ORIGIN = 'https://caravan.example';
const b64 = value => Buffer.from(value).toString('base64url');
const context = { schemaVersion: 'stephanos.mobile-installer-first-device-context.v1',
  repository: 'Cheekyfellastef/stephan-os', issueNumber: 1814, action: 'CAPTURE_MOBILE_INSTALLER_FIRST_DEVICE_V1',
  sourceHead: 'c'.repeat(40), sourceTree: 'd'.repeat(40), machineHash: 'b'.repeat(64),
  operatorSid: 'S-1-5-21-1-2-3-1001', enrollmentGeneration: 1, packageSha256: 'e'.repeat(64),
  closureSha256: 'f'.repeat(64), releaseProofSha256: '1'.repeat(64), origin: ORIGIN,
  rpId: 'caravan.example', userHandle: b64(Buffer.alloc(32, 4)), nonce: 'a'.repeat(64),
  issuedAtUtc: new Date(NOW).toISOString(), expiresAtUtc: new Date(NOW + 900000).toISOString() };
function device(c = context) {
  const fixture = makeMobileDevicePairingFixtureV1(c, { nowMs: NOW, registrationCounter: 1 });
  const registration = fixture.registration;
  const descriptor = mobileDevicePairingSetupDescriptorV1(c, registration, { nowMs: NOW }); assert.equal(descriptor.ok, true);
  return { registration, descriptor, assertion: fixture.assertion() };
}
async function withServer(action, settings = {}) {
  let clock = NOW; const calls = { observe: 0, prepare: 0, approve: 0, cancel: 0, reconcile: 0 };
  const provider = { observe: async () => { calls.observe++; return { nativeObservation: {
    reason: 'MOBILE_INSTALL_ENROLLMENT_MISSING', enrollmentObservation: { state: 'MISSING' } } }; } };
  for (const name of ['prepare', 'approve', 'cancel', 'reconcile']) provider[name] = async () => { calls[name]++; throw Error('NATIVE_MUTATION_FORBIDDEN'); };
  const app = await createSovereignCommanderHttpServer({ token: TOKEN, port: 0, continuousRepairEnabled: false,
    mobileInstallationProvider: provider, mobileInstallationExpectedMain: context.sourceHead,
    mobileInstallationPublicOrigin: ORIGIN, nowMs: () => clock, ...settings });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (path, options = {}) => {
    const response = await fetch(base + '/caravan/setup/' + path, options);
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const arm = (c = context, headers = {}) => request('arm', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN,
    'content-type': 'application/json', ...headers }, body: JSON.stringify({ context: c }) });
  const result = () => request('result', { headers: { authorization: 'Bearer ' + TOKEN } });
  const status = cap => request('status', { headers: { origin: ORIGIN, 'x-stephanos-pairing-capture': cap } });
  const post = async (path, body, cap, nonce, headers = {}) => request(path, { method: 'POST', headers: {
    origin: ORIGIN, 'content-type': 'application/json', 'x-stephanos-pairing-capture': cap,
    'x-stephanos-caravan-nonce': nonce ?? (await status(cap)).body.csrfNonce, ...headers }, body: JSON.stringify(body) });
  try { await action({ app, base, request, arm, result, status, post, calls, advance: ms => { clock += ms; } }); }
  finally {
    assert.deepEqual([calls.prepare, calls.approve, calls.cancel, calls.reconcile], [0, 0, 0, 0]);
    app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  }
}
const capOf = response => new URL(response.body.captureUrl).hash.slice('#pairing='.length);
const inert = body => { assert.equal(body.installability, 'NOT_INSTALLABLE'); assert.equal(body.executionAuthorityGranted, false); assert.equal(body.enrollmentQualified, false); };

test('pairing private routes require the existing Commander bearer before origin/shape/provider reads', async () => withServer(async ({ request, arm, calls }) => {
  for (const headers of [{}, { authorization: 'Bearer bad' }]) {
    assert.equal((await request('arm', { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await request('result', { headers })).status, 403);
  }
  assert.equal((await arm(context, { origin: ORIGIN })).status, 403);
  assert.equal((await request('result', { headers: { authorization: 'Bearer ' + TOKEN, origin: ORIGIN } })).status, 403);
  assert.equal((await arm(context, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await arm({ ...context, sourceHead: '0'.repeat(40) })).status, 400);
  assert.equal((await arm({ ...context, origin: 'https://different.example', rpId: 'different.example' })).status, 400);
  assert.equal((await arm({ ...context, approved: true })).status, 400);
  assert.equal(calls.observe, 0);
}));

test('one in-memory draft is private/idempotent, bound to source/origin and refuses an already enrolled target', async () => {
  await withServer(async ({ arm, result, status, calls }) => {
    const first = await arm(); assert.equal(first.status, 200); inert(first.body);
    const cap = capOf(first); assert.match(cap, /^[a-f0-9]{64}$/); assert.equal(first.body.stage, 'ARMED');
    assert.equal((await arm()).body.captureUrl, first.body.captureUrl);
    assert.equal((await arm({ ...context, nonce: '2'.repeat(64) })).status, 409);
    assert.equal(calls.observe, 1);
    assert.equal((await result()).body.context, undefined);
    const view = await status(cap); assert.equal(view.body.stage, 'ARMED'); assert.equal(view.body.publicKey, undefined);
    const publicText = JSON.stringify(view.body);
    for (const value of [cap, TOKEN, context.operatorSid, context.machineHash]) assert.equal(publicText.includes(value), false);
  });
  await withServer(async ({ arm }) => assert.equal((await arm()).status, 409), { mobileInstallationProvider: {
    observe: async () => ({ nativeObservation: { enrollmentObservation: { state: 'UNQUALIFIED' } } }) } });
  await withServer(async ({ arm }) => assert.equal((await arm()).status, 400), { mobileInstallationPublicOrigin: undefined });
  await withServer(async ({ arm }) => assert.equal((await arm()).status, 400), { mobileInstallationExpectedMain: undefined });
});

test('capability, strict origin, query/body limits and one-use CSRF protect every browser mutation', async () => withServer(async ({ arm, request, post, status }) => {
  const cap = capOf(await arm());
  assert.equal((await status('0'.repeat(64))).status, 403);
  assert.equal((await request('status', { headers: { 'x-stephanos-pairing-capture': cap } })).status, 403);
  assert.equal((await request('status', { headers: { 'sec-fetch-site': 'same-origin', 'x-stephanos-pairing-capture': cap } })).status, 200);
  assert.equal((await request('status?capture=' + cap, { headers: { origin: ORIGIN, 'x-stephanos-pairing-capture': cap } })).status, 400);
  assert.equal((await post('begin-create', {}, cap, 'bad')).status, 403);
  const nonce = (await status(cap)).body.csrfNonce;
  assert.equal((await post('begin-create', {}, cap, nonce, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('begin-create', {}, cap, nonce, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post('begin-create', { approved: true }, cap, nonce)).status, 400);
  assert.equal((await post('begin-create', {}, cap, nonce)).status, 403);
  assert.equal((await post('begin-create', { data: 'x'.repeat(25000) }, cap)).status, 413);
  assert.equal((await post('begin-create', {}, cap, undefined, { 'content-type': 'text/plain' })).status, 415);
}));

test('creation is offered exactly once, real registration/setup proof completes inert capture and duplicates cannot change the key', async () => withServer(async ({ arm, status, post, result, request }) => {
  const cap = capOf(await arm()), d = device(), other = device();
  assert.equal((await post('register', { registration: d.registration }, cap)).status, 409);
  const n1 = (await status(cap)).body.csrfNonce, n2 = (await status(cap)).body.csrfNonce;
  const begins = await Promise.all([post('begin-create', {}, cap, n1), post('begin-create', {}, cap, n2)]);
  assert.deepEqual(begins.map(row => row.status).sort(), [200, 409]);
  const create = begins.find(row => row.status === 200); assert.equal(create.body.publicKey.challenge,
    mobileDevicePairingCreateOptionsV1(context, { nowMs: NOW }).publicKey.challenge);
  assert.equal((await status(cap)).body.publicKey, undefined);
  assert.equal((await post('begin-create', {}, cap)).body.publicKey, undefined);
  const registrations = await Promise.all([post('register', { registration: d.registration }, cap), post('register', { registration: other.registration }, cap)]);
  assert.deepEqual(registrations.map(row => row.status).sort(), [200, 409]);
  const chosen = registrations[0].status === 200 ? d : other;
  const waiting = await status(cap); assert.equal(waiting.body.stage, 'AWAITING_CONFIRMATION');
  assert.equal(waiting.body.publicKey.challenge, chosen.descriptor.publicKey.challenge);
  assert.match(waiting.body.deviceFingerprint, /^[a-f0-9]{64}$/); inert(waiting.body);
  assert.equal((await post('register', { registration: chosen.registration }, cap)).status, 200);
  const bad = structuredClone(chosen.assertion); bad.response.signature = b64(Buffer.alloc(70, 7));
  assert.equal((await post('assert', { assertion: bad }, cap)).status, 403);
  const completed = await post('assert', { assertion: chosen.assertion }, cap); assert.equal(completed.status, 200);
  assert.equal(completed.body.stage, 'COMPLETED'); inert(completed.body); assert.equal(completed.body.publicKey, undefined);
  assert.equal((await post('assert', { assertion: chosen.assertion }, cap)).status, 200);
  assert.equal((await post('assert', { assertion: bad }, cap)).status, 409);
  const owner = await result(); assert.deepEqual(owner.body.registration, chosen.registration);
  assert.deepEqual(owner.body.assertion, chosen.assertion); assert.equal(owner.body.setupDescriptorSha256, chosen.descriptor.setupDescriptorSha256);
  assert.equal(owner.body.setupDescriptor, chosen.descriptor.setupDescriptor); inert(owner.body);
  assert.equal(JSON.stringify(owner.body).includes(cap), false);
  assert.equal((await request('result', { headers: { origin: ORIGIN, 'x-stephanos-pairing-capture': cap } })).status, 403);
  const browser = (await status(cap)).body;
  for (const value of [cap, TOKEN, context.operatorSid, context.machineHash, chosen.registration.response.attestationObject])
    assert.equal(JSON.stringify(browser).includes(value), false);
}));

test('concurrent owner arms reserve one observation and do not replace an active draft', async () => {
  let release, observations = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await withServer(async ({ arm }) => {
    const first = arm();
    while (observations === 0) await new Promise(resolve => setTimeout(resolve, 1));
    const second = await arm(); assert.equal(second.status, 409);
    release(); const admitted = await first; assert.equal(admitted.status, 200);
    assert.equal((await arm()).body.captureUrl, admitted.body.captureUrl); assert.equal(observations, 1);
  }, { mobileInstallationProvider: { observe: async () => {
    observations++; await gate;
    return { nativeObservation: { reason: 'MOBILE_INSTALL_ENROLLMENT_MISSING', enrollmentObservation: { state: 'MISSING' } } };
  } } });
});

test('expiry cannot extend a capture, return options or imply enrollment, and handler restart loses only inert capture', async () => {
  let oldCap;
  await withServer(async ({ arm, advance, status, post, result }) => {
    oldCap = capOf(await arm()); await post('begin-create', {}, oldCap); advance(900000);
    const expired = await status(oldCap); assert.equal(expired.status, 410); assert.equal(expired.body.stage, 'EXPIRED'); inert(expired.body);
    assert.equal(expired.body.publicKey, undefined); assert.equal((await result()).body.registration, undefined);
    assert.equal((await arm()).status, 400);
  });
  await withServer(async ({ status, result }) => {
    assert.equal((await status(oldCap)).status, 403); assert.equal((await result()).body.stage, 'UNKNOWN');
  });
});

test('pairing wiring uses existing auth and handler contains no file/process/durable capture implementation', () => {
  const handler = readFileSync(new URL('./battle-bridge-caravan-http-v1.mjs', import.meta.url), 'utf8');
  const commander = readFileSync(new URL('./sovereign-commander-http.mjs', import.meta.url), 'utf8');
  assert.match(commander, /privateOwnerAuthorized: req => safeTokenEqual\(bearerToken\(req\), token\)/);
  assert.doesNotMatch(handler, /node:fs|node:child_process|writeFile|readFile|localStorage|console\.log/);
});
