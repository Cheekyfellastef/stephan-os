export const OPENCLAW_ENDPOINT_STORAGE_KEY = 'stephanos.openclaw.endpoint.v1';
export const OPENCLAW_DEFAULT_HOST = '127.0.0.1';
export const OPENCLAW_DEFAULT_PORT = '8790';

export function isLoopbackHost(host = '') {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function normalizeEndpointDraft(draft = {}) {
  const endpointHost = String(draft.endpointHost || '').trim();
  const endpointPort = String(draft.endpointPort || '').trim();
  return {
    endpointLabel: draft.endpointLabel || 'Local OpenClaw Adapter',
    endpointHost,
    endpointPort,
    endpointScope: draft.endpointScope || 'local_only',
    expectedProtocolVersion: draft.expectedProtocolVersion || 'v1',
    expectedAdapterIdentity: draft.expectedAdapterIdentity || '',
    allowedProbeTypes: draft.allowedProbeTypes || 'health_and_handshake',
    configPersistenceMode: draft.configPersistenceMode || 'session_only',
    endpointMode: draft.endpointMode || 'configured',
  };
}

export function resolveReadonlyValidationEndpoint(draft = {}, { fallbackToSafeDefault = true } = {}) {
  const normalized = normalizeEndpointDraft(draft);
  const validPort = /^[0-9]{2,5}$/.test(normalized.endpointPort) && Number(normalized.endpointPort) > 0 && Number(normalized.endpointPort) < 65536;
  const validLoopback = isLoopbackHost(normalized.endpointHost);
  if (validLoopback && validPort) {
    return { host: normalized.endpointHost, port: normalized.endpointPort, usedSafeDefault: false, valid: true };
  }
  if (fallbackToSafeDefault) {
    return { host: OPENCLAW_DEFAULT_HOST, port: OPENCLAW_DEFAULT_PORT, usedSafeDefault: true, valid: true };
  }
  return { host: normalized.endpointHost, port: normalized.endpointPort, usedSafeDefault: false, valid: false };
}
