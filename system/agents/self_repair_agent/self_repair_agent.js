import { resolvePackagingMode, validateEntryForPackaging } from "../../apps/entry_rules.js";

async function fetchManifestForProject(project) {
  const appFolder = String(project?.folder || "").trim();

  if (!appFolder) {
    return null;
  }

  try {
    const response = await fetch(`apps/${appFolder}/app.json`);

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

export const selfRepairAgent = {
  id: "self-repair-agent",

  subscribeEvents: [
    "module:loaded",
    "workspace:opened",
    "simulation:start"
  ],

  init() {
    console.log("SelfRepair agent started");
  },

  async handleEvent(event, context) {
    const projects = context.projects || [];

    for (const project of projects) {
      const manifest = await fetchManifestForProject(project);
      const packaging = resolvePackagingMode({
        app: project,
        manifest: manifest || {
          entry: String(project?.entry || "").replace(/^apps\/[^/]+\//, "")
        }
      });

      const manifestEntry = manifest?.entry || String(project?.entry || "").replace(/^apps\/[^/]+\//, "");
      const entryValidation = validateEntryForPackaging({
        packaging,
        entry: manifestEntry
      });

      if (!entryValidation.ok) {
        console.warn("SelfRepair: invalid entry configuration", project?.name || project?.id || "unknown", entryValidation.message);
      }

      try {
        const res = await fetch(project.entry);

        if (!res.ok) {
          console.warn(
            "SelfRepair: broken app entry",
            project.name,
            project.entry
          );
        }
      } catch (err) {
        console.warn(
          "SelfRepair: failed to load app",
          project.name
        );
      }
    }
  }
};
