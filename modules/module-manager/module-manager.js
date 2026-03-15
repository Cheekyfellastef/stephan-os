const PANEL_ID = "module-manager-panel";
const LIST_ID = "module-list";
const DEVELOPER_MODE_EVENT = "stephanos:developer-mode-changed";

let eventBusUnsubscribers = [];
let developerModeListener = null;

export const moduleDefinition = {
  id: "module-manager",
  version: "1.0",
  description: "Runtime management of Stephanos OS modules."
};

export async function init(context) {
  let panel = document.getElementById(PANEL_ID);

  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h3>Stephanos Module Manager</h3>
      <div id="${LIST_ID}"></div>
    `;

    document.body.appendChild(panel);
  }

  updatePanelVisibility(panel);

  subscribeToRuntimeUpdates(context);

  await renderModuleList(context);
}

export function dispose() {
  unsubscribeFromRuntimeUpdates();

  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

function updatePanelVisibility(panel = document.getElementById(PANEL_ID)) {
  if (!panel) {
    return;
  }

  const developerModeEnabled = window.isDeveloperModeEnabled?.() ?? false;
  panel.style.display = developerModeEnabled ? "block" : "none";
}

function subscribeToRuntimeUpdates(context) {
  unsubscribeFromRuntimeUpdates();

  const onModulesChanged = () => {
    renderModuleList(context);
  };

  if (context?.eventBus?.on) {
    eventBusUnsubscribers = [
      context.eventBus.on("module:loaded", onModulesChanged),
      context.eventBus.on("module:disposed", onModulesChanged)
    ].filter((unsubscribe) => typeof unsubscribe === "function");
  }

  developerModeListener = () => {
    updatePanelVisibility();
  };

  window.addEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
}

function unsubscribeFromRuntimeUpdates() {
  for (const unsubscribe of eventBusUnsubscribers) {
    unsubscribe();
  }

  eventBusUnsubscribers = [];

  if (developerModeListener) {
    window.removeEventListener(DEVELOPER_MODE_EVENT, developerModeListener);
    developerModeListener = null;
  }
}

async function renderModuleList(context) {
  const list = document.getElementById(LIST_ID);
  if (!list) {
    return;
  }

  const modules = context?.moduleLoader?.getLoadedModules?.() || [];

  list.innerHTML = "";

  for (const moduleEntry of modules) {
    const definition = moduleEntry?.moduleDefinition;

    if (!definition?.id) {
      continue;
    }

    const isModuleManager = definition.id === moduleDefinition.id;
    const status = moduleEntry?.status === "active" ? "active" : "disabled";
    const version = definition.version || "unknown";

    const row = document.createElement("div");
    row.className = "module-entry";

    const details = document.createElement("span");
    details.textContent = `${definition.id} ${version} ${status}`;

    const actions = document.createElement("span");

    if (status === "active") {
      const reloadButton = document.createElement("button");
      reloadButton.textContent = "reload";
      reloadButton.disabled = false;
      reloadButton.onclick = async () => {
        await context.moduleLoader.reloadModule(definition.id);
        await renderModuleList(context);
      };
      actions.appendChild(reloadButton);

      const disableButton = document.createElement("button");
      disableButton.textContent = "disable";
      disableButton.disabled = isModuleManager;
      disableButton.onclick = async () => {
        if (isModuleManager) {
          return;
        }

        await context.moduleLoader.disableModule(definition.id);
        await renderModuleList(context);
      };
      actions.appendChild(disableButton);
    } else {
      const enableButton = document.createElement("button");
      enableButton.textContent = "enable";
      enableButton.onclick = async () => {
        await context.moduleLoader.enableModule(definition.id);
        await renderModuleList(context);
      };
      actions.appendChild(enableButton);
    }

    row.appendChild(details);
    row.appendChild(actions);

    list.appendChild(row);
  }
}
