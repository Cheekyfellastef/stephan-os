import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from "../shared/runtime/stephanosSessionMemory.mjs";

const PANEL_POSITION_KEY = "panelPositions";
const PANEL_COLLAPSE_KEY = "panelCollapsed";
const DRAG_HANDLE_SELECTOR = ".stephanos-panel-header";
const DEFAULT_PANEL_SIZE = Object.freeze({
  width: 320,
  height: 280,
});

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

function getViewportRect() {
  const width = Math.max(320, globalThis.innerWidth || document.documentElement?.clientWidth || 1280);
  const height = Math.max(240, globalThis.innerHeight || document.documentElement?.clientHeight || 720);
  return { width, height };
}

function getPanelDimensions(panel) {
  const bounds = panel?.getBoundingClientRect?.();
  if (bounds?.width && bounds?.height) {
    return { width: bounds.width, height: bounds.height };
  }
  return { ...DEFAULT_PANEL_SIZE };
}

function computeBoundedPosition({ x = 0, y = 0 } = {}, panel) {
  const viewport = getViewportRect();
  const panelSize = getPanelDimensions(panel);
  const maxX = Math.max(0, viewport.width - panelSize.width - 12);
  const maxY = Math.max(0, viewport.height - panelSize.height - 12);
  return {
    x: clamp(Number(x) || 0, 8, maxX),
    y: clamp(Number(y) || 0, 8, maxY),
  };
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

  function applyPanelPosition(panel, position = { x: 0, y: 0 }) {
    const bounded = computeBoundedPosition(position, panel);
    panel.style.left = `${bounded.x}px`;
    panel.style.top = `${bounded.y}px`;
    return bounded;
  }

  function getDefaultPosition() {
    const base = 24 + (defaultPanelOffset * 30);
    defaultPanelOffset = (defaultPanelOffset + 1) % 8;
    return { x: base, y: base + 36 };
  }

  function ensurePanelPosition(panel) {
    const persisted = readPanelPosition(panel.id, storage);
    return applyPanelPosition(panel, persisted || getDefaultPosition());
  }

  function installPanelDragBehavior(panel, handle) {
    let dragState = null;
    const container = ensurePanelContainer();

    function stopDrag() {
      dragState = null;
      panel.classList.remove("stephanos-panel-dragging");
      container.classList.remove("stephanos-panel-drag-active");
    }

    function onPointerMove(event) {
      if (!dragState) {
        return;
      }
      const next = computeBoundedPosition({
        x: event.clientX - dragState.offsetX,
        y: event.clientY - dragState.offsetY,
      }, panel);
      panel.style.left = `${next.x}px`;
      panel.style.top = `${next.y}px`;
      dragState.lastPosition = next;
    }

    function onPointerUp() {
      if (dragState?.lastPosition) {
        writePanelPosition(panel.id, dragState.lastPosition, storage);
      }
      stopDrag();
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target;
      if (target?.closest?.(".stephanos-panel-knob")) {
        return;
      }
      const bounds = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
        lastPosition: { x: bounds.left, y: bounds.top },
      };
      panel.classList.add("stephanos-panel-dragging");
      container.classList.add("stephanos-panel-drag-active");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  }

  function installPanelKnobBehavior(panel, knobButton, content) {
    const applyCollapseState = (collapsed) => {
      panel.classList.toggle("stephanos-panel-collapsed", collapsed === true);
      content.style.display = collapsed === true ? "none" : "block";
      knobButton.setAttribute("aria-expanded", collapsed === true ? "false" : "true");
      knobButton.textContent = collapsed === true ? "◎" : "◉";
      writePanelCollapsed(panel.id, collapsed === true, storage);
      applyPanelPosition(panel, {
        x: Number.parseFloat(panel.style.left) || 0,
        y: Number.parseFloat(panel.style.top) || 0,
      });
    };

    knobButton.addEventListener("click", () => {
      const collapsed = !panel.classList.contains("stephanos-panel-collapsed");
      applyCollapseState(collapsed);
    });

    applyCollapseState(readPanelCollapsedState(panel.id, storage));
  }

  function normalizePanelPositions() {
    panelRegistry.forEach((panel) => {
      const bounded = applyPanelPosition(panel, {
        x: Number.parseFloat(panel.style.left) || 0,
        y: Number.parseFloat(panel.style.top) || 0,
      });
      writePanelPosition(panel.id, bounded, storage);
    });
  }

  globalThis.addEventListener?.("resize", () => {
    normalizePanelPositions();
  });

  function ensurePanelContainer(documentRef = document) {
    let container = documentRef.getElementById("stephanos-panel-stack");

    if (container) {
      return container;
    }

    container = documentRef.createElement("div");
    container.id = "stephanos-panel-stack";
    container.style.display = "none";
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "4500";

    const workspacePanel = documentRef.getElementById("workspace");
    const layout = documentRef.getElementById("stephanos-layout");

    if (layout?.parentNode) {
      layout.parentNode.insertBefore(container, layout);
    } else if (workspacePanel?.parentNode) {
      workspacePanel.parentNode.insertBefore(container, workspacePanel.nextSibling);
    } else {
      documentRef.body.appendChild(container);
    }

    return container;
  }

  return {
    createPanel(id, title) {
      const container = ensurePanelContainer();

      let panel = document.getElementById(id);

      if (!panel) {
        panel = document.createElement("div");
        panel.classList.add("stephanos-panel");
        panel.id = id;

        const header = document.createElement("div");
        header.className = "stephanos-panel-header";
        header.setAttribute("role", "group");
        header.setAttribute("aria-label", `${title} panel controls`);
        const knobButton = document.createElement("button");
        knobButton.className = "stephanos-panel-knob";
        knobButton.type = "button";
        knobButton.textContent = "◉";
        knobButton.setAttribute("aria-expanded", "true");
        knobButton.setAttribute("aria-label", `Collapse ${title} panel`);
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

      return panel;
    },

    removePanel(id) {
      const panel = document.getElementById(id);

      if (panel) {
        panelRegistry.delete(id);
        panel.remove();
      }
    },

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
          content.style.display = "block";
        }
        const knob = panel.querySelector(".stephanos-panel-knob");
        if (knob) {
          knob.textContent = "◉";
          knob.setAttribute("aria-expanded", "true");
        }
        const defaultPosition = { x: 24 + stackOffset * 30, y: 60 + stackOffset * 30 };
        stackOffset = (stackOffset + 1) % 8;
        const bounded = applyPanelPosition(panel, defaultPosition);
        writePanelPosition(panel.id, bounded, storage);
      });
    },
  };
}
