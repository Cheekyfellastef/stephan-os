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

      if (project.entry.includes("wealthapp")) {
        const distCheck = project.entry.includes("dist");

        if (!distCheck) {
          console.warn(
            "SelfRepair: WealthApp should use dist/index.html"
          );
        }
      }
    }
  }
};
