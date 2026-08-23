const TARGET_COMMANDS = Object.freeze(['standalone', 'scout-coder']);
const MUTATION_TERMS = Object.freeze([
  'exec', 'shell', 'write', 'edit', 'apply_patch', 'git push', 'merge', 'install', 'uninstall', 'policy',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCommandName(value) {
  return text(value).replace(/^\/+/, '').toLowerCase();
}

function includesTarget(value, target) {
  const normalized = text(value).toLowerCase();
  return normalized.includes(`/${target}`) || normalized.includes(target);
}

function classifyRegistration(matches = [], target) {
  const relevant = matches.filter((entry) => includesTarget(entry?.excerpt, target) || includesTarget(entry?.path, target));
  const joined = relevant.map((entry) => `${entry.path || ''}\n${entry.excerpt || ''}`).join('\n').toLowerCase();
  if (/registercommand\s*\(/.test(joined)) return { kind: 'plugin-command', confidence: 'high', relevant };
  if (/command-dispatch\s*:\s*tool|nativeSkills|skills?\//.test(joined)) return { kind: 'skill-command', confidence: 'medium', relevant };
  if (/agents?|agentid|workspace/.test(joined)) return { kind: 'agent-routing-config', confidence: 'medium', relevant };
  if (relevant.length > 0) return { kind: 'unknown-configured-command', confidence: 'low', relevant };
  return { kind: 'not-found', confidence: 'none', relevant: [] };
}

function detectMutationAuthority(entries = []) {
  const joined = entries.map((entry) => `${entry.path || ''}\n${entry.excerpt || ''}`).join('\n').toLowerCase();
  return MUTATION_TERMS.filter((term) => joined.includes(term));
}

export function assessOpenClawAgentCommandInventory(inventory = {}) {
  const matches = Array.isArray(inventory.matches) ? inventory.matches : [];
  const agents = Array.isArray(inventory.agents) ? inventory.agents : [];
  const gatewayHealthy = inventory.gateway?.exitCode === 0;
  const results = TARGET_COMMANDS.map((target) => {
    const registration = classifyRegistration(matches, target);
    const matchingAgents = agents.filter((agent) => {
      const id = text(agent?.id || agent?.agentId || agent?.name).toLowerCase();
      return id === target || id.includes(target);
    });
    const mutationTerms = detectMutationAuthority(registration.relevant);
    const blockingReasons = [];
    if (!gatewayHealthy) blockingReasons.push('gateway-status-unproven');
    if (registration.kind === 'not-found') blockingReasons.push('command-registration-not-found');
    if (matchingAgents.length === 0) blockingReasons.push('target-agent-not-found');
    if (matchingAgents.length > 1) blockingReasons.push('target-agent-ambiguous');
    if (mutationTerms.length > 0) blockingReasons.push('mutation-authority-requires-review');
    return {
      command: `/${target}`,
      targetAgentCandidates: matchingAgents,
      registrationKind: registration.kind,
      registrationConfidence: registration.confidence,
      provenanceMatches: registration.relevant,
      mutationTerms,
      blockingReasons,
      readyForUpgradeDecision: blockingReasons.length === 0,
    };
  });
  return {
    schemaVersion: 1,
    auditKind: 'openclaw-agent-command-upgrade-decision',
    commands: results,
    allCommandsGrounded: results.every((result) => result.readyForUpgradeDecision),
    finalVerdict: results.every((result) => result.readyForUpgradeDecision)
      ? 'OPENCLAW_AGENT_COMMAND_AUDIT_READY_FOR_UPGRADE_DECISION'
      : 'OPENCLAW_AGENT_COMMAND_AUDIT_BLOCKED',
  };
}

export { TARGET_COMMANDS };
