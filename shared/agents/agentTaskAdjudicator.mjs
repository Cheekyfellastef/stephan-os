import { normalizeAgentTaskModel } from './agentTaskModel.mjs';
import { buildCodexHandoffPacket } from './codexHandoffPacket.mjs';
import { adjudicateVerificationReturn } from './agentVerificationReturn.mjs';
import { adjudicateOpenClawPolicyHarness } from './openClawPolicyHarness.mjs';

const LAYER_ACTIONS = Object.freeze([
  {
    id: 'build-canonical-agent-task-model',
    title: 'Build canonical Agent Task Model',
    reason: 'Agent/Codex/OpenClaw handoff and approvals require shared truth.',
    blocks: ['Reliable handoff', 'Approval gates', 'Verification loop'],
  },
  {
    id: 'wire-agent-tile-projection',
    title: 'Wire existing Agent Tile to Agent Task projection',
    reason: 'Operator needs live visibility of task lifecycle and readiness.',
    blocks: ['Safe supervised agent use'],
  },
  {
    id: 'codex-manual-handoff-mode',
    title: 'Add Codex manual handoff packet mode',
    reason: 'Enables immediate supervised coding without assuming direct adapter integration.',
    blocks: ['Useful coding loop'],
  },
  {
    id: 'verification-return-state',
    title: 'Add verification return state',
    reason: 'Agent output must round-trip through verification before merge/deploy.',
    blocks: ['Trusted completion'],
  },
  {
    id: 'openclaw-kill-switch',
    title: 'Wire OpenClaw kill switch',
    reason: 'Policy harness exists; kill-switch lifecycle must be operator-reachable before adapter execution.',
    blocks: ['Safe OpenClaw execution gating'],
  },
  {
    id: 'openclaw-local-adapter-contract',
    title: 'Design OpenClaw local adapter contract',
    reason: 'Kill switch exists, but execution adapter contract is not implemented yet.',
    blocks: ['Local OpenClaw execution contract'],
  },
  {
    id: 'openclaw-local-adapter-stub',
    title: 'Create OpenClaw local adapter stub',
    reason: 'Adapter contract exists; local stub is required before connection and approvals.',
    blocks: ['Local OpenClaw connection contract'],
  },
  {
    id: 'openclaw-local-adapter-connect',
    title: 'Connect OpenClaw local adapter',
    reason: 'Adapter stub exists but is not connected.',
    blocks: ['Connected OpenClaw adapter readiness'],
  },
  {
    id: 'openclaw-approval-gates',
    title: 'Complete OpenClaw approval gates',
    reason: 'Adapter is present, but required approvals are still missing.',
    blocks: ['Safe supervised OpenClaw execution'],
  },
  {
    id: 'openclaw-execution-integration',
    title: 'Add OpenClaw execution integration',
    reason: 'Safety gates are satisfied; execution integration can proceed under kill-switch control.',
    blocks: ['Production-safe OpenClaw automation'],
  },
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function isBlockedState(value = '') {
  return ['blocked', 'failed', 'cancelled'].includes(asText(value).toLowerCase());
}

function isApprovedGate(gateId, approvedGates = []) {
  return asArray(approvedGates).includes(gateId);
}

function resolveReadinessScore(model) {
  let score = 100;
  if (isBlockedState(model.taskLifecycle.state)) score -= 45;
  if (!model.handoff.handoffReady) score -= 18;
  if (model.agentReadiness.codex !== 'ready' && model.agentReadiness.codex !== 'manual_handoff_only') score -= 10;
  if (model.agentReadiness.openclaw !== 'ready') score -= 14;
  const required = asArray(model.approvalGates.required);
  const approved = required.filter((gate) => isApprovedGate(gate, model.approvalGates.approved));
  score -= Math.max(0, required.length - approved.length) * 4;
  if (asText(model.verification.verificationStatus).toLowerCase() !== 'passed') score -= 9;
  if (asText(model.verificationReturn?.mergeReadiness).toLowerCase() !== 'ready_for_operator_approval') score -= 7;
  return Math.max(0, Math.min(100, score));
}

function resolveLayerStatus(model) {
  const lifecycle = model.taskLifecycle.state;
  if (['complete', 'verified'].includes(lifecycle)) return 'ready';
  if (isBlockedState(lifecycle)) return 'blocked';
  if (lifecycle === 'in_progress' || lifecycle === 'sent_to_agent') return 'in_progress';
  return 'preparing';
}

export function adjudicateAgentTaskLayer({ model = {}, context = {} } = {}) {
  const normalized = normalizeAgentTaskModel(model);
  const sourceContext = context && typeof context === 'object' ? context : {};
  const approvalRequired = asArray(normalized.approvalGates.required);
  const pendingApprovals = approvalRequired.filter((gate) => !isApprovedGate(gate, normalized.approvalGates.approved));
  const openClawPolicySummary = adjudicateOpenClawPolicyHarness({
    ...normalized.openClawPolicy,
    openClawAdapter: normalized.openClawAdapter,
  });
  const openClawAdapterSummary = openClawPolicySummary.openClawAdapter || normalized.openClawAdapter;
  const explicitBlockers = [
    ...asArray(normalized.handoff.handoffBlockers),
    ...asArray(normalized.evidence.blockers),
  ];

  if (!isApprovedGate('approve_handoff', normalized.approvalGates.approved)) {
    explicitBlockers.push('approve_handoff gate is not approved.');
  }
  if (normalized.agentReadiness.codex === 'needs_adapter') {
    explicitBlockers.push('Codex adapter integration is not available; manual handoff only.');
  }
  if (openClawPolicySummary.openClawSafeToUse !== true) {
    explicitBlockers.push(openClawPolicySummary.highestPriorityBlocker || 'OpenClaw remains blocked until policy harness, approvals, adapter, and kill switch are validated.');
  }

  const verificationStatus = asText(normalized.verification.verificationStatus).toLowerCase();
  const verificationRequired = normalized.verification.verificationRequired === true;
  const verificationStarted = verificationStatus !== 'not_started';
  const codexHandoffPacket = buildCodexHandoffPacket({
    model: normalized,
    approvalPending: pendingApprovals,
  });
  const verificationReturn = adjudicateVerificationReturn({
    verificationReturn: normalized.verificationReturn,
    fallbackChecks: normalized.verification.verificationChecks,
    packetReady: codexHandoffPacket.ready,
    lifecycleState: normalized.taskLifecycle.state,
  });

  const baseNextAction = LAYER_ACTIONS.find((candidate) => {
    if (candidate.id === 'build-canonical-agent-task-model') {
      return normalized.taskLifecycle.state === 'draft';
    }
    if (candidate.id === 'wire-agent-tile-projection') {
      return sourceContext.agentTileProjectionConnected !== true;
    }
    if (candidate.id === 'codex-manual-handoff-mode') {
      return normalized.agentReadiness.codex === 'needs_adapter' || normalized.handoff.handoffMode === 'unavailable';
    }
    if (candidate.id === 'verification-return-state') {
      return verificationRequired && (verificationReturn.verificationReturnReady !== true || verificationReturn.verificationDecision === 'not_ready');
    }
    if (candidate.id === 'openclaw-kill-switch') {
      return ['required', 'unavailable', 'unknown', 'missing'].includes(openClawPolicySummary.killSwitchState);
    }
    if (candidate.id === 'openclaw-local-adapter-contract') {
      return !openClawPolicySummary.policyOnly
        && openClawPolicySummary.killSwitchAvailable === true
        && ['design_only', 'unavailable', 'unknown'].includes(openClawAdapterSummary.adapterMode);
    }
    if (candidate.id === 'openclaw-local-adapter-stub') {
      return !openClawPolicySummary.policyOnly
        && openClawPolicySummary.killSwitchAvailable === true
        && openClawAdapterSummary.adapterMode === 'contract_defined';
    }
    if (candidate.id === 'openclaw-local-adapter-connect') {
      return !openClawPolicySummary.policyOnly
        && openClawPolicySummary.killSwitchAvailable === true
        && ['local_stub'].includes(openClawAdapterSummary.adapterMode);
    }
    if (candidate.id === 'openclaw-approval-gates') {
      return !openClawPolicySummary.policyOnly
        && openClawPolicySummary.killSwitchAvailable === true
        && openClawAdapterSummary.adapterConnected === true
        && openClawAdapterSummary.adapterApprovalsComplete !== true;
    }
    if (candidate.id === 'openclaw-execution-integration') {
      return openClawAdapterSummary.adapterCanExecute === true && openClawPolicySummary.openClawExecutionAllowed !== true;
    }
    return false;
  }) || LAYER_ACTIONS[0];
  let nextAction = { ...baseNextAction, blocks: asArray(baseNextAction.blocks) };

  if (verificationReturn.verificationReturnStatus === 'waiting_for_return') {
    nextAction = {
      title: 'Paste Codex result for verification',
      reason: 'Manual handoff packet is ready/sent, but no return payload has been captured yet.',
      blocks: ['Trusted verification return loop'],
      id: 'verification-return-state',
    };
  }
  const layerStatus = resolveLayerStatus(normalized);
  const readinessScore = resolveReadinessScore(normalized);

  return {
    generatedAt: new Date().toISOString(),
    model: normalized,
    layerStatus,
    codexReadiness: normalized.agentReadiness.codex,
    openClawReadiness: openClawPolicySummary.openClawReadiness || normalized.agentReadiness.openclaw,
    approval: {
      required: approvalRequired,
      approved: asArray(normalized.approvalGates.approved),
      blocked: asArray(normalized.approvalGates.blocked),
      pending: pendingApprovals,
      highestPriorityGate: pendingApprovals[0] || normalized.approvalGates.blocked[0] || '',
    },
    handoff: {
      ...normalized.handoff,
      handoffReady: normalized.handoff.handoffReady === true && pendingApprovals.length === 0,
      packetMode: codexHandoffPacket.mode,
      packetReady: codexHandoffPacket.ready,
      packetSummary: codexHandoffPacket.packetSummary,
      packetBlockers: codexHandoffPacket.blockers,
      packetText: codexHandoffPacket.packetText,
      nextActionLabel: codexHandoffPacket.nextActionLabel,
    },
    verification: {
      required: verificationRequired,
      checks: normalized.verification.verificationChecks,
      status: normalized.verification.verificationStatus,
      started: verificationStarted,
      lastResult: normalized.verification.lastVerificationResult,
    },
    verificationReturn,
    nextAction,
    openClawPolicySummary,
    openClawAdapterSummary,
    blockers: Array.from(new Set(explicitBlockers)).filter(Boolean),
    warnings: normalized.evidence.warnings,
    reasons: normalized.evidence.reasons,
    dependencies: normalized.evidence.dependencies,
    sourceSignals: normalized.evidence.sourceSignals,
    readinessScore,
  };
}
