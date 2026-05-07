import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';
import { createUIRenderer } from '../../system/ui_renderer.js';

const PANEL_POSITION_KEY = 'panelPositions';
const PANEL_COLLAPSE_KEY = 'panelCollapsed';
const GRID_COLUMNS = 12;
const CANON_MOUNTED_ATTR = 'data-canon-pane-mounted';
const CANON_MOUNT_HOST_ATTR = 'data-canon-pane-host';

function slugifySegment(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pane';
}

function appendContentToPanelContainer(panel, contentNode) {
  if (!panel || !contentNode) return;
  const panelContent = typeof panel.querySelector === 'function'
    ? panel.querySelector('.stephanos-panel-content')
    : null;
  const mountTarget = panelContent || panel;
  if (contentNode.parentNode !== mountTarget) {
    mountTarget.appendChild(contentNode);
  }
}

function normalizeClassTokens(value) {
  if (value == null || value === false) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeClassTokens(entry));
  }
  return String(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function safeAddClassTokens(node, classValues, context = {}) {
  if (!node?.classList || typeof node.classList.add !== 'function') return;
  const tokens = normalizeClassTokens(classValues);
  if (!tokens.length) return;
  try {
    node.classList.add(...tokens);
  } catch (error) {
    console.error('[CANON TILE PANES] failed to apply class tokens', {
      ...context,
      classValues,
      tokens,
      error: error?.message || String(error),
    });
  }
}

export function toCanonTilePaneDomId(appId, paneId) {
  const app = slugifySegment(appId);
  const pane = slugifySegment(paneId);
  return `${app}-${pane}`;
}

export function clearCanonTilePaneLayout({ appId, paneIds = [], storage = globalThis.localStorage } = {}) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const uiLayout = memory?.session?.ui?.uiLayout || {};
  const panelPositions = uiLayout[PANEL_POSITION_KEY] && typeof uiLayout[PANEL_POSITION_KEY] === 'object'
    ? { ...uiLayout[PANEL_POSITION_KEY] }
    : {};
  const panelCollapsed = uiLayout[PANEL_COLLAPSE_KEY] && typeof uiLayout[PANEL_COLLAPSE_KEY] === 'object'
    ? { ...uiLayout[PANEL_COLLAPSE_KEY] }
    : {};

  paneIds.forEach((paneId) => {
    const domId = toCanonTilePaneDomId(appId, paneId);
    delete panelPositions[domId];
    delete panelCollapsed[domId];
  });

  persistStephanosSessionMemory({
    ...memory,
    session: {
      ...memory?.session,
      ui: {
        ...memory?.session?.ui,
        uiLayout: {
          ...uiLayout,
          [PANEL_POSITION_KEY]: panelPositions,
          [PANEL_COLLAPSE_KEY]: panelCollapsed,
        },
      },
    },
  }, storage);
}



function readPanelPositionsFromMemory(storage = globalThis.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const uiLayout = memory?.session?.ui?.uiLayout || {};
  return uiLayout[PANEL_POSITION_KEY] && typeof uiLayout[PANEL_POSITION_KEY] === 'object'
    ? { ...uiLayout[PANEL_POSITION_KEY] }
    : {};
}

function readPanelCollapsedFromMemory(storage = globalThis.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const uiLayout = memory?.session?.ui?.uiLayout || {};
  return uiLayout[PANEL_COLLAPSE_KEY] && typeof uiLayout[PANEL_COLLAPSE_KEY] === 'object'
    ? { ...uiLayout[PANEL_COLLAPSE_KEY] }
    : {};
}

function writePanelPositionsToMemory(positions, storage = globalThis.localStorage) {
  const memory = readPersistedStephanosSessionMemory(storage);
  const uiLayout = memory?.session?.ui?.uiLayout || {};
  persistStephanosSessionMemory({
    ...memory,
    session: {
      ...memory?.session,
      ui: {
        ...memory?.session?.ui,
        uiLayout: {
          ...uiLayout,
          [PANEL_POSITION_KEY]: positions,
        },
      },
    },
  }, storage);
}
/**
 * Canon tile pane manager for movable/collapsible/persisted tile panes.
 *
 * Future tiles should use this helper instead of re-implementing drag/persistence logic.
 */
export function createCanonTilePaneManager({
  appId,
  layoutMode = 'freeform',
  storage = globalThis.localStorage,
  uiRenderer = createUIRenderer(),
} = {}) {
  const normalizedAppId = slugifySegment(appId);
  if (!normalizedAppId) {
    throw new Error('createCanonTilePaneManager requires a non-empty appId.');
  }

  const registeredPanes = new Map();
  const sectionToPaneId = new WeakMap();
  const isGridSlotMode = layoutMode === 'grid-slot';

  function applyGridLayout(defaultEntries = []) {
    const panelPositions = readPanelPositionsFromMemory(storage);
    const panelCollapsed = readPanelCollapsedFromMemory(storage);
    let hasUpdates = false;
    const container = globalThis.document?.getElementById?.('stephanos-panel-stack');
    if (container) container.classList.add('stephanos-panel-stack-grid-slot');
    defaultEntries.forEach((entry) => {
      const normalizedPaneId = slugifySegment(entry?.paneId);
      if (!normalizedPaneId) return;
      const domId = toCanonTilePaneDomId(normalizedAppId, normalizedPaneId);
      const panel = globalThis.document?.getElementById(domId);
      if (!panel) return;
      const persisted = panelPositions[domId];
      const gridX = Number(persisted?.gridX ?? entry?.gridX);
      const gridY = Number(persisted?.gridY ?? entry?.gridY);
      const gridW = Number(persisted?.gridW ?? entry?.gridW ?? 3);
      const gridH = Number(persisted?.gridH ?? entry?.gridH ?? 1);
      const order = Number(persisted?.order ?? entry?.order ?? 0);
      const collapsed = Boolean(panelCollapsed[domId] ?? persisted?.collapsed);
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return;
      panel.classList.add('stephanos-panel-grid-slot');
      panel.dataset.layoutMode = 'grid-slot';
      panel.dataset.gridX = String(gridX);
      panel.dataset.gridY = String(gridY);
      panel.dataset.gridW = String(gridW);
      panel.dataset.gridH = String(gridH);
      panel.dataset.gridCollapsedH = '1';
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
      panel.style.maxHeight = '';
      panel.style.gridColumn = `${Math.max(1, gridX)} / span ${Math.max(1, Math.min(GRID_COLUMNS, gridW))}`;
      panel.style.gridRow = `${Math.max(1, gridY)} / span ${collapsed ? 1 : Math.max(1, gridH)}`;
      panel.style.order = String(order);
      panelPositions[domId] = { gridX, gridY, gridW, gridH, order, collapsed };
      hasUpdates = true;
    });
    if (hasUpdates) writePanelPositionsToMemory(panelPositions, storage);
  }

  function getMountedHostId(node) {
    return String(node?.getAttribute?.(CANON_MOUNT_HOST_ATTR) || '').trim();
  }

  function getMountedPanelForNode(node) {
    const mountedHostId = getMountedHostId(node);
    if (!mountedHostId) return null;
    return globalThis.document?.getElementById?.(mountedHostId) || null;
  }

  function mountPane({ paneId, title, contentNode, panelClassName = '' } = {}) {
    const normalizedPaneId = slugifySegment(paneId);
    const domId = toCanonTilePaneDomId(normalizedAppId, normalizedPaneId);
    const existingPanel = globalThis.document?.getElementById?.(domId) || null;
    if (existingPanel) {
      if (contentNode) {
        const existingHost = getMountedHostId(contentNode);
        if (!existingHost || existingHost === domId) {
          safeAddClassTokens(contentNode, 'canon-tile-pane-content', {
            appId: normalizedAppId,
            paneId: normalizedPaneId,
            target: 'content-node-existing-panel',
          });
          contentNode.setAttribute(CANON_MOUNTED_ATTR, 'true');
          contentNode.setAttribute(CANON_MOUNT_HOST_ATTR, domId);
          appendContentToPanelContainer(existingPanel, contentNode);
        }
      }
      return existingPanel;
    }
    const panel = uiRenderer.createPanel(domId, title || 'Pane');
    panel.dataset.canonTilePane = 'true';
    panel.dataset.canonTilePaneAppId = normalizedAppId;
    panel.dataset.canonTilePaneId = normalizedPaneId;
    safeAddClassTokens(panel, panelClassName, {
      appId: normalizedAppId,
      paneId: normalizedPaneId,
      target: 'panel',
    });

    if (contentNode) {
      safeAddClassTokens(contentNode, 'canon-tile-pane-content', {
        appId: normalizedAppId,
        paneId: normalizedPaneId,
        target: 'content-node-new-panel',
      });
      contentNode.setAttribute(CANON_MOUNTED_ATTR, 'true');
      contentNode.setAttribute(CANON_MOUNT_HOST_ATTR, domId);
      appendContentToPanelContainer(panel, contentNode);
      const isOwnedByPanel = contentNode.closest?.('.stephanos-panel')?.id === domId;
      if (!isOwnedByPanel && globalThis.window?.isDeveloperModeEnabled?.() === true) {
        console.warn('[CANON TILE PANES] mounted pane content is not owned by expected panel host', {
          appId: normalizedAppId,
          paneId: slugifySegment(paneId),
          domId,
          contentNodeId: contentNode.id || null,
        });
      }
    }

    registeredPanes.set(normalizedPaneId, {
      paneId: normalizedPaneId,
      domId,
      title,
      contentNode,
      panelClassName,
    });

    return panel;
  }

  function mountPaneFromSection({ paneId, title, section, panelClassName = '' } = {}) {
    if (!section) {
      throw new Error('mountPaneFromSection requires a section element.');
    }

    const normalizedPaneId = slugifySegment(paneId);
    const mountedElsewhere = section.getAttribute(CANON_MOUNTED_ATTR) === 'true';
    const mountedHostId = getMountedHostId(section);
    if (mountedElsewhere) {
      console.warn('[CANON TILE PANES] duplicate section mount prevented', {
        appId: normalizedAppId,
        existingHost: mountedHostId || null,
        requestedPaneId: normalizedPaneId,
        sectionId: section.id || null,
      });
    }
    if (mountedElsewhere && mountedHostId && mountedHostId !== toCanonTilePaneDomId(normalizedAppId, normalizedPaneId)) {
      console.warn('[CANON TILE PANES] section already mounted to different pane host', {
        appId: normalizedAppId,
        existingHost: mountedHostId,
        requestedPaneId: normalizedPaneId,
        sectionId: section.id || null,
      });
      return getMountedPanelForNode(section);
    }
    const existingPaneId = sectionToPaneId.get(section);
    if (existingPaneId) {
      console.warn('[CANON TILE PANES] duplicate section mount prevented', {
        appId: normalizedAppId,
        existingPaneId,
        requestedPaneId: normalizedPaneId,
        sectionId: section.id || null,
      });
      return globalThis.document?.getElementById(toCanonTilePaneDomId(normalizedAppId, existingPaneId)) || null;
    }
    if (registeredPanes.has(normalizedPaneId)) {
      console.warn('[CANON TILE PANES] duplicate pane id mount prevented', {
        appId: normalizedAppId,
        paneId: normalizedPaneId,
        sectionId: section.id || null,
      });
      return globalThis.document?.getElementById(toCanonTilePaneDomId(normalizedAppId, normalizedPaneId)) || null;
    }

    section.hidden = false;
    section.classList.remove('panel');
    safeAddClassTokens(section, 'canon-tile-pane-section', {
      appId: normalizedAppId,
      paneId: normalizedPaneId,
      target: 'section',
    });
    section.setAttribute(CANON_MOUNTED_ATTR, 'true');
    section.setAttribute(CANON_MOUNT_HOST_ATTR, toCanonTilePaneDomId(normalizedAppId, normalizedPaneId));
    const heading = section.querySelector('h2');
    const resolvedTitle = title || heading?.textContent?.trim() || 'Pane';
    let panel = null;
    try {
      panel = mountPane({ paneId: normalizedPaneId, title: resolvedTitle, contentNode: section, panelClassName });
    } catch (error) {
      console.error('[CANON TILE PANES] pane mount failed', {
        appId: normalizedAppId,
        paneId: normalizedPaneId,
        sectionId: section.id || null,
        error: error?.message || String(error),
      });
      if (globalThis.window?.isDeveloperModeEnabled?.() === true) {
        const diagnostic = globalThis.document?.createElement?.('div');
        if (diagnostic) {
          diagnostic.className = 'canon-tile-pane-mount-error';
          diagnostic.setAttribute('role', 'alert');
          diagnostic.textContent = `Pane mount failed (${normalizedPaneId}): ${error?.message || 'Unknown error.'}`;
          section.prepend?.(diagnostic);
        }
      }
      return null;
    }
    sectionToPaneId.set(section, normalizedPaneId);
    return panel;
  }

  function resetLayout() {
    const paneIds = Array.from(registeredPanes.keys());
    clearCanonTilePaneLayout({
      appId: normalizedAppId,
      paneIds,
      storage,
    });

    const toRemount = Array.from(registeredPanes.values());
    toRemount.forEach((entry) => {
      uiRenderer.removePanel(entry.domId);
    });

    toRemount.forEach((entry) => {
      mountPane({
        paneId: entry.paneId,
        title: entry.title,
        contentNode: entry.contentNode,
        panelClassName: entry.panelClassName,
      });
    });
  }

  return {
    appId: normalizedAppId,
    toPaneDomId(paneId) {
      return toCanonTilePaneDomId(normalizedAppId, paneId);
    },
    mountPane,
    mountPaneFromSection,
    resetLayout,
    applyDefaultPaneLayout(defaultEntries = []) {
      if (isGridSlotMode) {
        applyGridLayout(defaultEntries);
        return;
      }
      const persistedPositions = readPanelPositionsFromMemory(storage);
      let hasUpdates = false;

      defaultEntries.forEach((entry) => {
        const normalizedPaneId = slugifySegment(entry?.paneId);
        if (!normalizedPaneId) return;
        const domId = toCanonTilePaneDomId(normalizedAppId, normalizedPaneId);
        if (persistedPositions[domId]) return;
        const panel = globalThis.document?.getElementById(domId);
        if (!panel) return;
        const x = Number(entry?.x);
        const y = Number(entry?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        persistedPositions[domId] = { x, y };
        hasUpdates = true;
      });

      if (hasUpdates) {
        writePanelPositionsToMemory(persistedPositions, storage);
      }
    },
    setPaneVisible(paneId, isVisible = true) {
      const domId = toCanonTilePaneDomId(normalizedAppId, paneId);
      if (typeof uiRenderer?.setPanelVisible === 'function') {
        uiRenderer.setPanelVisible(domId, isVisible, {
          resolveCollisions: isVisible === true,
          reason: 'canon-pane-visibility',
        });
        return;
      }
      const panel = globalThis.document?.getElementById(domId);
      if (!panel) return;
      panel.style.display = isVisible ? 'block' : 'none';
      panel.style.pointerEvents = isVisible ? 'auto' : 'none';
      panel.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    },
  };
}
