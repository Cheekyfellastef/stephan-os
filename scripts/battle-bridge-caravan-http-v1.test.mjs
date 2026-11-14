import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createSovereignCommanderHttpServer } from './sovereign-commander-http.mjs';
import { publicCaravanObservationV1 } from './battle-bridge-caravan-http-v1.mjs';
import {
  MOBILE_INSTALLATION_CANDIDATE_SCHEMA, MOBILE_INSTALLATION_ENROLLMENT_SCHEMA,
  MOBILE_INSTALLATION_RECEIPT_SCHEMA, MOBILE_INSTALLATION_ACTION,
  mobileInstallationCandidateDigestV1, mobileInstallationChallengeV1,
  canonicalMobileInstallationReceiptV1,
} from '../shared/agents/battleBridgeMobileInstallationV1.mjs';

const NOW = Date.parse('2026-11-14T15:00:00.000Z');
const iso = offset => new Date(NOW + offset).toISOString();
const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const receiptKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = pair => pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const baseCandidate = {
  schemaVersion: MOBILE_INSTALLATION_CANDIDATE_SCHEMA, repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 1814, action: MOBILE_INSTALLATION_ACTION, requestId: 'mobile-install-http-request-0001',
  nonce: 'a'.repeat(64), machineHash: 'b'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001',
  sourceHead: 'c'.repeat(40), sourceTree: 'd'.repeat(40), packageSha256: 'e'.repeat(64),
  closureSha256: 'f'.repeat(64), releaseProofSha256: '1'.repeat(64), enrollmentGeneration: 1,
  requestedAtUtc: iso(0), expiresAtUtc: iso(240_000),
};
const enrollment = {
  schemaVersion: MOBILE_INSTALLATION_ENROLLMENT_SCHEMA, machineHash: baseCandidate.machineHash,
  operatorSid: baseCandidate.operatorSid, generation: 1, rpId: 'battlebridge.example.com',
  origin: 'https://battlebridge.example.com', credentialId: b64(Buffer.alloc(32, 7)),
  publicKeySpki: spki(keys), userHandle: b64('operator-1'), lastSignCount: 0,
  revoked: false, receiptPublicKeySpki: spki(receiptKeys),
};
function signedReceipt(candidate, state = 'AWAITING_APPROVAL', sequence = 1, fields = {}) {
  const payload = {
    schemaVersion: MOBILE_INSTALLATION_RECEIPT_SCHEMA, requestId: candidate.requestId,
    candidateSha256: mobileInstallationCandidateDigestV1(candidate), machineHash: candidate.machineHash,
    enrollmentGeneration: 1, sequence, state, observedAtUtc: iso(0),
    sourceHead: candidate.sourceHead, packageSha256: candidate.packageSha256,
    retainedProcessId: null, executionStartedAtUtc: null, installedHelperSha256: null,
    installationBootId: null, qualifiedBootId: null, reasonCode: 'RELEASE_ELIGIBLE', ...fields,
  };
  return { payload, signature: sign('sha256', Buffer.from(canonicalMobileInstallationReceiptV1(payload)), receiptKeys.privateKey).toString('base64url') };
}
function assertion(candidate = baseCandidate, changes = {}) {
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', origin: enrollment.origin,
    challenge: mobileInstallationChallengeV1(candidate), crossOrigin: false, ...changes }));
  const auth = Buffer.alloc(37); hash(enrollment.rpId).copy(auth); auth[32] = 5;
  return { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId, response: {
    clientDataJSON: b64(client), authenticatorData: b64(auth), userHandle: enrollment.userHandle,
    signature: sign('sha256', Buffer.concat([auth, hash(client)]), keys.privateKey).toString('base64url'),
  } };
}
function fixture() {
  let candidate = { ...baseCandidate }, receipt = signedReceipt(candidate), calls = [];
  const snapshot = () => ({ candidate, enrollment, receipt, minimumSequence: receipt.payload.sequence });
  const provider = {
    observe: async () => snapshot(), prepare: async () => snapshot(), reconcile: async () => snapshot(),
    approve: async request => { calls.push(request); receipt = signedReceipt(candidate, 'APPROVAL_RECORDED', 2); return snapshot(); },
  };
  return { provider, snapshot, calls, setCandidate(c) { candidate = c; receipt = signedReceipt(c); },
    setReceipt(r) { receipt = r; } };
}
async function withServer(action, provider, settings = {}) {
  const app = await createSovereignCommanderHttpServer({
    token: 't'.repeat(48), port: 0, nowMs: () => NOW, continuousRepairEnabled: false,
    mobileInstallationProvider: provider, ...settings,
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function nonce() {
    const response = await fetch(base + '/caravan'); const html = await response.text();
    assert.equal(response.status, 200); return /let nonce="([a-f0-9]{64})"/.exec(html)[1];
  }
  async function post(path, body, csrf = undefined, headers = {}) {
    const response = await fetch(base + '/caravan/' + path, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: base,
        'x-stephanos-caravan-nonce': csrf ?? await nonce(), ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  try { return await action({ base, nonce, post, app }); }
  finally { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
}
const prepareBody = candidate => ({ requestId: candidate.requestId, candidateSha256: mobileInstallationCandidateDigestV1(candidate) });

test('default production adapter refuses native approval and reveals no fake ready state', async () => withServer(async ({ base, post }) => {
  const response = await fetch(base + '/caravan/status'); const result = await response.json();
  assert.equal(result.view.canApprove, false); assert.equal(result.view.receiptVerified, false);
  const denied = await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() });
  assert.equal(denied.status, 409); assert.equal(denied.body.view.canApprove, false);
}));

test('caravan page and current private server share one listener without exposing bearer or Windows identity', async () => {
  const f = fixture();
  await withServer(async ({ base }) => {
    const page = await fetch(base + '/caravan'); const html = await page.text();
    assert.match(html, /Open spatial workspace/); assert.match(html, /href="\/ignite"/);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const current = await (await fetch(base + '/caravan/status')).json();
    assert.equal(current.view.canApprove, true); assert.equal(current.view.receiptVerified, true);
    const combined = html + JSON.stringify(current);
    for (const privateValue of ['t'.repeat(48), enrollment.operatorSid, enrollment.userHandle,
      enrollment.publicKeySpki, enrollment.receiptPublicKeySpki]) assert.equal(combined.includes(privateValue), false);
    assert.equal((await (await fetch(base + '/health')).json()).caravanPath, '/caravan');
  }, f.provider);
});

test('real cryptographic approval passes original evidence once to native adapter without approval booleans', async () => {
  const f = fixture();
  await withServer(async ({ post }) => {
    const prepared = await post('prepare', prepareBody(baseCandidate));
    assert.equal(prepared.status, 200); assert.equal(prepared.body.publicKey.userVerification, 'required');
    assert.equal(prepared.body.publicKey.challenge, mobileInstallationChallengeV1(baseCandidate));
    const original = { requestId: baseCandidate.requestId, assertion: assertion() };
    const outcome = await post('approve', original, prepared.body.csrfNonce);
    assert.equal(outcome.status, 200); assert.equal(outcome.body.view.state, 'APPROVAL_RECORDED');
    assert.equal(outcome.body.view.receiptVerified, true);
    assert.deepEqual(f.calls, [original]);
    const duplicate = await post('approve', original);
    assert.equal(duplicate.status, 409); assert.equal(f.calls.length, 1);
  }, f.provider);
});

test('origin, nonce, shape and signature refusals never call native approve', async () => {
  const f = fixture();
  await withServer(async ({ base, nonce, post }) => {
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() }, 'invalid')).status, 403);
    const n = await nonce();
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() }, n, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() }, n, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: assertion(), enrollment })).status, 400);
    assert.equal((await post('prepare', { approved: true, command: 'install' })).status, 400);
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: assertion(baseCandidate, { origin: 'https://evil.example' }) })).status, 403);
    const bad = assertion(); bad.response.signature = b64(Buffer.alloc(70, 7));
    assert.equal((await post('approve', { requestId: baseCandidate.requestId, assertion: bad })).status, 403);
    const malformed = await fetch(base + '/caravan/approve', { method: 'POST', headers: {
      origin: base, 'content-type': 'text/plain', 'x-stephanos-caravan-nonce': await nonce(),
    }, body: '{}' });
    assert.equal(malformed.status, 415); assert.equal(f.calls.length, 0);
  }, f.provider);
});

test('consumed or expired CSRF nonce cannot prepare again', async () => {
  const f = fixture(); let clock = NOW;
  await withServer(async ({ nonce, post }) => {
    const n = await nonce();
    assert.equal((await post('prepare', prepareBody(baseCandidate), n)).status, 200);
    assert.equal((await post('prepare', prepareBody(baseCandidate), n)).status, 403);
    const expired = await nonce(); clock += 300_001;
    assert.equal((await post('prepare', prepareBody(baseCandidate), expired)).status, 403);
  }, f.provider, { nowMs: () => clock });
});

test('package movement is presented for fresh review before a device challenge is returned', async () => {
  const f = fixture();
  f.setCandidate({ ...baseCandidate, packageSha256: '2'.repeat(64) });
  await withServer(async ({ post }) => {
    const result = await post('prepare', prepareBody(baseCandidate));
    assert.equal(result.status, 409); assert.equal(result.body.publicKey, undefined);
    assert.match(result.body.message, /changed/); assert.equal(f.calls.length, 0);
  }, f.provider);
});

test('uncertain dispatch retains request and redacts private exception text', async () => {
  const f = fixture(); let calls = 0;
  f.provider.approve = async () => { calls++; throw Error('secret C:\\private\\token'); };
  await withServer(async ({ post, base }) => {
    const result = await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() });
    assert.equal(result.status, 503); assert.equal(result.body.view.state, 'UNKNOWN');
    assert.equal(result.body.view.requestId, baseCandidate.requestId); assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    const reconciled = await (await fetch(base + '/caravan/reconcile?requestId=' + baseCandidate.requestId)).json();
    assert.equal(reconciled.view.canApprove, false);
    const repeated = await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() });
    assert.equal(repeated.status, 409);
    assert.equal(calls, 1);
  }, f.provider);
});

test('concurrent approval is held while health remains responsive', async () => {
  const f = fixture(); let release, started;
  const began = new Promise(resolve => { started = resolve; });
  f.provider.approve = async request => {
    f.calls.push(request); started(); await new Promise(resolve => { release = resolve; });
    f.setReceipt(signedReceipt(baseCandidate, 'STARTING', 2)); return f.snapshot();
  };
  await withServer(async ({ post, base }) => {
    const first = post('approve', { requestId: baseCandidate.requestId, assertion: assertion() });
    await began;
    const second = await post('approve', { requestId: baseCandidate.requestId, assertion: assertion() });
    assert.equal(second.status, 409); assert.equal(f.calls.length, 1);
    assert.equal((await fetch(base + '/health?view=protocol')).status, 200);
    release(); const result = await first; assert.equal(result.body.view.state, 'STARTING');
  }, f.provider);
});

test('unsigned readiness and lower receipt sequence cannot restore an approval button', async () => {
  const f = fixture();
  await withServer(async ({ base }) => {
    f.setReceipt(signedReceipt(baseCandidate, 'STARTING', 3));
    assert.equal((await (await fetch(base + '/caravan/status')).json()).view.state, 'STARTING');
    f.setReceipt(signedReceipt(baseCandidate, 'AWAITING_APPROVAL', 1));
    const replay = await (await fetch(base + '/caravan/status')).json();
    assert.equal(replay.view.state, 'UNKNOWN'); assert.equal(replay.view.canApprove, false);
    f.setReceipt({ payload: { state: 'READY' }, signature: 'forged' });
    assert.equal((await (await fetch(base + '/caravan/status')).json()).view.receiptVerified, false);
  }, f.provider);
  const noJournal = publicCaravanObservationV1({ ...fixture().snapshot(), minimumSequence: undefined }, { nowMs: NOW });
  assert.equal(noJournal.canApprove, false);
});

test('native missing/sign-in observations are honest while arbitrary probe booleans never enable approval', () => {
  const missing = publicCaravanObservationV1({ nativeObservation: {
    reason: 'MOBILE_INSTALL_ENROLLMENT_MISSING', observedAtUtc: iso(0), enrollmentObservation: { state: 'MISSING' },
  } }, { nowMs: NOW });
  assert.equal(missing.state, 'SETUP_REQUIRED'); assert.equal(missing.canApprove, false);
  const session = publicCaravanObservationV1({ nativeObservation: { reason: 'MOBILE_INSTALL_OPERATOR_SESSION_MISSING' } }, { nowMs: NOW });
  assert.equal(session.state, 'SIGN_IN_REQUIRED');
  const forged = publicCaravanObservationV1({ nativeObservation: { state: 'READY', enrolled: true, installationAuthority: true } });
  assert.equal(forged.state, 'UNKNOWN'); assert.equal(forged.canApprove, false);
});

test('explicit cancellation uses the verified original request and fresh same-origin CSRF, never an approval', async () => {
  const f = fixture(), cancelled = [];
  f.provider.cancel = async requestId => {
    cancelled.push(requestId); f.setReceipt(signedReceipt(baseCandidate, 'CANCELLED', 2)); return f.snapshot();
  };
  await withServer(async ({ post, nonce, base }) => {
    assert.equal((await fetch(base + '/caravan/cancel?requestId=' + baseCandidate.requestId)).status, 405);
    assert.equal((await post('cancel', { requestId: baseCandidate.requestId, approved: true })).status, 400);
    assert.equal((await post('cancel', { requestId: 'mobile-install-different-0001' })).status, 409);
    assert.equal((await post('cancel', { requestId: baseCandidate.requestId }, await nonce(), { origin: 'https://foreign.example' })).status, 403);
    assert.equal(cancelled.length, 0);
    const result = await post('cancel', { requestId: baseCandidate.requestId });
    assert.equal(result.status, 200); assert.equal(result.body.view.state, 'CANCELLED');
    assert.equal(result.body.view.receiptVerified, true); assert.deepEqual(cancelled, [baseCandidate.requestId]);
    assert.equal(f.calls.length, 0);
  }, f.provider);
});

test('unproven cancellation result stays unknown and retains the original request', async () => {
  const f = fixture(); let calls = 0;
  f.provider.cancel = async () => { calls++; return { receipt: null }; };
  await withServer(async ({ post }) => {
    const result = await post('cancel', { requestId: baseCandidate.requestId });
    assert.equal(result.body.view.state, 'UNKNOWN'); assert.equal(result.body.view.receiptVerified, false);
    assert.equal(result.body.view.requestId, baseCandidate.requestId); assert.equal(calls, 1); assert.equal(f.calls.length, 0);
  }, f.provider);
});

test('an expired authenticated candidate stays unapprovable but can cancel its original native request', async () => {
  const f = fixture(), expired = { ...baseCandidate, requestedAtUtc: iso(-600000), expiresAtUtc: iso(-300000) };
  f.setCandidate(expired); let cancellations = 0;
  f.provider.cancel = async requestId => {
    assert.equal(requestId, expired.requestId); cancellations++;
    f.setReceipt(signedReceipt(expired, 'CANCELLED', 2)); return f.snapshot();
  };
  await withServer(async ({ post, base }) => {
    const current = await (await fetch(base + '/caravan/status')).json();
    assert.equal(current.view.state, 'BLOCKED'); assert.equal(current.view.canApprove, false);
    assert.equal(current.view.receiptVerified, true); assert.equal(current.view.requestId, expired.requestId);
    const cancelled = await post('cancel', { requestId: expired.requestId });
    assert.equal(cancelled.body.view.state, 'CANCELLED'); assert.equal(cancelled.body.view.receiptVerified, true);
    assert.equal(cancellations, 1); assert.equal(f.calls.length, 0);
  }, f.provider);
});

test('oversized, arbitrary query and malformed request bodies are rejected without echoing them', async () => {
  const f = fixture();
  await withServer(async ({ post, base }) => {
    const oversized = await post('approve', { requestId: baseCandidate.requestId, assertion: 'z'.repeat(25 * 1024) });
    assert.equal(oversized.status, 413); assert.equal(f.calls.length, 0);
    assert.equal((await fetch(base + '/caravan/status?path=private')).status, 400);
    assert.equal((await fetch(base + '/caravan/reconcile?requestId=bad')).status, 400);
    assert.equal((await fetch(base + '/caravan/reconcile?requestId=' + baseCandidate.requestId + '&command=install')).status, 400);
  }, f.provider);
});
