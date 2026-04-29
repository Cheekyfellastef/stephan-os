function asText(value = '', fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function asBoolean(value, fallback = false) { if (value === true) return true; if (value === false) return false; return fallback; }
function asList(value) { return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : []; }
function normalizeEnum(value, allowed, fallback) { const normalized = asText(value, fallback).toLowerCase(); return allowed.includes(normalized) ? normalized : fallback; }
function asNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }

function adjudicateValidation(source = {}) {
  const validation = source.validation && typeof source.validation === 'object' ? source.validation : source;
  const blockers = asList(validation.validationBlockers);
  const warnings = asList(validation.validationWarnings);
  const safeProbePathAvailable = validation.safeProbePathAvailable === true;
  const validationMode = normalizeEnum(validation.validationMode, ['none', 'health_only', 'handshake_only', 'health_and_handshake', 'blocked', 'unknown'], 'none');
  const validationStatus = normalizeEnum(validation.validationStatus, ['idle', 'not_ready', 'ready', 'running', 'succeeded', 'failed', 'blocked', 'unknown'], 'idle');
  return {
    validationRequested: validation.validationRequested === true,
    validationMode,
    validationStatus,
    validationSource: normalizeEnum(validation.validationSource, ['operator', 'projection', 'backend_health_endpoint', 'simulated', 'unknown'], 'unknown'),
    validationStartedAt: asText(validation.validationStartedAt),
    validationFinishedAt: asText(validation.validationFinishedAt),
    validationLatencyMs: asNumber(validation.validationLatencyMs),
    validationBlockers: blockers,
    validationWarnings: warnings,
    validationEvidence: asList(validation.validationEvidence),
    validationNextAction: asText(validation.validationNextAction) || (safeProbePathAvailable
      ? 'Validate readonly OpenClaw health/handshake telemetry.'
      : 'Readonly validation requires a safe local probe endpoint.'),
    safeProbePathAvailable,
  };
}

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
  const validation = adjudicateValidation(source.validation || source);
  const healthResult = {
    healthState,
    healthMessage: asText(source.healthMessage),
    healthLatencyMs: asNumber(source.healthLatencyMs),
    healthCheckedAt: asText(source.lastHealthCheckAt),
    healthEvidence: asList(source.healthEvidence),
  };
  const handshakeResult = {
    handshakeState,
    adapterIdentity,
    protocolVersion,
    expectedProtocolVersion,
    protocolCompatible,
    protocolMismatchReason,
    capabilityDeclaration,
    readonlyAssurance,
    handshakeCheckedAt: asText(source.lastHandshakeAt),
    handshakeEvidence: asList(source.handshakeEvidence),
  };
  const executionClaims = ['canExecuteActions', 'canEditFiles', 'canRunCommands', 'canUseBrowser', 'canUseGit', 'canAccessNetwork'].filter((key) => capabilityDeclaration[key] === true);
  const healthHandshakeEvidence = [...asList(source.healthHandshakeEvidence), `health:${healthState}`, `handshake:${handshakeState}`, `protocol:${protocolCompatible ? 'compatible' : 'mismatch'}`, `identity:${adapterIdentity.id ? 'present' : 'missing'}`, `readonly:${readonlyAssurance.readonlyOnly ? 'true' : 'false'}`, 'execution:disabled'];
  const healthHandshakeNextAction = asText(source.healthHandshakeNextAction) || (healthState === 'not_run' || handshakeState === 'not_run' ? 'Run readonly OpenClaw health/handshake validation.' : protocolCompatible ? 'Advance to approval-gate completion and dry-run planning.' : 'Resolve OpenClaw protocol/identity mismatch.');
  const healthWarnings = asList(source.healthWarnings);
  const handshakeWarnings = asList(source.handshakeWarnings);
  if (executionClaims.length > 0) {
    handshakeWarnings.push(`Execution-like capability claims reported (${executionClaims.join(', ')}) and are treated as unapproved claims only.`);
  }
  return { healthTelemetryMode, healthState, handshakeState, adapterIdentity, protocol: { protocolVersion, expectedProtocolVersion, compatible: protocolCompatible, mismatchReason: protocolMismatchReason }, capabilityDeclaration, readonlyAssurance, validation, validationStatus: validation.validationStatus, validationMode: validation.validationMode, validationSource: validation.validationSource, healthResult, handshakeResult, protocolResult: handshakeResult, identityResult: adapterIdentity, readonlyAssuranceResult: readonlyAssurance, lastHealthCheckAt: asText(source.lastHealthCheckAt), lastHandshakeAt: asText(source.lastHandshakeAt), healthLatencyMs: asNumber(source.healthLatencyMs), handshakeLatencyMs: asNumber(source.handshakeLatencyMs), healthBlockers: asList(source.healthBlockers), healthWarnings, handshakeBlockers: asList(source.handshakeBlockers), handshakeWarnings, healthHandshakeEvidence, healthHandshakeNextAction };
}
