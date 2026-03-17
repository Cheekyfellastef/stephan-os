export async function validateApps(apps, context = {}) {
  const results = [];

  for (const app of apps) {
    const issues = [];

    try {
      const res = await fetch(app.entry);

      if (!res.ok) {
        issues.push("Entry file not found: " + app.entry);

        if (res.status === 404) {
          context?.eventBus?.emit("app:validation_failed", {
            name: app.name,
            entry: app.entry
          });
        }
      }
    } catch (err) {
      issues.push("Failed to load entry file");
    }

    const basePath = app.entry.replace("/index.html", "");

    try {
      const assetsCheck = await fetch(basePath + "/assets/");

      if (!assetsCheck.ok) {
        issues.push("Assets folder missing");
      }
    } catch {
      issues.push("Assets folder missing");
    }

    try {
      const scriptsCheck = await fetch(basePath + "/scripts/");

      if (!scriptsCheck.ok) {
        issues.push("Scripts folder missing");
      }
    } catch {
      issues.push("Scripts folder missing");
    }

    try {
      const stylesCheck = await fetch(basePath + "/styles/");

      if (!stylesCheck.ok) {
        issues.push("Styles folder missing");
      }
    } catch {
      issues.push("Styles folder missing");
    }

    if (issues.length > 0) {
      results.push({
        app: app.name,
        issues
      });
    }
  }

  return results;
}
