export function createEventBus() {
  const listeners = new Map();
  const WILDCARD_EVENT = "*";

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
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }

    const wildcardHandlers = listeners.get(WILDCARD_EVENT);
    if (!wildcardHandlers) {
      return;
    }

    const envelope = {
      name: eventName,
      data,
      timestamp: Date.now()
    };

    for (const handler of wildcardHandlers) {
      handler(envelope);
    }
  }

  return {
    on,
    off,
    emit
  };
}
