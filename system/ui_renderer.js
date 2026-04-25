import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from "../shared/runtime/stephanosSessionMemory.mjs";
import {
  getSystemPanelRestorablePanelIds,
  isSystemPanelDefaultEnabled,
} from "../shared/runtime/systemPanelToggleRegistry.mjs";
import {
  createStephanosCanonRotatingChevronButton,
  STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS,
} from "../shared/runtime/stephanosSurfacePanels.mjs";
import { attachPointerDrag } from "./pointer_drag.js";

const PANEL_POSITION_KEY = "panelPositions";
const PANEL_COLLAPSE_KEY = "panelCollapsed";
const DEFAULT_PANEL_SIZE = Object.freeze({
  width: 320,
  height: 280,
});
const COLLISION_MARGIN_PX = 12;
const COLLAPSED_PANEL_HEIGHT = 52;
const RESERVED_ZONE_PADDING_PX = 20;
const RESERVED_ZONE_SELECTOR = "[data-stephanos-pane-reserved]";
const SYSTEM_RESTORABLE_PANEL_IDS = new Set(getSystemPanelRestorablePanelIds());

function readUiLayout(storage = globalThis.localStorage) {
  return readPersistedStephanosSessionMemory(storage)?.session?.ui?.uiLayout || {};
}

function writeUiLayout(partial = {}, storage = globalThis.localStorage) {
  const currentMemory = readPersistedStephanosSessionMemory(storage);
  persistStephanosSessionMemory({
    ...currentMemory,
    session: {
      ...currentMemory.session,
      ui: {
        ...currentMemory.session.ui,
        uiLayout: {
          ...(currentMemory.session.ui?.uiLayout || {}),
          ...partial,
        },
      },
    },
  }, storage);
}

function resolvePanelVisibilityState(panelId, storage = globalThis.localStorage) {
  const layout = readUiLayout(storage);
  const hasPersistedVisibility = Object.prototype.hasOwnProperty.call(layout, panelId);
  const persisted = layout[panelId];
  const hasKnownDefault = SYSTEM_RESTORABLE_PANEL_IDS.has(panelId);
  const defaultVisibility = hasKnownDefault ? isSystemPanelDefaultEnabled(panelId) : true;

  if (hasPersistedVisibility && typeof persisted === "boolean") {
    console.info("[WORKSPACE] late pane registration reconciled with restored visibility state", {
      paneId: panelId,
      restoredOpen: persisted,
    });
    if (persisted === false) {
      console.info("[WORKSPACE] persisted closed state preserved for pane", { paneId: panelId });
    }
    return {
      isOpen: persisted,
      reason: "persisted",
    };
  }

  if (hasPersistedVisibility && typeof persisted !== "boolean") {
    console.warn("[WORKSPACE] invalid visibility state recovered to safe default", {
      paneId: panelId,
      persistedValue: persisted,
      fallbackOpen: defaultVisibility,
    });
    return {
      isOpen: defaultVisibility,
      reason: "invalid-persisted",
    };
  }

  if (hasKnownDefault) {
    console.info("[WORKSPACE] applying default visibility for pane with no persisted state", {
      paneId: panelId,
      defaultOpen: defaultVisibility,
    });
    return {
      isOpen: defaultVisibility,
      reason: "defaulted",
    };
  }

  return {
    isOpen: true,
    reason: "unspecified",
  };
}

function readPanelPositions(storage = globalThis.localStorage) {
  const layout = readUiLayout(storage);
  const positions = layout[PANEL_POSITION_KEY];
  return positions && typeof positions === "object" ? { ...positions } : {};
}

function readPanelCollapsed(storage = globalThis.localStorage) {
  const layout = readUiLayout(storage);
  const collapsed = layout[PANEL_COLLAPSE_KEY];
  return collapsed && typeof collapsed === "object" ? { ...collapsed } : {};
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRect(value) {
  if (!value || typeof value !== "object") return null;
  const left = Number(value.left);
  const top = Number(value.top);
  const width = Number(value.width);
  const height = Number(value.height);
  const right = Number.isFinite(value.right) ? Number(value.right) : left + width;
  const bottom = Number.isFinite(value.bottom) ? Number(value.bottom) : top + height;
  if (
    !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(right)
    || !Number.isFinite(bottom)
  ) {
    return null;
  }
  return {
    left,
    top,
    right,
    bottom,
    width: Number.isFinite(width) ? width : Math.max(0, right - left),
    height: Number.isFinite(height) ? height : Math.max(0, bottom - top),
  };
}

function isVisibleReservedNode(node) {
  if (!node) return false;
  if (node.hidden === true) return false;
  if (String(node.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") return false;
  const inlineDisplay = String(node.style?.display || "").toLowerCase();
  if (inlineDisplay === "none") return false;
  const inlineVisibility = String(node.style?.visibility || "").toLowerCase();
  if (inlineVisibility === "hidden") return false;
  return true;
}

function readNodeMargins(node) {
  const style = globalThis.getComputedStyle?.(node);
  if (!style) {
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };
  }
  const marginLeft = Number.parseFloat(style.marginLeft);
  const marginRight = Number.parseFloat(style.marginRight);
  const marginTop = Number.parseFloat(style.marginTop);
  const marginBottom = Number.parseFloat(style.marginBottom);
  return {
    left: Number.isFinite(marginLeft) ? Math.max(0, marginLeft) : 0,
    right: Number.isFinite(marginRight) ? Math.max(0, marginRight) : 0,
    top: Number.isFinite(marginTop) ? Math.max(0, marginTop) : 0,
    bottom: Number.isFinite(marginBottom) ? Math.max(0, marginBottom) : 0,
  };
}

function expandRectByPadding(rect, padding = RESERVED_ZONE_PADDING_PX, margin = {}) {
  const sizePadding = Number.isFinite(padding) ? Math.max(0, padding) : RESERVED_ZONE_PADDING_PX;
  const marginLeft = Number.isFinite(margin.left) ? Math.max(0, margin.left) : 0;
  const marginRight = Number.isFinite(margin.right) ? Math.max(0, margin.right) : 0;
  const marginTop = Number.isFinite(margin.top) ? Math.max(0, margin.top) : 0;
  const marginBottom = Number.isFinite(margin.bottom) ? Math.max(0, margin.bottom) : 0;
  return {
    left: rect.left - sizePadding - marginLeft,
    top: rect.top - sizePadding - marginTop,
    right: rect.right + sizePadding + marginRight,
    bottom: rect.bottom + sizePadding + marginBottom,
    width: rect.width + (sizePadding * 2) + marginLeft + marginRight,
    height: rect.height + (sizePadding * 2) + marginTop + marginBottom,
  };
}

function readReservedPaneRects(documentRef = globalThis.document) {
  const reservedNodes = Array.from(documentRef?.querySelectorAll?.(RESERVED_ZONE_SELECTOR) || []);
  return reservedNodes
    .map((node) => {
      if (!isVisibleReservedNode(node)) {
        return null;
      }
      const rect = toRect(node?.getBoundingClientRect?.());
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      const paddedRect = expandRectByPadding(rect, RESERVED_ZONE_PADDING_PX, readNodeMargins(node));
      return {
        ...paddedRect,
        id: node.id || node.getAttribute?.("data-stephanos-pane-reserved") || "reserved-zone",
      };
    })
    .filter(Boolean);
}

function getReservedTopClearance(reservedRects = []) {
  let clearance = 8;
  const viewport = getViewportRect();
  reservedRects.forEach((rect) => {
    if (Number.isFinite(rect?.left)
      && Number.isFinite(rect?.right)
      && rect.right > 0
      && rect.left < viewport.width
      && Number.isFinite(rect?.bottom)) {
      clearance = Math.max(clearance, rect.bottom);
    }
  });
  return clearance;
}

function getViewportRect() {
  const width = Math.max(320, globalThis.innerWidth || document.documentElement?.clientWidth || 1280);
  const height = Math.max(240, globalThis.innerHeight || document.documentElement?.clientHeight || 720);
  return { width, height };
}

function getPanelDimensions(panel) {
  if (panel?.classList?.contains("stephanos-panel-collapsed")) {
    const collapsedWidth = panel?.getBoundingClientRect?.()?.width;
    return {
      width: Number.isFinite(collapsedWidth) && collapsedWidth > 0 ? collapsedWidth : DEFAULT_PANEL_SIZE.width,
      height: COLLAPSED_PANEL_HEIGHT,
    };
  }
  const bounds = panel?.getBoundingClientRect?.();
  if (bounds?.width && bounds?.height) {
    return { width: bounds.width, height: bounds.height };
  }
  return { ...DEFAULT_PANEL_SIZE };
}

function computeBoundedPosition({ x = 0, y = 0 } = {}, panel, options = {}) {
  const viewport = getViewportRect();
  const panelSize = getPanelDimensions(panel);
  const maxX = Math.max(0, viewport.width - panelSize.width - 12);
  const maxY = Math.max(0, viewport.height - panelSize.height - 12);
  const minY = Number.isFinite(options.minY) ? Math.max(8, options.minY) : 8;
  const boundedMinY = Math.min(minY, maxY);
  return {
    x: clamp(Number(x) || 0, 8, maxX),
    y: clamp(Number(y) || 0, boundedMinY, maxY),
  };
}

export function getPaneRect(panel) {
  const dimensions = getPanelDimensions(panel);
  const left = Number.parseFloat(panel?.style?.left) || 0;
  const top = Number.parseFloat(panel?.style?.top) || 0;
  return {
    left,
    top,
    right: left + dimensions.width,
    bottom: top + dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function rectsOverlap(a, b, margin = COLLISION_MARGIN_PX) {
  const buffer = Number.isFinite(margin) ? Math.max(0, margin) : COLLISION_MARGIN_PX;
  return !(
    (a.right + buffer) <= b.left
    || (a.left >= (b.right + buffer))
    || (a.bottom + buffer) <= b.top
    || (a.top >= (b.bottom + buffer))
  );
}

function candidateOffsets(step = 24) {
  return [
    { x: 0, y: 0 },
    { x: step, y: 0 },
    { x: 0, y: step },
    { x: step * 2, y: 0 },
    { x: 0, y: step * 2 },
    { x: -step, y: 0 },
    { x: 0, y: -step },
    { x: -step * 2, y: 0 },
    { x: 0, y: -step * 2 },
    { x: step, y: step },
    { x: step * 2, y: step },
    { x: step, y: step * 2 },
    { x: -step, y: step },
    { x: step, y: -step },
  ];
}

export function findNearestNonOverlappingPosition(
  panel,
  desiredPosition,
  otherPanels = [],
  viewport = getViewportRect(),
  options = {},
) {
  const reservedRects = Array.isArray(options.reservedRects)
    ? options.reservedRects.map((rect) => toRect(rect)).filter(Boolean)
    : [];
  const minY = getReservedTopClearance(reservedRects);
  const collisionMargin = Number.isFinite(options.collisionMargin)
    ? Math.max(0, options.collisionMargin)
    : COLLISION_MARGIN_PX;
  const boundedDesired = computeBoundedPosition(desiredPosition, panel, { minY });
  const collidesAt = (position) => {
    const bounded = computeBoundedPosition(position, panel, { minY });
    const thisRect = {
      left: bounded.x,
      top: bounded.y,
      right: bounded.x + getPanelDimensions(panel).width,
      bottom: bounded.y + getPanelDimensions(panel).height,
    };
    for (const otherPanel of otherPanels) {
      const otherRect = getPaneRect(otherPanel);
      if (rectsOverlap(thisRect, otherRect, collisionMargin)) {
        return otherPanel;
      }
    }
    for (const reservedRect of reservedRects) {
      if (rectsOverlap(thisRect, reservedRect, collisionMargin)) {
        return {
          id: `reserved:${reservedRect.id || "zone"}`,
        };
      }
    }
    return null;
  };

  if (!collidesAt(boundedDesired)) {
    return {
      position: boundedDesired,
      collisionDetected: false,
      collisionTargetPaneId: null,
      strategy: "desired",
    };
  }

  const offsetCandidates = candidateOffsets(options.step || 24);
  for (const offset of offsetCandidates) {
    const candidate = {
      x: boundedDesired.x + offset.x,
      y: boundedDesired.y + offset.y,
    };
    const collisionTarget = collidesAt(candidate);
    if (!collisionTarget) {
      return {
        position: computeBoundedPosition(candidate, panel, { minY }),
        collisionDetected: true,
        collisionTargetPaneId: null,
        strategy: "offset-scan",
      };
    }
  }

  const gridStep = Math.max(24, options.gridStep || 36);
  const maxX = Math.max(24, viewport.width - getPanelDimensions(panel).width - 12);
  const maxY = Math.max(24, viewport.height - getPanelDimensions(panel).height - 12);
  for (let y = 24; y <= maxY; y += gridStep) {
    for (let x = 24; x <= maxX; x += gridStep) {
      const collisionTarget = collidesAt({ x, y });
      if (!collisionTarget) {
        return {
          position: computeBoundedPosition({ x, y }, panel, { minY }),
          collisionDetected: true,
          collisionTargetPaneId: null,
          strategy: "grid-scan",
        };
      }
    }
  }

  for (let index = 0; index < 32; index += 1) {
    const cascadeCandidate = {
      x: 24 + (index * 36),
      y: 60 + (index * 36),
    };
    const collisionTarget = collidesAt(cascadeCandidate);
    if (!collisionTarget) {
      return {
        position: computeBoundedPosition(cascadeCandidate, panel, { minY }),
        collisionDetected: true,
        collisionTargetPaneId: null,
        strategy: "cascade",
      };
    }
  }

  return {
    position: boundedDesired,
    collisionDetected: true,
    collisionTargetPaneId: collidesAt(boundedDesired)?.id || null,
    strategy: "bounded-fallback",
  };
}

export function resolvePaneLayoutCollisions(panels, options = {}) {
  const visiblePanels = Array.from(panels || []).filter((panel) => panel?.style?.display !== "none");
  const sortedPanels = visiblePanels.slice().sort((a, b) => {
    const orderA = Number(a?.dataset?.panelOrder || 0);
    const orderB = Number(b?.dataset?.panelOrder || 0);
    return orderA - orderB;
  });
  const results = [];

  sortedPanels.forEach((panel, index) => {
    const desired = {
      x: Number.parseFloat(panel.style.left) || 0,
      y: Number.parseFloat(panel.style.top) || 0,
    };
    const otherPanels = sortedPanels.slice(0, index);
    const resolved = findNearestNonOverlappingPosition(panel, desired, otherPanels, getViewportRect(), options);
    panel.style.left = `${resolved.position.x}px`;
    panel.style.top = `${resolved.position.y}px`;
    results.push({
      paneId: panel.id,
      desiredPosition: desired,
      resolvedPosition: resolved.position,
      collisionDetected: resolved.collisionDetected,
      collisionTargetPaneId: resolved.collisionTargetPaneId,
      strategy: resolved.strategy,
    });
  });

  return results;
}

function readPanelPosition(panelId, storage = globalThis.localStorage) {
  return readPanelPositions(storage)[panelId] || null;
}

function writePanelPosition(panelId, position, storage = globalThis.localStorage) {
  const positions = readPanelPositions(storage);
  positions[panelId] = {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
  };
  writeUiLayout({ [PANEL_POSITION_KEY]: positions }, storage);
}

function writePanelCollapsed(panelId, collapsed, storage = globalThis.localStorage) {
  const states = readPanelCollapsed(storage);
  states[panelId] = collapsed === true;
  writeUiLayout({ [PANEL_COLLAPSE_KEY]: states }, storage);
}

function readPanelCollapsedState(panelId, storage = globalThis.localStorage) {
  return readPanelCollapsed(storage)[panelId] === true;
}

export function createUIRenderer() {
  const panelRegistry = new Map();
  const storage = globalThis.localStorage;
  let defaultPanelOffset = 0;
  let panelCreationOrder = 0;

  function normalizePanelContainerStyles(container) {
    if (!container?.style) {
      return container;
    }

    // Always enforce stack-shell hit-testing defaults so runtime/state transitions
    // cannot leave the stack as an invisible click-capturing layer.
    container.style.display = container.style.display || "none";
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "4500";
    return container;
  }

  function applyPanelPosition(panel, position = { x: 0, y: 0 }) {
    const minY = getReservedTopClearance(readReservedPaneRects());
    const bounded = computeBoundedPosition(position, panel, { minY });
    panel.style.left = `${bounded.x}px`;
    panel.style.top = `${bounded.y}px`;
    return bounded;
  }

  function getDefaultPosition() {
    const base = 24 + (defaultPanelOffset * 30);
    const minY = getReservedTopClearance(readReservedPaneRects());
    defaultPanelOffset = (defaultPanelOffset + 1) % 8;
    return { x: base, y: Math.max(minY, base + 36) };
  }

  function ensurePanelPosition(panel) {
    const persisted = readPanelPosition(panel.id, storage);
    return applyPanelPosition(panel, persisted || getDefaultPosition());
  }

  function resolveSharedPlaneCollisions(panels, reason = "unknown") {
    const debugEnabled = globalThis.window?.isDeveloperModeEnabled?.() === true;
    const panelList = Array.from(panels || []);
    panelList.forEach((panel) => {
      applyPanelPosition(panel, {
        x: Number.parseFloat(panel.style.left) || 0,
        y: Number.parseFloat(panel.style.top) || 0,
      });
    });
    const results = resolvePaneLayoutCollisions(panelList, {
      collisionMargin: COLLISION_MARGIN_PX,
      reservedRects: readReservedPaneRects(),
    });
    results.forEach((entry) => {
      const hasPersistedPosition = readPanelPosition(entry.paneId, storage) != null;
      const shouldPersist = reason !== "restore-load" || hasPersistedPosition || entry.collisionDetected;
      if (shouldPersist) {
        writePanelPosition(entry.paneId, entry.resolvedPosition, storage);
      }
      if (debugEnabled && entry.collisionDetected) {
        console.info("[PANEL LAYOUT]", {
          reason,
          paneId: entry.paneId,
          desiredPosition: entry.desiredPosition,
          resolvedPosition: entry.resolvedPosition,
          collisionDetected: entry.collisionDetected,
          collisionTargetPaneId: entry.collisionTargetPaneId,
          strategy: entry.strategy,
        });
      }
    });
  }

  function installPanelDragBehavior(panel, handle) {
    const container = ensurePanelContainer();
    attachPointerDrag({
      panel,
      handle,
      panelId: panel.id,
      preferViewportSpace: true,
      debug: globalThis.window?.isDeveloperModeEnabled?.() === true,
      interactiveSelector: `.${STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS}, .stephanos-panel-knob, [data-no-drag], [data-stephanos-no-drag]`,
      onDragStart() {
        container.classList.add("stephanos-panel-drag-active");
        panel.parentNode?.appendChild?.(panel);
      },
      onDragEnd() {
        container.classList.remove("stephanos-panel-drag-active");
      },
      onPositionCommit(position) {
        applyPanelPosition(panel, position);
        resolveSharedPlaneCollisions(panelRegistry.values(), "drag-end");
      },
    });
  }

  function installPanelKnobBehavior(panel, knobButton, content) {
    const applyCollapseState = (collapsed, options = {}) => {
      const shouldSyncPlane = options.syncPlane !== false;
      panel.classList.toggle("stephanos-panel-collapsed", collapsed === true);
      content.style.display = collapsed === true ? "none" : "";
      knobButton.setAttribute("aria-expanded", collapsed === true ? "false" : "true");
      knobButton.setAttribute("aria-label", collapsed === true ? "Expand panel" : "Collapse panel");
      knobButton.setAttribute("title", collapsed === true ? "Expand panel" : "Collapse panel");
      const chevron = knobButton.querySelector(".chevron");
      if (chevron) {
        chevron.classList.toggle("open", collapsed !== true);
      }
      writePanelCollapsed(panel.id, collapsed === true, storage);
      applyPanelPosition(panel, {
        x: Number.parseFloat(panel.style.left) || 0,
        y: Number.parseFloat(panel.style.top) || 0,
      });
      if (shouldSyncPlane) {
        resolveSharedPlaneCollisions(panelRegistry.values(), "collapse-toggle");
      }
    };

    knobButton.addEventListener("click", () => {
      const collapsed = !panel.classList.contains("stephanos-panel-collapsed");
      applyCollapseState(collapsed);
    });

    applyCollapseState(readPanelCollapsedState(panel.id, storage), { syncPlane: false });
  }

  function normalizePanelPositions() {
    panelRegistry.forEach((panel) => {
      applyPanelPosition(panel, {
        x: Number.parseFloat(panel.style.left) || 0,
        y: Number.parseFloat(panel.style.top) || 0,
      });
    });
    resolveSharedPlaneCollisions(panelRegistry.values(), "viewport-resize");
  }

  function syncPanelStackVisibility(container = ensurePanelContainer()) {
    const anyVisible = Array.from(container.children).some((entry) => entry.style.display !== "none");
    container.style.display = anyVisible ? "block" : "none";
  }

  function setPanelVisible(panelOrId, isVisible = true, options = {}) {
    const panel = typeof panelOrId === "string"
      ? (document.getElementById(panelOrId) || panelRegistry.get(panelOrId) || null)
      : panelOrId;
    if (!panel) {
      return null;
    }
    const visible = isVisible === true;
    panel.style.display = visible ? "block" : "none";
    panel.style.pointerEvents = visible ? "auto" : "none";
    panel.setAttribute("aria-hidden", visible ? "false" : "true");

    if (visible && options.resolveCollisions !== false) {
      resolveSharedPlaneCollisions(panelRegistry.values(), options.reason || "visibility-change");
    }
    syncPanelStackVisibility();
    return panel;
  }

  globalThis.addEventListener?.("resize", () => {
    normalizePanelPositions();
  });

  function ensurePanelContainer(documentRef = document) {
    let container = documentRef.getElementById("stephanos-panel-stack");

    if (container) {
      return normalizePanelContainerStyles(container);
    }

    container = documentRef.createElement("div");
    container.id = "stephanos-panel-stack";
    normalizePanelContainerStyles(container);

    const workspacePanel = documentRef.getElementById("workspace");
    const layout = documentRef.getElementById("stephanos-layout");

    if (layout?.parentNode) {
      layout.parentNode.insertBefore(container, layout);
    } else if (workspacePanel?.parentNode) {
      workspacePanel.parentNode.insertBefore(container, workspacePanel.nextSibling);
    } else {
      documentRef.body.appendChild(container);
    }

    return normalizePanelContainerStyles(container);
  }

  return {
    createPanel(id, title) {
      const container = ensurePanelContainer();
      const visibility = resolvePanelVisibilityState(id, storage);

      let panel = document.getElementById(id);

      if (!panel) {
        panel = document.createElement("div");
        panel.classList.add("stephanos-panel");
        panel.id = id;

        const header = document.createElement("div");
        header.className = "stephanos-panel-header";
        header.setAttribute("role", "group");
        header.setAttribute("aria-label", `${title} panel controls`);
        const knobButton = createStephanosCanonRotatingChevronButton({ documentRef: document });
        knobButton.classList.add("stephanos-panel-knob");
        knobButton.setAttribute("aria-expanded", "true");
        knobButton.setAttribute("aria-label", `Collapse ${title} panel`);
        knobButton.setAttribute("title", `Collapse ${title} panel`);
        knobButton.setAttribute("data-no-drag", "true");
        const titleNode = document.createElement("span");
        titleNode.className = "stephanos-panel-title";
        titleNode.textContent = title;
        header.appendChild(knobButton);
        header.appendChild(titleNode);

        const content = document.createElement("div");
        content.className = "stephanos-panel-content";

        panel.appendChild(header);
        panel.appendChild(content);

        container.appendChild(panel);
        panel.dataset.panelOrder = String(panelCreationOrder);
        panelCreationOrder += 1;
        panelRegistry.set(id, panel);

        installPanelDragBehavior(panel, header);
        installPanelKnobBehavior(panel, knobButton, content);
        ensurePanelPosition(panel);
      }

      const panelContent = panel.querySelector(".stephanos-panel-content");
      if (panelContent && panel.children[panel.children.length - 1] !== panelContent) {
        panel.appendChild(panelContent);
      }
      if (panelContent && panel.dataset.contentProxyInstalled !== "true") {
        const originalAppendChild = panel.appendChild.bind(panel);
        panel.appendChild = function appendPanelChild(node) {
          if (node === panelContent || node?.classList?.contains("stephanos-panel-header")) {
            return originalAppendChild(node);
          }
          return panelContent.appendChild(node);
        };
        panel.dataset.contentProxyInstalled = "true";
      }

      setPanelVisible(panel, visibility.isOpen, {
        resolveCollisions: visibility.isOpen === true,
        reason: "restore-load",
      });

      return panel;
    },

    removePanel(id) {
      const panel = document.getElementById(id);

      if (panel) {
        panelRegistry.delete(id);
        panel.remove();
        syncPanelStackVisibility();
      }
    },

    setPanelVisible,

    resetPanelLayout() {
      writeUiLayout({
        [PANEL_POSITION_KEY]: {},
        [PANEL_COLLAPSE_KEY]: {},
      }, storage);
      let stackOffset = 0;
      panelRegistry.forEach((panel) => {
        panel.classList.remove("stephanos-panel-collapsed");
        const content = panel.querySelector(".stephanos-panel-content");
        if (content) {
          content.style.display = "";
        }
        const knob = panel.querySelector(".stephanos-panel-knob");
        if (knob) {
          knob.setAttribute("aria-expanded", "true");
          knob.setAttribute("aria-label", "Collapse panel");
          knob.setAttribute("title", "Collapse panel");
          knob.querySelector(".chevron")?.classList?.add("open");
        }
        const minY = getReservedTopClearance(readReservedPaneRects());
        const defaultPosition = {
          x: 24 + stackOffset * 36,
          y: Math.max(minY, 60 + stackOffset * 36),
        };
        stackOffset = (stackOffset + 1) % 8;
        const bounded = applyPanelPosition(panel, defaultPosition);
        writePanelPosition(panel.id, bounded, storage);
      });
      resolveSharedPlaneCollisions(panelRegistry.values(), "reset-layout");
    },
  };
}
