import { adjudicateOpenClawAdapterStub } from './openClawAdapterStub.mjs';

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
  return Array.isArray(value)
    ? value.map((entry) => asText(entry)).filter(Boolean)
    : [];
}

function normalizeMode(value = '') {
  const normalized = asText(value, 'design_only').toLowerCase();
  if (['unavailable', 'design_only', 'contract_defined', 'local_stub', 'connected', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
}

function normalizeReadiness(value = '') {
  const normalized = asText(value, '').toLowerCase();
  if (['unavailable', 'needs_contract', 'contract_ready', 'needs_local_stub', 'needs_connection', 'connected_blocked', 'connected_ready', 'blocked', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return '';
}

function normalizeConnectionState(value = '') {
  const normalized = asText(value, 'not_configured').toLowerCase();
  if (['not_configured', 'not_connected', 'simulated', 'connected', 'blocked', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
}

function normalizeExecutionMode(value = '') {
  const normalized = asText(value, 'disabled').toLowerCase();
  if (['disabled', 'dry_run_only', 'approval_required', 'enabled', 'unknown'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
}

const CAPABILITY_KEYS = Object.freeze([
  'canInspectFiles',
  'canEditFiles',
  'canRunCommands',
  'canUseBrowser',
  'canUseGit',
  'canUseCodex',
  'canAccessNetwork',
  'canWriteMemory',
  'canReportEvidence',
]);

const REQUIRED_APPROVALS = Object.freeze([
  'approve_openclaw_adapter_enable',
  'approve_file_inspection',
  'approve_file_editing',
  'approve_command_execution',
  'approve_browser_control',
  'approve_network_access',
  'approve_git_write',
  'approve_memory_write',
  'approve_codex_handoff',
  'approve_evidence_capture',
]);

const SAFETY_REQUIREMENTS = Object.freeze([
  'kill_switch_available',
  'policy_harness_present',
  'approval_gates_present',
  'evidence_reporting_required',
  'dry_run_before_execution',
  'no_secret_access',
  'no_unapproved_git_write',
  'no_unapproved_network_access',
]);

const EVIDENCE_CONTRACT = Object.freeze([
  'mustReportActionsPlanned',
  'mustReportActionsTaken',
  'mustReportFilesTouched',
  'mustReportCommandsRequested',
  'mustReportCommandsRun',
  'mustReportBrowserActions',
  'mustReportNetworkAccess',
  'mustReportErrors',
  'mustReportAssumptions',
  'mustReportVerificationResults',
]);

function normalizeCapabilities(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return CAPABILITY_KEYS.reduce((acc, key) => {
    acc[key] = source[key] === true;
    return acc;
  }, {});
}

function normalizeCapabilityPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return CAPABILITY_KEYS.reduce((acc, key) => {
    const normalized = asText(source[key], 'unavailable').toLowerCase();
    acc[key] = ['allowed', 'approval_required', 'blocked', 'unavailable'].includes(normalized)
      ? normalized
      : 'unavailable';
    return acc;
  }, {});
}

function normalizeTextList(value, fallback = []) {
  const list = asList(value).map((entry) => entry.toLowerCase());
  return list.length > 0 ? Array.from(new Set(list)) : [...fallback];
}

function pickDefaultReadiness(mode) {
  if (mode === 'design_only') return 'needs_contract';
  if (mode === 'contract_defined') return 'needs_local_stub';
  if (mode === 'local_stub') return 'needs_connection';
  if (mode === 'connected') return 'connected_blocked';
  if (mode === 'unavailable') return 'unavailable';
  return 'unknown';
}

function mapStubToAdapterMode(stub = {}) {
  if (stub.stubMode === 'design_only' || stub.stubStatus === 'not_present') return 'design_only';
  if (stub.stubMode === 'local_stub' || stub.stubStatus === 'health_check_only') return 'local_stub';
  if (stub.stubMode === 'simulated' || stub.stubStatus === 'simulated_ready') return 'local_stub';
  if (stub.stubMode === 'disabled' || stub.stubStatus === 'present_disabled') return 'local_stub';
  if (stub.stubMode === 'unavailable') return 'unavailable';
  return '';
}

function mapStubConnectionToAdapterConnection(stub = {}) {
  if (stub.stubConnectionState === 'simulated') return 'simulated';
  if (stub.stubConnectionState === 'local_only') return 'not_connected';
  if (stub.stubConnectionState === 'blocked') return 'blocked';
  if (stub.stubConnectionState === 'not_connected') return 'not_connected';
  return '';
}

export function adjudicateOpenClawLocalAdapter(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const stubSummary = adjudicateOpenClawAdapterStub(source.adapterStub || source.openClawAdapterStub || {});
  const inferredMode = mapStubToAdapterMode(stubSummary);
  const adapterMode = normalizeMode(source.adapterMode || source.mode || inferredMode || 'design_only');
  const requestedReadiness = normalizeReadiness(source.adapterReadiness || source.readiness);
  const inferredConnection = mapStubConnectionToAdapterConnection(stubSummary);
  const adapterConnectionState = normalizeConnectionState(source.adapterConnectionState || source.connectionState || inferredConnection || 'not_configured');
  const adapterExecutionMode = normalizeExecutionMode(source.adapterExecutionMode || source.executionMode || 'disabled');
  const adapterCapabilities = normalizeCapabilities(source.adapterCapabilities);
  const adapterCapabilityPolicy = normalizeCapabilityPolicy(source.adapterCapabilityPolicy);
  const adapterRequiredApprovals = normalizeTextList(source.adapterRequiredApprovals, REQUIRED_APPROVALS);
  const adapterSatisfiedApprovals = normalizeTextList(source.adapterSatisfiedApprovals || source.satisfiedApprovals, []);
  const adapterSafetyRequirements = normalizeTextList(source.adapterSafetyRequirements, SAFETY_REQUIREMENTS);
  const adapterEvidenceContract = normalizeTextList(source.adapterEvidenceContract, EVIDENCE_CONTRACT.map((entry) => entry.toLowerCase()));
  const adapterWarnings = asList(source.adapterWarnings);
  const manualBlockers = asList(source.adapterBlockers);

  const killSwitchAvailable = asBoolean(source.killSwitchAvailable, false);
  const killSwitchEngaged = asBoolean(source.killSwitchEngaged, false);
  const policyHarnessPresent = asBoolean(source.policyHarnessPresent, true);
  const policyAllowsExecution = asBoolean(source.policyAllowsExecution, false);

  const contractDefined = adapterMode === 'contract_defined' || adapterMode === 'local_stub' || adapterMode === 'connected';
  const localStubAvailable = adapterMode === 'local_stub' || adapterMode === 'connected';
  const adapterConnected = adapterMode === 'connected' && adapterConnectionState === 'connected';
  const approvalsMissing = adapterRequiredApprovals.filter((approval) => !adapterSatisfiedApprovals.includes(approval));
  const approvalsComplete = approvalsMissing.length === 0;
  const hasManualBlockers = manualBlockers.length > 0;

  const derivedBlockers = [...manualBlockers, ...stubSummary.stubBlockers];
  if (!policyHarnessPresent) derivedBlockers.push('OpenClaw policy harness must be present before adapter execution can be enabled.');
  if (!contractDefined) derivedBlockers.push('OpenClaw local adapter contract is not defined yet.');
  if (contractDefined && !localStubAvailable) derivedBlockers.push('OpenClaw local adapter stub is missing.');
  if (localStubAvailable && !adapterConnected) derivedBlockers.push('OpenClaw local adapter is not connected.');
  if (!killSwitchAvailable) derivedBlockers.push('OpenClaw kill switch is unavailable.');
  if (killSwitchEngaged) derivedBlockers.push('OpenClaw kill switch is engaged.');
  if (!policyAllowsExecution) derivedBlockers.push('OpenClaw policy harness does not allow execution yet.');
  if (!approvalsComplete) derivedBlockers.push(`Missing OpenClaw approvals: ${approvalsMissing.join(', ')}.`);
  if (adapterExecutionMode !== 'enabled') derivedBlockers.push('Adapter execution mode is not enabled.');
  derivedBlockers.push('OpenClaw Local Adapter Stub v1 is status/health-only; live execution is intentionally disabled.');

  const adapterExecutionPreconditionsSatisfied = policyHarnessPresent
    && contractDefined
    && localStubAvailable
    && adapterConnected
    && approvalsComplete
    && !hasManualBlockers;

  const adapterCanExecute = false;

  const adapterSafeToConnect = contractDefined
    && localStubAvailable
    && !killSwitchEngaged
    && policyHarnessPresent
    && !hasManualBlockers;

  let adapterReadiness = requestedReadiness || pickDefaultReadiness(adapterMode);
  if (hasManualBlockers || stubSummary.stubStatus === 'blocked' || adapterConnectionState === 'blocked') {
    adapterReadiness = adapterConnected ? 'connected_blocked' : 'blocked';
  } else if (!contractDefined) {
    adapterReadiness = 'needs_contract';
  } else if (!localStubAvailable) {
    adapterReadiness = 'needs_local_stub';
  } else if (!adapterConnected) {
    adapterReadiness = 'needs_connection';
  } else {
    adapterReadiness = 'connected_blocked';
  }

  const adapterDesignReady = contractDefined;

  let adapterNextAction = asText(source.adapterNextAction);
  if (!adapterNextAction) {
    if (!contractDefined) {
      adapterNextAction = 'Design OpenClaw local adapter contract.';
    } else if (!localStubAvailable) {
      adapterNextAction = 'Create OpenClaw local adapter stub.';
    } else if (!adapterConnected) {
      adapterNextAction = 'Advance OpenClaw adapter connection readiness (status-only).';
    } else if (!approvalsComplete) {
      adapterNextAction = 'Complete OpenClaw approval gates.';
    } else {
      adapterNextAction = 'Plan dry-run and execution integration; keep stub status-only in v1.';
    }
  }

  return {
    adapterMode,
    adapterReadiness,
    adapterConnectionState,
    adapterExecutionMode,
    adapterCapabilities,
    adapterCapabilityPolicy,
    adapterRequiredApprovals,
    adapterSatisfiedApprovals,
    adapterApprovalsMissing: approvalsMissing,
    adapterApprovalsComplete: approvalsComplete,
    adapterSafetyRequirements,
    adapterEvidenceContract,
    adapterBlockers: Array.from(new Set(derivedBlockers)),
    adapterWarnings: Array.from(new Set([...adapterWarnings, ...stubSummary.stubWarnings])),
    adapterNextAction,
    adapterDesignReady,
    adapterConnected,
    adapterCanExecute,
    adapterSafeToConnect,
    adapterExecutionPreconditionsSatisfied,
    adapterStub: stubSummary,
  };
}
