export function createAuditEvent(type, details = {}) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    details,
    at: new Date().toISOString(),
  };
}

export function appendAuditEvent(history = [], event) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (!event || typeof event !== 'object') {
    return safeHistory;
  }
  return [event, ...safeHistory].slice(0, 80);
}
