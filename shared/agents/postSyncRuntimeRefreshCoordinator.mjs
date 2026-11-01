import {
  POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
  POST_SYNC_SOVEREIGN_RELAY_PROOF_SCHEMA,
  projectPostSyncSovereignRelayObservation,
  projectPostSyncSovereignRelayProof,
} from '../../scripts/battle-bridge-github-sync-policy.mjs';
export {
  POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
  POST_SYNC_SOVEREIGN_RELAY_PROOF_SCHEMA,
  projectPostSyncSovereignRelayObservation,
  projectPostSyncSovereignRelayProof,
};

export const POST_SYNC_REFRESH_SCHEMA = 'stephanos.post-sync-runtime-refresh.v1';

export const POST_SYNC_REFRESH_CLASSIFICATIONS = Object.freeze({
  NO_RUNTIME_REFRESH_REQUIRED: 'NO_RUNTIME_REFRESH_REQUIRED',
  REFRESH_READY: 'REFRESH_READY',
  REFRESH_COMPLETE: 'REFRESH_COMPLETE',
  APPROVAL_REQUIRED_OPENCLAW: 'APPROVAL_REQUIRED_OPENCLAW',
  BLOCKED_UNSAFE_CHANGED_PATH: 'BLOCKED_UNSAFE_CHANGED_PATH',
  BLOCKED_UNCLASSIFIED_RUNTIME_PATH: 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH',
  BLOCKED_REFRESH_FAILED: 'BLOCKED_REFRESH_FAILED',
});

export const POST_SYNC_REFRESH_TARGETS = Object.freeze({
  NATURAL_RELOAD: 'natural-reload',
  UI_4173: 'stephanos-ui-4173',
  BACKEND_8787: 'stephanos-backend-8787',
  MISSION_WORKER: 'mission-orchestrator-worker',
  VR_ATLAS_BROWSER_PROOF: 'vr-capability-atlas-browser-proof',
  GITHUB_MAILBOX: 'github-command-mailbox',
  SOVEREIGN_COMMANDER: 'sovereign-commander',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._@+()\-][A-Za-z0-9._@+()\-/ ]{0,500}$/;
const CANONICAL_WORKER_WATCHDOG_PROBE_PATH = 'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1';
const REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH = 'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs';
const MISSION_WORKER_POST_SYNC_COORDINATOR_PATH = 'scripts/battle-bridge-post-sync-refresh.mjs';
const GOAL_DISCOVERY_HEARTBEAT_RUNTIME_PATH = 'scripts/battle-bridge-goal-discovery-heartbeat.mjs';
const REQUIRED_LOCAL_LAUNCHER_PATH = 'windows/Launch-Stephanos-Local.ps1';
const TARGET_ORDER = Object.freeze([
  POST_SYNC_REFRESH_TARGETS.UI_4173,
  POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF,
  POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
  POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
  POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
  POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
]);

const SOVEREIGN_COMMANDER_PLUGIN_MANIFESTS = new Set([
  'plugins/sovereign-commander/plugin.json',
  'plugins/sovereign-commander/.codex-plugin/plugin.json',
]);

// The Commander watchdog owns this long-running relay and its static imports.
// A healthy HTTP daemon alone cannot prove that this separate process reloaded.
const SOVEREIGN_RELAY_RUNTIME_EXACT = new Set([
  'scripts/battle-bridge-sovereign-relay-daemon.mjs',
  'scripts/control-tower-build-consumer-v1.mjs',
  'scripts/sovereign-commander-native-inspect.mjs',
]);

const SOVEREIGN_COMMANDER_RUNTIME_EXACT = new Set([
  ...SOVEREIGN_RELAY_RUNTIME_EXACT,
  'scripts/windows/status-stephanos-core-daemon.ps1',
  'scripts/stephanos-core-daemon.mjs',
  'shared/agents/stephanosCoreDaemonV1.mjs',
  'shared/agents/sovereignCommanderV1.mjs',
  'shared/agents/sovereignCommanderCapabilityParityV1.mjs',
  'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
  'scripts/battle-bridge-observation.mjs',
  'scripts/sovereign-commander-http.mjs',
  'scripts/sovereign-maintenance-custody-store-v1.mjs',
  'scripts/sovereign-maintenance-owner-observation-v2.mjs',
  'scripts/sovereign-fixed-runtime-parent-v1.mjs',
  'scripts/sovereign-commander-ignition-autoheal.mjs',
  'scripts/sovereign-commander-mcp.mjs',
  'scripts/sovereign-controller-lane-status.mjs',
  'scripts/sovereign-commander-visibility-snapshot.mjs',
  'scripts/sovereign-commander-fleet-goal-supervisor.mjs',
  'scripts/sovereign-commander-goal-builder-repair.mjs',
  'scripts/sovereign-commander-ignition-diagnosis.mjs',
  'scripts/sovereign-commander-persistent-runtime-repair.mjs',
  'scripts/sovereign-commander-ui-4173-repair.mjs',
  'scripts/sovereign-commander-ui-runtime-proof.mjs',
  'scripts/windows/configure-sovereign-commander-tailscale.ps1',
  'scripts/windows/repair-openclaw-full-stack.ps1',
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
  'plugins/sovereign-commander/plugin.json',
  'plugins/sovereign-commander/.codex-plugin/plugin.json',
]);

const NATURAL_EXACT = new Set([
  'scripts/canonical-mailbox-execution-ledger-v1.mjs',
  'scripts/canonical-mailbox-rotation-transaction-v2.mjs',
  'scripts/canonical-mailbox-rotation-host-v1.mjs',
  'scripts/canonical-mailbox-rotation-sync-preflight-v1.mjs',
  'scripts/canonical-mailbox-action-evidence-v2.mjs',
  'shared/agents/canonicalMailboxRotationV1.mjs',
  'shared/agents/canonicalMailboxRotationFenceV1.mjs',
  'shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',
  'scripts/stephanos-codex-dispatch-host-operation-v1.mjs',
  'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
  'shared/agents/stephanosCapabilityRegistry.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  'shared/agents/windowsAuthorityMobileRecoveryExecutorReviewV1.mjs',
  'shared/agents/windowsAuthorityOpenClawRecoveryReviewV1.mjs',
  'shared/agents/windowsAuthorityRecoveryMeshGuardianReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewLegacyV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1Base.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1LegacyRouter.mjs',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
  'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
  'scripts/battle-bridge-github-command-mailbox.mjs',
  REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH,
  'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
  'scripts/battle-bridge-github-sync-executor.mjs',
  'scripts/battle-bridge-github-sync-and-refresh.mjs',
  'scripts/stephanos-codex-dispatch-mcp.mjs',
  'scripts/battle-bridge-post-sync-refresh.mjs',
  'scripts/battle-bridge-shared-workspace-publisher.mjs',
  'scripts/battle-bridge-outbound-health-beacon-core.mjs',
  'scripts/battle-bridge-outbound-health-beacon.mjs',
  'scripts/sovereign-commander-stephanos-repair.mjs',
  'scripts/chatgpt-shared-workspace-github-relay.mjs',
  'scripts/chatgpt-shared-workspace-github-relay-core.mjs',
  'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  'scripts/windows/run-battle-bridge-github-sync-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-sync.ps1',
  'scripts/windows/status-battle-bridge-github-sync.ps1',
  'scripts/windows/uninstall-battle-bridge-github-sync.ps1',
  'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1',
  'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1',
  'scripts/windows/install-desktop-commander-watchdog.ps1',
  'scripts/windows/run-desktop-commander-watchdog-hidden.ps1',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/run-vr-virtual-airlink-acceptance.ps1',
  REQUIRED_LOCAL_LAUNCHER_PATH,
  'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
  'scripts/windows/install-forge-shadow-podman-v1.ps1',
]);

const NATURAL_PREFIXES = Object.freeze([
  'scripts/battle-bridge-github-command-mailbox.',
  'scripts/battle-bridge-github-sync-',
  'scripts/chatgpt-shared-workspace-github-relay.',
]);

const OPENCLAW_APPROVAL_EXEMPT_EXACT = new Set([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'scripts/windows/repair-openclaw-full-stack.ps1',
]);

const NO_RUNTIME_PREFIXES = Object.freeze([
  '.agents/',
  '.codex/',
  '.github/',
  'docs/',
  'tests/',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/',
  'VR-Research-Lab/docs/',
]);

const NO_RUNTIME_EXACT = new Set([
  // Manual offline source-package construction; no runtime root imports it.
  'scripts/sovereign-fixed-runtime-install-source-package-v1.mjs',
  'scripts/sovereign-fixed-runtime-install-current-v1.mjs',
  // Seed Forge worker is an on-demand child loaded afresh by the existing
  // bounded supervisor for each exact approved task. Source adoption does not
  // require restarting a long-running runtime.
  'scripts/seed-canopy-parallel-builder.mjs',
  // Exact installer construction/native sources are consumed only by the
  // attended Ignition installer. Source adoption must not start/restart a
  // long-running service; the later exact-head installation/boot gate owns them.
  'scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs',
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1',
  'scripts/fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs',
  'scripts/fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v1.mjs',
  'scripts/canonical-mailbox-rollover-github-adapter.mjs',
  'scripts/canonical-mailbox-workflow-admission-v1.mjs',
  'scripts/canonical-mailbox-workflow-event-gate.mjs',
  'scripts/dispatch-protected-merge-from-mailbox.mjs',
  'scripts/operator-protected-merge-gate-v2.mjs',
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'README.md',
  'scripts/publish-battle-bridge-main-advance-signal.mjs',
  'scripts/exact-head-review-dispatch.mjs',
  'scripts/exact-head-review-current-main-admission-v1.mjs',
  'scripts/bind-independent-review-handoff-provenance-v1.mjs',
  'scripts/retry-independent-review.mjs',
  'scripts/launch-missing-independent-review-v1.mjs',
  'scripts/recover-successful-independent-review-v1.mjs',
  'scripts/battle-bridge-mobile-recovery-attestation-v1.mjs',
  'shared/agents/battleBridgeMainAdvanceSignalV1.mjs',
  'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',
  'shared/agents/codexBankedResetTelemetryMirror.mjs',
  'scripts/operator-protected-personal-repository-merge.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
  // The existing guarded ignition invocation loads these sources afresh.
  // Classifying source adoption does not request another ignition or start AI.
  'scripts/ignite-stephanos-local.mjs',
  'scripts/ignition-cockpit-model.mjs',
  'scripts/run-battle-bridge-ignition.mjs',
  'scripts/battle-bridge-ignition-sync-preflight.mjs',
  'scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1',
]);

const LAUNCHER_CRITICAL_SOURCE_PATHS = new Set([
  'main.js',
  'modules/command-deck/command-deck.js',
  'system/module_loader.js',
  'system/workspace.js',
]);

const UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS = new Set([
  'scripts/build-stephanos-ui.mjs',
  'scripts/browser-proof-runner.mjs',
  'scripts/sovereign-commander-ui-runtime-proof.mjs',
  'scripts/clean-stephanos-dist.mjs',
  'scripts/stephanos-build-utils.mjs',
  'scripts/verify-stephanos-dist.mjs',
  'scripts/serve-stephanos-dist.mjs',
  'scripts/refresh-stephanos-ui-4173.mjs',
  'scripts/battle-bridge-ui-4173-repair.mjs',
  'scripts/sovereign-commander-ui-4173-repair.mjs',
  'scripts/battle-bridge-ignition-supervisor.mjs',
  'scripts/launcher-readiness-live-facts.mjs',
  'scripts/launcher-readiness-planner.mjs',
]);

function normalizePath(value) {
  const path = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:\//.test(path)) return '';
  if (path.split('/').some((part) => part === '..' || part === '')) return '';
  if (!SAFE_RELATIVE_PATH.test(path)) return '';
  return path;
}

export function parseGitChangedPathStatus(stdout) {
  const paths = [];
  for (const line of String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts.shift() || '';
    if (!/^[ACDMRT][0-9]*$/.test(status)) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    const expectedPathCount = /^[CR]/.test(status) ? 2 : 1;
    if (parts.length !== expectedPathCount || parts.some((entry) => !String(entry ?? '').trim())) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    const removesCanonicalProbe = status === 'D'
      ? parts[0] === CANONICAL_WORKER_WATCHDOG_PROBE_PATH
      : /^R[0-9]*$/.test(status) && parts[0] === CANONICAL_WORKER_WATCHDOG_PROBE_PATH;
    if (removesCanonicalProbe) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CANONICAL_WORKER_WATCHDOG_PROBE_REMOVED', paths: Object.freeze([]) });
    }
    const removesRequiredMailboxWrapper = status === 'D'
      ? parts[0] === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH
      : /^R[0-9]*$/.test(status) && parts[0] === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH;
    if (removesRequiredMailboxWrapper) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_REQUIRED_MAILBOX_WRAPPER_REMOVED', paths: Object.freeze([]) });
    }
    const removesRequiredLocalLauncher = status === 'D'
      ? parts[0] === REQUIRED_LOCAL_LAUNCHER_PATH
      : /^R[0-9]*$/.test(status) && parts[0] === REQUIRED_LOCAL_LAUNCHER_PATH;
    if (removesRequiredLocalLauncher) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_REQUIRED_LOCAL_LAUNCHER_REMOVED', paths: Object.freeze([]) });
    }
    paths.push(...parts);
  }
  return Object.freeze({ ok: true, paths: Object.freeze([...new Set(paths)]) });
}

function isTestOrDocumentation(path) {
  return NO_RUNTIME_EXACT.has(path)
    || NO_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
    || /(?:^|\/)[^/]+\.(?:test|spec)\.(?:c?js|mjs|jsx|ts|tsx)$/i.test(path)
    || /\.(?:md|mdx)$/i.test(path);
}

function isOpenClawPath(path) {
  if (NATURAL_EXACT.has(path) || OPENCLAW_APPROVAL_EXEMPT_EXACT.has(path)) return false;
  if (path.startsWith('stephanos-server/')) return false;
  return path.startsWith('integrations/openclaw/')
    || path.startsWith('openclaw/')
    || /(?:^|\/)[^/]*openclaw[^/]*\.(?:mjs|js|ps1|vbs|json)$/i.test(path)
    || path === 'scripts/windows/run-stephanos-scheduled-task-windowless.vbs';
}

function isUiPath(path) {
  return LAUNCHER_CRITICAL_SOURCE_PATHS.has(path)
    || UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS.has(path)
    || path.startsWith('stephanos-ui/')
    || path.startsWith('system/apps/')
    || (path.startsWith('apps/') && !path.startsWith('apps/stephanos/dist/'))
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || path.startsWith('apps/stephanos/dist/')
    || [
      'apps/stephanos/app.json',
      'apps/index.json',
      'system/apps/app_validator.js',
      'stephanos-ui/package.json',
      'stephanos-ui/package-lock.json',
    ].includes(path)
    || path === 'package.json'
    || path === 'package-lock.json';
}

function isVrAtlasProofPath(path) {
  return path.startsWith('apps/vr-capability-atlas/');
}

function isBackendPath(path) {
  if (NATURAL_EXACT.has(path)) return false;
  return path.startsWith('stephanos-server/')
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || [
      'scripts/windows/start-stephanos-backend.ps1',
      'scripts/windows/install-stephanos-backend-autostart.ps1',
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isMissionWorkerPath(path) {
  if (path === MISSION_WORKER_POST_SYNC_COORDINATOR_PATH || path === GOAL_DISCOVERY_HEARTBEAT_RUNTIME_PATH) return true;
  if (NATURAL_EXACT.has(path)) return false;
  return (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || path.startsWith('scripts/mission-orchestrator-worker')
    || path.startsWith('scripts/battle-bridge-worker-watchdog')
    || [
      'scripts/windows/start-mission-orchestrator-worker.ps1',
      'scripts/windows/install-mission-orchestrator-worker-autostart.ps1',
      CANONICAL_WORKER_WATCHDOG_PROBE_PATH,
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isSovereignCommanderRuntimePath(path) {
  return SOVEREIGN_COMMANDER_RUNTIME_EXACT.has(path);
}

function isMailboxRuntimePath(path) {
  return path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs'
    || path === 'scripts/battle-bridge-github-command-mailbox.mjs'
    || path === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH
    || path === 'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'
    || path === 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1'
    || path === 'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1'
    || path.startsWith('shared/agents/battleBridgeGitHubCommandMailbox');
}

function isNaturalReloadPath(path) {
  return NATURAL_EXACT.has(path)
    || NATURAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function classifyPostSyncRefresh(changedPaths = [], { sovereignRelayRefreshRequired = false } = {}) {
  const safePaths = [];
  const unsafePaths = [];
  for (const rawPath of Array.isArray(changedPaths) ? changedPaths : []) {
    const normalized = normalizePath(rawPath);
    if (normalized) safePaths.push(normalized);
    else unsafePaths.push(String(rawPath ?? ''));
  }

  const targets = new Set();
  const noRuntimePaths = [];
  const unknownPaths = [];
  const openClawPaths = [];

  for (const path of [...new Set(safePaths)]) {
    if (isTestOrDocumentation(path)) {
      noRuntimePaths.push(path);
      continue;
    }
    let classified = false;
    if (isOpenClawPath(path)) {
      openClawPaths.push(path);
      classified = true;
    }
    if (isUiPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.UI_4173);
      classified = true;
    }
    if (isVrAtlasProofPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF);
      classified = true;
    }
    if (isBackendPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.BACKEND_8787);
      classified = true;
    }
    if (isMissionWorkerPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.MISSION_WORKER);
      classified = true;
    }
    if (isMailboxRuntimePath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX);
      classified = true;
    }
    if (isSovereignCommanderRuntimePath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
      classified = true;
    }
    if (isNaturalReloadPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD);
      classified = true;
    }
    if (!classified) unknownPaths.push(path);
  }

  const relayRequired = sovereignRelayRefreshRequired === true
    || safePaths.some((path) => SOVEREIGN_RELAY_RUNTIME_EXACT.has(path));
  // A later revert can remove a path from the net diff without proving that an
  // earlier partially refreshed relay stopped using it. Preserve its debt.
  if (relayRequired) targets.add(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
  const targetIds = TARGET_ORDER.filter((target) => targets.has(target));
  let classification = POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED;
  if (unsafePaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNSAFE_CHANGED_PATH;
  else if (unknownPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH;
  else if (openClawPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW;
  else if (targetIds.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY;

  return Object.freeze({
    schemaVersion: POST_SYNC_REFRESH_SCHEMA,
    classification,
    targetIds: Object.freeze(targetIds),
    changedPathCount: safePaths.length + unsafePaths.length,
    safePathCount: safePaths.length,
    noRuntimePathCount: noRuntimePaths.length,
    openClawPathCount: openClawPaths.length,
    unknownPathCount: unknownPaths.length,
    unsafePathCount: unsafePaths.length,
    openClawApprovalRequired: openClawPaths.length > 0,
    // Restarting Commander HTTP proves neither the Codex nor ChatGPT desktop
    // plugin host has loaded the new manifest/skills. Keep this a separate
    // physical acceptance requirement when either manifest changed.
    pluginHostActivationRequired: safePaths.some((path) => SOVEREIGN_COMMANDER_PLUGIN_MANIFESTS.has(path)),
    sovereignRelayRefreshRequired: relayRequired,
    automaticExecutionAllowed: unsafePaths.length === 0 && unknownPaths.length === 0,
    internal: Object.freeze({
      safePaths: Object.freeze([...new Set(safePaths)]),
      noRuntimePaths: Object.freeze(noRuntimePaths),
      openClawPaths: Object.freeze(openClawPaths),
      unknownPaths: Object.freeze(unknownPaths),
      unsafePaths: Object.freeze(unsafePaths),
    }),
  });
}

function validHead(value) {
  return SHA_PATTERN.test(String(value ?? ''));
}

function resultPass(result, expectedHead) {
  return result?.ok === true
    && result?.exactHeadProofOk === true
    && String(result?.sourceHead || '').toLowerCase() === String(expectedHead).toLowerCase();
}

export function postSyncRefreshTargetResultPass(result, { targetId, plan, expectedHead } = {}) {
  if (!resultPass(result, expectedHead)) return false;
  if (targetId !== POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER || plan?.sovereignRelayRefreshRequired !== true) return true;
  return (result.blocker === undefined || result.blocker === '')
    && projectPostSyncSovereignRelayProof(result.sovereignRelayProof, expectedHead) !== null;
}

export const POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA = 'stephanos.post-sync-target-failure-history.v1';
const TARGET_FAILURE_KINDS = new Set(['RESULT_UNPROVEN', 'INVOCATION_FAILED', 'HANDLER_MISSING']);
// Diagnostic vocabulary, never an execution/admission authority. Unknown child
// strings become a fixed code rather than entering durable/public history.
const TARGET_FAILURE_CODES = new Set([
  'REFRESH_TARGET_PROOF_FAILED', 'REFRESH_TARGET_INVOCATION_FAILED', 'REFRESH_TARGET_HANDLER_MISSING',
  'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN', 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN', 'SOVEREIGN_MAINTENANCE_OWNER_BUSY',
  'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN', 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING',
  'SOVEREIGN_COMMANDER_TOKEN_MISSING', 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING',
  'SOVEREIGN_COMMANDER_STALE_CONTRACT_RECYCLE_FAILED', 'SOVEREIGN_COMMANDER_START_FAILED',
  'SOVEREIGN_COMMANDER_NOT_HEALTHY', 'SOVEREIGN_COMMANDER_REFRESH_RECEIPT_INVALID',
  'SOVEREIGN_COMMANDER_REFRESH_PROOF_INVALID', 'SOVEREIGN_COMMANDER_EXACT_HEAD_PROOF_FAILED',
  'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN',
  'GITHUB_MAILBOX_RESTART_FAILED', 'GITHUB_MAILBOX_RESTART_PROOF_INVALID', 'GITHUB_MAILBOX_EXACT_HEAD_PROOF_FAILED',
  'APPROVED_RUNTIME_RESTART_RESPONSE_INVALID', 'APPROVED_RUNTIME_RESTART_PROCESS_TIMEOUT',
  'UI_4173_EXACT_HEAD_PROOF_FAILED', 'VR_ATLAS_BROWSER_PROOF_RESPONSE_INVALID', 'VR_ATLAS_BROWSER_PROOF_BLOCKED',
  'NATURAL_RELOAD_HEAD_READ_FAILED',
]);
const strictHead = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const strictTimestamp = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function projectPostSyncTargetFailureHistory(value, { expectedSourceHead = '', nowMs } = {}) {
  if (!value || Array.isArray(value) || value.schemaVersion !== POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA
    || !strictHead(value.expectedSourceHead) || (expectedSourceHead && value.expectedSourceHead !== expectedSourceHead)
    || !Number.isFinite(nowMs) || !Array.isArray(value.failures) || value.failures.length > TARGET_ORDER.length) return null;
  const seen = new Set(), failures = [];
  for (const row of value.failures) {
    // Reject the entire ambiguous list; a favorable prefix is not history.
    if (!row || Array.isArray(row) || !TARGET_ORDER.includes(row.targetId) || seen.has(row.targetId)
      || !TARGET_FAILURE_KINDS.has(row.failureKind) || !strictTimestamp(row.observedAtUtc)
      || Date.parse(row.observedAtUtc) > nowMs + 60_000
      || (row.reportedSourceHead !== '' && !strictHead(row.reportedSourceHead))
      || !TARGET_FAILURE_CODES.has(row.blocker)
      || (row.failureKind === 'INVOCATION_FAILED' && (row.blocker !== 'REFRESH_TARGET_INVOCATION_FAILED' || row.reportedSourceHead !== ''))
      || (row.failureKind === 'HANDLER_MISSING' && (row.blocker !== 'REFRESH_TARGET_HANDLER_MISSING' || row.reportedSourceHead !== ''))) return null;
    seen.add(row.targetId);
    failures.push(Object.freeze({ targetId: row.targetId, failureKind: row.failureKind,
      observedAtUtc: row.observedAtUtc, reportedSourceHead: row.reportedSourceHead, blocker: row.blocker }));
  }
  return Object.freeze({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
    expectedSourceHead: value.expectedSourceHead,
    failures: Object.freeze(TARGET_ORDER.flatMap(id => failures.filter(row => row.targetId === id))),
    historical: true, diagnosticOnly: true });
}

// One bounded canonical memory for the last refusal of each target. Plans and
// unrelated checkpoints are identity transitions. Only a new exact-head success
// retires its own refusal; replayed/resumed rows never become new observations.
// This memory is never an input to resultPass, resumable results or debt proof.
export function reducePostSyncTargetFailureHistory(previous, {
  expectedSourceHead, observedAtUtc, nowMs, targetId, result, failureKind = '',
} = {}) {
  const retained = projectPostSyncTargetFailureHistory(previous, { expectedSourceHead, nowMs });
  if (!strictHead(expectedSourceHead) || !Number.isFinite(nowMs) || !strictTimestamp(observedAtUtc)
    || Date.parse(observedAtUtc) > nowMs + 60_000 || !TARGET_ORDER.includes(targetId)) return retained;
  // Processing time validates stored evidence; an older incoming observation
  // must not make unrelated stored rows appear future-dated and erase them.
  if (result?.resumed === true
    || Date.parse(retained?.failures.find(row => row.targetId === targetId)?.observedAtUtc) > Date.parse(observedAtUtc)) return retained;
  if ((failureKind === 'RESULT_UNPROVEN' && resultPass(result, expectedSourceHead))
    || (['INVOCATION_FAILED', 'HANDLER_MISSING'].includes(failureKind) && result != null)) return retained;
  const failures = (retained?.failures || []).filter(row => row.targetId !== targetId);
  if (!failureKind && resultPass(result, expectedSourceHead) && strictHead(result?.sourceHead)
    && (result.blocker === undefined || result.blocker === '')) {
    return projectPostSyncTargetFailureHistory({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
      expectedSourceHead, failures }, { expectedSourceHead, nowMs });
  }
  if (!TARGET_FAILURE_KINDS.has(failureKind)) return retained;
  const blocker = failureKind === 'HANDLER_MISSING' ? 'REFRESH_TARGET_HANDLER_MISSING'
    : failureKind === 'INVOCATION_FAILED' ? 'REFRESH_TARGET_INVOCATION_FAILED'
      : TARGET_FAILURE_CODES.has(result?.blocker) ? result.blocker : 'REFRESH_TARGET_PROOF_FAILED';
  failures.push({ targetId, failureKind, observedAtUtc,
    reportedSourceHead: failureKind === 'RESULT_UNPROVEN' && strictHead(result?.sourceHead) ? result.sourceHead : '',
    blocker });
  return projectPostSyncTargetFailureHistory({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
    expectedSourceHead, failures }, { expectedSourceHead, nowMs });
}

export async function executePostSyncRefreshPlan({
  beforeHead,
  afterHead,
  changedPaths,
  adapters = {},
  completedResults = [],
  sovereignRelayRefreshRequired = false,
  onTargetComplete,
} = {}) {
  if (!validHead(beforeHead) || !validHead(afterHead) || beforeHead === afterHead) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
      blocker: 'POST_SYNC_HEADS_INVALID',
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  const plan = classifyPostSyncRefresh(changedPaths, { sovereignRelayRefreshRequired });
  if (!plan.automaticExecutionAllowed) {
    return Object.freeze({
      ok: false,
      classification: plan.classification,
      blocker: plan.classification,
      plan,
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  const resumable = new Map((Array.isArray(completedResults) ? completedResults : [])
    .filter((entry) => plan.targetIds.includes(entry?.targetId)
      && postSyncRefreshTargetResultPass(entry, { targetId: entry.targetId, plan, expectedHead: afterHead }))
    .map((entry) => [entry.targetId, Object.freeze({ ...entry, resumed: true })]));
  const results = [];
  const handlers = {
    [POST_SYNC_REFRESH_TARGETS.UI_4173]: adapters.refreshUi,
    [POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF]: adapters.proveVrAtlas,
    [POST_SYNC_REFRESH_TARGETS.BACKEND_8787]: adapters.restartBackend,
    [POST_SYNC_REFRESH_TARGETS.MISSION_WORKER]: adapters.restartMissionWorker,
    [POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX]: adapters.restartGitHubMailbox,
    [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]: adapters.refreshSovereignCommander,
    [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]: adapters.confirmNaturalReload,
  };

  const checkpoint = async observation => {
    if (typeof onTargetComplete !== 'function') return null;
    try {
      await onTargetComplete(Object.freeze([...results]), Object.freeze(observation));
      return null;
    } catch {
      // A successful handler followed by a failed status write is a persistence
      // failure, not a new native/target refusal. Preserve the observed result.
      return Object.freeze({ ok: false, classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_CHECKPOINT_PUBLICATION_FAILED:${observation.targetId}`,
        plan, exactHeadProofOk: false, results: Object.freeze(results) });
    }
  };

  for (const targetId of plan.targetIds) {
    if (resumable.has(targetId)) {
      results.push(resumable.get(targetId));
      continue;
    }
    const handler = handlers[targetId];
    if (typeof handler !== 'function') {
      const publicationFailure = await checkpoint({ targetId, failureKind: 'HANDLER_MISSING' });
      if (publicationFailure) return publicationFailure;
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_HANDLER_MISSING:${targetId}`,
        plan,
        exactHeadProofOk: false,
        results: Object.freeze(results),
      });
    }
    let result;
    try {
      result = await handler({ beforeHead, afterHead, targetId, plan });
    } catch (error) {
      const publicationFailure = await checkpoint({ targetId, failureKind: 'INVOCATION_FAILED' });
      if (publicationFailure) return publicationFailure;
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_EXECUTION_FAILED:${targetId}`,
        error: error?.message || String(error),
        plan,
        exactHeadProofOk: false,
        results: Object.freeze(results),
      });
    }
    // Normalize a generic HTTP-only success before publishing its checkpoint or
    // reducing failure history. Such a result cannot clear relay refresh debt.
    if (targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.sovereignRelayRefreshRequired
      && resultPass(result, afterHead)
      && !postSyncRefreshTargetResultPass(result, { targetId, plan, expectedHead: afterHead })) {
      result = { ...result, ok: false, exactHeadProofOk: false, freshProcessLoaded: false,
        sovereignRelayProof: null, blocker: 'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN' };
    }
    const completed = Object.freeze({ targetId, ...result });
    results.push(completed);
    const passed = postSyncRefreshTargetResultPass(result, { targetId, plan, expectedHead: afterHead });
    const publicationFailure = await checkpoint({ targetId, result, failureKind: passed ? '' : 'RESULT_UNPROVEN' });
    if (publicationFailure) return publicationFailure;
    if (!passed) {
      return Object.freeze({ ok: false, classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: result?.blocker || `REFRESH_PROOF_FAILED:${targetId}`, plan,
        exactHeadProofOk: false, results: Object.freeze(results) });
    }
  }

  if (plan.openClawApprovalRequired) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW,
      blocker: 'OPENCLAW_REFRESH_APPROVAL_REQUIRED',
      plan,
      exactHeadProofOk: false,
      safeRefreshesCompleted: true,
      results: Object.freeze(results),
    });
  }

  if (plan.pluginHostActivationRequired) {
    // A service watchdog or a checkout SHA is not a desktop plugin-host
    // handshake. The live runtime supplies no plugin-host verifier yet,
    // therefore fail closed until an independently implemented adapter proves
    // the exact loaded source, manifest and fresh host session.
    let hostProof = null;
    if (typeof adapters.verifySovereignPluginHost === 'function') {
      try {
        hostProof = await adapters.verifySovereignPluginHost({ beforeHead, afterHead, plan });
      } catch {
        hostProof = null;
      }
    }
    const hostVerified = hostProof?.ok === true
      && hostProof?.exactHeadProofOk === true
      && hostProof?.desktopPluginHostHandshakeVerified === true
      && hostProof?.loadedManifestVerified === true
      && String(hostProof?.sourceHead || '').toLowerCase() === String(afterHead).toLowerCase();
    if (!hostVerified) {
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
        plan,
        exactHeadProofOk: false,
        safeRefreshesCompleted: true,
        pluginHostActivationRequired: true,
        results: Object.freeze(results),
      });
    }
  }

  return Object.freeze({
    ok: true,
    classification: plan.targetIds.length
      ? POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_COMPLETE
      : POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED,
    blocker: '',
    plan,
    exactHeadProofOk: true,
    sourceHead: String(afterHead).toLowerCase(),
    results: Object.freeze(results),
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
  });
}

export function buildPostSyncRefreshProjection(result = {}, { beforeHead = '', afterHead = '' } = {}) {
  const plan = result.plan || {};
  return Object.freeze({
    schemaVersion: POST_SYNC_REFRESH_SCHEMA,
    beforeHead: validHead(beforeHead) ? String(beforeHead).toLowerCase() : '',
    afterHead: validHead(afterHead) ? String(afterHead).toLowerCase() : '',
    classification: result.classification || plan.classification || POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
    blocker: String(result.blocker || ''),
    targetIds: Array.isArray(plan.targetIds) ? [...plan.targetIds] : [],
    changedPathCount: Number(plan.changedPathCount || 0),
    noRuntimePathCount: Number(plan.noRuntimePathCount || 0),
    openClawPathCount: Number(plan.openClawPathCount || 0),
    pluginHostActivationRequired: plan.pluginHostActivationRequired === true,
    sovereignRelayRefreshRequired: plan.sovereignRelayRefreshRequired === true,
    unknownPathCount: Number(plan.unknownPathCount || 0),
    unsafePathCount: Number(plan.unsafePathCount || 0),
    exactHeadProofOk: result.exactHeadProofOk === true,
    safeRefreshesCompleted: result.safeRefreshesCompleted === true,
    resultTargets: Array.isArray(result.results) ? result.results.map((entry) => {
      const relayProof = projectPostSyncSovereignRelayProof(entry.sovereignRelayProof, afterHead);
      const relayObservation = projectPostSyncSovereignRelayObservation(entry.sovereignRelayObservation, afterHead);
      const required = entry.targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.sovereignRelayRefreshRequired === true;
      const qualified = !required || postSyncRefreshTargetResultPass(entry, { targetId: entry.targetId, plan, expectedHead: afterHead });
      return {
        targetId: entry.targetId,
        ok: entry.ok === true && qualified,
        exactHeadProofOk: entry.exactHeadProofOk === true && qualified,
        sourceHead: validHead(entry.sourceHead) ? String(entry.sourceHead).toLowerCase() : '',
        blocker: !qualified && entry.ok === true ? 'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN' : String(entry.blocker || ''),
        ...(relayProof ? { sovereignRelayProof: relayProof } : {}),
        ...(relayObservation ? { sovereignRelayObservation: relayObservation } : {}),
      };
    }) : [],
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    destructiveGitAllowed: false,
    unrelatedTaskMutationAllowed: false,
    liveOpenClawUpdateAllowed: false,
    pathValuesPublished: false,
    finalVerdict: result.ok === true ? 'POST_SYNC_RUNTIME_REFRESH_PASS' : 'POST_SYNC_RUNTIME_REFRESH_BLOCKED',
  });
}
