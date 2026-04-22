const SESSION_TYPE = 'playback-v1';

function nowIso() {
  return new Date().toISOString();
}

function sanitizePlaybackSession(value = {}) {
  return {
    type: SESSION_TYPE,
    mode: value.mode === 'flow' ? 'flow' : 'single',
    flowState: ['idle', 'active', 'paused', 'externally-opened', 'ended'].includes(value.flowState)
      ? value.flowState
      : 'idle',
    queueIds: Array.isArray(value.queueIds) ? value.queueIds.filter((id) => typeof id === 'string' && id) : [],
    currentIndex: Number.isInteger(value.currentIndex) ? value.currentIndex : -1,
    currentMediaItemId: typeof value.currentMediaItemId === 'string' ? value.currentMediaItemId : '',
    lastExternalOpenAt: typeof value.lastExternalOpenAt === 'string' ? value.lastExternalOpenAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
  };
}

function upsertPlaybackSession(memory, playbackSession) {
  const sessions = Array.isArray(memory.sessions) ? [...memory.sessions] : [];
  const sanitized = sanitizePlaybackSession(playbackSession);
  const existingIndex = sessions.findIndex((entry) => entry?.type === SESSION_TYPE);

  if (existingIndex >= 0) {
    sessions[existingIndex] = sanitized;
  } else {
    sessions.unshift(sanitized);
  }

  return {
    ...memory,
    sessions,
  };
}

function getPlaybackSession(memory) {
  const sessions = Array.isArray(memory?.sessions) ? memory.sessions : [];
  const existing = sessions.find((entry) => entry?.type === SESSION_TYPE);
  return existing ? sanitizePlaybackSession(existing) : sanitizePlaybackSession();
}

export function createMusicTileSessionStore({
  readMemory,
  writeMemory,
} = {}) {
  function read() {
    return getPlaybackSession(readMemory?.());
  }

  function patch(updates = {}) {
    const current = read();
    const next = sanitizePlaybackSession({
      ...current,
      ...updates,
      updatedAt: nowIso(),
    });
    const nextMemory = upsertPlaybackSession(readMemory?.() || {}, next);
    writeMemory?.(nextMemory);
    return next;
  }

  return {
    read,
    patch,
  };
}
