const STEPHANOS_SYSTEM_ENTRY = {
  name: "Stephanos OS",
  icon: "🧠",
  entry: "ROADMAP.md",
  type: "system"
};

function ensureStephanosEntry(apps) {
  const hasStephanos = apps.some(
    (app) => String(app?.name || "").trim().toLowerCase() === "stephanos os"
  );

  if (!hasStephanos) {
    apps.push({ ...STEPHANOS_SYSTEM_ENTRY });
  }
}

export async function discoverApps() {
  const apps = [];

  const response = await fetch("./apps/index.json");
  const folders = await response.json();

  for (const folder of folders) {
    try {
      const manifestResponse = await fetch(`./apps/${folder}/app.json`);
      const manifest = await manifestResponse.json();

      apps.push({
        name: manifest.name,
        icon: manifest.icon,
        entry: `apps/${folder}/${manifest.entry}`,
        type: manifest.type || "app",
        dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies : []
      });
    } catch (err) {
      console.warn("Skipping app:", folder);
    }
  }

  ensureStephanosEntry(apps);
  return apps;
}
