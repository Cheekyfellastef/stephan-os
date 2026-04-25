import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';
import { createUIRenderer } from '../../system/ui_renderer.js';

const PANEL_POSITION_KEY = 'panelPositions';
const PANEL_COLLAPSE_KEY = 'panelCollapsed';
const CANON_MOUNTED_ATTR = 'data-canon-pane-mounted';
const CANON_MOUNT_HOST_ATTR = 'data-canon-pane-host';

function slugifySegment(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pane';
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

/**
 * Canon tile pane manager for movable/collapsible/persisted tile panes.
 *
 * Future tiles should use this helper instead of re-implementing drag/persistence logic.
 */
export function createCanonTilePaneManager({
  appId,
  storage = globalThis.localStorage,
  uiRenderer = createUIRenderer(),
} = {}) {
  const normalizedAppId = slugifySegment(appId);
  if (!normalizedAppId) {
    throw new Error('createCanonTilePaneManager requires a non-empty appId.');
  }

  const registeredPanes = new Map();
  const sectionToPaneId = new WeakMap();

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
          contentNode.classList.add('canon-tile-pane-content');
          contentNode.setAttribute(CANON_MOUNTED_ATTR, 'true');
          contentNode.setAttribute(CANON_MOUNT_HOST_ATTR, domId);
          if (contentNode.parentNode !== existingPanel) {
            existingPanel.appendChild(contentNode);
          }
        }
      }
      return existingPanel;
    }
    const panel = uiRenderer.createPanel(domId, title || 'Pane');
    panel.dataset.canonTilePane = 'true';
    panel.dataset.canonTilePaneAppId = normalizedAppId;
    panel.dataset.canonTilePaneId = normalizedPaneId;
    if (panelClassName) {
      panel.classList.add(panelClassName);
    }

    if (contentNode) {
      contentNode.classList.add('canon-tile-pane-content');
      contentNode.setAttribute(CANON_MOUNTED_ATTR, 'true');
      contentNode.setAttribute(CANON_MOUNT_HOST_ATTR, domId);
      panel.appendChild(contentNode);
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
    if (mountedElsewhere && mountedHostId && mountedHostId !== toCanonTilePaneDomId(normalizedAppId, normalizedPaneId)) {
      if (globalThis.window?.isDeveloperModeEnabled?.() === true) {
        console.warn('[CANON TILE PANES] section already mounted to different pane host', {
          appId: normalizedAppId,
          existingHost: mountedHostId,
          requestedPaneId: normalizedPaneId,
          sectionId: section.id || null,
        });
      }
      return getMountedPanelForNode(section);
    }
    const existingPaneId = sectionToPaneId.get(section);
    if (existingPaneId) {
      if (globalThis.window?.isDeveloperModeEnabled?.() === true) {
        console.warn('[CANON TILE PANES] duplicate section mount prevented', {
          appId: normalizedAppId,
          existingPaneId,
          requestedPaneId: normalizedPaneId,
          sectionId: section.id || null,
        });
      }
      return globalThis.document?.getElementById(toCanonTilePaneDomId(normalizedAppId, existingPaneId)) || null;
    }
    if (registeredPanes.has(normalizedPaneId)) {
      if (globalThis.window?.isDeveloperModeEnabled?.() === true) {
        console.warn('[CANON TILE PANES] duplicate pane id mount prevented', {
          appId: normalizedAppId,
          paneId: normalizedPaneId,
          sectionId: section.id || null,
        });
      }
      return globalThis.document?.getElementById(toCanonTilePaneDomId(normalizedAppId, normalizedPaneId)) || null;
    }

    section.hidden = false;
    section.classList.remove('panel');
    section.classList.add('canon-tile-pane-section');
    section.setAttribute(CANON_MOUNTED_ATTR, 'true');
    section.setAttribute(CANON_MOUNT_HOST_ATTR, toCanonTilePaneDomId(normalizedAppId, normalizedPaneId));
    const heading = section.querySelector('h2');
    const resolvedTitle = title || heading?.textContent?.trim() || 'Pane';
    const panel = mountPane({ paneId: normalizedPaneId, title: resolvedTitle, contentNode: section, panelClassName });
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
    setPaneVisible(paneId, isVisible = true) {
      const domId = toCanonTilePaneDomId(normalizedAppId, paneId);
      const panel = globalThis.document?.getElementById(domId);
      if (!panel) return;
      panel.style.display = isVisible ? 'block' : 'none';
    },
  };
}
