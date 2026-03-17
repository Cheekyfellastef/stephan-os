function logRepairEvent(context, event) {
  const entry = {
    timestamp: Date.now(),
    ...event
  };

  if (!Array.isArray(context.repairLog)) {
    context.repairLog = [];
  }

  context.repairLog.unshift(entry);
  context.eventBus.emit("repair:logged", entry);
}

function normalizeDistEntry(entry) {
  return typeof entry === "string" ? entry.replace("/dist/", "/") : entry;
}

export function createSelfHealingService(context) {
  const { eventBus } = context;

  if (!eventBus || typeof eventBus.on !== "function") {
    console.warn("SelfHealing: event bus unavailable");
    return;
  }

  eventBus.on("app:validation_failed", async (app) => {
    const fixedEntry = normalizeDistEntry(app?.entry);

    if (!app || !app.entry || app.entry === fixedEntry) {
      logRepairEvent(context, {
        type: "app",
        target: app?.name || "unknown-app",
        action: "no-op",
        status: "failed",
        reason: "No runtime-safe repair available"
      });
      return;
    }

    const runtimeApp = (context.projects || []).find((project) => project?.name === app.name);
    if (runtimeApp) {
      runtimeApp.entry = fixedEntry;
    }

    eventBus.emit("app:repaired", {
      name: app.name,
      previousEntry: app.entry,
      entry: fixedEntry
    });

    logRepairEvent(context, {
      type: "app",
      target: app.name,
      action: "entry-rewrite",
      status: "success",
      details: `${app.entry} -> ${fixedEntry}`
    });
  });

  eventBus.on("module:failed", async (module) => {
    const moduleId = module?.id || module?.moduleId;
    if (!moduleId || !context.moduleLoader?.reloadModule) {
      logRepairEvent(context, {
        type: "module",
        target: moduleId || "unknown-module",
        action: "reload",
        status: "failed",
        reason: "Module reload unavailable"
      });
      return;
    }

    const reloaded = await context.moduleLoader.reloadModule(moduleId);

    logRepairEvent(context, {
      type: "module",
      target: moduleId,
      action: "reload",
      status: reloaded ? "success" : "failed"
    });
  });

  eventBus.on("workspace:launch_failed", async (app) => {
    logRepairEvent(context, {
      type: "workspace",
      target: app?.name || "unknown-app",
      action: "launch-repair-attempt",
      status: "started"
    });

    eventBus.emit("app:repair_attempt", app);
  });

  eventBus.on("app:repair_attempt", async (app) => {
    eventBus.emit("app:validation_failed", {
      name: app?.name,
      entry: app?.entry
    });
  });
}
