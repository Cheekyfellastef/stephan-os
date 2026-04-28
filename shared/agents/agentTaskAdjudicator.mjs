import { normalizeAgentTaskModel } from './agentTaskModel.mjs';
import { buildCodexHandoffPacket } from './codexHandoffPacket.mjs';

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
    id: 'openclaw-policy-harness-placeholder',
    title: 'Add OpenClaw policy harness placeholder',
    reason: 'OpenClaw must remain blocked until policy harness + kill switch exist.',
    blocks: ['Safe OpenClaw automation'],
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
  if (['needs_policy', 'blocked', 'unavailable'].includes(normalized.agentReadiness.openclaw)) {
    explicitBlockers.push('OpenClaw remains blocked until policy harness and kill switch are validated.');
  }

  const verificationStatus = asText(normalized.verification.verificationStatus).toLowerCase();
  const verificationRequired = normalized.verification.verificationRequired === true;
  const verificationStarted = verificationStatus !== 'not_started';

  const nextAction = LAYER_ACTIONS.find((candidate) => {
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
      return verificationRequired && !verificationStarted;
    }
    if (candidate.id === 'openclaw-policy-harness-placeholder') {
      return normalized.agentReadiness.openclaw !== 'ready';
    }
    return false;
  }) || LAYER_ACTIONS[0];

  const layerStatus = resolveLayerStatus(normalized);
  const readinessScore = resolveReadinessScore(normalized);
  const codexHandoffPacket = buildCodexHandoffPacket({
    model: normalized,
    approvalPending: pendingApprovals,
  });

  return {
    generatedAt: new Date().toISOString(),
    model: normalized,
    layerStatus,
    codexReadiness: normalized.agentReadiness.codex,
    openClawReadiness: normalized.agentReadiness.openclaw,
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
    nextAction,
    blockers: Array.from(new Set(explicitBlockers)).filter(Boolean),
    warnings: normalized.evidence.warnings,
    reasons: normalized.evidence.reasons,
    dependencies: normalized.evidence.dependencies,
    sourceSignals: normalized.evidence.sourceSignals,
    readinessScore,
  };
}
