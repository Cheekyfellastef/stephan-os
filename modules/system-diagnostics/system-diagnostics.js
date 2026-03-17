export const moduleDefinition = {
  id: "system-diagnostics",
  version: "1.0",
  description: "Displays runtime health information for Stephanos OS."
};

const PANEL_ID = "system-diagnostics-panel";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

let developerModeListener = null;
let diagnosticsUnsubscribers = [];

export function init(context) {
  unsubscribeFromDeveloperModeChanges();
  unsubscribeFromDiagnosticsEvents();

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
    <div id="diag-app-summary"></div>
    <div id="diag-app-issues"></div>
  `
    );
  }

  updatePanelVisibility();
  subscribeToDeveloperModeChanges();
  subscribeToDiagnosticsEvents(context);

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

function subscribeToDiagnosticsEvents(context) {
  const eventBus = context?.eventBus;

  if (!eventBus?.on) {
    return;
  }

  diagnosticsUnsubscribers = [
    eventBus.on("app:discovery_complete", (report) => {
      context?.systemState?.set?.("appValidationReport", report);
      updateDiagnostics(context);
    }),
    eventBus.on("app:validation_failed", () => {
      updateDiagnostics(context);
    })
  ];
}

function unsubscribeFromDiagnosticsEvents() {
  for (const unsubscribe of diagnosticsUnsubscribers) {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  }

  diagnosticsUnsubscribers = [];
}

export function dispose(context) {
  unsubscribeFromDeveloperModeChanges();
  unsubscribeFromDiagnosticsEvents();

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

  const report = context?.systemState?.get?.("appValidationReport") || {
    loaded: 0,
    invalid: 0,
    issues: []
  };

  const summary = document.getElementById("diag-app-summary");
  if (summary) {
    summary.innerText = `Apps loaded: ${report.loaded || 0}, Apps with errors: ${report.invalid || 0}`;
  }

  const issues = document.getElementById("diag-app-issues");
  if (issues) {
    if (Array.isArray(report.issues) && report.issues.length > 0) {
      issues.innerHTML = `<strong>App discovery issues</strong><br>${report.issues
        .map((issue) => `• ${issue}`)
        .join("<br>")}`;
    } else {
      issues.innerText = "App discovery issues: none";
    }
  }
}
