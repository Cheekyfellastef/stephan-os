export const HOLODECK_COMFORT_STORAGE_KEY = 'stephanos.spatial.comfort.v1';
export const HOLODECK_COMFORT_PROFILE_IDS = Object.freeze(['seated','standing']);
export const HOLODECK_COMFORT_LIMITS = Object.freeze({
  heightOffsetMin: -0.8,
  heightOffsetMax: 0.8,
  heightOffsetStep: 0.05,
  keyboardAngleMin: 0,
  keyboardAngleMax: 90,
  keyboardAngleStep: 5,
});

const defaults = () => ({
  activeProfile: 'seated',
  profiles: {
    seated: { heightOffset: 0, keyboardAngle: 0 },
    standing: { heightOffset: 0, keyboardAngle: 0 },
  },
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const tidy = (value) => Math.round(value * 1000) / 1000;

function profile(value = {}) {
  return {
    heightOffset: tidy(clamp(finite(value.heightOffset), HOLODECK_COMFORT_LIMITS.heightOffsetMin,
      HOLODECK_COMFORT_LIMITS.heightOffsetMax)),
    keyboardAngle: tidy(clamp(finite(value.keyboardAngle), HOLODECK_COMFORT_LIMITS.keyboardAngleMin,
      HOLODECK_COMFORT_LIMITS.keyboardAngleMax)),
  };
}

export function sanitizeHolodeckComfortState(value = {}) {
  const base = defaults();
  const activeProfile = HOLODECK_COMFORT_PROFILE_IDS.includes(value?.activeProfile)
    ? value.activeProfile : base.activeProfile;
  return {
    activeProfile,
    profiles: {
      seated: profile(value?.profiles?.seated ?? base.profiles.seated),
      standing: profile(value?.profiles?.standing ?? base.profiles.standing),
    },
  };
}

export function createHolodeckComfortStore({
  storage = globalThis.localStorage,
  storageKey = HOLODECK_COMFORT_STORAGE_KEY,
  onChange = () => {},
} = {}) {
  let state = defaults();
  const listeners = new Set();

  try {
    const raw = storage?.getItem?.(storageKey);
    if (raw) state = sanitizeHolodeckComfortState(JSON.parse(raw));
  } catch {}

  function snapshot() {
    const active = state.profiles[state.activeProfile];
    return {
      activeProfile: state.activeProfile,
      active: { ...active },
      profiles: {
        seated: { ...state.profiles.seated },
        standing: { ...state.profiles.standing },
      },
    };
  }

  function persist() {
    try { storage?.setItem?.(storageKey, JSON.stringify(state)); } catch {}
  }

  function emit() {
    persist();
    const next = snapshot();
    try { onChange(next); } catch {}
    for (const listener of listeners) {
      try { listener(next); } catch {}
    }
    return next;
  }

  function mutateActive(update) {
    const id = state.activeProfile;
    state = {
      ...state,
      profiles: { ...state.profiles, [id]: profile({ ...state.profiles[id], ...update }) },
    };
    return emit();
  }

  return Object.freeze({
    getState: snapshot,
    setActiveProfile(id) {
      if (!HOLODECK_COMFORT_PROFILE_IDS.includes(id) || id === state.activeProfile) return snapshot();
      state = { ...state, activeProfile: id };
      return emit();
    },
    setHeightOffset(value) { return mutateActive({ heightOffset: value }); },
    adjustHeight(delta) { return mutateActive({ heightOffset: state.profiles[state.activeProfile].heightOffset + finite(delta) }); },
    setKeyboardAngle(value) { return mutateActive({ keyboardAngle: value }); },
    adjustKeyboardAngle(delta) { return mutateActive({ keyboardAngle: state.profiles[state.activeProfile].keyboardAngle + finite(delta) }); },
    resetActive() {
      const id = state.activeProfile;
      state = { ...state, profiles: { ...state.profiles, [id]: { heightOffset: 0, keyboardAngle: 0 } } };
      return emit();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
