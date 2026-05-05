import { buildMissionMemoryContext, deriveVerificationReturnLessonCandidates } from './missionMemoryOrchestrator.js';
import { buildMemoryLibrarianQueue } from './memoryLibrarianModel.js';
import { buildOpenClawDelegatedMission } from './openClawDelegationModel.js';
import { adjudicateMissionFinishAuthority } from './missionFinishAuthorityModel.js';
import { buildRepoArchitectureContext } from './repoArchitectureMapModel.js';
import { buildTaskFinisherPlan } from './taskFinisherModel.js';
import { buildPrEvidenceIntake } from './prEvidenceIntakeModel.js';
import { buildMissionEvidenceLedger } from './missionEvidenceLedgerModel.js';
import { buildOperatorDecisionQueue } from './operatorDecisionConsoleModel.js';
const DEFAULT_AUTOMATION_ALLOWED = Object.freeze([
  'edit-source-files',
  'add-tests',
  'run-local-checks',
  'prepare-pr-text',
]);

const DEFAULT_APPROVAL_REQUIRED = Object.freeze([
  'deploy',
  'create-public-endpoint',
  'change-dns',
  'create-cloudflare-resources',
  'store-secrets',
  'enable-paid-service',
  'write-durable-memory-cloud',
]);

const DOCTRINE_CONSTRAINTS = Object.freeze([
  'Battle Bridge remains primary authority.',
  'Canonical runtime truth flows through runtimeStatusModel + runtimeAdjudicator.',
  'UI consumes finalRouteTruthView projection only.',
  'Keep selected/executable/actual provider truth separate.',
  'Keep reachability/usability/browser compatibility separate.',
  'apps/stephanos/dist is generated output, never source truth.',
  'Zero-cost and privacy boundaries stay explicit.',
  'Never commit or persist secrets.',
  'No destructive actions, no Git push, and no external account actions.',
  'Build and verify are required before merge-ready posture.',
  'Operator remains final authority for approval and promotion.',
]);

const INTENT_CATEGORIES = Object.freeze([
  'product_vision', 'architecture_rule', 'workflow_preference', 'bug_lesson', 'capability_request', 'ui_request', 'agent_orchestration_request', 'verification_rule', 'memory_request',
]);

const MEMORY_CANDIDATE_TYPES = Object.freeze([
  'temporary_note', 'durable_operator_preference', 'architecture_canon_candidate', 'project_lesson', 'capability_gap', 'mission_history', 'do_not_store',
]);

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .map((entry) => asText(entry))
    .filter(Boolean);
}

function slugify(value = '') {
  return asText(value, 'mission')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'mission';
}

function classifyApprovalBoundaries({
  allowedAutomation = DEFAULT_AUTOMATION_ALLOWED,
  requiresApprovalFlags = {},
} = {}) {
  const allowSet = new Set(asList(allowedAutomation, DEFAULT_AUTOMATION_ALLOWED));
  const explicitFlags = requiresApprovalFlags && typeof requiresApprovalFlags === 'object'
    ? requiresApprovalFlags
    : {};

  const allowedActions = [...DEFAULT_AUTOMATION_ALLOWED].filter((action) => allowSet.has(action));
  const blockedActions = [...DEFAULT_APPROVAL_REQUIRED].filter((action) => {
    if (explicitFlags[action] === false) return false;
    return explicitFlags[action] === true || true;
  });

  return {
    allowedActions,
    blockedActions,
    approvalRequired: blockedActions.length > 0,
  };
}


function deriveMissionMemoryInfluence({ memoryContext = {}, intentCategories = [], rawIntent = '', targetArea = '' } = {}) {
  const missionMemoryContext = buildMissionMemoryContext({
    operatorIntent: rawIntent,
    missionSpec: { intentClassifications: intentCategories, targetArea },
    memoryContext,
  });
  const memoriesUsed = missionMemoryContext.memories.map((entry) => ({
    id: entry.memoryId,
    memoryId: entry.memoryId,
    type: entry.type,
    summary: entry.summary,
    source: entry.source,
    relevanceScore: entry.relevanceScore,
    influenceLevel: entry.influenceLevel,
    reason: entry.reason,
    appliedTo: entry.appliedTo,
    requiresOperatorVisibility: entry.requiresOperatorVisibility,
  }));
  const canonNotes = memoriesUsed.filter((e) => /canon|architecture/i.test(e.type + ' ' + e.summary)).map((e) => e.summary);
  const lessonNotes = memoriesUsed.filter((e) => /lesson|project_lesson|capability|do_not_repeat/i.test(e.type + ' ' + e.summary)).map((e) => e.summary);
  return {
    missionMemoryContext,
    memoriesUsed,
    missionMemoryInfluenceCount: memoriesUsed.length,
    missionMemoryInfluenceTypes: [...new Set(memoriesUsed.map((entry) => entry.type))],
    missionMemoryInfluenceLevels: missionMemoryContext.summary.influenceLevels,
    missionMemoryLastAppliedAt: memoriesUsed.length ? new Date().toISOString() : '',
    canonNotes,
    lessonNotes,
    operatorIntentProtected: asText(rawIntent).length > 0 && intentCategories.length > 0,
  };
}

export function buildMissionSpec(input = {}, { now = new Date() } = {}) {
  const rawIntent = asText(input.rawIntent, 'No operator intent supplied yet.');
  const targetArea = asText(input.targetArea, 'unspecified-area');
  const riskLevel = asText(input.riskLevel, 'medium');
  const verificationCommands = asList(input.verificationCommands, [
    'npm run stephanos:build',
    'npm run stephanos:verify',
    'git status --short',
  ]);
  const successCriteria = asList(input.successCriteria, [
    'Mission spec generated with explicit doctrine constraints.',
    'Approval boundaries clearly separate allowed vs approval-required actions.',
    'Verification evidence recorded before merge.',
  ]);
  const boundaries = classifyApprovalBoundaries({
    allowedAutomation: input.allowedAutomation,
    requiresApprovalFlags: input.requiresApprovalFlags,
  });
  const missionId = `intent-build-${slugify(targetArea)}-${now.getTime()}`;
  const classifications = classifyOperatorIntent(rawIntent);
  const memoryInfluence = deriveMissionMemoryInfluence({
    memoryContext: input.memoryContext || {},
    intentCategories: classifications.categories,
    rawIntent,
    targetArea,
  });
  const memoryCandidate = buildMissionMemoryCandidate({ operatorIntentText: rawIntent, categories: classifications.categories });
  const memoryContextWarnings = memoryInfluence.missionMemoryContext.conflicts.map((conflict) => `${conflict.severity}:${conflict.conflictType} — ${conflict.suggestedResolution}`);
  const memoryVerificationCommands = memoryInfluence.memoriesUsed.some((entry) => entry.type === 'verification_rule')
    ? ['node --test stephanos-ui/src/state/intentToBuildModel.test.mjs']
    : [];
  const strengthenedVerificationCommands = [...new Set([...verificationCommands, ...memoryVerificationCommands])];
  const strengthenedSuccessCriteria = [...successCriteria];
  if (memoryInfluence.memoriesUsed.length) {
    strengthenedSuccessCriteria.push('Mission Memory Context is visible, grouped, and cannot override current operator intent.');
  }
  const openClawDelegation = buildOpenClawDelegatedMission({
    missionId,
    operatorIntent: rawIntent,
    missionScope: `Mission scope in ${targetArea}: ${asText(input.implementationScope, `Implement scoped changes in ${targetArea} without violating Stephanos doctrine.`)}` ,
  });

  const finishAuthority = adjudicateMissionFinishAuthority({
    missionId,
    finishAuthorityStatus: asText(input.finishAuthorityStatus, 'not_granted'),
    finishAuthorityLevel: asText(input.finishAuthorityLevel, 'none'),
    routineFinishAllowed: input.routineFinishAllowed === true,
    retryChecksAllowed: input.retryChecksAllowed === true,
    rebuildDistAllowed: input.rebuildDistAllowed === true,
    updatePrAllowed: input.updatePrAllowed === true,
    mergeAuthorityIncluded: input.mergeAuthorityIncluded === true,
    autoMergeArmed: asText(input.autoMergeArmed, 'unknown'),
    operatorApprovalRecorded: input.operatorApprovalRecorded === true,
    approvedBy: asText(input.approvedBy, ''),
    approvedAt: asText(input.approvedAt, ''),
    prNumber: asText(input.prNumber, 'n/a'),
    prUrl: asText(input.prUrl, ''),
    merged: input.merged === true,
    mergedBy: asText(input.mergedBy, ''),
    mergedAt: asText(input.mergedAt, ''),
    mergeCommitSha: asText(input.mergeCommitSha, ''),
    mergeSource: asText(input.mergeSource, 'unknown'),
    checksStatus: asText(input.checksStatus, 'unknown'),
    verificationStatus: asText(input.verificationStatus, 'unknown'),
    scopeStatus: asText(input.scopeStatus, 'in_scope'),
  });

  const repoArchitectureContext = buildRepoArchitectureContext({ operatorIntent: rawIntent, missionSpec: { targetArea, intentClassifications: classifications.categories, openClawDelegation, finishAuthority }, memoryContext: input.memoryContext || {} });


  const verificationLessonCandidates = deriveVerificationReturnLessonCandidates({ verificationReturnText: asText(input.verificationReturnText, ''), missionSpec: { missionId }, verificationJudge: input.verificationJudge || null });
  const memoryLibrarian = buildMemoryLibrarianQueue({
    memoryCandidates: [memoryCandidate],
    verificationLessonCandidates,
    missionMemoryCandidates: Array.isArray(input.memoryContext?.memoryCandidates) ? input.memoryContext.memoryCandidates : [],
    existingPendingCandidates: Array.isArray(input.memoryContext?.pendingMemoryCandidates) ? input.memoryContext.pendingMemoryCandidates : [],
    existingApprovedMemory: Array.isArray(input.memoryContext?.approvedMemoryCandidates) ? input.memoryContext.approvedMemoryCandidates : [],
    capabilitySignals: memoryInfluence.missionMemoryContext.skillForgeCandidate ? [memoryInfluence.missionMemoryContext.skillForgeCandidate] : [],
    verificationJudge: input.verificationJudge || {},
  });


  const prEvidenceIntake = buildPrEvidenceIntake({
    prMetadata: input.prMetadata || null,
    missionSpec: { finishAuthority, repoArchitectureContext },
  });

  const taskFinisherPlan = buildTaskFinisherPlan({
    missionSpec: { missionId },
    verificationJudge: input.verificationJudge || {},
    finishAuthority,
    repoArchitectureContext,
    memoryLibrarianQueue: memoryLibrarian,
    openClawDelegation,
    prMetadata: input.prMetadata || {},
    prEvidenceIntake,
  });

  const missionSpec = {
    missionId,
    status: 'draft',
    generatedAt: now.toISOString(),
    rawIntent,
    targetArea,
    riskLevel,
    implementationScope: asText(input.implementationScope, `Implement scoped changes in ${targetArea} without violating Stephanos doctrine.`),
    nonGoals: asList(input.nonGoals, [
      'Do not deploy or create external infrastructure.',
      'Do not alter launcher/runtime truth boundaries.',
      'Do not treat dist output as source-of-truth code.',
    ]),
    doctrineConstraints: [...DOCTRINE_CONSTRAINTS],
    verificationCommands: strengthenedVerificationCommands,
    successCriteria: strengthenedSuccessCriteria,
    approvalBoundary: boundaries,
    privacyBoundary: 'No secrets committed. No cloud durable memory writes without explicit approval.',
    costBoundary: 'Zero-cost defaults remain active unless operator explicitly approves paid routes.',
    intentClassifications: classifications.categories,
    missionMemoryCandidate: memoryCandidate,
    missionMemoryInfluence: memoryInfluence.memoriesUsed,
    missionMemoryInfluenceCount: memoryInfluence.missionMemoryInfluenceCount,
    missionMemoryInfluenceTypes: memoryInfluence.missionMemoryInfluenceTypes,
    missionMemoryInfluenceLevels: memoryInfluence.missionMemoryInfluenceLevels,
    missionMemoryContext: memoryInfluence.missionMemoryContext,
    missionMemoryConflicts: memoryInfluence.missionMemoryContext.conflicts,
    missionMemorySkillForgeCandidate: memoryInfluence.missionMemoryContext.skillForgeCandidate,
    missionMemoryLastAppliedAt: memoryInfluence.missionMemoryLastAppliedAt,
    likelyAffectedSystems: [...new Set([targetArea, ...memoryInfluence.memoriesUsed.flatMap((entry) => entry.appliedTo.includes('likely_affected_systems') ? [entry.type] : [])])],
    allowedScope: `Operator intent remains primary; memory may strengthen scope but cannot silently rewrite: ${asText(input.implementationScope, `Implement scoped changes in ${targetArea} without violating Stephanos doctrine.`)}`,
    risks: [...asList(input.risks, []), ...memoryContextWarnings],
    nextBestAction: memoryContextWarnings.length ? 'Resolve surfaced memory/intent conflicts before handoff execution.' : 'Generate Codex-safe implementation handoff and run required verification.',
    openClawDelegation,
    finishAuthority,
    prEvidenceIntake,
    repoArchitectureContext,
    memoryLibrarian,
    taskFinisherPlan,
  };


  const missionEvidenceLedger = buildMissionEvidenceLedger({
    missionSpec,
    verificationReturnText: asText(input.verificationReturnText, ''),
    verificationJudge: input.verificationJudge || null,
    taskFinisherPlan,
    memoryLibrarianQueue: memoryLibrarian,
  });
  missionSpec.missionEvidenceLedger = missionEvidenceLedger;
  missionSpec.operatorDecisionConsole = buildOperatorDecisionQueue({
    missionSpec,
    missionEvidenceLedger,
    memoryLibrarianQueue: memoryLibrarian,
    verificationJudge: input.verificationJudge || {},
    taskFinisherPlan,
    finishAuthority,
    prEvidenceIntake,
    openClawDelegation,
    repoArchitectureContext,
  });

  missionSpec.supportSnapshot = {
    ...(missionSpec.supportSnapshot || {}),
    operatorDecisionPendingCount: missionSpec.operatorDecisionConsole.summary.pendingDecisionCount,
    operatorDecisionApprovalRequiredCount: missionSpec.operatorDecisionConsole.summary.approvalRequiredCount,
    operatorDecisionHighRiskCount: missionSpec.operatorDecisionConsole.summary.highRiskDecisionCount,
    operatorDecisionBlockedCount: missionSpec.operatorDecisionConsole.summary.blockedDecisionCount,
    operatorDecisionRecommendedNext: missionSpec.operatorDecisionConsole.summary.recommendedNextDecision,
    operatorDecisionCanFinishMission: missionSpec.operatorDecisionConsole.summary.operatorCanFinishMission,
    operatorDecisionMergeRequired: missionSpec.operatorDecisionConsole.summary.operatorMergeDecisionRequired,
    operatorDecisionMemoryApprovalRequired: missionSpec.operatorDecisionConsole.summary.memoryApprovalRequired,
    operatorDecisionCodexFixRecommended: missionSpec.operatorDecisionConsole.summary.codexFixRecommended,
    operatorDecisionProofReviewRequired: missionSpec.operatorDecisionConsole.summary.proofReviewRequired,
  };

  return missionSpec;
}

export function classifyOperatorIntent(intentText = '') {
  const text = asText(intentText).toLowerCase();
  const has = (pattern) => pattern.test(text);
  const categories = new Set();
  if (has(/vision|north star|product|strategy|goal/)) categories.add('product_vision');
  if (has(/architecture|canon|law|invariant|truth boundary/)) categories.add('architecture_rule');
  if (has(/prefer|workflow|process|habit|style/)) categories.add('workflow_preference');
  if (has(/bug|regression|incident|failure|lesson/)) categories.add('bug_lesson');
  if (has(/need|missing|capability|support|add/i)) categories.add('capability_request');
  if (has(/ui|panel|tile|layout|copy button/)) categories.add('ui_request');
  if (has(/agent|orchestr|handoff|mission console/)) categories.add('agent_orchestration_request');
  if (has(/verify|test|acceptance|merge-ready/)) categories.add('verification_rule');
  if (has(/memory|remember|store|recall|lesson learned/)) categories.add('memory_request');
  if (categories.size === 0) categories.add('product_vision');
  return { categories: [...categories].filter((entry) => INTENT_CATEGORIES.includes(entry)) };
}

export function buildMissionMemoryCandidate({ operatorIntentText = '', categories = [] } = {}) {
  const intentSummary = asText(operatorIntentText).slice(0, 180) || 'No intent supplied.';
  const categorySet = new Set(asList(categories));
  let memoryCandidateType = 'temporary_note';
  if (categorySet.has('architecture_rule')) memoryCandidateType = 'architecture_canon_candidate';
  else if (categorySet.has('workflow_preference')) memoryCandidateType = 'durable_operator_preference';
  else if (categorySet.has('bug_lesson')) memoryCandidateType = 'project_lesson';
  else if (categorySet.has('capability_request')) memoryCandidateType = 'capability_gap';
  const requiresOperatorApproval = memoryCandidateType === 'architecture_canon_candidate' || memoryCandidateType === 'durable_operator_preference';
  return {
    operatorIntentText: asText(operatorIntentText),
    intentSummary,
    intentCategory: asList(categories, ['product_vision']),
    memoryCandidateType: MEMORY_CANDIDATE_TYPES.includes(memoryCandidateType) ? memoryCandidateType : 'temporary_note',
    suggestedDurability: requiresOperatorApproval ? 'durable' : 'session',
    confidence: requiresOperatorApproval ? 0.72 : 0.79,
    reason: requiresOperatorApproval ? 'Potential canon/preference impact; explicit approval is required.' : 'Useful mission context signal for planning and verification continuity.',
    relatedSystems: ['mission-console', 'intent-to-build', 'agent-task-model', 'codex-handoff', 'verification-return'],
    possibleCapabilityGap: categorySet.has('capability_request') ? 'Mission Memory intent-to-build planning loop needs first-class shared projection.' : 'none-detected',
    suggestedMissionGoal: 'Generate bounded mission proposal from operator intent while preserving Stephanos truth boundaries.',
    suggestedAcceptanceCriteria: ['Intent captured and classified.', 'Codex handoff includes acceptance criteria and verification commands.'],
    suggestedBlockedActions: ['destructive execution', 'openclaw execution', 'shell/file/git/browser actions', 'git push', 'external account actions'],
    suggestedVerificationCommands: ['npm run stephanos:build', 'npm run stephanos:verify'],
    requiresOperatorApproval,
    promotionState: requiresOperatorApproval ? 'pending-operator-approval' : 'draft-local',
  };
}

export function buildCodexHandoffPrompt({ missionSpec = {}, repoPath = '/workspace/stephan-os' } = {}) {
  const spec = missionSpec && typeof missionSpec === 'object' ? missionSpec : buildMissionSpec();
  const likelyFiles = asList(spec.likelyFiles, [
    'stephanos-ui/src/components/MissionConsoleTile.jsx',
    'stephanos-ui/src/state/intentToBuildModel.js',
    'stephanos-ui/src/state/supportSnapshot.js',
  ]);
  const memoryInfluence = Array.isArray(spec.missionMemoryInfluence) ? spec.missionMemoryInfluence : [];
  const memoryConflicts = Array.isArray(spec.missionMemoryConflicts) ? spec.missionMemoryConflicts : [];
  const groupedMemory = spec.missionMemoryContext?.groups && typeof spec.missionMemoryContext.groups === 'object' ? spec.missionMemoryContext.groups : {};
  const lines = [
    'Codex Mission Handoff',
    `Mission ID: ${asText(spec.missionId, 'n/a')}`,
    `Repo Context: ${repoPath}`,
    '',
    'Operator Intent:',
    `- ${asText(spec.rawIntent, 'n/a')}`,
    '',
    'Doctrine Constraints:',
    ...asList(spec.doctrineConstraints, DOCTRINE_CONSTRAINTS).map((entry) => `- ${entry}`),
    '',
    'Implementation Scope:',
    `- ${asText(spec.implementationScope, 'n/a')}`,
    '',
    'Non-Goals:',
    ...asList(spec.nonGoals).map((entry) => `- ${entry}`),
    '',
    'Likely Files Involved:',
    ...likelyFiles.map((entry) => `- ${entry}`),
    '',
    'Allowed Actions (auto):',
    ...asList(spec.approvalBoundary?.allowedActions).map((entry) => `- ${entry}`),
    '',
    'Blocked Actions (require approval):',
    ...asList(spec.approvalBoundary?.blockedActions).map((entry) => `- ${entry}`),
    '',
    'Verification Commands:',
    ...asList(spec.verificationCommands).map((entry) => `- ${entry}`),
    '',
    'PR Acceptance Criteria:',
    ...asList(spec.successCriteria).map((entry) => `- ${entry}`),
    '',
    'Memory Context (approved durable + explicitly marked draft context only):',
    ...(Object.entries(groupedMemory).length ? Object.entries(groupedMemory).flatMap(([group, entries]) => entries.length ? [`- ${group}:`, ...entries.map((entry) => `  - [${asText(entry.influenceLevel, 'weak_context')}; ${asText(entry.relevanceScore, 'n/a')}] ${asText(entry.summary, 'n/a')}`)] : []) : []),
    ...(memoryInfluence.length ? [] : ['- none']),
    '',
    'Applied Canon/Lessons:',
    ...(memoryInfluence.length ? memoryInfluence.map((entry) => `- [${asText(entry.type, 'unknown')}] applies to ${(entry.appliedTo || []).join(', ') || 'mission context'}: ${asText(entry.summary, 'n/a')}`) : ['- none']),
    '',
    'Memory Conflicts / Required Handling:',
    ...(memoryConflicts.length ? memoryConflicts.map((conflict) => `- ${asText(conflict.severity)} ${asText(conflict.conflictType)} from ${asText(conflict.memorySource)}: ${asText(conflict.suggestedResolution)}`) : ['- none surfaced']),
    '- Memory cannot override operator authority or silently rewrite current operator intent.',
    '',
    'Memory Governance (approval-gated):',
    `- pending candidates: ${spec.memoryLibrarian?.counts?.pending ?? 0}`,
    `- approval required: ${spec.memoryLibrarian?.counts?.approvalRequired ?? 0}`,
    `- canon candidates: ${spec.memoryLibrarian?.counts?.canonCandidates ?? 0}`,
    `- project lessons: ${spec.memoryLibrarian?.counts?.projectLessons ?? 0}`,
    `- capability gaps: ${spec.memoryLibrarian?.counts?.capabilityGaps ?? 0}`,
    `- duplicates/conflicts: ${(spec.memoryLibrarian?.counts?.duplicates ?? 0)}/${(spec.memoryLibrarian?.counts?.conflicts ?? 0)}`,
    '- Pending memory candidates are not approved durable guidance.',
    '- New lesson/canon/preference candidates remain operator approval-gated.',
    '- Do not auto-promote project law/canon.',
    '- If recurring lessons are found, return them as verification candidates.',
    '',

    '',
    'Mission Finish Authority:',
    `- finish_authority_status: ${asText(spec.finishAuthority?.finishAuthorityStatus, 'not_granted')}`,
    `- finish_authority_level: ${asText(spec.finishAuthority?.finishAuthorityLevel, 'none')}`,
    `- routine_finish_allowed: ${spec.finishAuthority?.routineFinishAllowed ? 'yes' : 'no'}`,
    `- retry_checks_allowed: ${spec.finishAuthority?.retryChecksAllowed ? 'yes' : 'no'}`,
    `- rebuild_dist_allowed: ${spec.finishAuthority?.rebuildDistAllowed ? 'yes' : 'no'}`,
    `- update_pr_allowed: ${spec.finishAuthority?.updatePrAllowed ? 'yes' : 'no'}`,
    `- merge_authority_included: ${spec.finishAuthority?.mergeAuthorityIncluded ? 'yes' : 'no'}`,
    `- auto_merge_armed: ${asText(spec.finishAuthority?.autoMergeArmed, 'unknown')}`,
    `- operator_approval_recorded: ${spec.finishAuthority?.operatorApprovalRecorded ? 'yes' : 'no'}`,
    `- merged: ${spec.finishAuthority?.merged ? 'yes' : 'no'}`,
    `- merged_by: ${asText(spec.finishAuthority?.mergedBy, 'unknown')}`,
    `- scope_status: ${asText(spec.finishAuthority?.scopeStatus, 'in_scope')}`,
    `- warnings: ${(spec.finishAuthority?.warnings || []).join(' | ') || 'none'}`,
    `- next_action: ${asText(spec.finishAuthority?.nextAction, 'Merge is not authorized by this mission.')}`,
    '- Merge is not authorized by this mission.',
    '- Scope expansion is blocked.',
    '- Operator-only: destructive actions, secrets, external accounts, GitHub settings changes, and OpenClaw execution.',

    'OpenClaw Delegation Envelope:',
    `- delegated_to: ${asText(spec.openClawDelegation?.delegatedTo, 'openclaw')}`,
    `- authority_level: ${asText(spec.openClawDelegation?.authorityLevel, 'research_and_plan')}`,
    `- finish_authority: ${asText(spec.openClawDelegation?.finishAuthority, 'plan_only')}`,
    `- allowed_capabilities: ${asList(spec.openClawDelegation?.allowedCapabilities).join(', ') || 'none'}`,
    `- blocked_capabilities: ${asList(spec.openClawDelegation?.blockedCapabilities).join(', ') || 'none'}`,
    '- self-authority escalation blocked: true',
    '- OpenClaw may not grant itself powers.',
    '- OpenClaw may help design controls but not bypass them.',
    '- OpenClaw may not merge.',
    '- OpenClaw may not grant itself finish authority.',
    '- OpenClaw may not expand mission scope.',
    '- OpenClaw may prepare finish-readiness reports only unless future authority is explicitly granted.',
    '- Operator final authority.',
    '',


    'Mission Routing / Delegation Readiness:',
    '- current route: draft (computed in Mission Command Packet routing summary).',
    '- codex recommended recipient: only when route status is ready_for_codex.',
    '- openclaw research allowed: only when research-only delegation is explicitly ready.',
    '- evidence must be returned before verification/finish claims.',
    '- blocked remains blocked: shell execution, GitHub write/merge automation, OpenClaw execution, secrets, external accounts, memory auto-promotion.',
    '- operator decision required before merge/authority transitions.',
    '- if route is not ready_for_codex, Codex should not proceed until blockers are resolved.',
    '',
    'Task Finisher / Routine Finish Plan:',
    `- plan_status: ${asText(spec.taskFinisherPlan?.finishPlanStatus, 'unknown')}`,
    `- plan_level: ${asText(spec.taskFinisherPlan?.finishPlanLevel, 'recommendations_only')}`,
    `- safe_to_continue: ${spec.taskFinisherPlan?.safeToContinueRoutineFinish ? 'yes' : 'no'}`,
    `- routine_tasks: ${(spec.taskFinisherPlan?.routineTasks || []).join(', ') || 'none'}`,
    `- blocked_tasks: ${(spec.taskFinisherPlan?.blockedTasks || []).join(', ') || 'none'}`,
    `- codex_may_fix: ${spec.taskFinisherPlan?.codexRepairNeeded ? 'yes (narrow fix only)' : 'not required'}`,
    `- rebuild_dist_expected: ${spec.taskFinisherPlan?.rebuildDistNeeded ? 'yes' : 'no'}`,
    `- rerun_tests_expected: ${spec.taskFinisherPlan?.rerunTestsNeeded ? 'yes' : 'no'}`,
    `- merge_operator_controlled: ${spec.taskFinisherPlan?.mergeStillOperatorControlled ? 'yes' : 'no'}`,
    `- required_operator_decisions: ${(spec.taskFinisherPlan?.requiredOperatorDecisions || []).join(' | ') || 'none'}`,
    `- warnings: ${(spec.taskFinisherPlan?.warnings || []).join(' | ') || 'none'}`,
    '- no shell/GitHub execution is performed by Stephanos UI.',
    '',

    'Architecture Map / Likely Impact:',
    `- affected subsystems: ${(spec.repoArchitectureContext?.affectedSubsystems || []).join(', ') || 'none'}`,
    ...asList(spec.repoArchitectureContext?.sourceFilesLikelyTouched).map((entry) => `- likely source file: ${entry}`),
    ...asList(spec.repoArchitectureContext?.testsLikelyRequired).map((entry) => `- likely test: ${entry}`),
    ...asList(spec.repoArchitectureContext?.generatedOutputsLikelyTouched).map((entry) => `- generated output: ${entry}`),
    ...asList(spec.repoArchitectureContext?.docsLikelyTouched).map((entry) => `- likely doc: ${entry}`),
    ...asList(spec.repoArchitectureContext?.sourceTruthWarnings).map((entry) => `- source-truth warning: ${entry}`),
    ...asList(spec.repoArchitectureContext?.commonFailureModes).map((entry) => `- common failure mode: ${entry}`),
    ...asList(spec.repoArchitectureContext?.verificationCommandsLikelyRequired).map((entry) => `- architecture verify command: ${entry}`),
    '- do not edit generated dist as source truth.',
    '- update dist only through npm run stephanos:build when required.',
    '- update support snapshot fields when new mission truth is added.',
    '- preserve Mission Console / launcher separation.',
    '- preserve operator final authority.',
    '',
    'Verification Return Contract (required in Codex return):',
    '- changed files (explicit list).',
    '- tests run (exact commands + pass/fail).',
    '- build/verify results (include npm run stephanos:build and npm run stephanos:verify outcomes).',
    '- whether generated dist was rebuilt when dist was touched.',
    '- whether support snapshot mission verification fields were updated when required.',
    '- operator-visible proof evidence and any manual verification steps.',
    '- blockers/failures and unresolved risks.',
    '- explicit statement: no OpenClaw execution, no shell outside approved scope, no git push, no merge, no secrets access, no external-account action.',
    '',
    '',
    'Operator Decision Awareness (required):',
    `- pending decision count: ${spec.operatorDecisionConsole?.summary?.pendingDecisionCount ?? 0}`,
    `- recommended next decision: ${asText(spec.operatorDecisionConsole?.summary?.recommendedNextDecision, 'none')}`,
    '- Return evidence that supports each operator decision.',
    '- Do not assume approval; call out decisions requiring explicit operator review.',
    '- Do not auto-promote memory/canon candidates.',
    '- Do not merge unless merge authority is explicitly included.',
    '- Identify any outstanding operator decision before claiming completion.',

    'Mission Evidence Ledger Expectations:',
    '- Codex should return evidence in an ingestible, ledger-friendly format.',
    '- Include changed files, tests, build/verify outputs, PR URL, blockers, proof-of-done evidence, and safety confirmation.',
    '- Do not claim merge-ready without evidence.',
    '- Do not auto-promote lessons/canon.',
    '',
    'PR Evidence Return (if metadata is available):',
    '- Operator may paste PR evidence back into Mission Console. Return compact PR metadata in a parseable format.',
    '- Suggested format:',
    '- PR:',
    '- Number:',
    '- URL:',
    '- Branch:',
    '- State:',
    '- Checks:',
    '- Changed files:',
    '- Merged:',
    '- Merged by:',
    '- Merged at:',
    '- Auto-merge:',
    '- Codex task:',
    '- PR number and PR URL.',
    '- branch name (head) and base branch.',
    '- changed files and changed file count.',
    '- checks status and required checks status.',
    '- build + verify status summary.',
    '- merge status, merged by/at (if known).',
    '- whether auto-merge was enabled/armed.',
    '- Codex task link/id (if known).',
    '- explicit safety statement: no GitHub write/merge action was performed unless mission authority explicitly included it.',
    '',
    'Safety Doctrine (mandatory):',
    '- No destructive actions.',
    '- No git push.',
    '- No secrets handling or persistence.',
    '- No external account actions.',
    '- Build + verify required before merge-ready posture.',
    '- Operator final authority; memory cannot override operator authority; no autonomous execution.',
  ];

  return lines.join('\n');
}

export function buildVerificationEvidence({ missionSpec = {}, commands = null } = {}) {
  const checks = asList(commands, missionSpec.verificationCommands || [
    'npm run stephanos:build',
    'npm run stephanos:verify',
    'node --test stephanos-ui/src/state/intentToBuildModel.test.mjs',
    'git status --short',
  ]);

  return {
    verificationStatus: 'pending',
    checks: checks.map((command) => ({ command, status: 'pending', evidence: '' })),
    prReviewStatus: 'pending-review',
  };
}

export { deriveVerificationReturnLessonCandidates };

export function createIntentToBuildState(input = {}, options = {}) {
  const missionSpec = buildMissionSpec(input, options);
  const codexPrompt = buildCodexHandoffPrompt({ missionSpec });
  const verificationEvidence = buildVerificationEvidence({ missionSpec });

  return {
    missionSpec,
    codexPrompt,
    verificationEvidence,
    generatedPromptAvailable: Boolean(codexPrompt),
    approvalRequired: missionSpec.approvalBoundary?.approvalRequired === true,
  };
}

export const INTENT_TO_BUILD_BOUNDARIES = Object.freeze({
  autoAllowed: DEFAULT_AUTOMATION_ALLOWED,
  requiresApproval: DEFAULT_APPROVAL_REQUIRED,
});
