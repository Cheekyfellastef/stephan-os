import { reconcilePaneOrder } from '../../../shared/runtime/paneOrder.mjs';
export { reconcilePaneOrder } from '../../../shared/runtime/paneOrder.mjs';

export const STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY = 'stephanos.tile.paneOrder.v1';

function isStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

export function loadPaneOrder(storageKey = STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, defaultPaneIds = [], storage = globalThis?.localStorage) {
  if (!isStorageAvailable(storage)) {
    return reconcilePaneOrder([], defaultPaneIds);
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return reconcilePaneOrder([], defaultPaneIds);
    }
    const parsed = JSON.parse(raw);
    return reconcilePaneOrder(parsed, defaultPaneIds);
  } catch {
    return reconcilePaneOrder([], defaultPaneIds);
  }
}

export function savePaneOrder(storageKey = STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, paneIds = [], storage = globalThis?.localStorage) {
  if (!isStorageAvailable(storage)) {
    return false;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(Array.isArray(paneIds) ? paneIds : []));
    return true;
  } catch {
    return false;
  }
}
