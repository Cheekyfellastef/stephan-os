export const moduleDefinition = {
  id: "self-healing-panel",
  version: "1.0",
  description: "Displays Stephanos self-healing activity"
};

const PANEL_ID = "self-healing-panel";
const LOG_ID = "self-healing-log";

let unsubscribers = [];

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Auto-Repair");

  const log = document.createElement("div");
  log.id = LOG_ID;
  panel.appendChild(log);

  renderExistingLog(context);

  unsubscribers = [
    context.eventBus.on("app:validation_failed", (payload) => {
      appendLine(`Detected app failure: ${payload?.name || "unknown"} (${payload?.entry || "no-entry"})`);
    }),
    context.eventBus.on("module:failed", (payload) => {
      appendLine(`Detected module failure: ${payload?.id || payload?.path || "unknown"}`);
    }),
    context.eventBus.on("workspace:launch_failed", (payload) => {
      appendLine(`Launch failed: ${payload?.name || "unknown"}`);
    }),
    context.eventBus.on("repair:logged", (entry) => {
      appendLine(`Repair ${entry?.status || "unknown"}: ${entry?.type || "unknown"} -> ${entry?.target || "unknown"}`);
    })
  ];
}

function renderExistingLog(context) {
  const existing = Array.isArray(context?.repairLog) ? context.repairLog : [];
  existing.forEach((entry) => {
    appendLine(`Repair ${entry?.status || "unknown"}: ${entry?.type || "unknown"} -> ${entry?.target || "unknown"}`);
  });
}

function appendLine(message) {
  const container = document.getElementById(LOG_ID);
  if (!container) {
    return;
  }

  const row = document.createElement("div");
  row.textContent = message;
  container.prepend(row);
}

export function dispose(context) {
  for (const unsubscribe of unsubscribers) {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  }

  unsubscribers = [];

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
}
