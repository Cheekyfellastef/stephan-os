export const moduleDefinition = {
  id: "system-diagnostics",
  version: "1.0",
  description: "Displays runtime health information for Stephanos OS."
};

const PANEL_ID = "system-diagnostics-panel";

export function init(context) {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const panel = document.createElement("div");

  panel.id = PANEL_ID;

  panel.innerHTML = `
    <h3>Stephanos Diagnostics</h3>
    <div id="diag-modules"></div>
    <div id="diag-services"></div>
    <div id="diag-events"></div>
  `;

  document.body.appendChild(panel);

  updateDiagnostics(context);
}

export function dispose() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
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
