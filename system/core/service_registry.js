export function createServiceRegistry() {
  const services = new Map();

  return {
    registerService(name, instance) {
      services.set(name, instance);
      return instance;
    },

    getService(name) {
      return services.get(name);
    },

    hasService(name) {
      return services.has(name);
    },

    unregisterService(name) {
      services.delete(name);
    },

    listServices() {
      return Array.from(services.keys());
    }
  };
}
