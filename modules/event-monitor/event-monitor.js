const PANEL_ID = "event-monitor-panel";
const LOG_ID = "event-log";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

export const moduleDefinition = {
  id: "event-monitor",
  version: "1.0",
  description: "Live event stream"
};

let originalEmit = null;
let developerModeListener = null;

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Event Monitor");

  if (!document.getElementById(LOG_ID)) {
    const log = document.createElement("div");
    log.id = LOG_ID;
    panel.appendChild(log);
  }

  updatePanelVisibility();
  subscribeToDeveloperModeChanges();

  if (typeof context?.eventBus?.emit !== "function") {
    return;
  }

  originalEmit = context.eventBus.emit;

  context.eventBus.emit = function(eventName, payload) {
    logEvent(eventName);
    return originalEmit.call(this, eventName, payload);
  };
}

function updatePanelVisibility(panel = document.getElementById(PANEL_ID)) {
  if (!panel) {
    return;
  }

  const developerModeEnabled = window.isDeveloperModeEnabled?.() ?? false;
  panel.style.display = developerModeEnabled ? "block" : "none";
}

function subscribeToDeveloperModeChanges() {
  if (developerModeListener) {
    return;
  }

  developerModeListener = () => {
    updatePanelVisibility();
  };

  window.addEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
}

function unsubscribeFromDeveloperModeChanges() {
  if (!developerModeListener) {
    return;
  }

  window.removeEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
  developerModeListener = null;
}

function logEvent(eventName) {
  const log = document.getElementById(LOG_ID);
  if (!log) {
    return;
  }

  const entry = document.createElement("div");
  entry.textContent = eventName;
  log.prepend(entry);
}

export function dispose(context) {
  if (originalEmit && context?.eventBus) {
    context.eventBus.emit = originalEmit;
  }

  originalEmit = null;
  unsubscribeFromDeveloperModeChanges();

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
}
