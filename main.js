// LAUNCHER SHELL ONLY: do not implement Mission Console/theme/provider UI changes here.
// Live Stephanos UI source of truth: stephanos-ui/src/** → generated runtime: apps/stephanos/dist/**.
import { discoverApps } from "./system/apps/app_discovery.js";
import { assistantAgent } from "./system/agents/assistant_agent/assistant_agent.js";
import { appInstallerAgent } from "./system/agents/app_installer_agent/app_installer_agent.js";
import { selfRepairAgent } from "./system/agents/self_repair_agent/self_repair_agent.js";
import { validateApps } from "./system/apps/app_validator.js";
import { renderProjectRegistry as renderLauncherProjectRegistry } from "./modules/command-deck/command-deck.js";
import { createEventBus } from "./system/core/event_bus.js";
import { createSelfHealingService } from "./system/self_healing/self_healing_service.js";
import { resolveLauncherRuntimeMode } from "./shared/runtime/launcherRuntimeMode.mjs";
import { createStephanosLocalUrls } from "./shared/runtime/stephanosLocalUrls.mjs";
import { getLauncherDiagnosticsControl } from "./shared/runtime/launcherDiagnosticsControl.mjs";
import { getActiveTileContextHint, getAllTileContextSnapshots } from "./shared/runtime/tileContextRegistry.mjs";
import {
  attachStartupInteractionListeners,
  getStartupDiagnosticsSnapshot,
  markRootLandingLoaded,
  markStartupSettled
} from "./shared/runtime/startupLaunchDiagnostics.mjs";

console.log("Stephanos OS booting");
console.info("[Stephanos Early Bootstrap] launcher main.js module evaluated", { href: globalThis.location?.href || "", readyState: document.readyState });
console.log("[VALIDATOR LIVE] Command deck booted from root launcher shell");
const canonicalUrls = createStephanosLocalUrls();
const launcherDiagnostics = (() => {
  const control = getLauncherDiagnosticsControl();
  if (control.source === "query" || control.source === "meta") {
    return control;
  }

  return {
    ...control,
    enabled: false,
    source: "default",
  };
})();
const launcherRuntimeFingerprint = {
  runtimeLabel: "root-launcher",
  routeSourceLabel: "root index.html + main.js launcher shell",
  fingerprint: `launcher-${document.querySelector('meta[name=\"stephanos-version\"]')?.getAttribute("content") || "unknown"}-${new Date(document.lastModified || Date.now()).toISOString()}`,
  commitHash: "unknown",
  buildTimestamp: document.lastModified || new Date().toISOString(),
  currentOrigin: globalThis.location?.origin || "",
  currentPathname: globalThis.location?.pathname || "",
  expectedRootLauncherUrl: canonicalUrls.launcherShellUrl,
  expectedMissionControlDistUrl: canonicalUrls.runtimeIndexUrl,
};
console.info("[Stephanos Runtime Fingerprint]", launcherRuntimeFingerprint);
console.info("[Launcher Diagnostics]", launcherDiagnostics);
console.info("[IGNITION MODE]", {
  intendedMode: "launcher-root",
  intendedFinalUrl: canonicalUrls.launcherShellUrl,
  distRuntimeUrl: canonicalUrls.runtimeIndexUrl,
  devRuntimeUrl: "http://127.0.0.1:5173/",
});
markRootLandingLoaded({ href: globalThis.location?.href || "", readyState: document.readyState });
const disposeStartupInteractionListeners = attachStartupInteractionListeners();

function ensureLauncherDiagnosticsMount() {
  // Guardrail: launcher product UI (tile landing) stays clean; diagnostics render only in this isolated mount.
  const mount = document.getElementById("launcher-diagnostics-mount");
  if (!mount || !launcherDiagnostics.enabled) {
    if (mount) {
      mount.innerHTML = "";
    }
    return null;
  }

  const existingPanel = mount.querySelector("#launcher-diagnostics-panel");
  if (existingPanel) {
    return existingPanel;
  }

  mount.innerHTML = `
    <details id="launcher-diagnostics-panel" class="runtime-diagnostics-card secondary">
      <summary>
        Launcher diagnostics (optional)
        <span id="runtime-diagnostics-summary">Collecting launcher runtime diagnostics…</span>
      </summary>
      <section id="launcher-runtime-strip" class="launcher-runtime-strip"></section>
      <section id="mobile-companion-deck" class="mobile-companion-deck"></section>
      <p id="runtime-diagnostics-compact" class="runtime-diagnostics-compact" aria-live="polite">Runtime status: loading launcher diagnostics…</p>
      <div id="ignition-mode-banner" class="ignition-mode-banner" role="status" aria-live="polite">
        IGNITION MODE: launcher-root (loading…)
      </div>
      <p id="system-status-text">System Initialising...</p>
      <aside id="launcher-runtime-fingerprint" class="runtime-fingerprint-badge" aria-live="polite">
        <strong>Launcher Runtime Fingerprint</strong>
        <div>Collecting launcher fingerprint…</div>
      </aside>
      <pre id="runtime-diagnostics-json"></pre>
    </details>
  `;

  return mount.querySelector("#launcher-diagnostics-panel");
}

function renderLauncherRuntimeFingerprint() {
  const badgeNode = document.getElementById("launcher-runtime-fingerprint");
  if (!badgeNode) {
    return;
  }

  const runtimePath = launcherRuntimeFingerprint.currentPathname || "/";
  const runtimeBuilt = launcherRuntimeFingerprint.buildTimestamp || "unknown";
  badgeNode.innerHTML = `
    <strong>Launcher Runtime Fingerprint</strong>
    <p class="runtime-fingerprint-summary">
      <b>Role:</b> ${launcherRuntimeFingerprint.runtimeLabel} · <b>Path:</b> <code>${runtimePath}</code>
    </p>
    <details>
      <summary>Show fingerprint details</summary>
      <ul>
        <li><b>route/source:</b> ${launcherRuntimeFingerprint.routeSourceLabel}</li>
        <li><b>fingerprint:</b> <code>${launcherRuntimeFingerprint.fingerprint}</code></li>
        <li><b>commit:</b> ${launcherRuntimeFingerprint.commitHash}</li>
        <li><b>built:</b> ${runtimeBuilt}</li>
        <li><b>origin:</b> <code>${launcherRuntimeFingerprint.currentOrigin}</code></li>
        <li><b>expected root:</b> <code>${launcherRuntimeFingerprint.expectedRootLauncherUrl}</code></li>
        <li><b>expected dist:</b> <code>${launcherRuntimeFingerprint.expectedMissionControlDistUrl}</code></li>
      </ul>
    </details>
  `;
}

function renderIgnitionModeBanner() {
  const bannerNode = document.getElementById("ignition-mode-banner");
  if (!bannerNode) {
    return;
  }

  const onDistPath = String(globalThis.location?.pathname || "").startsWith("/apps/stephanos/dist/");
  const modeLabel = onDistPath ? "4173 dist runtime" : "4173 launcher-root";
  bannerNode.innerHTML = `IGNITION MODE: <code>${modeLabel}</code> · expected root <code>${canonicalUrls.launcherShellUrl}</code> · expected dist <code>${canonicalUrls.runtimeIndexUrl}</code>`;
}

async function hydrateLauncherBuildIdentity() {
  try {
    const response = await fetch("./apps/stephanos/dist/stephanos-build.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const buildMetadata = await response.json();
    launcherRuntimeFingerprint.commitHash = buildMetadata?.gitCommit || launcherRuntimeFingerprint.commitHash;
    launcherRuntimeFingerprint.buildTimestamp = buildMetadata?.buildTimestamp || launcherRuntimeFingerprint.buildTimestamp;
    launcherRuntimeFingerprint.fingerprint = buildMetadata?.runtimeMarker || launcherRuntimeFingerprint.fingerprint;
    renderLauncherRuntimeFingerprint();
    renderIgnitionModeBanner();
    console.info("[Stephanos Runtime Fingerprint] launcher metadata hydrated", launcherRuntimeFingerprint);
  } catch {
    // no-op: keep fallback fingerprint for diagnostics
  }
}
renderIgnitionModeBanner();

window.openSystemPanel = function() {};

window.setPanelState = function(panelId, enabled) {
  const panel = document.getElementById(panelId);
  const container = document.getElementById("stephanos-panel-stack");

  if (!panel) return;

  panel.style.display = enabled ? "block" : "none";

  if (!container) return;

  const anyVisible = Array.from(container.children).some(p => p.style.display !== "none");

  container.style.display = anyVisible ? "flex" : "none";
};

function log(message) {
  const consoleDiv = document.getElementById("dev-console");
  if (!consoleDiv) return;

  const line = document.createElement("div");
  line.textContent = message;
  consoleDiv.appendChild(line);
}

let developerMode = false;


function getRuntimeProjects(context = {}) {
  const stateProjects = context?.systemState?.get?.("projects");
  if (Array.isArray(stateProjects) && stateProjects.length > 0) {
    return stateProjects;
  }

  return Array.isArray(context?.projects) ? context.projects : [];
}




function applyDeveloperModeVisibility() {
  const display = developerMode ? "block" : "none";
  const developerElements = [
    "developer-console-title",
    "dev-console",
    "system-diagnostics-panel",
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

async function reloadStephanos() {
  if (window.__stephanosRuntime?.disposeHealthMonitor) {
    window.__stephanosRuntime.disposeHealthMonitor();
  }

  if (window.__stephanosRuntime?.disposeModules) {
    await window.__stephanosRuntime.disposeModules(window.__stephanosRuntime.context);
  }

  window.location.reload();
}

function exitStephanos() {
  if (window.__stephanosRuntime?.disposeHealthMonitor) {
    window.__stephanosRuntime.disposeHealthMonitor();
  }

  window.location.href = "/";
}

function toggleDeveloperMode() {
  developerMode = !developerMode;
  applyDeveloperModeVisibility();
}

function isDeveloperModeEnabled() {
  return developerMode;
}


function updateRuntimeDiagnostics({ projects = [], workspace = null } = {}) {
  if (!launcherDiagnostics.enabled) {
    return;
  }

  ensureLauncherDiagnosticsMount();
  const summaryNode = document.getElementById("runtime-diagnostics-summary");
  const compactNode = document.getElementById("runtime-diagnostics-compact");
  const jsonNode = document.getElementById("runtime-diagnostics-json");

  if (!summaryNode || !jsonNode) {
    return;
  }

  const runtimeMode = resolveLauncherRuntimeMode();
  const activeHint = getActiveTileContextHint() || null;
  const registrySnapshots = getAllTileContextSnapshots();
  const loadedTileIds = projects
    .map((project) => String(project?.folder || project?.id || project?.name || '').trim().toLowerCase())
    .filter(Boolean);
  const activeTileId = activeHint?.tileId || String(workspace?.activeProjectKey || '').trim() || null;

  const diagnostics = {
    checkedAt: new Date().toISOString(),
    runtimeFingerprint: launcherRuntimeFingerprint,
    runtimeMode: runtimeMode.mode,
    shellSource: runtimeMode.shellSource,
    launcherOrigin: runtimeMode.origin || globalThis.location?.origin || '',
    loadedTileIds,
    activeTileId,
    tileContextRegistryPopulated: registrySnapshots.length > 0,
    tileContextRegistryTileIds: registrySnapshots.map((snapshot) => snapshot.tileId),
    startupLaunchAudit: getStartupDiagnosticsSnapshot(),
  };

  const summaryText = `Mode: ${diagnostics.runtimeMode} · Active tile: ${diagnostics.activeTileId || 'none'} · Loaded tiles: ${diagnostics.loadedTileIds.length}`;
  summaryNode.textContent = summaryText;
  if (compactNode) {
    compactNode.textContent = `Runtime status: ${summaryText}`;
  }
  jsonNode.textContent = JSON.stringify(diagnostics, null, 2);
}

function startStephanosHealthMonitor(projects, context) {
  const monitor = async () => {
    try {
      await validateApps(projects, context);
    } catch (error) {
      console.warn("Stephanos app health monitor failed.", error);
    }
  };

  const intervalId = window.setInterval(monitor, 2000);
  window.addEventListener("focus", monitor);
  window.addEventListener("visibilitychange", monitor);

  return () => {
    window.clearInterval(intervalId);
    window.removeEventListener("focus", monitor);
    window.removeEventListener("visibilitychange", monitor);
  };
}

async function startStephanos() {
  ensureLauncherDiagnosticsMount();
  const versionMeta = document.querySelector('meta[name="stephanos-version"]');
  if (versionMeta) {
    const version = versionMeta.getAttribute("content");
    const title = document.getElementById("boot-title");

    if (title) {
      title.textContent = "Stephanos OS v" + version;
    }
  }

  log("Stephanos OS starting...");

  const eventBus = createEventBus();
  eventBus.on("app:diagnostic", (payload) => {
    if (payload?.message) {
      log(`ℹ ${payload.message}`);
    }
  });

  const { apps: projects, validationReport } = await discoverApps({ eventBus });
  updateRuntimeDiagnostics({ projects });
  const fallbackTileContext = {
    projects,
    workspace: {
      open(project) {
        if (project?.entry) {
          window.location.assign(project.entry);
        }
      },
    },
  };
  renderLauncherProjectRegistry(projects, fallbackTileContext);

  try {
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
    const { createSystemState } = await import("./system/core/system_state.js");
    const { createServiceRegistry } = await import("./system/core/service_registry.js");
    const { createUIRenderer } = await import("./system/ui_renderer.js");
    const { createTaskQueue } = await import("./system/tasks/task_queue.js");
    const { createTaskScheduler } = await import("./system/tasks/task_scheduler.js");
    const { createAgentRegistry } = await import("./system/agents/agent_registry.js");
    const { createAgentRuntime } = await import("./system/agents/agent_runtime.js");
    const { sampleAgent } = await import("./system/agents/sample_agent.js");

    const systemState = createSystemState();
    systemState.set("projects", projects);
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
    renderLauncherProjectRegistry(projects, context);

    systemState.set("appValidationReport", validationReport);

    log(
      `App discovery: ${validationReport.loaded} apps loaded, ${validationReport.invalid} app${validationReport.invalid === 1 ? "" : "s"} with errors`
    );

    validationReport.issues.forEach((issue) => {
      log(`⚠ ${issue}`);
    });

    createSelfHealingService(context);

    const validationContext = { eventBus, systemState };
    const validationResults = await validateApps(projects, validationContext);

    eventBus.on("app:revalidate_requested", async (payload) => {
      if (payload?.appId) {
        log(`ℹ revalidating ${payload.appId}: ${payload.reason || "manual request"}`);
      }

      try {
        await validateApps(projects, validationContext);
        updateRuntimeDiagnostics({ projects, workspace });
        renderLauncherProjectRegistry(getRuntimeProjects(context), context);
      } catch (error) {
        console.warn("Stephanos revalidation failed.", error);
      }
    });

    for (const result of validationResults) {
      console.warn("App Validator:", result.app);

      result.issues.forEach(issue => {
        console.warn(" - " + issue);
      });
    }

    const agentRuntime = createAgentRuntime(context);
    services.registerService("agentRuntime", agentRuntime);

    const taskScheduler = createTaskScheduler(context);
    services.registerService("taskScheduler", taskScheduler);

    agentRuntime.startAgent(sampleAgent);
    agentRuntime.startAgent(assistantAgent);
    agentRuntime.startAgent(selfRepairAgent);
    agentRuntime.startAgent(appInstallerAgent);

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

    const panels = document.querySelectorAll(".stephanos-panel");

    panels.forEach(panel => {
      panel.style.display = "none";
    });

    const container = document.getElementById("stephanos-panel-stack");

    if (container) {
      container.style.display = "none";
    }

    applyDeveloperModeVisibility();

    window.__stephanosRuntime = {
      context,
      disposeModules,
      disposeHealthMonitor: startStephanosHealthMonitor(projects, validationContext)
    };

    window.returnToCommandDeck = function() {
      context.workspace.close(context);
    };

    eventBus.on("workspace:opened", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
    });

    eventBus.on("workspace:closed", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
      renderLauncherProjectRegistry(getRuntimeProjects(context), context);
    });

    window.addEventListener("storage", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
      renderLauncherProjectRegistry(getRuntimeProjects(context), context);
    });

    updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
    renderLauncherProjectRegistry(getRuntimeProjects(context), context);
  } catch (error) {
    console.error("Stephanos launcher advanced bootstrap failed; keeping tile landing fallback.", error);
    log("⚠ Advanced launcher services failed to initialize; tile launcher remains available.");
  }

  const status = document.getElementById("system-status-text");
  if (status) {
    status.textContent = "Stephanos OS Online";
  }

  log("System ready");
  console.log("system ready");
  markStartupSettled();
  if (typeof disposeStartupInteractionListeners === "function") {
    disposeStartupInteractionListeners();
  }

  const boot = document.getElementById("boot-screen");
  if (boot) {
    setTimeout(() => {
      boot.style.display = "none";
    }, 1200);
  }
}

window.reloadStephanos = reloadStephanos;
window.exitStephanos = exitStephanos;
window.toggleDeveloperMode = toggleDeveloperMode;
window.isDeveloperModeEnabled = isDeveloperModeEnabled;

window.addEventListener("load", () => {
  ensureLauncherDiagnosticsMount();
  renderLauncherRuntimeFingerprint();
  if (launcherDiagnostics.enabled) {
    void hydrateLauncherBuildIdentity();
  }
  startStephanos();
});
