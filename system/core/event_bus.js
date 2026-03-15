export function createEventBus() {
  const listeners = new Map();

  // Event naming conventions:
  // - system:* for runtime lifecycle and shell-level events.
  // - module:* for module lifecycle and inter-module status events.
  // - workspace:* for workspace navigation/state transitions.
  // - project:* for project-specific actions and state changes.
  function on(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("eventBus.on requires a function handler");
    }

    const handlers = listeners.get(eventName) || new Set();
    handlers.add(handler);
    listeners.set(eventName, handlers);

    return () => off(eventName, handler);
  }

  function off(eventName, handler) {
    const handlers = listeners.get(eventName);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      listeners.delete(eventName);
    }
  }

  function emit(eventName, data) {
    const handlers = listeners.get(eventName);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(data);
    }
  }

  return {
    on,
    off,
    emit
  };
}
