const PANEL_ID = "event-monitor-panel";
const LOG_ID = "event-log";

export const moduleDefinition = {
  id: "event-monitor",
  version: "1.0",
  description: "Live event stream for Stephanos OS."
};

let unsubscribeAllEvents = null;

export function init(context) {
  let panel = document.getElementById(PANEL_ID);

  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h3>Stephanos Event Monitor</h3>
      <div id="${LOG_ID}"></div>
    `;

    document.body.appendChild(panel);
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

export function dispose() {
  if (typeof unsubscribeAllEvents === "function") {
    unsubscribeAllEvents();
  }

  unsubscribeAllEvents = null;

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}
