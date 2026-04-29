function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function asList(value) { return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : []; }
function asBoolean(value, fallback = false) { if (value === true) return true; if (value === false) return false; return fallback; }
function normalizeEnum(value, allowed, fallback) { const normalized = asText(value, fallback).toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }

export function adjudicateOpenClawAdapterConnectionConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const endpointUrl = asText(source.endpointUrl, '');
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
  if (endpointConfigured && !['local_only','tailscale_only'].includes(endpointScope)) {
    warnings.push('Endpoint scope should be local_only or explicitly safe before readiness can advance.');
  }
  const connectionConfigReady = endpointConfigured && blockers.length === 0;
  const connectionConfigNextAction = asText(source.connectionConfigNextAction)
    || (!endpointConfigured ? 'Configure OpenClaw local adapter endpoint.' : 'Validate readonly OpenClaw health/handshake telemetry.');
  const connectionConfigEvidence = [
    ...asList(source.connectionConfigEvidence),
    `endpoint-configured:${endpointConfigured ? 'yes' : 'no'}`,
    `endpoint-scope:${endpointScope}`,
    `endpoint-mode:${endpointMode}`,
    `allowed-probe-types:${allowedProbeTypes}`,
    `expected-protocol:${expectedProtocolVersion || 'unknown'}`,
    `expected-identity:${expectedAdapterIdentity || 'unknown'}`,
    'execution:disabled',
  ];
  return { endpointConfigured, endpointLabel, endpointUrl, endpointHost, endpointPort, endpointScope, endpointMode, expectedProtocolVersion, expectedAdapterIdentity, allowedProbeTypes, connectionConfigReady, connectionConfigBlockers: Array.from(new Set(blockers)), connectionConfigWarnings: Array.from(new Set(warnings)), connectionConfigEvidence, connectionConfigNextAction };
}
