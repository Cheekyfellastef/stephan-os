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
import { renderStephanosLawsPanel } from "./shared/runtime/renderStephanosLawsPanel.mjs";
import { STEPHANOS_LAW_IDS } from "./shared/runtime/stephanosLaws.mjs";
import { createTruthSnapshot } from "./shared/runtime/truthEngine.mjs";
import { renderTruthPanel } from "./shared/runtime/renderTruthPanel.mjs";
import { createRealitySyncController } from "./shared/runtime/realitySync.mjs";
import {
  createBuildParitySnapshot,
  evaluateToggleRegistryParity,
} from "./shared/runtime/buildParity.mjs";
import { createStephanosMemory, createStephanosMemoryGateway } from "./shared/runtime/stephanosMemory.mjs";
import { createStephanosContinuityService } from "./shared/runtime/stephanosContinuity.mjs";
import {
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from "./shared/runtime/stephanosSessionMemory.mjs";
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
  fingerprint: `launcher-${document.querySelector('meta[name=\"stephanos-version\"]')?.getAttribute("content") || "unknown"}`,
  commitHash: "unknown",
  buildTimestamp: "unknown",
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
  const anyDiagnosticsSurfaceVisible = launcherSurfaceVisibility.runtimeDiagnosticsVisible
    || launcherSurfaceVisibility.launcherRuntimeFingerprintVisible
    || launcherSurfaceVisibility.truthPanelVisible;
  if (!mount || (!launcherDiagnostics.enabled && !anyDiagnosticsSurfaceVisible)) {
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
      <section id="launcher-truth-panel-mount" aria-live="polite"></section>
      <pre id="runtime-diagnostics-json"></pre>
    </details>
  `;

  return mount.querySelector("#launcher-diagnostics-panel");
}

function persistLauncherSurfacePreferences() {
  const currentMemory = readPersistedStephanosSessionMemory();
  persistStephanosSessionMemory({
    ...currentMemory,
    session: {
      ...currentMemory.session,
      ui: {
        ...currentMemory.session.ui,
        uiLayout: {
          ...(currentMemory.session.ui?.uiLayout || {}),
          runtimeDiagnosticsVisible: launcherSurfaceVisibility.runtimeDiagnosticsVisible,
          launcherRuntimeFingerprintVisible: launcherSurfaceVisibility.launcherRuntimeFingerprintVisible,
          truthPanelVisible: launcherSurfaceVisibility.truthPanelVisible,
          realitySyncEnabled: realitySyncState.enabled !== false,
        },
      },
    },
  });
}

function buildTruthSnapshot({ projects = [], workspace = null } = {}) {
  const container = document.getElementById("project-registry");
  const tileDomCount = container?.querySelectorAll(".app-tile").length || 0;
  const startupSnapshot = getStartupDiagnosticsSnapshot();
  const runtimeMode = resolveLauncherRuntimeMode();
  return createTruthSnapshot({
    launcher: {
      mode: runtimeMode.mode,
      shellStatus: moduleFailureEvents.some((entry) => entry?.launcherCritical) ? "degraded" : "healthy",
      tileRegistryCount: Array.isArray(projects) ? projects.length : 0,
      tileDomCount,
      launcherCriticalModuleFailureCount: moduleFailureEvents.filter((entry) => entry?.launcherCritical).length,
      buildProofPresent: Boolean(document.getElementById("launcher-build-proof")),
      projectsDiscoveredCount: Array.isArray(projects) ? projects.length : 0,
    },
    sourceBuildServed: {
      buildMarker: buildTruthSignals.builtMarker || buildTruthSignals.requestedSourceMarker || "missing",
      buildTimestamp: buildTruthSignals.buildTimestamp || "unknown",
      servedSourceTruthAvailable: buildTruthSignals.servedSourceTruthAvailable,
      servedDistTruthAvailable: buildTruthSignals.servedDistTruthAvailable,
      sourceDistParityOk: buildTruthSignals.sourceDistParityOk,
      servedMarker: buildTruthSignals.servedMarker || "missing",
      servedBuildTimestamp: buildTruthSignals.servedBuildTimestamp || "unknown",
    },
    runtime: {
      runtimeDiagnosticsEnabled: launcherSurfaceVisibility.runtimeDiagnosticsVisible,
      launcherRuntimeFingerprintVisible: launcherSurfaceVisibility.launcherRuntimeFingerprintVisible,
      truthPanelVisible: launcherSurfaceVisibility.truthPanelVisible,
      backendReachable: buildTruthSignals.servedDistTruthAvailable,
      finalRoute: workspace?.activeProjectKey || "launcher-root",
      routeKind: runtimeMode.shellSource || "launcher",
      runtimeErrorActive: startupSnapshot?.launchTriggers?.length > 0
        && moduleFailureEvents.length > 0,
      localhostMirrorDrift: buildTruthSignals.localhostMirrorDrift === true,
      ignitionRestartRequired: buildTruthSignals.ignitionRestartRequired === true,
      ignitionRestartSupported: buildTruthSignals.ignitionRestartSupported === true,
    },
    realitySync: {
      enabled: realitySyncState.enabled !== false,
      displayedMarker: realitySyncState.displayedMarker || buildTruthSignals.servedMarker || buildTruthSignals.builtMarker || "missing",
      displayedTimestamp: realitySyncState.displayedTimestamp || buildTruthSignals.servedBuildTimestamp || buildTruthSignals.buildTimestamp || "unknown",
      latestMarker: realitySyncState.latestMarker || "missing",
      latestTimestamp: realitySyncState.latestTimestamp || "unknown",
      latestSource: realitySyncState.latestSource || "unavailable",
      isStale: realitySyncState.isStale === true,
      refreshPending: realitySyncState.refreshPending === true,
      lastRefreshReason: realitySyncState.lastRefreshReason || "",
      lastRefreshAt: realitySyncState.lastRefreshAt || "",
      attemptsForCurrentMarker: realitySyncState.attemptsForCurrentMarker || 0,
      lastRestartRequestAt: buildTruthSignals.lastRestartRequestAt || "",
      lastRestartResult: buildTruthSignals.lastRestartResult || "none",
    },
  });
}

function updateTruthPanel({ projects = [], workspace = null } = {}) {
  latestTruthSnapshot = buildTruthSnapshot({ projects, workspace });
  renderTruthPanel(latestTruthSnapshot, document, {
    visible: launcherSurfaceVisibility.truthPanelVisible,
  });
}

function applyLauncherSurfaceVisibility() {
  ensureLauncherDiagnosticsMount();
  const diagnosticsPanel = document.getElementById("launcher-diagnostics-panel");
  if (diagnosticsPanel) {
    const showAnyDiagnosticsSurface = launcherSurfaceVisibility.runtimeDiagnosticsVisible
      || launcherSurfaceVisibility.launcherRuntimeFingerprintVisible
      || launcherSurfaceVisibility.truthPanelVisible;
    diagnosticsPanel.style.display = showAnyDiagnosticsSurface ? "block" : "none";
  }

  const fingerprintPanel = document.getElementById("launcher-runtime-fingerprint");
  if (fingerprintPanel) {
    fingerprintPanel.style.display = launcherSurfaceVisibility.launcherRuntimeFingerprintVisible ? "block" : "none";
  }
  const diagnosticsSummary = document.getElementById("runtime-diagnostics-summary");
  const diagnosticsCompact = document.getElementById("runtime-diagnostics-compact");
  const diagnosticsJson = document.getElementById("runtime-diagnostics-json");
  const runtimeStrip = document.getElementById("launcher-runtime-strip");
  const mobileDeck = document.getElementById("mobile-companion-deck");
  const ignitionBanner = document.getElementById("ignition-mode-banner");
  const systemStatus = document.getElementById("system-status-text");
  [diagnosticsSummary, diagnosticsCompact, diagnosticsJson, runtimeStrip, mobileDeck, ignitionBanner, systemStatus].forEach((node) => {
    if (node) {
      node.style.display = launcherSurfaceVisibility.runtimeDiagnosticsVisible ? "block" : "none";
    }
  });

  const stephanosContinuity = window.__stephanosRuntime?.context?.services?.getService?.("stephanosContinuity");
  if (stephanosContinuity?.update) {
    stephanosContinuity.update({
      truth: {
        truthPanelVisible: launcherSurfaceVisibility.truthPanelVisible,
        lawsPanelVisible: true,
        realitySyncEnabled: realitySyncState.enabled !== false,
      },
    });
  }

  updateTruthPanel({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
}

window.applyLauncherSurfaceVisibility = function applyLauncherSurfaceVisibilityFromSystemPanel(nextState = {}) {
  if (typeof nextState?.runtimeDiagnosticsVisible === "boolean") {
    launcherSurfaceVisibility.runtimeDiagnosticsVisible = nextState.runtimeDiagnosticsVisible;
  }
  if (typeof nextState?.launcherRuntimeFingerprintVisible === "boolean") {
    launcherSurfaceVisibility.launcherRuntimeFingerprintVisible = nextState.launcherRuntimeFingerprintVisible;
  }
  if (typeof nextState?.truthPanelVisible === "boolean") {
    launcherSurfaceVisibility.truthPanelVisible = nextState.truthPanelVisible;
  }
  persistLauncherSurfacePreferences();
  applyLauncherSurfaceVisibility();
  updateRuntimeDiagnostics({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
};

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

function renderLauncherBuildProof({ requestedSourceMarker = null, builtMarker = null, servedMarker = null, buildTimestamp = null, servedBuildTimestamp = null, realitySync = null }) {
  const proofNode = document.getElementById("launcher-build-proof");
  if (!proofNode) {
    return;
  }
  refreshPanelRegistryParity();

  const activeMarker = servedMarker || builtMarker || requestedSourceMarker || "unknown";
  const activeTimestamp = servedBuildTimestamp || buildTimestamp || "unknown";
  const staleLabel = realitySync?.isStale ? "stale" : "current";
  const syncStateLabel = realitySync?.enabled === false ? "disabled" : realitySync?.refreshPending ? "syncing" : "monitoring";
  const refreshReason = realitySync?.lastRefreshReason || "none";
  const mirrorStatus = buildTruthSignals.localhostMirrorDrift ? "drift" : "aligned";
  const restartLabel = buildTruthSignals.ignitionRestartRequired ? "restart required" : "restart not required";
  const paritySummary = buildTruthSignals.paritySnapshot?.parityOk ? "launcher/tile/served aligned" : "parity mismatch";
  const toggleSummary = buildTruthSignals.panelRegistryParity?.parityOk ? "registry aligned" : "registry drift";
  proofNode.innerHTML = `
    <strong>Build</strong>
    <div>${activeTimestamp}</div>
    <div><code>${activeMarker}</code></div>
    <div class="launcher-build-reality-sync">Commit: <code>${buildTruthSignals.paritySnapshot?.gitCommit || "unknown"}</code></div>
    <div class="launcher-build-reality-sync">Runtime mode: ${buildTruthSignals.paritySnapshot?.runtimeMode || "unknown"} · origin: ${buildTruthSignals.paritySnapshot?.artifactOrigin || "unknown"}</div>
    <div class="launcher-build-reality-sync">Parity: ${paritySummary} · Toggle registry: ${toggleSummary}</div>
    <div class="launcher-build-reality-sync">Reality Sync: ${syncStateLabel} · screen ${staleLabel}</div>
    <div class="launcher-build-reality-sync">Latest: <code>${realitySync?.latestMarker || "unknown"}</code></div>
    <div class="launcher-build-reality-sync">Last refresh reason: ${refreshReason}</div>
    <div class="launcher-build-reality-sync">Localhost mirror: ${mirrorStatus} · ${restartLabel}</div>
  `;
}

async function hydrateLauncherBuildProof() {
  const requestedSourceMarker = launcherRuntimeFingerprint.fingerprint || null;
  let builtMarker = null;
  let buildTimestamp = null;
  let servedMarker = null;
  let servedBuildTimestamp = null;
  let servedSource = "health";
  let servedCommit = null;

  try {
    const buildResponse = await fetch("./apps/stephanos/dist/stephanos-build.json", { cache: "no-store" });
    if (buildResponse.ok) {
      const buildMetadata = await buildResponse.json();
      builtMarker = buildMetadata?.runtimeMarker || null;
      buildTimestamp = buildMetadata?.buildTimestamp || null;
      launcherRuntimeFingerprint.commitHash = buildMetadata?.gitCommit || launcherRuntimeFingerprint.commitHash;
      launcherRuntimeFingerprint.buildTimestamp = buildTimestamp || launcherRuntimeFingerprint.buildTimestamp;
      launcherRuntimeFingerprint.fingerprint = builtMarker || launcherRuntimeFingerprint.fingerprint;
      renderLauncherRuntimeFingerprint();
      renderIgnitionModeBanner();
    }
  } catch {
    // no-op
  }

  try {
    const healthResponse = await fetch("./__stephanos/health", { cache: "no-store" });
    if (healthResponse.ok) {
      const healthPayload = await healthResponse.json();
      servedMarker = healthPayload?.runtimeMarker || null;
      servedBuildTimestamp = healthPayload?.buildTimestamp || null;
      servedCommit = healthPayload?.gitCommit || null;
      buildTruthSignals.ignitionRestartSupported = healthPayload?.ignitionRestart?.supported === true;
      buildTruthSignals.lastRestartRequestAt = healthPayload?.ignitionRestart?.lastRequestedAt || buildTruthSignals.lastRestartRequestAt;
      buildTruthSignals.lastRestartResult = healthPayload?.ignitionRestart?.lastResult || buildTruthSignals.lastRestartResult;
    }
  } catch {
    // no-op
  }
  try {
    const sourceTruthResponse = await fetch("./__stephanos/source-truth", { cache: "no-store" });
    if (sourceTruthResponse.ok) {
      const sourceTruthPayload = await sourceTruthResponse.json();
      if (typeof sourceTruthPayload?.sourceTruthAvailable === "boolean") {
        buildTruthSignals.servedSourceTruthAvailable = sourceTruthPayload.sourceTruthAvailable;
      } else {
        buildTruthSignals.servedSourceTruthAvailable = true;
      }
      if (typeof sourceTruthPayload?.sourceDistParityOk === "boolean") {
        buildTruthSignals.sourceDistParityOk = sourceTruthPayload.sourceDistParityOk;
      }
      if (sourceTruthPayload?.runtimeMarker || sourceTruthPayload?.buildTimestamp) {
        servedMarker = sourceTruthPayload.runtimeMarker || servedMarker;
        servedBuildTimestamp = sourceTruthPayload.buildTimestamp || servedBuildTimestamp;
        servedSource = "source-truth";
      }
    }
  } catch {
    // no-op
  }

  console.info("[Launcher Build Truth]", {
    requestedSourceMarker,
    builtMarker,
    servedMarker,
    buildTimestamp,
    servedBuildTimestamp,
    processReuseGuard: servedMarker && builtMarker ? servedMarker === builtMarker : null,
  });
  renderLauncherBuildProof({
    requestedSourceMarker,
    builtMarker,
    servedMarker,
    buildTimestamp,
    servedBuildTimestamp,
    realitySync: realitySyncState,
  });
  buildTruthSignals.requestedSourceMarker = requestedSourceMarker;
  buildTruthSignals.builtMarker = builtMarker;
  buildTruthSignals.servedMarker = servedMarker;
  buildTruthSignals.buildTimestamp = buildTimestamp;
  buildTruthSignals.servedBuildTimestamp = servedBuildTimestamp;
  buildTruthSignals.servedDistTruthAvailable = Boolean(servedMarker || servedBuildTimestamp);
  buildTruthSignals.sourceDistParityOk = builtMarker && servedMarker ? builtMarker === servedMarker : null;
  buildTruthSignals.localhostMirrorDrift = buildTruthSignals.sourceDistParityOk === false;
  buildTruthSignals.paritySnapshot = createBuildParitySnapshot({
    launcher: {
      version: document.querySelector('meta[name="stephanos-version"]')?.getAttribute("content") || "unknown",
      runtimeMarker: requestedSourceMarker,
      buildTimestamp,
      gitCommit: launcherRuntimeFingerprint.commitHash,
      runtimeMode: "launcher-root",
      source: "launcher-shell",
    },
    tile: {
      version: document.querySelector('meta[name="stephanos-version"]')?.getAttribute("content") || "unknown",
      runtimeMarker: builtMarker,
      buildTimestamp,
      gitCommit: launcherRuntimeFingerprint.commitHash,
      runtimeMode: "mission-console-dist",
      source: "dist-metadata",
    },
    served: {
      runtimeMarker: servedMarker,
      buildTimestamp: servedBuildTimestamp,
      gitCommit: servedCommit,
      source: servedSource,
    },
  });
  buildTruthSignals.ignitionRestartRequired = buildTruthSignals.localhostMirrorDrift
    && buildTruthSignals.ignitionRestartSupported
    && realitySyncState.enabled === false;
  if (!buildTruthSignals.servedSourceTruthAvailable) {
    buildTruthSignals.servedSourceTruthAvailable = Boolean(requestedSourceMarker);
  }
  const displayedMarker = servedMarker || builtMarker || requestedSourceMarker || "";
  const displayedTimestamp = servedBuildTimestamp || buildTimestamp || "";
  realitySyncController.updateDisplayedTruth({ marker: displayedMarker, timestamp: displayedTimestamp });
  updateTruthPanel({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
}

window.openSystemPanel = function() {};

window.setPanelState = function(panelId, enabled) {
  const panel = document.getElementById(panelId);
  const container = document.getElementById("stephanos-panel-stack");
  const currentMemory = readPersistedStephanosSessionMemory();
  persistStephanosSessionMemory({
    ...currentMemory,
    session: {
      ...currentMemory.session,
      ui: {
        ...currentMemory.session.ui,
        uiLayout: {
          ...(currentMemory.session.ui?.uiLayout || {}),
          [panelId]: enabled === true,
        },
      },
    },
  });

  if (!panel) return;

  panel.style.display = enabled ? "block" : "none";

  if (!container) return;

  const anyVisible = Array.from(container.children).some(p => p.style.display !== "none");

  container.style.display = anyVisible ? "block" : "none";
};

function initializeStephanosOperatorPanels(uiRenderer) {
  if (!uiRenderer || typeof uiRenderer.createPanel !== "function") {
    return;
  }

  const lawsPanel = uiRenderer.createPanel("stephanos-laws-panel", "Laws of Stephanos");
  const lawsMount = document.getElementById("stephanos-laws-mount");
  if (lawsPanel && lawsMount && lawsMount.parentNode !== lawsPanel) {
    lawsPanel.appendChild(lawsMount);
  }

  const buildPanel = uiRenderer.createPanel("stephanos-build-panel", "Build Proof");
  const buildProofNode = document.getElementById("launcher-build-proof");
  if (buildPanel && buildProofNode && buildProofNode.parentNode !== buildPanel) {
    buildPanel.appendChild(buildProofNode);
  }
}

function restoreOperatorPanelVisibility(persistedLayout = {}) {
  const restorablePanels = new Set([
    "module-manager-panel",
    "agent-console-panel",
    "command-console-panel",
    "task-monitor-panel",
    "dev-console",
    "stephanos-laws-panel",
    "stephanos-build-panel",
  ]);

  restorablePanels.forEach((panelId) => {
    const persisted = persistedLayout[panelId];
    const defaultEnabled = panelId === "stephanos-laws-panel" || panelId === "stephanos-build-panel";
    const enabled = typeof persisted === "boolean" ? persisted : defaultEnabled;
    window.setPanelState(panelId, enabled);
  });
}

window.getStephanosMirrorStatus = function getStephanosMirrorStatus() {
  return {
    localhostMirrorDrift: buildTruthSignals.localhostMirrorDrift === true,
    ignitionRestartRequired: buildTruthSignals.ignitionRestartRequired === true,
    ignitionRestartSupported: buildTruthSignals.ignitionRestartSupported === true,
    lastRestartRequestAt: buildTruthSignals.lastRestartRequestAt || "",
    lastRestartResult: buildTruthSignals.lastRestartResult || "none",
  };
};

window.runRealitySyncCheck = async function runRealitySyncCheck() {
  await realitySyncController.checkNow({ reason: "system-panel-manual-check" });
  await hydrateLauncherBuildProof();
  updateTruthPanel({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
  return realitySyncController.getState();
};

window.requestStephanosIgnitionRestart = async function requestStephanosIgnitionRestart({ source = "operator" } = {}) {
  if (!buildTruthSignals.ignitionRestartSupported) {
    return { ok: false, message: "restart endpoint unavailable" };
  }
  try {
    const response = await fetch("./__stephanos/restart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source,
        reason: "localhost-mirror-drift",
      }),
    });
    if (!response.ok) {
      buildTruthSignals.lastRestartResult = `failed:${response.status}`;
      return { ok: false, message: `restart endpoint returned ${response.status}` };
    }
    const payload = await response.json();
    buildTruthSignals.lastRestartRequestAt = payload?.requestedAt || new Date().toISOString();
    buildTruthSignals.lastRestartResult = payload?.accepted ? "accepted" : "rejected";
    if (payload?.accepted) {
      const statusNode = document.getElementById("system-status-text");
      if (statusNode) {
        statusNode.textContent = "Ignition restart requested; waiting for fresh runtime marker…";
      }
      globalThis.setTimeout(() => {
        globalThis.location?.reload?.();
      }, 1500);
    }
    updateTruthPanel({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
    return { ok: payload?.accepted === true, message: payload?.message || "restart request sent" };
  } catch (error) {
    buildTruthSignals.lastRestartResult = "failed:network";
    return { ok: false, message: error?.message || "restart request failed" };
  }
};

function log(message) {
  const consoleDiv = document.getElementById("dev-console");
  if (!consoleDiv) return;

  const line = document.createElement("div");
  line.textContent = message;
  consoleDiv.appendChild(line);
}

let developerMode = false;
const moduleFailureEvents = [];
let latestTruthSnapshot = null;
const buildTruthSignals = {
  requestedSourceMarker: null,
  builtMarker: null,
  servedMarker: null,
  buildTimestamp: null,
  servedBuildTimestamp: null,
  servedSourceTruthAvailable: false,
  servedDistTruthAvailable: false,
  sourceDistParityOk: null,
  localhostMirrorDrift: false,
  ignitionRestartRequired: false,
  ignitionRestartSupported: false,
  lastRestartRequestAt: "",
  lastRestartResult: "none",
  paritySnapshot: null,
  panelRegistryParity: null,
};
const initialUiLayout = readPersistedStephanosSessionMemory()?.session?.ui?.uiLayout || {};
const launcherSurfaceVisibility = {
  runtimeDiagnosticsVisible: initialUiLayout.runtimeDiagnosticsVisible === true || launcherDiagnostics.enabled,
  launcherRuntimeFingerprintVisible: initialUiLayout.launcherRuntimeFingerprintVisible === true || launcherDiagnostics.enabled,
  truthPanelVisible: initialUiLayout.truthPanelVisible === true,
};

const realitySyncState = {
  enabled: initialUiLayout.realitySyncEnabled !== false,
  displayedMarker: "",
  displayedTimestamp: "",
  latestMarker: "",
  latestTimestamp: "",
  latestSource: "unavailable",
  isStale: false,
  refreshPending: false,
  lastRefreshReason: "",
  lastRefreshAt: "",
  attemptsForCurrentMarker: 0,
};

  const realitySyncController = createRealitySyncController({
  enabled: realitySyncState.enabled,
  onStateChange(nextState) {
    Object.assign(realitySyncState, nextState);
    renderLauncherBuildProof({
      requestedSourceMarker: buildTruthSignals.requestedSourceMarker,
      builtMarker: buildTruthSignals.builtMarker,
      servedMarker: buildTruthSignals.servedMarker,
      buildTimestamp: buildTruthSignals.buildTimestamp,
      servedBuildTimestamp: buildTruthSignals.servedBuildTimestamp,
      realitySync: realitySyncState,
    });
    updateTruthPanel({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
  },
  onRefreshRequest(nextState) {
    Object.assign(realitySyncState, nextState);
    console.info("[Reality Sync] New truth detected. Syncing launcher reality.", nextState);
    const status = document.getElementById("system-status-text");
    if (status) {
      status.textContent = "New build detected. Syncing reality…";
    }
    globalThis.setTimeout(() => {
      globalThis.location?.reload?.();
    }, 900);
  },
});

function refreshPanelRegistryParity() {
  const toggleIds = Array.from(document.querySelectorAll('#stephanos-system-panel input[data-toggle-id]'))
    .map((node) => node.getAttribute('data-toggle-id'))
    .filter(Boolean);
  buildTruthSignals.panelRegistryParity = evaluateToggleRegistryParity(toggleIds);
}

window.setRealitySyncEnabled = function setRealitySyncEnabled(enabled) {
  const currentMemory = readPersistedStephanosSessionMemory();
  const normalizedEnabled = enabled === true;
  persistStephanosSessionMemory({
    ...currentMemory,
    session: {
      ...currentMemory.session,
      ui: {
        ...currentMemory.session.ui,
        uiLayout: {
          ...(currentMemory.session.ui?.uiLayout || {}),
          realitySyncEnabled: normalizedEnabled,
        },
      },
    },
  });
  realitySyncController.setEnabled(normalizedEnabled);
  if (normalizedEnabled) {
    void realitySyncController.checkNow({ reason: "toggle-enabled" });
  }
};

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

  realitySyncController.dispose();
  window.location.reload();
}

function exitStephanos() {
  if (window.__stephanosRuntime?.disposeHealthMonitor) {
    window.__stephanosRuntime.disposeHealthMonitor();
  }

  realitySyncController.dispose();
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
  if (!launcherSurfaceVisibility.runtimeDiagnosticsVisible) {
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
    moduleFailures: moduleFailureEvents.slice(-5),
  };

  const moduleFailureSuffix = diagnostics.moduleFailures.length > 0 ? ` · Module failures: ${diagnostics.moduleFailures.length}` : '';
  const summaryText = `Mode: ${diagnostics.runtimeMode} · Active tile: ${diagnostics.activeTileId || 'none'} · Loaded tiles: ${diagnostics.loadedTileIds.length}${moduleFailureSuffix}`;
  summaryNode.textContent = summaryText;
  if (compactNode) {
    compactNode.textContent = `Runtime status: ${summaryText}`;
  }
  jsonNode.textContent = JSON.stringify(diagnostics, null, 2);
  updateTruthPanel({ projects, workspace });
}


function renderProjectRegistryLocalFallback(projects, context) {
  const container = document.getElementById("project-registry");
  if (!container) {
    return false;
  }

  container.innerHTML = "";
  const safeProjects = Array.isArray(projects) ? projects : [];
  safeProjects.forEach((project) => {
    const tile = document.createElement("div");
    tile.className = "app-tile";
    const icon = project?.icon || "🧩";
    const name = project?.name || "Unnamed Project";
    tile.innerHTML = `<div style="font-size:36px;">${icon}</div><div style="margin-top:8px;">${name}</div>`;

    if (project?.entry) {
      tile.onclick = () => {
        if (context?.workspace?.open) {
          context.workspace.open(project, context);
          return;
        }

        window.location.assign(project.entry);
      };
    } else {
      tile.setAttribute("aria-disabled", "true");
    }

    container.appendChild(tile);
  });

  return container.querySelectorAll(".app-tile").length > 0;
}

function renderTileFirstLauncher(projects, context) {
  renderLauncherProjectRegistry(projects, context, { enableSecondaryStatusSurfaces: false });

  const container = document.getElementById("project-registry");
  const tileCount = container?.querySelectorAll(".app-tile").length || 0;
  const expectedMinimum = Array.isArray(projects) && projects.length > 0 ? 1 : 0;

  if (tileCount >= expectedMinimum) {
    return;
  }

  console.warn("[Launcher Recovery] Shared command-deck renderer did not produce visible tiles; using local fallback renderer.", {
    tileCount,
    projects: Array.isArray(projects) ? projects.length : 0,
  });
  renderProjectRegistryLocalFallback(projects, context);
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
  applyLauncherSurfaceVisibility();
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
  eventBus.on("module:failed", (payload = {}) => {
    const failureRecord = {
      occurredAt: new Date().toISOString(),
      moduleId: payload?.id || payload?.path || "unknown",
      modulePath: payload?.path || "unknown",
      reason: payload?.reason || "Unknown module failure",
      launcherCritical: payload?.launcherCritical === true,
      lawId: payload?.lawId || STEPHANOS_LAW_IDS.UNIVERSAL_ENTRY,
    };
    moduleFailureEvents.push(failureRecord);

    const launcherCriticalLabel = failureRecord.launcherCritical ? "launcher-critical" : "non-critical";
    console.error(`[Launcher Module Failure] ${failureRecord.modulePath} (${launcherCriticalLabel})`, failureRecord);
    if (failureRecord.launcherCritical) {
      console.error(`[Launcher Module Failure] [LAW:${failureRecord.lawId}] Module-load failure detected. This is not an "empty app registry" condition.`);
      log(`❌ Launcher module failed (${failureRecord.modulePath}); tiles may be degraded.`);
      const status = document.getElementById("system-status-text");
      if (status) {
        status.textContent = `Launcher degraded: module load failed (${failureRecord.modulePath})`;
      }
    } else {
      log(`⚠ Module failed to load: ${failureRecord.modulePath}`);
    }
    updateRuntimeDiagnostics({ projects: getRuntimeProjects(window.__stephanosRuntime?.context || {}), workspace: window.__stephanosRuntime?.context?.workspace || null });
  });
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
  renderTileFirstLauncher(projects, fallbackTileContext);
  renderStephanosLawsPanel();
  updateTruthPanel({ projects, workspace: null });

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
    window.resetStephanosPanelLayout = () => uiRenderer.resetPanelLayout();
    const stephanosMemory = createStephanosMemory({
      surface: "launcher-root",
      source: "launcher-runtime",
    });
    const stephanosMemoryGateway = createStephanosMemoryGateway(stephanosMemory, {
      namespace: "continuity",
      source: "launcher-continuity-gateway",
    });
    const stephanosContinuity = createStephanosContinuityService({
      eventBus,
      memoryGateway: stephanosMemoryGateway,
      initialState: {
        session: {
          continuityId: `launcher-${Date.now()}`,
          surfaceMode: "launcher-root",
          routeKind: "launcher",
        },
        environment: {
          activeSurface: "launcher-root",
        },
        workspace: {
          activeWorkspace: "launcher",
        },
      },
      persistEventNames: [
        "tile.opened",
        "tile.closed",
        "tile.result",
        "workspace:opened",
        "workspace:closed",
        "truth.warning",
        "truth.contradiction",
        "law.warning",
        "ai.intent.received",
        "ai.decision.made",
      ],
    });
    const taskQueue = createTaskQueue();

    initializeStephanosOperatorPanels(uiRenderer);
    services.registerService("ui", uiRenderer);
    services.registerService("taskQueue", taskQueue);
    services.registerService("stephanosMemory", stephanosMemory);
    services.registerService("stephanosMemoryGateway", stephanosMemoryGateway);
    services.registerService("stephanosContinuity", stephanosContinuity);
    window.stephanosMemory = stephanosMemory;
    window.stephanosContinuity = stephanosContinuity;
    window.stephanosEvents = eventBus;

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
    renderTileFirstLauncher(projects, context);
    renderStephanosLawsPanel();

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
        renderTileFirstLauncher(getRuntimeProjects(context), context);
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
    const persistedLayout = readPersistedStephanosSessionMemory()?.session?.ui?.uiLayout || {};
    restoreOperatorPanelVisibility(persistedLayout);
    applyLauncherSurfaceVisibility();

    window.__stephanosRuntime = {
      context,
      disposeModules,
      disposeHealthMonitor: startStephanosHealthMonitor(projects, validationContext),
      disposeRealitySync: () => realitySyncController.dispose(),
    };

    window.returnToCommandDeck = function() {
      context.workspace.close(context);
    };

    eventBus.on("workspace:opened", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
    });

    eventBus.on("workspace:closed", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
      renderTileFirstLauncher(getRuntimeProjects(context), context);
    });

    window.addEventListener("storage", () => {
      updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
      renderTileFirstLauncher(getRuntimeProjects(context), context);
    });

    updateRuntimeDiagnostics({ projects: getRuntimeProjects(context), workspace });
    renderTileFirstLauncher(getRuntimeProjects(context), context);
    applyLauncherSurfaceVisibility();
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
  applyLauncherSurfaceVisibility();
  if (launcherDiagnostics.enabled) {
    void hydrateLauncherBuildIdentity();
  }
  realitySyncController.init({
    displayedMarker: buildTruthSignals.servedMarker || buildTruthSignals.builtMarker || buildTruthSignals.requestedSourceMarker || "",
    displayedTimestamp: buildTruthSignals.servedBuildTimestamp || buildTruthSignals.buildTimestamp || "",
    enabled: realitySyncState.enabled,
  });
  void hydrateLauncherBuildProof();
  startStephanos();
});
