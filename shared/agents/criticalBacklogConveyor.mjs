export const CRITICAL_BACKLOG_CONVEYOR_SCHEMA = 'stephanos.critical-backlog-conveyor.v1';
export const CRITICAL_BACKLOG_CONVEYOR_VERSION = '1.0.0';

export const CRITICAL_BACKLOG_DECISION = Object.freeze({
  CREATE_NEXT_MISSION: 'CREATE_NEXT_MISSION',
  WAIT_ACTIVE_MISSION: 'WAIT_ACTIVE_MISSION',
  WAIT_EXTERNAL_ACTIVE_MISSION: 'WAIT_EXTERNAL_ACTIVE_MISSION',
  BLOCKED_BY_TERMINAL_MISSION: 'BLOCKED_BY_TERMINAL_MISSION',
  BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS: 'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS',
  BLOCKED_BY_INVALID_BACKLOG: 'BLOCKED_BY_INVALID_BACKLOG',
  BACKLOG_COMPLETE: 'BACKLOG_COMPLETE',
});

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const APPROVAL_REF = 'operator-authorized-critical-autonomy-lane-2026-07-17';
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^openclaw\/[a-z0-9][a-z0-9._/-]{2,127}$/;
const SAFE_SOURCE_SEGMENT = /^\.?[a-z0-9][a-z0-9._-]*$/i;
const FORBIDDEN_PATH = /(^|\/)(apps\/stephanos\/dist|runtime|runtime-data|data|tmp|\.git|node_modules)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i;
const TERMINAL_PHASES = new Set(['COMPLETE', 'CANCELLED']);
const HOLD_PHASES = new Set(['BLOCKED', 'AWAITING_OPERATOR_APPROVAL']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}
function list(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
function unique(value) { return [...new Set(list(value))]; }
function isSafeSourceScope(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '..')) return false;
  const wildcardIndex = segments.indexOf('**');
  if (wildcardIndex >= 0 && wildcardIndex !== segments.length - 1) return false;
  if (segments.filter((segment) => segment === '**').length > 1) return false;
  const concrete = wildcardIndex >= 0 ? segments.slice(0, -1) : segments;
  return concrete.length > 0
    && concrete.every((segment) => SAFE_SOURCE_SEGMENT.test(segment))
    && !FORBIDDEN_PATH.test(normalized);
}

function backlogItem({ itemId, priority, issueNumbers, sourcePrNumber = null, mission }) {
  return Object.freeze({
    itemId,
    priority,
    issueNumbers: Object.freeze(issueNumbers),
    sourcePrNumber,
    headlineApprovalRef: APPROVAL_REF,
    mission: Object.freeze({
      missionKind: 'implementation',
      repository: REPOSITORY,
      baseBranch: 'main',
      browserProofRequired: false,
      ...mission,
      allowedFiles: Object.freeze(mission.allowedFiles),
      requiredTests: Object.freeze(mission.requiredTests),
      requiredEvidence: Object.freeze(mission.requiredEvidence),
    }),
  });
}

export const DEFAULT_CRITICAL_BACKLOG = Object.freeze([
  backlogItem({
    itemId: 'worker-watchdog-self-heal', priority: 10, issueNumbers: [1291],
    mission: {
      missionId: 'critical-1291-worker-watchdog-repair',
      title: 'Repair and prove Mission Orchestrator Worker self-heal',
      branch: 'openclaw/critical-1291-worker-watchdog-repair',
      operatorIntent: 'Use the stored watchdog acceptance receipt for req-1291-watchdog-acceptance-20260717T1710Z, identify the exact runtime blocker, repair the bounded watchdog lane, and preserve one fixed hidden Scheduled Task.',
      intendedOutcome: 'A real destructive acceptance proves the worker is killed, the installed watchdog detects the loss, restarts a different canonical-main worker process, and commits Shared Workspace proof without a visible PowerShell wall.',
      allowedFiles: [
        'scripts/battle-bridge-worker-watchdog.mjs',
        'scripts/battle-bridge-worker-watchdog-policy.mjs',
        'scripts/battle-bridge-worker-watchdog-runner.mjs',
        'scripts/battle-bridge-worker-watchdog-acceptance.mjs',
        'scripts/battle-bridge-worker-watchdog.test.mjs',
        'scripts/battle-bridge-worker-watchdog-policy.test.mjs',
        'scripts/battle-bridge-worker-watchdog-runner.test.mjs',
        'scripts/windows/install-battle-bridge-worker-watchdog.ps1',
        'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
        'shared/agents/battleBridgeGitHubCommandMailbox.test.mjs',
      ],
      requiredTests: [
        'node --test scripts/battle-bridge-worker-watchdog-policy.test.mjs scripts/battle-bridge-worker-watchdog.test.mjs scripts/battle-bridge-worker-watchdog-runner.test.mjs',
        'node --test shared/agents/battleBridgeGitHubCommandMailbox.test.mjs',
      ],
      requiredEvidence: ['focused watchdog tests', 'mailbox watchdog command contract tests'],
    },
  }),
  backlogItem({
    itemId: 'post-sync-runtime-refresh', priority: 20, issueNumbers: [1507], sourcePrNumber: 1543,
    mission: {
      missionId: 'critical-1507-post-sync-runtime-refresh',
      title: 'Repair and complete exact-head post-sync runtime refresh',
      branch: 'openclaw/critical-1507-post-sync-runtime-refresh',
      operatorIntent: 'Salvage the approved design from PR #1543 onto current main without creating a second updater. Repair conflicts, preserve fail-closed OpenClaw approval boundaries, and complete the exact-head refresh coordinator.',
      intendedOutcome: 'A source fast-forward is followed by only the required UI, backend, worker or periodic refreshes, exact served/runtime head proof, resumable checkpoints, and final SYNC_NO_CHANGE convergence.',
      allowedFiles: ['scripts/**', 'shared/agents/stephanosCapabilityRegistry.mjs', 'shared/agents/stephanosCapabilityRegistry.test.mjs', '.github/workflows/**', 'package.json'],
      requiredTests: [
        'node --test scripts/battle-bridge-github-sync-and-refresh.test.mjs scripts/battle-bridge-post-sync-refresh.test.mjs',
        'node --test shared/agents/stephanosCapabilityRegistry.test.mjs',
      ],
      requiredEvidence: ['sync and refresh coordinator tests', 'capability registry tests'],
    },
  }),
  backlogItem({
    itemId: 'automated-dispatch-conveyor', priority: 30, issueNumbers: [1292, 1293],
    mission: {
      missionId: 'critical-1292-1293-dispatch-conveyor',
      title: 'Complete queue-to-agent-to-PR dispatch conveyor',
      branch: 'openclaw/critical-1292-1293-dispatch-conveyor',
      operatorIntent: 'Close the remaining #1292/#1293 gaps using the existing queue, mission orchestrator, worker and GitHub-mediated integration. Preserve exactly one active implementation job and convert buildable missing integrations into active work.',
      intendedOutcome: 'A queued bounded goal is selected, dispatched without manual prompt moving, tracked through result, PR, checks, repairs and exact-head merge approval, with durable Shared Workspace state and no duplicate active job.',
      allowedFiles: [
        'shared/agents/codexDispatchQueue.mjs', 'shared/agents/codexDispatchQueue.test.mjs',
        'shared/agents/automatedCodexDispatcher.mjs', 'shared/agents/automatedCodexDispatcher.test.mjs',
        'shared/agents/platformLoopIntegration.mjs', 'shared/agents/platformLoopIntegration.test.mjs',
        'shared/agents/missionOrchestrator.mjs', 'shared/agents/missionOrchestrator.test.mjs',
        'shared/agents/missionOrchestratorWorker.mjs', 'shared/agents/missionOrchestratorWorker.test.mjs',
        'stephanos-server/services/missionOrchestratorWorkerService.js', 'stephanos-server/services/missionOrchestratorWorkerService.test.js',
        'stephanos-server/services/missionOrchestratorWorkerConsumer.js', 'stephanos-server/services/missionOrchestratorWorkerConsumer.test.js',
        'scripts/mission-orchestrator-worker.mjs', 'scripts/mission-orchestrator-worker.test.mjs',
      ],
      requiredTests: [
        'node --test shared/agents/codexDispatchQueue.test.mjs shared/agents/automatedCodexDispatcher.test.mjs shared/agents/platformLoopIntegration.test.mjs',
        'node --test shared/agents/missionOrchestrator.test.mjs shared/agents/missionOrchestratorWorker.test.mjs',
        'node --test stephanos-server/services/missionOrchestratorWorkerService.test.js stephanos-server/services/missionOrchestratorWorkerConsumer.test.js scripts/mission-orchestrator-worker.test.mjs',
      ],
      requiredEvidence: ['dispatch queue and dispatcher tests', 'mission orchestrator tests', 'worker integration tests'],
    },
  }),
  backlogItem({
    itemId: 'universal-chat-bootstrap', priority: 40, issueNumbers: [1418],
    mission: {
      missionId: 'critical-1418-universal-chat-bootstrap',
      title: 'Complete universal project-chat bootstrap and no-orphan behavior',
      branch: 'openclaw/critical-1418-universal-chat-bootstrap',
      operatorIntent: 'Build the smallest canonical bootstrap that makes every Stephanos/OpenClaw project chat discover capabilities, current Shared Workspace state, exact main head, standing approvals and the one active execution lane before denying capability or creating work.',
      intendedOutcome: 'New chats resume current programme truth, avoid duplicate goals, jobs and PRs, and continue from the newest durable receipt rather than chat-local memory.',
      allowedFiles: ['shared/agents/**', 'scripts/**'],
      requiredTests: ['node --test shared/agents/stephanosCapabilityRegistry.test.mjs'],
      requiredEvidence: ['universal bootstrap contract tests'],
    },
  }),
  backlogItem({
    itemId: 'programme-completion-controller', priority: 50, issueNumbers: [1284, 1286],
    mission: {
      missionId: 'critical-1284-1286-completion-controller',
      title: 'Complete autonomous programme completion controller',
      branch: 'openclaw/critical-1284-1286-completion-controller',
      operatorIntent: 'Build the canonical controller that distinguishes complete, proof-pending, buildable blocker, external blocker and approval gate; automatically advances buildable work; and interrupts the operator only for genuine judgment or authority.',
      intendedOutcome: 'Goals keep advancing through source, proof, repair, merge and runtime acceptance until complete, while the Goal Dashboard reflects authoritative Shared Workspace state and no manual courier work is required.',
      allowedFiles: ['shared/agents/**', 'stephanos-server/services/**', 'scripts/**', 'stephanos-ui/src/**', '.github/workflows/**', 'package.json'],
      requiredTests: ['node --test shared/agents/platformLoopIntegration.test.mjs shared/agents/missionOrchestrator.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
      requiredEvidence: ['completion controller source tests', 'Stephanos UI build and dist verification'],
    },
  }),
]);

export function validateCriticalBacklog(backlog = DEFAULT_CRITICAL_BACKLOG) {
  const errors = [];
  const itemIds = new Set();
  const missionIds = new Set();
  const priorities = new Set();
  if (!Array.isArray(backlog) || backlog.length === 0) errors.push('backlog-missing');
  for (const entry of Array.isArray(backlog) ? backlog : []) {
    const itemId = text(entry?.itemId);
    const mission = entry?.mission || {};
    if (!SAFE_ID.test(itemId)) errors.push('invalid-item-id');
    if (itemIds.has(itemId)) errors.push(`duplicate-item-id:${itemId}`);
    itemIds.add(itemId);
    if (!Number.isInteger(entry?.priority) || entry.priority <= 0) errors.push(`invalid-priority:${itemId || 'unknown'}`);
    if (priorities.has(entry?.priority)) errors.push(`duplicate-priority:${entry?.priority}`);
    priorities.add(entry?.priority);
    if (!Array.isArray(entry?.issueNumbers) || entry.issueNumbers.length === 0) errors.push(`missing-issues:${itemId || 'unknown'}`);
    if (!text(entry?.headlineApprovalRef)) errors.push(`missing-headline-approval:${itemId || 'unknown'}`);
    if (!SAFE_ID.test(text(mission.missionId))) errors.push(`invalid-mission-id:${itemId || 'unknown'}`);
    if (missionIds.has(mission.missionId)) errors.push(`duplicate-mission-id:${mission.missionId}`);
    missionIds.add(mission.missionId);
    if (!SAFE_REPOSITORY.test(text(mission.repository))) errors.push(`invalid-repository:${mission.missionId || 'unknown'}`);
    if (!SAFE_BRANCH.test(text(mission.branch))) errors.push(`invalid-branch:${mission.missionId || 'unknown'}`);
    if (!['implementation', 'live-runtime-investigation', 'github-operation'].includes(text(mission.missionKind))) errors.push(`invalid-mission-kind:${mission.missionId || 'unknown'}`);
    if (!text(mission.operatorIntent) || !text(mission.intendedOutcome) || !text(mission.title)) errors.push(`missing-mission-text:${mission.missionId || 'unknown'}`);
    if (mission.missionKind === 'implementation' && (!Array.isArray(mission.allowedFiles) || mission.allowedFiles.length === 0)) errors.push(`missing-allowed-files:${mission.missionId || 'unknown'}`);
    for (const sourceScope of mission.allowedFiles || []) if (!isSafeSourceScope(sourceScope)) errors.push(`unsafe-allowed-file:${mission.missionId || 'unknown'}`);
    if (mission.missionKind === 'implementation' && (!Array.isArray(mission.requiredTests) || mission.requiredTests.length === 0)) errors.push(`missing-required-tests:${mission.missionId || 'unknown'}`);
    if (!Array.isArray(mission.requiredEvidence) || mission.requiredEvidence.length === 0) errors.push(`missing-required-evidence:${mission.missionId || 'unknown'}`);
  }
  const uniqueErrors = [...new Set(errors)];
  return Object.freeze({
    valid: uniqueErrors.length === 0,
    errors: Object.freeze(uniqueErrors),
    itemCount: Array.isArray(backlog) ? backlog.length : 0,
    finalVerdict: uniqueErrors.length ? 'CRITICAL_BACKLOG_BLOCKED' : 'CRITICAL_BACKLOG_PASS',
  });
}

function missionPhase(record = {}) { return text(record.currentPhase, 'UNKNOWN').toUpperCase(); }
function entryForMission(backlog, missionId) { return backlog.find((entry) => entry.mission.missionId === missionId) || null; }
function projectionBase(validation, additions = {}) {
  return Object.freeze({
    schemaVersion: CRITICAL_BACKLOG_CONVEYOR_SCHEMA,
    version: CRITICAL_BACKLOG_CONVEYOR_VERSION,
    validation,
    oneActiveMissionEnforced: true,
    duplicateCodexDispatchAllowed: false,
    mergeAuthority: false,
    exactHeadApprovalRequired: true,
    ...additions,
  });
}

export function buildCriticalBacklogProjection({ backlog = DEFAULT_CRITICAL_BACKLOG, missionRecords = [] } = {}) {
  const validation = validateCriticalBacklog(backlog);
  if (!validation.valid) return projectionBase(validation, {
    decision: CRITICAL_BACKLOG_DECISION.BLOCKED_BY_INVALID_BACKLOG,
    selectedItem: null, activeMission: null, completedItemIds: Object.freeze([]), remainingItemIds: Object.freeze([]),
    exactNextAction: 'Repair the source-controlled critical backlog definition.',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_BLOCKED',
  });

  const ordered = [...backlog].sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId));
  const records = Array.isArray(missionRecords) ? missionRecords : [];
  const recordsById = new Map(records.map((record) => [text(record?.missionId).toLowerCase(), record]));
  const active = records.filter((record) => !TERMINAL_PHASES.has(missionPhase(record)));
  const completedItemIds = ordered.filter((entry) => missionPhase(recordsById.get(entry.mission.missionId)) === 'COMPLETE').map((entry) => entry.itemId);
  const remainingItemIds = ordered.filter((entry) => !completedItemIds.includes(entry.itemId)).map((entry) => entry.itemId);
  const common = { completedItemIds: Object.freeze(completedItemIds), remainingItemIds: Object.freeze(remainingItemIds) };

  if (active.length > 1) return projectionBase(validation, {
    ...common,
    decision: CRITICAL_BACKLOG_DECISION.BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS,
    selectedItem: null, activeMission: null,
    activeMissionIds: Object.freeze(active.map((record) => text(record.missionId)).sort()),
    exactNextAction: 'Reconcile the duplicate active mission lanes before dispatching more work.',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_BLOCKED',
  });

  if (active.length === 1) {
    const activeMission = active[0];
    const selectedItem = entryForMission(ordered, text(activeMission.missionId).toLowerCase());
    const held = HOLD_PHASES.has(missionPhase(activeMission));
    return projectionBase(validation, {
      ...common,
      decision: selectedItem ? CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION : CRITICAL_BACKLOG_DECISION.WAIT_EXTERNAL_ACTIVE_MISSION,
      selectedItem, activeMission,
      exactNextAction: held
        ? `Resolve ${missionPhase(activeMission)} for ${text(activeMission.missionId)} before starting another mission.`
        : `Continue ${text(activeMission.missionId)} until it reaches a terminal state.`,
      finalVerdict: held ? 'CRITICAL_BACKLOG_CONVEYOR_HELD' : 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    });
  }

  for (const entry of ordered) {
    const record = recordsById.get(entry.mission.missionId);
    if (!record) return projectionBase(validation, {
      ...common,
      decision: CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION,
      selectedItem: entry, activeMission: null,
      exactNextAction: `Create bounded mission ${entry.mission.missionId}.`,
      finalVerdict: 'CRITICAL_BACKLOG_MISSION_READY',
    });
    if (missionPhase(record) === 'COMPLETE') continue;
    return projectionBase(validation, {
      ...common,
      decision: CRITICAL_BACKLOG_DECISION.BLOCKED_BY_TERMINAL_MISSION,
      selectedItem: entry, activeMission: record,
      exactNextAction: `Re-authorize or replace cancelled critical mission ${entry.mission.missionId}; do not skip it silently.`,
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_BLOCKED',
    });
  }

  return projectionBase(validation, {
    decision: CRITICAL_BACKLOG_DECISION.BACKLOG_COMPLETE,
    selectedItem: null, activeMission: null,
    completedItemIds: Object.freeze(completedItemIds), remainingItemIds: Object.freeze([]),
    exactNextAction: 'No critical backlog mission remains.',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_COMPLETE',
  });
}

export function buildCriticalBacklogMissionInput(entry, { repositoryRoot = '', worktreePath = '' } = {}) {
  const validation = validateCriticalBacklog([entry]);
  if (!validation.valid) return Object.freeze({ ok: false, validation, mission: null });
  const mission = entry.mission;
  return Object.freeze({
    ok: true,
    validation,
    mission: Object.freeze({
      missionId: mission.missionId,
      title: mission.title,
      operatorIntent: mission.operatorIntent,
      intendedOutcome: mission.intendedOutcome,
      missionKind: mission.missionKind,
      repository: mission.repository,
      repositoryRoot: text(repositoryRoot),
      baseBranch: mission.baseBranch,
      branch: mission.branch,
      worktreePath: text(worktreePath),
      allowedFiles: mission.allowedFiles,
      requiredTests: mission.requiredTests,
      requiredEvidence: mission.requiredEvidence,
      browserProofRequired: mission.browserProofRequired,
    }),
  });
}
