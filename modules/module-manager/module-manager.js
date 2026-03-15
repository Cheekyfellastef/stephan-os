const PANEL_ID = "module-manager-panel";
const LIST_ID = "module-list";

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

  await renderModuleList(context);
}

export function dispose() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

async function renderModuleList(context) {
  const list = document.getElementById(LIST_ID);
  if (!list) {
    return;
  }

  const registryUrl = new URL("../../modules/module_registry.json", import.meta.url);
  const response = await fetch(registryUrl);
  const registry = await response.json();

  const activeModules = context?.moduleLoader?.getLoadedModules?.() || [];
  const activeById = new Map(activeModules.map((entry) => [entry.moduleDefinition.id, entry]));

  list.innerHTML = "";

  for (const modulePath of registry.modules || []) {
    const moduleUrl = new URL(modulePath, window.location.href);
    const importedModule = await import(moduleUrl.href);
    const definition = importedModule?.moduleDefinition;

    if (!definition?.id) {
      continue;
    }

    const activeModule = activeById.get(definition.id);
    const status = activeModule ? "active" : "disabled";
    const version = definition.version || "unknown";

    const row = document.createElement("div");
    row.className = "module-entry";

    const details = document.createElement("span");
    details.textContent = `${definition.id} ${version} ${status}`;

    const actions = document.createElement("span");

    const reloadButton = document.createElement("button");
    reloadButton.textContent = "reload";
    reloadButton.disabled = !activeModule;
    reloadButton.onclick = async () => {
      await context.moduleLoader.reloadModule(definition.id);
      await renderModuleList(context);
    };

    const disableButton = document.createElement("button");
    disableButton.textContent = "disable";
    disableButton.disabled = !activeModule;
    disableButton.onclick = async () => {
      await context.moduleLoader.disableModule(definition.id);
      await renderModuleList(context);
    };

    actions.appendChild(reloadButton);
    actions.appendChild(disableButton);

    row.appendChild(details);
    row.appendChild(actions);

    list.appendChild(row);
  }
}
