export function createEventBus() {
  const listeners = new Map();

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
