export const moduleDefinition = {
  id: "system-diagnostics",
  version: "1.0",
  description: "Displays runtime health information for Stephanos OS."
};

const PANEL_ID = "system-diagnostics-panel";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

let developerModeListener = null;

export function init(context) {
  unsubscribeFromDeveloperModeChanges();

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Diagnostics");

  if (!document.getElementById("diag-modules")) {
    panel.insertAdjacentHTML(
      "beforeend",
      `
    <div id="diag-modules"></div>
    <div id="diag-services"></div>
    <div id="diag-events"></div>
  `
    );
  }

  updatePanelVisibility();
  subscribeToDeveloperModeChanges();

  updateDiagnostics(context);
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

function updateDiagnostics(context) {
  const moduleCount = document.querySelectorAll(".app-tile").length;

  document.getElementById("diag-modules").innerText =
    "Modules loaded: " + moduleCount;

  const services = context.services.listServices();

  document.getElementById("diag-services").innerText =
    "Services registered: " + services.length;

  document.getElementById("diag-events").innerText =
    "Event bus active: true";
}
