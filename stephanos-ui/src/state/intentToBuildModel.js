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
  };

  return missionSpec;
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
