import { normalizeMissionExecutionPacket } from '../../../shared/ai/missionExecutionContract.mjs';
import { getAgentRole } from '../../../shared/runtime/agentRoleRegistry.mjs';
import { resolveToolByType } from '../../../shared/runtime/toolExecutionRegistry.mjs';

function resolveMissionClass(intentType = '') {
  if (String(intentType).startsWith('build-')) return intentType;
  if (intentType === 'roadmap-operation') return 'build-integration';
  if (intentType === 'proposal-review') return 'analysis';
  return 'analysis';
}

function missionTitle(intentType = 'unknown', proposalTitle = '') {
  if (proposalTitle) return `Mission: ${proposalTitle}`;
  return `Mission: ${String(intentType || 'unknown').replace(/-/g, ' ')}`;
}

function resolveRoleIds(missionClass = 'analysis') {
  if (missionClass === 'analysis') return ['architect', 'auditor'];
  if (missionClass === 'build-ui' || missionClass === 'build-surface') return ['architect', 'ui-operator', 'auditor', 'integrator'];
  return ['architect', 'builder', 'auditor', 'integrator'];
}

function resolveToolTypes(missionClass = 'analysis') {
  if (missionClass === 'analysis') return ['read-code', 'inspect-state', 'prepare-codex-handoff'];
  return ['read-code', 'generate-patch', 'verify-build', 'run-tests', 'update-roadmap', 'update-activity'];
}

export function buildMissionExecutionPacket({
  intent = {},
  proposalPacket = {},
  missionWorkflow = {},
  graphState = {},
} = {}) {
  const missionClass = resolveMissionClass(intent.intentType);
  const activeProposal = proposalPacket?.packet_metadata?.proposal_active === true;
  const accepted = Array.isArray(missionWorkflow?.decisions)
    && missionWorkflow.decisions.some((entry) => entry?.decision === 'accept');
  const blocked = intent.intentType === 'ambiguous' || intent.intentType === 'unknown';
  const executionMode = blocked
    ? 'blocked'
    : accepted
      ? 'execution-ready'
      : activeProposal
        ? 'approval-gated'
        : 'analysis-only';

  const roleIds = resolveRoleIds(missionClass);
  const toolTypes = resolveToolTypes(missionClass);
  const graphNodes = Array.isArray(graphState?.nodes) ? graphState.nodes : [];

  return normalizeMissionExecutionPacket({
    missionId: `mission_${Date.now()}_${intent.intentType || 'unknown'}`,
    missionTitle: missionTitle(intent.intentType, proposalPacket?.recommended_move_summary?.title),
    missionClass,
    originIntentType: intent.intentType || 'unknown',
    proposalId: proposalPacket?.recommended_move_summary?.move_id || '',
    executionMode,
    lifecycleState: blocked ? 'blocked' : (accepted ? 'execution-ready' : 'proposed'),
    confidence: Math.max(0.2, Number(intent.confidence || 0)),
    rationale: intent.reason || 'Mission packet synthesized from deterministic intent classification.',
    constraints: intent.extractedConstraints || [],
    assumptions: ['proposal-execution-separation-preserved', 'operator-approval-required-for-mutation'],
    blockers: blocked ? ['intent remained ambiguous or unknown'] : [],
    warnings: intent.warnings || [],
    targetSubsystems: intent.extractedSubsystems || [],
    buildScope: intent.buildRelevant ? 'code-change-candidate' : 'analysis-only',
    agentAssignments: roleIds.map((roleId) => {
      const role = getAgentRole(roleId);
      return role ? { roleId: role.id, label: role.label, authorityLevel: role.authorityLevel } : null;
    }).filter(Boolean),
    toolPlan: toolTypes.map((toolType) => {
      const tool = resolveToolByType(toolType);
      return {
        toolId: tool?.toolId || toolType,
        toolType,
        purpose: `Mission ${missionClass} step via ${toolType}`,
        inputs: ['intent', 'proposalPacket', 'runtimeTruth'],
        executionEligible: executionMode === 'execution-ready' && tool?.requiresApproval !== false,
        mutationRisk: tool?.mutationRisk || 'unknown',
        requiresApproval: tool?.requiresApproval !== false,
        notes: tool?.notes || '',
      };
    }),
    stepPlan: [
      'classify-intent',
      'synthesize-mission-packet',
      'operator-review-and-approval',
      'roadmap-and-activity-promotion-when-approved',
    ],
    successCriteria: ['execution truth preserved', 'no silent mutations', 'approval-gated transitions only'],
    rollbackConsiderations: ['revert queued roadmap entry if mission fails', 'record failed lifecycle stage in activity'],
    evidenceSources: ['intent-engine', 'proposal-packet', 'mission-packet-workflow'],
    roadmapPromotionCandidate: intent.buildRelevant && activeProposal,
    codexHandoffEligible: proposalPacket?.codex_handoff_payload?.codex_eligible === true,
    codexPromptSummary: proposalPacket?.codex_handoff_payload?.codex_prompt_summary || '',
    executionTruthPreserved: true,
    approvalRequired: true,
    graphLinkSuggested: (intent.extractedSubsystems || []).length > 0,
    graphLinkEligible: graphNodes.length > 0,
    relatedSubsystemNodes: graphNodes.slice(0, 5).map((node) => node?.id || '').filter(Boolean),
    dependencyEdgesSuggested: [],
    graphPromotionDeferredReason: graphNodes.length > 0 ? '' : 'graph-empty-no-nodes-available',
  });
}
