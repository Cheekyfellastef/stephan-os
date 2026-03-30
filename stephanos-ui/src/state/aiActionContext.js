import { createStephanosMemory } from '../../../shared/runtime/stephanosMemory.mjs';
import { ensureRuntimeStatusModel } from './runtimeStatusDefaults.js';
import { buildFinalRouteTruthView } from './finalRouteTruthView.js';
import {
  buildMissionSummaryMetrics,
  normalizeMissionDashboardState,
  sortMilestonesForOperations,
} from './missionDashboardModel.js';

const MISSION_RECORD_NAMESPACE = 'mission-dashboard';
const MISSION_RECORD_ID = 'project-progress';
const MAX_RECENT_COMMANDS = 4;
const MAX_OPEN_PANES = 8;

function summarizeMilestones(missionState) {
  const ordered = sortMilestonesForOperations(missionState.milestones);
  const topPriority = ordered.slice(0, 6).map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    status: milestone.status,
    percentComplete: milestone.percentComplete,
    blockerFlag: milestone.blockerFlag,
    blockerDetails: milestone.blockerDetails,
    nextAction: milestone.nextAction,
    dependencies: milestone.dependencies,
    updatedAt: milestone.updatedAt,
  }));

  const blockers = ordered
    .filter((milestone) => milestone.blockerFlag || milestone.status === 'blocked')
    .slice(0, 5)
    .map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      category: milestone.category,
      status: milestone.status,
      details: milestone.blockerDetails || 'Blocker flagged; details pending operator input.',
      dependencies: milestone.dependencies,
      updatedAt: milestone.updatedAt,
    }));

  return { topPriority, blockers };
}

function buildWorkspaceSummary({ uiLayout = {}, paneLayout = {} } = {}) {
  const safeUiLayout = uiLayout && typeof uiLayout === 'object' ? uiLayout : {};
  const safePaneLayout = paneLayout && typeof paneLayout === 'object' ? paneLayout : {};
  const openPanes = Object.entries(safeUiLayout)
    .filter(([, isOpen]) => isOpen === true)
    .map(([paneId]) => paneId);

  return {
    openPanelCount: openPanes.length,
    openPanels: openPanes.slice(0, MAX_OPEN_PANES),
    hiddenPanels: Object.entries(safeUiLayout)
      .filter(([, isOpen]) => isOpen === false)
      .map(([paneId]) => paneId)
      .slice(0, MAX_OPEN_PANES),
    paneOrderHead: Array.isArray(safePaneLayout.order) ? safePaneLayout.order.slice(0, MAX_OPEN_PANES) : [],
  };
}

function buildRuntimeSummary(runtimeStatusModel = {}) {
  const runtimeStatus = ensureRuntimeStatusModel(runtimeStatusModel);
  const routeTruthView = buildFinalRouteTruthView(runtimeStatus);

  return {
    appLaunchState: runtimeStatus.appLaunchState,
    headline: runtimeStatus.headline,
    dependencySummary: runtimeStatus.dependencySummary,
    requestedRouteMode: runtimeStatus.requestedRouteMode,
    effectiveRouteMode: runtimeStatus.effectiveRouteMode,
    routeKind: routeTruthView.routeKind,
    requestedProvider: routeTruthView.requestedProvider,
    selectedProvider: routeTruthView.selectedProvider,
    executedProvider: routeTruthView.executedProvider,
    backendReachableState: routeTruthView.backendReachableState,
    preferredTarget: routeTruthView.preferredTarget,
    actualTarget: routeTruthView.actualTarget,
    source: routeTruthView.source,
  };
}

function summarizeRecentCommandHistory(commandHistory = []) {
  return (Array.isArray(commandHistory) ? commandHistory : [])
    .slice(-MAX_RECENT_COMMANDS)
    .map((entry) => ({
      id: entry.id,
      input: String(entry.raw_input || '').slice(0, 180),
      success: entry.success !== false,
      route: entry.route || 'assistant',
      output: String(entry.output_text || '').slice(0, 220),
      timestamp: entry.timestamp || '',
    }));
}

function summarizeDebugData(debugData = {}) {
  if (!debugData || typeof debugData !== 'object') {
    return null;
  }

  return {
    errorCode: debugData.error_code || null,
    activeProviderConfigSource: debugData.activeProviderConfigSource || null,
    actualProviderUsed: debugData.actual_provider_used || null,
    fallbackUsed: debugData.fallback_used === true,
    fallbackReason: debugData.fallback_reason || null,
    timingMs: Number.isFinite(Number(debugData.timing_ms)) ? Number(debugData.timing_ms) : null,
  };
}

export async function readMissionDashboardStateFromMemory() {
  const memory = createStephanosMemory({ source: 'ai-action-context' });
  await memory.hydrate();
  const record = memory.getRecord({ namespace: MISSION_RECORD_NAMESPACE, id: MISSION_RECORD_ID });
  const missionDashboard = record?.payload?.missionDashboard;
  return missionDashboard ? normalizeMissionDashboardState(missionDashboard) : null;
}

export function buildAiActionContext({
  missionState,
  uiLayout,
  paneLayout,
  runtimeStatusModel,
  commandHistory,
  debugData,
  operatorNotes = '',
} = {}) {
  const normalizedMissionState = missionState ? normalizeMissionDashboardState(missionState) : null;
  const missionMetrics = normalizedMissionState ? buildMissionSummaryMetrics(normalizedMissionState) : null;
  const missionSummary = normalizedMissionState ? summarizeMilestones(normalizedMissionState) : { topPriority: [], blockers: [] };

  return {
    contextVersion: 1,
    generatedAt: new Date().toISOString(),
    mission: normalizedMissionState
      ? {
        overallSummary: normalizedMissionState.overallSummary,
        metrics: missionMetrics,
        topPriorityMilestones: missionSummary.topPriority,
        activeBlockers: missionSummary.blockers,
      }
      : null,
    workspace: buildWorkspaceSummary({ uiLayout, paneLayout }),
    runtime: buildRuntimeSummary(runtimeStatusModel),
    recentDiagnostics: {
      commands: summarizeRecentCommandHistory(commandHistory),
      debug: summarizeDebugData(debugData),
    },
    operatorNotes: String(operatorNotes || '').trim() || null,
    missingContext: {
      missionState: !normalizedMissionState,
      workspaceState: !uiLayout || typeof uiLayout !== 'object',
      runtimeState: !runtimeStatusModel || typeof runtimeStatusModel !== 'object',
    },
  };
}
