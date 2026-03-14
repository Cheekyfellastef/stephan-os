export async function loadModules(context) {
  const res = await fetch("modules/module_registry.json");
  const registry = await res.json();

  for (const modulePath of registry.modules || []) {
    try {
      const loadedModule = await import(modulePath);
      if (typeof loadedModule.init === "function") {
        await loadedModule.init(context);
      }
    } catch (err) {
      console.error("Module load error:", modulePath, err);
    }
  }
}
