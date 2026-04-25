import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from './stephanosSessionMemory.mjs';
import { createUIRenderer } from '../../system/ui_renderer.js';

const PANEL_POSITION_KEY = 'panelPositions';
const PANEL_COLLAPSE_KEY = 'panelCollapsed';

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

  function mountPane({ paneId, title, contentNode, panelClassName = '' } = {}) {
    const domId = toCanonTilePaneDomId(normalizedAppId, paneId);
    const panel = uiRenderer.createPanel(domId, title || 'Pane');
    panel.dataset.canonTilePane = 'true';
    panel.dataset.canonTilePaneAppId = normalizedAppId;
    panel.dataset.canonTilePaneId = slugifySegment(paneId);
    if (panelClassName) {
      panel.classList.add(panelClassName);
    }

    if (contentNode) {
      contentNode.classList.add('canon-tile-pane-content');
      panel.appendChild(contentNode);
    }

    registeredPanes.set(slugifySegment(paneId), {
      paneId: slugifySegment(paneId),
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

    section.hidden = false;
    section.classList.add('canon-tile-pane-section');
    const heading = section.querySelector('h2');
    const resolvedTitle = title || heading?.textContent?.trim() || 'Pane';
    return mountPane({ paneId, title: resolvedTitle, contentNode: section, panelClassName });
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
