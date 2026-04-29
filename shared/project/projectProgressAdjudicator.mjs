import {
  createSeedProjectProgressModel,
  getProjectStatusScore,
  normalizeProjectProgressModel,
} from './projectProgressModel.mjs';
import { buildLauncherEntrySummary } from './launcherEntrySummary.mjs';

const PHASES = Object.freeze([
  { min: 85, id: 'deployment-readiness', label: 'Deployment Readiness' },
  { min: 70, id: 'stabilization', label: 'Stabilization & Hardening' },
  { min: 52, id: 'integration', label: 'Integration Buildout' },
  { min: 0, id: 'foundation', label: 'Foundation & Dependency Closure' },
]);

const DEFAULT_NEXT_ACTIONS = Object.freeze([
  {
    id: 'build-agent-task-layer-v1',
    title: 'Build Agent Task Layer v1',
    reason: 'Required before safe Codex/OpenClaw orchestration.',
    blocks: ['Codex handoff', 'OpenClaw control', 'Verification loop'],
    dependencyImpact: 100,
    whyThisMatters: 'Creates canonical task packet lifecycle so project progress, approvals, and execution are adjudicated from one truth source.',
  },
  {
    id: 'upgrade-agents-tile-status-surface',
    title: 'Upgrade Agents Tile / Agent Status Surface',
    reason: 'Operator needs visual feedback for task state, approvals, and agent progress.',
    blocks: ['Safe multi-agent workflow'],
    dependencyImpact: 82,
    whyThisMatters: 'Without a clear operator surface, supervision and approvals degrade as agent complexity grows.',
  },
  {
    id: 'add-codex-handoff-mode',
    title: 'Add Codex Handoff Mode',
    reason: 'Allows structured task packets to be generated and passed to Codex.',
    blocks: ['Supervised coding task loop'],
    dependencyImpact: 74,
    whyThisMatters: 'Turns free-form summaries into machine-readable handoffs with expectations and evidence links.',
  },
  {
    id: 'add-verification-return-loop',
    title: 'Add Verification Return Loop',
    reason: 'Allows Codex/OpenClaw output to be checked against build, verify, doctrine, and runtime truth.',
    blocks: ['Safe merge/deploy decisions'],
    dependencyImpact: 67,
    whyThisMatters: 'Prevents merges from relying on claimed completion without truth-gated verification evidence.',
  },
  {
    id: 'add-telemetry-summary-export',
    title: 'Add Telemetry summary export',
    reason: 'Mission Dashboard needs a shared telemetry summary projection instead of panel-local heuristics.',
    blocks: ['Telemetry lane adjudication', 'Telemetry-aware next actions'],
    dependencyImpact: 66,
    whyThisMatters: 'Keeps telemetry truth in a shared exporter so dashboard/tile surfaces consume one canonical summary.',
  },
  {
    id: 'bind-telemetry-lifecycle-context',
    title: 'Bind telemetry summary to agent/task lifecycle',
    reason: 'Telemetry summary exists but recent lifecycle transitions are not yet bound consistently.',
    blocks: ['Lifecycle-aware telemetry readiness'],
    dependencyImpact: 65,
    whyThisMatters: 'Prevents stale telemetry from looking healthy when active mission transitions are missing.',
  },
  {
    id: 'add-prompt-builder-summary-export',
    title: 'Add Prompt Builder summary export',
    reason: 'Mission Dashboard needs shared Prompt Builder capability truth for project progression.',
    blocks: ['Prompt Builder lane adjudication', 'Prompt Builder dependency tracking'],
    dependencyImpact: 64,
    whyThisMatters: 'Moves prompt-builder readiness logic out of dashboard UI and into shared canonical projection.',
  },
  {
    id: 'bind-prompt-builder-contexts',
    title: 'Bind Prompt Builder summary to mission contexts',
    reason: 'Prompt Builder summary exists but key contexts are not all bound yet.',
    blocks: ['Prompt handoff quality', 'Context-complete prompt packets'],
    dependencyImpact: 63,
    whyThisMatters: 'Ensures telemetry, agent-task, and runtime truth contexts are represented before handoff automation work.',
  },
  {
    id: 'add-launcher-entry-summary-export',
    title: 'Add Launcher Entry summary export',
    reason: 'Mission surfaces need shared launcher-entry summary truth instead of wiring-gap fallbacks.',
    blocks: ['Launcher Agents Entry milestone binding'],
    dependencyImpact: 62,
    whyThisMatters: 'Keeps launcher entry truth shared between dashboard and handoff without UI-local heuristics.',
  },
  {
    id: 'declutter-landing-tile-summary',
    title: 'Declutter landing tile summary',
    reason: 'Landing tile summary must stay compact and shortcut-first.',
    blocks: ['Launcher compact status readability'],
    dependencyImpact: 61,
    whyThisMatters: 'Prevents diagnostic overload from displacing launcher entry actions.',
  },
  {
    id: 'populate-launcher-shortcut-status',
    title: 'Populate launcher shortcut status',
    reason: 'Shortcut surfaces exist but status summary projection is incomplete.',
    blocks: ['Launcher entry milestone completeness'],
    dependencyImpact: 59,
    whyThisMatters: 'Maintains compact launcher tiles while preserving actionable shortcut status truth.',
  },
  {
    id: 'wire-openclaw-kill-switch',
    title: 'Wire OpenClaw Kill Switch',
    reason: 'Policy harness exists in policy-only mode; next unmet dependency is kill-switch wiring.',
    blocks: ['Safe UI/browser/local automation'],
    dependencyImpact: 60,
    whyThisMatters: 'Adds first-class safety cutoff truth before any adapter execution contract can be considered.',
  },
  {
    id: 'design-openclaw-local-adapter',
    title: 'Design OpenClaw local adapter contract',
    reason: 'Kill switch exists, but no local adapter contract is available.',
    blocks: ['OpenClaw execution contract'],
    dependencyImpact: 55,
    whyThisMatters: 'Preserves policy/kill-switch guardrails while defining supervised execution boundaries.',
  },
  {
    id: 'create-openclaw-local-adapter-stub',
    title: 'Create OpenClaw local adapter stub',
    reason: 'Adapter contract exists but no local stub is available.',
    blocks: ['OpenClaw local adapter connectivity'],
    dependencyImpact: 53,
    whyThisMatters: 'Creates non-executing adapter implementation evidence before connection work.',
  },
  {
    id: 'configure-openclaw-adapter-endpoint',
    title: 'Configure OpenClaw local adapter endpoint',
    reason: 'Adapter endpoint configuration model is required before readonly telemetry validation.',
    blocks: ['Readonly health/handshake validation'],
    dependencyImpact: 52,
    whyThisMatters: 'Keeps endpoint truth explicit without implying connection or execution.',
  },
  {
    id: 'add-safe-readonly-openclaw-validation-endpoint',
    title: 'Add safe readonly OpenClaw validation endpoint',
    reason: 'Endpoint is configured, but no safe readonly probe path is declared yet.',
    blocks: ['Readonly health/handshake validation'],
    dependencyImpact: 51,
    whyThisMatters: 'Preserves readonly-only verification posture without reverting endpoint readiness claims.',
  },
  {
    id: 'validate-openclaw-health-handshake-readonly',
    title: 'Validate readonly OpenClaw health/handshake',
    reason: 'Endpoint is configured but readonly health/handshake has not been validated yet.',
    blocks: ['Compatibility readiness evidence'],
    dependencyImpact: 51,
    whyThisMatters: 'Advances status-only compatibility evidence while preserving non-executing posture.',
  },
  {
    id: 'complete-openclaw-approval-gates',
    title: 'Complete OpenClaw approval gates',
    reason: 'Adapter exists but required approvals are not complete.',
    blocks: ['Operator-authorized OpenClaw execution'],
    dependencyImpact: 50,
    whyThisMatters: 'Prevents execution from bypassing explicit operator approval gates.',
  },
]);

function resolvePhase(score) {
  return PHASES.find((phase) => score >= phase.min) || PHASES[PHASES.length - 1];
}

function pickLane(lanes, id) {
  return lanes.find((lane) => lane.id === id) || null;
}

function laneStatusIs(lane, statuses = []) {
  if (!lane) return false;
  return statuses.includes(lane.status);
}

function normalizeAgentTaskReadinessSummary(summary = {}) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const toText = (value, fallback = 'unknown') => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  const toLower = (value, fallback = 'unknown') => toText(value, fallback).toLowerCase();
  const blockersSource = Array.isArray(source.blockers) ? source.blockers : source.agentTaskLayerBlockers;
  const blockers = Array.isArray(blockersSource)
    ? blockersSource.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const warnings = Array.isArray(source.warnings)
    ? source.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const evidence = Array.isArray(source.evidence)
    ? source.evidence.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const nextActions = Array.isArray(source.nextActions)
    ? source.nextActions
      .map((entry) => ({
        title: toText(entry?.title, ''),
        reason: toText(entry?.reason, ''),
        blocks: Array.isArray(entry?.blocks) ? entry.blocks.map((item) => toText(item, '')).filter(Boolean) : [],
      }))
      .filter((entry) => entry.title.length > 0)
    : [];
  const nextAgentTaskAction = toText(source.nextAgentTaskAction || nextActions[0]?.title, '');

  return {
    available: Object.keys(source).length > 0,
    systemId: toText(source.systemId, 'agent-task-layer'),
    label: toText(source.label, 'Agent Task Layer'),
    status: toLower(source.status, ''),
    phase: toText(source.phase, 'unknown'),
    agentTaskLayerStatus: toLower(source.agentTaskLayerStatus || source.status),
    codexReadiness: toLower(source.codexReadiness),
    openClawReadiness: toLower(source.openClawReadiness),
    verificationStatus: toLower(source.verificationStatus, 'unknown'),
    verificationReturnStatus: toLower(source.verificationReturnStatus, 'unknown'),
    verificationDecision: toLower(source.verificationDecision, 'not_ready'),
    mergeReadiness: toLower(source.mergeReadiness, 'not_ready'),
    verificationReturnReady: source.verificationReturnReady === true,
    verificationReturnBlockers: Array.isArray(source.verificationReturnBlockers)
      ? source.verificationReturnBlockers.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    verificationReturnWarnings: Array.isArray(source.verificationReturnWarnings)
      ? source.verificationReturnWarnings.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    verificationReturnNextAction: toText(source.verificationReturnNextAction, ''),
    missingRequiredChecks: Array.isArray(source.missingRequiredChecks)
      ? source.missingRequiredChecks.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    highestPriorityGate: toText(source.highestPriorityGate, 'none'),
    openClawKillSwitchState: toLower(source.openClawKillSwitchState, 'unknown'),
    openClawKillSwitchMode: toLower(source.openClawKillSwitchMode, 'unavailable'),
    openClawSafeToUse: source.openClawSafeToUse === true,
    openClawExecutionAllowed: source.openClawExecutionAllowed === true,
    openClawPolicyOnly: source.openClawDirectAutomationDisabled === true || toLower(source.openClawIntegrationMode, 'policy_only') === 'policy_only',
    openClawAdapterPresent: source.openClawAdapterPresent === true,
    openClawApprovalsComplete: source.openClawApprovalsComplete === true,
    openClawAdapterMode: toLower(source.openClawAdapterMode, 'design_only'),
    openClawAdapterReadiness: toLower(source.openClawAdapterReadiness, 'needs_contract'),
    openClawAdapterConnectionState: toLower(source.openClawAdapterConnectionState, 'not_configured'),
    openClawAdapterEndpointConfigured: source.openClawAdapterEndpointConfigured === true,
    openClawAdapterConnectionConfigReady: source.openClawAdapterConnectionConfigReady === true,
    openClawReadonlyValidationEndpointAvailable: source.openClawReadonlyValidationEndpointAvailable === true,
    openClawReadonlyValidationEndpointPath: toText(source.openClawReadonlyValidationEndpointPath, ''),
    openClawReadonlyValidationEndpointMode: toLower(
      source.openClawReadonlyValidationEndpointMode,
      source.openClawReadonlyValidationEndpointAvailable === true ? 'local_readonly_probe' : 'missing',
    ),
    openClawReadonlyValidationEndpointCanExecute: source.openClawReadonlyValidationEndpointCanExecute === true,
    openClawAdapterEndpointScope: toLower(source.openClawAdapterEndpointScope, 'none'),
    openClawAdapterAllowedProbeTypes: toLower(source.openClawAdapterAllowedProbeTypes, 'none'),
    openClawHealthState: toLower(source.openClawHealthState, 'not_run'),
    openClawHandshakeState: toLower(source.openClawHandshakeState, 'not_run'),
    openClawAdapterStubStatus: toLower(source.openClawAdapterStubStatus, 'unknown'),
    openClawAdapterStubConnectionState: toLower(source.openClawAdapterStubConnectionState, 'unknown'),
    openClawAdapterStubCanExecute: source.openClawAdapterStubCanExecute === true,
    openClawAdapterEvidenceContract: Array.isArray(source.openClawAdapterEvidenceContract)
      ? source.openClawAdapterEvidenceContract.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    openClawStageEvidence: source.openClawStageEvidence && typeof source.openClawStageEvidence === 'object'
      ? source.openClawStageEvidence
      : {},
    openClawIntegrationMode: toLower(source.openClawIntegrationMode, 'policy_only'),
    openClawAdapterStubEvidence: Array.isArray(source.openClawAdapterStubEvidence)
      ? source.openClawAdapterStubEvidence.map((entry) => toText(entry, '')).filter(Boolean)
      : [],
    codexManualHandoffMode: toLower(source.codexManualHandoffMode || source.codexHandoffPacketMode, 'unknown'),
    codexManualHandoffReady: source.codexManualHandoffReady === true || source.codexHandoffPacketReady === true,
    nextAgentTaskAction,
    nextActions,
    readinessScore: Number.isFinite(Number(source.readinessScore)) ? Math.max(0, Math.min(100, Number(source.readinessScore))) : null,
    blockers,
    warnings,
    evidence,
  };
}

function hasAgentTaskLayerEvidence(summary = {}) {
  if (!summary.available) return false;
  if (summary.evidence.length > 0) return true;
  if (summary.nextActions.length > 0) return true;
  return !['unknown', 'not_started', 'preparing'].includes(summary.agentTaskLayerStatus);
}

function hasVerificationReturnState(summary = {}) {
  if (!summary.available) return false;
  if (summary.verificationReturnReady === true) return true;
  if (summary.verificationReturnNextAction) return true;
  if (summary.verificationReturnBlockers.length > 0 || summary.verificationReturnWarnings.length > 0) return true;
  return !['unknown', 'none', 'not_started'].includes(summary.verificationReturnStatus);
}


function hasOpenClawConnectionReadiness(summary = {}) {
  const state = String(summary.openClawAdapterConnectionState || '').toLowerCase();
  return ['health_check_ready', 'handshake_ready', 'connected_readonly'].includes(state)
    || summary.openClawAdapterConnectionReady === true;
}

function hasOpenClawStubEvidence(summary = {}) {
  return ['health_check_only', 'simulated_ready', 'present_disabled'].includes(summary.openClawAdapterStubStatus)
    || ['local_only', 'simulated', 'connected'].includes(summary.openClawAdapterStubConnectionState)
    || summary.openClawAdapterMode === 'local_stub'
    || (Array.isArray(summary.openClawAdapterStubEvidence) && summary.openClawAdapterStubEvidence.length > 0);
}

function collectSuppressedActionIds({ agentTaskSummary, telemetry, promptBuilder, launcherEntry }) {
  const suppressed = new Set();
  const hasAgentLayer = hasAgentTaskLayerEvidence(agentTaskSummary);
  if (hasAgentLayer) {
    suppressed.add('build-agent-task-layer-v1');
  }
  if (hasAgentLayer && !/wire existing agent tile/i.test(agentTaskSummary.nextAgentTaskAction || '')) {
    suppressed.add('upgrade-agents-tile-status-surface');
  }
  if (['manual_handoff_only', 'ready'].includes(agentTaskSummary.codexReadiness) || agentTaskSummary.codexManualHandoffReady) {
    suppressed.add('add-codex-handoff-mode');
  }
  if (hasVerificationReturnState(agentTaskSummary)) {
    suppressed.add('add-verification-return-loop');
  }
  if (telemetry.available) {
    suppressed.add('add-telemetry-summary-export');
    if (['bound', 'partial'].includes(telemetry.lifecycleBindingStatus)) {
      suppressed.add('bind-telemetry-lifecycle-context');
    }
  }
  if (promptBuilder.available) {
    suppressed.add('add-prompt-builder-summary-export');
  }
  if (promptBuilder.available
    && promptBuilder.supportsAgentTaskContext
    && promptBuilder.supportsTelemetryContext
    && promptBuilder.supportsRuntimeTruthContext) {
    suppressed.add('bind-prompt-builder-contexts');
  }
  if (launcherEntry?.available) {
    suppressed.add('add-launcher-entry-summary-export');
    if (launcherEntry.diagnosticOverloadRisk !== true) {
      suppressed.add('declutter-landing-tile-summary');
    }
    if (!Array.isArray(launcherEntry.shortcutSurfaces)
      || !launcherEntry.shortcutSurfaces.some((entry) => entry?.present && entry?.statusSummaryAvailable !== true)) {
      suppressed.add('populate-launcher-shortcut-status');
    }
  }
  if (agentTaskSummary.openClawStageEvidence?.killSwitchRepresented === true
    || (agentTaskSummary.openClawKillSwitchState && !['missing', 'unknown', 'unavailable'].includes(agentTaskSummary.openClawKillSwitchState))) {
    suppressed.add('wire-openclaw-kill-switch');
  }
  const hasContractEvidence = !['design_only', 'unavailable', 'unknown'].includes(agentTaskSummary.openClawAdapterMode)
    || ['contract_defined', 'local_stub', 'connected'].includes(agentTaskSummary.openClawAdapterReadiness)
    || agentTaskSummary.openClawStageEvidence?.adapterContractPresent === true
    || (Array.isArray(agentTaskSummary.openClawAdapterEvidenceContract) && agentTaskSummary.openClawAdapterEvidenceContract.length > 0);
  if (hasContractEvidence) {
    suppressed.add('design-openclaw-local-adapter');
  }
  if (hasOpenClawStubEvidence(agentTaskSummary)) {
    suppressed.add('create-openclaw-local-adapter-stub');
  }
  if (hasOpenClawConnectionReadiness(agentTaskSummary)
    || agentTaskSummary.openClawAdapterConnectionState === 'configured_not_checked'
    || agentTaskSummary.openClawAdapterConnectionConfigReady === true) {
    suppressed.add('configure-openclaw-adapter-endpoint');
  }
  if (agentTaskSummary.openClawAdapterConnectionState === 'connected') {
    suppressed.add('configure-openclaw-adapter-endpoint');
    suppressed.add('validate-openclaw-health-handshake-readonly');
  }
  if (!agentTaskSummary.openClawReadonlyValidationEndpointAvailable) {
    suppressed.add('validate-openclaw-health-handshake-readonly');
  } else if (!shouldValidateReadonlyHealthHandshake(agentTaskSummary)) {
    suppressed.add('validate-openclaw-health-handshake-readonly');
  }
  if (agentTaskSummary.openClawApprovalsComplete) {
    suppressed.add('complete-openclaw-approval-gates');
  }
  return suppressed;
}

function prioritizeAction(actions, actionId) {
  const index = actions.findIndex((action) => action.id === actionId);
  if (index <= 0) return actions;
  const [selected] = actions.splice(index, 1);
  actions.unshift(selected);
  return actions;
}

function resolveAgentTaskActionIndex(nextAgentTaskAction = '') {
  const normalized = String(nextAgentTaskAction || '').trim().toLowerCase();
  if (!normalized) return -1;
  if (normalized.includes('build canonical agent task model')) return 0;
  if (normalized.includes('wire existing agent tile')) return 1;
  if (normalized.includes('codex manual handoff')) return 2;
  if (normalized.includes('verification return state')) return 3;
  if (normalized.includes('openclaw policy harness')) return 4;
  if (normalized.includes('openclaw kill switch')) return 4;
  if (normalized.includes('kill-switch lifecycle')) return 4;
  if (normalized.includes('design openclaw local adapter')) return 5;
  if (normalized.includes('create openclaw local adapter stub')) return 6;
  if (normalized.includes('connect openclaw local adapter')) return 7;
  if (normalized.includes('approval gate')) return 8;
  if (normalized.includes('approval-gate')) return 6;
  if (normalized.includes('paste codex result for verification')) return 3;
  return -1;
}

function mapDashboardStatusToProjectStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'preparing') return 'not-started';
  if (normalized === 'started') return 'started';
  if (normalized === 'in_progress') return 'started';
  if (normalized === 'partial') return 'partial';
  if (normalized === 'ready') return 'ready';
  if (normalized === 'complete') return 'complete';
  if (normalized === 'blocked') return 'blocked';
  return 'unknown';
}

function mapCodexReadinessToLaneStatus(readiness = '') {
  const normalized = String(readiness || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'manual_handoff_only') return 'started';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'unavailable') return 'not-started';
  return 'partial';
}

function mapOpenClawReadinessToLaneStatus(readiness = '') {
  const normalized = String(readiness || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (['needs_policy', 'needs_adapter', 'blocked', 'unavailable'].includes(normalized)) return 'blocked';
  return 'partial';
}

function mapVerificationToLaneStatus(verificationStatus = '') {
  const normalized = String(verificationStatus || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'started') return 'started';
  if (normalized === 'partial') return 'partial';
  return 'unknown';
}


function normalizeTelemetrySummary(summary = {}) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const toText = (value, fallback = '') => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  const toLower = (value, fallback = 'unknown') => toText(value, fallback).toLowerCase();
  const list = (value) => Array.isArray(value) ? value.map((entry) => toText(entry, '')).filter(Boolean) : [];
  return {
    available: Object.keys(source).length > 0,
    status: toLower(source.status, 'unknown'),
    nextActions: list(source.nextActions),
    blockers: list(source.blockers),
    warnings: list(source.warnings),
    evidence: list(source.evidence),
    lifecycleBindingStatus: toLower(source.lifecycleBindingStatus, 'unknown'),
    lifecycleBindingNextAction: toText(source.lifecycleBindingNextAction, ''),
  };
}

function normalizePromptBuilderSummary(summary = {}) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const toText = (value, fallback = '') => {
    const text = String(value || '').trim();
    return text || fallback;
  };
  const toLower = (value, fallback = 'unknown') => toText(value, fallback).toLowerCase();
  const list = (value) => Array.isArray(value) ? value.map((entry) => toText(entry, '')).filter(Boolean) : [];
  return {
    available: Object.keys(source).length > 0,
    status: toLower(source.status, 'unknown'),
    supportsAgentTaskContext: source.supportsAgentTaskContext === true || source.agentTaskContextAvailable === true,
    supportsTelemetryContext: source.supportsTelemetryContext === true || source.telemetryContextAvailable === true,
    supportsRuntimeTruthContext: source.supportsRuntimeTruthContext === true || source.runtimeTruthContextAvailable === true,
    nextActions: list(source.nextActions),
    blockers: list(source.blockers),
    warnings: list(source.warnings),
    evidence: list(source.evidence),
  };
}

function mapTelemetryToLaneStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'flowing') return 'ready';
  if (normalized === 'started') return 'started';
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'degraded') return 'partial';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'unavailable') return 'not-started';
  return 'unknown';
}

function mapPromptBuilderToLaneStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'started') return 'started';
  if (normalized === 'partial') return 'partial';
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'unavailable') return 'not-started';
  return 'unknown';
}

function mapLauncherEntryToLaneStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'ready') return 'ready';
  if (normalized === 'partial') return 'partial';
  if (normalized === 'started') return 'started';
  if (normalized === 'not_started') return 'not-started';
  if (normalized === 'degraded') return 'blocked';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'unavailable') return 'not-started';
  return 'unknown';
}

function summarizePromptBuilderEvidence(promptBuilder = {}) {
  if (!promptBuilder.available) return 'prompt-builder:unavailable';
  const missingContexts = [];
  if (!promptBuilder.supportsAgentTaskContext) missingContexts.push('agent-task-context');
  if (!promptBuilder.supportsTelemetryContext) missingContexts.push('telemetry-context');
  if (!promptBuilder.supportsRuntimeTruthContext) missingContexts.push('runtime-truth-context');
  if (missingContexts.length === 0) return `prompt-builder:${promptBuilder.status || 'ready'}`;
  return `prompt-builder:${promptBuilder.status || 'partial'}:missing-${missingContexts.join(',')}`;
}

function hasSafeReadonlyValidationProbe(agentTaskSummary = {}) {
  const allowedProbeTypes = String(agentTaskSummary.openClawAdapterAllowedProbeTypes || '').trim().toLowerCase();
  if (['health_only', 'handshake_only', 'health_and_handshake'].includes(allowedProbeTypes)) return true;
  const mode = String(agentTaskSummary.openClawReadonlyValidationEndpointMode || '').trim().toLowerCase();
  const path = String(agentTaskSummary.openClawReadonlyValidationEndpointPath || '').trim();
  return agentTaskSummary.openClawReadonlyValidationEndpointAvailable === true
    && mode === 'local_readonly_probe'
    && agentTaskSummary.openClawReadonlyValidationEndpointCanExecute !== true
    && /\/api\/openclaw\/health-handshake\/validate-readonly$/i.test(path);
}

function shouldValidateReadonlyHealthHandshake(agentTaskSummary = {}) {
  const health = String(agentTaskSummary.openClawHealthState || 'not_run').trim().toLowerCase();
  const handshake = String(agentTaskSummary.openClawHandshakeState || 'not_run').trim().toLowerCase();
  return ['not_run', 'unknown'].includes(health) || ['not_run', 'unknown'].includes(handshake);
}

function summarizeOpenClawStageEvidence(agentTaskSummary = {}) {
  if (!agentTaskSummary.available) return [];
  const stage = agentTaskSummary.openClawStageEvidence && typeof agentTaskSummary.openClawStageEvidence === 'object'
    ? agentTaskSummary.openClawStageEvidence
    : {};
  const policy = stage.policyMode || (agentTaskSummary.openClawPolicyOnly ? 'policy_only' : (agentTaskSummary.openClawReadiness || 'unknown'));
  const killSwitch = stage.killSwitchState || agentTaskSummary.openClawKillSwitchState || 'unknown';
  const adapterReadiness = stage.adapterReadiness || agentTaskSummary.openClawAdapterReadiness || '';
  const adapterMode = stage.adapterMode || agentTaskSummary.openClawAdapterMode || '';
  const adapter = ['blocked', 'unknown', 'needs_connection'].includes(String(adapterReadiness || '').toLowerCase())
    ? (adapterMode || adapterReadiness || 'unknown')
    : (adapterReadiness || adapterMode || 'unknown');
  const stub = stage.stubStatus || agentTaskSummary.openClawAdapterStubStatus || 'unknown';
  const connection = stage.connectionState || agentTaskSummary.openClawAdapterConnectionState || 'unknown';
  const executionAllowed = stage.executionAllowed === true || agentTaskSummary.openClawExecutionAllowed === true;
  return [
    `openclaw-policy:${policy}`,
    `openclaw-kill-switch:${killSwitch}`,
    `openclaw-adapter:${adapter}`,
    `openclaw-stub:${stub}`,
    `openclaw-connection:${connection}`,
    `openclaw-validation-endpoint:${agentTaskSummary.openClawReadonlyValidationEndpointAvailable ? 'available' : 'missing'}`,
    `openclaw-execution:${executionAllowed ? 'enabled' : 'disabled'}`,
  ];
}


export function adjudicateProjectProgress({
  model = createSeedProjectProgressModel(),
  runtimeStatus = {},
  finalRouteTruth = null,
  orchestrationSelectors = {},
  agentTaskReadinessSummary = {},
  telemetrySummary = {},
  promptBuilderSummary = {},
  launcherEntrySummary = null,
} = {}) {
  const normalized = normalizeProjectProgressModel(model);
  const agentTaskSummary = normalizeAgentTaskReadinessSummary(agentTaskReadinessSummary);
  const telemetry = normalizeTelemetrySummary(telemetrySummary);
  const promptBuilder = normalizePromptBuilderSummary(promptBuilderSummary);
  const launcherEntry = launcherEntrySummary && typeof launcherEntrySummary === 'object'
    ? launcherEntrySummary
    : buildLauncherEntrySummary({
      runtimeStatusModel: runtimeStatus,
    });
  const nextAction = agentTaskSummary.nextActions[0] || null;
  const overlayAgentLaneStatus = agentTaskSummary.available
    ? mapDashboardStatusToProjectStatus(agentTaskSummary.status || agentTaskSummary.agentTaskLayerStatus)
    : null;
  const overlayCodexLaneStatus = agentTaskSummary.available
    ? mapCodexReadinessToLaneStatus(agentTaskSummary.codexReadiness)
    : null;
  const overlayOpenClawLaneStatus = agentTaskSummary.available
    ? mapOpenClawReadinessToLaneStatus(agentTaskSummary.openClawReadiness)
    : null;
  const overlayVerificationLaneStatus = agentTaskSummary.available
    ? mapVerificationToLaneStatus(agentTaskSummary.verificationStatus)
    : null;
  const overlayTelemetryLaneStatus = telemetry.available ? mapTelemetryToLaneStatus(telemetry.status) : null;
  const overlayPromptBuilderLaneStatus = promptBuilder.available ? mapPromptBuilderToLaneStatus(promptBuilder.status) : null;
  const overlayLauncherEntryLaneStatus = launcherEntry?.available ? mapLauncherEntryToLaneStatus(launcherEntry.status) : null;
  const lanes = normalized.lanes.map((lane) => {
    if (lane.id === 'agent-task-layer' && overlayAgentLaneStatus) {
      return {
        ...lane,
        status: overlayAgentLaneStatus,
        why: nextAction?.reason || `Agent Task Layer phase: ${agentTaskSummary.phase}.`,
        blockers: agentTaskSummary.blockers.length > 0 ? agentTaskSummary.blockers : lane.blockers,
        evidence: agentTaskSummary.evidence.length > 0 ? agentTaskSummary.evidence : lane.evidence,
        lastMilestone: nextAction?.title || lane.lastMilestone,
      };
    }
    if (lane.id === 'codex-handoff' && overlayCodexLaneStatus) {
      return {
        ...lane,
        status: overlayCodexLaneStatus,
      };
    }
    if (lane.id === 'openclaw-control' && overlayOpenClawLaneStatus) {
      return {
        ...lane,
        status: overlayOpenClawLaneStatus,
      };
    }
    if (lane.id === 'verification-loop' && overlayVerificationLaneStatus) {
      return {
        ...lane,
        status: overlayVerificationLaneStatus,
      };
    }
    if (lane.id === 'telemetry' && overlayTelemetryLaneStatus) {
      return {
        ...lane,
        status: overlayTelemetryLaneStatus,
        why: telemetry.nextActions[0] || lane.why,
        blockers: telemetry.blockers.length > 0 ? telemetry.blockers : lane.blockers,
        evidence: telemetry.evidence.length > 0 ? telemetry.evidence : lane.evidence,
      };
    }
    if (lane.id === 'prompt-builder' && overlayPromptBuilderLaneStatus) {
      return {
        ...lane,
        status: overlayPromptBuilderLaneStatus,
        why: promptBuilder.nextActions[0] || lane.why,
        blockers: promptBuilder.blockers.length > 0 ? promptBuilder.blockers : lane.blockers,
        evidence: promptBuilder.evidence.length > 0 ? promptBuilder.evidence : lane.evidence,
      };
    }
    if (lane.id === 'launcher-entry' && overlayLauncherEntryLaneStatus) {
      return {
        ...lane,
        status: overlayLauncherEntryLaneStatus,
        why: launcherEntry.dashboardSummaryText || lane.why,
        blockers: launcherEntry.blockers?.length > 0 ? launcherEntry.blockers : lane.blockers,
        evidence: launcherEntry.evidence?.length > 0 ? launcherEntry.evidence : lane.evidence,
        lastMilestone: launcherEntry.compactSummaryText || lane.lastMilestone,
      };
    }
    return lane;
  });
  const weightedTotal = lanes.reduce((sum, lane) => sum + lane.weight, 0);
  const weightedScore = lanes.reduce((sum, lane) => sum + (getProjectStatusScore(lane.status) * lane.weight), 0);
  const overallReadinessScore = weightedTotal > 0 ? Math.round(weightedScore / weightedTotal) : 0;
  const phase = resolvePhase(overallReadinessScore);

  const codexLane = pickLane(lanes, 'codex-handoff');
  const openClawLane = pickLane(lanes, 'openclaw-control');
  const verificationLane = pickLane(lanes, 'verification-loop');
  const agentTaskLane = pickLane(lanes, 'agent-task-layer');

  const blockers = lanes
    .filter((lane) => lane.status === 'blocked' || lane.blockers.length > 0)
    .map((lane) => ({ id: lane.id, title: lane.title, details: lane.blockers.length > 0 ? lane.blockers : ['Blocker details pending.'] }));

  const risks = lanes
    .filter((lane) => lane.status === 'unknown' || lane.status === 'not-started' || lane.status === 'partial')
    .map((lane) => ({ id: lane.id, title: lane.title, risk: lane.why || 'Risk details pending.' }));

  const suppressedActionIds = collectSuppressedActionIds({
    agentTaskSummary,
    telemetry,
    promptBuilder,
    launcherEntry,
  });

  const nextBestActions = [...DEFAULT_NEXT_ACTIONS]
    .sort((a, b) => b.dependencyImpact - a.dependencyImpact)
    .filter((action, index) => {
      if (suppressedActionIds.has(action.id)) return false;
      const nextIndex = resolveAgentTaskActionIndex(agentTaskSummary.nextAgentTaskAction || nextAction?.title);
      if (nextIndex < 0) return true;
      return index >= nextIndex;
    });

  if (!telemetry.available) {
    prioritizeAction(nextBestActions, 'add-telemetry-summary-export');
  } else if (['missing', 'degraded', 'unknown'].includes(telemetry.lifecycleBindingStatus)
    || (telemetry.lifecycleBindingStatus === 'partial' && telemetry.status !== 'flowing')) {
    prioritizeAction(nextBestActions, 'bind-telemetry-lifecycle-context');
  } else if (!promptBuilder.available) {
    prioritizeAction(nextBestActions, 'add-prompt-builder-summary-export');
  } else if (!promptBuilder.supportsAgentTaskContext || !promptBuilder.supportsTelemetryContext || !promptBuilder.supportsRuntimeTruthContext) {
    prioritizeAction(nextBestActions, 'bind-prompt-builder-contexts');
  }

  if (!launcherEntry?.available) {
    prioritizeAction(nextBestActions, 'add-launcher-entry-summary-export');
  } else if (launcherEntry.diagnosticOverloadRisk) {
    prioritizeAction(nextBestActions, 'declutter-landing-tile-summary');
  } else if (Array.isArray(launcherEntry.shortcutSurfaces) && launcherEntry.shortcutSurfaces.some((entry) => entry?.present && entry?.statusSummaryAvailable !== true)) {
    prioritizeAction(nextBestActions, 'populate-launcher-shortcut-status');
  }

  const currentActionIndex = resolveAgentTaskActionIndex(agentTaskSummary.nextAgentTaskAction || nextAction?.title);
  if (agentTaskSummary.available && currentActionIndex >= 3 && agentTaskSummary.verificationReturnReady !== true) {
    prioritizeAction(nextBestActions, 'add-verification-return-loop');
  }
  if (agentTaskSummary.available
    && agentTaskSummary.verificationReturnReady === true
    && ['safe_to_accept', 'needs_review'].includes(agentTaskSummary.verificationDecision)
    && agentTaskSummary.openClawReadiness !== 'ready') {
    const shouldWireKillSwitch = ['required', 'unavailable', 'unknown', 'missing'].includes(agentTaskSummary.openClawKillSwitchState);
    const adapterMode = agentTaskSummary.openClawAdapterMode;
    const adapterConnectionState = agentTaskSummary.openClawAdapterConnectionState;
    const shouldDesignAdapter = !agentTaskSummary.openClawPolicyOnly
      && !shouldWireKillSwitch
      && ['design_only', 'unavailable', 'unknown'].includes(adapterMode);
    const stubExists = ['health_check_only', 'simulated_ready', 'present_disabled'].includes(agentTaskSummary.openClawAdapterStubStatus)
      || ['local_only', 'simulated'].includes(agentTaskSummary.openClawAdapterStubConnectionState)
      || adapterMode === 'local_stub';
    const shouldCreateStub = !agentTaskSummary.openClawPolicyOnly
      && !shouldWireKillSwitch
      && adapterMode === 'contract_defined'
      && !stubExists;
    const shouldConnectAdapter = !agentTaskSummary.openClawPolicyOnly
      && !shouldWireKillSwitch
      && stubExists
      && adapterConnectionState !== 'connected';
    const shouldCompleteApprovals = !agentTaskSummary.openClawPolicyOnly
      && !shouldWireKillSwitch
      && adapterMode === 'connected'
      && agentTaskSummary.openClawApprovalsComplete !== true;
    if (shouldWireKillSwitch) {
      prioritizeAction(nextBestActions, 'wire-openclaw-kill-switch');
    } else if (shouldDesignAdapter) {
      prioritizeAction(nextBestActions, 'design-openclaw-local-adapter');
    } else if (shouldCreateStub) {
      prioritizeAction(nextBestActions, 'create-openclaw-local-adapter-stub');
    } else if (shouldConnectAdapter) {
      const connectionConfiguredOrReady = agentTaskSummary.openClawAdapterConnectionConfigReady === true
        || agentTaskSummary.openClawAdapterConnectionState === 'configured_not_checked';
      if (!connectionConfiguredOrReady) {
        prioritizeAction(nextBestActions, 'configure-openclaw-adapter-endpoint');
      } else if (!agentTaskSummary.openClawReadonlyValidationEndpointAvailable || !hasSafeReadonlyValidationProbe(agentTaskSummary)) {
        prioritizeAction(nextBestActions, 'add-safe-readonly-openclaw-validation-endpoint');
      } else if (shouldValidateReadonlyHealthHandshake(agentTaskSummary)) {
        prioritizeAction(nextBestActions, 'validate-openclaw-health-handshake-readonly');
      } else {
        prioritizeAction(nextBestActions, 'complete-openclaw-approval-gates');
      }
    } else if (shouldCompleteApprovals) {
      prioritizeAction(nextBestActions, 'complete-openclaw-approval-gates');
    }
  }


  const nextBestActionsWithEvidence = nextBestActions.map((action) => ({
    ...action,
    source: 'project_progress_adjudicator',
    evidence: [
      `suppressed-actions:${suppressedActionIds.size}`,
      agentTaskSummary.available ? `agent-task:${agentTaskSummary.status || agentTaskSummary.agentTaskLayerStatus}` : '',
      telemetry.available ? `telemetry:${telemetry.status}` : 'telemetry:unavailable',
      summarizePromptBuilderEvidence(promptBuilder),
      ...summarizeOpenClawStageEvidence(agentTaskSummary),
    ].filter(Boolean),
  }));

  const verificationBound = agentTaskSummary.available
    ? ['started', 'partial', 'ready', 'complete'].includes(agentTaskSummary.status || agentTaskSummary.agentTaskLayerStatus)
      || hasVerificationReturnState(agentTaskSummary)
    : laneStatusIs(agentTaskLane, ['partial', 'started', 'mostly-ready', 'ready', 'complete']);
  const verificationStatus = {
    buildVerifyScriptsPresent: true,
    taskCompletionBound: verificationBound,
    status: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete']) || hasVerificationReturnState(agentTaskSummary) ? 'started' : 'not-started',
    summary: laneStatusIs(verificationLane, ['started', 'partial', 'mostly-ready', 'ready', 'complete']) || hasVerificationReturnState(agentTaskSummary)
      ? 'Build/verify truth gates exist; task-linked closure loop still needed.'
      : 'Verification loop not started.',
  };

  const doctrineWarnings = [];
  if (agentTaskSummary.available
    ? ['unknown', 'preparing'].includes(agentTaskSummary.agentTaskLayerStatus)
    : laneStatusIs(agentTaskLane, ['not-started', 'unknown'])) {
    doctrineWarnings.push('Agent Task Layer is not canonical yet; keep Codex/OpenClaw orchestration as supervised/manual projection only.');
  }
  if (laneStatusIs(openClawLane, ['blocked', 'not-started', 'partial'])) {
    doctrineWarnings.push('OpenClaw control is not policy-harness ready; do not treat actuator automation as production-safe.');
  }
  if (!telemetry.available) {
    doctrineWarnings.push('Telemetry summary exporter is missing; keep telemetry readiness claims provisional.');
  }
  if (!promptBuilder.available) {
    doctrineWarnings.push('Prompt Builder summary exporter is missing; treat prompt readiness as partial until shared projection exists.');
  }
  if (launcherEntry?.diagnosticOverloadRisk) {
    doctrineWarnings.push('Launcher landing tile summary appears verbose; keep launcher tile compact and move diagnostics to dedicated panels.');
  }
  if (runtimeStatus?.healthy === true && finalRouteTruth?.launchable !== true) {
    doctrineWarnings.push('Backend reachability is not equivalent to route launchability; continue route truth adjudication.');
  }
  if (orchestrationSelectors?.capabilityPosture?.localAuthorityAvailable !== true && finalRouteTruth?.routeKind === 'localhost') {
    doctrineWarnings.push('Hosted or remote sessions must not inherit localhost authority assumptions.');
  }

  return {
    generatedAt: new Date().toISOString(),
    overallReadinessScore,
    phase,
    lanes,
    readiness: {
      codex: codexLane ? codexLane.status : 'unknown',
      agent: agentTaskSummary.available
        ? agentTaskSummary.agentTaskLayerStatus
        : agentTaskLane
          ? agentTaskLane.status
          : 'unknown',
      openClaw: openClawLane ? openClawLane.status : 'unknown',
    },
    blockers,
    risks,
    recentMilestones: lanes
      .filter((lane) => lane.lastMilestone)
      .slice(0, 6)
      .map((lane) => ({ id: lane.id, title: lane.title, milestone: lane.lastMilestone })),
    verificationStatus,
    doctrineWarnings,
    nextBestActions: nextBestActionsWithEvidence,
    agentTaskEvidence: agentTaskSummary.available ? agentTaskSummary : null,
    telemetryEvidence: telemetry.available ? telemetry : null,
    promptBuilderEvidence: promptBuilder.available ? promptBuilder : null,
    launcherEntryEvidence: launcherEntry?.available ? launcherEntry : null,
  };
}
