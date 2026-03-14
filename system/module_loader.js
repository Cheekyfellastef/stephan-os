export async function loadModules(context) {
  const registryUrl = new URL("../modules/module_registry.json", import.meta.url);
  const res = await fetch(registryUrl);
  const registry = await res.json();

  for (const moduleEntry of registry.modules || []) {
    const modulePath = typeof moduleEntry === "string" ? moduleEntry : moduleEntry?.path;
    if (!modulePath) {
      console.warn("Skipping module with no path", moduleEntry);
      continue;
    }

    try {
      const moduleUrl = new URL(modulePath, window.location.href);
      const loadedModule = await import(moduleUrl.href);
      if (typeof loadedModule.init === "function") {
        await loadedModule.init(context);
      }
    } catch (err) {
      console.error("Module load error:", modulePath, err);
    }
  }
}
