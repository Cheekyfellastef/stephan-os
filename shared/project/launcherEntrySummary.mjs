import { buildStephanosTileTruthProjection } from '../../modules/command-deck/stephanosTileTruthProjection.mjs';
import { buildShortcutStatusSummary } from './shortcutStatusSummary.mjs';

const STATUS_WEIGHT = Object.freeze({
  unavailable: 0,
  not_started: 18,
  started: 42,
  partial: 60,
  ready: 90,
  degraded: 36,
  blocked: 14,
  unknown: 25,
});

function asText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function normalizeLandingSummary(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    overallStatus: asText(value.overallStatus),
    nextAction: asText(value.nextAction),
    topBlocker: asText(value.topBlocker),
    safetyLabel: asText(value.safetyLabel),
    lines: asArray(value.lines),
    summary: asText(value.summary),
    raw: value,
  };
}

function hasDiagnosticOverload(landingSummary) {
  if (!landingSummary?.raw || typeof landingSummary.raw !== 'object') return false;
  const keys = Object.keys(landingSummary.raw);
  if (keys.length > 8) return true;
  const noisyKey = keys.some((key) => /(diagnostic|adapter|killswitch|kill_switch|forensic|stack|trace)/i.test(key));
  if (noisyKey) return true;
  if (landingSummary.lines.length > 7) return true;
  return landingSummary.summary.length > 280;
}

function inferStatusFromCoverage({ landingTilePresent, compactSummaryAvailable, diagnosticOverloadRisk, shortcutSurfaces }) {
  if (!landingTilePresent) return 'unavailable';
  if (diagnosticOverloadRisk) return 'degraded';
  const availableShortcuts = shortcutSurfaces.filter((entry) => entry.present).length;
  const missingStatus = shortcutSurfaces.filter((entry) => entry.present && !entry.statusSummaryAvailable).length;

  if (!compactSummaryAvailable) return 'started';
  if (availableShortcuts === 0) return 'started';
  if (missingStatus > 0) return availableShortcuts >= 2 ? 'partial' : 'started';
  if (availableShortcuts >= 2) return 'ready';
  return 'partial';
}

function toShortcutSurface(entry = {}) {
  return {
    id: asText(entry.shortcutId || entry.id),
    label: asText(entry.label),
    targetSurface: asText(entry.targetSurface),
    status: asText(entry.status, 'unknown'),
    present: entry.present === true,
    statusSummaryAvailable: entry.statusSummaryAvailable === true,
    compactStatus: asText(entry.compactStatus),
    nextAction: asText(entry.nextAction),
    blocker: asText(entry.blocker),
    warning: asText(entry.warning),
    evidence: asArray(entry.evidence),
  };
}

export function buildLauncherEntrySummary({
  runtimeStatusModel = {},
  stephanosTileProjection = null,
  landingTileSummary = null,
  agentSurfaceProjection = {},
  shortcutSurfaces = null,
} = {}) {
  const normalizedRuntimeStatus = runtimeStatusModel && typeof runtimeStatusModel === 'object' ? runtimeStatusModel : {};
  const projection = stephanosTileProjection && typeof stephanosTileProjection === 'object'
    ? stephanosTileProjection
    : buildStephanosTileTruthProjection({
      dependencyState: asText(normalizedRuntimeStatus?.appLaunchState, 'unknown'),
      runtimeStatusModel: normalizedRuntimeStatus,
    });

  const compactLandingSummary = normalizeLandingSummary(landingTileSummary || projection?.landingTileSummary);
  const landingTilePresent = Boolean(compactLandingSummary && compactLandingSummary.summary);
  const landingTileCompact = landingTilePresent && compactLandingSummary.lines.length > 0 && compactLandingSummary.lines.length <= 7;
  const compactSummaryAvailable = landingTileCompact;
  const diagnosticOverloadRisk = hasDiagnosticOverload(compactLandingSummary);

  const inferredShortcuts = buildShortcutStatusSummary([
    {
      shortcutId: 'stephanos-tile-entry',
      label: 'Stephanos Tile',
      targetSurface: 'landing-tile',
      present: projection?.launchState && projection?.launchState !== 'unavailable',
      statusSummaryAvailable: Boolean(compactLandingSummary?.summary),
      compactStatus: compactLandingSummary?.overallStatus,
      evidence: compactLandingSummary?.summary ? [`Landing tile summary: ${compactLandingSummary.summary}`] : [],
    },
    {
      shortcutId: 'agent-tile-entry',
      label: 'Agent Tile',
      targetSurface: 'agent-tile',
      present: Boolean(agentSurfaceProjection?.launcherSummary),
      statusSummaryAvailable: Boolean(agentSurfaceProjection?.launcherSummary?.summaryLabel),
      compactStatus: asText(agentSurfaceProjection?.launcherSummary?.summaryLabel),
      evidence: agentSurfaceProjection?.launcherSummary?.summaryLabel
        ? [`Agent launcher summary: ${agentSurfaceProjection.launcherSummary.summaryLabel}`]
        : [],
    },
    {
      shortcutId: 'openclaw-entry',
      label: 'OpenClaw Entry Surface',
      targetSurface: 'agent-tile',
      present: asText(normalizedRuntimeStatus?.runtimeContext?.launchSurface).toLowerCase().includes('openclaw')
        || asText(normalizedRuntimeStatus?.finalRouteTruth?.launchSurface).toLowerCase().includes('openclaw')
        || Boolean(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawReadiness),
      statusSummaryAvailable: Boolean(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubStatus),
      compactStatus: asText(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubStatus),
      nextAction: asText(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubNextAction),
      blocker: asText(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubHighestPriorityBlocker),
      warning: asArray(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubWarnings)[0],
      evidence: asArray(normalizedRuntimeStatus?.agentTaskReadinessSummary?.openClawAdapterStubEvidence),
    },
  ]);

  const surfaces = Array.isArray(shortcutSurfaces) && shortcutSurfaces.length > 0
    ? buildShortcutStatusSummary(shortcutSurfaces).map((entry) => toShortcutSurface(entry))
    : inferredShortcuts.map((entry) => toShortcutSurface(entry));

  const stephanosTileEntryPresent = surfaces.some((entry) => entry.id === 'stephanos-tile-entry' && entry.present);
  const agentTileEntryPresent = surfaces.some((entry) => entry.id === 'agent-tile-entry' && entry.present);
  const missingShortcutStatus = surfaces.filter((entry) => entry.present && !entry.statusSummaryAvailable);
  const status = inferStatusFromCoverage({
    landingTilePresent,
    compactSummaryAvailable,
    diagnosticOverloadRisk,
    shortcutSurfaces: surfaces,
  });

  let nextAction = 'Keep launcher entry shortcuts status-bound to shared summaries.';
  if (!landingTilePresent) {
    nextAction = 'Export compact landing tile summary from shared launcher-entry projection.';
  } else if (diagnosticOverloadRisk) {
    nextAction = 'Declutter landing tile summary to compact status/action/blocker format.';
  } else if (missingShortcutStatus.length > 0) {
    nextAction = `Populate shortcut status summary for ${missingShortcutStatus[0].label}.`;
  }

  const warnings = [
    ...surfaces.filter((entry) => entry.warning).map((entry) => `Shortcut warning (${entry.label}): ${entry.warning}`),
  ];
  if (missingShortcutStatus.length > 0) {
    warnings.push(`Shortcut status missing: ${missingShortcutStatus.map((entry) => entry.label).join(', ')}.`);
  }

  const blockers = [
    ...surfaces.filter((entry) => entry.blocker).map((entry) => `Shortcut blocker (${entry.label}): ${entry.blocker}`),
  ];
  if (!landingTilePresent) {
    blockers.push('Landing tile summary is missing from launcher-entry projection evidence.');
  }
  if (diagnosticOverloadRisk) {
    blockers.push('Landing tile summary includes verbose diagnostics and risks launcher overload.');
  }

  const evidence = [
    compactLandingSummary?.summary ? `Landing compact summary: ${compactLandingSummary.summary}` : '',
    ...surfaces
      .filter((entry) => entry.present)
      .map((entry) => `Shortcut: ${entry.label}${entry.compactStatus ? ` (${entry.compactStatus})` : ''}`),
    ...surfaces.flatMap((entry) => entry.evidence || []),
  ].filter(Boolean);

  const dashboardSummaryText = landingTilePresent
    ? `Launcher entry ${status.replace(/_/g, ' ')} · ${missingShortcutStatus.length === 0 ? 'shortcut status coverage present' : `${missingShortcutStatus.length} shortcut status gap(s)`}.`
    : 'Launcher entry unavailable: no compact landing summary evidence.';
  const compactSummaryText = compactLandingSummary?.summary
    ? compactLandingSummary.summary
    : dashboardSummaryText;

  const readinessScore = STATUS_WEIGHT[status] ?? STATUS_WEIGHT.unknown;

  return {
    systemId: 'launcher-entry',
    label: 'Launcher Entry',
    available: landingTilePresent || surfaces.some((entry) => entry.present),
    status,
    readinessScore,
    landingTilePresent,
    stephanosTileEntryPresent,
    agentTileEntryPresent,
    shortcutSurfaces: surfaces,
    compactSummaryAvailable,
    landingTileCompact,
    diagnosticOverloadRisk,
    nextAction,
    blockers,
    warnings,
    evidence,
    dashboardSummaryText,
    compactSummaryText,
  };
}
