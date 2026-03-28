const DEFAULT_INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[data-no-drag]",
  "[data-stephanos-no-drag]",
].join(", ");

const DEFAULT_MIN_VISIBLE_PX = 56;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getViewportRect() {
  const width = Math.max(320, globalThis.innerWidth || globalThis.window?.innerWidth || 1280);
  const height = Math.max(240, globalThis.innerHeight || globalThis.window?.innerHeight || 720);
  return { width, height };
}

function detectTransformedAncestor(element) {
  const transformedAncestors = [];
  const canInspectStyles = typeof globalThis.getComputedStyle === "function";
  let current = element?.parentElement || null;
  while (current) {
    if (canInspectStyles) {
      const style = globalThis.getComputedStyle(current);
      const transformed = style?.transform && style.transform !== "none";
      const filtered = style?.filter && style.filter !== "none";
      const perspective = style?.perspective && style.perspective !== "none";
      const contained = style?.contain && style.contain !== "none";
      const zoomed = style?.zoom && style.zoom !== "normal" && style.zoom !== "1";
      if (transformed || filtered || perspective || contained || zoomed) {
        transformedAncestors.push({
          tag: current.tagName || "unknown",
          id: current.id || "",
          className: current.className || "",
          transform: style?.transform || "none",
          contain: style?.contain || "none",
          zoom: style?.zoom || "normal",
        });
      }
    }
    current = current.parentElement;
  }
  return transformedAncestors;
}

function resolveCoordinateStrategy(panel, preferViewportSpace) {
  const style = typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(panel) : null;
  const panelPositionMode = style?.position || panel?.style?.position || "absolute";
  const offsetParent = panel?.offsetParent || panel?.parentElement || null;
  const transformedAncestors = detectTransformedAncestor(panel);
  const hasTransformedAncestor = transformedAncestors.length > 0;

  if (preferViewportSpace || panelPositionMode === "fixed" || hasTransformedAncestor) {
    return {
      mode: "viewport",
      panelPositionMode,
      offsetParent,
      transformedAncestors,
      hasTransformedAncestor,
    };
  }

  if (offsetParent?.getBoundingClientRect) {
    return {
      mode: "parent",
      panelPositionMode,
      offsetParent,
      transformedAncestors,
      hasTransformedAncestor,
    };
  }

  return {
    mode: "viewport",
    panelPositionMode,
    offsetParent,
    transformedAncestors,
    hasTransformedAncestor,
  };
}

function readPanelRect(panel, fallback = { left: 0, top: 0, width: 320, height: 240 }) {
  const rect = panel?.getBoundingClientRect?.();
  if (!rect) {
    return fallback;
  }
  return {
    left: Number.isFinite(rect.left) ? rect.left : fallback.left,
    top: Number.isFinite(rect.top) ? rect.top : fallback.top,
    width: Number.isFinite(rect.width) && rect.width > 0 ? rect.width : fallback.width,
    height: Number.isFinite(rect.height) && rect.height > 0 ? rect.height : fallback.height,
  };
}

export function attachPointerDrag({
  panel,
  handle,
  panelId = "panel",
  dragThreshold = 6,
  minVisiblePx = DEFAULT_MIN_VISIBLE_PX,
  preferViewportSpace = false,
  interactiveSelector = DEFAULT_INTERACTIVE_SELECTOR,
  onDragStart = null,
  onDragMove = null,
  onDragEnd = null,
  onPositionCommit = null,
  debug = false,
} = {}) {
  if (!panel || !handle) {
    return {
      dispose() {},
      clampToViewport() {},
    };
  }

  const strategy = resolveCoordinateStrategy(panel, preferViewportSpace);
  let dragState = null;
  let suppressClickUntil = 0;
  let diagnosticsLogged = false;

  const log = (phase, detail = {}) => {
    if (!debug) {
      return;
    }
    const summary = Object.entries(detail)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.info(`[PANEL DRAG] ${phase} id=${panelId}${summary ? ` ${summary}` : ""}`);
  };

  const toLocalPoint = (viewportX, viewportY) => {
    if (strategy.mode !== "parent") {
      return { x: viewportX, y: viewportY };
    }
    const parentRect = strategy.offsetParent?.getBoundingClientRect?.();
    if (!parentRect) {
      return { x: viewportX, y: viewportY };
    }
    return {
      x: viewportX - parentRect.left,
      y: viewportY - parentRect.top,
    };
  };

  const applyViewportPosition = (viewportX, viewportY) => {
    const viewport = getViewportRect();
    const rect = readPanelRect(panel);
    const minX = rect.width + 16 <= viewport.width ? 8 : 8 - rect.width + minVisiblePx;
    const minY = rect.height + 16 <= viewport.height ? 8 : 8 - rect.height + minVisiblePx;
    const maxX = rect.width + 16 <= viewport.width
      ? Math.max(8, viewport.width - rect.width - 8)
      : Math.max(8, viewport.width - minVisiblePx);
    const maxY = rect.height + 16 <= viewport.height
      ? Math.max(8, viewport.height - rect.height - 8)
      : Math.max(8, viewport.height - minVisiblePx);
    const boundedViewportX = clamp(viewportX, minX, maxX);
    const boundedViewportY = clamp(viewportY, minY, maxY);
    const localPoint = toLocalPoint(boundedViewportX, boundedViewportY);
    panel.style.left = `${localPoint.x}px`;
    panel.style.top = `${localPoint.y}px`;
    panel.style.transform = "none";
    return {
      viewportX: boundedViewportX,
      viewportY: boundedViewportY,
      localX: localPoint.x,
      localY: localPoint.y,
    };
  };

  const clampCurrentPosition = () => {
    const rect = readPanelRect(panel);
    const next = applyViewportPosition(rect.left, rect.top);
    onPositionCommit?.({ x: next.viewportX, y: next.viewportY });
  };

  const stopDrag = (event, reason = "end") => {
    if (!dragState) {
      return;
    }
    if (dragState.didDrag) {
      const rect = readPanelRect(panel);
      onPositionCommit?.({ x: rect.left, y: rect.top });
      suppressClickUntil = Date.now() + 420;
      log("end", { pointerType: dragState.pointerType, reason });
    } else {
      log("cancel", { pointerType: dragState.pointerType, reason });
    }
    try {
      handle.releasePointerCapture?.(dragState.pointerId);
    } catch {
      // no-op: Safari can throw if capture is already released.
    }
    panel.classList.remove("stephanos-panel-dragging");
    onDragEnd?.(dragState);
    dragState = null;
  };

  if (!diagnosticsLogged) {
    diagnosticsLogged = true;
    log("diagnostics", {
      mode: strategy.mode,
      position: strategy.panelPositionMode,
      transformed: strategy.hasTransformedAncestor,
      offsetParent: strategy.offsetParent?.id || strategy.offsetParent?.tagName || "none",
    });
  }

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType !== "touch" && event.pointerType !== "pen") {
      return;
    }
    if (event.target?.closest?.(interactiveSelector)) {
      return;
    }

    const initialRect = readPanelRect(panel);
    applyViewportPosition(initialRect.left, initialRect.top);
    const normalizedRect = readPanelRect(panel, initialRect);

    dragState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "unknown",
      startClientX: event.clientX,
      startClientY: event.clientY,
      anchorX: event.clientX - normalizedRect.left,
      anchorY: event.clientY - normalizedRect.top,
      didDrag: false,
      lastViewportX: normalizedRect.left,
      lastViewportY: normalizedRect.top,
    };

    onDragStart?.(dragState);
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // no-op: pointer capture not available.
    }
    event.preventDefault?.();
    log("start", { pointerType: dragState.pointerType });
  };

  const onPointerMove = (event) => {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) {
      return;
    }

    const movementX = event.clientX - dragState.startClientX;
    const movementY = event.clientY - dragState.startClientY;
    if (!dragState.didDrag && Math.hypot(movementX, movementY) < dragThreshold) {
      return;
    }

    dragState.didDrag = true;
    panel.classList.add("stephanos-panel-dragging");
    const targetViewportX = event.clientX - dragState.anchorX;
    const targetViewportY = event.clientY - dragState.anchorY;
    const next = applyViewportPosition(targetViewportX, targetViewportY);
    dragState.lastViewportX = next.viewportX;
    dragState.lastViewportY = next.viewportY;
    onDragMove?.(next, dragState);
    event.preventDefault?.();
    log("move", {
      pointerType: dragState.pointerType,
      x: Math.round(next.viewportX),
      y: Math.round(next.viewportY),
    });
  };

  const onPointerUp = (event) => {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) {
      return;
    }
    stopDrag(event, "pointerup");
  };

  const onPointerCancel = (event) => {
    if (!dragState || (event.pointerId != null && event.pointerId !== dragState.pointerId)) {
      return;
    }
    stopDrag(event, "pointercancel");
  };

  const onClickCapture = (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault?.();
      event.stopPropagation?.();
      suppressClickUntil = 0;
    }
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerCancel);
  panel.addEventListener?.("click", onClickCapture, true);
  globalThis.addEventListener?.("resize", clampCurrentPosition);
  globalThis.addEventListener?.("orientationchange", clampCurrentPosition);

  return {
    dispose() {
      handle.removeEventListener?.("pointerdown", onPointerDown);
      handle.removeEventListener?.("pointermove", onPointerMove);
      handle.removeEventListener?.("pointerup", onPointerUp);
      handle.removeEventListener?.("pointercancel", onPointerCancel);
      panel.removeEventListener?.("click", onClickCapture, true);
      globalThis.removeEventListener?.("resize", clampCurrentPosition);
      globalThis.removeEventListener?.("orientationchange", clampCurrentPosition);
    },
    clampToViewport: clampCurrentPosition,
  };
}
