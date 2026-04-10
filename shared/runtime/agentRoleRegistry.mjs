const BUILTIN_AGENT_ROLES = Object.freeze([
  {
    id: 'architect',
    label: 'Architect',
    allowedMissionClasses: ['analysis', 'build-system', 'build-runtime', 'build-integration'],
    allowedToolTypes: ['read-code', 'inspect-state', 'prepare-codex-handoff'],
    authorityLevel: 'planning',
    requiresApproval: true,
    mutationAllowed: false,
    auditRequired: true,
    executionNotes: 'Defines deterministic mission plan and constraints.',
  },
  {
    id: 'builder',
    label: 'Builder',
    allowedMissionClasses: ['build-ui', 'build-runtime', 'build-tooling', 'build-integration'],
    allowedToolTypes: ['read-code', 'generate-patch', 'verify-build', 'run-tests'],
    authorityLevel: 'implementation',
    requiresApproval: true,
    mutationAllowed: true,
    auditRequired: true,
    executionNotes: 'Prepares implementation packets; no silent execution.',
  },
  {
    id: 'auditor',
    label: 'Auditor',
    allowedMissionClasses: ['analysis', 'proposal-review', 'build-integration'],
    allowedToolTypes: ['inspect-state', 'verify-build', 'run-tests'],
    authorityLevel: 'audit',
    requiresApproval: false,
    mutationAllowed: false,
    auditRequired: true,
    executionNotes: 'Validates truth separation and guardrails.',
  },
  {
    id: 'runtime-observer',
    label: 'Runtime Observer',
    allowedMissionClasses: ['inspect', 'troubleshoot', 'build-runtime'],
    allowedToolTypes: ['inspect-state', 'inspect-transport', 'inspect-provider'],
    authorityLevel: 'observe',
    requiresApproval: false,
    mutationAllowed: false,
    auditRequired: true,
    executionNotes: 'Inspects runtime truth and route viability.',
  },
  {
    id: 'integrator',
    label: 'Integrator',
    allowedMissionClasses: ['roadmap-operation', 'build-integration'],
    allowedToolTypes: ['update-roadmap', 'update-activity', 'prepare-codex-handoff'],
    authorityLevel: 'integration',
    requiresApproval: true,
    mutationAllowed: true,
    auditRequired: true,
    executionNotes: 'Promotes approved work into roadmap/activity truth.',
  },
  {
    id: 'transport-operator',
    label: 'Transport Operator',
    allowedMissionClasses: ['build-transport', 'route-config', 'troubleshoot'],
    allowedToolTypes: ['inspect-transport', 'inspect-provider', 'inspect-state'],
    authorityLevel: 'transport',
    requiresApproval: true,
    mutationAllowed: false,
    auditRequired: true,
    executionNotes: 'Handles transport/path diagnostics without route truth invention.',
  },
  {
    id: 'ui-operator',
    label: 'UI Operator',
    allowedMissionClasses: ['build-ui', 'build-surface', 'inspect'],
    allowedToolTypes: ['read-code', 'generate-patch', 'verify-build'],
    authorityLevel: 'surface',
    requiresApproval: true,
    mutationAllowed: true,
    auditRequired: true,
    executionNotes: 'Applies surface changes under approval gating.',
  },
  {
    id: 'memory-curator',
    label: 'Memory Curator',
    allowedMissionClasses: ['memory-operation', 'recall', 'graph-operation'],
    allowedToolTypes: ['inspect-memory', 'inspect-graph', 'inspect-state'],
    authorityLevel: 'memory',
    requiresApproval: true,
    mutationAllowed: false,
    auditRequired: true,
    executionNotes: 'Maintains bounded memory and graph truth.',
  },
]);

export function listAgentRoles() {
  return BUILTIN_AGENT_ROLES.map((role) => ({ ...role }));
}

export function getAgentRole(roleId = '') {
  const key = String(roleId || '').trim().toLowerCase();
  return BUILTIN_AGENT_ROLES.find((role) => role.id === key) || null;
}
