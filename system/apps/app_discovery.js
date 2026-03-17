const REQUIRED_MANIFEST_FIELDS = ["name", "entry"];
const VALID_DISCOVERY_ID = /^[a-z0-9][a-z0-9-_]*$/i;

function ensureStephanosEntry(apps) {
  return apps;
}

function normaliseManifestApp(folder, manifest) {
  return {
    id: folder,
    folder,
    name: manifest.name,
    icon: manifest.icon || "🧩",
    entry: `apps/${folder}/${manifest.entry}`,
    type: manifest.type || "app",
    packaging: resolvePackagingMode(manifest),
    requiredPaths: Array.isArray(manifest.requiredPaths) ? manifest.requiredPaths : [],
    dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : []
  };
}

function resolvePackagingMode(manifest) {
  const mode = String(manifest?.packaging || "").trim().toLowerCase();

  if (mode) {
    return mode;
  }

  if (String(manifest?.entry || "").toLowerCase().endsWith(".md")) {
    return "document";
  }

  return "classic-static";
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
  const response = await fetch(path);

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

async function validateAppRegistration(folder) {
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
        validationIssues: issues
      }
    };
  }

  const manifest = manifestResult.json;
  const missingFields = hasRequiredManifestFields(manifest);

  if (missingFields.length > 0) {
    issues.push(`${folder}: missing required fields (${missingFields.join(", ")})`);
  }

  let normalisedApp = {
    id: folder,
    folder,
    name: manifest?.name || folder,
    icon: manifest?.icon || "⚠️",
    entry: "",
    type: manifest?.type || "app",
    disabled: true,
    validationIssues: issues
  };

  if (typeof manifest?.entry === "string" && manifest.entry.trim().length > 0) {
    const entryProbe = await fetch(`${appRoot}/${manifest.entry}`);
    if (!entryProbe.ok) {
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
      entry: typeof manifest?.entry === "string" ? `${appRoot.replace("./", "")}/${manifest.entry}` : "",
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
      const issue = `apps/index.json contains invalid app id: ${String(folder)}`;
      discoveryIssues.push(issue);
      context?.eventBus?.emit("app:discovery_issue", { issue });
      continue;
    }

    const validation = await validateAppRegistration(folder);

    discoveredApps.push(validation.app);

    if (!validation.valid) {
      discoveryIssues.push(...validation.issues);

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
