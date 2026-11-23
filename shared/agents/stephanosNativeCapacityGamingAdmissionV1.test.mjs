import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectStephanosNativeCapacityGamingAdmissionV1 } from './stephanosNativeCapacityGamingAdmissionV1.mjs';

const OBSERVED = '2026-10-24T22:00:00.000Z';
const NOW = Date.parse(OBSERVED);
function state(overrides = {}) {
  return {
    schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    phase: 'NORMAL', overrideMode: 'AUTO', ollamaLoadMode: 'balanced', cooldownUntilUtc: '',
    active: false, flatGameActive: false, airLinkActive: false, realAirLinkActive: false,
    virtualAirLinkTestActive: false, prepareLeaseActive: false,
    localModelAllowed: true, heavyModelAllowed: true, updatedAtUtc: OBSERVED,
    ...overrides,
  };
}

async function withEvidence(action) {
  const profile = await mkdtemp(join(tmpdir(), 'native-gaming-admission-'));
  const root = join(profile, 'Documents', 'Stephanos-openclaw-workspace');
  const vr = join(root, 'vr');
  const file = join(vr, 'vr-resource-governor-current.json');
  const prepare = join(vr, 'gaming-resource-prepare.json');
  const override = join(vr, 'gaming-resource-override.json');
  const options = { workspaceRoot: root, repoRoot: resolve('.'), env: { USERPROFILE: profile }, nowMs: () => NOW };
  try {
    await mkdir(vr, { recursive: true });
    await writeFile(file, JSON.stringify(state()));
    return await action({ profile, root, vr, file, prepare, override, options });
  } finally { await rm(profile, { recursive: true, force: true }); }
}

function assertHold(options, reason) {
  const result = inspectStephanosNativeCapacityGamingAdmissionV1(options);
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_CAPACITY_GAMING_HOLD');
  assert.equal(result.reason, `native-capacity-gaming-${reason}`);
  if (reason !== 'permission-denied') assert.equal(Object.hasOwn(result, 'governorPermission'), false);
  return result;
}

test('fresh canonical governor permission is admitted without changing its evidence', async () => withEvidence(async ({ file, options }) => {
  const before = await readFile(file, 'utf8');
  assert.deepEqual(inspectStephanosNativeCapacityGamingAdmissionV1(options), {
    ok: true, reason: 'STEPHANOS_NATIVE_CAPACITY_GAMING_ADMITTED',
  });
  assert.equal(inspectStephanosNativeCapacityGamingAdmissionV1({ ...options, nowMs: () => NOW + 30_000 }).ok, true);
  assert.equal(await readFile(file, 'utf8'), before);
}));

const invalidStates = [
  ['unknown schema', { schemaVersion: 'other' }, 'state-invalid'],
  ['legacy governor', { governorVersion: 2 }, 'state-invalid'],
  ['coerced governor version', { governorVersion: '3' }, 'state-invalid'],
  ['missing observation', { updatedAtUtc: undefined }, 'clock-unproved'],
  ['timezone-free observation', { updatedAtUtc: '2026-10-24T22:00:00' }, 'clock-unproved'],
  ['invalid observation', { updatedAtUtc: 'not-a-time' }, 'clock-unproved'],
  ['future observation', { updatedAtUtc: new Date(NOW + 1).toISOString() }, 'observation-future'],
  ['stale observation', { updatedAtUtc: new Date(NOW - 30_001).toISOString() }, 'observation-stale'],
  ['preparing phase', { phase: 'PREPARING' }, 'permission-denied'],
  ['cooldown phase', { phase: 'COOLDOWN' }, 'permission-denied'],
  ['pending cooldown', { cooldownUntilUtc: new Date(NOW + 1).toISOString() }, 'permission-denied'],
  ['inconsistent elapsed cooldown', { cooldownUntilUtc: new Date(NOW - 1).toISOString() }, 'permission-denied'],
  ['missing cooldown', { cooldownUntilUtc: undefined }, 'permission-denied'],
  ['forced-off governor', { overrideMode: 'FORCE_OFF' }, 'permission-denied'],
  ['forced-on governor', { overrideMode: 'FORCE_ON' }, 'permission-denied'],
  ['unproved load mode', { ollamaLoadMode: 'cool' }, 'permission-denied'],
  ...['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive', 'virtualAirLinkTestActive', 'prepareLeaseActive']
    .map((flag) => [`active ${flag}`, { [flag]: true }, 'permission-denied']),
  ...['localModelAllowed', 'heavyModelAllowed'].map((flag) => [`denied ${flag}`, { [flag]: false }, 'permission-denied']),
  ...['active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive', 'virtualAirLinkTestActive', 'prepareLeaseActive', 'localModelAllowed', 'heavyModelAllowed']
    .flatMap((flag) => [[`missing ${flag}`, { [flag]: undefined }, 'state-invalid'], [`string ${flag}`, { [flag]: 'false' }, 'state-invalid']]),
];

test('missing, stale, coerced, active and cooldown state never supplies heavy-model admission', async (t) => {
  for (const [name, changed, reason] of invalidStates) {
    await t.test(name, async () => withEvidence(async ({ file, options }) => {
      await writeFile(file, JSON.stringify(state(changed)));
      assertHold(options, reason);
    }));
  }
});

const permissionPredicates = [
  ['PHASE', { phase: 'PREPARING' }], ['OVERRIDE', { overrideMode: 'FORCE_OFF' }],
  ['LOAD', { ollamaLoadMode: 'unknown' }], ['COOLDOWN', { cooldownUntilUtc: '2026-10-24T22:01:00.000Z' }],
  ['ACTIVE', { active: true }], ['FLAT_GAME', { flatGameActive: true }],
  ['AIR_LINK', { airLinkActive: true }], ['REAL_AIR_LINK', { realAirLinkActive: true }],
  ['VIRTUAL_AIR_LINK', { virtualAirLinkTestActive: true }], ['PREPARE_LEASE', { prepareLeaseActive: true }],
  ['LOCAL_MODEL', { localModelAllowed: false }], ['HEAVY_MODEL', { heavyModelAllowed: false }],
];

test('each denied permission predicate identifies only its closed diagnostic label', async (t) => {
  for (const [label, changed] of permissionPredicates) {
    await t.test(label, async () => withEvidence(async ({ file, options }) => {
      const bytes = JSON.stringify(state(changed));
      await writeFile(file, bytes);
      const result = assertHold(options, 'permission-denied');
      assert.deepEqual(result.governorPermission, { observedAtUtc: OBSERVED, failed: [label] });
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.governorPermission), true);
      assert.equal(Object.isFrozen(result.governorPermission.failed), true);
      assert.equal(await readFile(file, 'utf8'), bytes);
    }));
  }
});

test('all failures remain ordered and contain no state values, paths, process identities or model names', async () => withEvidence(async ({ file, options }) => {
  const changed = Object.assign({}, ...permissionPredicates.map(([, values]) => values));
  await writeFile(file, JSON.stringify(state({ ...changed,
    phase: 'PRIVATE_PHASE', overrideMode: 'PRIVATE_OVERRIDE', ollamaLoadMode: 'PRIVATE_MODEL',
    cooldownUntilUtc: 'PRIVATE_COOLDOWN', path: 'C:\\PRIVATE\\workspace', pid: 17281,
    loadedModels: ['PRIVATE_MODEL'], nativeProbeAttempt: { pid: 17281, path: 'PRIVATE_PATH' },
  })));
  const result = assertHold(options, 'permission-denied');
  assert.deepEqual(result.governorPermission, {
    observedAtUtc: OBSERVED, failed: permissionPredicates.map(([label]) => label),
  });
  assert.equal(/PRIVATE|17281|path|pid|loadedModels/.test(JSON.stringify(result)), false);
  assert.throws(() => result.governorPermission.failed.push('OTHER'), TypeError);
  assert.throws(() => { result.governorPermission.observedAtUtc = '2000-01-01T00:00:00.000Z'; }, TypeError);
}));

test('permission diagnostics keep the originally validated sample when the evidence file changes during the clock check', async () => withEvidence(async ({ file, options }) => {
  const originalAtUtc = new Date(NOW - 5000).toISOString();
  await writeFile(file, JSON.stringify(state({ updatedAtUtc: originalAtUtc, localModelAllowed: false })));
  const result = assertHold({ ...options, nowMs: () => {
    writeFileSync(file, JSON.stringify(state({ heavyModelAllowed: false })));
    return NOW;
  } }, 'permission-denied');
  assert.deepEqual(result.governorPermission, { observedAtUtc: originalAtUtc, failed: ['LOCAL_MODEL'] });
  assert.deepEqual(assertHold(options, 'permission-denied').governorPermission,
    { observedAtUtc: OBSERVED, failed: ['HEAVY_MODEL'] });
}));

test('original explicit-offset timestamps normalize while 31-second stale state still has no permission diagnostic', async () => withEvidence(async ({ file, options }) => {
  await writeFile(file, JSON.stringify(state({ updatedAtUtc: '2026-10-24T23:00:00.000+01:00', heavyModelAllowed: false })));
  const result = assertHold({ ...options, nowMs: () => NOW + 30_000 }, 'permission-denied');
  assert.deepEqual(result.governorPermission, { observedAtUtc: OBSERVED, failed: ['HEAVY_MODEL'] });
  assertHold({ ...options, nowMs: () => NOW + 31_000 }, 'observation-stale');
  assertHold({ ...options, nowMs: () => NOW - 1 }, 'observation-future');
}));

test('missing, malformed, oversized and non-file governor evidence fails closed', async (t) => {
  for (const [name, change] of [
    ['missing', async (file) => rm(file)],
    ['malformed', async (file) => writeFile(file, '{broken')],
    ['oversized', async (file) => writeFile(file, JSON.stringify({ ...state(), padding: 'x'.repeat(32_768) }))],
    ['directory', async (file) => { await rm(file); await mkdir(file); }],
  ]) {
    await t.test(name, async () => withEvidence(async ({ file, options }) => {
      await change(file);
      assertHold(options, 'evidence-unavailable');
    }));
  }
});

test('prepare-file presence denies even with normal state and expired or malformed preparation', async (t) => {
  for (const content of ['', '{broken', JSON.stringify({ active: false, expiresAtUtc: '2000-01-01T00:00:00Z' })]) {
    await t.test(content || 'empty preparation', async () => withEvidence(async ({ prepare, options }) => {
      await writeFile(prepare, content);
      assertHold(options, 'prepare-pending');
      assert.equal(await readFile(prepare, 'utf8'), content);
    }));
  }
});

test('current override is checked independently of the persisted governor observation', async () => withEvidence(async ({ override, options }) => {
  await writeFile(override, JSON.stringify({ schemaVersion: 'stephanos.gaming-resource-override.v1', mode: 'AUTO' }));
  assert.equal(inspectStephanosNativeCapacityGamingAdmissionV1(options).ok, true);
  for (const mode of ['FORCE_ON', 'FORCE_OFF', 'unknown']) {
    await writeFile(override, JSON.stringify({ schemaVersion: 'stephanos.gaming-resource-override.v1', mode }));
    assertHold(options, 'override-unproved');
  }
  await writeFile(override, '{broken');
  assertHold(options, 'evidence-unavailable');
}));

test('caller-selected workspace, missing profile and invalid clocks cannot supply permission', async () => withEvidence(async ({ root, options }) => {
  assertHold({ ...options, workspaceRoot: join(root, 'other') }, 'workspace-mismatch');
  assertHold({ ...options, env: {} }, 'workspace-unproved');
  assertHold({ ...options, env: { USERPROFILE: 'relative' } }, 'workspace-unproved');
  assertHold({ ...options, nowMs: () => NaN }, 'clock-unproved');
  assertHold({ ...options, nowMs: () => NOW + 0.5 }, 'clock-unproved');
  assertHold({ ...options, repoRoot: options.env.USERPROFILE }, 'workspace-unproved');
}));

test('linked governor evidence and linked workspace directories cannot supply admission', {
  skip: process.platform === 'win32' ? 'Creating fixture symlinks requires Windows privilege; other admission tests remain portable.' : false,
}, async () => withEvidence(async ({ file, vr, prepare, options }) => {
  await rename(file, `${file}.real`);
  await symlink(`${file}.real`, file);
  assertHold(options, 'evidence-unavailable');
  await rm(file);
  await rename(`${file}.real`, file);
  await symlink(join(vr, 'absent-prepare-target'), prepare);
  assertHold(options, 'prepare-pending');
  await rm(prepare);
  await rename(vr, `${vr}.real`);
  await symlink(`${vr}.real`, vr);
  assertHold(options, 'workspace-unproved');
}));
