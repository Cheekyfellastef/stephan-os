import { buildGoalDashboardOperatorAttention } from './goalDashboardOperatorAttention.mjs';

export const LIVE_GOAL_DASHBOARD_PORTFOLIO_SCHEMA = 'stephanos.live-goal-dashboard-portfolio-overlay.v1';

const CURRENT = 'CURRENT';
const STALE = 'STALE';
const UNKNOWN = 'UNKNOWN';
const SHA40 = /^[a-f0-9]{40}$/i;
const TERMINAL_GOAL_STATES = new Set(['CLOSED', 'COMPLETE', 'COMPLETED', 'DONE', 'MERGED', 'SUPERSEDED', 'CANCELLED']);
const REQUIRED_EXACT_HEAD_WORKFLOWS = Object.freeze([
  'OpenClaw GitHub Operator',
  'Protected Operator Merge Source Proof',
  'Exact-Head Review Dispatch',
  'PR Clean Guard',
  'Build Stephanos UI',
  'Battle Bridge Publisher Proof',
  'Codex Dispatch Queue Proof',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function freshness(timestamp, nowMs, staleAfterMs) {
  const observedMs = timestampMs(timestamp);
  if (!Number.isFinite(observedMs)) return { truth: UNKNOWN, ageMs: null };
  const ageMs = Math.max(0, nowMs - observedMs);
  return { truth: ageMs > staleAfterMs ? STALE : CURRENT, ageMs };
}

function combineTruth(values) {
  const truths = list(values).map((value) => text(value, UNKNOWN).toUpperCase());
  if (!truths.length || truths.some((truth) => truth === UNKNOWN)) return UNKNOWN;
  if (truths.some((truth) => truth === STALE)) return STALE;
  return truths.every((truth) => truth === CURRENT) ? CURRENT : UNKNOWN;
}

function canonicalIdentity(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^#?\d+$/.test(raw)) return `#${raw.replace(/^#/, '')}`;
  return raw.toLowerCase();
}

function goalIdentity(record = {}) {
  const raw = text(record.relatedIssue || record.issue || record.issueNumber || record.relatedGoal || record.goalId);
  return canonicalIdentity(raw);
}

function recordMatchesIdentity(record = {}, identity = '') {
  const expected = canonicalIdentity(identity);
  if (!expected) return false;
  return [record.relatedGoal, record.relatedIssue, record.issue, record.issueNumber, record.goalId, record.correlationId]
    .some((value) => canonicalIdentity(value) === expected);
}

function latestMatching(records, identity) {
  return list(records)
    .filter((record) => recordMatchesIdentity(record, identity))
    .sort((left, right) => (timestampMs(right.timestampUtc || right.checkedAtUtc || right.publishedAtUtc || right.createdAt) || 0)
      - (timestampMs(left.timestampUtc || left.checkedAtUtc || left.publishedAtUtc || left.createdAt) || 0))[0] || null;
}

function uniqueLatestGoalRecords(records) {
  const seen = new Set();
  const sorted = [...list(records)].sort((left, right) => (timestampMs(right.timestampUtc || right.createdAt) || 0)
    - (timestampMs(left.timestampUtc || left.createdAt) || 0));
  const out = [];
  for (const record of sorted) {
    const identity = goalIdentity(record);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    if (TERMINAL_GOAL_STATES.has(text(record.status).toUpperCase())) continue;
    out.push(record);
  }
  return out;
}

function workspaceGoalCard(record, input, options) {
  const identity = goalIdentity(record) || 'workspace-goal';
  const statusFreshness = freshness(record.timestampUtc || record.checkedAtUtc || record.createdAt, options.nowMs, options.staleAfterMs);
  const proofRecord = latestMatching(input.proofRecords, identity);
  const proofFreshness = proofRecord
    ? freshness(proofRecord.timestampUtc || proofRecord.checkedAtUtc || proofRecord.publishedAtUtc || proofRecord.createdAt, options.nowMs, options.staleAfterMs)
    : { truth: UNKNOWN, ageMs: null };
  const blockers = [];
  if (statusFreshness.truth !== CURRENT) blockers.push(`${statusFreshness.truth}_STATUS_RECORD`);
  if (proofFreshness.truth !== CURRENT) blockers.push(`${proofFreshness.truth}_PROOF_RECORD`);
  return Object.freeze({
    issue: identity,
    title: text(record.title, 'Shared Workspace goal'),
    statusTruth: statusFreshness.truth,
    proofTruth: proofFreshness.truth,
    capabilityTruth: 'not-required',
    summary: text(record.summary, `Status: ${text(record.status, 'open')}`),
    proofRefs: list(proofRecord?.refs || proofRecord?.proofRefs),
    blockers,
    exactNextAction: blockers.length
      ? 'Refresh the goal/proof records from canonical programme evidence before claiming current completion.'
      : text(record.nextAction, 'Continue the current bounded goal through its proof and completion contract.'),
    source: 'shared-workspace-goal-record',
  });
}

function exactPrHead(pr = {}) {
  const head = text(pr.headSha).toLowerCase();
  const headUnknown = list(pr.blockers).some((blocker) => text(blocker).toLowerCase() === 'head_sha_unknown');
  return SHA40.test(head) && !headUnknown ? head : '';
}

function workflowChecksStatus(pr = {}, workflows = []) {
  const head = exactPrHead(pr);
  const prNumber = Number(pr.number || 0) || null;
  if (!head || !prNumber) return 'unknown';
  const exactRuns = list(workflows).filter((run) => (
    Number(run.prNumber || 0) === prNumber
    && text(run.headSha).toLowerCase() === head
    && REQUIRED_EXACT_HEAD_WORKFLOWS.includes(text(run.name))
  ));
  const byName = new Map();
  for (const run of exactRuns) {
    if (!byName.has(run.name)) byName.set(run.name, []);
    byName.get(run.name).push(text(run.status, 'unknown').toLowerCase());
  }
  if (REQUIRED_EXACT_HEAD_WORKFLOWS.some((name) => !byName.has(name))) return 'unknown';
  const statuses = [...byName.values()].flat();
  if (statuses.some((status) => ['failed', 'failure', 'cancelled', 'timed_out', 'action_required'].includes(status))) return 'failed';
  if (statuses.some((status) => ['running', 'queued', 'pending', 'waiting', 'in_progress'].includes(status))) return 'pending';
  if (REQUIRED_EXACT_HEAD_WORKFLOWS.every((name) => byName.get(name).every((status) => status === 'passed' || status === 'success'))) return 'passed';
  return 'unknown';
}

function effectiveChecksStatus(pr = {}, workflows = []) {
  const direct = text(pr.checksStatus, 'unknown').toLowerCase();
  const fromWorkflows = workflowChecksStatus(pr, workflows);
  if (direct === 'failed' || fromWorkflows === 'failed') return 'failed';
  if (direct === 'pending' || fromWorkflows === 'pending') return 'pending';
  if (!exactPrHead(pr)) return 'unknown';
  if (direct === 'passed' || fromWorkflows === 'passed') return 'passed';
  return 'unknown';
}

function prState(pr = {}) {
  const checks = text(pr.checksStatus, 'unknown').toLowerCase();
  if (pr.draft === true) return 'BUILDING';
  if (checks === 'failed') return 'BLOCKED';
  if (checks === 'pending') return 'VERIFYING';
  if (checks === 'passed' && /approval/i.test(text(pr.mergeReadiness))) return 'APPROVAL_REQUIRED';
  if (checks === 'passed') return 'REVIEWED';
  return 'ACTIVE';
}

function prNextAction(pr = {}) {
  const number = pr.number || 'unknown';
  const checks = text(pr.checksStatus, 'unknown').toLowerCase();
  if (checks === 'failed') return `Repair failing exact-head checks on PR #${number}, then rerun review/proof.`;
  if (checks === 'pending') return `Wait for or reconcile the current exact-head checks on PR #${number}.`;
  if (pr.draft === true) return `Continue bounded implementation and review preparation for PR #${number}.`;
  if (!exactPrHead(pr)) return `Refresh exact-head identity for PR #${number}; proof remains unknown until the head is bound.`;
  if (checks === 'passed' && /approval/i.test(text(pr.mergeReadiness))) return `Apply the governing approval envelope to PR #${number}; request Stephan only if fresh consequential approval is required.`;
  if (checks === 'passed') return `Continue PR #${number} through independent review and protected merge readiness.`;
  return `Refresh exact-head GitHub proof for PR #${number}; unknown remains unknown.`;
}

function githubPrCard(pr, githubFreshness, workflows) {
  const checksStatus = effectiveChecksStatus(pr, workflows);
  const normalizedPr = { ...pr, checksStatus };
  const blockers = [];
  if (githubFreshness.truth !== CURRENT) blockers.push(`${githubFreshness.truth}_GITHUB_TELEMETRY`);
  if (!exactPrHead(pr)) blockers.push('GITHUB_HEAD_UNKNOWN');
  if (checksStatus !== 'passed') blockers.push(`GITHUB_CHECKS_${checksStatus.toUpperCase()}`);
  for (const blocker of list(pr.blockers)) {
    const normalized = text(blocker);
    if (checksStatus === 'passed' && normalized === 'checks_not_passed_or_unknown') continue;
    blockers.push(normalized);
  }
  const proofTruth = githubFreshness.truth === STALE
    ? STALE
    : (githubFreshness.truth === CURRENT && exactPrHead(pr) && checksStatus === 'passed' ? CURRENT : UNKNOWN);
  return Object.freeze({
    issue: `PR #${pr.number || 'unknown'}`,
    title: text(pr.title, 'Open pull request'),
    statusTruth: githubFreshness.truth,
    proofTruth,
    capabilityTruth: 'not-required',
    summary: `${prState(normalizedPr)} · checks ${checksStatus} · merge ${text(pr.mergeReadiness, 'unknown')} · approval ${text(pr.approvalStatus, 'unknown')}`,
    proofRefs: [],
    blockers: [...new Set(blockers.filter(Boolean))],
    exactNextAction: prNextAction(normalizedPr),
    source: 'github-live-open-pr',
    prNumber: pr.number || null,
    branch: text(pr.branch, 'unknown'),
    exactHead: exactPrHead(pr) || 'unknown',
    url: text(pr.url, ''),
    state: prState(normalizedPr),
  });
}

export function overlayGoalDashboardWithLivePortfolio(input = {}) {
  const baseProjection = input.baseProjection || {};
  const liveProjection = input.liveProjection || {};
  const githubTelemetry = liveProjection.githubTelemetry || {};
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : 60 * 60 * 1000;
  const githubFreshness = githubTelemetry.adapterAvailable === true
    ? freshness(githubTelemetry.lastUpdatedAt || liveProjection.generatedAt, nowMs, staleAfterMs)
    : { truth: UNKNOWN, ageMs: null };

  const githubCards = githubTelemetry.adapterAvailable === true
    ? list(githubTelemetry.pullRequests)
      .filter((pr) => text(pr.supersededStatus).toLowerCase() !== 'superseded')
      .sort((left, right) => Number(right.number || 0) - Number(left.number || 0))
      .slice(0, 24)
      .map((pr) => githubPrCard(pr, githubFreshness, githubTelemetry.workflows))
    : [];

  const workspaceCards = uniqueLatestGoalRecords(input.goalRecords)
    .slice(0, 24)
    .map((record) => workspaceGoalCard(record, input, { nowMs, staleAfterMs }));

  const livePrNumbers = new Set(githubCards.map((card) => card.prNumber).filter(Boolean));
  const dedupedWorkspaceCards = workspaceCards.filter((card) => {
    const relatedPr = Number(String(card.summary || '').match(/\bPR\s*#?(\d+)\b/i)?.[1] || 0) || null;
    return !relatedPr || !livePrNumbers.has(relatedPr);
  });

  const dynamicPortfolio = githubCards.length > 0 || workspaceCards.length > 0;
  const goals = githubCards.length
    ? [...githubCards, ...dedupedWorkspaceCards].slice(0, 32)
    : (workspaceCards.length ? workspaceCards : list(baseProjection.goals));

  const dynamicSource = githubCards.length
    ? 'LIVE_GITHUB_PLUS_SHARED_WORKSPACE'
    : (workspaceCards.length ? 'LIVE_SHARED_WORKSPACE' : 'BASE_PROJECTION_FALLBACK');

  const workspaceTruth = workspaceCards.length
    ? combineTruth(workspaceCards.flatMap((card) => [card.statusTruth, card.proofTruth]))
    : null;
  const dynamicTruth = githubCards.length
    ? combineTruth([githubFreshness.truth, ...(workspaceTruth ? [workspaceTruth] : [])])
    : (workspaceTruth || text(baseProjection.sourceTruth, UNKNOWN));

  const cardBlockers = [...new Set(goals.flatMap((goal) => list(goal.blockers)).filter(Boolean))];
  const baseAttention = baseProjection.operatorAttention || {};
  const blockers = dynamicPortfolio
    ? cardBlockers
    : [...new Set([...list(baseAttention.blockers), ...cardBlockers])];
  const firstAction = goals.find((goal) => text(goal.exactNextAction))?.exactNextAction || text(baseAttention.exactNextAction, 'Refresh canonical programme evidence.');
  const operatorAttention = buildGoalDashboardOperatorAttention({
    goals,
    blockers,
    explicitDecisions: baseAttention.approvals,
    exactNextAction: blockers.length ? firstAction : (dynamicPortfolio ? firstAction : text(baseAttention.exactNextAction, firstAction)),
  });

  return Object.freeze({
    ...baseProjection,
    schemaVersion: text(baseProjection.schemaVersion, 'stephanos.landing-goal-dashboard-projection.v1'),
    livePortfolioOverlaySchema: LIVE_GOAL_DASHBOARD_PORTFOLIO_SCHEMA,
    portfolioSource: dynamicSource,
    portfolioObservedAt: new Date(nowMs).toISOString(),
    sourceTruth: dynamicTruth,
    goals,
    liveGithubPrCount: githubCards.length,
    liveWorkspaceGoalCount: workspaceCards.length,
    operatorAttention,
    finalVerdict: blockers.length ? 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED' : (dynamicTruth === CURRENT ? 'LANDING_GOAL_DASHBOARD_CURRENT' : 'LANDING_GOAL_DASHBOARD_STALE_OR_UNKNOWN'),
  });
}
