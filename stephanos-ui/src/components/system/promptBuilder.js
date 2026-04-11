import { buildOperatorGuidanceProjection } from '../../state/operatorGuidanceRendering.js';

const DEFAULT_MAX_TELEMETRY_ENTRIES = 5;
const TELEMETRY_COUNT_OPTIONS = new Set([3, 5, 10]);

const TRUTH_FIELDS = [
  ['routeKind', (truth) => truth.routeKind],
  ['backendReachable', (truth) => truth.backendReachable],
  ['fallbackActive', (truth) => truth.fallbackActive],
  ['memoryMode', (truth) => truth.memoryMode],
  ['providerExecution.requestedProvider', (truth) => truth.providerExecution?.requestedProvider],
  ['providerExecution.executableProvider', (truth) => truth.providerExecution?.executableProvider],
  ['providerExecution.providerHealthState', (truth) => truth.providerExecution?.providerHealthState],
  ['winningReason', (truth) => truth.winningReason],
  ['selectedRouteReason', (truth) => truth.selectedRouteReason],
  ['fallbackReason', (truth) => truth.fallbackReason],
  ['providerReason', (truth) => truth.providerReason],
  ['operatorGuidance', (truth) => truth.operatorGuidance],
  ['operatorAction', (truth) => truth.operatorAction],
  ['actionText', (truth) => truth.actionText],
];

const DEFAULT_CONSTRAINTS = [
  'use runtimeStatusModel.finalRouteTruth as single truth source',
  'do not duplicate route/provider logic',
  'do not weaken production useAIStore provider contract',
  'do not route production code to test mocks',
  'prefer minimal-drift fixes',
  'rebuild dist only if source changes require it',
];

function sanitizeLine(value) {
  return String(value ?? '').trim();
}

function formatScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function normalizeTelemetryLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_TELEMETRY_ENTRIES;
  }
  if (TELEMETRY_COUNT_OPTIONS.has(numeric)) {
    return numeric;
  }
  if (numeric <= 3) {
    return 3;
  }
  if (numeric <= 5) {
    return 5;
  }
  return 10;
}

function formatTruthSnapshot(finalRouteTruth) {
  const truth = finalRouteTruth && typeof finalRouteTruth === 'object' ? finalRouteTruth : null;
  if (!truth) {
    return ['truth unavailable'];
  }

  const lines = TRUTH_FIELDS
    .map(([label, getter]) => {
      const value = getter(truth);
      if (value === undefined || value === null || value === '') {
        return null;
      }
      return `${label}: ${formatScalar(value)}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines : ['truth snapshot has no populated fields'];
}

function formatTelemetry(telemetryEntries, maxTelemetryEntries) {
  const safeEntries = Array.isArray(telemetryEntries) ? telemetryEntries : [];
  if (safeEntries.length === 0) {
    return ['no telemetry entries available'];
  }

  const limit = normalizeTelemetryLimit(maxTelemetryEntries);
  return safeEntries.slice(0, limit).map((entry) => {
    const timestamp = sanitizeLine(entry?.timestamp) || 'unknown-time';
    const subsystem = sanitizeLine(entry?.subsystem) || 'UNKNOWN';
    const change = sanitizeLine(entry?.change) || 'no-change';
    const reason = sanitizeLine(entry?.reason);
    const impact = sanitizeLine(entry?.impact);
    const details = [reason ? `reason=${reason}` : null, impact ? `impact=${impact}` : null].filter(Boolean);
    return details.length > 0
      ? `${timestamp} | ${subsystem} | ${change} | ${details.join(' | ')}`
      : `${timestamp} | ${subsystem} | ${change}`;
  });
}

function formatActionHints(actionHints) {
  const safeHints = Array.isArray(actionHints) ? actionHints : [];
  if (safeHints.length === 0) {
    return ['no action hints available'];
  }

  return safeHints.map((hint) => {
    if (typeof hint === 'string') {
      return `info | SYSTEM | ${sanitizeLine(hint)}`;
    }
    const severity = sanitizeLine(hint?.severity) || 'info';
    const subsystem = sanitizeLine(hint?.subsystem) || 'SYSTEM';
    const text = sanitizeLine(hint?.text) || 'no hint text';
    return `${severity} | ${subsystem} | ${text}`;
  });
}


function formatOrchestrationTruth(orchestrationTruth = {}, finalRouteTruth = null) {
  const memory = orchestrationTruth?.canonicalMemoryContext || {};
  const intent = orchestrationTruth?.canonicalCurrentIntent || {};
  const packet = orchestrationTruth?.canonicalMissionPacket || {};
  const guidance = buildOperatorGuidanceProjection({
    finalRouteTruth,
    orchestrationTruth,
    latestResponseEnvelope: orchestrationTruth?.latestResponseEnvelope || null,
  });

  const lines = [
    `memory.continuityLoopState: ${sanitizeLine(memory?.activeMissionContinuity?.continuityLoopState) || 'unknown'}`,
    `memory.sparseData: ${formatScalar(memory?.sparseData === true)}`,
    `intent.operatorIntent: ${sanitizeLine(intent?.operatorIntent?.label) || 'unknown'}`,
    `intent.operatorIntentSource: ${sanitizeLine(intent?.operatorIntent?.source) || 'unknown'}`,
    `intent.executionState: ${sanitizeLine(intent?.executionState?.status) || 'unknown'}`,
    `missionPacket.currentPhase: ${sanitizeLine(packet?.currentPhase) || 'unknown'}`,
    `mission.phase: ${sanitizeLine(guidance?.missionLifecycleSummary?.missionPhase) || 'unknown'}`,
    `mission.lifecycleState: ${sanitizeLine(guidance?.missionLifecycleSummary?.lifecycleState) || 'unknown'}`,
    `mission.blocked: ${formatScalar(guidance?.missionLifecycleSummary?.blocked === true)}`,
    `mission.blockage: ${sanitizeLine(guidance?.missionLifecycleSummary?.blockageReason) || 'none'}`,
    `mission.nextAction: ${sanitizeLine(guidance?.nextStepSummary) || 'Await explicit operator guidance.'}`,
    `actions.availableNow: ${guidance.availableNow.map((entry) => entry.command).join(', ') || 'none'}`,
    `actions.blockedBecause: ${guidance.blockedBecause.map((entry) => `${entry.command}(${entry.reason})`).join(', ') || 'none'}`,
    `buildAssistance.state: ${sanitizeLine(guidance?.buildAssistanceSummary?.state) || 'unavailable'}`,
    `buildAssistance.approvalRequired: ${formatScalar(guidance?.buildAssistanceSummary?.approvalRequired === true)}`,
    `codexHandoff.state: ${sanitizeLine(guidance?.codexReadinessSummary?.state) || 'unavailable'}`,
    `continuity.strength: ${sanitizeLine(guidance?.continuitySummary?.strength) || 'unknown'}`,
  ];

  if (guidance?.operatorCautionSummary?.inferredIntentCaution) {
    lines.push(`caution.inferredIntent: ${guidance.operatorCautionSummary.inferredIntentCaution}`);
  }
  if (guidance?.operatorCautionSummary?.sparseContinuityCaution) {
    lines.push(`caution.sparseContinuity: ${guidance.operatorCautionSummary.sparseContinuityCaution}`);
  }

  if (guidance?.envelopeProjection) {
    lines.push(`latestEnvelope.actionRequested: ${sanitizeLine(guidance.envelopeProjection.actionRequested) || 'n/a'}`);
    lines.push(`latestEnvelope.allowed: ${formatScalar(guidance.envelopeProjection.actionAllowed === true)}`);
    lines.push(`latestEnvelope.applied: ${formatScalar(guidance.envelopeProjection.actionApplied === true)}`);
    lines.push(`latestEnvelope.lifecycleState: ${sanitizeLine(guidance.envelopeProjection.lifecycleState) || 'unknown'}`);
    lines.push(`latestEnvelope.nextAction: ${sanitizeLine(guidance.envelopeProjection.nextRecommendedAction) || 'Await explicit operator guidance.'}`);
  }

  const continuityEvents = Array.isArray(memory?.activeMissionContinuity?.recentEvents)
    ? memory.activeMissionContinuity.recentEvents.slice(0, 3)
    : [];
  if (continuityEvents.length > 0) {
    lines.push(`memory.recentEvents: ${continuityEvents.join(' | ')}`);
  }

  return lines;
}

function appendSection(lines, heading, sectionLines = []) {
  lines.push(`## ${heading}`);
  lines.push(...sectionLines);
  lines.push('');
}

export function buildStephanosPrompt({
  mission,
  finalRouteTruth,
  telemetryEntries,
  actionHints,
  includeTruth = true,
  includeTelemetry = true,
  includeActionHints = true,
  includeConstraints = true,
  maxTelemetryEntries = DEFAULT_MAX_TELEMETRY_ENTRIES,
  constraints = DEFAULT_CONSTRAINTS,
  orchestrationTruth = null,
} = {}) {
  const missionLine = sanitizeLine(mission) || 'Describe the mission objective.';
  const lines = [];

  appendSection(lines, 'CONTEXT', [
    'Stephanos Mission Console prompt compiler output assembled from current runtime truth projections.',
  ]);

  appendSection(lines, 'CURRENT MISSION', [missionLine]);

  if (includeTruth) {
    appendSection(lines, 'CURRENT TRUTH SNAPSHOT', formatTruthSnapshot(finalRouteTruth));
  }

  if (includeTelemetry) {
    appendSection(lines, 'RECENT TELEMETRY', formatTelemetry(telemetryEntries, maxTelemetryEntries));
  }

  if (includeActionHints) {
    appendSection(lines, 'ACTION HINTS', formatActionHints(actionHints));
  }

  if (orchestrationTruth) {
    appendSection(lines, 'ORCHESTRATION TRUTH', formatOrchestrationTruth(orchestrationTruth, finalRouteTruth));
  }

  if (includeConstraints) {
    const safeConstraints = Array.isArray(constraints)
      ? constraints.map((line) => sanitizeLine(line)).filter(Boolean)
      : [];
    appendSection(lines, 'CONSTRAINTS', safeConstraints.length > 0 ? safeConstraints : DEFAULT_CONSTRAINTS);
  }

  appendSection(lines, 'REQUEST', [
    `Implement or debug this mission with minimal drift: ${missionLine}`,
  ]);

  return lines.join('\n').trim();
}

export function buildCopyResult({ clipboard, promptText }) {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return { ok: false, message: 'Copy failed. Select and copy manually.' };
  }

  return clipboard.writeText(promptText)
    .then(() => ({ ok: true, message: 'Prompt copied.' }))
    .catch(() => ({ ok: false, message: 'Copy failed. Select and copy manually.' }));
}

export const PROMPT_BUILDER_DEFAULT_MAX_TELEMETRY = DEFAULT_MAX_TELEMETRY_ENTRIES;
