import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOVEREIGN_VISIBILITY_SNAPSHOT_SCHEMA,
  SOVEREIGN_VISIBILITY_SNAPSHOT_MAX_BYTES,
  buildSovereignVisibilitySnapshot,
  buildHeadSyncVisibility,
  collectRepositoryVisibility,
  renderSovereignVisibilitySnapshotLine,
} from './sovereign-commander-visibility-snapshot.mjs';

const HEAD = 'a'.repeat(40);

test('visibility snapshot is green only for exact-head awake healthy runtime', () => {
  const snapshot = buildSovereignVisibilitySnapshot({
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    repository: { available: true, head: HEAD, branch: 'main', dirty: false, changedEntryCount: 0, trackedChangeCount: 0, untrackedCount: 0, remoteMainAvailable: true, remoteMainHead: HEAD, rawPathsReturned: false },
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
    headSync: 'GREEN',
    services: 'GREEN',
    laneRefill: 'GREEN',
    transport: 'GREEN',
  });
  assert.equal(snapshot.headSync.syncState, 'CURRENT');
  assert.equal(snapshot.headSync.canonicalMainHead, HEAD);
  assert.equal(snapshot.headSync.repositoryHead, HEAD);
  assert.equal(snapshot.headSync.runtimeHead, HEAD);
  assert.equal(snapshot.headSync.exactHeadChainProven, true);
  assert.equal(snapshot.headSync.exactNextAction, 'NONE');
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
    repository: { available: true, head: HEAD, branch: 'main', dirty: false, remoteMainAvailable: true, remoteMainHead: HEAD },
    observation: { services: { backend: { ready: true }, 'sovereign-commander': { ready: true }, ui: { ready: true }, openclaw: { ready: true } } },
    core: { available: true, ok: false, daemonHealthy: true, readiness: 'READY', wakeState: 'AWAKE', awake: true, repairRequired: false, sourceHead: HEAD, heartbeatAgeSeconds: 90 },
    controllers: { lanes: { refillHealth: 'AMBER' } },
    relay: { available: true, daemonHealthy: true, carrierHealthy: false, heartbeatAgeSeconds: 4 },
  });
  assert.equal(snapshot.health.core, 'RED');
  assert.equal(snapshot.health.headSync, 'GREEN');
  assert.equal(snapshot.health.laneRefill, 'AMBER');
  assert.equal(snapshot.health.transport, 'AMBER');
  assert.equal(snapshot.finalVerdict, 'SOVEREIGN_VISIBILITY_SNAPSHOT_ATTENTION_REQUIRED');
});

test('repository visibility returns counts without leaking filenames', () => {
  const outputs = new Map([
    ['rev-parse HEAD', { status: 0, stdout: `${HEAD}\n` }],
    ['rev-parse --abbrev-ref HEAD', { status: 0, stdout: 'main\n' }],
    ['status --porcelain=v1 --untracked-files=normal', { status: 0, stdout: ' M secret-looking-name.txt\n?? another-name.env\n' }],
    ['ls-remote --heads origin refs/heads/main', { status: 0, stdout: `${HEAD}\trefs/heads/main\n` }],
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
  assert.equal(repository.remoteMainAvailable, true);
  assert.equal(repository.remoteMainHead, HEAD);
  assert.equal(repository.rawPathsReturned, false);
  assert.equal('paths' in repository, false);
});

test('head sync distinguishes repository drift from runtime drift', () => {
  const NEXT = 'b'.repeat(40);
  const repositoryDrift = buildHeadSyncVisibility({
    repository: { available: true, head: HEAD, remoteMainAvailable: true, remoteMainHead: NEXT },
    core: { sourceHead: HEAD },
  });
  assert.equal(repositoryDrift.syncState, 'REPOSITORY_DRIFT');
  assert.equal(repositoryDrift.trafficLight, 'RED');
  assert.equal(repositoryDrift.exactNextAction, 'SYNC_REPOSITORY_TO_MAIN');
  assert.equal(repositoryDrift.mainChangedSinceRepository, true);
  assert.equal(repositoryDrift.mainChangedSinceRuntime, true);
  assert.equal(repositoryDrift.exactHeadChainProven, false);

  const runtimeDrift = buildHeadSyncVisibility({
    repository: { available: true, head: NEXT, remoteMainAvailable: true, remoteMainHead: NEXT },
    core: { sourceHead: HEAD },
  });
  assert.equal(runtimeDrift.syncState, 'RUNTIME_DRIFT');
  assert.equal(runtimeDrift.trafficLight, 'RED');
  assert.equal(runtimeDrift.exactNextAction, 'RELOAD_RUNTIME_AT_REPOSITORY_HEAD');
  assert.equal(runtimeDrift.repositoryMatchesMain, true);
  assert.equal(runtimeDrift.runtimeMatchesRepository, false);
  assert.equal(runtimeDrift.mainChangedSinceRuntime, true);
});

test('head sync never promotes unknown remote main to green', () => {
  const unknown = buildHeadSyncVisibility({
    repository: { available: true, head: HEAD, remoteMainAvailable: false, remoteMainHead: '' },
    core: { sourceHead: HEAD },
  });
  assert.equal(unknown.syncState, 'REMOTE_MAIN_UNKNOWN');
  assert.equal(unknown.trafficLight, 'AMBER');
  assert.equal(unknown.exactNextAction, 'REFRESH_REMOTE_MAIN_PROOF');
  assert.equal(unknown.exactHeadChainProven, false);
  assert.equal(unknown.unknownMeansGreen, false);
});


test('visibility snapshot remains below Sovereign maintenance stdout cap under fat live inputs', () => {
  const controller = (index) => ({
    controllerId: `controller-${index}`,
    title: `Controller ${index} ${'X'.repeat(100)}`,
    freshness: index % 2 ? 'STALE' : 'CURRENT',
    activityState: index % 2 ? 'STALE_HEARTBEAT' : 'BUILDING',
    trafficLight: index % 2 ? 'RED' : 'GREEN',
    materialLaneCount: index,
    activeLaneCount: index,
    parkedLaneCount: 0,
    safeEligibleWorkRemaining: 1,
    blocker: index % 2 ? `BLOCKER_${'Y'.repeat(100)}` : '',
  });
  const meters = Array.from({ length: 64 }, (_, index) => ({
    meterId: `meter-${index}`,
    provider: `provider-${index}`,
    source: 'shared-workspace',
    observationState: 'UNKNOWN',
    trafficLight: 'GREY',
    blocker: `METER_BLOCKER_${'Z'.repeat(90)}`,
  }));
  const snapshot = buildSovereignVisibilitySnapshot({
    capturedAtUtc: '2026-10-05T09:00:00.000Z',
    repository: { available: true, head: HEAD, branch: 'main', dirty: false, changedEntryCount: 0, trackedChangeCount: 0, untrackedCount: 0, remoteMainAvailable: true, remoteMainHead: HEAD, rawPathsReturned: false },
    observation: {
      schemaVersion: 'stephanos.battle-bridge-observation.v1',
      ok: true,
      capturedAtUtc: '2026-10-05T09:00:00.000Z',
      hostRole: 'battle-bridge',
      uptimeSeconds: 999999,
      memory: { totalBytes: 68_625_293_312, freeBytes: 42_906_791_936, usedBytes: 25_718_501_376 },
      gpu: { available: true, name: 'NVIDIA GeForce RTX 5090', memoryTotalMiB: 32607, memoryUsedMiB: 31567, memoryFreeMiB: 624, utilizationGpuPercent: 2 },
      ollama: {
        reachable: true,
        installedModelCount: 64,
        loadedModelCount: 4,
        installedModels: Array.from({ length: 64 }, (_, index) => ({ name: `model-${index}`, sizeBytes: 1 })),
        loadedModels: Array.from({ length: 4 }, (_, index) => ({ name: `loaded-${index}`, sizeBytes: 1, sizeVramBytes: 1, contextLength: 32768 })),
      },
      services: {
        ui: { reachable: true, ready: true, httpStatus: 200 },
        backend: { reachable: true, ready: true, httpStatus: 200 },
        openclaw: { reachable: true, ready: true, httpStatus: 200 },
        'sovereign-commander': { reachable: true, ready: true, httpStatus: 0 },
        ollama: { reachable: true, ready: true, httpStatus: 200 },
      },
      readOnly: true,
      arbitraryShellAllowed: false,
      secretMaterialIncluded: false,
      finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    },
    core: { available: true, ok: false, daemonHealthy: true, readiness: 'RELOAD_REQUIRED', wakeState: 'UNKNOWN', awake: false, repairRequired: true, repairReason: 'CORE_DAEMON_RELOAD_REQUIRED', controlPlaneFinalVerdict: 'STEPHANOS_CONTROL_PLANE_RELOAD_REQUIRED', sourceHead: HEAD, heartbeatAgeSeconds: 3 },
    selfHeal: { available: true, dependencySelfHealEnabled: true, dependencySelfHealProofHashes: Array.from({ length: 8 }, () => 'b'.repeat(64)) },
    controllers: {
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      capturedAtUtc: '2026-10-05T09:00:00.000Z',
      physical: { expected: 5, building: 2, amber: 1, red: 2, unknown: 0, allCurrent: false, allObservedEnabled: false, finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED', controllers: Array.from({ length: 5 }, (_, index) => controller(index)) },
      logical: { current: true, valid: true, observedAtUtc: '2026-10-05T09:00:00.000Z', physicalControllerCount: 5, total: 53, active: 3, tracking: 48, parked: 2, retired: 0, selectedForAdmission: 3, finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY', hostLoads: Array.from({ length: 5 }, (_, index) => ({ controllerId: `controller-${index}`, title: 'T'.repeat(120), logicalControllerCount: 10, activeCount: 1, trackingCount: 9, parkedCount: 0 })) },
      lanes: { targetMaterialLanes: 15, activeMaterialLaneCount: 3, activeLaneClaimCount: 3, reportedMaterialLaneCountSum: 3, occupancyPercent: 20, freeTargetLaneSlots: 12, runnableBacklogCount: 8, parkedPhysicalLaneCount: 2, reportedSafeEligibleWorkMax: 8, reportedSafeEligibleWorkSum: 20, refillHealth: 'RED', refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED' },
      readOnly: true,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      secretMaterialIncluded: false,
      unknownMeansGreen: false,
      finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
    },
    meters: {
      schemaVersion: 'stephanos.sovereign-meter-status.v1',
      ok: true,
      capturedAtUtc: '2026-10-05T09:00:00.000Z',
      counts: { total: 64, green: 0, amber: 0, red: 0, grey: 64 },
      meters,
      readOnly: true,
      arbitraryShellAllowed: false,
      secretMaterialIncluded: false,
      unknownMeansGreen: false,
      finalVerdict: 'SOVEREIGN_METER_STATUS_READY',
    },
    relay: { available: true, daemonHealthy: true, carrierHealthy: true, heartbeatAtUtc: '2026-10-05T09:00:00.000Z', heartbeatAgeSeconds: 2 },
  });

  const line = renderSovereignVisibilitySnapshotLine(snapshot);
  assert.ok(Buffer.byteLength(line, 'utf8') <= SOVEREIGN_VISIBILITY_SNAPSHOT_MAX_BYTES);
  assert.equal(snapshot.observation.ollama.installedModels.length, 0);
  assert.equal(snapshot.observation.ollama.loadedModels.length, 4);
  assert.equal(snapshot.controllers.physical.controllers.length, 5);
  assert.equal(snapshot.controllers.logical.hostLoads.length, 0);
  assert.equal(snapshot.meters.attentionMeters.length, 12);
  assert.equal(snapshot.meters.attentionMetersTruncated, true);
  assert.deepEqual(snapshot.meters.counts, { total: 64, green: 0, amber: 0, red: 0, grey: 64 });
});
