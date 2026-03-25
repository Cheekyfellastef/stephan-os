const STORAGE_KEY = 'stephanos.musicTile.state.v1';
const SCHEMA_VERSION = 1;

export const DEFAULT_SELECTION = {
  era: 'afterlife-modern',
  energyCurve: 'rising',
  emotion: 'transcendent',
  density: 'layered'
};

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function sanitizeSelection(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SELECTION };
  }

  const next = { ...DEFAULT_SELECTION };

  if (typeof value.era === 'string') next.era = value.era;
  if (typeof value.energyCurve === 'string') next.energyCurve = value.energyCurve;
  if (typeof value.emotion === 'string') next.emotion = value.emotion;
  if (typeof value.density === 'string') next.density = value.density;

  return next;
}

export function loadMusicTileState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      version: SCHEMA_VERSION,
      selection: { ...DEFAULT_SELECTION }
    };
  }

  const parsed = safeParse(raw);
  if (!parsed || parsed.version !== SCHEMA_VERSION) {
    return {
      version: SCHEMA_VERSION,
      selection: { ...DEFAULT_SELECTION }
    };
  }

  return {
    version: SCHEMA_VERSION,
    selection: sanitizeSelection(parsed.selection)
  };
}

export function saveMusicTileState(selection) {
  const payload = {
    version: SCHEMA_VERSION,
    selection: sanitizeSelection(selection)
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function resetMusicTileState() {
  window.localStorage.removeItem(STORAGE_KEY);
  return {
    version: SCHEMA_VERSION,
    selection: { ...DEFAULT_SELECTION }
  };
}
