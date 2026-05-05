import { buildMissionMemoryContext, deriveVerificationReturnLessonCandidates } from './missionMemoryOrchestrator.js';
import { buildOpenClawDelegatedMission } from './openClawDelegationModel.js';
import { adjudicateMissionFinishAuthority } from './missionFinishAuthorityModel.js';
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
