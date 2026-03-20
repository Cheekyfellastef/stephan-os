import {
  isSupportedPackagingMode,
  resolvePackagingMode,
  validateEntryForPackaging
} from "./entry_rules.js";
import {
  createRuntimeStatusModel,
  readPersistedProviderPreferences,
} from "../../shared/runtime/runtimeStatusModel.mjs";

const STEPHANOS_APP_ID = "stephanos";
const STEPHANOS_DIST_ENTRY = "apps/stephanos/dist/index.html";
const STEPHANOS_RUNTIME_URL = "http://127.0.0.1:4173/apps/stephanos/dist/";
const STEPHANOS_HEALTH_URL = "http://127.0.0.1:4173/__stephanos/health";
const STEPHANOS_STATUS_URL = "./apps/stephanos/runtime-status.json";
const STEPHANOS_BACKEND_URL = "http://localhost:8787";
const STEPHANOS_BACKEND_HEALTH_URL = "http://localhost:8787/api/health";
const STEPHANOS_PROVIDER_HEALTH_URL = "http://localhost:8787/api/ai/providers/health";

function getAppRoot(app) {
  return app?.folder ? `apps/${app.folder}` : "";
}

function normalizeRuntimePath(path) {
  const value = String(path || "").trim();

  if (!value) {
    return "";
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return value.replace(/^\.?\//, "");
}

function toFetchPath(path) {
  const normalized = normalizeRuntimePath(path);

  if (!normalized) {
    return "";
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `./${normalized}`;
}

async function fetchJson(path) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const raw = await response.text();

  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, parseError: true };
  }
}

async function fetchJsonSafely(path) {
  try {
    return await fetchJson(path);
  } catch {
    return { ok: false, networkError: true };
  }
}

async function postJsonSafely(path, body) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    const raw = await response.text();

    try {
      return { ok: true, json: JSON.parse(raw) };
    } catch {
      return { ok: false, parseError: true };
    }
  } catch {
    return { ok: false, networkError: true };
  }
}

async function fileExists(path) {
  try {
    const response = await fetch(path, {
      method: "HEAD",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

function extractLocalHtmlReferences(html) {
  const refs = new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const candidate = String(match[1] || "").trim();

      if (!candidate) {
        continue;
      }

      if (/^(https?:|data:|blob:|#)/i.test(candidate)) {
        continue;
      }

      refs.add(candidate);
    }
  }

  return Array.from(refs);
}

function toRuntimePath(basePath, ref) {
  const cleaned = String(ref || "").trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.startsWith("./")) {
    return `${basePath}/${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith("../")) {
    return `${basePath}/${cleaned}`;
  }

  if (cleaned.startsWith("/")) {
    return cleaned.slice(1);
  }

  return `${basePath}/${cleaned}`;
}

function resolveManifestPath(app, manifest) {
  const appRoot = getAppRoot(app);
  const entryInManifest = String(manifest?.entry || "").trim();

  if (!appRoot || !entryInManifest) {
    return "";
  }

  return `${appRoot}/${entryInManifest}`;
}

function emitDiagnostic(context, message) {
  context?.eventBus?.emit("app:diagnostic", { message });
}

function emitStephanosValidationLog(context, details = {}) {
  const message = [
    `[VALIDATOR LIVE] manifest entry=${details.manifestEntry || "(missing)"}`,
    `resolved file path=${details.resolvedEntryPath || "(missing)"}`,
    `file exists=${details.entryExists === true ? "yes" : "no"}`,
    `runtime-status path=${details.runtimeStatusPath || STEPHANOS_STATUS_URL}`,
    `runtime URL=${details.runtimeUrl || STEPHANOS_RUNTIME_URL}`,
    `runtime reachable=${details.runtimeReachable === true ? "yes" : "no"}`,
    `backend status=${details.backendStatus || "unknown"}`,
    `static server status=${details.staticServerStatus || "unknown"}`,
    `launcher state=${details.launcherState || "(unknown)"}`,
    `stale state cleared=${details.staleStateCleared === true ? "yes" : "no"}`,
    `discoveryDisabled=${details.discoveryDisabled === true ? "yes" : "no"}`,
    `disabled=${details.disabled === true ? "yes" : "no"}`,
    `reason=${details.reason || "(not-yet-determined)"}`,
    `runtime marker=${details.runtimeMarker || "(missing)"}`,
    `git commit=${details.gitCommit || "(missing)"}`,
    `build timestamp=${details.buildTimestamp || "(missing)"}`
  ].join(", ");

  console.log(message);
  emitDiagnostic(context, message);
}

function isStephanosApp(app) {
  const identifier = String(app?.folder || app?.id || app?.name || "").trim().toLowerCase();
  return identifier === STEPHANOS_APP_ID || identifier === "stephanos os";
}

function isLaunchInProgress(statusPayload) {
  const state = String(
    statusPayload?.state ||
      statusPayload?.launcherStatus?.state ||
      ""
  )
    .trim()
    .toLowerCase();

  return [
    "starting",
    "checking-repo",
    "updating",
    "building",
    "verifying-build",
    "starting-backend",
    "starting-dist",
    "waiting-runtime",
    "waiting-ready"
  ].includes(state);
}

function getSubsystemState(statusPayload, key) {
  return String(statusPayload?.subsystems?.[key]?.state || "")
    .trim()
    .toLowerCase();
}

function applyAppStatus(app, nextStatus, context = {}) {
  const previousSnapshot = JSON.stringify({
    disabled: Boolean(app?.disabled),
    validationIssues: Array.isArray(app?.validationIssues) ? app.validationIssues : [],
    validationState: app?.validationState || "unknown",
    statusMessage: app?.statusMessage || ""
  });

  app.disabled = Boolean(app?.discoveryDisabled);
  app.validationState = nextStatus.state;
  app.statusMessage = nextStatus.message;
  app.validationIssues = Array.isArray(nextStatus.issues) ? nextStatus.issues : [];

  const nextSnapshot = JSON.stringify({
    disabled: Boolean(app?.disabled),
    validationIssues: Array.isArray(app?.validationIssues) ? app.validationIssues : [],
    validationState: app?.validationState || "unknown",
    statusMessage: app?.statusMessage || ""
  });

  if (previousSnapshot !== nextSnapshot) {
    context?.eventBus?.emit("app:status_changed", {
      name: app?.name,
      folder: app?.folder,
      entry: app?.entry,
      disabled: app?.disabled,
      validationState: app?.validationState,
      validationIssues: app?.validationIssues,
      statusMessage: app?.statusMessage
    });
  }
}

function syncValidationReport(apps, context = {}) {
  const report = {
    total: apps.length,
    loaded: apps.filter((app) => !app?.discoveryDisabled).length,
    invalid: apps.filter((app) => app?.discoveryDisabled || app?.validationState === "error").length,
    launching: apps.filter((app) => app?.validationState === "launching").length,
    issues: apps
      .filter((app) => Array.isArray(app?.validationIssues) && app.validationIssues.length > 0)
      .map((app) => app.validationIssues[0])
  };

  context?.systemState?.set?.("appValidationReport", report);
  context?.eventBus?.emit("app:validation_report_updated", report);
  return report;
}

async function validateAppManifest(app, issues) {
  const appRoot = getAppRoot(app);

  if (!appRoot) {
    issues.push("Missing app folder metadata");
    return null;
  }

  const manifestResult = await fetchJson(`${appRoot}/app.json`);

  if (!manifestResult.ok) {
    issues.push(manifestResult.parseError ? "Invalid app.json" : "Missing app.json");
    return null;
  }

  const manifest = manifestResult.json;

  if (typeof manifest?.name !== "string" || manifest.name.trim().length === 0) {
    issues.push("app.json missing required field: name");
  }

  if (typeof manifest?.entry !== "string" || manifest.entry.trim().length === 0) {
    issues.push("app.json missing required field: entry");
  }

  return manifest;
}

async function validateEntryExists(path, issues) {
  if (!path) {
    issues.push("Entry file is not defined");
    return false;
  }

  const exists = await fileExists(path);

  if (!exists) {
    issues.push(`Entry file not found: ${path}`);
  }

  return exists;
}

async function validateHtmlReferences(basePath, html, issues, label) {
  const refs = extractLocalHtmlReferences(html);

  for (const ref of refs) {
    const absolute = toRuntimePath(basePath, ref);
    const exists = await fileExists(absolute);

    if (!exists) {
      issues.push(`${label} missing referenced asset: ${ref}`);
    }
  }
}

async function validateViteApp(entryPath, issues) {
  const response = await fetch(entryPath);

  if (!response.ok) {
    issues.push(`Unable to read Vite entry HTML: ${entryPath}`);
    return;
  }

  const html = await response.text();
  const entryFolder = entryPath.split("/").slice(0, -1).join("/");
  await validateHtmlReferences(entryFolder, html, issues, "Vite app");
}

async function validateClassicStaticApp(appRoot, entryPath, manifest, issues) {
  const requiredPaths = Array.isArray(manifest?.requiredPaths)
    ? manifest.requiredPaths.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  for (const requiredPath of requiredPaths) {
    const exists = await fileExists(`${appRoot}/${requiredPath}`);

    if (!exists) {
      issues.push(`Missing required path: ${requiredPath}`);
    }
  }

  if (!entryPath.endsWith(".html")) {
    return;
  }

  const response = await fetch(entryPath);

  if (!response.ok) {
    return;
  }

  const html = await response.text();
  const entryFolder = entryPath.split("/").slice(0, -1).join("/");
  await validateHtmlReferences(entryFolder, html, issues, "Classic app");
}

async function validateStephanosRuntime(entryPath, context = {}, options = {}) {
  const statusProbe = await fetchJsonSafely(STEPHANOS_STATUS_URL);
  const runtimeProbe = await fetchJsonSafely(STEPHANOS_HEALTH_URL);
  const backendProbe = await fetchJsonSafely(STEPHANOS_BACKEND_HEALTH_URL);
  const launcherStatus = statusProbe.ok ? statusProbe.json : runtimeProbe.ok ? runtimeProbe.json?.launcherStatus : null;
  const launcherState = String(launcherStatus?.state || statusProbe.json?.state || runtimeProbe.json?.state || "")
    .trim()
    .toLowerCase();
  const runtimeUrl = String(
    statusProbe.ok && statusProbe.json?.runtimeUrl
      ? statusProbe.json.runtimeUrl
      : runtimeProbe.ok && runtimeProbe.json?.runtimeUrl
        ? runtimeProbe.json.runtimeUrl
        : STEPHANOS_RUNTIME_URL
  ).trim() || STEPHANOS_RUNTIME_URL;
  const resolvedEntryPath = normalizeRuntimePath(
    statusProbe.ok && statusProbe.json?.distEntryPath
      ? statusProbe.json.distEntryPath
      : runtimeProbe.ok && runtimeProbe.json?.distEntryPath
        ? runtimeProbe.json.distEntryPath
        : entryPath || STEPHANOS_DIST_ENTRY
  ) || STEPHANOS_DIST_ENTRY;
  const launcherMessage =
    typeof launcherStatus?.message === "string" && launcherStatus.message.trim().length > 0
      ? launcherStatus.message.trim()
      : runtimeProbe.ok && typeof runtimeProbe.json?.launcherStatus?.message === "string"
        ? runtimeProbe.json.launcherStatus.message.trim()
        : "";
  const buildState = getSubsystemState(launcherStatus, "build");
  const uiState = getSubsystemState(launcherStatus, "ui");
  const backendState = getSubsystemState(launcherStatus, "backend");
  const ollamaState = getSubsystemState(launcherStatus, "ollama");
  const entryExists = await fileExists(toFetchPath(resolvedEntryPath));
  const runtimeReachable = await fileExists(runtimeUrl);
  const healthyRuntime =
    runtimeProbe.ok &&
    runtimeProbe.json?.service === "stephanos-dist-server" &&
    runtimeProbe.json?.distEntryExists === true &&
    runtimeReachable;
  const healthyBackend = backendProbe.ok && backendProbe.json?.service === "stephanos-server";
  const launchInProgress = isLaunchInProgress(launcherStatus) || isLaunchInProgress(runtimeProbe.ok ? runtimeProbe.json : null);
  const launchableRuntime = entryExists && runtimeReachable && healthyRuntime;
  const staleStateCleared = Boolean(
    launchableRuntime && (options.previousValidationState === "error" || launcherState === "error")
  );
  let validationReason = "validator still evaluating failure branch";

  if (launchableRuntime) {
    validationReason = healthyBackend
      ? "validator observed launchable runtime with backend online"
      : "validator observed launchable runtime while backend dependencies are degraded";
  } else if (!entryExists) {
    validationReason = launchInProgress || buildState === "building" || buildState === "verifying-build"
      ? "entry missing while launcher/build still in progress"
      : `entry missing at ${resolvedEntryPath}`;
  } else if (!healthyRuntime) {
    validationReason = launchInProgress || uiState === "starting" || uiState === "waiting-runtime"
      ? `runtime still starting at ${runtimeUrl}`
      : `runtime not reachable at ${runtimeUrl}`;
  }

  const providerPreferences = readPersistedProviderPreferences();
  const providerHealthProbe = healthyBackend
    ? await postJsonSafely(STEPHANOS_PROVIDER_HEALTH_URL, {
      provider: providerPreferences.selectedProvider,
      fallbackEnabled: providerPreferences.fallbackEnabled,
      fallbackOrder: providerPreferences.fallbackOrder,
    })
    : { ok: false };
  const providerHealth = providerHealthProbe.ok ? providerHealthProbe.json?.data || {} : {};
  const runtimeStatusModel = createRuntimeStatusModel({
    appId: "stephanos",
    appName: "Stephanos OS",
    validationState: launchableRuntime ? "healthy" : (launchInProgress ? "launching" : "error"),
    selectedProvider: providerPreferences.selectedProvider,
    fallbackEnabled: providerPreferences.fallbackEnabled,
    fallbackOrder: providerPreferences.fallbackOrder,
    providerHealth,
    backendAvailable: healthyBackend,
    preferAuto: typeof window !== "undefined" ? window.innerWidth <= 820 : false,
  });

  emitStephanosValidationLog(context, {
    manifestEntry: String(options.manifestEntry || "").trim(),
    resolvedEntryPath,
    entryExists,
    runtimeStatusPath: STEPHANOS_STATUS_URL,
    runtimeUrl,
    runtimeReachable,
    backendStatus: healthyBackend ? "up" : backendState || "down",
    staticServerStatus: healthyRuntime ? "up" : uiState || "down",
    launcherState,
    cacheBypassed: true,
    staleStateCleared,
    discoveryDisabled: Boolean(options.discoveryDisabled),
    disabled: Boolean(options.disabled),
    runtimeMarker: launcherStatus?.runtimeMarker || runtimeProbe.json?.runtimeMarker || null,
    gitCommit: launcherStatus?.gitCommit || runtimeProbe.json?.gitCommit || null,
    buildTimestamp: launcherStatus?.buildTimestamp || runtimeProbe.json?.buildTimestamp || null,
    reason: `${validationReason}; provider=${runtimeStatusModel.selectedProvider}; launch_state=${runtimeStatusModel.appLaunchState}; dependency=${runtimeStatusModel.dependencySummary}`
  });

  if (launchableRuntime) {
    const healthyMessage = healthyBackend
      ? runtimeStatusModel.dependencySummary
      : `Launcher ready · ${runtimeStatusModel.dependencySummary.toLowerCase()}`;

    return {
      state: "healthy",
      message: launcherState === "ready" && launcherMessage ? launcherMessage : healthyMessage,
      issues: [],
      runtimeStatusModel,
      dependencyState: runtimeStatusModel.appLaunchState,
      providerHealth,
    };
  }

  if (!entryExists) {
    if (launchInProgress || buildState === "building" || buildState === "verifying-build") {
      return {
        state: "launching",
        message: launcherMessage || "Stephanos is still building locally.",
        runtimeStatusModel,
        dependencyState: "degraded",
        providerHealth,
      };
    }

    return {
      state: "error",
      message: `Stephanos build missing: ${resolvedEntryPath} not found`,
      issues: [`Stephanos build missing: ${resolvedEntryPath} not found`],
      runtimeStatusModel,
      dependencyState: "unavailable",
      providerHealth,
    };
  }

  if (!healthyRuntime) {
    if (launchInProgress || uiState === "starting" || uiState === "waiting-runtime") {
      return {
        state: "launching",
        message: launcherMessage || `Stephanos is still starting the local runtime at ${runtimeUrl}`,
        runtimeStatusModel,
        dependencyState: "degraded",
        providerHealth,
      };
    }

    return {
      state: "error",
      message: `Stephanos dist server not reachable on ${runtimeUrl}`,
      issues: [`Stephanos dist server not reachable on ${runtimeUrl}`],
      runtimeStatusModel,
      dependencyState: "unavailable",
      providerHealth,
    };
  }

  return {
    state: "launching",
    message: launcherMessage || "Stephanos is still starting locally.",
    issues: [],
    runtimeStatusModel,
    dependencyState: "degraded",
    providerHealth,
  };
}

export async function validateApps(apps, context = {}) {
  const results = [];

  for (const app of apps) {
    if (app?.discoveryDisabled) {
      continue;
    }

    const issues = [];
    const appRoot = getAppRoot(app);
    const manifest = await validateAppManifest(app, issues);

    if (!manifest) {
      results.push({ app: app?.name || app?.id || "unknown", issues });
      continue;
    }

    const entryPath = resolveManifestPath(app, manifest) || app?.entry || "";
    const packaging = resolvePackagingMode({ app, manifest });
    const packagingValidation = validateEntryForPackaging({ packaging, entry: manifest?.entry });
    const stephanosApp = isStephanosApp(app);

    if (!packagingValidation.ok) {
      issues.push(packagingValidation.message);
    }

    const entryExists = stephanosApp ? Boolean(entryPath) : await validateEntryExists(entryPath, issues);
    const packagingSupported = isSupportedPackagingMode(packaging);

    if (!packagingSupported && packagingValidation.code !== "unsupported-packaging") {
      issues.push(`Unsupported packaging mode: ${packaging}`);
    } else if (packagingSupported && entryExists && !stephanosApp) {
      if (packaging === "vite") {
        await validateViteApp(entryPath, issues);
      }

      if (packaging === "classic-static") {
        await validateClassicStaticApp(appRoot, entryPath, manifest, issues);
      }
    }

    const appId = String(app?.folder || app?.id || app?.name || "unknown").toLowerCase();

    if (stephanosApp && packagingSupported) {
      const previousValidationState = app?.validationState || "unknown";
      const stephanosStatus = await validateStephanosRuntime(entryPath, context, {
        manifestEntry: manifest?.entry,
        previousValidationState,
        discoveryDisabled: app?.discoveryDisabled,
        disabled: app?.disabled
      });

      app.runtimeStatusModel = stephanosStatus.runtimeStatusModel || null;
      app.providerHealth = stephanosStatus.providerHealth || {};
      app.dependencyState = stephanosStatus.dependencyState || stephanosStatus.runtimeStatusModel?.appLaunchState || 'ready';

      if (previousValidationState === "error" && stephanosStatus.state !== "error") {
        emitDiagnostic(context, "stephanos validation: cleared stale failure state after successful revalidation");
      }

      if (stephanosStatus.state === "healthy") {
        applyAppStatus(app, stephanosStatus, context);
        emitDiagnostic(context, `${appId}: ${stephanosStatus.message}`);
        context?.eventBus?.emit("app:validation_passed", {
          name: app?.name,
          folder: app?.folder,
          entry: entryPath,
          message: stephanosStatus.message
        });
        continue;
      }

      applyAppStatus(app, stephanosStatus, context);

      if (stephanosStatus.state === "launching") {
        emitStephanosValidationLog(context, {
          manifestEntry: manifest?.entry,
          resolvedEntryPath: entryPath,
          entryExists: true,
          runtimeStatusPath: STEPHANOS_STATUS_URL,
          runtimeUrl: STEPHANOS_RUNTIME_URL,
          runtimeReachable: false,
          backendStatus: "starting",
          staticServerStatus: "starting",
          launcherState: "launching",
          staleStateCleared: false,
          discoveryDisabled: Boolean(app?.discoveryDisabled),
          disabled: Boolean(app?.disabled),
          reason: stephanosStatus.message
        });
        emitDiagnostic(context, `${appId}: ${stephanosStatus.message}`);
        continue;
      }

      const stephanosIssues = stephanosStatus.issues || [];
      context?.eventBus?.emit("app:validation_failed", {
        name: app?.name,
        folder: app?.folder,
        entry: entryPath,
        issues: stephanosIssues
      });
      emitDiagnostic(context, `${appId}: ${stephanosIssues[0]}`);
      emitStephanosValidationLog(context, {
        manifestEntry: manifest?.entry,
        resolvedEntryPath: entryPath,
        entryExists: true,
        runtimeStatusPath: STEPHANOS_STATUS_URL,
        runtimeUrl: STEPHANOS_RUNTIME_URL,
        runtimeReachable: false,
        backendStatus: "down",
        staticServerStatus: "down",
        launcherState: "error",
        staleStateCleared: false,
        discoveryDisabled: Boolean(app?.discoveryDisabled),
        disabled: Boolean(app?.disabled),
        reason: stephanosIssues[0]
      });
      results.push({
        app: app.name,
        issues: stephanosIssues
      });
      continue;
    }

    if (issues.length > 0) {
      applyAppStatus(app, {
        state: "error",
        message: issues[0] || "App failed validation",
        issues
      }, context);

      context?.eventBus?.emit("app:validation_failed", {
        name: app?.name,
        folder: app?.folder,
        entry: entryPath,
        issues
      });

      emitDiagnostic(context, `${appId}: ${issues[0]}`);

      results.push({
        app: app.name,
        issues
      });

      continue;
    }

    applyAppStatus(app, {
      state: "healthy",
      message: "App ready",
      issues: []
    }, context);

    context?.eventBus?.emit("app:validation_passed", {
      name: app?.name,
      folder: app?.folder,
      entry: entryPath,
      message: "App ready"
    });

    emitDiagnostic(context, `${appId}: valid ${packaging === "classic-static" ? "classic" : packaging} app`);
  }

  syncValidationReport(apps, context);
  return results;
}
