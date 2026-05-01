import { evaluateReadonlyValidationTruth } from './openClawCapabilityTrial.mjs';

const FORBIDDEN_SELF_ACTIONS = Object.freeze([
  'enable_execution',
  'change_own_permissions',
  'weaken_guardrails',
  'bypass_operator_approval',
  'write_git',
  'edit_files',
  'execute_commands',
  'control_browser',
  'mutate_system',
  'hide_audit_trail',
]);

const REQUIRED_OVERSIGHT_LAYERS = Object.freeze([
  'operator approval gate',
  'readonly validation',
  'capability trial reporting',
  'proposal review queue',
  'audit ledger',
  'kill switch',
  'pause/resume state',
  'permission diff viewer',
  'rollback plan',
  'test evidence',
  'risk classification',
]);

const TRUST_STAGE_LADDER = Object.freeze([
  'stage_0_stub_validated',
  'stage_1_readonly_observed',
  'stage_2_proposal_only',
  'stage_3_operator_reviewed_execution_candidate',
  'stage_4_limited_execution_with_rollback',
  'stage_5_broader_execution_with_continuous_audit',
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function buildOpenClawOversightProposal({ operatorSurface = {}, capabilityTrial = {} } = {}) {
  const readonlyTruth = evaluateReadonlyValidationTruth({ operatorSurface });
  const blocked = asArray(capabilityTrial.blockers).length > 0 || readonlyTruth.validationBlocked;
  const adapterValidated = readonlyTruth.adapterValidated;
  const trialReady = capabilityTrial.trialStatus === 'ready' || capabilityTrial.trialStatus === 'report_ready';

  const trustStage = adapterValidated && trialReady ? 'stage_2_proposal_only' : adapterValidated ? 'stage_1_readonly_observed' : 'stage_0_stub_validated';
  const proposalStatus = blocked ? 'blocked' : trustStage === 'stage_2_proposal_only' ? 'ready_for_operator_review' : 'awaiting_readonly_validation';

  const nextAction = blocked
    ? 'Resolve blockers before proposal review.'
    : trustStage === 'stage_2_proposal_only'
      ? 'Review OpenClaw oversight proposal before any capability increase.'
      : 'Validate readonly adapter before generating oversight proposal.';

  const proposedNextControls = blocked
    ? ['Clear readonly validation blockers.', 'Re-run readonly adapter health/handshake checks.']
    : trustStage === 'stage_2_proposal_only'
      ? ['Queue operator review of proposal-only controls.', 'Prepare permission diff, rollback plan, and test evidence for review.']
      : ['Complete readonly validation and capability trial reporting.', 'Capture audit evidence before proposal review queue submission.'];

  return {
    proposalStatus,
    proposalMode: 'proposal_only',
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    adapterValidated,
    trustStage,
    currentCapabilities: {
      readonlyValidation: adapterValidated,
      capabilityTrialStatus: capabilityTrial.trialStatus || 'not_started',
      reportOnly: true,
      canExecute: false,
    },
    requiredOversightLayers: [...REQUIRED_OVERSIGHT_LAYERS],
    proposedNextControls,
    forbiddenSelfActions: [...FORBIDDEN_SELF_ACTIONS],
    riskLevel: blocked ? 'high' : trustStage === 'stage_2_proposal_only' ? 'medium' : 'guarded',
    evidenceTokens: [
      `validation:${readonlyTruth.validationStatus || 'idle'}`,
      `health:${readonlyTruth.healthState || 'not_run'}`,
      `handshake:${readonlyTruth.handshakeState || 'not_run'}`,
      `readonly:${readonlyTruth.readonlyAsserted ? 'asserted' : 'not_asserted'}`,
      `trial:${capabilityTrial.trialStatus || 'not_started'}`,
      `execution:disabled`,
      `self_modification:disabled`,
    ],
    nextAction,
    trustStageLadder: TRUST_STAGE_LADDER.map((stage, index) => ({
      stage,
      position: index,
      futureGated: index > 2,
    })),
  };
}

export { FORBIDDEN_SELF_ACTIONS, REQUIRED_OVERSIGHT_LAYERS, TRUST_STAGE_LADDER };
