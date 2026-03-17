export const moduleDefinition = {
  id: "app-installer-panel",
  version: "1.0",
  description: "Displays recent app installation activity"
};

const PANEL_ID = "app-installer-panel";
const LIST_ID = "app-installer-installed-list";
const STATUS_ID = "app-installer-status";
const ERROR_ID = "app-installer-error";

let unsubscribers = [];

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos App Installer");

  panel.innerHTML = `
    <div id="${STATUS_ID}">Status: Idle</div>
    <div id="${ERROR_ID}"></div>
    <div style="margin-top:8px; font-weight:600;">Installed Apps</div>
    <div id="${LIST_ID}"></div>
  `;

  renderInstalledApps(context);

  unsubscribers = [
    context.eventBus.on("app:installed", (app) => {
      setStatus(`Status: Installed ${app?.name || "unknown"}`);
      setError("");
      renderInstalledApps(context);
    }),
    context.eventBus.on("app:install_error", (error) => {
      setStatus("Status: Install failed");
      setError(error?.message || "Unknown install error");
    })
  ];
}

function renderInstalledApps(context) {
  const list = document.getElementById(LIST_ID);
  if (!list) {
    return;
  }

  const projects = context?.systemState?.get?.("projects") || [];

  list.innerHTML = "";

  projects.forEach((project) => {
    const row = document.createElement("div");
    row.textContent = `${project?.icon || "🧩"} ${project?.name || "Unnamed"}`;
    list.appendChild(row);
  });
}

function setStatus(text) {
  const status = document.getElementById(STATUS_ID);
  if (!status) {
    return;
  }

  status.textContent = text;
}

function setError(message) {
  const error = document.getElementById(ERROR_ID);
  if (!error) {
    return;
  }

  error.textContent = message;
  error.style.color = message ? "#f66" : "inherit";
}

export function dispose(context) {
  unsubscribers.forEach((unsubscribe) => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  });

  unsubscribers = [];

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
}
