import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../../system/core/event_bus.js';
import { createServiceRegistry } from '../../system/core/service_registry.js';
import {
  TILE_WORKSPACE_TELEMETRY_SCHEMA,
  TILE_WORKSPACE_TELEMETRY_SERVICE,
  createTileWorkspaceTelemetry,
} from './tile-workspace-telemetry.js';

function fixture() {
  const projects = [
    { folder: 'music-tile', name: 'Music Tile', type: 'simulation', entry: 'apps/music-tile/index.html' },
    { folder: 'goal-dashboard', name: 'Goal Dashboard', type: 'workspace', entry: 'apps/goal-dashboard/index.html' },
    { folder: 'spatial-bridge', name: 'Spatial Bridge', type: 'workspace', entry: 'apps/spatial-bridge/index.html' },
  ];
  const eventBus = createEventBus();
  const state = new Map([['projects', projects]]);
  const systemState = {
    get(key) { return state.get(key); },
    set(key, value) { state.set(key, value); return value; },
  };
  const services = createServiceRegistry();
  const writes = [];
  const memoryGateway = {
    persistTypedRecord(record) {
      writes.push(record);
      return record;
    },
  };
  const documentRef = {
    getElementById(id) {
      if (id !== 'project-registry') return null;
      return { querySelectorAll: () => ({ length: projects.length }) };
    },
  };
  const windowRef = {};
  const binding = createTileWorkspaceTelemetry({
    projects,
    eventBus,
    systemState,
    memoryGateway,
    services,
    documentRef,
    windowRef,
  });
  return { projects, eventBus, systemState, services, writes, windowRef, binding };
}

test('universal telemetry starts with every registered tile covered', () => {
  const fx = fixture();
  const snapshot = fx.binding.service.getSnapshot();

  assert.equal(snapshot.schemaVersion, TILE_WORKSPACE_TELEMETRY_SCHEMA);
  assert.equal(snapshot.registeredTileCount, fx.projects.length);
  assert.equal(snapshot.tiles.length, fx.projects.length);
  assert.equal(snapshot.launcherCoverage.renderedTileCount, fx.projects.length);
  assert.equal(snapshot.launcherCoverage.state, 'FULL');
  assert.deepEqual(snapshot.tiles.map((tile) => tile.tileId), ['goal-dashboard', 'music-tile', 'spatial-bridge']);
  assert.equal(fx.services.getService(TILE_WORKSPACE_TELEMETRY_SERVICE), fx.binding.service);
  assert.equal(fx.systemState.get('tileWorkspaceTelemetry').registeredTileCount, fx.projects.length);
  assert.equal(fx.windowRef.StephanosTileWorkspaceTelemetry, fx.binding.service);
  assert.ok(fx.writes.some((record) => record.id === 'tile-workspace-telemetry-current' && record.type === 'workspace.state'));

  fx.binding.dispose();
});

test('tile launch and workspace lifecycle telemetry follow the canonical event bus', () => {
  const fx = fixture();
  const music = fx.projects[0];

  fx.eventBus.emit('tile.action', {
    tileId: 'music-tile',
    tileTitle: 'Music Tile',
    action: 'launch-requested',
    source: 'command-deck',
  });
  fx.eventBus.emit('tile.focused', { tileId: 'music-tile', tileTitle: 'Music Tile', source: 'workspace' });
  fx.eventBus.emit('workspace:opened', music);
  fx.eventBus.emit('tile.opened', { tileId: 'music-tile', tileTitle: 'Music Tile', source: 'workspace' });

  let snapshot = fx.binding.service.getSnapshot();
  let row = snapshot.tiles.find((tile) => tile.tileId === 'music-tile');
  assert.equal(snapshot.activeTileId, 'music-tile');
  assert.equal(row.lifecycleState, 'OPEN');
  assert.equal(row.workspaceState, 'OPEN');
  assert.equal(row.openCount, 1);
  assert.ok(row.lastLaunchRequestedAt);
  assert.ok(row.lastOpenedAt);

  fx.eventBus.emit('workspace:closed');
  fx.eventBus.emit('tile.closed', { source: 'workspace' });
  snapshot = fx.binding.service.getSnapshot();
  row = snapshot.tiles.find((tile) => tile.tileId === 'music-tile');
  assert.equal(snapshot.activeTileId, '');
  assert.equal(row.active, false);
  assert.equal(row.lifecycleState, 'CLOSED');
  assert.equal(row.workspaceState, 'CLOSED');
  assert.ok(row.lastClosedAt);
  assert.equal(snapshot.observedTileCount, 1);

  fx.binding.dispose();
});

test('workspace failure is visible without painting the tile healthy', () => {
  const fx = fixture();
  const dashboard = fx.projects[1];

  fx.eventBus.emit('tile.focused', { tileId: 'goal-dashboard', tileTitle: 'Goal Dashboard' });
  fx.eventBus.emit('workspace:launch_failed', dashboard);
  fx.eventBus.emit('tile.result', {
    tileId: 'goal-dashboard',
    tileTitle: 'Goal Dashboard',
    result: 'launch-failed',
    source: 'workspace',
  });

  const row = fx.binding.service.getSnapshot().tiles.find((tile) => tile.tileId === 'goal-dashboard');
  assert.equal(row.lifecycleState, 'FAILED');
  assert.equal(row.workspaceState, 'FAILED');
  assert.equal(row.failureCount, 1);
  assert.equal(row.blocker, 'WORKSPACE_LAUNCH_FAILED');
  assert.ok(row.lastFailureAt);

  fx.binding.dispose();
});

test('events from a tile missing from the canonical app registry remain explicitly unregistered', () => {
  const fx = fixture();
  fx.eventBus.emit('tile.action', {
    tileId: 'ghost-tile',
    tileTitle: 'Ghost Tile',
    action: 'launch-requested',
  });

  const snapshot = fx.binding.service.getSnapshot();
  const ghost = snapshot.tiles.find((tile) => tile.tileId === 'ghost-tile');
  assert.equal(snapshot.registeredTileCount, fx.projects.length);
  assert.equal(ghost.registryState, 'UNREGISTERED_EVENT_SOURCE');
  assert.equal(ghost.lifecycleState, 'LAUNCH_REQUESTED');

  fx.binding.dispose();
  assert.equal(fx.services.hasService(TILE_WORKSPACE_TELEMETRY_SERVICE), false);
  assert.equal('StephanosTileWorkspaceTelemetry' in fx.windowRef, false);
});
