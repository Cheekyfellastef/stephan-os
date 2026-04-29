import { adjudicateOpenClawAdapterConnectionConfig } from './openClawAdapterConnectionConfig.mjs';
import { adjudicateOpenClawHealthHandshake } from './openClawHealthHandshake.mjs';
function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).filter(Boolean) : [];
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = asText(value, fallback).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function adjudicateOpenClawAdapterConnection(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const blockers = asList(source.connectionBlockers);
  const warnings = asList(source.connectionWarnings);
  const config = adjudicateOpenClawAdapterConnectionConfig(source.connectionConfig || source.openClawAdapterConnectionConfig || source);
  const telemetry = adjudicateOpenClawHealthHandshake({
    ...(source.healthHandshake || source.openClawHealthHandshake || {}),
    expectedProtocolVersion: config.expectedProtocolVersion,
    expectedAdapterIdentity: config.expectedAdapterIdentity,
  });
  const endpointConfigured = config.endpointConfigured;

  const connectionMode = normalizeEnum(source.connectionMode, ['unavailable', 'readiness_only', 'health_check_only', 'local_stub', 'simulated', 'configured', 'connected', 'blocked', 'unknown'], 'readiness_only');
  const endpointScope = config.endpointScope;
  const healthCheckState = normalizeEnum(source.healthCheckState || telemetry.healthState, ['unavailable', 'not_run', 'passing', 'failing', 'blocked', 'unknown'], endpointConfigured ? 'not_run' : 'unavailable');
  const handshakeState = normalizeEnum(source.handshakeState || telemetry.handshakeState, ['unavailable', 'not_run', 'compatible', 'incompatible', 'blocked', 'unknown'], endpointConfigured ? 'not_run' : 'unavailable');

  let connectionState = normalizeEnum(source.connectionState, ['not_configured', 'not_connected', 'configured_not_checked', 'health_check_ready', 'handshake_ready', 'connected_readonly', 'connected_blocked', 'blocked', 'unknown'], endpointConfigured ? 'configured_not_checked' : 'not_connected');

  if (blockers.length > 0 || connectionMode === 'blocked' || ['blocked'].includes(healthCheckState) || ['blocked'].includes(handshakeState)) {
    connectionState = endpointConfigured ? 'connected_blocked' : 'blocked';
  } else if (!endpointConfigured) {
    connectionState = 'not_connected';
  } else if (handshakeState === 'compatible') {
    connectionState = 'handshake_ready';
  } else if (healthCheckState === 'passing') {
    connectionState = 'health_check_ready';
  }

  const informationalOnlyBlockers = blockers.filter((entry) => /informational/i.test(entry));
  const hardBlockers = blockers.filter((entry) => !informationalOnlyBlockers.includes(entry));
  const connectionReady = endpointConfigured
    && ['configured_not_checked', 'health_check_ready', 'handshake_ready', 'connected_readonly'].includes(connectionState)
    && hardBlockers.length === 0;

  const readonlyConnection = true;
  const connectionCanExecute = false;
  const connectionExecutionAllowed = false;

  let connectionNextAction = asText(source.connectionNextAction);
  if (!connectionNextAction) {
    if (!endpointConfigured) connectionNextAction = 'Configure OpenClaw local adapter endpoint for connection readiness.';
    else if (healthCheckState === 'not_run' || healthCheckState === 'unknown') connectionNextAction = 'Run health-check-only OpenClaw adapter handshake.';
    else if (healthCheckState === 'passing' && handshakeState !== 'compatible') connectionNextAction = 'Validate readonly adapter handshake compatibility.';
    else if (handshakeState === 'compatible') connectionNextAction = 'Advance to approval-gate completion and dry-run planning.';
    else connectionNextAction = 'Resolve OpenClaw adapter connection blockers.';
  }

  const connectionEvidence = [
    ...asList(source.connectionEvidence),
    `connection-mode:${connectionMode}`,
    `connection-state:${connectionState}`,
    `endpoint-configured:${endpointConfigured ? 'yes' : 'no'}`,
    `endpoint-scope:${endpointScope}`,
    `health-check:${healthCheckState}`,
    `handshake:${handshakeState}`,
    'execution:disabled',
  ];

  return {
    connectionMode,
    connectionState,
    endpointConfigured,
    endpointLabel: config.endpointLabel || asText(source.endpointLabel, endpointConfigured ? 'OpenClaw local endpoint' : ''),
    endpointScope,
    healthCheckState,
    handshakeState,
    protocolVersion: telemetry.protocol.protocolVersion || asText(source.protocolVersion, ''),
    expectedProtocolVersion: config.expectedProtocolVersion || telemetry.protocol.expectedProtocolVersion,
    adapterIdentity: telemetry.adapterIdentity.id || asText(source.adapterIdentity, ''),
    connectionConfig: config,
    healthHandshake: telemetry,
    adapterCapabilitiesReported: asList(source.adapterCapabilitiesReported),
    readonlyConnection,
    connectionReady,
    connectionCanExecute,
    connectionExecutionAllowed,
    connectionBlockers: blockers,
    connectionWarnings: warnings,
    connectionEvidence,
    connectionNextAction,
  };
}
