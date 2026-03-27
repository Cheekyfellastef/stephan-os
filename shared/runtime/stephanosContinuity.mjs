const CONTINUITY_SCHEMA_VERSION = 1;

const DEFAULT_STATE = Object.freeze({
  schemaVersion: CONTINUITY_SCHEMA_VERSION,
  updatedAt: '',
  session: {
    continuityId: '',
    surfaceMode: '',
    routeKind: '',
  },
  environment: {
    activeSurface: 'launcher-root',
    providerStateRef: '',
  },
  workspace: {
    activeWorkspace: 'launcher',
    activeTileId: '',
    activeTileTitle: '',
  },
  operator: {
    currentTask: '',
    focus: '',
  },
  truth: {
    truthPanelVisible: false,
    lawsPanelVisible: false,
    realitySyncEnabled: true,
  },
  recentEvents: [],
});

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function merge(base = {}, patch = {}) {
  return {
    ...base,
    ...patch,
  };
}

function normalizeRecentEvents(events = []) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((entry) => ({
      name: normalizeString(entry?.name),
      summary: normalizeString(entry?.summary || entry?.name),
      timestamp: normalizeString(entry?.timestamp, new Date().toISOString()),
      source: normalizeString(entry?.source, 'runtime'),
    }))
    .filter((entry) => entry.name)
    .slice(-15);
}

function createContinuitySnapshot(currentState = {}) {
  return {
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    updatedAt: normalizeString(currentState.updatedAt, new Date().toISOString()),
    session: merge(cloneDefaultState().session, currentState.session),
    environment: merge(cloneDefaultState().environment, currentState.environment),
    workspace: merge(cloneDefaultState().workspace, currentState.workspace),
    operator: merge(cloneDefaultState().operator, currentState.operator),
    truth: merge(cloneDefaultState().truth, currentState.truth),
    recentEvents: normalizeRecentEvents(currentState.recentEvents),
  };
}

export function createStephanosContinuityCore(initialState = {}) {
  let state = createContinuitySnapshot(initialState);
  const listeners = new Set();

  function getState() {
    return createContinuitySnapshot(state);
  }

  function notify() {
    const snapshot = getState();
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  function update(patch = {}, metadata = {}) {
    state = createContinuitySnapshot({
      ...state,
      ...patch,
      session: merge(state.session, patch.session),
      environment: merge(state.environment, patch.environment),
      workspace: merge(state.workspace, patch.workspace),
      operator: merge(state.operator, patch.operator),
      truth: merge(state.truth, patch.truth),
      recentEvents: patch.recentEvents ?? state.recentEvents,
      updatedAt: normalizeString(metadata.updatedAt, new Date().toISOString()),
    });

    notify();
    return getState();
  }

  function pushEvent(event = {}) {
    const entry = {
      name: normalizeString(event.name),
      summary: normalizeString(event.summary || event.name),
      timestamp: normalizeString(event.timestamp, new Date().toISOString()),
      source: normalizeString(event.source, 'runtime'),
    };

    if (!entry.name) {
      return getState();
    }

    return update({
      recentEvents: [...state.recentEvents, entry].slice(-15),
    }, { updatedAt: entry.timestamp });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Stephanos continuity subscribe requires function listener.');
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getState,
    update,
    pushEvent,
    subscribe,
  };
}

export function createStephanosContinuityService({
  eventBus,
  memoryGateway = null,
  initialState = {},
  persistEventNames = [],
} = {}) {
  const continuity = createStephanosContinuityCore(initialState);
  const persistSet = new Set(persistEventNames.map((name) => normalizeString(name)).filter(Boolean));

  if (eventBus && typeof eventBus.on === 'function') {
    eventBus.on('*', (envelope) => {
      const name = normalizeString(envelope?.name);
      const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : {};
      if (!name) {
        return;
      }

      const summary = normalizeString(data.summary || data.message || name, name);
      continuity.pushEvent({
        name,
        summary,
        timestamp: new Date(envelope?.timestamp || Date.now()).toISOString(),
        source: normalizeString(data.source, 'event-bus'),
      });

      if (name === 'workspace:opened' || name === 'tile.opened') {
        continuity.update({
          workspace: {
            activeWorkspace: 'workspace',
            activeTileId: normalizeString(data.id || data.tileId || data.folder),
            activeTileTitle: normalizeString(data.name || data.tileTitle),
          },
        });
      }

      if (name === 'workspace:closed' || name === 'tile.closed') {
        continuity.update({
          workspace: {
            activeWorkspace: 'launcher',
            activeTileId: '',
            activeTileTitle: '',
          },
        });
      }

      if (persistSet.has(name) && memoryGateway?.persistEventRecord) {
        memoryGateway.persistEventRecord({ name, data });
      }
    });
  }

  return {
    ...continuity,
    shouldPersistEvent(eventName = '') {
      return persistSet.has(normalizeString(eventName));
    },
  };
}
