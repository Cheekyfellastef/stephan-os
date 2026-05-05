function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asText(entry)).filter(Boolean);
}

export const OPENCLAW_FINISH_AUTHORITY = Object.freeze([
  'plan_only',
  'research_and_plan',
  'prepare_codex_handoff',
  'finish_routine_checks',
  'merge_authorized',
]);

export function buildOpenClawDelegatedMission(input = {}) {
  const operatorIntent = asText(input.operatorIntent, 'No operator intent supplied yet.');
  const lower = operatorIntent.toLowerCase();
  const openClawRelated = input.openClawRelated === true
    || /(openclaw|delegat|research|task completion|control-system|self-control)/i.test(operatorIntent);
  const authorityLevel = ['plan_only', 'research_and_plan', 'prepare_codex_handoff'].includes(input.authorityLevel)
    ? input.authorityLevel
    : (lower.includes('handoff') || lower.includes('codex') ? 'prepare_codex_handoff' : 'research_and_plan');

  const allowedCapabilities = ['research', 'planning', 'repo-inspection', 'codex-handoff-draft'];
  const blockedCapabilities = ['execution', 'mutation', 'shell', 'git-push', 'merge', 'secrets', 'external-account', 'self-authority-escalation'];

  return {
    missionId: asText(input.missionId, 'n/a'),
    operatorIntent,
    delegatedTo: 'openclaw',
    authorityLevel,
    allowedCapabilities,
    blockedCapabilities,
    missionScope: asText(input.missionScope, 'Bounded research/planning for current mission.').slice(0, 240),
    blockedScope: 'No execution/mutation/shell/git push/merge/secrets/external-account/self-authority escalation.',
    researchAllowed: true,
    repoInspectionAllowed: true,
    codexHandoffDraftAllowed: true,
    mutationAllowed: false,
    shellAllowed: false,
    gitPushAllowed: false,
    mergeAllowed: false,
    secretsAllowed: false,
    externalAccountAllowed: false,
    selfAuthorityEscalationAllowed: false,
    status: openClawRelated ? 'delegation-preview-ready' : 'inactive',
    reason: openClawRelated
      ? 'OpenClaw may help research/design/propose, including self-control design, but cannot approve/grant/persist/execute authority.'
      : 'OpenClaw delegation not requested by this mission intent.',
    requiredOperatorApproval: true,
    verificationRequired: true,
    finishAuthority: authorityLevel,
    selfControlConstructionCanon: 'OpenClaw may help design controls but cannot approve, grant, persist, or execute new authority for itself. Operator approval is required for any authority increase.',
    openClawRelated,
  };
}
