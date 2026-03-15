const PANEL_ID = "service-inspector-panel";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

export const moduleDefinition = {
  id: "service-inspector",
  version: "1.0",
  description: "Lists active services"
};

let developerModeListener = null;

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Services");
  const list = document.createElement("div");

  const services = context?.services?.listServices?.() || [];

  services.forEach((service) => {
    const entry = document.createElement("div");
    entry.textContent = service;
    list.appendChild(entry);
  });

  panel.appendChild(list);

  updatePanelVisibility(panel);
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
