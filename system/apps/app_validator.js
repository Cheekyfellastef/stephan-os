const VALID_PACKAGING_MODES = new Set(["classic-static", "vite", "document"]);

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

function resolveManifestPath(app, manifest) {
  const appRoot = getAppRoot(app);
  const entryInManifest = String(manifest?.entry || "").trim();

  if (!appRoot || !entryInManifest) {
    return "";
  }

  return `${appRoot}/${entryInManifest}`;
}

function resolvePackagingMode(app, manifest) {
  const declared = String(manifest?.packaging || app?.packaging || "").trim().toLowerCase();

  if (declared) {
    return declared;
  }

  const entry = String(manifest?.entry || app?.entry || "").toLowerCase();

  if (entry.endsWith(".md")) {
    return "document";
  }

  return "classic-static";
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
    const cleaned = ref.replace(/^\//, "");
    const absolute = `${basePath}/${cleaned}`;
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
    const entryExists = await validateEntryExists(entryPath, issues);
    const packaging = resolvePackagingMode(app, manifest);

    if (!VALID_PACKAGING_MODES.has(packaging)) {
      issues.push(`Unsupported packaging mode: ${packaging}`);
    } else if (entryExists) {
      if (packaging === "vite") {
        await validateViteApp(entryPath, issues);
      }

      if (packaging === "classic-static") {
        await validateClassicStaticApp(appRoot, entryPath, manifest, issues);
      }
    }

    if (issues.length > 0) {
      context?.eventBus?.emit("app:validation_failed", {
        name: app?.name,
        folder: app?.folder,
        entry: entryPath,
        issues
      });

      results.push({
        app: app.name,
        issues
      });
    }
  }

  return results;
}
