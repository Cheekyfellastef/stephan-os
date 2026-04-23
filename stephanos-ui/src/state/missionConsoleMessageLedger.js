function newId(prefix = 'mc-msg') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow() {
  return new Date().toISOString();
}

export function createMissionConsoleMessage({
  role = 'assistant',
  responder = 'Stephanos',
  target = 'stephanos',
  content = '',
  status = 'ready',
  approvalNeeded = false,
  linkedProposalId = '',
} = {}) {
  return {
    id: newId('mission-message'),
    role,
    responder,
    target,
    content: String(content || '').trim(),
    status,
    approvalNeeded,
    linkedProposalId: linkedProposalId || '',
    timestamp: isoNow(),
  };
}

export function appendMissionConsoleMessage(previous = [], message = null) {
  const ledger = Array.isArray(previous) ? previous : [];
  if (!message || typeof message !== 'object') {
    return ledger;
  }
  return [...ledger, message];
}

export function buildBlockedMissionConsoleResponse({ target = 'openclaw', reason = '', policy = '', actionId = '' } = {}) {
  const details = [
    `Blocked target: ${target}`,
    reason,
    `Policy: ${policy || 'Mission Console Guardrails'}`,
    actionId ? `Rule: ${actionId}` : '',
  ].filter(Boolean);

  return createMissionConsoleMessage({
    role: 'assistant',
    responder: 'OpenClaw',
    target,
    content: details.join(' · '),
    status: 'blocked',
    approvalNeeded: false,
  });
}
