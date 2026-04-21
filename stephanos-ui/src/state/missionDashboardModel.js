const MISSION_SCHEMA_VERSION = 1;
const STATUS_VALUES = Object.freeze(['not-started', 'planned', 'in-progress', 'blocked', 'review', 'complete']);
const STATUS_PRIORITY = Object.freeze({
  blocked: 0,
  'in-progress': 1,
  review: 2,
  planned: 3,
  'not-started': 4,
  complete: 5,
});

const DEFAULT_SUMMARY = Object.freeze({
  projectHealth: 'hosted-repair-in-progress',
  completionEstimate: 48,
  missionNote: 'Manual milestone editing remains available; live projection sections reflect canonical runtime/agent truth when present.',
});

const DEFAULT_MILESTONES = Object.freeze([
  createSeedMilestone('agent-layer-v1-foundation', 'Agent Layer v1 Foundation', 'Canonical adjudicator, runtime mission model, and shared task truth are active baselines.', 'agent-layer', 'in-progress', 78, false),
  createSeedMilestone('agent-layer-v2-surface-elevation', 'Agent Layer v2 Surface Elevation', 'Agent surface projections and operator-facing fleet visibility are being elevated across panels.', 'agent-layer', 'in-progress', 63, false),
  createSeedMilestone('agent-layer-v3-persistent-orchestration', 'Agent Layer v3 Persistent Orchestration', 'Continuity-safe orchestration state and resumable handoff flow across sessions/surfaces.', 'agent-layer', 'planned', 36, true),
  createSeedMilestone('mission-console-hosted-repair', 'Mission Console Hosted Repair', 'Hosted/caravan mode remains useful for planning/orchestration when Battle Bridge execution is unavailable.', 'hosted-mode', 'in-progress', 61, false),
  createSeedMilestone('launcher-agents-entry', 'Launcher Agents Entry', 'Launcher → agents/mission entry and posture handoff remain explicit and truthful.', 'launcher', 'planned', 44, false),
  createSeedMilestone('intent-engine-operator-interface', 'Intent Engine Operator Interface', 'Dedicated mission intent capture/decomposition/review interface for operators, including approval state.', 'operator-interface', 'in-progress', 63, false),
  createSeedMilestone('route-recovery-bridge-validation', 'Bridge Validation + Route Recovery', 'Remembered bridge validation/backoff/promotion truth is visible and operator-actionable on hosted surfaces.', 'route-recovery', 'in-progress', 59, false),
  createSeedMilestone('provider-routing-hosted-safety', 'Provider Routing Hosted Safety', 'Provider-routing truth should keep hosted research safe and explicit when cloud/local routes change.', 'provider-routing', 'in-progress', 57, false),
  createSeedMilestone('continuity-resume-handoff', 'Continuity Resume Handoff', 'Resumable mission packets and handoff exports stay durable and surface-aware.', 'continuity', 'in-progress', 54, false),
  createSeedMilestone('build-verify-truth-gates', 'Build / Verify Truth Gates', 'Build/verify/served/source markers remain mandatory before route trust claims.', 'truth-gates', 'in-progress', 67, false),
]);

function createSeedMilestone(id, title, description, category, status, percentComplete, blockerFlag) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    description,
    category,
    status,
    percentComplete,
    blockerFlag,
    blockerDetails: blockerFlag ? 'Operator review needed. Manual blocker details pending.' : '',
    dependencies: [],
    notes: 'Manual baseline; update with concrete progress evidence.',
    nextAction: 'Review and update status based on latest verified runtime truth.',
    linkedSystems: [],
    updatedAt: now,
    sortOrder: 0,
  };
}

function normalizeString(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))].slice(0, 12);
}

function normalizeStatus(value) {
  const next = normalizeString(value, 'not-started');
  return STATUS_VALUES.includes(next) ? next : 'not-started';
}

function normalizePercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeTimestamp(value) {
  const candidate = normalizeString(value);
  if (!candidate) return new Date().toISOString();
  return Number.isNaN(Date.parse(candidate)) ? new Date().toISOString() : candidate;
}

function normalizeMilestoneId(value, index) {
  const base = normalizeString(value).toLowerCase();
  const sanitized = base.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || `milestone-${index + 1}`;
}

export function getMissionStatusLabel(status) {
  return status.replace(/-/g, ' ');
}

export function createDefaultMissionDashboardState() {
  const seededMilestones = DEFAULT_MILESTONES.map((milestone, index) => normalizeMissionMilestone(milestone, index));
  return {
    schemaVersion: MISSION_SCHEMA_VERSION,
    overallSummary: {
      ...DEFAULT_SUMMARY,
      lastUpdatedAt: new Date().toISOString(),
    },
    milestones: seededMilestones.map((milestone, index) => ({ ...milestone, sortOrder: index + 1 })),
  };
}

export function normalizeMissionMilestone(value = {}, index = 0) {
  const status = normalizeStatus(value.status);
  const percentComplete = normalizePercent(value.percentComplete);
  const blockerFlag = value.blockerFlag === true || status === 'blocked';
  return {
    id: normalizeMilestoneId(value.id || value.title, index),
    title: normalizeString(value.title, `Milestone ${index + 1}`),
    description: normalizeString(value.description),
    category: normalizeString(value.category, 'general'),
    status,
    percentComplete,
    blockerFlag,
    blockerDetails: normalizeString(value.blockerDetails),
    dependencies: normalizeList(value.dependencies),
    notes: normalizeString(value.notes),
    nextAction: normalizeString(value.nextAction),
    linkedSystems: normalizeList(value.linkedSystems || value.linkedFiles),
    updatedAt: normalizeTimestamp(value.updatedAt),
    sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : index + 1,
  };
}

export function normalizeMissionDashboardState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const milestonesSource = Array.isArray(source.milestones) ? source.milestones : [];
  const milestones = (milestonesSource.length > 0 ? milestonesSource : createDefaultMissionDashboardState().milestones)
    .map((milestone, index) => normalizeMissionMilestone(milestone, index));

  const deduped = [];
  const seen = new Set();
  milestones.forEach((milestone) => {
    if (seen.has(milestone.id)) {
      return;
    }
    seen.add(milestone.id);
    deduped.push(milestone);
  });

  const overallSummary = source.overallSummary && typeof source.overallSummary === 'object' ? source.overallSummary : {};
  return {
    schemaVersion: MISSION_SCHEMA_VERSION,
    overallSummary: {
      projectHealth: normalizeString(overallSummary.projectHealth, DEFAULT_SUMMARY.projectHealth),
      completionEstimate: normalizePercent(overallSummary.completionEstimate),
      missionNote: normalizeString(overallSummary.missionNote, DEFAULT_SUMMARY.missionNote),
      lastUpdatedAt: normalizeTimestamp(overallSummary.lastUpdatedAt),
    },
    milestones: deduped,
  };
}

export function sortMilestonesForOperations(milestones = []) {
  return [...milestones].sort((a, b) => {
    const statusDelta = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    const blockerDelta = Number(b.blockerFlag) - Number(a.blockerFlag);
    if (blockerDelta !== 0) return blockerDelta;
    const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDelta !== 0) return orderDelta;
    return a.title.localeCompare(b.title);
  });
}

export function buildMissionSummaryMetrics(state) {
  const normalized = normalizeMissionDashboardState(state);
  const countsByStatus = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0]));
  normalized.milestones.forEach((milestone) => {
    countsByStatus[milestone.status] += 1;
  });

  const blockedMilestones = normalized.milestones.filter((milestone) => milestone.blockerFlag || milestone.status === 'blocked');
  const totalProgress = normalized.milestones.reduce((sum, milestone) => sum + milestone.percentComplete, 0);
  const completionEstimate = normalized.milestones.length > 0
    ? Math.round(totalProgress / normalized.milestones.length)
    : normalized.overallSummary.completionEstimate;

  return {
    totalMilestones: normalized.milestones.length,
    countsByStatus,
    blockedCount: blockedMilestones.length,
    inProgressCount: countsByStatus['in-progress'],
    completeCount: countsByStatus.complete,
    overallProgress: completionEstimate,
    lastUpdatedAt: normalized.overallSummary.lastUpdatedAt,
  };
}

export function buildMissionHandoffText(state) {
  const normalized = normalizeMissionDashboardState(state);
  const metrics = buildMissionSummaryMetrics(normalized);
  const orderedMilestones = sortMilestonesForOperations(normalized.milestones);
  const generatedAt = new Date().toISOString();

  const lines = [
    'Stephanos Mission Handoff',
    `Generated: ${generatedAt}`,
    `Project Health: ${normalized.overallSummary.projectHealth || 'unknown'}`,
    `Overall Completion: ${metrics.overallProgress}%`,
    `Active Blockers: ${metrics.blockedCount}`,
    '',
    'Summary Metrics',
    `- Total milestones: ${metrics.totalMilestones}`,
    `- Not started: ${metrics.countsByStatus['not-started']}`,
    `- Planned: ${metrics.countsByStatus.planned}`,
    `- In progress: ${metrics.countsByStatus['in-progress']}`,
    `- Blocked: ${metrics.countsByStatus.blocked}`,
    `- Review: ${metrics.countsByStatus.review}`,
    `- Complete: ${metrics.countsByStatus.complete}`,
    '',
    'Milestones',
  ];

  orderedMilestones.forEach((milestone) => {
    lines.push(`- ${milestone.title}`);
    lines.push(`  status: ${milestone.status}`);
    lines.push(`  percent complete: ${milestone.percentComplete}%`);
    lines.push(`  blocker: ${milestone.blockerFlag ? `yes${milestone.blockerDetails ? ` - ${milestone.blockerDetails}` : ''}` : 'no'}`);
    lines.push(`  next action: ${milestone.nextAction || 'unset'}`);
    lines.push(`  notes: ${milestone.notes || 'none'}`);
    lines.push(`  updated: ${milestone.updatedAt}`);
  });

  const activeBlockers = orderedMilestones.filter((milestone) => milestone.blockerFlag || milestone.status === 'blocked');
  if (activeBlockers.length > 0) {
    lines.push('', 'Active Blockers Summary');
    activeBlockers.forEach((milestone) => {
      lines.push(`- ${milestone.title}: ${milestone.blockerDetails || 'blocker flagged, details pending'}`);
    });
  }

  const dependencyLines = orderedMilestones
    .filter((milestone) => milestone.dependencies.length > 0)
    .map((milestone) => `- ${milestone.title}: ${milestone.dependencies.join(', ')}`);
  if (dependencyLines.length > 0) {
    lines.push('', 'Dependencies Summary', ...dependencyLines);
  }

  if (normalized.overallSummary.missionNote) {
    lines.push('', 'Mission Note', normalized.overallSummary.missionNote);
  }

  const linkedSystemLines = orderedMilestones
    .filter((milestone) => milestone.linkedSystems.length > 0)
    .map((milestone) => `- ${milestone.title}: ${milestone.linkedSystems.join(', ')}`);
  if (linkedSystemLines.length > 0) {
    lines.push('', 'Linked Systems', ...linkedSystemLines);
  }

  return lines.join('\n');
}

export { MISSION_SCHEMA_VERSION, STATUS_VALUES };
