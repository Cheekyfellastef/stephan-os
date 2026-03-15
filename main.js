function log(message) {
  const consoleDiv = document.getElementById("dev-console");
  if (!consoleDiv) return;

  const line = document.createElement("div");
  line.textContent = message;
  consoleDiv.appendChild(line);
}

let developerModeEnabled = false;

function applyDeveloperModeVisibility() {
  const display = developerModeEnabled ? "block" : "none";
  const developerElements = ["dev-console", "system-diagnostics-panel", "module-manager-panel"];

  for (const elementId of developerElements) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = display;
    }
  }
}

function openSystemPanel() {
  const panel = document.getElementById("system-panel");
  if (!panel) return;

  panel.style.display = "flex";
}

function closeSystemPanel() {
  const panel = document.getElementById("system-panel");
  if (!panel) return;

  panel.style.display = "none";
}

async function reloadStephanos() {
  if (window.__stephanosRuntime?.disposeModules) {
    await window.__stephanosRuntime.disposeModules(window.__stephanosRuntime.context);
  }

  window.location.reload();
}

function exitStephanos() {
  window.location.href = "https://google.com";
}

function toggleDeveloperMode() {
  developerModeEnabled = !developerModeEnabled;
  applyDeveloperModeVisibility();
}

async function loadProjects() {
  try {
    const response = await fetch("projects_registry.json?v=0.1");
    const data = await response.json();
    return data.projects;
  } catch (error) {
    log("Failed to load project registry");
    return [];
  }
}

async function startStephanos() {
  const versionMeta = document.querySelector('meta[name="stephanos-version"]');
  if (versionMeta) {
    const version = versionMeta.getAttribute("content");
    const title = document.getElementById("boot-title");

    if (title) {
      title.textContent = "Stephanos OS v" + version;
    }
  }

  log("Stephanos OS starting...");

  const projects = await loadProjects();

  const { workspace } = await import("./system/workspace.js");
  const { loadModules, disposeModules, getLoadedModules, reloadModule, disableModule } = await import("./system/module_loader.js");
  const { createEventBus } = await import("./system/core/event_bus.js");
  const { createSystemState } = await import("./system/core/system_state.js");
  const { createServiceRegistry } = await import("./system/core/service_registry.js");

  const eventBus = createEventBus();
  const systemState = createSystemState();
  const services = createServiceRegistry();

  const context = {
    eventBus,
    systemState,
    services,
    activeModules: {},
    workspace,
    projects
  };

  context.moduleLoader = {
    getLoadedModules: () => getLoadedModules(),
    reloadModule: (moduleId) => reloadModule(moduleId, context),
    disableModule: (moduleId) => disableModule(moduleId, context)
  };

  await loadModules(context);

  applyDeveloperModeVisibility();

  window.__stephanosRuntime = {
    context,
    disposeModules
  };

  window.returnToCommandDeck = function() {
    context.workspace.close(context);
  };

  const status = document.getElementById("system-status-text");
  if (status) {
    status.textContent = "Stephanos OS Online";
  }

  log("System ready");

  const boot = document.getElementById("boot-screen");
  if (boot) {
    setTimeout(() => {
      boot.style.display = "none";
    }, 1200);
  }
}

window.openSystemPanel = openSystemPanel;
window.closeSystemPanel = closeSystemPanel;
window.reloadStephanos = reloadStephanos;
window.exitStephanos = exitStephanos;
window.toggleDeveloperMode = toggleDeveloperMode;

window.onload = function() {
  startStephanos();
};
