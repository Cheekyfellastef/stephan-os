import {
  reducePresenceState,
  acknowledgePresenceItem as acknowledgePresenceItemInModel,
  dismissPresenceItem as dismissPresenceItemInModel,
  approvePresenceAction as approvePresenceActionInModel,
} from './stephanosPresenceModel.mjs';

const STORAGE_KEY = 'stephanos.presence.shared.v2';
const EVENT_NAME = 'stephanos:presence-event';
let state = loadState();

function loadState() {
  try {
    const raw = globalThis.sessionStorage?.getItem?.(STORAGE_KEY) || '';
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistState() {
  try {
    globalThis.sessionStorage?.setItem?.(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function reducePresenceEvent(event = {}) {
  state = reducePresenceState(state, event);
  persistState();
  return state;
}

export function emitPresenceEvent(event = {}) {
  const next = reducePresenceEvent(event);
  globalThis.dispatchEvent?.(new CustomEvent(EVENT_NAME, { detail: event }));
  return next;
}

export function subscribePresenceEvents(handler) {
  if (typeof handler !== 'function') return () => {};
  const onEvent = (event) => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
    reducePresenceEvent(detail);
    handler(detail, getPresenceState());
  };
  globalThis.addEventListener?.(EVENT_NAME, onEvent);
  return () => globalThis.removeEventListener?.(EVENT_NAME, onEvent);
}

export function getPresenceState() {
  return state;
}

export function acknowledgePresenceItem(idValue = '') {
  state = acknowledgePresenceItemInModel(state, idValue);
  persistState();
  return state;
}

export function dismissPresenceItem(idValue = '') {
  state = dismissPresenceItemInModel(state, idValue);
  persistState();
  return state;
}

export function approvePresenceAction(idValue = '') {
  state = approvePresenceActionInModel(state, idValue);
  persistState();
  return state;
}
