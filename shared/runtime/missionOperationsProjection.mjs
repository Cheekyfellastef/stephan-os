const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED', 'CANCELLED']);
const ACTIVE_STATES = new Set(['QUEUED', 'RUNNING', 'VERIFYING', 'AWAITING_APPROVAL', 'BLOCKED']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function iso(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function githubUrl(value) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'github.com'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function normalizeState(value) {
  const state = text(value, 'QUEUED').toUpperCase().replace(/[\s-]+/g, '_');
  return ACTIVE_STATES.has(state) || TERMINAL_STATES.has(state) ? state : 'BLOCKED';
}

function normalizeCheck(check = {}) {
  const status = text(check.status || check.state, 'unknown').toLowerCase();
  return {
    id: text(check.id || check.name, 'unknown-check'),
    name: text(check.name || check.id, 'Unknown check'),
    status,
    required: check.required !== false,
    url: githubUrl(check.url),
    startedAt: iso(check.startedAt),
    completedAt: iso(check.completedAt),
  };
}

function normalizeReceipt(receipt = {}) {
  return {
    receiptId: text(receipt.receiptId || receipt.authorizationId || receipt.id, 'unknown-receipt'),
    receiptType: text(receipt.receiptType || receipt.schemaVersion || receipt.type, 'unknown'),
    source: text(receipt.source, 'unknown'),
    status: text(receipt.status || receipt.finalVerdict, 'unknown'),
    sha256: text(receipt.sha256 || receipt.claimsSha256 || receipt.commandOutputHash),
    path: text(receipt.path || receipt.receiptPath),
    createdAt: iso(receipt.createdAt || receipt.consumedAt || receipt.completedAt || receipt.reservedAt),
  };
}

function normalizeApproval(approval = {}) {
  return {
    approvalId: text(approval.approvalId || approval.id, 'unknown-approval'),
    kind: text(approval.kind || approval.type, 'operator'),
    status: text(approval.status, 'pending').toLowerCase(),
    requiredToken: text(approval.requiredToken),
    requestedAt: iso(approval.requestedAt),
    decidedAt: iso(approval.decidedAt),
    decisionBy: text(approval.decisionBy),
  };
}

function deriveOverallState({ declaredState, blockers, approvals, checks, finalVerdict }) {
  if (blockers.length) return 'BLOCKED';
  if (approvals.some((approval) => approval.status === 'pending')) return 'AWAITING_APPROVAL';
  if (checks.some((check) => check.required && ['queued', 'pending', 'in_progress', 'requested', 'unknown'].includes(check.status))) {
    return 'VERIFYING';
  }
  if (checks.some((check) => check.required && !['success', 'skipped', 'neutral'].includes(check.status))) return 'BLOCKED';
  if (/pass|complete|merged|done|success/i.test(finalVerdict)) return 'COMPLETE';
  return normalizeState(declaredState);
}

export function buildMissionOperationsProjection(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const mission = input.mission || {};
  const github = input.github || {};
  const checks = list(github.checks || input.checks).map(normalizeCheck);
  const blockers = [...new Set(list(input.blockers || mission.blockers).map((item) => text(item)).filter(Boolean))];
  const approvals = list(input.approvals || mission.approvals).map(normalizeApproval);
  const receipts = list(input.receipts || mission.receipts).map(normalizeReceipt);
  const startedAt = iso(mission.startedAt || input.startedAt);
  const updatedAt = iso(input.updatedAt || mission.updatedAt);
  const staleAfterMinutes = Number.isFinite(options.staleAfterMinutes) ? options.staleAfterMinutes : 10;
  const updatedMs = Date.parse(updatedAt);
  const stale = Number.isFinite(updatedMs) && now.getTime() - updatedMs > staleAfterMinutes * 60 * 1000;
  const finalVerdict = text(input.finalVerdict || mission.finalVerdict);
  const state = deriveOverallState({
    declaredState: input.state || mission.state,
    blockers,
    approvals,
    checks,
    finalVerdict,
  });
  const activeAgent = input.activeAgent || mission.activeAgent || {};
  const supportingAgents = list(input.supportingAgents || mission.supportingAgents).map((agent) => ({
    agentId: text(agent.agentId || agent.id, 'unknown-agent'),
    label: text(agent.label || agent.name || agent.agentId, 'Unknown agent'),
    role: text(agent.role, 'support'),
    status: text(agent.status, 'unknown'),
  }));

  const warnings = [];
  if (!updatedAt) warnings.push('No trustworthy updated timestamp is available.');
  if (stale && !TERMINAL_STATES.has(state)) warnings.push(`Mission state is stale by more than ${staleAfterMinutes} minutes.`);
  if (!checks.length && ['VERIFYING', 'AWAITING_APPROVAL'].includes(state)) warnings.push('No check receipts are available for the current state.');
  if (receipts.some((receipt) => !receipt.sha256 && !receipt.path)) warnings.push('One or more evidence receipts lack a deterministic hash or path.');

  return {
    schemaVersion: 'stephanos.mission-operations-projection.v1',
    generatedAt: now.toISOString(),
    mission: {
      missionId: text(mission.missionId || input.missionId, 'mission-unresolved'),
      title: text(mission.title || input.title, 'Untitled mission'),
      intendedOutcome: text(mission.intendedOutcome || input.intendedOutcome),
      state,
      finalVerdict,
      startedAt,
      updatedAt,
      elapsedSeconds: startedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(startedAt)) / 1000)) : null,
      currentPhase: text(mission.currentPhase || input.currentPhase, 'unknown'),
      nextAction: text(mission.nextAction || input.nextAction, blockers.length ? 'Resolve blockers.' : 'Await next deterministic receipt.'),
    },
    agent: {
      activeAgentId: text(activeAgent.agentId || activeAgent.id, 'none'),
      activeAgentLabel: text(activeAgent.label || activeAgent.name || activeAgent.agentId, 'None'),
      role: text(activeAgent.role, 'none'),
      status: text(activeAgent.status, 'idle'),
      supportingAgents,
      simultaneousWritersAllowed: false,
    },
    git: {
      repository: text(github.repository),
      branch: text(github.branch),
      baseBranch: text(github.baseBranch, 'main'),
      headSha: text(github.headSha),
      worktreePath: text(github.worktreePath),
      changedFiles: list(github.changedFiles).map(text),
      clean: github.clean === true,
    },
    pullRequest: {
      number: Number.isInteger(github.prNumber) ? github.prNumber : null,
      url: githubUrl(github.prUrl),
      state: text(github.prState, 'none'),
      mergeable: github.mergeable === true,
      merged: github.merged === true || text(github.prState).toLowerCase() === 'merged' || Boolean(text(github.mergeCommitSha)),
      mergeCommitSha: text(github.mergeCommitSha),
      checks,
      requiredCheckCount: checks.filter((check) => check.required).length,
      passingCheckCount: checks.filter((check) => check.required && check.status === 'success').length,
    },
    blockers,
    approvals,
    receipts,
    warnings,
    stale,
    operatorActionRequired: state === 'AWAITING_APPROVAL' || blockers.length > 0,
    finalVerdict: state,
  };
}
