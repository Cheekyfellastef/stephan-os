import { STEPHANOS_LAW_IDS } from "../shared/runtime/stephanosLaws.mjs";

const loadedModules = [];
const moduleStates = {};
let moduleRegistry = [];
const LAUNCHER_CRITICAL_MODULE_PATH_PREFIXES = Object.freeze([
  "./modules/command-deck/",
  "./system/workspace.js",
  "./main.js",
]);

function ensureActiveModules(context) {
  if (!context) {
    return null;
  }

  if (!context.activeModules || typeof context.activeModules !== "object") {
    context.activeModules = {};
  }

  return context.activeModules;
}

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

function setModuleState(moduleId, state) {
  moduleStates[moduleId] = {
    ...(moduleStates[moduleId] || {}),
    ...state
  };
}

function removeActiveModule(moduleId, context) {
  const activeModules = ensureActiveModules(context);
  if (activeModules && moduleId) {
    delete activeModules[moduleId];
  }
}

function createImportUrl(modulePath, options = {}) {
  const moduleUrl = /^https?:\/\//i.test(modulePath)
    ? new URL(modulePath)
    : new URL(modulePath, window.location.href);

  if (options.cacheBust) {
    moduleUrl.searchParams.set("v", String(Date.now()));
  }

  return moduleUrl.href;
}

function isLauncherCriticalModulePath(modulePath) {
  const normalizedPath = String(modulePath || "").trim();
  return LAUNCHER_CRITICAL_MODULE_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

function emitModuleFailure(context, moduleId, modulePath, reason, error = null) {
  const launcherCritical = isLauncherCriticalModulePath(modulePath);
  const payload = {
    id: moduleId || modulePath,
    path: modulePath,
    reason: reason || "Module load failed",
    launcherCritical,
    lawId: launcherCritical ? STEPHANOS_LAW_IDS.IMPORT_STRUCTURE_GUARD : STEPHANOS_LAW_IDS.UNIVERSAL_ENTRY,
    errorName: error?.name || null,
    errorStack: typeof error?.stack === "string" ? error.stack : null,
  };

  context?.eventBus?.emit("module:failed", payload);
}

async function loadModuleFromPath(modulePath, context, options = {}) {
  const moduleImportPath = createImportUrl(modulePath, options);
  const loadedModule = await import(moduleImportPath);
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

  const activeModules = ensureActiveModules(context);
  if (activeModules) {
    activeModules[moduleDefinition.id] = {
      modulePath,
      moduleDefinition: { ...moduleDefinition },
      status: "active"
    };
  }

  setModuleState(moduleDefinition.id, {
    modulePath,
    moduleDefinition: { ...moduleDefinition },
    status: "active"
  });

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

async function fetchRegistry() {
  const registryUrl = new URL("../modules/module_registry.json", import.meta.url);
  const res = await fetch(registryUrl);
  const registry = await res.json();
  return registry.modules || [];
}

export function getLoadedModules() {
  return Object.values(moduleStates).map((entry) => ({
    modulePath: entry.modulePath,
    moduleDefinition: { ...entry.moduleDefinition },
    status: entry.status
  }));
}

export function getRegisteredModules() {
  return [...moduleRegistry];
}

export function registerModulePath(modulePath) {
  if (typeof modulePath !== "string" || modulePath.trim().length === 0) {
    return false;
  }

  const normalizedPath = modulePath.trim();
  if (moduleRegistry.includes(normalizedPath)) {
    return false;
  }

  moduleRegistry.push(normalizedPath);
  return true;
}

export async function loadModules(context) {
  moduleRegistry = await fetchRegistry();

  for (const moduleEntry of moduleRegistry) {
    const modulePath = resolveModulePath(moduleEntry);

    if (!modulePath) {
      console.warn("Skipping module with no path", moduleEntry);
      continue;
    }

    try {
      await loadModuleFromPath(modulePath, context);
    } catch (err) {
      console.error("Module load error:", modulePath, err);
      emitModuleFailure(context, modulePath, modulePath, err?.message || "Module load failed", err);
    }
  }
}

export async function reloadModules(context) {
  await disposeModules(context);
  await loadModules(context);
}

export async function disableModule(moduleId, context) {
  if (moduleId === "module-manager") {
    console.warn("The Module Manager cannot be disabled.");
    return false;
  }

  const moduleIndex = findLoadedModuleIndex(moduleId);

  if (moduleIndex < 0) {
    return false;
  }

  const [loadedEntry] = loadedModules.splice(moduleIndex, 1);

  try {
    await disposeLoadedModule(loadedEntry, context);
    removeActiveModule(loadedEntry?.moduleDefinition?.id, context);
    setModuleState(loadedEntry?.moduleDefinition?.id, { status: "disabled" });
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

  removeActiveModule(loadedEntry?.moduleDefinition?.id, context);

  try {
    await loadModuleFromPath(loadedEntry.modulePath, context, { cacheBust: true });
    console.log("Reloaded module:", moduleId);
    return true;
  } catch (err) {
    console.error("Module reload error:", loadedEntry.modulePath, err);
    emitModuleFailure(context, moduleId, loadedEntry.modulePath, err?.message || "Module reload failed", err);
    return false;
  }
}

export async function enableModule(moduleId, context) {
  const existingModuleIndex = findLoadedModuleIndex(moduleId);
  if (existingModuleIndex >= 0) {
    return true;
  }

  const state = moduleStates[moduleId];
  if (!state?.modulePath) {
    return false;
  }

  try {
    await loadModuleFromPath(state.modulePath, context, { cacheBust: true });
    console.log("Enabled module:", moduleId);
    return true;
  } catch (err) {
    console.error("Module enable error:", state.modulePath, err);
    emitModuleFailure(context, moduleId, state.modulePath, err?.message || "Module enable failed", err);
    return false;
  }
}

export async function disposeModules(context) {
  const activeModules = ensureActiveModules(context);

  while (loadedModules.length > 0) {
    const loaded = loadedModules.pop();

    if (activeModules && loaded?.moduleDefinition?.id) {
      delete activeModules[loaded.moduleDefinition.id];
    }

    setModuleState(loaded?.moduleDefinition?.id, { status: "disabled" });

    try {
      await disposeLoadedModule(loaded, context);
    } catch (err) {
      console.error("Module dispose error:", loaded?.modulePath, err);
    }
  }
}
