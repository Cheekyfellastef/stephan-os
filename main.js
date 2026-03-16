import { assistantAgent } from "./system/agents/assistant_agent/assistant_agent.js";

console.log("Stephanos OS booting");

function log(message) {
  const consoleDiv = document.getElementById("dev-console");
  if (!consoleDiv) return;

  const line = document.createElement("div");
  line.textContent = message;
  consoleDiv.appendChild(line);
}

let developerMode = false;

function applyDeveloperModeVisibility() {
  const display = developerMode ? "block" : "none";
  const developerElements = [
    "developer-console-title",
    "dev-console",
    "system-diagnostics-panel",
    "module-manager-panel",
    "module-installer-panel",
    "event-monitor-panel"
  ];

  for (const elementId of developerElements) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = display;
    }
  }

  window.dispatchEvent(new CustomEvent("stephanos:developer-mode-changed", {
    detail: {
      enabled: developerMode
    }
  }));
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
  developerMode = !developerMode;
  applyDeveloperModeVisibility();
}

function isDeveloperModeEnabled() {
  return developerMode;
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
  const {
    loadModules,
    disposeModules,
    getLoadedModules,
    getRegisteredModules,
    registerModulePath,
    reloadModules,
    reloadModule,
    disableModule,
    enableModule
  } = await import("./system/module_loader.js");
  const { createEventBus } = await import("./system/core/event_bus.js");
  const { createSystemState } = await import("./system/core/system_state.js");
  const { createServiceRegistry } = await import("./system/core/service_registry.js");
  const { createUIRenderer } = await import("./system/ui_renderer.js");
  const { createTaskQueue } = await import("./system/tasks/task_queue.js");
  const { createTaskScheduler } = await import("./system/tasks/task_scheduler.js");
  const { createAgentRegistry } = await import("./system/agents/agent_registry.js");
  const { createAgentRuntime } = await import("./system/agents/agent_runtime.js");
  const { sampleAgent } = await import("./system/agents/sample_agent.js");

  const eventBus = createEventBus();
  const systemState = createSystemState();
  const services = createServiceRegistry();
  const uiRenderer = createUIRenderer();
  const taskQueue = createTaskQueue();

  services.registerService("ui", uiRenderer);
  services.registerService("taskQueue", taskQueue);

  const agentRegistry = createAgentRegistry();
  services.registerService("agentRegistry", agentRegistry);

  const context = {
    eventBus,
    systemState,
    services,
    activeModules: {},
    workspace,
    projects
  };

  const agentRuntime = createAgentRuntime(context);
  services.registerService("agentRuntime", agentRuntime);

  const taskScheduler = createTaskScheduler(context);
  services.registerService("taskScheduler", taskScheduler);

  agentRuntime.startAgent(sampleAgent);
  agentRuntime.startAgent(assistantAgent);

  context.moduleLoader = {
    getLoadedModules: () => getLoadedModules(),
    reloadModule: (moduleId) => reloadModule(moduleId, context),
    disableModule: (moduleId) => disableModule(moduleId, context),
    enableModule: (moduleId) => enableModule(moduleId, context),
    getRegisteredModules: () => getRegisteredModules(),
    registerModulePath: (modulePath) => registerModulePath(modulePath),
    reloadModules: () => reloadModules(context)
  };

  console.log("modules loading");
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
  console.log("system ready");

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
window.isDeveloperModeEnabled = isDeveloperModeEnabled;

window.onload = function() {
  startStephanos();
};


window.openSystemPanel = function () {

  const panels = document.querySelectorAll(".stephanos-panel");

  panels.forEach(panel => {

    if (panel.style.display === "none") {
      panel.style.display = "block";
    } else {
      panel.style.display = "none";
    }

  });

};

window.reloadStephanos = function () {

  console.log("Reloading Stephanos");

  location.reload();

};
