const PANEL_ID = "event-monitor-panel";
const LOG_ID = "event-log";

export const moduleDefinition = {
  id: "event-monitor",
  version: "1.0",
  description: "Live event stream for Stephanos OS."
};

let unsubscribeAllEvents = null;

export function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Event Monitor");

  if (!document.getElementById(LOG_ID)) {
    panel.insertAdjacentHTML("beforeend", `<div id="${LOG_ID}"></div>`);
  }

  const logEvent = (event) => {
    const log = document.getElementById(LOG_ID);
    if (!log) {
      return;
    }

    const entry = document.createElement("div");
    const eventName = event?.name || "unknown";
    entry.textContent = `${new Date(event?.timestamp || Date.now()).toLocaleTimeString()} ${eventName}`;

    log.prepend(entry);
  };

  unsubscribeAllEvents = context?.eventBus?.on?.("*", logEvent) || null;
}

export function dispose(context) {
  if (typeof unsubscribeAllEvents === "function") {
    unsubscribeAllEvents();
  }

  unsubscribeAllEvents = null;

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
}
