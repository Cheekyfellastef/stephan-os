import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA,
  buildSovereignVisibilitySnapshot,
  collectRepositoryVisibility,
} from './sovereign-commander-visibility-snapshot.mjs';

const HEAD = 'a'.repeat(40);

test('visibility snapshot is green only for exact-head awake healthy runtime', () => {
  const snapshot = buildSovereignVisibilitySnapshot({
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    repository: { available: true, head: HEAD, branch: 'main', dirty: false, changedEntryCount: 0, trackedChangeCount: 0, untrackedCount: 0, rawPathsReturned: false },
    observation: {
      services: {
        ui: { ready: true },
        backend: { ready: true },
        openclaw: { ready: true },
        'sovereign-commander': { ready: true },
      },
    },
    core: {
      available: true,
      ok: true,
      daemonHealthy: true,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      sourceHead: HEAD,
      heartbeatAgeSeconds: 4,
    },
    selfHeal: { available: true, dependencySelfHealEnabled: true },
    controllers: { lanes: { refillHealth: 'GREEN' } },
    meters: { ok: true },
    relay: { available: true, daemonHealthy: true, carrierHealthy: true, heartbeatAgeSeconds: 3 },
  });

  assert.equal(snapshot.schemaVersion, SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.finalVerdict, 'SOVEREIGN_VISIBILITY_SNAPSHOT_READY');
  assert.deepEqual(snapshot.health, {
    repository: 'GREEN',
    core: 'GREEN',
    services: 'GREEN',
    laneRefill: 'GREEN',
    transport: 'GREEN',
  });
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.sourceMutationAllowed, false);
  assert.equal(snapshot.arbitraryShellAllowed, false);
  assert.equal(snapshot.arbitraryProcessInspectionAllowed, false);
  assert.equal(snapshot.rawLogsReturned, false);
  assert.equal(snapshot.rawPathsReturned, false);
  assert.equal(snapshot.secretMaterialIncluded, false);
  assert.equal(snapshot.mergeAuthority, false);
  assert.equal(snapshot.pcRestartAuthority, false);
  assert.equal(snapshot.remoteCommanderRequired, false);
  assert.equal(snapshot.unknownMeansGreen, false);
});

test('stale core and degraded fast carrier remain visible rather than false green', () => {
  const snapshot = buildSovereignVisibilitySnapshot({
    repository: { available: true, head: HEAD, branch: 'main', dirty: false },
    observation: { services: { backend: { ready: true }, 'sovereign-commander': { ready: true }, ui: { ready: true }, openclaw: { ready: true } } },
    core: { available: true, ok: false, daemonHealthy: true, readiness: 'READY', wakeState: 'AWAKE', awake: true, repairRequired: false, sourceHead: HEAD, heartbeatAgeSeconds: 90 },
    controllers: { lanes: { refillHealth: 'AMBER' } },
    relay: { available: true, daemonHealthy: true, carrierHealthy: false, heartbeatAgeSeconds: 4 },
  });
  assert.equal(snapshot.health.core, 'RED');
  assert.equal(snapshot.health.laneRefill, 'AMBER');
  assert.equal(snapshot.health.transport, 'AMBER');
  assert.equal(snapshot.finalVerdict, 'SOVEREIGN_VISIBILITY_SNAPSHOT_ATTENTION_REQUIRED');
});

test('repository visibility returns counts without leaking filenames', () => {
  const outputs = new Map([
    ['rev-parse HEAD', { status: 0, stdout: `${HEAD}\n` }],
    ['rev-parse --abbrev-ref HEAD', { status: 0, stdout: 'main\n' }],
    ['status --porcelain=v1 --untracked-files=normal', { status: 0, stdout: ' M secret-looking-name.txt\n?? another-name.env\n' }],
  ]);
  const spawnSyncFn = (_exe, args) => {
    const command = args.slice(2).join(' ');
    return outputs.get(command) || { status: 1, stdout: '' };
  };
  const repository = collectRepositoryVisibility({ spawnSyncFn, root: 'C:\\repo' });
  assert.equal(repository.head, HEAD);
  assert.equal(repository.branch, 'main');
  assert.equal(repository.dirty, true);
  assert.equal(repository.changedEntryCount, 2);
  assert.equal(repository.trackedChangeCount, 1);
  assert.equal(repository.untrackedCount, 1);
  assert.equal(repository.rawPathsReturned, false);
  assert.equal('paths' in repository, false);
});
