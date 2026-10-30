import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMaintenanceOsAnchorV1 } from './sovereign-maintenance-os-anchor-v1.mjs';

const key = 'fixture-os-anchor-key-'.repeat(3);
const workspaceRoot = join(tmpdir(), 'anchor-fixture');
function result(recordId, actualId = recordId) {
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const transitionId = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  const previousRecordId = null;
  const stateBase64 = Buffer.from('fixture-state').toString('base64');
  const mac = createHmac('sha256', key).update('stephanos-maintenance-os-anchor-v3\0retained-v2-production\0'
    + scope + '\0' + recordId + '\0NONE\0' + transitionId + '\0' + stateBase64).digest('hex');
  return { found: true, journalId: 'retained-v2-production', eventRecordId: actualId,
    envelopeBase64: Buffer.from(JSON.stringify({ scope, journalId: 'retained-v2-production', recordId, previousRecordId, transitionId, stateBase64, mac })).toString('base64') };
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
  let payload = { found: false, journalId: 'retained-v2-production' };
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
  { skip: process.platform !== 'win32' || process.env.STEPHANOS_CUSTODY_NATIVE_FIXTURE !== '1' }, () => {
    const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: join(tmpdir(), 'custody-os-proof-' + randomUUID()), signingKey: key, nativeFixture: true });
    assert.equal(anchor.readLatest(), null);
    const bytes = Buffer.from(JSON.stringify({ fixture: true, productionAuthority: false }));
    const written = anchor.append(bytes, { expectedRecordId: null });
    assert.ok(written.eventRecordId > 0);
    assert.deepEqual(anchor.readLatest().bytes, bytes);
  });

test('real Windows contenders cannot both replace the same previous anchor', { skip: process.platform !== 'win32' || process.env.STEPHANOS_CUSTODY_NATIVE_FIXTURE !== '1', timeout: 30_000 }, async t => {
  const root = join(tmpdir(), 'custody-os-cas-proof-' + randomUUID());
  const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: root, signingKey: key, nativeFixture: true });
  const initial = anchor.append(Buffer.from('fixture-idle'), { expectedRecordId: null });
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createMaintenanceOsAnchorV1 } = await import(workerData.moduleUrl);
      const anchor = createMaintenanceOsAnchorV1({ workspaceRoot: workerData.root, signingKey: workerData.key, nativeFixture: true });
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

test('foreign journal identity and false-absence metadata cannot qualify retained authority', () => {
  for (const payload of [{ found: false }, { found: false, journalId: 'legacy-v1-observation' },
    { found: false, journalId: 'retained-v2-production', truncated: true }]) {
    const a = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
      spawnFn: () => ({ status: 0, stdout: JSON.stringify(payload) }) });
    assert.throws(() => a.readLatest(), /IDENTITY_INVALID/);
  }
  assert.throws(() => createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: 'real-domain-key-'.repeat(4),
    platform: 'win32', nativeFixture: true }), /FIXTURE_SCOPE_INVALID/);
});
test('native Retain policy, reduced-token denial and capacity refusal preserve the last anchor',
  { skip: process.platform !== 'win32' || process.env.STEPHANOS_CUSTODY_NATIVE_FIXTURE !== '1',
    timeout: 60_000 }, () => {
    const root = join(tmpdir(), 'custody-retain-proof-' + randomUUID());
    const a = createMaintenanceOsAnchorV1({ workspaceRoot: root, signingKey: key, nativeFixture: true });
    const prior = a.append(Buffer.from('fixture-last-authority'), { expectedRecordId: null });
    const runFixture = mode => {
      const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo','-NoProfile','-NonInteractive','-File',
          fileURLToPath(new URL('./windows/test-sovereign-maintenance-journal-v2.ps1', import.meta.url)), '-Mode', mode],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, maxBuffer: 8192 });
      assert.equal(r.status, 0, String(r.stderr)); return JSON.parse(r.stdout);
    };
    const acl = runFixture('Acl');
    for (const field of ['ReadAllowed','WriteAllowed','ClearDenied','ConfigurationDenied','RegistryWriteDenied','RegistryDeleteDenied','AdministratorDisabled'])
      assert.equal(acl[field], true, field);
    try { runFixture('Circular'); assert.throws(() => a.readLatest(), /ANCHOR_UNPROVEN/); }
    finally { runFixture('Restore'); }
    assert.equal(a.readLatest().eventRecordId, prior.eventRecordId);
    assert.equal(runFixture('Fill').full, true);
    assert.throws(() => a.append(Buffer.from('must-not-overwrite'), { expectedRecordId: prior.eventRecordId }), /JOURNAL_CAPACITY_UNAVAILABLE/);
    assert.equal(a.readLatest().eventRecordId, prior.eventRecordId);
    assert.deepEqual(a.readLatest().bytes, prior.bytes);
  });


test('hosted Windows cannot substitute skipped native retained-journal proof', {
  skip: process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
}, () => assert.equal(process.env.STEPHANOS_CUSTODY_NATIVE_FIXTURE, '1',
  'Explicitly approved isolated retained-journal fixture setup is required; no production fallback'));

test('actual Windows policy constructs exactly the log root and its fixed source subkey',
  { skip: process.platform !== 'win32' }, () => {
    const policyFile = fileURLToPath(new URL('./windows/sovereign-maintenance-journal-policy-v2.ps1', import.meta.url));
    const command = ". '" + policyFile.replaceAll("'", "''") + "'; foreach ($fixture in @($false,$true)) { "
      + "$policy=Get-MaintenanceJournalPolicyV2 $fixture; "
      + "foreach($registryPath in (Get-MaintenanceJournalRegistryPathsV2 $policy)) { [Console]::WriteLine($registryPath) } }";
    const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split(/\r?\n/), [
      'SYSTEM\\CurrentControlSet\\Services\\EventLog\\Stephanos Maintenance Custody',
      'SYSTEM\\CurrentControlSet\\Services\\EventLog\\Stephanos Maintenance Custody\\StephanosMaintenanceCustody',
      'SYSTEM\\CurrentControlSet\\Services\\EventLog\\StphCustodyFixture',
      'SYSTEM\\CurrentControlSet\\Services\\EventLog\\StphCustodyFixture\\StphCustodyFixtureV2'
    ]);
  });

test('Windows capacity model admits only requested bytes or its fixed one-page readback', {
  skip: process.platform !== 'win32'
}, () => {
  const policyFile = fileURLToPath(new URL('./windows/sovereign-maintenance-journal-policy-v2.ps1', import.meta.url));
  const command = ". '" + policyFile.replaceAll("'", "''") + "'; foreach($fixture in @($false,$true)) { "
    + "$policy=Get-MaintenanceJournalPolicyV2 $fixture; foreach($n in @($policy.Maximum,($policy.Maximum+4096),"
    + "($policy.Maximum-1),($policy.Maximum+1),($policy.Maximum+4095),($policy.Maximum+4097),($policy.Maximum*2))) { "
    + "[Console]::WriteLine((Test-MaintenanceJournalMaximumV2 $n $policy)) } }";
  const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), Array(2).fill(['True','True','False','False','False','False','False']).flat());
});

test('only a completed append refusal can produce the closed capacity code without leaking native data', () => {
  const a = createMaintenanceOsAnchorV1({ workspaceRoot, signingKey: key, platform: 'win32',
    spawnFn: () => ({ status: 2, stderr: 'SOVEREIGN_ANCHOR_CAPACITY=FULL_OR_UNPROVEN\nprivate ' + key,
      stdout: '{}' }) });
  assert.throws(() => a.append(Buffer.from('fixture'), { expectedRecordId: null }),
    error => error.message === 'MAINTENANCE_OS_JOURNAL_CAPACITY_UNAVAILABLE' && !JSON.stringify(error).includes(key));
  assert.throws(() => a.readLatest(), /MAINTENANCE_OS_ANCHOR_UNPROVEN/);
});
test('native registry mutation model rejects each independent mutation right including delete-only ACEs', {
  skip: process.platform !== 'win32'
}, () => {
  const policyFile = fileURLToPath(new URL('./windows/sovereign-maintenance-journal-policy-v2.ps1', import.meta.url));
  const command = ". '" + policyFile.replaceAll("'", "''") + "'; "
    + "foreach($rights in @(1,8,16,0x20000,0x20019,2,4,0x20,0x10000,0x40000,0x80000,0xF003F)) { "
    + "[Console]::WriteLine((Test-MaintenanceRegistryMutationV2 $rights)) }";
  const r = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',command],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), [...Array(5).fill('False'),...Array(7).fill('True')]);
});
