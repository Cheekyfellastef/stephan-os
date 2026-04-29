function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function asList(value) { return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : []; }
function asBoolean(value, fallback = false) { if (value === true) return true; if (value === false) return false; return fallback; }
function normalizeEnum(value, allowed, fallback) { const normalized = asText(value, fallback).toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }

const SECRET_PATTERNS = [/api[_-]?key/i, /token/i, /secret/i, /password/i, /authorization/i, /@[\w.-]+:[^@\s]+@/i, /:\/\/[^\s/@]+:[^\s/@]+@/i];

function containsSecretLikeContent(value = '') {
  const text = asText(value, '');
  if (!text) return false;
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeEndpointUrl(value = '') {
  const text = asText(value, '');
  if (!text) return '';
  if (containsSecretLikeContent(text)) return '';
  return text;
}

export function adjudicateOpenClawAdapterConnectionConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const rawEndpointUrl = asText(source.endpointUrl, '');
  const endpointUrl = sanitizeEndpointUrl(rawEndpointUrl);
  const endpointHost = asText(source.endpointHost, '');
  const endpointPort = asText(source.endpointPort, '');
  const endpointLabel = asText(source.endpointLabel, endpointUrl ? 'OpenClaw local adapter endpoint' : '');
  const endpointConfigured = asBoolean(source.endpointConfigured, endpointUrl.length > 0 || endpointHost.length > 0 || endpointPort.length > 0);
  const endpointScope = normalizeEnum(source.endpointScope, ['none','local_only','tailscale_only','hosted_proxy','unknown'], endpointConfigured ? 'unknown' : 'none');
  const endpointMode = normalizeEnum(source.endpointMode, ['unavailable','model_only','configured','health_check_only','blocked','unknown'], endpointConfigured ? 'configured' : 'model_only');
  const expectedProtocolVersion = asText(source.expectedProtocolVersion, '');
  const expectedAdapterIdentity = asText(source.expectedAdapterIdentity, '');
  const allowedProbeTypes = normalizeEnum(source.allowedProbeTypes, ['none','health_only','handshake_only','health_and_handshake'], endpointConfigured ? 'health_and_handshake' : 'none');
  const blockers = asList(source.connectionConfigBlockers);
  const warnings = asList(source.connectionConfigWarnings);
  const credentialBlocked = rawEndpointUrl.length > 0 && endpointUrl.length === 0;

  if (credentialBlocked) {
    blockers.push('Endpoint URL includes suspicious credential/token content and was rejected. Use non-secret local endpoint configuration only.');
    warnings.push('Secret-bearing endpoint URLs are blocked and never stored in OpenClaw endpoint configuration.');
  }
  if (endpointConfigured && endpointScope === 'unknown') {
    blockers.push('Endpoint scope is unknown; classify scope before readiness can advance.');
  }
  if (endpointConfigured && endpointScope === 'hosted_proxy') {
    blockers.push('Hosted proxy scope is not allowed for readonly local adapter v1 endpoint readiness.');
  }
  if (endpointConfigured && endpointScope === 'tailscale_only') {
    warnings.push('Tailscale-only endpoint is recorded as config evidence only; readiness remains gated until safety policy explicitly allows it.');
  }

  const normalizedBlockers = Array.from(new Set(blockers));
  const normalizedWarnings = Array.from(new Set(warnings));
  const scopeReady = endpointScope === 'local_only';
  const connectionConfigReady = endpointConfigured && scopeReady && normalizedBlockers.length === 0;
  const connectionConfigNextAction = asText(source.connectionConfigNextAction)
    || (!endpointConfigured
      ? 'Configure OpenClaw local adapter endpoint.'
      : connectionConfigReady
        ? 'Validate readonly OpenClaw health/handshake telemetry.'
        : 'Resolve OpenClaw endpoint scope/safety blockers before readonly health/handshake validation.');
  const connectionConfigEvidence = [
    ...asList(source.connectionConfigEvidence),
    `endpoint-configured:${endpointConfigured ? 'yes' : 'no'}`,
    `endpoint-scope:${endpointScope}`,
    `endpoint-mode:${endpointMode}`,
    `allowed-probe-types:${allowedProbeTypes}`,
    `expected-protocol:${expectedProtocolVersion || 'unknown'}`,
    `expected-identity:${expectedAdapterIdentity || 'unknown'}`,
    `endpoint-url:${endpointUrl ? 'present_nonsecret' : (rawEndpointUrl ? 'rejected_secret_like' : 'missing')}`,
    'execution:disabled',
  ];
  return { endpointConfigured, endpointLabel, endpointUrl, endpointHost, endpointPort, endpointScope, endpointMode, expectedProtocolVersion, expectedAdapterIdentity, allowedProbeTypes, connectionConfigReady, connectionConfigBlockers: normalizedBlockers, connectionConfigWarnings: normalizedWarnings, connectionConfigEvidence, connectionConfigNextAction };
}
