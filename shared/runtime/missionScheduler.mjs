const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIVE_STATES = new Set(['ACTIVE', 'IMPLEMENTING', 'CI_REVIEW', 'PROOF_RUNNING']);
const TERMINAL_STATES = new Set(['COMPLETE', 'CLOSED', 'SUPERSEDED', 'DUPLICATE']);
const ROUTES = new Set([
  'CHATGPT_GITHUB',
  'OPENCLAW_LOCAL',
  'BATTLE_BRIDGE_FIXED_TEST',
  'REMOTE_CODEX',
  'OPERATOR_APPROVAL',
  'WAITING_FOR_EXTERNAL_CONDITION',
  'BLOCKED_UNSAFE_OR_UNKNOWN',
]);

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) value[key] = freeze(entry);
    return Object.freeze(value);
  }
  return value;
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function issueNumber(value) {
  const raw = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

function sha(value) {
  return typeof value === 'string' && SHA_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeGoal(goal = {}) {
  const number = issueNumber(goal.issue ?? goal.issueNumber);
  const prerequisites = Array.isArray(goal.prerequisites)
    ? [...new Set(goal.prerequisites.map(issueNumber).filter(Boolean))]
    : [];
  const state = text(goal.state, 'UNKNOWN').toUpperCase();
  const route = ROUTES.has(goal.route) ? goal.route : 'BLOCKED_UNSAFE_OR_UNKNOWN';
  return freeze({
    issue: number,
    title: text(goal.title, number ? `Goal #${number}` : 'Unknown goal'),
    state,
    prerequisites,
    priority: positiveNumber(goal.priority),
    criticalPathWeight: positiveNumber(goal.criticalPathWeight),
    reversibility: text(goal.reversibility, 'UNKNOWN').toUpperCase(),
    route,
    activePr: issueNumber(goal.activePr),
    branch: text(goal.branch) || null,
    headSha: sha(goal.headSha),
    proofState: text(goal.proofState, 'UNKNOWN').toUpperCase(),
    approvalRequired: goal.approvalRequired === true,
    operatorPriority: goal.operatorPriority === true,
    duplicateOf: issueNumber(goal.duplicateOf),
    supersededBy: issueNumber(goal.supersededBy),
    evidenceAt: text(goal.evidenceAt) || null,
  });
}

function detectCycles(goalsByIssue) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(issue, path = []) {
    if (visiting.has(issue)) {
      const start = path.indexOf(issue);
      cycles.push([...path.slice(start), issue]);
      return;
    }
    if (visited.has(issue)) return;
    visiting.add(issue);
    const goal = goalsByIssue.get(issue);
    for (const dependency of goal?.prerequisites ?? []) {
      if (goalsByIssue.has(dependency)) visit(dependency, [...path, issue]);
    }
    visiting.delete(issue);
    visited.add(issue);
  }

  for (const issue of goalsByIssue.keys()) visit(issue);
  return cycles;
}

function classify(goal, goalsByIssue, activeIssues, stale) {
  if (!goal.issue) return 'BLOCKED';
  if (goal.duplicateOf) return 'DUPLICATE';
  if (goal.supersededBy) return 'SUPERSEDED';
  if (TERMINAL_STATES.has(goal.state)) return goal.state === 'COMPLETE' ? 'CLOSE_READY' : goal.state;
  if (stale) return 'STALLED';
  if (activeIssues.has(goal.issue)) return 'ACTIVE';
  if (goal.approvalRequired) return 'APPROVAL_REQUIRED';
  const missing = goal.prerequisites.filter((issue) => !goalsByIssue.has(issue));
  if (missing.length) return 'BLOCKED';
  const incomplete = goal.prerequisites.filter((issue) => !TERMINAL_STATES.has(goalsByIssue.get(issue).state));
  if (incomplete.length) return 'WAITING_FOR_DEPENDENCY';
  if (goal.state === 'IMPLEMENTED' && goal.proofState !== 'PASS') return 'IMPLEMENTED_NEEDS_PROOF';
  if (goal.proofState === 'PASS' && goal.activePr) return 'MERGE_READY';
  if (goal.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') return 'BLOCKED';
  return 'READY';
}

function score(goal) {
  return (goal.operatorPriority ? 1_000_000 : 0)
    + goal.priority * 10_000
    + goal.criticalPathWeight * 100
    + (goal.reversibility === 'HIGH' ? 20 : goal.reversibility === 'MEDIUM' ? 10 : 0)
    + (goal.route === 'CHATGPT_GITHUB' ? 5 : 0);
}

export function buildMissionScheduler(input = {}) {
  const nowMs = Number.isFinite(Date.parse(input.now)) ? Date.parse(input.now) : Date.now();
  const freshnessMs = Number.isFinite(Number(input.freshnessMs)) ? Number(input.freshnessMs) : 15 * 60 * 1000;
  const goals = (Array.isArray(input.goals) ? input.goals : []).map(normalizeGoal);
  const goalsByIssue = new Map(goals.filter((goal) => goal.issue).map((goal) => [goal.issue, goal]));
  const cycles = detectCycles(goalsByIssue);
  const activeGoals = goals.filter((goal) => ACTIVE_STATES.has(goal.state));
  const activeIssues = new Set(activeGoals.map((goal) => goal.issue));
  const contradictions = [];
  if (activeGoals.length > 1) contradictions.push({ code: 'MULTIPLE_ACTIVE_LANES', issues: [...activeIssues] });
  for (const cycle of cycles) contradictions.push({ code: 'DEPENDENCY_CYCLE', issues: cycle });

  const portfolio = goals.map((goal) => {
    const evidenceMs = goal.evidenceAt ? Date.parse(goal.evidenceAt) : NaN;
    const stale = !Number.isFinite(evidenceMs) || nowMs - evidenceMs > freshnessMs || evidenceMs - nowMs > 60_000;
    return freeze({ ...goal, lifecycle: classify(goal, goalsByIssue, activeIssues, stale), evidenceFreshness: stale ? 'STALE' : 'FRESH' });
  });

  const ready = portfolio
    .filter((goal) => goal.lifecycle === 'READY')
    .sort((a, b) => score(b) - score(a) || a.issue - b.issue);

  const failClosed = contradictions.length > 0;
  const selected = failClosed || activeGoals.length === 1 ? null : ready[0] ?? null;
  const active = activeGoals.length === 1 ? portfolio.find((goal) => goal.issue === activeGoals[0].issue) : null;
  const operatorNeeded = Boolean(active?.approvalRequired || selected?.route === 'OPERATOR_APPROVAL');

  return freeze({
    schemaVersion: 'stephanos.mission-scheduler.v1',
    readOnly: true,
    failClosed,
    contradictions,
    programmeStatus: failClosed ? 'BLOCKED' : active ? 'IN_PROGRESS' : selected ? 'READY_TO_ADVANCE' : 'WAITING',
    activeGoal: active?.issue ? `#${active.issue}` : null,
    activeLane: active?.activePr ? `PR #${active.activePr}` : active?.branch ?? null,
    whyNow: active ? 'Existing active lane remains authoritative.' : selected ? `Highest eligible score ${score(selected)} after dependency, priority, critical-path and route checks.` : 'No eligible lane is currently available.',
    selectedGoal: selected?.issue ? `#${selected.issue}` : null,
    selectedRoute: selected?.route ?? null,
    nextEligible: ready.slice(selected ? 1 : 0, selected ? 4 : 3).map((goal) => `#${goal.issue}`),
    operatorNeeded,
    operatorAction: operatorNeeded ? 'OPERATOR_APPROVAL_REQUIRED' : 'NO_OPERATOR_ACTION_REQUIRED',
    portfolio,
    decisionReceipt: freeze({
      correlationId: text(input.correlationId, `scheduler-${nowMs}`),
      decidedAt: new Date(nowMs).toISOString(),
      selectedIssue: selected?.issue ?? null,
      activeIssue: active?.issue ?? null,
      route: selected?.route ?? active?.route ?? 'WAITING_FOR_EXTERNAL_CONDITION',
      proofRefs: Array.isArray(input.proofRefs) ? input.proofRefs.map(String) : [],
    }),
  });
}

export function answerMissionQuery(input = {}, query = '') {
  const scheduler = buildMissionScheduler(input);
  const normalized = text(query).toLowerCase();
  const base = {
    programmeStatus: scheduler.programmeStatus,
    activeGoal: scheduler.activeGoal,
    activeLane: scheduler.activeLane,
    whyNow: scheduler.whyNow,
    blockers: scheduler.contradictions,
    nextEligible: scheduler.nextEligible,
    operatorNeeded: scheduler.operatorNeeded,
    operatorAction: scheduler.operatorAction,
    evidenceFreshness: scheduler.portfolio.some((goal) => goal.evidenceFreshness === 'STALE') ? 'MIXED_OR_STALE' : 'FRESH',
    proofRefs: scheduler.decisionReceipt.proofRefs,
  };
  if (normalized.includes('blocked')) return freeze({ ...base, focus: 'BLOCKERS' });
  if (normalized.includes('next')) return freeze({ ...base, focus: 'NEXT_ELIGIBLE' });
  if (normalized.includes('need anything') || normalized.includes('operator')) return freeze({ ...base, focus: 'OPERATOR_ACTION' });
  return freeze({ ...base, focus: 'PROGRAMME_STATUS' });
}
