const loadedModules = [];

function resolveModulePath(moduleEntry) {
  return typeof moduleEntry === "string" ? moduleEntry : moduleEntry?.path;
}

function isValidModuleDefinition(moduleDefinition) {
  return Boolean(
    moduleDefinition
      && typeof moduleDefinition.id === "string"
      && moduleDefinition.id.trim().length > 0
      && typeof moduleDefinition.version === "string"
      && typeof moduleDefinition.description === "string"
  );
}

export async function loadModules(context) {
  const registryUrl = new URL("../modules/module_registry.json", import.meta.url);
  const res = await fetch(registryUrl);
  const registry = await res.json();

  for (const moduleEntry of registry.modules || []) {
    const modulePath = resolveModulePath(moduleEntry);

    if (!modulePath) {
      console.warn("Skipping module with no path", moduleEntry);
      continue;
    }

    try {
      const moduleUrl = new URL(modulePath, window.location.href);
      const loadedModule = await import(moduleUrl.href);
      const { moduleDefinition, init } = loadedModule;

      if (!init || typeof init !== "function") {
        console.error("Invalid module:", modulePath);
        continue;
      }

      if (!isValidModuleDefinition(moduleDefinition)) {
        console.error("Invalid module definition:", modulePath);
        continue;
      }

      await init(context);
      loadedModules.push({ modulePath, moduleDefinition, module: loadedModule });

      console.log("Loaded module:", moduleDefinition.id);
      context?.eventBus?.emit("module:loaded", moduleDefinition);
    } catch (err) {
      console.error("Module load error:", modulePath, err);
    }
  }
}

export async function disposeModules(context) {
  while (loadedModules.length > 0) {
    const loaded = loadedModules.pop();
    const dispose = loaded?.module?.dispose;

    if (typeof dispose === "function") {
      try {
        await dispose(context);
      } catch (err) {
        console.error("Module dispose error:", loaded.modulePath, err);
      }
    }
  }
}
