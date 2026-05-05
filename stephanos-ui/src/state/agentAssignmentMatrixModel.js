function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

const BLOCKED_ALWAYS = Object.freeze([
  'autonomous_execution',
  'shell_execution',
  'github_write_or_merge_automation',
  'file_deletion',
  'secrets_access',
  'external_account_actions',
  'openclaw_execution',
  'memory_auto_promotion',
  'scope_expansion',
]);

function buildAssignment(base) {
  return {
    assignmentId: asText(base.assignmentId),
    missionId: asText(base.missionId, 'unknown-mission'),
    roleId: asText(base.roleId, 'mission_control'),
    roleLabel: asText(base.roleLabel, 'Mission Control'),
    assignedSystem: asText(base.assignedSystem, 'Mission Control'),
    assignmentType: asText(base.assignmentType, 'no_action'),
    responsibility: asText(base.responsibility, 'No assignment defined.'),
    inputRequired: asText(base.inputRequired, 'Mission Command Packet.'),
    outputExpected: asText(base.outputExpected, 'Status update.'),
    authorityLevel: asText(base.authorityLevel, 'observe_only'),
    allowedActions: asList(base.allowedActions),
    blockedActions: [...new Set([...BLOCKED_ALWAYS, ...asList(base.blockedActions)])],
    requiredApproval: base.requiredApproval === true,
    riskLevel: asText(base.riskLevel, 'low'),
    status: asText(base.status, 'planned'),
    reason: asText(base.reason, 'Assignment derived from mission packet state.'),
    relatedPacketSection: asText(base.relatedPacketSection, 'mission'),
    relatedSubsystems: asList(base.relatedSubsystems),
    nextAction: asText(base.nextAction, 'Await operator guidance.'),
  };
}

export function buildAgentAssignmentMatrix(input = {}) {
  const missionCommandPacket = input.missionCommandPacket || {};
  const missionSpec = input.missionSpec || missionCommandPacket.missionSpec || {};
  const missionId = asText(missionSpec.missionId || missionCommandPacket.missionId, 'unknown-mission');
  const openClawDelegation = input.openClawDelegation || missionSpec.openClawDelegation || {};
  const verificationJudge = input.verificationJudge || {};
  const taskFinisherPlan = input.taskFinisherPlan || missionSpec.taskFinisherPlan || {};
  const operatorDecisionConsole = input.operatorDecisionConsole || missionSpec.operatorDecisionConsole || {};
  const memoryLibrarianQueue = input.memoryLibrarianQueue || missionSpec.memoryLibrarian || {};
  const repoArchitectureContext = input.repoArchitectureContext || missionSpec.repoArchitectureContext || {};
  const prEvidenceIntake = input.prEvidenceIntake || missionSpec.prEvidenceIntake || {};

  const assignments = [];
  const add = (entry) => assignments.push(buildAssignment({ ...entry, missionId, assignmentId: `${missionId}-${entry.roleId}` }));

  add({
    roleId: 'codex_builder', roleLabel: 'Codex Builder', assignedSystem: 'Codex', assignmentType: 'build',
    responsibility: 'Implement scoped mission changes and narrow fixes via bounded handoff only.',
    inputRequired: 'Mission Command Packet + Codex handoff.', outputExpected: 'Patch + test evidence + change summary.',
    authorityLevel: 'build_via_codex', allowedActions: ['edit-scoped-files', 'add-or-update-tests', 'run-local-verification'],
    blockedActions: ['merge_authority', 'approve_operator_only_actions'], requiredApproval: true,
    riskLevel: asText(missionSpec.riskLevel, 'medium'), reason: 'Build/fix responsibilities require Codex implementation support.',
    relatedPacketSection: 'codex_handoff', relatedSubsystems: asList(missionSpec.likelyAffectedSystems), nextAction: 'Execute bounded implementation and return proof.',
  });

  if (asText(openClawDelegation.status || openClawDelegation.delegationStatus, 'inactive') !== 'inactive') {
    add({ roleId: 'openclaw_delegate', roleLabel: 'OpenClaw Delegate', assignedSystem: 'OpenClaw', assignmentType: 'research', responsibility: 'Provide research/planning preview only.', inputRequired: 'Delegation scope + mission packet.', outputExpected: 'Proposal notes and planning options.', authorityLevel: 'research_only', allowedActions: ['analyze-mission-context', 'draft-proposal', 'surface-risks'], blockedActions: ['code_mutation', 'execution', 'merge_authority'], requiredApproval: true, riskLevel: 'medium', reason: 'OpenClaw delegation exists; execution stays disabled.', relatedPacketSection: 'openclaw_delegation', relatedSubsystems: ['openclaw', 'mission-console'], nextAction: asText(openClawDelegation.nextAction, 'Provide proposal packet for operator review.') });
  }

  add({ roleId: 'verification_judge', roleLabel: 'Verification Judge', assignedSystem: 'Verification Judge / Proof Marshal', assignmentType: 'verification', responsibility: 'Evaluate verification evidence and return readiness judgment.', inputRequired: 'Verification return + command results + PR evidence.', outputExpected: 'Judgment with blockers/warnings and next action.', authorityLevel: 'verify_only', allowedActions: ['review-evidence', 'score-readiness', 'report-blockers'], blockedActions: ['implement-code', 'merge_authority'], requiredApproval: false, riskLevel: 'medium', reason: 'Verification governance is mandatory for mission completion.', relatedPacketSection: 'verification_judge', relatedSubsystems: ['verification', 'evidence-ledger'], nextAction: asText(verificationJudge.nextAction, 'Review verification evidence.') });

  if (Number(memoryLibrarianQueue.pendingCount || memoryLibrarianQueue.counts?.pending || 0) > 0) {
    add({ roleId: 'memory_librarian', roleLabel: 'Memory Librarian', assignedSystem: 'Memory Librarian / Canon Curator', assignmentType: 'memory_governance', responsibility: 'Review memory candidates and canon/lesson governance queue.', inputRequired: 'Memory candidates + verification lesson candidates.', outputExpected: 'Operator-facing queue with approve/reject recommendations.', authorityLevel: 'propose_only', allowedActions: ['queue-candidates', 'tag-conflicts', 'recommend-disposition'], blockedActions: ['auto-promote-memory', 'canon_without_operator_approval'], requiredApproval: true, riskLevel: 'medium', reason: 'Pending memory candidates require governance review.', relatedPacketSection: 'memory_librarian', relatedSubsystems: ['memory', 'mission-history'], nextAction: asText(memoryLibrarianQueue.nextAction, 'Await operator memory decisions.') });
  }

  const capabilityGap = Number(memoryLibrarianQueue.counts?.capabilityGaps || 0) > 0;
  if (capabilityGap) {
    add({ roleId: 'capability_radar', roleLabel: 'Capability Radar', assignedSystem: 'Capability Radar', assignmentType: 'capability_discovery', responsibility: 'Map missing internal/external capabilities and constraints.', inputRequired: 'Capability gap signals.', outputExpected: 'Capability options list and risk notes.', authorityLevel: 'research_only', allowedActions: ['discover-capabilities', 'propose-safe-options'], blockedActions: ['procure-tools', 'external-account-actions'], requiredApproval: true, riskLevel: 'medium', reason: 'Capability gaps were detected in mission memory/verification.', relatedPacketSection: 'memory_librarian', relatedSubsystems: ['capability-radar'], nextAction: 'Provide capability options to operator.' });
    add({ roleId: 'skill_forge', roleLabel: 'Skill Forge', assignedSystem: 'Skill Forge', assignmentType: 'capability_discovery', responsibility: 'Propose internal skill upgrades for repeated mission gaps.', inputRequired: 'Capability gap + mission lessons.', outputExpected: 'Skill upgrade proposal.', authorityLevel: 'propose_only', allowedActions: ['draft-skill-upgrade', 'link-evidence'], blockedActions: ['auto-install-skill', 'auto-promote-memory'], requiredApproval: true, riskLevel: 'low', reason: 'Skill upgrades are useful when capability gaps repeat.', relatedPacketSection: 'memory_librarian', relatedSubsystems: ['skills', 'memory'], nextAction: 'Draft skill improvement backlog item.' });
  }

  add({ roleId: 'task_finisher', roleLabel: 'Task Finisher', assignedSystem: 'Task Finisher / Routine Bolt-Tightener', assignmentType: 'finish_planning', responsibility: 'Plan safe routine finish sequence and unblock remaining checks.', inputRequired: 'Verification status + finish authority + evidence ledger.', outputExpected: 'Routine finish checklist and blockers.', authorityLevel: 'finish_planning_only', allowedActions: ['prepare-finish-plan', 'sequence-routine-checks'], blockedActions: ['merge_authority', 'force-approval'], requiredApproval: true, riskLevel: 'medium', reason: 'Mission finish requires explicit routine planning.', relatedPacketSection: 'task_finisher', relatedSubsystems: ['finish-authority', 'verification'], nextAction: asText(taskFinisherPlan.nextAction, 'Complete remaining routine tasks.') });

  add({ roleId: 'repo_cartographer', roleLabel: 'Repo Cartographer', assignedSystem: 'Repo Architecture Cartographer', assignmentType: 'review', responsibility: 'Map architecture impact and likely test surface.', inputRequired: 'Mission scope + affected files.', outputExpected: 'Impact map with subsystem/test guidance.', authorityLevel: 'observe_only', allowedActions: ['map-impact', 'identify-test-surface'], blockedActions: ['mutate-runtime-truth', 'merge_authority'], requiredApproval: false, riskLevel: asText(repoArchitectureContext.riskLevel, 'low'), reason: 'Architecture context is required for truth-preserving implementation.', relatedPacketSection: 'architecture_context', relatedSubsystems: asList(repoArchitectureContext.affectedSubsystems), nextAction: asText(repoArchitectureContext.nextAction, 'Review impacted subsystems.') });

  const highRisk = asText(missionSpec.riskLevel, 'medium') === 'high' || Number(verificationJudge.blockers?.length || 0) > 0;
  add({ roleId: 'system_watcher', roleLabel: 'System Watcher', assignedSystem: 'System Watcher', assignmentType: 'risk_detection', responsibility: 'Monitor conflicts, risky scope, and doctrine contradictions.', inputRequired: 'Mission packet + verification blockers + doctrine.', outputExpected: 'Risk report and escalation guidance.', authorityLevel: 'observe_only', allowedActions: ['detect-conflicts', 'raise-escalations'], blockedActions: ['approve-risk', 'change-doctrine'], requiredApproval: false, riskLevel: highRisk ? 'high' : 'medium', reason: 'System watcher enforces doctrine and contradiction detection.', relatedPacketSection: 'safety_doctrine', relatedSubsystems: ['truth-engine', 'reality-sync'], nextAction: highRisk ? 'Escalate high-risk items to Operator.' : 'Continue monitoring for contradictions.' });

  if ((prEvidenceIntake.prNumber || prEvidenceIntake.codexTaskId) || missionCommandPacket.prEvidenceSummary) {
    add({ roleId: 'mission_control', roleLabel: 'Mission Control', assignedSystem: 'Mission Evidence Intake + Connector', assignmentType: 'evidence_intake', responsibility: 'Normalize PR evidence and keep mission evidence ledger coherent.', inputRequired: 'PR metadata + verification return.', outputExpected: 'Evidence status and connector warnings.', authorityLevel: 'plan_only', allowedActions: ['parse-evidence', 'link-evidence-to-ledger'], blockedActions: ['mutate-github', 'merge_authority'], requiredApproval: false, riskLevel: 'low', reason: 'Evidence intake is needed to ground verification and finish planning.', relatedPacketSection: 'pr_evidence', relatedSubsystems: ['evidence-ledger', 'pr-evidence'], nextAction: asText(prEvidenceIntake.nextAction, 'Attach PR evidence artifacts.') });
  }

  add({ roleId: 'operator', roleLabel: 'Operator', assignedSystem: 'Operator Decision Console', assignmentType: 'operator_decision', responsibility: 'Approve high-risk actions, merge authority, canon promotion, secrets/external account gates.', inputRequired: 'All assignment outputs + final packet.', outputExpected: 'Explicit approvals/denials and final authority decisions.', authorityLevel: 'operator_approval_required', allowedActions: ['approve-or-deny', 'authorize-merge', 'authorize-canon-promotion'], blockedActions: ['none'], requiredApproval: false, riskLevel: highRisk ? 'high' : 'medium', reason: 'Operator is final authority and retains all sensitive decisions.', relatedPacketSection: 'operator_decision', relatedSubsystems: ['operator-console'], nextAction: asText(operatorDecisionConsole.nextAction, 'Resolve queued operator decisions.') });

  const activeRoles = assignments.filter((a) => a.status !== 'blocked').map((a) => a.roleId);
  const blockedAssignmentCount = assignments.filter((a) => a.status === 'blocked' || a.blockedActions.length > BLOCKED_ALWAYS.length).length;
  const summary = {
    assignmentCount: assignments.length,
    activeRoleCount: new Set(activeRoles).size,
    openClawAssigned: assignments.some((a) => a.roleId === 'openclaw_delegate'),
    codexAssigned: assignments.some((a) => a.roleId === 'codex_builder'),
    operatorApprovalRequired: assignments.some((a) => a.requiredApproval === true),
    highRiskAssignmentCount: assignments.filter((a) => a.riskLevel === 'high').length,
    blockedAssignmentCount,
    recommendedLeadRole: highRisk ? 'operator' : 'codex_builder',
    nextAssignmentAction: highRisk
      ? 'Operator reviews high-risk blockers before implementation continuation.'
      : asText(taskFinisherPlan.nextAction || verificationJudge.nextAction, 'Proceed with bounded Codex handoff and verification.'),
  };

  return { missionId, assignments, summary };
}
