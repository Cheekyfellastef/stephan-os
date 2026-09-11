export const TILE_WORKSPACE_TELEMETRY_SCHEMA = 'stephanos.tile-workspace-telemetry.v1';
export const TILE_WORKSPACE_TELEMETRY_SERVICE = 'tileWorkspaceTelemetry';

export const moduleDefinition = {
  id: 'tile-workspace-telemetry',
  version: '1.0',
  description: 'Projects canonical tile and workspace lifecycle telemetry for every registered Stephanos app.',
};

function text(value = '') {
  return String(value ?? '').trim();
}

function tileIdFrom(value = {}) {
  if (typeof value === 'string') return text(value).toLowerCase();
  return text(value?.tileId || value?.folder || value?.id || value?.name).toLowerCase();
}

function projectTitle(project = {}, tileId = '') {
  return text(project?.tileTitle || project?.name || project?.title || tileId || 'Unknown Tile');
}

function createRow(project = {}, now = '') {
  const tileId = tileIdFrom(project);
  return {
    tileId,
    title: projectTitle(project, tileId),
    type: text(project?.type || 'workspace'),
    entry: text(project?.launchEntry || project?.runtimeEntry || project?.entry),
    launchStrategy: text(project?.launchStrategy || 'workspace'),
    registryState: 'REGISTERED',
    lifecycleState: 'REGISTERED',
    workspaceState: 'NEVER_OPENED',
    active: false,
    openCount: 0,
    failureCount: 0,
    registeredAt: now,
    lastLaunchRequestedAt: '',
    lastFocusedAt: '',
    lastOpenedAt: '',
    lastClosedAt: '',
    lastFailureAt: '',
    lastEventName: '',
    lastEventAt: '',
    lastMeaningfulMovementAt: now,
    lastResult: '',
    blocker: '',
  };
}

function cloneRow(row = {}) {
  return Object.freeze({ ...row });
}

function renderedTileCount(documentRef) {
  try {
    return Number(documentRef?.getElementById?.('project-registry')?.querySelectorAll?.('.app-tile')?.length || 0);
  } catch {
    return 0;
  }
}

export function createTileWorkspaceTelemetry({
  projects = [],
  eventBus = null,
  systemState = null,
  memoryGateway = null,
  services = null,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  nowFn = () => new Date().toISOString(),
} = {}) {
  const rows = new Map();
  const disposers = [];
  let activeTileId = '';
  let lastUpdatedAt = '';
  let disposed = false;

  function ensureRow(candidate = {}) {
    const id = tileIdFrom(candidate);
    if (!id) return null;
    if (!rows.has(id)) {
      const row = createRow(candidate, nowFn());
      row.registryState = 'UNREGISTERED_EVENT_SOURCE';
      row.lifecycleState = 'OBSERVED_UNREGISTERED';
      rows.set(id, row);
    }
    const row = rows.get(id);
    const nextTitle = projectTitle(candidate, id);
    if (nextTitle && (row.title === id || row.title === 'Unknown Tile')) row.title = nextTitle;
    return row;
  }

  function refreshRegistry(nextProjects = projects) {
    const observedAt = nowFn();
    const safeProjects = Array.isArray(nextProjects) ? nextProjects : [];
    for (const project of safeProjects) {
      const id = tileIdFrom(project);
      if (!id) continue;
      const existing = rows.get(id);
      if (!existing) {
        rows.set(id, createRow(project, observedAt));
        continue;
      }
      existing.title = projectTitle(project, id);
      existing.type = text(project?.type || existing.type || 'workspace');
      existing.entry = text(project?.launchEntry || project?.runtimeEntry || project?.entry || existing.entry);
      existing.launchStrategy = text(project?.launchStrategy || existing.launchStrategy || 'workspace');
      existing.registryState = 'REGISTERED';
      if (existing.lifecycleState === 'OBSERVED_UNREGISTERED') existing.lifecycleState = 'REGISTERED';
    }
    projects = safeProjects;
    return safeProjects.length;
  }

  function snapshot() {
    const tiles = [...rows.values()]
      .sort((a, b) => a.tileId.localeCompare(b.tileId))
      .map(cloneRow);
    const registeredTileCount = tiles.filter((tile) => tile.registryState === 'REGISTERED').length;
    const domTileCount = renderedTileCount(documentRef);
    const renderedCoverageState = domTileCount === registeredTileCount && registeredTileCount > 0
      ? 'FULL'
      : (domTileCount > 0 ? 'PARTIAL_OR_UNMAPPED' : 'UNPROVEN');
    return Object.freeze({
      schemaVersion: TILE_WORKSPACE_TELEMETRY_SCHEMA,
      updatedAt: lastUpdatedAt || nowFn(),
      activeTileId,
      registeredTileCount,
      observedTileCount: tiles.filter((tile) => Boolean(tile.lastEventAt)).length,
      launcherCoverage: Object.freeze({
        registeredTileCount,
        renderedTileCount: domTileCount,
        state: renderedCoverageState,
      }),
      tiles: Object.freeze(tiles),
    });
  }

  function persist(currentSnapshot, reason = '') {
    systemState?.set?.('tileWorkspaceTelemetry', currentSnapshot);
    const writer = memoryGateway?.persistTypedRecord;
    if (typeof writer !== 'function') return;
    try {
      const result = writer.call(memoryGateway, {
        id: 'tile-workspace-telemetry-current',
        type: 'workspace.state',
        summary: `Tile/workspace telemetry: ${currentSnapshot.registeredTileCount} registered, ${currentSnapshot.observedTileCount} observed${currentSnapshot.activeTileId ? `, active ${currentSnapshot.activeTileId}` : ''}.`,
        payload: currentSnapshot,
        tags: ['telemetry', 'tiles', 'workspaces', reason ? `reason.${reason}` : 'reason.snapshot'],
      });
      result?.catch?.((error) => console.warn('[Tile Workspace Telemetry] durable snapshot write failed', error));
    } catch (error) {
      console.warn('[Tile Workspace Telemetry] durable snapshot write failed', error);
    }
  }

  function publish(reason = 'event') {
    refreshRegistry(systemState?.get?.('projects') || projects);
    lastUpdatedAt = nowFn();
    const currentSnapshot = snapshot();
    persist(currentSnapshot, reason);
    return currentSnapshot;
  }

  function mark(row, eventName, at) {
    if (!row) return;
    row.lastEventName = eventName;
    row.lastEventAt = at;
    row.lastMeaningfulMovementAt = at;
  }

  function handleEvent(envelope = {}) {
    if (disposed) return;
    const eventName = text(envelope?.name);
    const data = envelope?.data || {};
    const at = new Date(Number(envelope?.timestamp) || Date.now()).toISOString();
    let changed = false;

    if (eventName === 'tile.action') {
      const row = ensureRow(data);
      if (row) {
        mark(row, eventName, at);
        row.lifecycleState = text(data?.action).toLowerCase() === 'launch-requested' ? 'LAUNCH_REQUESTED' : 'ACTION_OBSERVED';
        if (text(data?.action).toLowerCase() === 'launch-requested') row.lastLaunchRequestedAt = at;
        row.lastResult = text(data?.action);
        changed = true;
      }
    } else if (eventName === 'tile.focused') {
      const row = ensureRow(data);
      if (row) {
        if (activeTileId && rows.has(activeTileId) && activeTileId !== row.tileId) rows.get(activeTileId).active = false;
        activeTileId = row.tileId;
        row.active = true;
        row.lifecycleState = 'FOCUSED';
        row.lastFocusedAt = at;
        mark(row, eventName, at);
        changed = true;
      }
    } else if (eventName === 'workspace:opened' || eventName === 'tile.opened') {
      const row = ensureRow(data);
      if (row) {
        if (activeTileId && rows.has(activeTileId) && activeTileId !== row.tileId) rows.get(activeTileId).active = false;
        activeTileId = row.tileId;
        row.active = true;
        row.lifecycleState = 'OPEN';
        row.workspaceState = 'OPEN';
        if (eventName === 'workspace:opened') row.openCount += 1;
        row.lastOpenedAt = at;
        row.blocker = '';
        mark(row, eventName, at);
        changed = true;
      }
    } else if (eventName === 'workspace:launch_failed') {
      const row = ensureRow(data);
      if (row) {
        activeTileId = row.tileId;
        row.active = true;
        row.lifecycleState = 'FAILED';
        row.workspaceState = 'FAILED';
        row.failureCount += 1;
        row.lastFailureAt = at;
        row.lastResult = 'launch-failed';
        row.blocker = 'WORKSPACE_LAUNCH_FAILED';
        mark(row, eventName, at);
        changed = true;
      }
    } else if (eventName === 'tile.result') {
      const row = ensureRow(data);
      if (row) {
        const result = typeof data?.result === 'string' ? data.result : text(data?.summary || 'result-observed');
        row.lastResult = result;
        if (result.toLowerCase() === 'launch-failed') {
          row.lifecycleState = 'FAILED';
          row.workspaceState = 'FAILED';
          row.blocker = 'WORKSPACE_LAUNCH_FAILED';
          if (!row.lastFailureAt) row.lastFailureAt = at;
        }
        mark(row, eventName, at);
        changed = true;
      }
    } else if (eventName === 'workspace:closed' || eventName === 'tile.closed') {
      const row = activeTileId ? rows.get(activeTileId) : null;
      if (row) {
        row.active = false;
        row.lifecycleState = 'CLOSED';
        row.workspaceState = row.workspaceState === 'FAILED' ? 'FAILED' : 'CLOSED';
        row.lastClosedAt = at;
        mark(row, eventName, at);
        changed = true;
      }
      if (eventName === 'workspace:closed') activeTileId = '';
    }

    if (changed) publish(eventName.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  }

  refreshRegistry(projects);
  lastUpdatedAt = nowFn();

  if (eventBus?.on) disposers.push(eventBus.on('*', handleEvent));

  const service = Object.freeze({
    schemaVersion: TILE_WORKSPACE_TELEMETRY_SCHEMA,
    getSnapshot: snapshot,
    refreshRegistry(nextProjects) {
      refreshRegistry(nextProjects);
      return publish('registry-refresh');
    },
  });

  services?.registerService?.(TILE_WORKSPACE_TELEMETRY_SERVICE, service);
  if (windowRef) windowRef.StephanosTileWorkspaceTelemetry = service;
  publish('module-init');

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of disposers.splice(0)) unsubscribe?.();
    services?.unregisterService?.(TILE_WORKSPACE_TELEMETRY_SERVICE);
    if (windowRef?.StephanosTileWorkspaceTelemetry === service) delete windowRef.StephanosTileWorkspaceTelemetry;
  }

  return Object.freeze({ service, dispose });
}

let activeBinding = null;

export async function init(context = {}) {
  activeBinding?.dispose?.();
  activeBinding = createTileWorkspaceTelemetry({
    projects: context.systemState?.get?.('projects') || context.projects || [],
    eventBus: context.eventBus,
    systemState: context.systemState,
    memoryGateway: context.services?.getService?.('stephanosMemoryGateway') || null,
    services: context.services,
  });
  console.info('[Tile Workspace Telemetry] universal lifecycle projection active', activeBinding.service.getSnapshot());
  return activeBinding.service;
}

export async function dispose() {
  activeBinding?.dispose?.();
  activeBinding = null;
}
