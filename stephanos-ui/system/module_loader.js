class ModuleLoader {
    constructor() {
        this.modules = {};
    }

    async loadRegistry() {
        const response = await fetch("./modules/module_registry.json");
        const registry = await response.json();
        return registry.modules;
    }

    async loadModules() {
        const modules = await this.loadRegistry();

        for (const module of modules) {
            try {
                const importedModule = await import(module.path);
                this.modules[module.name] = importedModule;
                console.log(`Module loaded: ${module.name}`);
            } catch (error) {
                console.error(`Failed to load module: ${module.name}`, error);
            }
        }
    }

    getModule(name) {
        return this.modules[name];
    }
}

export const moduleLoader = new ModuleLoader();