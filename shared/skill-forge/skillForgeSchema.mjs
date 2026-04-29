export const SKILL_FORGE_STATUSES = Object.freeze([
  'DRAFT',
  'AWAITING_REVIEW',
  'APPROVED_INACTIVE',
  'ACTIVE',
  'PAUSED',
  'REJECTED',
  'ARCHIVED',
]);

export const SKILL_FORGE_PERMISSION_LEVELS = Object.freeze([
  'READ_ONLY',
  'LOCAL_CONTEXT_ONLY',
  'COPY_TEXT_ONLY',
  'PROPOSE_ONLY',
  'NEEDS_OPERATOR_APPROVAL',
  'EXTERNAL_ACTION_BLOCKED',
  'DANGEROUS_REQUIRES_SPECIAL_APPROVAL',
]);

export const SKILL_FORGE_RISK_LEVELS = Object.freeze(['LOW', 'LOW_MEDIUM', 'MEDIUM', 'HIGH', 'BLOCKED']);

const LABELS = {
  status: {
    DRAFT: 'Draft',
    AWAITING_REVIEW: 'Awaiting review',
    APPROVED_INACTIVE: 'Approved (inactive)',
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    REJECTED: 'Rejected',
    ARCHIVED: 'Archived',
  },
  permission: {
    READ_ONLY: 'Read-only (look but do not touch)',
    LOCAL_CONTEXT_ONLY: 'Local context only',
    COPY_TEXT_ONLY: 'Copy text only',
    PROPOSE_ONLY: 'Propose only',
    NEEDS_OPERATOR_APPROVAL: 'Needs operator approval',
    EXTERNAL_ACTION_BLOCKED: 'External action blocked',
    DANGEROUS_REQUIRES_SPECIAL_APPROVAL: 'Dangerous: special approval required',
  },
  risk: {
    LOW: 'Low',
    LOW_MEDIUM: 'Low-Medium',
    MEDIUM: 'Medium',
    HIGH: 'High',
    BLOCKED: 'Blocked',
  },
};

export function getSkillStatusLabel(status) { return LABELS.status[status] || 'Unknown status'; }
export function getSkillPermissionLabel(permissionLevel) { return LABELS.permission[permissionLevel] || 'Unknown permission'; }
export function getSkillRiskLabel(riskLevel) { return LABELS.risk[riskLevel] || 'Unknown risk'; }

export function getSkillOperatorSummary(skill = {}) {
  return `${skill.name || 'Skill'} is ${getSkillStatusLabel(skill.status)} with ${getSkillRiskLabel(skill.riskLevel)} risk and ${getSkillPermissionLabel(skill.permissionLevel)} permissions.`;
}

export function buildSkillReviewHandoff(skill = {}) {
  const evidence = Array.isArray(skill.evidence) && skill.evidence.length > 0
    ? skill.evidence.map((entry) => `  - ${entry.type}: ${entry.summary}`).join('\n')
    : '  - none provided';
  return [
    'Skill Review Handoff:',
    `- Skill name: ${skill.name || 'Unknown'}`,
    `- Category: ${skill.category || 'Unknown'}`,
    `- Plain-English purpose: ${skill.plainEnglishSummary || 'n/a'}`,
    `- Why proposed: ${skill.whySuggested || 'n/a'}`,
    '- Evidence:',
    evidence,
    `- Proposed permission level: ${skill.permissionLevel || 'n/a'}`,
    `- Allowed actions: ${(skill.allowedTouches || []).join('; ') || 'n/a'}`,
    `- Forbidden actions: ${(skill.forbiddenTouches || []).join('; ') || 'n/a'}`,
    `- Risk level: ${skill.riskLevel || 'n/a'}`,
    `- Rollback path: ${skill.rollbackPath || 'n/a'}`,
    `- Recommendation: ${skill.suggestedNextAction || 'Review with operator.'}`,
    '- Implementation guardrails: Dist is never source of truth. Preserve canonical runtime truth and operator approval gates.',
    '- Do not activate, execute, or grant new permissions without operator approval.',
  ].join('\n');
}

export function filterSkillCandidates(candidates = [], filter = 'all') {
  return candidates.filter((skill) => {
    if (filter === 'all') return true;
    if (filter === 'awaiting-review') return skill.status === 'AWAITING_REVIEW';
    if (filter === 'draft') return skill.status === 'DRAFT';
    if (filter === 'approved-inactive') return skill.status === 'APPROVED_INACTIVE';
    if (filter === 'active') return skill.status === 'ACTIVE';
    if (filter === 'paused') return skill.status === 'PAUSED';
    if (filter === 'rejected') return skill.status === 'REJECTED' || skill.status === 'ARCHIVED';
    if (filter === 'low-risk') return skill.riskLevel === 'LOW';
    if (filter === 'high-risk') return ['HIGH', 'BLOCKED'].includes(skill.riskLevel);
    if (filter === 'read-only') return skill.permissionLevel === 'READ_ONLY';
    if (filter === 'needs-approval') return skill.permissionLevel === 'NEEDS_OPERATOR_APPROVAL';
    if (filter === 'openclaw-related') return (skill.tags || []).includes('openclaw-related');
    if (filter === 'memory-related') return (skill.tags || []).includes('memory-related');
    if (filter === 'troubleshooting') return (skill.tags || []).includes('troubleshooting');
    if (filter === 'codex-handoff') return (skill.tags || []).includes('codex-handoff');
    return true;
  });
}
