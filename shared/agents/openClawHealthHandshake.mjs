function asText(value = '', fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function asBoolean(value, fallback = false) { if (value === true) return true; if (value === false) return false; return fallback; }
function asList(value) { return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : []; }
function normalizeEnum(value, allowed, fallback) { const normalized = asText(value, fallback).toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }

export function adjudicateOpenClawHealthHandshake(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const expectedProtocolVersion = asText(source.expectedProtocolVersion, '');
  const expectedAdapterIdentity = asText(source.expectedAdapterIdentity, '');
  const healthTelemetryMode = normalizeEnum(source.healthTelemetryMode, ['unavailable','model_only','readonly_health_check','simulated','local_only','blocked','unknown'], 'model_only');
  const healthState = normalizeEnum(source.healthState, ['unavailable','not_run','passing','degraded','failing','blocked','unknown'], 'not_run');
  let handshakeState = normalizeEnum(source.handshakeState, ['unavailable','not_run','compatible','incompatible','degraded','blocked','unknown'], 'not_run');
  const protocolVersion = asText(source.protocolVersion, '');
  const protocolCompatible = asBoolean(source.protocolCompatible, !!(expectedProtocolVersion && protocolVersion && expectedProtocolVersion === protocolVersion));
  const protocolMismatchReason = asText(source.protocolMismatchReason, protocolCompatible ? '' : (expectedProtocolVersion && protocolVersion ? 'Protocol version mismatch.' : ''));
  if (!protocolCompatible && protocolMismatchReason) handshakeState = handshakeState === 'not_run' ? 'degraded' : handshakeState;
  const adapterIdentity = { id: asText(source.adapterIdentity?.id || source.adapterIdentity), label: asText(source.adapterIdentity?.label), version: asText(source.adapterIdentity?.version), source: asText(source.adapterIdentity?.source, 'reported_claim') };
  if (!adapterIdentity.id && expectedAdapterIdentity) adapterIdentity.id = expectedAdapterIdentity;
  const capabilityDeclaration = { canReportHealth:true, canReportHandshake:true, canReportCapabilities:true, canReportEvidence:true, canExecuteActions:false, canEditFiles:false, canRunCommands:false, canUseBrowser:false, canUseGit:false, canAccessNetwork:false, ...(source.capabilityDeclaration||{}) };
  const readonlyAssurance = { readonlyOnly:true, executionDisabled:true, writeAccessDisabled:true, commandExecutionDisabled:true, browserControlDisabled:true, gitWriteDisabled:true, networkActionDisabled:true, ...(source.readonlyAssurance||{}) };
  const healthHandshakeEvidence = [...asList(source.healthHandshakeEvidence), `health:${healthState}`, `handshake:${handshakeState}`, `protocol:${protocolCompatible ? 'compatible' : 'mismatch'}`, `identity:${adapterIdentity.id ? 'present' : 'missing'}`, `readonly:${readonlyAssurance.readonlyOnly ? 'true' : 'false'}`, 'execution:disabled'];
  const healthHandshakeNextAction = asText(source.healthHandshakeNextAction) || (healthState === 'not_run' || handshakeState === 'not_run' ? 'Run readonly OpenClaw health/handshake validation.' : protocolCompatible ? 'Advance to approval-gate completion and dry-run planning.' : 'Resolve OpenClaw protocol/identity mismatch.');
  return { healthTelemetryMode, healthState, handshakeState, adapterIdentity, protocol: { protocolVersion, expectedProtocolVersion, compatible: protocolCompatible, mismatchReason: protocolMismatchReason }, capabilityDeclaration, readonlyAssurance, lastHealthCheckAt: asText(source.lastHealthCheckAt), lastHandshakeAt: asText(source.lastHandshakeAt), healthLatencyMs: Number.isFinite(Number(source.healthLatencyMs)) ? Number(source.healthLatencyMs) : null, handshakeLatencyMs: Number.isFinite(Number(source.handshakeLatencyMs)) ? Number(source.handshakeLatencyMs) : null, healthBlockers: asList(source.healthBlockers), healthWarnings: asList(source.healthWarnings), handshakeBlockers: asList(source.handshakeBlockers), handshakeWarnings: asList(source.handshakeWarnings), healthHandshakeEvidence, healthHandshakeNextAction };
}
