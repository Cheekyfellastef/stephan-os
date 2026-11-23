import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBattleBridgeCaravanPageV1 } from './battle-bridge-caravan-page-v1.mjs';

const cap = '1'.repeat(64), context = '2'.repeat(64), origin = 'https://bridge.stephanos.example';
const encoded = (length, value = 1) => Buffer.alloc(length, value).toString('base64url');
const array = (length, value = 1) => Uint8Array.from(Buffer.alloc(length, value)).buffer;
const creation = () => ({ rp: { id: 'bridge.stephanos.example', name: 'Stephanos' },
  user: { id: encoded(32), name: 'operator', displayName: 'operator' }, challenge: encoded(32, 2),
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }, attestation: 'none' });
const confirmation = () => ({ rpId: 'bridge.stephanos.example', challenge: encoded(32, 3),
  userVerification: 'required', allowCredentials: [{ type: 'public-key', id: encoded(24, 4) }] });
const credential = kind => ({ id: encoded(24, 4), rawId: array(24, 4), type: 'public-key',
  response: kind === 'create' ? { clientDataJSON: array(10), attestationObject: array(200) }
    : { clientDataJSON: array(10), authenticatorData: array(37), signature: array(70), userHandle: array(32) } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 5; n++) await new Promise(setImmediate); };

async function page({ onFetch, onCreate = async () => credential('create'), onGet = async () => credential('get'),
  secure = true, hash = '#pairing=' + cap, storedStage = 'ARMED', installCanApprove = false, historyFailure = false } = {}) {
  const html = renderBattleBridgeCaravanPageV1('3'.repeat(64)), elements = new Map();
  const requests = [], calls = [], writes = [], history = [];
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map(), classes = new Set();
    const element = { hidden: /\bhidden\b/.test(match[0]), disabled: false, textContent: '', handlers,
      addEventListener: (name, fn) => handlers.set(name, fn), classList: {
        add: x => classes.add(x), remove: x => classes.delete(x), toggle: (x, enabled) => enabled ? classes.add(x) : classes.delete(x) } };
    Object.defineProperty(element, 'innerHTML', { set() { throw Error('Untrusted HTML'); } });
    elements.set(match[1], element);
  }
  const location = { hash, hostname: new URL(origin).hostname, pathname: '/caravan', search: '' };
  const server = { stage: storedStage, contextSha256: context, createOptions: creation(), getOptions: confirmation(),
    reply(request) {
      if (request.url === '/caravan/status') return { view: { state: 'SETUP_REQUIRED', title: 'First Windows setup required',
        description: 'Not enrolled', canApprove: installCanApprove, requestId: '', receiptVerified: false, blockers: [] } };
      let publicKey;
      if (request.url.endsWith('/begin-create')) { assert.equal(this.stage, 'ARMED'); this.stage = 'CREATE_STARTED'; publicKey = this.createOptions; }
      if (request.url.endsWith('/register')) this.stage = 'AWAITING_CONFIRMATION';
      if (request.url.endsWith('/assert')) this.stage = 'COMPLETED';
      if (this.stage === 'AWAITING_CONFIRMATION') publicKey = this.getOptions;
      return { ok: true, stage: this.stage, contextSha256: this.contextSha256, sourceHead: '4'.repeat(40),
        expiresAtUtc: new Date(Date.now() + 60000).toISOString(), csrfNonce: '5'.repeat(64),
        installability: 'NOT_INSTALLABLE', executionAuthorityGranted: false, ...(publicKey ? { publicKey } : {}) };
    } };
  const document = { hidden: false, getElementById: id => { assert.ok(elements.has(id)); return elements.get(id); }, addEventListener() {} };
  const window = { isSecureContext: secure, location, history: { replaceState(...args) {
    if (historyFailure) throw Error('Cannot hide capability'); history.push(args); location.hash = '';
  } } };
  const sandbox = vm.createContext({ document, window, AbortController, atob, btoa, Uint8Array, ArrayBuffer, Date,
    localStorage: { getItem: () => null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) },
    navigator: { credentials: { create: async options => { calls.push({ kind: 'create', options }); return onCreate(options); },
      get: async options => { calls.push({ kind: 'get', options }); return onGet(options); } } },
    setTimeout: () => 1, clearTimeout() {}, fetch: async (url, init = {}) => {
      const request = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} };
      requests.push(request); const custom = await onFetch?.(request, server); const result = custom ?? server.reply(request);
      const status = result.httpStatus || 200; return { ok: status < 400, status, json: async () => result };
    } });
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(sandbox);
  await flush();
  const dispatch = id => elements.get(id).handlers.get('click')?.();
  const click = id => elements.get(id).hidden || elements.get(id).disabled ? false : dispatch(id);
  return { elements, requests, calls, writes, history, location, server, click, dispatch };
}

test('private fragment is removed before capture; status alone never creates or confirms a credential', async () => {
  const h = await page();
  assert.equal(h.location.hash, ''); assert.equal(h.history.length, 1);
  assert.equal(h.elements.get('pairing').hidden, false); assert.equal(h.elements.get('paircreate').hidden, false);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
  const request = h.requests.find(r => r.url === '/caravan/setup/status');
  assert.equal(request.headers['x-stephanos-pairing-capture'], cap);
  assert.equal(h.requests.some(r => r.url.includes(cap)), false);
});

test('each explicit device gesture captures once; completion remains separate from Windows enrollment', async () => {
  const h = await page(); await h.click('paircreate'); await flush();
  assert.equal(h.server.stage, 'AWAITING_CONFIRMATION'); assert.deepEqual(h.calls.map(c => c.kind), ['create']);
  assert.equal(h.elements.get('paircreate').hidden, true); assert.equal(h.elements.get('pairconfirm').hidden, false);
  await h.click('pairconfirm'); await flush();
  assert.deepEqual(h.calls.map(c => c.kind), ['create', 'get']); assert.equal(h.server.stage, 'COMPLETED');
  assert.equal(h.elements.get('pairingtitle').textContent, 'Device confirmation captured');
  assert.match(h.elements.get('pairingdescription').textContent, /separate administrator approval/);
  assert.match(h.elements.get('title').textContent, /First Windows setup/);
  assert.equal(h.requests.some(r => ['/caravan/approve', '/caravan/prepare', '/caravan/cancel'].includes(r.url)), false);
  assert.equal(h.calls[0].options.publicKey.pubKeyCredParams[0].alg, -7);
  assert.equal(h.calls[0].options.publicKey.attestation, 'none');
});

test('a consumed creation start cannot prompt another passkey after HTTP loss or page reload', async () => {
  const h = await page({ onFetch: (request, server) => {
    if (request.url.endsWith('/begin-create')) { server.reply(request); throw Error('reply lost'); }
  } });
  await h.click('paircreate'); await flush();
  assert.equal(h.server.stage, 'CREATE_STARTED'); assert.equal(h.calls.length, 0);
  assert.equal(h.elements.get('paircreate').hidden, true);
  await h.click('pairrefresh'); await h.click('paircreate');
  assert.equal(h.requests.filter(r => r.url.endsWith('/begin-create')).length, 1);
  const reloaded = await page({ storedStage: 'CREATE_STARTED' });
  assert.equal(reloaded.elements.get('paircreate').hidden, true); assert.equal(reloaded.calls.length, 0);
});

test('lost registration acceptance is reconciled without another creation or automatic GET', async () => {
  const h = await page({ onFetch: (request, server) => {
    if (request.url.endsWith('/register')) { server.reply(request); throw Error('reply lost'); }
  } });
  await h.click('paircreate'); await flush(); await h.click('pairrefresh');
  assert.equal(h.server.stage, 'AWAITING_CONFIRMATION'); assert.deepEqual(h.calls.map(c => c.kind), ['create']);
  assert.equal(h.elements.get('pairsend').hidden, true); assert.equal(h.elements.get('paircreate').hidden, true);
});

test('manual resend reuses the captured registration bytes and creates no second key', async () => {
  let lost = false;
  const h = await page({ onFetch: request => {
    if (request.url.endsWith('/register') && !lost) { lost = true; throw Error('not delivered'); }
  } });
  await h.click('paircreate'); await flush();
  assert.equal(h.elements.get('pairsend').hidden, false);
  const original = h.requests.find(r => r.url.endsWith('/register')).body;
  await h.click('pairsend'); await flush();
  assert.equal(h.server.stage, 'AWAITING_CONFIRMATION'); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.requests.filter(r => r.url.endsWith('/register')).map(r => r.body), [original, original]);
});

test('lost assertion acceptance is read back as completed without another device prompt', async () => {
  const h = await page({ onFetch: (request, server) => {
    if (request.url.endsWith('/assert')) { server.reply(request); throw Error('reply lost'); }
  } });
  await h.click('paircreate'); await h.click('pairconfirm'); await flush(); await h.click('pairrefresh');
  assert.equal(h.server.stage, 'COMPLETED'); assert.equal(h.calls.length, 2);
  assert.equal(h.elements.get('pairconfirm').hidden, true); assert.equal(h.elements.get('pairsend').hidden, true);
});

for (const change of [p => { p.rp.id = 'other.example'; }, p => { p.pubKeyCredParams[0].alg = -257; },
  p => { p.authenticatorSelection.userVerification = 'preferred'; }, p => { p.challenge = encoded(8); }]) {
  test('changed registration options fail before authenticator invocation', async () => {
    const h = await page(); change(h.server.createOptions); await h.click('paircreate'); await flush();
    assert.equal(h.calls.length, 0); assert.equal(h.requests.some(r => r.url.endsWith('/register')), false);
  });
}

test('insecure origin cannot create a credential', async () => {
  const h = await page({ secure: false }); await h.click('paircreate'); await flush(); assert.equal(h.calls.length, 0);
});

test('stopping a pending authenticator ignores its late result and never registers it', async () => {
  const late = deferred(), h = await page({ onCreate: () => late.promise });
  const pending = h.click('paircreate'); await flush(); assert.equal(h.calls.length, 1);
  await h.click('pairstop'); late.resolve(credential('create')); await pending; await flush();
  assert.equal(h.requests.some(r => r.url.endsWith('/register')), false);
  assert.match(h.elements.get('pairnotice').textContent, /Pairing stopped/);
  assert.equal(h.elements.get('paircreate').disabled, true);
});

test('a changed capture context cannot invoke create or become the selected setup silently', async () => {
  const h = await page(); h.server.contextSha256 = '6'.repeat(64); await h.click('paircreate'); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.elements.get('paircreate').hidden, true);
  assert.equal(h.requests.some(r => r.url.endsWith('/register')), false);
});

test('pairing mode never exposes installation approval even if another status read offers it', async () => {
  const h = await page({ installCanApprove: true });
  assert.equal(h.elements.get('approve').hidden, true); await h.dispatch('approve');
  assert.equal(h.requests.some(r => r.url === '/caravan/prepare'), false);
});

test('an invalid fragment or inability to remove its capability never arms browser capture', async () => {
  for (const options of [{ hash: '#pairing=invalid' }, { hash: '' }, { historyFailure: true }]) {
    const h = await page(options); assert.equal(h.elements.get('pairing').hidden, true);
    assert.equal(h.requests.some(r => r.url.startsWith('/caravan/setup/')), false); assert.equal(h.calls.length, 0);
  }
});

test('an authenticated expired capture is displayed as expired and cannot offer new authentication', async () => {
  const h = await page({ onFetch: (request, server) => {
    if (request.url === '/caravan/setup/status') return { ...server.reply(request), stage: 'EXPIRED', httpStatus: 410 };
  } });
  assert.equal(h.elements.get('pairingtitle').textContent, 'Pairing has expired');
  assert.equal(h.elements.get('paircreate').hidden, true); assert.equal(h.elements.get('pairconfirm').hidden, true);
  await h.dispatch('paircreate'); await h.dispatch('pairconfirm'); assert.equal(h.calls.length, 0);
});

test('a late refresh cannot reopen the pairing after Stop pairing', async () => {
  const late = deferred(); let reads = 0;
  const h = await page({ onFetch: (request, server) => {
    if (request.url === '/caravan/setup/status' && ++reads > 1) return late.promise;
  } });
  const pending = h.click('pairrefresh'); await flush(); await h.click('pairstop');
  late.resolve(h.server.reply({ url: '/caravan/setup/status' })); await pending; await flush();
  assert.match(h.elements.get('pairnotice').textContent, /Pairing stopped/);
  assert.equal(h.elements.get('paircreate').disabled, true); assert.equal(h.calls.length, 0);
});
