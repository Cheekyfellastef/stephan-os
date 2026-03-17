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
      const appMatch = project.entry.match(/^apps\/([^/]+)\/(?:dist\/)?index\.html$/);

      if (appMatch) {
        const appName = appMatch[1];
        const rootIndex = `apps/${appName}/index.html`;
        const distIndex = `apps/${appName}/dist/index.html`;

        if (project.entry === distIndex) {
          console.warn(
            "SelfRepair: app entry should prefer root index.html",
            project.name,
            rootIndex
          );
        }

        let foundReachableEntry = false;

        for (const candidate of [rootIndex, distIndex]) {
          try {
            const res = await fetch(candidate);

            if (res.ok) {
              foundReachableEntry = true;
              break;
            }
          } catch (err) {
            // Continue checking remaining candidates.
          }
        }

        if (!foundReachableEntry) {
          console.warn(
            "SelfRepair: failed to load app from root or dist index",
            project.name,
            rootIndex,
            distIndex
          );
        }

        continue;
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
