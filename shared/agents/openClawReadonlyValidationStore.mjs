export const OPENCLAW_READONLY_VALIDATION_STORAGE_KEY = 'stephanos.openclaw.readonlyValidation.v1';
export const READONLY_VALIDATION_FRESH_MS = 60 * 60 * 1000;
export const READONLY_VALIDATION_EXPIRED_MS = 24 * 60 * 60 * 1000;

function asText(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').slice(0, 50) : [];
}

function normalizeTimestamp(value = '') {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

export function buildOpenClawValidationEndpointFingerprint({ endpointHost = '', endpointPort = '', endpointScope = '', expectedProtocolVersion = '' } = {}) {
  return [asText(endpointHost).toLowerCase(), asText(endpointPort), asText(endpointScope), asText(expectedProtocolVersion).toLowerCase()].join('|');
}

export function classifyReadonlyValidationFreshness({ savedAt = '', lastHandshakeAt = '', lastHealthCheckAt = '', now = Date.now() } = {}) {
  const baseline = Date.parse(lastHandshakeAt || lastHealthCheckAt || savedAt || '');
  if (!Number.isFinite(baseline)) return 'unknown';
  const ageMs = Math.max(0, now - baseline);
  if (ageMs <= READONLY_VALIDATION_FRESH_MS) return 'fresh';
  if (ageMs <= READONLY_VALIDATION_EXPIRED_MS) return 'stale';
  return 'expired';
}

export function sanitizeOpenClawReadonlyValidationEvidence(record = {}) {
  return {
    endpointHost: asText(record.endpointHost),
    endpointPort: asText(record.endpointPort),
    endpointScope: asText(record.endpointScope),
    expectedProtocolVersion: asText(record.expectedProtocolVersion),
    validationStatus: asText(record.validationStatus),
    validationMode: asText(record.validationMode),
    validationSource: asText(record.validationSource),
    healthState: asText(record.healthState),
    handshakeState: asText(record.handshakeState),
    protocolCompatible: record.protocolCompatible === true,
    adapterIdentity: asText(record.adapterIdentity),
    readonlyAssurance: record?.readonlyAssurance && typeof record.readonlyAssurance === 'object'
      ? { readonlyOnly: record.readonlyAssurance.readonlyOnly === true }
      : { readonlyOnly: false },
    lastHealthCheckAt: normalizeTimestamp(record.lastHealthCheckAt),
    lastHandshakeAt: normalizeTimestamp(record.lastHandshakeAt),
    healthLatencyMs: Number.isFinite(record.healthLatencyMs) ? record.healthLatencyMs : null,
    handshakeLatencyMs: Number.isFinite(record.handshakeLatencyMs) ? record.handshakeLatencyMs : null,
    validationEvidence: asArray(record.validationEvidence),
    validationWarnings: asArray(record.validationWarnings),
    validationBlockers: asArray(record.validationBlockers),
    savedAt: normalizeTimestamp(record.savedAt || new Date().toISOString()),
    sourceEndpointFingerprint: asText(record.sourceEndpointFingerprint),
  };
}

export function saveOpenClawReadonlyValidationEvidence({ evidence, storage = globalThis?.localStorage } = {}) {
  if (!storage?.setItem || !evidence) return null;
  const sanitized = sanitizeOpenClawReadonlyValidationEvidence(evidence);
  try {
    storage.setItem(OPENCLAW_READONLY_VALIDATION_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch {
    return null;
  }
}

export function loadOpenClawReadonlyValidationEvidence({ storage = globalThis?.localStorage } = {}) {
  if (!storage?.getItem) return null;
  try {
    const raw = storage.getItem(OPENCLAW_READONLY_VALIDATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return sanitizeOpenClawReadonlyValidationEvidence(parsed);
  } catch {
    return null;
  }
}
