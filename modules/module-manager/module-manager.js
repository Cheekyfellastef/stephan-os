const PANEL_ID = "module-manager-panel";
const LIST_ID = "module-list";
let eventBusUnsubscribers = [];

export const moduleDefinition = {
  id: "module-manager",
  version: "1.0",
  description: "Runtime management of Stephanos OS modules."
};

export async function init(context) {
  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  const panel = ui.createPanel(PANEL_ID, "Stephanos Module Manager");

  if (!document.getElementById(LIST_ID)) {
    panel.insertAdjacentHTML("beforeend", `<div id="${LIST_ID}"></div>`);
  }

  subscribeToRuntimeUpdates(context);

  await renderModuleList(context);
}

export function dispose(context) {
  unsubscribeFromRuntimeUpdates();

  const ui = context?.services?.getService?.("ui");
  if (!ui) {
    return;
  }

  ui.removePanel(PANEL_ID);
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

}

function unsubscribeFromRuntimeUpdates() {
  for (const unsubscribe of eventBusUnsubscribers) {
    unsubscribe();
  }

  eventBusUnsubscribers = [];

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
    let status = "DISABLED";

    if (moduleEntry?.status === "active") {
      status = "ACTIVE";
    } else if (moduleEntry?.status === "failed") {
      status = "FAILED";
    } else if (moduleEntry?.status === "loading") {
      status = "LOADING";
    }

    const version = definition.version || "unknown";

    const row = document.createElement("div");
    row.className = "module-entry";

    const details = document.createElement("span");
    details.classList.add(status);
    details.textContent = `${definition.id} v${version} ${status}`;

    const actions = document.createElement("span");

    if (status === "ACTIVE") {
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
