const PANEL_ID = "module-installer-panel";
const STATUS_ID = "module-installer-status";

export const moduleDefinition = {
  id: "module-installer",
  version: "1.0",
  description: "Install Stephanos modules from remote URLs."
};

export function init(context) {
  let panel = document.getElementById(PANEL_ID);

  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h3>Stephanos Module Installer</h3>
      <input id="module-installer-url" type="url" placeholder="https://example.com/module.js" />
      <button id="module-installer-button">Install</button>
      <div id="${STATUS_ID}"></div>
    `;

    document.body.appendChild(panel);
  }

  const installButton = document.getElementById("module-installer-button");
  const urlInput = document.getElementById("module-installer-url");

  if (!installButton || !urlInput) {
    return;
  }

  installButton.onclick = async () => {
    const url = urlInput.value.trim();
    if (!url) {
      setStatus("Enter a module URL.", true);
      return;
    }

    try {
      await installModule(url, context);
      setStatus(`Installed: ${url}`, false);
      urlInput.value = "";
    } catch (error) {
      console.error("Module install failed", error);
      setStatus("Install failed. Check console.", true);
    }
  };
}

function setStatus(message, isError) {
  const status = document.getElementById(STATUS_ID);
  if (!status) {
    return;
  }

  status.textContent = message;
  status.style.color = isError ? "#f66" : "#6f6";
}

async function installModule(url, context) {
  const response = await fetch("modules/module_registry.json");
  const registry = await response.json();
  registry.modules = registry.modules || [];

  if (registry.modules.includes(url)) {
    throw new Error("Module URL already in registry");
  }

  registry.modules.push(url);

  try {
    await fetch("modules/module_registry.json", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(registry, null, 2)
    });
  } catch (error) {
    console.warn("Unable to persist module registry file in browser runtime.", error);
  }

  const registered = context?.moduleLoader?.registerModulePath?.(url);
  if (!registered) {
    throw new Error("Module is already registered");
  }

  await context?.moduleLoader?.reloadModules?.();

  console.log("Module added to registry:", url);
}

export function dispose() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}
