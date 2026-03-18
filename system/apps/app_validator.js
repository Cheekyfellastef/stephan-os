import {
  isSupportedPackagingMode,
  resolvePackagingMode,
  validateEntryForPackaging
} from "./entry_rules.js";

const STEPHANOS_APP_ID = "stephanos";
const STEPHANOS_DIST_ENTRY = "apps/stephanos/dist/index.html";
const STEPHANOS_RUNTIME_URL = "http://127.0.0.1:4173/apps/stephanos/dist/";
const STEPHANOS_HEALTH_URL = "http://127.0.0.1:4173/__stephanos/health";
const STEPHANOS_STATUS_URL = "http://127.0.0.1:4173/apps/stephanos/runtime-status.json";
const STEPHANOS_BACKEND_URL = "http://localhost:8787";
const STEPHANOS_BACKEND_HEALTH_URL = "http://localhost:8787/api/health";

function getAppRoot(app) {
  return app?.folder ? `apps/${app.folder}` : "";
}

async function fetchJson(path) {
  const response = await fetch(path);

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

async function fileExists(path) {
  try {
    const response = await fetch(path, { method: "HEAD" });
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

  return ["starting", "building", "starting-backend", "starting-dist", "waiting-runtime"].includes(state);
}

function applyAppStatus(app, nextStatus, context = {}) {
  const previousSnapshot = JSON.stringify({
    disabled: Boolean(app?.disabled),
    validationIssues: Array.isArray(app?.validationIssues) ? app.validationIssues : [],
    validationState: app?.validationState || "unknown",
    statusMessage: app?.statusMessage || ""
  });

  app.disabled = nextStatus.state === "error" || nextStatus.state === "launching";
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
    loaded: apps.filter((app) => !app?.disabled).length,
    invalid: apps.filter((app) => app?.validationState === "error").length,
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

async function validateStephanosRuntime(entryPath) {
  const statusProbe = await fetchJsonSafely(STEPHANOS_STATUS_URL);
  const runtimeProbe = await fetchJsonSafely(STEPHANOS_HEALTH_URL);
  const runtimeReachable = await fileExists(STEPHANOS_RUNTIME_URL);
  const backendProbe = await fetchJsonSafely(STEPHANOS_BACKEND_HEALTH_URL);
  const entryExists = await fileExists(entryPath);
  const launcherMessage =
    statusProbe.ok && typeof statusProbe.json?.message === "string"
      ? statusProbe.json.message
      : runtimeProbe.ok && typeof runtimeProbe.json?.launcherStatus?.message === "string"
        ? runtimeProbe.json.launcherStatus.message
        : "";

  if (!entryExists) {
    if (isLaunchInProgress(statusProbe.json) || isLaunchInProgress(runtimeProbe.json)) {
      return {
        state: "launching",
        message: launcherMessage || "Stephanos is still building locally."
      };
    }

    return {
      state: "error",
      message: `Stephanos build missing: ${STEPHANOS_DIST_ENTRY} not found`,
      issues: [`Stephanos build missing: ${STEPHANOS_DIST_ENTRY} not found`]
    };
  }

  if (!runtimeReachable) {
    if (isLaunchInProgress(statusProbe.json) || isLaunchInProgress(runtimeProbe.json)) {
      return {
        state: "launching",
        message: launcherMessage || `Stephanos is still starting the local runtime at ${STEPHANOS_RUNTIME_URL}`
      };
    }

    return {
      state: "error",
      message: `Stephanos dist server not reachable on ${STEPHANOS_RUNTIME_URL}`,
      issues: [`Stephanos dist server not reachable on ${STEPHANOS_RUNTIME_URL}`]
    };
  }

  if (!backendProbe.ok || backendProbe.json?.service !== "stephanos-server") {
    return {
      state: "error",
      message: `Stephanos backend not reachable on ${STEPHANOS_BACKEND_URL}`,
      issues: [`Stephanos backend not reachable on ${STEPHANOS_BACKEND_URL}`]
    };
  }

  return {
    state: "healthy",
    message: "Stephanos running normally",
    issues: []
  };
}

export async function validateApps(apps, context = {}) {
  const results = [];

  for (const app of apps) {
    if (app?.disabled) {
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

    let entryExists = false;
    if (stephanosApp) {
      entryExists = await fileExists(entryPath);
      if (!entryExists) {
        issues.push(`Stephanos build missing: ${STEPHANOS_DIST_ENTRY} not found`);
      }
    } else {
      entryExists = await validateEntryExists(entryPath, issues);
    }
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
      const stephanosStatus = await validateStephanosRuntime(entryPath);
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
