import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBattleBridgeCaravanPageV1 } from './battle-bridge-caravan-page-v1.mjs';

const REQUEST = 'mobile-install-request-0001';
const STORAGE = 'stephanos.caravan.installation.request.v1';
const SUBMITTED = STORAGE + '.submitted';
const candidateDigest = 'a'.repeat(64);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };
const view = fields => ({ state: 'AWAITING_APPROVAL', title: 'Approve this installation', description: 'Reviewed update',
  canApprove: true, requestId: REQUEST, candidateSha256: candidateDigest, observedAtUtc: '2026-11-14T13:00:00.000Z',
  sequence: 1, sourceHead: 'b'.repeat(40), packageSha256: 'c'.repeat(64), blockers: [], receiptVerified: true, ...fields });
const options = () => ({ challenge: Buffer.alloc(32, 1).toString('base64url'), rpId: 'battlebridge.example.com',
  allowCredentials: [{ type: 'public-key', id: Buffer.alloc(32, 2).toString('base64url') }], userVerification: 'required' });
const credential = () => ({ id: Buffer.alloc(32, 2).toString('base64url'), rawId: Uint8Array.from([1, 2]).buffer,
  type: 'public-key', response: { clientDataJSON: Uint8Array.from([3]).buffer,
    authenticatorData: Uint8Array.from([4]).buffer, signature: Uint8Array.from([5]).buffer, userHandle: null } });

async function page({ onFetch = () => ({ view: view() }), getCredential = async () => credential(), storage = new Map() } = {}) {
  const html = renderBattleBridgeCaravanPageV1('d'.repeat(64));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the real page exposes its inline script');
  const elements = new Map(), requests = [], credentials = [], timers = new Map(), documentEvents = new Map();
  let timerId = 0;
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map(), classes = new Set();
    const element = { hidden: /\bhidden\b/.test(match[0]), disabled: /\bdisabled\b/.test(match[0]), textContent: '', handlers,
      addEventListener: (name, handler) => handlers.set(name, handler),
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value), contains: value => classes.has(value) } };
    Object.defineProperty(element, 'innerHTML', { set() { throw Error('Response data must never use innerHTML'); } });
    elements.set(match[1], element);
  }
  const document = { hidden: false, getElementById: id => {
    assert.ok(elements.has(id), `missing real page element ${id}`); return elements.get(id);
  }, addEventListener: (name, handler) => documentEvents.set(name, handler) };
  const context = vm.createContext({ document, window: { isSecureContext: true }, AbortController,
    navigator: { credentials: { get: async request => { credentials.push(request); return getCredential(request); } } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    atob, btoa, Uint8Array, ArrayBuffer, Date, console,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init = {}) => {
      const request = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
      requests.push(request); const response = await onFetch(request, { storage, requests });
      return { ok: (response?.httpStatus ?? 200) < 400, json: async () => response };
    },
  });
  new vm.Script(script, { filename: 'real-caravan-inline-script.js' }).runInContext(context);
  const dispatch = id => elements.get(id).handlers.get('click')?.();
  const click = id => {
    const element = elements.get(id);
    if (element.disabled || element.hidden) return false;
    return dispatch(id);
  };
  await flush();
  return { elements, requests, credentials, storage, timers, document, documentEvents, dispatch, click };
}

test('page script starts with one read; setup cannot offer or dispatch approval', async () => {
  const h = await page({ onFetch: () => ({ view: view({ state: 'SETUP_REQUIRED', canApprove: false, requestId: null, receiptVerified: false }) }) });
  assert.equal(h.elements.get('pill').textContent, 'Setup required');
  assert.equal(h.elements.get('approve').hidden, true);
  await h.dispatch('approve'); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/caravan/status');
  assert.equal(h.requests[0].method, 'GET'); assert.equal(h.credentials.length, 0);
});

test('initial network failure shows an explicit unknown outcome without credentials or POST', async () => {
  const h = await page({ onFetch: () => { throw Error('Starlink unavailable'); } });
  assert.equal(h.elements.get('title').textContent, 'Connection interrupted');
  assert.equal(h.elements.get('pill').textContent, 'Unconfirmed');
  assert.equal(h.elements.get('connection').textContent, 'Connection unavailable');
  assert.equal(h.elements.get('dot').classList.contains('live'), false);
  assert.equal(h.elements.get('approve').hidden, true);
  await h.dispatch('approve'); await flush();
  assert.equal(h.credentials.length, 0); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/caravan/status'); assert.equal(h.requests[0].method, 'GET');
});

test('Not now before approval performs no mutation and keeps approval hidden on refresh', async () => {
  const h = await page(); await h.click('later'); await h.click('approve'); await h.click('refresh'); await flush();
  assert.equal(h.credentials.length, 0); assert.equal(h.requests.every(request => request.method === 'GET'), true);
  assert.equal(h.elements.get('approve').hidden, true);
  assert.match(h.elements.get('notice').textContent, /No approval has been sent/);
});

test('explicit cancel sends only the original request, follows its signed result and never requests credentials', async () => {
  let cancelled = false;
  const h = await page({ onFetch: request => {
    if (request.url === '/caravan/cancel') cancelled = true;
    return { csrfNonce: 'e'.repeat(64), view: cancelled ? view({ state: 'CANCELLED', sequence: 2, canApprove: false }) : view() };
  } });
  assert.equal(h.elements.get('cancelrequest').hidden, false);
  await h.click('cancelrequest'); await flush();
  const requests = h.requests.filter(request => request.method === 'POST');
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/caravan/cancel');
  assert.equal(JSON.stringify(requests[0].body), JSON.stringify({ requestId: REQUEST }));
  assert.equal(h.credentials.length, 0); assert.equal(h.elements.get('pill').textContent, 'Cancelled');
  assert.equal(h.elements.get('approve').hidden, true); assert.equal(h.elements.get('newrequest').hidden, false);
});

test('interrupted cancellation retains the request and suppresses approval after refresh', async () => {
  const h = await page({ onFetch: request => {
    if (request.url === '/caravan/cancel') throw Error('network lost'); return { view: view() };
  } });
  await h.click('cancelrequest'); await flush();
  assert.equal(h.storage.get(STORAGE), REQUEST); assert.equal(h.storage.get(SUBMITTED), REQUEST);
  assert.equal(h.elements.get('approve').hidden, true); assert.equal(h.credentials.length, 0);
  assert.match(h.elements.get('notice').textContent, /Cancellation needs confirmation/);
});

test('Not now cancels a delayed prepare before it can request device confirmation', async () => {
  const gate = deferred();
  const h = await page({ onFetch: request => request.url === '/caravan/prepare' ? gate.promise : { view: view() } });
  const pending = h.click('approve'); await flush();
  assert.equal(h.elements.get('later').disabled, false);
  await h.click('later'); gate.resolve({ view: view(), publicKey: options() }); await pending; await flush();
  assert.equal(h.credentials.length, 0); assert.equal(h.requests.some(request => request.url === '/caravan/approve'), false);
  assert.equal(h.elements.get('approve').hidden, true);
});

test('Not now during device confirmation cannot submit its late result', async () => {
  const gate = deferred();
  const h = await page({ onFetch: request => request.url === '/caravan/prepare'
    ? { view: view(), publicKey: options() } : { view: view() }, getCredential: () => gate.promise });
  const pending = h.click('approve'); await flush(); assert.equal(h.credentials.length, 1);
  assert.equal(h.elements.get('later').disabled, false);
  await h.click('later'); gate.resolve(credential()); await pending; await flush();
  assert.equal(h.requests.some(request => request.url === '/caravan/approve'), false);
  assert.equal(h.elements.get('approve').hidden, true);
});

test('a stale refresh during approval or after cancellation cannot reopen the approval', async () => {
  for (const phase of ['during-approval', 'after-cancellation']) {
    const stale = deferred(), prepare = deferred(), device = deferred(); let reads = 0;
    const h = await page({ onFetch: request => {
      if (request.url === '/caravan/prepare') return phase === 'during-approval'
        ? { view: view(), publicKey: options() } : prepare.promise;
      return ++reads === 1 ? { view: view() } : stale.promise;
    }, getCredential: () => device.promise });
    const oldRead = h.click('refresh'); const pendingApproval = h.click('approve'); await flush();
    if (phase === 'after-cancellation') await h.click('later');
    stale.resolve({ view: view({ title: 'Stale refresh must not replace the view', sequence: 99 }) });
    await oldRead; await flush();
    assert.notEqual(h.elements.get('title').textContent, 'Stale refresh must not replace the view', phase);
    if (phase === 'during-approval') {
      assert.equal(h.elements.get('approve').disabled, true);
      await h.click('later');
    }
    prepare.resolve({ view: view(), publicKey: options() }); device.resolve(credential());
    await pendingApproval; await flush();
    assert.equal(h.elements.get('approve').hidden, true, phase);
    assert.equal(h.requests.some(request => request.url === '/caravan/approve'), false, phase);
  }
});

for (const change of [{ requestId: 'mobile-install-request-0002' }, { candidateSha256: 'e'.repeat(64) }]) {
  test(`changed prepare ${Object.keys(change)[0]} needs fresh review before credentials`, async () => {
    const h = await page({ onFetch: request => request.url === '/caravan/prepare'
      ? { view: view(change), publicKey: options() } : { view: view() } });
    await h.click('approve'); await flush();
    const prepare = h.requests.find(request => request.url === '/caravan/prepare');
    assert.deepEqual(prepare.body, { requestId: REQUEST, candidateSha256: candidateDigest });
    assert.equal(h.credentials.length, 0); assert.equal(h.requests.some(request => request.url === '/caravan/approve'), false);
  });
}

test('submission is persisted before send; interrupted send reloads as reconciliation only', async () => {
  const storage = new Map(); let persistedBeforeSend = false;
  const h = await page({ storage, onFetch: (request, state) => {
    if (request.url === '/caravan/prepare') return { view: view(), publicKey: options() };
    if (request.url === '/caravan/approve') {
      persistedBeforeSend = state.storage.get(SUBMITTED) === REQUEST && state.storage.get(STORAGE) === REQUEST;
      throw Error('Starlink disconnected after send');
    }
    return { view: view() };
  } });
  await h.click('approve'); await flush();
  assert.equal(persistedBeforeSend, true); assert.equal(h.elements.get('approve').hidden, true);
  assert.equal(h.requests.filter(request => request.url === '/caravan/approve').length, 1);
  await h.dispatch('approve'); await h.click('refresh'); await flush();
  assert.equal(h.requests.filter(request => request.url === '/caravan/approve').length, 1);
  const reloaded = await page({ storage }); await reloaded.dispatch('approve'); await flush();
  assert.equal(reloaded.requests[0].url, '/caravan/reconcile?requestId=' + REQUEST);
  assert.equal(reloaded.requests.every(request => request.method === 'GET'), true);
  assert.equal(reloaded.elements.get('approve').hidden, true); assert.equal(reloaded.credentials.length, 0);
});

test('reconnect retains the original request and poll performs only GET', async () => {
  const storage = new Map([[STORAGE, REQUEST], [SUBMITTED, REQUEST]]);
  const h = await page({ storage, onFetch: () => ({ view: view({ state: 'INSTALLING', canApprove: false }) }) });
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; await timer.callback(); await flush();
  assert.ok(h.requests.length >= 2);
  assert.equal(h.requests.every(request => request.method === 'GET' && request.url === '/caravan/reconcile?requestId=' + REQUEST), true);
});

test('signed lower-sequence same-request response cannot regress the visible result', async () => {
  let reads = 0;
  const h = await page({ onFetch: () => ({ view: ++reads === 1
    ? view({ state: 'READY', title: 'Qualified runtime', canApprove: false, sequence: 9 })
    : view({ state: 'INSTALLING', title: 'Old installation state', canApprove: false, sequence: 8 }) }) });
  await h.click('refresh'); await flush();
  assert.equal(h.elements.get('title').textContent, 'Qualified runtime');
  assert.equal(h.elements.get('pill').textContent, 'Ready');
  assert.equal(h.elements.get('pill').classList.contains('ready'), true);
});

for (const [state, label] of [['READY', 'Ready'], ['FAILED', 'Failed'], ['CANCELLED', 'Cancelled']]) {
  test(`${state} has its canonical label and Check for updates only starts a fresh read`, async () => {
    const storage = new Map([[STORAGE, REQUEST], [SUBMITTED, REQUEST]]); let reads = 0;
    const h = await page({ storage, onFetch: () => ({ view: ++reads === 1 ? view({ state, canApprove: false, sequence: 4 })
      : view({ state: 'SETUP_REQUIRED', canApprove: false, requestId: null, receiptVerified: false }) }) });
    assert.equal(h.elements.get('pill').textContent, label); assert.equal(h.elements.get('newrequest').hidden, false);
    h.click('newrequest'); await flush();
    assert.equal(storage.has(SUBMITTED), false); assert.equal(storage.has(STORAGE), false);
    assert.equal(h.requests.at(-1).url, '/caravan/status'); assert.equal(h.requests.every(request => request.method === 'GET'), true);
  });
}

test('uncertain or unsigned state cannot reset an outstanding request', async () => {
  const storage = new Map([[STORAGE, REQUEST], [SUBMITTED, REQUEST]]);
  const h = await page({ storage, onFetch: () => ({ view: view({ state: 'UNKNOWN', canApprove: false, receiptVerified: false }) }) });
  assert.equal(h.elements.get('newrequest').hidden, true); await h.dispatch('newrequest'); await flush();
  assert.equal(storage.get(SUBMITTED), REQUEST); assert.equal(h.requests.length, 1);
});

test('response strings are displayed as text and never interpreted as HTML', async () => {
  const hostile = '<img src=x onerror="globalThis.compromised=true">';
  const h = await page({ onFetch: () => ({ view: view({ title: hostile, description: hostile, blockers: [hostile] }) }) });
  assert.equal(h.elements.get('title').textContent, hostile); assert.equal(h.elements.get('description').textContent, hostile);
  assert.equal(h.elements.get('reason').textContent, hostile); assert.equal(h.elements.get('connection').textContent, 'Commander connected');
});
