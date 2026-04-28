export const PROJECT_PROGRESS_SCHEMA_VERSION = 1;

export const PROJECT_READINESS_STATUSES = Object.freeze([
  'complete',
  'ready',
  'mostly-ready',
  'partial',
  'started',
  'blocked',
  'not-started',
  'unknown',
]);

export const PROJECT_READINESS_LABELS = Object.freeze({
  complete: 'complete',
  ready: 'ready',
  'mostly-ready': 'mostly ready',
  partial: 'partial',
  started: 'started',
  blocked: 'blocked',
  'not-started': 'not started',
  unknown: 'unknown',
});

const STATUS_SCORES = Object.freeze({
  complete: 100,
  ready: 90,
  'mostly-ready': 75,
  partial: 58,
  started: 42,
  blocked: 18,
  'not-started': 8,
  unknown: 15,
});

function normalizeString(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeStatus(value) {
  const next = normalizeString(value, 'unknown');
  return PROJECT_READINESS_STATUSES.includes(next) ? next : 'unknown';
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeWeight(value) {
  return Math.max(1, Math.min(10, Math.round(normalizeNumber(value, 1))));
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isNaN(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function createSeedLane({
  id,
  title,
  status,
  confidence,
  weight,
  why,
  evidence = [],
  blockers = [],
  lastMilestone = '',
  dependsOn = [],
}) {
  return {
    id,
    title,
    status,
    confidence,
    weight,
    why,
    evidence,
    blockers,
    lastMilestone,
    dependsOn,
  };
}

const SEEDED_LANES = Object.freeze([
  createSeedLane({ id: 'core-runtime-truth', title: 'Core Runtime Truth', status: 'mostly-ready', confidence: 0.84, weight: 10, why: 'Canonical runtime adjudicator, laws, and truth projections are active.', evidence: ['shared/runtime/runtimeAdjudicator.mjs', 'shared/runtime/stephanosLaws.mjs'], lastMilestone: 'Runtime truth gates in active use.', dependsOn: [] }),
  createSeedLane({ id: 'route-backend-health', title: 'Route / Backend Health', status: 'started', confidence: 0.75, weight: 9, why: 'Route truth and backend posture checks are present but still subject to hosted/local drift risks.', evidence: ['shared/runtime/runtimeStatusModel.mjs', 'shared/runtime/runtimeAdjudicator.mjs'], lastMilestone: 'Route and provider posture surfaced in Mission Console.' }),
  createSeedLane({ id: 'hosted-bridge-tailscale-serve', title: 'Hosted Bridge / Tailscale Serve', status: 'partial', confidence: 0.66, weight: 7, why: 'Hosted bridge planning path exists with recovery patterns, but execution posture remains conditional.', evidence: ['shared/runtime/hostedIdeaStaging.mjs', 'stephanos-ui/src/state/missionDashboardModel.js'], blockers: ['Needs stronger execution truth for non-local routes.'], lastMilestone: 'Hosted repair milestones tracked.' }),
  createSeedLane({ id: 'mission-console-ui', title: 'Mission Console UI', status: 'mostly-ready', confidence: 0.82, weight: 8, why: 'Mission Console has robust panels and runtime projection, now extended with project progress projection.', evidence: ['stephanos-ui/src/components/MissionConsoleTile.jsx', 'stephanos-ui/src/components/MissionDashboardPanel.jsx'], lastMilestone: 'Mission dashboard integrated into panel surface.' }),
  createSeedLane({ id: 'telemetry', title: 'Telemetry', status: 'started', confidence: 0.72, weight: 7, why: 'Telemetry and support snapshot features exist but are not yet tightly coupled to task completion verification.', evidence: ['stephanos-ui/src/state/supportSnapshot.js'], lastMilestone: 'Telemetry feed and support snapshots operational.' }),
  createSeedLane({ id: 'prompt-builder', title: 'Prompt Builder', status: 'started', confidence: 0.73, weight: 6, why: 'Prompt builder exists and compiles mission context, but readiness loop is still maturing.', evidence: ['stephanos-ui/src/components/system/promptBuilder.js'], lastMilestone: 'Prompt builder integrated with Mission Console.' }),
  createSeedLane({ id: 'memory-retrieval', title: 'Memory / Retrieval', status: 'started', confidence: 0.76, weight: 8, why: 'Durable and session memory layers are active and intentionally separated.', evidence: ['shared/runtime/stephanosMemory.mjs', 'shared/runtime/stephanosSessionMemory.mjs'], lastMilestone: 'Durable mission dashboard hydration implemented.' }),
  createSeedLane({ id: 'intent-proposal-engine', title: 'Intent / Proposal Engine', status: 'partial', confidence: 0.64, weight: 7, why: 'Intent-to-build and proposal surfaces are active but not yet first-class task packets.', evidence: ['stephanos-ui/src/state/intentToBuildModel.js', 'stephanos-ui/src/state/aiActionContext.js'], lastMilestone: 'Intent missions and context adapters available.' }),
  createSeedLane({ id: 'agent-task-layer', title: 'Agent Task Layer', status: 'partial', confidence: 0.73, weight: 10, why: 'Agent task lifecycle truth exists; dashboard lane should be overwritten by live readiness summary when available.', evidence: ['shared/agents/agentTaskProjection.mjs', 'shared/agents/agentTaskAdjudicator.mjs'], blockers: ['Treat this seed as fallback only when shared readiness summary is unavailable.'], lastMilestone: 'Agent task readiness summary exported for dashboard/tile surfaces.' }),
  createSeedLane({ id: 'codex-handoff', title: 'Codex Handoff', status: 'partial', confidence: 0.7, weight: 9, why: 'Manual Codex handoff packet mode exists and should be projected from Agent Task readiness summary.', evidence: ['shared/agents/codexHandoffPacket.mjs', 'shared/agents/agentTaskProjection.mjs'], blockers: ['Fallback lane only; consume shared readiness summary for current packet truth.'], lastMilestone: 'Codex manual handoff packet export integrated.' , dependsOn: ['agent-task-layer']}),
  createSeedLane({ id: 'openclaw-control', title: 'OpenClaw Control', status: 'blocked', confidence: 0.69, weight: 9, why: 'OpenClaw policy harness/kill-switch/adapter truth exists; execution remains blocked until safety conditions pass.', evidence: ['shared/agents/openClawPolicyHarness.mjs', 'shared/agents/openClawKillSwitch.mjs', 'shared/agents/openClawLocalAdapter.mjs'], blockers: ['Policy/adapter readiness can differ by context; do not infer execution from seed text.'], lastMilestone: 'OpenClaw guardrail summaries exported to task projection.', dependsOn: ['agent-task-layer'] }),
  createSeedLane({ id: 'verification-loop', title: 'Verification Loop', status: 'partial', confidence: 0.8, weight: 10, why: 'Verification Return State exists and should be consumed via Agent Task readiness summary, with build/verify scripts as supporting evidence.', evidence: ['shared/agents/agentVerificationReturn.mjs', 'scripts/build-stephanos-ui.mjs', 'scripts/verify-stephanos-dist.mjs'], blockers: ['Fallback lane only; keep return-state decisions sourced from shared projection.'], lastMilestone: 'Verification return status/decision exported for mission surfaces.', dependsOn: ['agent-task-layer'] }),
  createSeedLane({ id: 'deployment-github-pages', title: 'Deployment / GitHub Pages', status: 'started', confidence: 0.74, weight: 8, why: 'Dist build and verification routines exist with deployment scripts, though ongoing route truth checks remain important.', evidence: ['package.json', 'scripts/verify-stephanos-dist.mjs'], lastMilestone: 'Predeploy build/verify pipeline active.' }),
  createSeedLane({ id: 'vr-spatial-surface', title: 'VR / Spatial Surface', status: 'not-started', confidence: 0.45, weight: 3, why: 'Surface protocols mention cockpit modes but no complete spatial dashboard implementation is present.', evidence: ['stephanos-ui/src/system/surface/surfaceAwareness.js'], blockers: ['Needs explicit spatial UI execution path + controls.'], lastMilestone: 'Surface protocol hooks available.' }),
]);

export function getProjectStatusScore(status = 'unknown') {
  return STATUS_SCORES[status] ?? STATUS_SCORES.unknown;
}

export function getProjectStatusLabel(status = 'unknown') {
  return PROJECT_READINESS_LABELS[status] || PROJECT_READINESS_LABELS.unknown;
}

export function normalizeProjectProgressLane(value = {}, index = 0) {
  const title = normalizeString(value.title, `Lane ${index + 1}`);
  const id = normalizeString(value.id, title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || `lane-${index + 1}`;
  return {
    id,
    title,
    status: normalizeStatus(value.status),
    confidence: Math.max(0, Math.min(1, normalizeNumber(value.confidence, 0.5))),
    weight: normalizeWeight(value.weight),
    why: normalizeString(value.why),
    evidence: normalizeList(value.evidence),
    blockers: normalizeList(value.blockers),
    dependsOn: normalizeList(value.dependsOn),
    lastMilestone: normalizeString(value.lastMilestone),
  };
}

export function createSeedProjectProgressModel() {
  return {
    schemaVersion: PROJECT_PROGRESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    lanes: SEEDED_LANES.map((lane, index) => normalizeProjectProgressLane(lane, index)),
  };
}

export function normalizeProjectProgressModel(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const seed = createSeedProjectProgressModel();
  const lanesSource = Array.isArray(source.lanes) && source.lanes.length > 0 ? source.lanes : seed.lanes;
  return {
    schemaVersion: PROJECT_PROGRESS_SCHEMA_VERSION,
    generatedAt: normalizeTimestamp(source.generatedAt || seed.generatedAt),
    lanes: lanesSource.map((lane, index) => normalizeProjectProgressLane(lane, index)),
  };
}
