const PANEL_ID = "module-map-panel";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

export const moduleDefinition = {
  id: "module-map",
  version: "1.0",
  description: "Displays module dependency map"
};

let developerModeListener = null;

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Modules");
  const list = document.createElement("div");

  const modules = context?.moduleLoader?.getLoadedModules?.() || context?.activeModules || [];

  modules.forEach((mod) => {
    const entry = document.createElement("div");
    entry.textContent = mod?.moduleDefinition?.id || "unknown";
    list.appendChild(entry);
  });

  panel.appendChild(list);

  updatePanelVisibility();
  subscribeToDeveloperModeChanges();
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

export function dispose(context) {
  unsubscribeFromDeveloperModeChanges();

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
}
