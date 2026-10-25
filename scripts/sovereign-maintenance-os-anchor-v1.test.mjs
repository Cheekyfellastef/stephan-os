import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMaintenanceOsAnchorV1 } from './sovereign-maintenance-os-anchor-v1.mjs';

const key = 'fixture-os-anchor-key-'.repeat(3);
const workspaceRoot = join(tmpdir(), 'anchor-fixture');
function result(recordId, actualId = recordId) {
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const transitionId = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  const stateBase64 = Buffer.from('fixture-state').toString('base64');
  const mac = createHmac('sha256', key).update('stephanos-maintenance-os-anchor-v1\0'
    + scope + '\0' + recordId + '\0' + transitionId + '\0' + stateBase64).digest('hex');
  return { found: true, eventRecordId: actualId, envelope: { scope, recordId, transitionId, stateBase64, mac } };
}
test('OS record identity rejects a replayed authentic event at a newer sequence', () => {
  let payload = result(100);
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: () => ({ status: 0, stdout: JSON.stringify(payload) }) });
  assert.equal(anchor.readLatest().eventRecordId, 100);
  payload = result(100, 101);
  assert.throws(() => anchor.readLatest(), /IDENTITY_INVALID/);
  payload = result(100); payload.envelope.stateBase64 = Buffer.from('forged-idle').toString('base64');
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
test('actual Windows fixture appends and retrieves an OS-owned anchor in an isolated non-production namespace',
  { skip: process.platform !== 'win32' }, () => {
    const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: join(tmpdir(), 'custody-os-proof-' + randomUUID()), signingKey: key });
    assert.equal(anchor.readLatest(), null);
    const bytes = Buffer.from(JSON.stringify({ fixture: true, productionAuthority: false }));
    const written = anchor.append(bytes);
    assert.ok(written.eventRecordId > 0);
    assert.deepEqual(anchor.readLatest().bytes, bytes);
  });
