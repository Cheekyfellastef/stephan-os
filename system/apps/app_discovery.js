const REQUIRED_MANIFEST_FIELDS = ["name", "entry"];
const VALID_DISCOVERY_ID = /^[a-z0-9][a-z0-9-_]*$/i;
const VALID_PACKAGING_MODES = new Set(["classic", "classic-static", "vite", "document"]);
const STEPHANOS_APP_ID = "stephanos";

function ensureStephanosEntry(apps) {
  const stephanosIndex = apps.findIndex((app) => isStephanosFolder(app?.folder || app?.id || app?.name));
  const fallbackStephanos = {
    id: STEPHANOS_APP_ID,
    folder: STEPHANOS_APP_ID,
    name: "Stephanos OS",
    icon: "🧠",
    entry: "apps/stephanos/dist/index.html",
    type: "system",
    appType: "vite",
    packaging: "vite",
    disabled: false,
    discoveryDisabled: false,
    validationState: "unknown",
    statusMessage: "Checking Stephanos local runtime.",
    requiredPaths: [],
    dependencies: [],
    validationIssues: []
  };

  if (stephanosIndex === -1) {
    apps.push(fallbackStephanos);
    return apps;
  }

  const existingStephanos = apps[stephanosIndex] || {};
  if (existingStephanos.discoveryDisabled || existingStephanos.disabled) {
    apps[stephanosIndex] = {
      ...fallbackStephanos,
      ...existingStephanos,
      disabled: false,
      discoveryDisabled: false,
      validationState: existingStephanos.validationState || "unknown",
      statusMessage: existingStephanos.statusMessage || fallbackStephanos.statusMessage,
      validationIssues: Array.isArray(existingStephanos.validationIssues) ? existingStephanos.validationIssues : []
    };
  }

  return apps;
}

function isStephanosFolder(folder) {
  return String(folder || "").trim().toLowerCase() === STEPHANOS_APP_ID;
}

function resolveManifestEntryPath(folder, manifest) {
  const entry = String(manifest?.entry || "").trim();

  if (!entry) {
    return "";
  }

  return `apps/${folder}/${entry}`;
}

function normaliseManifestApp(folder, manifest) {
  const packaging = resolvePackagingMode(manifest);
  const participation = manifest?.participation && typeof manifest.participation === "object" ? manifest.participation : {};

  return {
    id: folder,
    folder,
    name: manifest.name,
    icon: manifest.icon || "🧩",
    entry: `apps/${folder}/${manifest.entry}`,
    type: manifest.type || "app",
    appType: packaging,
    packaging,
    disabled: false,
    discoveryDisabled: false,
    validationState: "unknown",
    statusMessage: "",
    requiredPaths: Array.isArray(manifest.requiredPaths) ? manifest.requiredPaths : [],
    dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : [],
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
    eventsPublished: Array.isArray(manifest.eventsPublished) ? manifest.eventsPublished : [],
    eventsConsumed: Array.isArray(manifest.eventsConsumed) ? manifest.eventsConsumed : [],
    memoryUsage: typeof manifest.memoryUsage === "string" ? manifest.memoryUsage : "none-declared",
    continuityParticipation: typeof manifest.continuityParticipation === "string" ? manifest.continuityParticipation : "none-declared",
    aiAddressable: manifest.aiAddressable === true,
    participation,
    launcherDescription: typeof manifest.description === "string" ? manifest.description : "",
    launcherBadges: Array.isArray(manifest.launcherBadges) ? manifest.launcherBadges : [],
    launcherActionLabel: typeof manifest.launcherActionLabel === "string" ? manifest.launcherActionLabel : "",
  };
}

function resolvePackagingMode(manifest) {
  const mode = String(manifest?.packaging || manifest?.appType || "").trim().toLowerCase();

  if (mode) {
    if (mode === "classic") {
      return "classic-static";
    }

    return mode;
  }

  if (String(manifest?.entry || "").toLowerCase().endsWith(".md")) {
    return "document";
  }

  return "classic-static";
}

function emitDiagnostic(context, message) {
  context?.eventBus?.emit("app:diagnostic", { message });
}

function emitLiveDiscoveryLog(context, details = {}) {
  const message = [
    `[VALIDATOR LIVE] discovery app=${details.appId || "(unknown)"}`,
    `manifest entry=${details.manifestEntry || "(missing)"}`,
    `resolved entry path=${details.resolvedEntryPath || "(missing)"}`,
    `entry exists=${details.entryExists === true ? "yes" : "no"}`,
    `discoveryDisabled=${details.discoveryDisabled === true ? "yes" : "no"}`,
    `disabled=${details.disabled === true ? "yes" : "no"}`,
    `reason=${details.reason || "(none)"}`
  ].join(", ");

  console.log(message);
  emitDiagnostic(context, message);
}

function isValidDiscoveryFolderName(entry) {
  return typeof entry === "string" && VALID_DISCOVERY_ID.test(entry.trim());
}

function hasRequiredManifestFields(manifest) {
  return REQUIRED_MANIFEST_FIELDS.filter((field) => {
    const value = manifest?.[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function looksLikeIconFile(icon) {
  if (typeof icon !== "string") {
    return false;
  }

  return /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(icon) || icon.includes("/");
}

async function fetchJsonSafely(path) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      statusText: response.statusText,
      raw: ""
    };
  }

  const raw = await response.text();

  try {
    return {
      ok: true,
      json: JSON.parse(raw),
      raw
    };
  } catch {
    return {
      ok: false,
      parseError: true,
      raw
    };
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

async function validateAppRegistration(folder, context = {}) {
  const issues = [];
  const appRoot = `./apps/${folder}`;
  const manifestPath = `${appRoot}/app.json`;
  const manifestResult = await fetchJsonSafely(manifestPath);

  if (!manifestResult.ok) {
    if (manifestResult.parseError) {
      issues.push(`${folder}: invalid JSON in app.json`);
    } else {
      const folderProbe = await fetch(`${appRoot}/`);
      if (!folderProbe.ok) {
        issues.push(`${folder}: app folder not found`);
      } else {
        issues.push(`${folder}: missing app.json`);
      }
    }

    return {
      valid: false,
      folder,
      issues,
      app: {
        id: folder,
        folder,
        name: folder,
        icon: "⚠️",
        entry: "",
        type: "app",
        disabled: true,
        discoveryDisabled: true,
        validationState: "error",
        statusMessage: issues[0] || "App failed discovery",
        validationIssues: issues
      }
    };
  }

  const manifest = manifestResult.json;
  const missingFields = hasRequiredManifestFields(manifest);
  const packaging = resolvePackagingMode(manifest);

  if (missingFields.length > 0) {
    issues.push(`${folder}: missing required fields (${missingFields.join(", ")})`);
  }

  if (!VALID_PACKAGING_MODES.has(packaging)) {
    issues.push(`${folder}: unsupported app packaging '${packaging}'`);
  }

  let normalisedApp = {
    id: folder,
    folder,
    name: manifest?.name || folder,
    icon: manifest?.icon || "⚠️",
    entry: "",
    type: manifest?.type || "app",
    disabled: true,
    discoveryDisabled: true,
    validationState: "error",
    statusMessage: issues[0] || "App failed discovery",
    validationIssues: issues,
    capabilities: Array.isArray(manifest?.capabilities) ? manifest.capabilities : [],
    eventsPublished: Array.isArray(manifest?.eventsPublished) ? manifest.eventsPublished : [],
    eventsConsumed: Array.isArray(manifest?.eventsConsumed) ? manifest.eventsConsumed : [],
    memoryUsage: typeof manifest?.memoryUsage === "string" ? manifest.memoryUsage : "none-declared",
    continuityParticipation: typeof manifest?.continuityParticipation === "string" ? manifest.continuityParticipation : "none-declared",
    aiAddressable: manifest?.aiAddressable === true,
    participation: manifest?.participation && typeof manifest.participation === "object" ? manifest.participation : {},
  };

  const entryPath = resolveManifestEntryPath(folder, manifest);
  const entryExists = entryPath ? await fileExists(`./${entryPath}`) : false;

  if (isStephanosFolder(folder)) {
    emitLiveDiscoveryLog(context, {
      appId: folder,
      manifestEntry: String(manifest?.entry || "").trim(),
      resolvedEntryPath: entryPath,
      entryExists,
      discoveryDisabled: false,
      disabled: false,
      reason: "initial manifest discovery"
    });
  }

  if (typeof manifest?.entry === "string" && manifest.entry.trim().length > 0 && !entryExists) {
    if (isStephanosFolder(folder)) {
      emitLiveDiscoveryLog(context, {
        appId: folder,
        manifestEntry: String(manifest?.entry || "").trim(),
        resolvedEntryPath: entryPath,
        entryExists,
        discoveryDisabled: false,
        disabled: false,
        reason: `deferring missing entry check to validator/runtime-status for ${entryPath || manifest.entry}`
      });
    } else {
      issues.push(`${folder}: entry file ${manifest.entry} not found`);
    }
  }

  if (looksLikeIconFile(manifest?.icon)) {
    const iconProbe = await fetch(`${appRoot}/${manifest.icon}`);

    if (!iconProbe.ok) {
      issues.push(`${folder}: icon file ${manifest.icon} not found`);
    }
  }

  if (issues.length === 0) {
    normalisedApp = normaliseManifestApp(folder, manifest);
    return {
      valid: true,
      folder,
      app: normalisedApp,
      issues: []
    };
  }

  return {
    valid: false,
    folder,
    app: {
      ...normalisedApp,
      icon: manifest?.icon || "⚠️",
      entry: entryPath || (typeof manifest?.entry === "string" ? `${appRoot.replace("./", "")}/${manifest.entry}` : ""),
      validationState: "error",
      statusMessage: issues[0] || "App failed discovery",
      validationIssues: issues
    },
    issues
  };
}

export async function discoverApps(context = {}) {
  const discoveredApps = [];
  const discoveryIssues = [];

  const indexResult = await fetchJsonSafely("./apps/index.json");

  if (!indexResult.ok || !Array.isArray(indexResult.json)) {
    const issue = indexResult.parseError
      ? "apps/index.json is invalid JSON"
      : "apps/index.json missing or malformed";

    discoveryIssues.push(issue);
    context?.eventBus?.emit("app:discovery_issue", { issue });

    ensureStephanosEntry(discoveredApps);

    return {
      apps: discoveredApps,
      validationReport: {
        total: 0,
        loaded: discoveredApps.length,
        invalid: 0,
        issues: discoveryIssues
      }
    };
  }

  for (const folder of indexResult.json) {
    if (!isValidDiscoveryFolderName(folder)) {
      const issue = `${String(folder).toLowerCase()}: skipped, not an app folder`;
      discoveryIssues.push(issue);
      context?.eventBus?.emit("app:discovery_issue", { issue });
      emitDiagnostic(context, issue);
      continue;
    }

    const validation = await validateAppRegistration(folder, context);

    discoveredApps.push(validation.app);

    if (!validation.valid) {
      discoveryIssues.push(...validation.issues);

      for (const issue of validation.issues) {
        emitDiagnostic(context, issue);
      }

      context?.eventBus?.emit("app:validation_failed", {
        name: validation.app?.name || folder,
        folder,
        entry: validation.app?.entry,
        issues: validation.issues,
        phase: "discovery"
      });
    }
  }

  ensureStephanosEntry(discoveredApps);

  const validationReport = {
    total: indexResult.json.length,
    loaded: discoveredApps.filter((app) => !app?.disabled).length,
    invalid: discoveredApps.filter((app) => app?.disabled).length,
    issues: discoveryIssues
  };

  context?.eventBus?.emit("app:discovery_complete", validationReport);

  return {
    apps: discoveredApps,
    validationReport
  };
}
