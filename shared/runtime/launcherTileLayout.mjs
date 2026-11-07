import { reconcilePaneOrder, moveOrderedId } from './paneOrder.mjs';
import {
  LAUNCHER_TILE_ORDER_LAYOUT_KEY,
  STEPHANOS_SESSION_MEMORY_STORAGE_KEY,
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';

export { LAUNCHER_TILE_ORDER_LAYOUT_KEY } from './stephanosSessionMemory.mjs';
export const LAUNCHER_TILE_DRAG_TIMEOUT_MS = 15_000;
const controllers = new WeakMap();

function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
export function launcherTileId(project) {
  return String(project?.id || project?.folder || project?.name || '').trim().toLowerCase();
}
function readPreference(storage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const value = memory.session.ui.uiLayout[LAUNCHER_TILE_ORDER_LAYOUT_KEY];
  return Array.isArray(value) ? value : [];
}
export function readLauncherTileOrder(defaultIds, storage = browserStorage()) {
  return reconcilePaneOrder(readPreference(storage), defaultIds);
}
export function orderLauncherProjects(projects, preferredOrder = []) {
  const list = Array.isArray(projects) ? projects : [];
  const order = reconcilePaneOrder(preferredOrder, list.map(launcherTileId));
  const ranks = new Map(order.map((id, index) => [id, index]));
  return list.map((project, index) => ({ project, index }))
    .sort((a, b) => (ranks.get(launcherTileId(a.project)) ?? order.length) - (ranks.get(launcherTileId(b.project)) ?? order.length) || a.index - b.index)
    .map(({ project }) => project);
}

/** Layout is presentation memory, never execution order or a runtime receipt.
 * The canonical writer deliberately tolerates blocked storage. Verify its
 * actual primary-key write before promising that an arrangement was saved. */
export function persistLauncherTileOrder(order, defaultIds, storage = browserStorage()) {
  const nextOrder = reconcilePaneOrder(order, defaultIds);
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { order: nextOrder, saved: false };
  }
  let primaryWritten = false;
  const observedStorage = {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      storage.setItem(key, value);
      if (key === STEPHANOS_SESSION_MEMORY_STORAGE_KEY) primaryWritten = true;
    },
    removeItem: (key) => storage.removeItem?.(key),
  };
  try {
    const original = storage.getItem(STEPHANOS_SESSION_MEMORY_STORAGE_KEY);
    if (original) JSON.parse(original); // Do not replace unreadable session memory.
    const memory = readPersistedStephanosSessionMemory(observedStorage);
    persistStephanosSessionMemory({
      ...memory,
      session: {
        ...memory.session,
        ui: {
          ...memory.session.ui,
          uiLayout: { ...memory.session.ui.uiLayout, [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: nextOrder },
        },
      },
    }, observedStorage);
    const stored = JSON.parse(storage.getItem(STEPHANOS_SESSION_MEMORY_STORAGE_KEY) || 'null');
    const storedOrder = stored?.session?.ui?.uiLayout?.[LAUNCHER_TILE_ORDER_LAYOUT_KEY];
    return { order: nextOrder, saved: primaryWritten && JSON.stringify(storedOrder) === JSON.stringify(nextOrder) };
  } catch {
    return { order: nextOrder, saved: false };
  }
}

function consume(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function createController(container, storage, timers) {
  const doc = container.ownerDocument || globalThis.document;
  const state = {
    preferredOrder: readPreference(storage), defaultIds: [], order: [], projects: [],
    arranging: false, dragging: '', dragTimer: null, deferredRefresh: null,
    focusId: '', focusControl: 'handle', refresh: null,
    message: 'Arrange tiles to change their order.', saved: null,
    toolbar: null, toggle: null, reset: null, status: null, focusTargets: new Map(),
  };
  function renderAgain(focusId = '') {
    state.focusId = focusId;
    state.refresh?.();
  }
  function finishDrag() {
    state.dragging = '';
    if (state.dragTimer !== null) timers.clearTimeout(state.dragTimer);
    state.dragTimer = null;
    for (const tile of Array.from(container.children || [])) {
      tile.classList?.remove?.('launcher-tile-dragging');
      tile.classList?.remove?.('launcher-tile-drop-target');
    }
    const deferred = state.deferredRefresh;
    state.deferredRefresh = null;
    if (deferred) state.refresh = deferred;
    return Boolean(deferred);
  }
  function captureFocus() {
    if (state.focusId) return;
    const active = doc.activeElement;
    let node = active;
    let id = '';
    while (node && node !== container) {
      if (node.dataset?.tileId) id = node.dataset.tileId;
      node = node.parentNode;
    }
    if (node === container && id) {
      state.focusId = id;
      state.focusControl = active?.dataset?.launcherControl || 'tile';
    }
  }
  function updateToolbar() {
    if (!state.toolbar && container.parentNode?.insertBefore) {
      const toolbar = doc.createElement('div');
      toolbar.className = 'launcher-arrange-toolbar';
      toolbar.setAttribute('aria-label', 'Landing tile layout');
      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'launcher-arrange-toggle';
      toggle.setAttribute('aria-controls', container.id || 'project-registry');
      toggle.onclick = () => {
        finishDrag();
        state.arranging = !state.arranging;
        if (state.arranging) state.message = 'Drag a handle or use the move buttons. Arrow keys also move a focused handle.';
        else state.message = state.saved === true ? 'Layout saved in this browser.' : state.saved === false ? 'Order is not saved. Browser storage is unavailable or full; changes last for this visit.' : 'Arrange tiles to change their order.';
        renderAgain();
      };
      const reset = doc.createElement('button');
      reset.type = 'button';
      reset.className = 'launcher-order-reset';
      reset.textContent = 'Reset order';
      reset.onclick = () => saveOrder(state.defaultIds, '', true);
      const status = doc.createElement('span');
      status.className = 'launcher-order-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      toolbar.appendChild(toggle);
      toolbar.appendChild(reset);
      toolbar.appendChild(status);
      container.parentNode.insertBefore(toolbar, container);
      Object.assign(state, { toolbar, toggle, reset, status });
    }
    if (state.toolbar) {
      state.toggle.textContent = state.arranging ? 'Done arranging' : 'Arrange tiles';
      state.toggle.setAttribute('aria-pressed', String(state.arranging));
      state.reset.hidden = !state.arranging;
      state.reset.disabled = JSON.stringify(state.order) === JSON.stringify(state.defaultIds);
      state.status.textContent = state.message;
      state.status.dataset.saveState = state.message.startsWith('Drag a handle') ? 'idle' : state.saved === true ? 'saved' : state.saved === false ? 'unsaved' : 'idle';
    }
    container.dataset.arranging = String(state.arranging);
  }
  function saveOrder(next, focusId, reset = false) {
    const result = persistLauncherTileOrder(next, state.defaultIds, storage);
    state.preferredOrder = result.order;
    state.order = result.order;
    state.saved = result.saved;
    const movedName = state.projects.find((project) => launcherTileId(project) === focusId)?.name || 'Tile';
    const action = reset ? 'Default order restored.' : `${movedName} moved to position ${state.order.indexOf(focusId) + 1} of ${state.order.length}.`;
    state.message = result.saved
      ? `${action} Saved in this browser.`
      : `${action} Not saved: browser storage is unavailable or full. This order lasts for this visit.`;
    finishDrag();
    renderAgain(focusId);
  }
  function move(id, target) {
    if (!state.arranging) return false;
    const next = moveOrderedId(state.order, id, target);
    if (JSON.stringify(next) === JSON.stringify(state.order)) return false;
    saveOrder(next, id);
    return true;
  }
  function decorateTile(tile, project, launch) {
    const id = launcherTileId(project);
    const name = project?.name || id || 'Tile';
    const index = state.order.indexOf(id);
    tile.dataset.tileId = id;
    tile.dataset.arranging = String(state.arranging);
    tile.tabIndex = state.arranging || typeof launch !== 'function' ? -1 : 0;
    tile.setAttribute('role', state.arranging ? 'group' : 'button');
    tile.setAttribute('aria-disabled', String(!state.arranging && typeof launch !== 'function'));
    tile.setAttribute('aria-label', state.arranging ? `${name}, position ${index + 1} of ${state.order.length}` : `Open ${name}`);
    state.focusTargets.set(`${id}:tile`, tile);
    tile.onclick = typeof launch === 'function' ? (event) => {
      if (state.arranging) { consume(event); return; }
      launch(event);
    } : null;
    tile.onkeydown = (event) => {
      if (event.target !== tile || state.arranging || typeof launch !== 'function') return;
      if (event.key === 'Enter' || event.key === ' ') { consume(event); launch(event); }
    };
    if (!state.arranging || index < 0) return;
    // The grid remains a responsive flow layout. Only ID order is persisted;
    // desktop pixels never become mobile or VR coordinates.
    const controls = doc.createElement('div');
    controls.className = 'launcher-tile-move-controls';
    controls.onclick = (event) => event.stopPropagation();
    const handle = doc.createElement('button');
    handle.type = 'button';
    handle.className = 'launcher-tile-drag-handle';
    handle.dataset.launcherControl = 'handle';
    handle.textContent = '⋮⋮';
    handle.title = `Drag ${name}; arrow keys move it earlier or later`;
    handle.setAttribute('aria-label', `Move ${name}, position ${index + 1} of ${state.order.length}. Use arrow keys or drag.`);
    handle.draggable = true;
    handle.onclick = consume;
    handle.onkeydown = (event) => {
      const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
      if (direction) { consume(event); move(id, index + direction); }
      else if (event.key === 'Home' || event.key === 'End') { consume(event); move(id, event.key === 'Home' ? 0 : state.order.length - 1); }
    };
    handle.ondragstart = (event) => {
      if (!state.arranging) { consume(event); return; }
      state.dragging = id;
      if (state.dragTimer !== null) timers.clearTimeout(state.dragTimer);
      state.dragTimer = timers.setTimeout(() => {
        const deferred = finishDrag();
        state.message = 'Drag ended after 15 seconds. Start again or use the move buttons.';
        state.saved = null;
        updateToolbar();
        if (deferred) renderAgain();
      }, LAUNCHER_TILE_DRAG_TIMEOUT_MS);
      state.dragTimer?.unref?.();
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }
      tile.classList.add('launcher-tile-dragging');
      event.stopPropagation();
    };
    handle.ondragend = () => {
      if (finishDrag()) renderAgain();
    };
    tile.ondragover = (event) => {
      if (!state.dragging || state.dragging === id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      tile.classList.add('launcher-tile-drop-target');
    };
    tile.ondragleave = () => tile.classList.remove?.('launcher-tile-drop-target');
    tile.ondrop = (event) => {
      if (!state.dragging) return;
      consume(event);
      // Ignore external drag payloads. Only a handle from this grid can move it.
      const dragged = state.dragging;
      const deferred = finishDrag();
      if (!move(dragged, index) && deferred) renderAgain();
    };
    function moveButton(direction, label) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'launcher-tile-move-button';
      button.dataset.launcherControl = direction < 0 ? 'earlier' : 'later';
      button.textContent = direction < 0 ? '←' : '→';
      button.title = `${label} ${name}`;
      button.setAttribute('aria-label', `${label} ${name}`);
      button.disabled = direction < 0 ? index === 0 : index === state.order.length - 1;
      button.onclick = (event) => { consume(event); move(id, index + direction); };
      state.focusTargets.set(`${id}:${button.dataset.launcherControl}`, button);
      return button;
    }
    controls.appendChild(moveButton(-1, 'Move earlier:'));
    controls.appendChild(handle);
    controls.appendChild(moveButton(1, 'Move later:'));
    tile.appendChild(controls);
    state.focusTargets.set(`${id}:handle`, handle);
  }
  return {
    prepare(projects, refresh) {
      if (state.dragging) {
        // Keep the actual native drag source alive. Only the newest refresh is
        // retained, and drop/cancel/timeout always releases this bounded hold.
        state.deferredRefresh = refresh;
        return { deferred: true };
      }
      state.projects = Array.isArray(projects) ? projects : [];
      state.defaultIds = reconcilePaneOrder([], state.projects.map(launcherTileId));
      state.order = reconcilePaneOrder(state.preferredOrder, state.defaultIds);
      state.refresh = refresh;
      updateToolbar();
      return {
        projects: orderLauncherProjects(state.projects, state.order),
        signature: JSON.stringify({ order: state.order, arranging: state.arranging }),
        beforeRender() {
          captureFocus();
          state.focusTargets.clear();
        },
        decorateTile,
        afterRender() {
          if (state.focusId) {
            let target = state.focusTargets.get(`${state.focusId}:${state.focusControl}`);
            if (!target || target.disabled) target = state.focusTargets.get(`${state.focusId}:handle`) || state.focusTargets.get(`${state.focusId}:tile`) || state.toggle;
            target?.focus?.();
          }
          state.focusId = '';
          state.focusControl = 'handle';
        },
      };
    },
  };
}

/** The primary renderer and its recovery renderer use the same adapter. */
export function prepareLauncherTileLayout(container, projects, refresh, { storage = browserStorage(), timers = globalThis } = {}) {
  let controller = controllers.get(container);
  if (!controller) {
    controller = createController(container, storage, timers);
    controllers.set(container, controller);
  }
  return controller.prepare(projects, refresh);
}
