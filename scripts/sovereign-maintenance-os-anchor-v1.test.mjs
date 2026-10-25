import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createMaintenanceOsAnchorV1 } from './sovereign-maintenance-os-anchor-v1.mjs';

const key = 'fixture-os-anchor-key-'.repeat(3);
const workspaceRoot = join(tmpdir(), 'anchor-fixture');
function result(recordId, actualId = recordId) {
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const transitionId = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  const previousRecordId = null;
  const stateBase64 = Buffer.from('fixture-state').toString('base64');
  const mac = createHmac('sha256', key).update('stephanos-maintenance-os-anchor-v2\0'
    + scope + '\0' + recordId + '\0NONE\0' + transitionId + '\0' + stateBase64).digest('hex');
  return { found: true, eventRecordId: actualId,
    envelopeBase64: Buffer.from(JSON.stringify({ scope, recordId, previousRecordId, transitionId, stateBase64, mac })).toString('base64') };
}
test('OS record identity rejects a replayed authentic event at a newer sequence', () => {
  let payload = result(100);
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: () => ({ status: 0, stdout: JSON.stringify(payload) }) });
  assert.equal(anchor.readLatest().eventRecordId, 100);
  payload = result(100, 101);
  assert.throws(() => anchor.readLatest(), /IDENTITY_INVALID/);
  payload = result(100);
  const forged = JSON.parse(Buffer.from(payload.envelopeBase64, 'base64'));
  forged.stateBase64 = Buffer.from('forged-idle').toString('base64');
  payload.envelopeBase64 = Buffer.from(JSON.stringify(forged)).toString('base64');
  assert.throws(() => anchor.readLatest(), /AUTHENTICATION_FAILED/);
});
test('missing/failed OS evidence never falls back to a local green record or exposes the key in arguments', () => {
  let payload = { found: false };
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: (exe, args, options) => {
      assert.equal(args.some(value => value.includes(key)), false);
      assert.equal(options.shell, false);
      return { status: 0, stdout: JSON.stringify(payload) };
    } });
  assert.equal(anchor.readLatest(), null);
  payload = { ok: false };
  assert.throws(() => anchor.readLatest(), /IDENTITY_INVALID/);
});
test('a stalled adapter reports only closed diagnostic codes without exposing native errors or credentials', () => {
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: () => ({ status: null, error: { code: 'ETIMEDOUT', message: key },
      stderr: 'private native error ' + key + '\nSOVEREIGN_ANCHOR_STAGE=QUERY_OPEN\n' }) });
  assert.throws(() => anchor.readLatest(), error => error.message === 'MAINTENANCE_OS_ANCHOR_UNPROVEN'
    && error.stage === 'QUERY_OPEN' && error.failureKind === 'TIMEOUT'
    && !JSON.stringify(error).includes(key));
});
test('event payload cannot inject native record metadata and the key-handling script loads no JSON modules', () => {
  const payload = result(100);
  payload.envelopeBase64 = Buffer.from('{"scope":"fake"},"eventRecordId":100,"envelope":{}').toString('base64');
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: () => ({ status: 0, stdout: JSON.stringify(payload) }) });
  assert.throws(() => anchor.readLatest(), /ENCODING_INVALID/);
  const script = readFileSync(new URL('./windows/sovereign-maintenance-audit-anchor.ps1', import.meta.url), 'utf8');
  assert.match(script, /\$PSModuleAutoLoadingPreference\s*=\s*'None'/);
  assert.doesNotMatch(script, /Convert(?:To|From)-Json|Import-Module|Add-Type/);
});
test('actual Windows fixture appends and retrieves an OS-owned anchor in an isolated non-production namespace',
  { skip: process.platform !== 'win32' }, () => {
    const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: join(tmpdir(), 'custody-os-proof-' + randomUUID()), signingKey: key });
    assert.equal(anchor.readLatest(), null);
    const bytes = Buffer.from(JSON.stringify({ fixture: true, productionAuthority: false }));
    const written = anchor.append(bytes, { expectedRecordId: null });
    assert.ok(written.eventRecordId > 0);
    assert.deepEqual(anchor.readLatest().bytes, bytes);
  });

test('real Windows contenders cannot both replace the same previous anchor', { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
  const root = join(tmpdir(), 'custody-os-cas-proof-' + randomUUID());
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: root, signingKey: key });
  const initial = anchor.append(Buffer.from('fixture-idle'), { expectedRecordId: null });
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createMaintenanceOsAnchorV1 } = await import(workerData.moduleUrl);
      const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: workerData.root, signingKey: workerData.key });
      parentPort.once('message', () => {
        try {
          const result = anchor.append(Buffer.from(workerData.value), { expectedRecordId: workerData.previous });
          parentPort.postMessage({ ok: true, recordId: result.eventRecordId });
        } catch (error) { parentPort.postMessage({ ok: false, blocker: error.message }); }
        parentPort.close();
      });
      parentPort.postMessage({ ready: true });
    })();`;
  const workers = ['fixture-active-a', 'fixture-active-b'].map(value => new Worker(workerSource, { eval: true,
    workerData: { moduleUrl: new URL('./sovereign-maintenance-os-anchor-v1.mjs', import.meta.url).href,
      root, key, value, previous: initial.eventRecordId } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
    worker.on('message', message => { if (message.ready) resolve(); }); worker.once('error', reject);
  })));
  const results = workers.map(worker => new Promise((resolve, reject) => {
    worker.on('message', message => { if (typeof message.ok === 'boolean') resolve(message); }); worker.once('error', reject);
  }));
  workers.forEach(worker => worker.postMessage('go'));
  const completed = await Promise.all(results);
  assert.equal(completed.filter(result => result.ok).length, 1);
  assert.equal(anchor.readLatest().eventRecordId, completed.find(result => result.ok).recordId);
});
