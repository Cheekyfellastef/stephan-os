import { HOLODECK_CONSOLE, HOLODECK_DISPLAY } from './holodeck-layout-v1.mjs';

// Room presentation preferences and their matching physical geometry. This does not change
// headset tracking, browser permissions, native input authority, or execution authority.
export const HOLODECK_COMFORT_STORAGE_KEY = 'stephanos.spatial.holodeck.comfort.v1';
export const HOLODECK_COMFORT_DEFAULTS = Object.freeze({ heightOffset: 0, keyboardTilt: 0 });
export const HOLODECK_COMFORT_MODES = Object.freeze(['seated', 'standing']);
export const HOLODECK_COMFORT_LIMITS = Object.freeze({
  heightOffset: Object.freeze({ min: -1, max: 1 }),
  keyboardTilt: Object.freeze({ min: 0, max: 90 }),
});

const clamp = (value, { min, max }) => Math.max(min, Math.min(max, value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const notify = (callback, value) => { try { callback?.(value); } catch {} };

const defaultProfiles = () => ({
  seated: { ...HOLODECK_COMFORT_DEFAULTS }, standing: { ...HOLODECK_COMFORT_DEFAULTS },
});
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

function restoredProfile(value) {
  if (!isRecord(value)) return null;
  for (const key of ['heightOffset', 'keyboardTilt']) {
    if (!isNumber(value[key]) || value[key] < HOLODECK_COMFORT_LIMITS[key].min
      || value[key] > HOLODECK_COMFORT_LIMITS[key].max) return null;
  }
  return { heightOffset: value.heightOffset, keyboardTilt: value.keyboardTilt };
}

function restoredState(value) {
  if (!isRecord(value)) return null;
  if (value.version === 1) {
    const seated = restoredProfile(value);
    return seated ? { mode: 'seated', profiles: { ...defaultProfiles(), seated }, migrated: true } : null;
  }
  if (value.version !== 2) return null;
  const profiles = defaultProfiles();
  let repaired = !HOLODECK_COMFORT_MODES.includes(value.mode);
  for (const mode of HOLODECK_COMFORT_MODES) {
    const restored = isRecord(value.profiles) && restoredProfile(value.profiles[mode]);
    if (restored) profiles[mode] = restored;
    else repaired = true;
  }
  return { mode: HOLODECK_COMFORT_MODES.includes(value.mode) ? value.mode : 'seated', profiles, repaired };
}

export function createHolodeckComfort({ storage, onChange, onStatus } = {}) {
  let state = { mode: 'seated', profiles: defaultProfiles() };
  let dirty = false;
  let preferenceStorage;
  const status = (kind, message) => notify(onStatus, { state: kind, message });
  const sessionOnly = () => status('session-only',
    'Comfort settings apply for this session; browser storage is unavailable.');

  // Accessing localStorage itself can throw in a privacy-restricted browser.
  try {
    preferenceStorage = storage === undefined ? globalThis.localStorage : storage;
    if (typeof preferenceStorage?.getItem !== 'function') {
      sessionOnly();
    } else {
      const saved = preferenceStorage.getItem(HOLODECK_COMFORT_STORAGE_KEY);
      if (saved == null) {
        status('defaults', 'Seated and standing settings are at their default positions.');
      } else {
        let restored;
        try { restored = restoredState(JSON.parse(saved)); } catch {}
        if (restored) {
          state = { mode: restored.mode, profiles: restored.profiles };
          // Persist migrations/repaired preferences only on an explicit flush.
          dirty = Boolean(restored.migrated || restored.repaired);
          status(restored.repaired ? 'defaults' : 'restored', restored.repaired
            ? 'Invalid comfort preferences were reset; valid profile settings were kept.'
            : 'Saved comfort settings restored.');
        } else {
          status('defaults', 'Saved comfort settings were invalid; default positions restored.');
        }
      }
    }
  } catch {
    sessionOnly();
  }

  function getState() {
    return {
      ...state.profiles[state.mode], mode: state.mode,
      profiles: { seated: { ...state.profiles.seated }, standing: { ...state.profiles.standing } },
    };
  }

  function set(key, value) {
    if (!isNumber(value)) return getState();
    const next = clamp(value, HOLODECK_COMFORT_LIMITS[key]);
    if (next !== state.profiles[state.mode][key]) {
      state = { ...state, profiles: {
        ...state.profiles, [state.mode]: { ...state.profiles[state.mode], [key]: next },
      } };
      dirty = true;
      notify(onChange, getState());
    }
    return getState();
  }

  // The input owner flushes on release, reset, or session exit, never per frame.
  // Keep a failed write dirty so a later explicit flush can retry safely.
  function flush() {
    if (!dirty) return true;
    try {
      if (typeof preferenceStorage?.setItem !== 'function') {
        sessionOnly();
        return false;
      }
      preferenceStorage.setItem(HOLODECK_COMFORT_STORAGE_KEY, JSON.stringify({ version: 2, ...state }));
      dirty = false;
      status('saved', 'Comfort settings saved.');
      return true;
    } catch {
      sessionOnly();
      return false;
    }
  }

  function setMode(mode) {
    if (!HOLODECK_COMFORT_MODES.includes(mode)) return getState();
    if (mode !== state.mode) {
      state = { ...state, mode };
      dirty = true;
      notify(onChange, getState());
    }
    // One write saves the old profile's pending edits together with the new
    // selection. Applying a profile always uses absolute, never summed, offsets.
    flush();
    return getState();
  }

  function reset() {
    const current = state.profiles[state.mode];
    const changed = current.heightOffset !== 0 || current.keyboardTilt !== 0;
    state = { ...state, profiles: { ...state.profiles, [state.mode]: { ...HOLODECK_COMFORT_DEFAULTS } } };
    // An explicit reset also replaces an invalid saved preference record.
    dirty = true;
    if (changed) notify(onChange, getState());
    flush();
    return getState();
  }

  return {
    getState,
    setMode,
    setHeightOffset: (value) => set('heightOffset', value),
    setKeyboardTilt: (value) => set('keyboardTilt', value),
    reset,
    flush,
  };
}

// The front edge stays in place as the rear edge rises. Positive X rotation
// turns the flat upward-facing keys towards the user at +Z, reaching vertical.
export const HOLODECK_KEYBOARD_HINGE = Object.freeze([
  0, HOLODECK_CONSOLE.top, HOLODECK_CONSOLE.center[2] + HOLODECK_CONSOLE.halfDepth,
]);
export const HOLODECK_KEYBOARD_DIAL_RADIUS = 0.16;
export const HOLODECK_KEYBOARD_DIAL_HALF_DEPTH = 0.07;
export const HOLODECK_KEYBOARD_DIAL_HIT_RADIUS = Math.hypot(
  HOLODECK_KEYBOARD_DIAL_RADIUS, HOLODECK_KEYBOARD_DIAL_HALF_DEPTH,
) + 0.02;
export const HOLODECK_KEYBOARD_DIALS = Object.freeze(['left', 'right'].map((id, i) => Object.freeze({
  id,
  center: Object.freeze([
    (i === 0 ? -1 : 1) * (HOLODECK_CONSOLE.halfWidth + 0.17),
    HOLODECK_KEYBOARD_HINGE[1], HOLODECK_KEYBOARD_HINGE[2],
  ]),
  radius: HOLODECK_KEYBOARD_DIAL_RADIUS,
  halfDepth: HOLODECK_KEYBOARD_DIAL_HALF_DEPTH,
  hitRadius: HOLODECK_KEYBOARD_DIAL_HIT_RADIUS,
})));

function rotateAboutX(vector, tiltDegrees, inverse = false) {
  const bounded = isNumber(tiltDegrees) ? clamp(tiltDegrees, HOLODECK_COMFORT_LIMITS.keyboardTilt) : 0;
  const angle = bounded * Math.PI / 180 * (inverse ? -1 : 1);
  const c = Math.cos(angle), s = Math.sin(angle);
  return [vector[0], vector[1] * c - vector[2] * s, vector[1] * s + vector[2] * c];
}

export function consoleDirectionToWorld(direction, tiltDegrees = 0) {
  return rotateAboutX(direction, tiltDegrees);
}

export function consoleDirectionFromWorld(direction, tiltDegrees = 0) {
  return rotateAboutX(direction, tiltDegrees, true);
}

function transformPoint(point, tiltDegrees, inverse) {
  const hinge = HOLODECK_KEYBOARD_HINGE;
  const result = rotateAboutX([point[0] - hinge[0], point[1] - hinge[1], point[2] - hinge[2]],
    tiltDegrees, inverse);
  return result.map((value, index) => value + hinge[index]);
}

// Inputs use the original world-flat console coordinates, so rendering and
// hit-testing share one rigid transform without a second keyboard layout.
export function consolePointToWorld(point, tiltDegrees = 0) {
  return transformPoint(point, tiltDegrees, false);
}

export function consolePointFromWorld(point, tiltDegrees = 0) {
  return transformPoint(point, tiltDegrees, true);
}


const dot3 = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const planeAt = (normal, point) => [normal, dot3(normal, point)];

function axisAlignedSolid({ minX, maxX, minY, maxY, minZ, maxZ }) {
  return [
    planeAt([1,0,0], [maxX,0,0]), planeAt([-1,0,0], [minX,0,0]),
    planeAt([0,1,0], [0,maxY,0]), planeAt([0,-1,0], [0,minY,0]),
    planeAt([0,0,1], [0,0,maxZ]), planeAt([0,0,-1], [0,0,minZ]),
  ];
}

function tiltedKeyboardSolid(tiltDegrees, furnitureOffset=[0,0,0]) {
  const c = HOLODECK_CONSOLE;
  const halfWidth = c.halfWidth - 0.06;
  const halfDepth = c.halfDepth - 0.02;
  const faces = [
    [[1,0,0], [halfWidth,c.top,c.center[2]]],
    [[-1,0,0], [-halfWidth,c.top,c.center[2]]],
    [[0,1,0], [0,c.top+0.003,c.center[2]]],
    [[0,-1,0], [0,c.top-0.02,c.center[2]]],
    [[0,0,1], [0,c.top,c.center[2]+halfDepth]],
    [[0,0,-1], [0,c.top,c.center[2]-halfDepth]],
  ];
  return faces.map(([normal, point]) => {
    const worldNormal = consoleDirectionToWorld(normal, tiltDegrees);
    const worldPoint = consolePointToWorld(point, tiltDegrees).map((v,i)=>v+furnitureOffset[i]);
    return planeAt(worldNormal, worldPoint);
  });
}

// Physical-by-default contract for the adjustable console surfaces. Decorative grid/light
// lines remain non-solid; the display, keyboard tray and both visible dial bodies do not.
export function createHolodeckComfortSolids({ keyboardTilt = 0, furnitureOffset = [0,0,0] } = {}) {
  const d = HOLODECK_DISPLAY;
  const display = axisAlignedSolid({
    minX: -d.halfWidth, maxX: d.halfWidth, minY: d.bottom, maxY: d.top,
    minZ: d.z - 0.02, maxZ: d.z + 0.02,
  });
  const dials = HOLODECK_KEYBOARD_DIALS.map((dial) => axisAlignedSolid({
    minX: dial.center[0] + furnitureOffset[0] - dial.halfDepth, maxX: dial.center[0] + furnitureOffset[0] + dial.halfDepth,
    minY: dial.center[1] + furnitureOffset[1] - dial.radius, maxY: dial.center[1] + furnitureOffset[1] + dial.radius,
    minZ: dial.center[2] + furnitureOffset[2] - dial.radius, maxZ: dial.center[2] + furnitureOffset[2] + dial.radius,
  }));
  return [tiltedKeyboardSolid(keyboardTilt,furnitureOffset), display, ...dials];
}
