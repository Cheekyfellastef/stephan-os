export const STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY = 'stephanos.tile.paneOrder.v1';

function isStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

export function reconcilePaneOrder(savedPaneIds, defaultPaneIds) {
  const defaults = Array.isArray(defaultPaneIds) ? defaultPaneIds.map((paneId) => String(paneId || '').trim()).filter(Boolean) : [];
  if (defaults.length === 0) {
    return [];
  }

  const defaultIdSet = new Set(defaults);
  const reconciled = [];
  const seen = new Set();
  const saved = Array.isArray(savedPaneIds) ? savedPaneIds : [];

  saved.forEach((paneId) => {
    const normalizedPaneId = String(paneId || '').trim();
    if (!defaultIdSet.has(normalizedPaneId) || seen.has(normalizedPaneId)) {
      return;
    }
    seen.add(normalizedPaneId);
    reconciled.push(normalizedPaneId);
  });

  defaults.forEach((paneId) => {
    if (!seen.has(paneId)) {
      reconciled.push(paneId);
    }
  });

  return reconciled;
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
