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

function findLoadedModuleIndex(moduleId) {
  return loadedModules.findIndex((entry) => entry.moduleDefinition.id === moduleId);
}

async function loadModuleFromPath(modulePath, context, options = {}) {
  const cacheBust = options.cacheBust ? `?t=${Date.now()}` : "";
  const moduleUrl = new URL(modulePath + cacheBust, window.location.href);
  const loadedModule = await import(moduleUrl.href);
  const { moduleDefinition, init } = loadedModule;

  if (!init || typeof init !== "function") {
    throw new Error(`Invalid module init function: ${modulePath}`);
  }

  if (!isValidModuleDefinition(moduleDefinition)) {
    throw new Error(`Invalid module definition: ${modulePath}`);
  }

  await init(context);

  const loadedEntry = {
    modulePath,
    moduleDefinition,
    module: loadedModule
  };

  loadedModules.push(loadedEntry);

  console.log("Loaded module:", moduleDefinition.id);
  context?.eventBus?.emit("module:loaded", moduleDefinition);

  return loadedEntry;
}

async function disposeLoadedModule(loadedEntry, context) {
  const dispose = loadedEntry?.module?.dispose;

  if (typeof dispose === "function") {
    await dispose(context);
  }

  context?.eventBus?.emit("module:disposed", loadedEntry?.moduleDefinition);
}

export function getLoadedModules() {
  return loadedModules.map((entry) => ({
    modulePath: entry.modulePath,
    moduleDefinition: { ...entry.moduleDefinition },
    status: "active"
  }));
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
      await loadModuleFromPath(modulePath, context);
    } catch (err) {
      console.error("Module load error:", modulePath, err);
    }
  }
}

export async function disableModule(moduleId, context) {
  const moduleIndex = findLoadedModuleIndex(moduleId);

  if (moduleIndex < 0) {
    return false;
  }

  const [loadedEntry] = loadedModules.splice(moduleIndex, 1);

  try {
    await disposeLoadedModule(loadedEntry, context);
    console.log("Disabled module:", moduleId);
    return true;
  } catch (err) {
    console.error("Module disable error:", loadedEntry.modulePath, err);
    return false;
  }
}

export async function reloadModule(moduleId, context) {
  const moduleIndex = findLoadedModuleIndex(moduleId);

  if (moduleIndex < 0) {
    return false;
  }

  const [loadedEntry] = loadedModules.splice(moduleIndex, 1);

  try {
    await disposeLoadedModule(loadedEntry, context);
  } catch (err) {
    console.error("Module dispose error:", loadedEntry.modulePath, err);
  }

  try {
    await loadModuleFromPath(loadedEntry.modulePath, context, { cacheBust: true });
    console.log("Reloaded module:", moduleId);
    return true;
  } catch (err) {
    console.error("Module reload error:", loadedEntry.modulePath, err);
    return false;
  }
}

export async function disposeModules(context) {
  while (loadedModules.length > 0) {
    const loaded = loadedModules.pop();

    try {
      await disposeLoadedModule(loaded, context);
    } catch (err) {
      console.error("Module dispose error:", loaded?.modulePath, err);
    }
  }
}
