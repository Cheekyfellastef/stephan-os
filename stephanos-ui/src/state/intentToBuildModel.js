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
  const memoryCandidate = buildMissionMemoryCandidate({ operatorIntentText: rawIntent, categories: classifications.categories });
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
    verificationCommands,
    successCriteria,
    approvalBoundary: boundaries,
    privacyBoundary: 'No secrets committed. No cloud durable memory writes without explicit approval.',
    costBoundary: 'Zero-cost defaults remain active unless operator explicitly approves paid routes.',
    intentClassifications: classifications.categories,
    missionMemoryCandidate: memoryCandidate,
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
