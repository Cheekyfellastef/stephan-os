import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_PARITY_DECISIONS,
  evaluateForgeShadowParity,
} from './forgeShadowParityV1.mjs';

const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const digest = 'c'.repeat(64);

function observation(patch = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    nowUtc: '2026-08-06T13:00:00.000Z',
    maxObservationAgeMs: 600000,
    maxBackupAgeMs: 86400000,
    github: { head, tree },
    forge: {
      head,
      tree,
      observedAtUtc: '2026-08-06T12:59:00.000Z',
      mirrorMode: 'fetch-only',
      writeEnabled: false,
      publicExposure: false,
      runnerRegistrationEnabled: false,
      serviceHealthy: true,
    },
    backup: {
      completedAtUtc: '2026-08-06T12:00:00.000Z',
      repositoryHead: head,
      databaseDigest: digest,
      repositoryDigest: digest,
      artifactDigest: digest,
      restorable: true,
    },
    ...patch,
  };
}

test('exact read-only shadow parity with a current restorable backup becomes ready', () => {
  const result = evaluateForgeShadowParity(observation());
  assert.equal(result.valid, true);
  assert.equal(result.decision, FORGE_SHADOW_PARITY_DECISIONS.READY);
  assert.equal(result.parity, true);
  assert.equal(result.backupCurrent, true);
  assert.deepEqual(new Set(Object.values(result.authority)), new Set([false]));
});

test('repository identity is fixed to canonical Stephanos repository', () => {
  const result = evaluateForgeShadowParity(observation({ repository: 'other/repo' }));
  assert.equal(result.valid, false);
  assert.equal(result.decision, FORGE_SHADOW_PARITY_DECISIONS.BLOCKED);
  assert.ok(result.blockers.includes('repository-not-allowlisted'));
});

test('head or tree mismatch requires parity without claiming readiness', () => {
  for (const forge of [
    { ...observation().forge, head: 'd'.repeat(40) },
    { ...observation().forge, tree: 'e'.repeat(40) },
  ]) {
    const result = evaluateForgeShadowParity(observation({ forge }));
    assert.equal(result.valid, true);
    assert.equal(result.decision, FORGE_SHADOW_PARITY_DECISIONS.PARITY_REQUIRED);
    assert.equal(result.parity, false);
  }
});

test('force-style mirror, writes, public exposure and runner registration fail closed', () => {
  for (const patch of [
    { mirrorMode: 'push-mirror' },
    { writeEnabled: true },
    { publicExposure: true },
    { runnerRegistrationEnabled: true },
  ]) {
    const result = evaluateForgeShadowParity(observation({ forge: { ...observation().forge, ...patch } }));
    assert.equal(result.valid, false);
    assert.equal(result.decision, FORGE_SHADOW_PARITY_DECISIONS.BLOCKED);
  }
});

test('stale or future Forge observations fail closed', () => {
  for (const observedAtUtc of ['2026-08-06T12:00:00.000Z', '2026-08-06T13:01:00.000Z']) {
    const result = evaluateForgeShadowParity(observation({
      forge: { ...observation().forge, observedAtUtc },
    }));
    assert.equal(result.valid, false);
  }
});

test('missing, stale or wrong-head backup requires proof or blocks malformed evidence', () => {
  const stale = evaluateForgeShadowParity(observation({
    backup: { ...observation().backup, completedAtUtc: '2026-08-04T12:00:00.000Z' },
  }));
  assert.equal(stale.valid, true);
  assert.equal(stale.decision, FORGE_SHADOW_PARITY_DECISIONS.BACKUP_REQUIRED);

  const wrongHead = evaluateForgeShadowParity(observation({
    backup: { ...observation().backup, repositoryHead: 'f'.repeat(40) },
  }));
  assert.equal(wrongHead.valid, true);
  assert.equal(wrongHead.decision, FORGE_SHADOW_PARITY_DECISIONS.BACKUP_REQUIRED);

  const unproved = evaluateForgeShadowParity(observation({
    backup: { ...observation().backup, restorable: false },
  }));
  assert.equal(unproved.valid, false);
});

test('malformed digests and timestamps never become shadow truth', () => {
  for (const patch of [
    { backup: { ...observation().backup, databaseDigest: 'bad' } },
    { nowUtc: 'not-a-time' },
    { forge: { ...observation().forge, observedAtUtc: 'not-a-time' } },
  ]) {
    const result = evaluateForgeShadowParity(observation(patch));
    assert.equal(result.valid, false);
    assert.equal(result.decision, FORGE_SHADOW_PARITY_DECISIONS.BLOCKED);
  }
});
