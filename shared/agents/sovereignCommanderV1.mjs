import { createHash } from 'node:crypto';
import { appendFile, lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import process from 'node:process';
import { sovereignExactCommitLoaderV1 } from './sovereignExactCommitLoaderV1.mjs';
import { resolveBattleBridgeGitExecution, createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';
import {
  STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA,
  STEPHANOS_EXECUTION_SURFACE,
} from './stephanosExecutionCommandFabricV1.mjs';
import { CANONICAL_CONTROLLER_FLEET } from './controllerFleetTelemetryV1.mjs';
import { executeCorePublicationDirectoryActionV1 } from '../../scripts/sovereign-core-directory-action-v1.mjs';
import { isSovereignMaintenanceObservationV1 } from './sovereignMaintenanceAdmissionV1.mjs';

export const SOVEREIGN_COMMANDER_SCHEMA = 'stephanos.sovereign-commander.v1';

export const SOVEREIGN_COMMANDER_OPERATION = Object.freeze({
  GET_CONFIG: 'GET_CONFIG',
  READ_FILE: 'READ_FILE',
  READ_MULTIPLE_FILES: 'READ_MULTIPLE_FILES',
  GET_FILE_INFO: 'GET_FILE_INFO',
  WRITE_FILE: 'WRITE_FILE',
  EDIT_FILE: 'EDIT_FILE',
  LIST_DIRECTORY: 'LIST_DIRECTORY',
  SEARCH_PROJECT: 'SEARCH_PROJECT',
  LIST_PROCESSES: 'LIST_PROCESSES',
  RUN_NODE_TEST: 'RUN_NODE_TEST',
  START_PROCESS: 'START_PROCESS',
  MAINTENANCE_ACTION: 'MAINTENANCE_ACTION',
});

const MAX_RESULT_TEXT = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
// Compound fixed, source-controlled repair actions may need a bounded orchestration
// window above the legacy 180s ceiling; callers still cannot provide or widen it.
const MAX_FIXED_PROCESS_TIMEOUT_MS = 270_000;
const SEARCH_SKIPPED_DIRECTORIES = Object.freeze(new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]));
const SEARCH_SENSITIVE_BASENAME = /^(?:\.env(?:\..+)?|id_rsa|id_ed25519|credentials\.json|secrets?\.(?:json|ya?ml))$/i;
const SEARCH_SENSITIVE_EXTENSION = /\.(?:key|pem|pfx|p12)$/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function frozen(value) {
  return Object.freeze(value);
}

function safeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isWindowsAbsolutePath(value) {
  return /^[a-z]:[\\/]/i.test(text(value)) || /^\\\\/.test(text(value));
}

function normalizedAbsolutePath(value) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    if (isWindowsAbsolutePath(candidate)) return win32.resolve(candidate);
    if (!isAbsolute(candidate)) return '';
    return resolve(candidate);
  } catch {
    return '';
  }
}

function pathWithin(root, candidate) {
  const normalizedRoot = normalizedAbsolutePath(root);
  const normalizedCandidate = normalizedAbsolutePath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const windows = isWindowsAbsolutePath(normalizedRoot);
  if (windows !== isWindowsAbsolutePath(normalizedCandidate)) return false;
  const relativePath = windows
    ? win32.relative(normalizedRoot, normalizedCandidate)
    : relative(normalizedRoot, normalizedCandidate);
  const relativeIsAbsolute = windows ? win32.isAbsolute(relativePath) : isAbsolute(relativePath);
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !relativeIsAbsolute);
}

// Source-bound reviewer metadata is a bounded input to the existing fixed
// calibration binary, NEVER independent signer identity or reviewer authority.
// Reject inherited properties, accessors and unknown keys before observation.
export function validateSovereignWindowsReviewIdentityV1(raw) {
  const keys = [
    'schemaVersion', 'repository', 'issueNumber', 'prNumber', 'branch',
    'sourceHead', 'baseSha', 'implementerProvider', 'implementerSessionId',
    'reviewerSessionId', 'implementerPrincipal', 'reviewerPrincipal',
  ];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype
    || Object.keys(raw).length !== keys.length
    || keys.some(k => !Object.hasOwn(raw, k)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k), 'value'))) {
    return null;
  }
  const v = Object.fromEntries(keys.map(k => [k, raw[k]]));
  const ref = /^[0-9a-f]{40}$/;
  const id = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
  const branch = /^[a-z0-9][a-z0-9._/-]{0,159}$/i;
  if (v.schemaVersion !== 'stephanos.sovereign-review-exact-request.v1'
    || v.repository !== 'Cheekyfellastef/stephan-os'
    || !Number.isSafeInteger(v.issueNumber) || v.issueNumber < 1
    || !Number.isSafeInteger(v.prNumber) || v.prNumber < 1
    || !branch.test(v.branch) || v.branch.includes('..') || v.branch.includes('//')
    || v.branch.endsWith('/') || v.branch.startsWith('refs/')
    || !ref.test(v.sourceHead) || !ref.test(v.baseSha)
    || v.sourceHead === v.baseSha
    || ['implementerProvider', 'implementerSessionId', 'reviewerSessionId',
      'implementerPrincipal', 'reviewerPrincipal'].some(k => !id.test(v[k]))
    || v.implementerSessionId === v.reviewerSessionId
    || v.implementerPrincipal === v.reviewerPrincipal) {
    return null;
  }
  return frozen(v);
}
const REVIEWER_ENV_KEYS = Object.freeze([
  'STEPHANOS_REVIEW_REPOSITORY', 'STEPHANOS_REVIEW_ISSUE',
  'STEPHANOS_REVIEW_PR', 'STEPHANOS_REVIEW_EXACT_BRANCH',
  'STEPHANOS_REVIEW_EXACT_HEAD', 'STEPHANOS_REVIEW_EXACT_BASE',
  'STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER',
  'STEPHANOS_REVIEW_IMPLEMENTER_SESSION', 'STEPHANOS_REVIEW_SESSION',
  'STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL',
  'STEPHANOS_REVIEW_REVIEWER_PRINCIPAL',
]);
export const WINDOWS_CALIBRATION_SOURCE_PATHS = Object.freeze([
  'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
  'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  'scripts/sovereign-review-coverage-v1-engine.mjs',
  'shared/agents/sovereignExactCommitLoaderV1.mjs',
  'shared/agents/sovereignAuthenticatedReviewDiffV1.mjs',
  'scripts/sovereign-windows-review-calibration-v1.mjs',
  'scripts/sovereign-high-risk-advisory-v1.mjs',
  'shared/agents/sovereignWindowsCalibrationV1.mjs',
  'shared/agents/sovereignWindowsCalibrationRemoteV1.mjs',
  'shared/agents/sovereignHighRiskReviewCandidateV1.mjs',
  'shared/agents/sovereignReviewCoverageV1.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
  'shared/agents/battleBridgeWindowsHosts.mjs',
  'shared/agents/sharedAgentWorkspaceStore.mjs',
  'shared/agents/sharedWorkspaceRuntimeConfig.mjs',
  'shared/agents/sharedAgentWorkspace.mjs',
  'shared/agents/engineeringIncidentMethodMemoryV1.mjs',
  'shared/agents/closedLoopLearningV1.mjs',
]);
function fixedReviewerEnvironment(identity, inherited) {
  const sourceEnv = inherited || process.env;
  const env = { ...createBattleBridgeMinimalChildEnvironment(sourceEnv) };
  // The inference settings are data; never inherit Node preload/loader options.
  for (const key of ['STEPHANOS_SHARED_AGENT_WORKSPACE', 'STEPHANOS_SOVEREIGN_REVIEW_MODEL',
    'STEPHANOS_SOVEREIGN_REVIEW_MODEL_CLASS']) {
    if (typeof sourceEnv[key] === 'string') env[key] = sourceEnv[key];
  }
  // Never fall back to the long-lived daemon's ambient review metadata.
  for (const key of REVIEWER_ENV_KEYS) delete env[key];
  const p = validateSovereignWindowsReviewIdentityV1(identity);
  if (!p) return null;
  return {
    ...env,
    STEPHANOS_REVIEW_REPOSITORY: p.repository,
    STEPHANOS_REVIEW_ISSUE: String(p.issueNumber),
    STEPHANOS_REVIEW_PR: String(p.prNumber),
    STEPHANOS_REVIEW_EXACT_BRANCH: p.branch,
    STEPHANOS_REVIEW_EXACT_HEAD: p.sourceHead,
    STEPHANOS_REVIEW_EXACT_BASE: p.baseSha,
    STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER: p.implementerProvider,
    STEPHANOS_REVIEW_IMPLEMENTER_SESSION: p.implementerSessionId,
    STEPHANOS_REVIEW_SESSION: p.reviewerSessionId,
    STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL: p.implementerPrincipal,
    STEPHANOS_REVIEW_REVIEWER_PRINCIPAL: p.reviewerPrincipal,
  };
}

function fixedRegistry(repoRoot) {
  const root = normalizedAbsolutePath(repoRoot);
  if (!root) return frozen({});
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const node = process.execPath;
  const psFile = (name) => resolve(root, 'scripts', 'windows', name);
  const nodeFile = (name) => resolve(root, 'scripts', name);
  return frozen({
    // Core directory mutation is deliberately unenrolled. The candidate lacks
    // qualified installed-parent/compiler and cross-process Windows custody.
    'battle-bridge-status': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-status.mjs')]),
      timeoutMs: 10_000,
    }),
    'battle-bridge-observe': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-observation.mjs')]),
      timeoutMs: 10_000,
    }),
    'meter-status': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-meter-status.mjs')]),
      timeoutMs: 10_000,
    }),
    'controller-lane-status': frozen({
      executable: node,
      // Snapshot only. No Shared Workspace file/lock mutation over remote MCP.
      args: frozen([nodeFile('sovereign-controller-lane-status.mjs'), '--snapshot-only']),
      timeoutMs: 20_000,
    }),
    'rescue-island-readonly-boundary': frozen({
      executable: node,
      args: frozen([nodeFile('rescue-island-boundary-probe.mjs')]),
      timeoutMs: 10_000,
    }),
    'visibility-snapshot': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-visibility-snapshot.mjs')]),
      timeoutMs: 30_000,
    }),
    'cpu-pressure-snapshot': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('read-battle-bridge-cpu-pressure.ps1')]),
      timeoutMs: 25_000,
    }),
    'publish-controller-activity': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-controller-activity-publish.mjs')]),
      timeoutMs: 10_000,
    }),
    'repair-ui-4173': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-ui-4173-repair.mjs')]),
      timeoutMs: 180_000,
    }),
    'restart-stephanos-runtime': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-restart-stephanos-runtime.mjs')]),
      timeoutMs: 120_000,
    }),
    'status-recovery-mesh': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-battle-bridge-recovery-mesh.ps1')]),
      timeoutMs: 10_000,
    }),
    'status-worker-watchdog': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-battle-bridge-worker-watchdog.ps1')]),
      timeoutMs: 10_000,
    }),
    'status-stephanos-core-daemon': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-stephanos-core-daemon.ps1')]),
      timeoutMs: 10_000,
    }),
    'sovereign-windows-reviewer-calibration': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-windows-review-calibration-v1.mjs'), '--commander-once']),
      timeoutMs: 180_000,
    }),
    'qwen35-canary': frozen({
      executable: node,
      args: frozen([nodeFile('qwen35-canary.mjs')]),
      timeoutMs: 180_000,
    }),
    'vr-resource-governor': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'Reconcile']),
      // Large resident Ollama models can take longer than 15s to relinquish RAM/VRAM.
      timeoutMs: 60_000,
    }),
    'gaming-resource-status': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'Status']),
      timeoutMs: 15_000,
    }),
    'gaming-resource-prepare': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'PrepareGaming']),
      timeoutMs: 60_000,
    }),
    'starfield-vr-resource-preflight': frozen({
      executable: powershell,
      args: frozen([
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', psFile('run-vr-resource-governor.ps1'),
        '-Action', 'PrepareGaming',
        '-ProcessName', 'Starfield',
        '-ProfileName', 'vr-maximum',
      ]),
      timeoutMs: 60_000,
    }),
    'gaming-resource-cancel-prepare': frozen({
      executable: powershell,
      args: frozen([
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', psFile('run-vr-resource-governor.ps1'),
        '-Action', 'CancelPrepare',
      ]),
      timeoutMs: 20_000,
    }),
    'gaming-resource-auto': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'SetAuto']),
      timeoutMs: 60_000,
    }),
    'gaming-resource-force-on': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'ForceOn']),
      timeoutMs: 60_000,
    }),
    'gaming-resource-force-off': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'ForceOff']),
      timeoutMs: 20_000,
    }),
    'gaming-resource-acceptance': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-gaming-resource-acceptance.ps1')]),
      timeoutMs: 120_000,
    }),
    'vr-virtual-airlink-acceptance': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-virtual-airlink-acceptance.ps1')]),
      timeoutMs: 45_000,
    }),
    'starfield-vr-performance-diagnosis': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('read-starfield-vr-performance-diagnosis.ps1')]),
      timeoutMs: 20_000,
    }),
    'starfield-vr-telemetry-archive': frozen({
      executable: node,
      args: frozen([nodeFile('starfield-vr-telemetry-archive.mjs')]),
      timeoutMs: 30_000,
    }),
    'report-starfield-vr-telemetry': frozen({
      executable: node,
      args: frozen([nodeFile('report-starfield-vr-telemetry.mjs')]),
      timeoutMs: 30_000,
    }),
    'starfield-vr-telemetry-refresh': frozen({
      executable: node,
      args: frozen([nodeFile('report-starfield-vr-telemetry.mjs')]),
      timeoutMs: 30_000,
    }),
    'ignite-stephanos': frozen({
      executable: node,
      args: frozen([nodeFile('run-battle-bridge-ignition.mjs')]),
      timeoutMs: 180_000,
    }),
    'repair-battle-bridge': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-repair.mjs')]),
      timeoutMs: 120_000,
    }),
    'repair-control-plane': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-control-plane-repair.mjs')]),
      timeoutMs: 180_000,
    }),
    'goal-discovery-heartbeat': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-goal-discovery-heartbeat.mjs')]),
      timeoutMs: 60_000,
    }),
    'fleet-goal-supervisor': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-fleet-goal-supervisor.mjs')]),
      timeoutMs: 60_000,
    }),
    'start-mission-orchestrator-worker': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('start-mission-orchestrator-worker-task.ps1')]),
      timeoutMs: 30_000,
    }),
    'status-mission-orchestrator-worker': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-mission-orchestrator-worker-autostart.ps1')]),
      timeoutMs: 10_000,
    }),
    'start-stephanos-backend': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('start-stephanos-backend.ps1')]),
      timeoutMs: 180_000,
    }),
    'status-stephanos-backend': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-stephanos-backend-autostart.ps1')]),
      timeoutMs: 60_000,
    }),
    'status-openclaw-whatsapp': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-openclaw-stephanos-whatsapp-command.ps1')]),
      timeoutMs: 30_000,
    }),
    'repair-openclaw-ignite': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-stephanos-ignite-command.ps1'), '-Relink']),
      timeoutMs: 60_000,
    }),
    'repair-openclaw-stack': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-full-stack.ps1')]),
      // Plugin relink + gateway restart + bounded readiness polling can legitimately
      // exceed the old 120s ceiling. Keep this below the 210s remote transport
      // deadline so the guarded receipt can still return deterministically.
      timeoutMs: 195_000,
    }),
    'repair-openclaw-standalone': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-agent.ps1'), '-Target', 'Standalone']),
      timeoutMs: 180_000,
    }),
    'repair-openclaw-local': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-agent.ps1'), '-Target', 'Local']),
      timeoutMs: 180_000,
    }),
    'repair-goal-builder-flow': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-goal-builder-repair.mjs')]),
      // The in-band builder repair never re-enters control-plane repair.
      // Its fixed child budgets total 125s, plus a bounded orchestration margin.
      timeoutMs: 145_000,
    }),
    'repair-stephanos': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-stephanos-repair.mjs')]),
      // The repair script has bounded child budgets of 45s + 145s + 10s.
      // Keep a fixed orchestration margin; callers still cannot widen it.
      timeoutMs: 220_000,
    }),
    'prove-vr-atlas-runtime': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-ui-runtime-proof.mjs'), '--profile', 'vr-atlas-status-pills']),
      timeoutMs: 60_000,
    }),
    'prove-stephanos-ai-commander': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-ai-chat-acceptance.mjs')]),
      timeoutMs: 20_000,
    }),
    'prove-flywheel-runtime': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-flywheel-runtime-proof.mjs')]),
      timeoutMs: 60_000,
    }),
    'reconcile-remote-commander-parity': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-capability-parity-reconcile.mjs')]),
      timeoutMs: 30_000,
    }),
    'sync-vr-reference-sources': frozen({
      executable: powershell,
      args: frozen([
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', nodeFile('sync-vr-reference-sources.ps1'),
      ]),
      timeoutMs: 180_000,
    }),
    'preservation-converge-pr-branch': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-preservation-converge.mjs')]),
      timeoutMs: 180_000,
    }),
  });
}

function validateEnvelope(envelope = {}) {
  const blockers = [];
  if (envelope.schemaVersion !== STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA) blockers.push('command-envelope-schema-invalid');
  if (envelope.surface !== STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER) blockers.push('sovereign-commander-surface-not-selected');
  if (envelope.dispatchAllowed !== true) blockers.push('command-envelope-dispatch-not-allowed');
  if (envelope.mergeAuthority !== false
    || envelope.leaseSeizureAllowed !== false
    || envelope.pcRestartAuthority !== false
    || envelope.arbitraryUnboundedCommandAllowed !== false) {
    blockers.push('command-envelope-authority-widened');
  }
  return blockers;
}

export function buildSovereignCommanderCommandV1(envelope = {}, options = {}) {
  const blockers = validateEnvelope(envelope);
  const operation = text(envelope.operation).toUpperCase();
  const targetPaths = Array.isArray(envelope.targetPaths) ? envelope.targetPaths.map(text).filter(Boolean) : [];
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const registry = fixedRegistry(options.repoRoot);
  let plan = null;

  if (operation === SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG) {
    plan = frozen({ kind: 'config' });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.READ_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    if (!path) blockers.push('sovereign-commander-read-requires-one-absolute-target');
    else plan = frozen({
      kind: 'read-file',
      path,
      offset: safeInteger(payload.offset, 0, 0, 100_000_000),
      length: safeInteger(payload.length, 200, 1, 1000),
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.READ_MULTIPLE_FILES) {
    const paths = targetPaths.map(normalizedAbsolutePath);
    if (paths.length < 1 || paths.length > 8 || paths.some((path) => !path)) {
      blockers.push('sovereign-commander-multiple-read-requires-1-to-8-absolute-targets');
    } else {
      plan = frozen({
        kind: 'read-multiple-files',
        paths: frozen(paths),
        offset: safeInteger(payload.offset, 0, 0, 100_000_000),
        length: safeInteger(payload.length, 100, 1, 200),
      });
    }
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.GET_FILE_INFO) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    if (!path) blockers.push('sovereign-commander-file-info-requires-one-absolute-target');
    else plan = frozen({ kind: 'get-file-info', path });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    const content = typeof payload.content === 'string' ? payload.content : null;
    const mode = text(payload.mode, 'rewrite').toLowerCase();
    if (!path) blockers.push('sovereign-commander-write-requires-one-absolute-target');
    if (content === null || Buffer.byteLength(content, 'utf8') > 1024 * 1024) blockers.push('sovereign-commander-write-content-invalid');
    if (!['rewrite', 'append'].includes(mode)) blockers.push('sovereign-commander-write-mode-invalid');
    if (path && content !== null && ['rewrite', 'append'].includes(mode)) plan = frozen({
      kind: 'write-file',
      path,
      content,
      mode,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    const oldString = typeof payload.oldString === 'string' ? payload.oldString : null;
    const newString = typeof payload.newString === 'string' ? payload.newString : null;
    if (!path) blockers.push('sovereign-commander-edit-requires-one-absolute-target');
    if (!oldString || newString === null || Buffer.byteLength(newString, 'utf8') > 1024 * 1024) blockers.push('sovereign-commander-edit-payload-invalid');
    if (path && oldString && newString !== null) plan = frozen({
      kind: 'edit-file',
      path,
      oldString,
      newString,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.RUN_NODE_TEST) {
    blockers.push('sovereign-commander-node-test-disabled-use-source-controlled-maintenance-action');
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    if (!path) blockers.push('sovereign-commander-list-requires-one-absolute-target');
    else plan = frozen({
      kind: 'list-directory',
      path,
      depth: safeInteger(payload.depth, 2, 1, 5),
      maxEntries: safeInteger(payload.maxEntries, 500, 1, 2000),
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.SEARCH_PROJECT) {
    const root = normalizedAbsolutePath(options.repoRoot);
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!root) blockers.push('trusted-repository-root-required');
    if (!query || query.length > 200) blockers.push('sovereign-commander-search-query-invalid');
    if (root && query && query.length <= 200) plan = frozen({
      kind: 'search-project',
      root,
      query,
      caseSensitive: payload.caseSensitive === true,
      maxResults: safeInteger(payload.maxResults, 50, 1, 100),
      maxFileBytes: 1024 * 1024,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES) {
    plan = frozen({ kind: 'list-processes' });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS
    || operation === SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION) {
    const processId = text(payload.processId || payload.actionId).toLowerCase();
    const fixed = registry[processId];
    if (!text(options.repoRoot)) blockers.push('trusted-repository-root-required');
    if (!fixed) blockers.push('sovereign-commander-process-not-registered');
    else {
      let args = [...fixed.args];
      if (processId === 'starfield-vr-telemetry-archive') {
        const offset = payload.offset === undefined ? 0 : payload.offset;
        const limit = payload.limit === undefined ? 12 : payload.limit;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000
            || !Number.isSafeInteger(limit) || limit < 1 || limit > 12) {
          blockers.push('sovereign-starfield-telemetry-archive-page-invalid');
        } else {
          args = [...args, '--offset', String(offset), '--limit', String(limit)];
        }
      } else if (processId === 'sovereign-windows-reviewer-calibration') {
        // An absent per-review identity must not borrow daemon startup env.
        if (!validateSovereignWindowsReviewIdentityV1(payload.reviewIdentity)) {
          blockers.push('sovereign-windows-review-identity-required');
        }
      } else if (processId === 'publish-controller-activity') {
        const encoded = text(payload.controllerActivityPayloadBase64);
        let decoded = null;
        try {
          const raw = Buffer.from(encoded, 'base64url').toString('utf8');
          decoded = JSON.parse(raw);
        } catch {}
        const canonicalControllerIds = new Set(CANONICAL_CONTROLLER_FLEET.map(({ controllerId }) => controllerId));
        if (!encoded || encoded.length > 48000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
          blockers.push('sovereign-controller-activity-payload-invalid');
        }
        if (!decoded || decoded.schemaVersion !== 'stephanos.sovereign-controller-activity-publish.v1') {
          blockers.push('sovereign-controller-activity-schema-invalid');
        }
        if (!canonicalControllerIds.has(text(decoded?.controllerId))) {
          blockers.push('sovereign-controller-activity-controller-invalid');
        }
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(text(decoded?.runId))) {
          blockers.push('sovereign-controller-activity-run-invalid');
        }
        if (blockers.length === 0) args = [...args, '--payload-base64', encoded];
      } else if (processId === 'preservation-converge-pr-branch') {
        const targetPrNumber = Number(payload.targetPrNumber);
        const targetBranch = text(payload.targetBranch);
        const targetHead = text(payload.targetHead).toLowerCase();
        const expectedMain = text(payload.expectedMain).toLowerCase();
        const branchSafe = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(targetBranch)
          && !targetBranch.includes('..')
          && !targetBranch.includes('//')
          && !targetBranch.endsWith('/')
          && !targetBranch.startsWith('refs/')
          && !['main', 'master'].includes(targetBranch.toLowerCase());
        if (!Number.isSafeInteger(targetPrNumber) || targetPrNumber < 1 || targetPrNumber > 999999999) {
          blockers.push('sovereign-preservation-convergence-pr-invalid');
        }
        if (!branchSafe) blockers.push('sovereign-preservation-convergence-branch-invalid');
        if (!/^[0-9a-f]{40}$/.test(targetHead)) blockers.push('sovereign-preservation-convergence-head-invalid');
        if (!/^[0-9a-f]{40}$/.test(expectedMain)) blockers.push('sovereign-preservation-convergence-main-invalid');
        if (targetHead && expectedMain && targetHead === expectedMain) blockers.push('sovereign-preservation-convergence-head-equals-main');
        if (blockers.length === 0) {
          args = [
            ...args,
            '--pr', String(targetPrNumber),
            '--branch', targetBranch,
            '--expected-head', targetHead,
            '--expected-main', expectedMain,
          ];
        }
      }
      if (processId === 'repair-core-publication-directories') {
        if (operation !== SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION
          || !/^[a-f0-9]{40}$/.test(payload.expectedMain ?? '')
          || Object.keys(payload).some(key => !['actionId', 'expectedMain'].includes(key)))
          blockers.push('sovereign-core-directory-fixed-scope-required');
        if (blockers.length === 0) plan = frozen({ kind: 'core-publication-repair', processId, expectedMain: payload.expectedMain });
      } else if (blockers.length === 0) plan = frozen({
        kind: 'fixed-process', processId, ...fixed, args: frozen(args),
        ...(processId === 'sovereign-windows-reviewer-calibration'
          ? { reviewIdentity: validateSovereignWindowsReviewIdentityV1(payload.reviewIdentity) }
          : {}),
      });
    }
  } else {
    blockers.push('sovereign-commander-operation-not-registered');
  }

  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
    commandId: text(envelope.commandId),
    missionId: text(envelope.missionId),
    operation,
    plan,
    dispatchAllowed: blockers.length === 0,
    blockers: frozen([...new Set(blockers)]),
    receiptRequired: true,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    pcRestartAuthority: false,
    arbitraryUnboundedCommandAllowed: false,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    finalVerdict: blockers.length === 0
      ? 'SOVEREIGN_COMMANDER_COMMAND_READY'
      : 'SOVEREIGN_COMMANDER_COMMAND_BLOCKED',
  });
}

function relativeProjectPath(root, candidate) {
  const windows = isWindowsAbsolutePath(root);
  return (windows ? win32.relative(root, candidate) : relative(root, candidate)).replaceAll('\\', '/');
}

function projectSearchFileAllowed(name) {
  const basename = text(name);
  return Boolean(basename)
    && !SEARCH_SENSITIVE_BASENAME.test(basename)
    && !SEARCH_SENSITIVE_EXTENSION.test(basename);
}

async function searchProjectTree(root, query, caseSensitive, maxResults, maxFileBytes) {
  const results = [];
  const needle = caseSensitive ? query : query.toLowerCase();

  async function walk(current) {
    if (results.length >= maxResults) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.isDirectory()) {
        if (!SEARCH_SKIPPED_DIRECTORIES.has(entry.name)) await walk(resolve(current, entry.name));
        continue;
      }
      if (!entry.isFile() || !projectSearchFileAllowed(entry.name)) continue;
      const absolute = resolve(current, entry.name);
      let info;
      try { info = await stat(absolute); } catch { continue; }
      if (!info.isFile() || info.size > maxFileBytes) continue;
      let raw;
      try { raw = await readFile(absolute, 'utf8'); } catch { continue; }
      if (raw.includes('\u0000')) continue;
      const lines = raw.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex += 1) {
        const haystack = caseSensitive ? lines[lineIndex] : lines[lineIndex].toLowerCase();
        const column = haystack.indexOf(needle);
        if (column < 0) continue;
        results.push(frozen({
          path: absolute,
          relativePath: relativeProjectPath(root, absolute),
          line: lineIndex + 1,
          column: column + 1,
          preview: lines[lineIndex].slice(0, 240),
        }));
      }
    }
  }

  await walk(root);
  return results;
}

async function listDirectoryTree(root, depth, maxEntries) {
  const results = [];
  async function walk(current, remaining) {
    if (results.length >= maxEntries) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      const absolute = resolve(current, entry.name);
      results.push({
        path: absolute,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      });
      if (entry.isDirectory() && remaining > 1) await walk(absolute, remaining - 1);
    }
  }
  await walk(root, depth);
  return results;
}

function fixedProcessRouteEnvironment(options = {}) {
  const routeProof = options?.routeProof;
  if (!routeProof || routeProof.commandPathProven !== true) return null;
  return {
    ...process.env,
    STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN: '1',
    STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_TRANSPORT: text(routeProof.transport || 'mcp-session').slice(0, 80),
    STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP: routeProof.authenticatedMcp === true ? '1' : '0',
    STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY: routeProof.mcpSessionReady === true ? '1' : '0',
  };
}

const SAFE_FIXED_PROCESS_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

function fixedProcessStructuredBlocker(result) {
  const raw = String(result?.stdout || '').trim();
  if (!raw) return '';
  const lines = [raw, ...raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()];
  for (const line of lines) {
    const candidates = line.includes('=') ? [line, line.slice(line.indexOf('=') + 1)] : [line];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const blocker = text(parsed?.blocker);
        if (SAFE_FIXED_PROCESS_BLOCKER.test(blocker)) return blocker;
      } catch {}
    }
  }
  return '';
}

// Both observation and owner-reserved asynchronous execution use this same
// admission and launch preparation. Moving a fixed action between runners
// must never lose its request identity, authenticated transport or loader.
function prepareFixedProcessLaunch(plan, options = {}) {
  const routeEnvironment = fixedProcessRouteEnvironment(options);
  const reviewer = plan.processId === 'sovereign-windows-reviewer-calibration';
  const candidateEnvironment = reviewer
    ? fixedReviewerEnvironment(plan.reviewIdentity, routeEnvironment)
    : routeEnvironment;
  if (reviewer && (!candidateEnvironment || !routeEnvironment
      || options?.routeProof?.authenticatedMcp !== true
      || options?.routeProof?.mcpSessionReady !== true)) {
    return frozen({ ok: false, status: null, stdout: '', stderr: '',
      errorCode: 'SOVEREIGN_WINDOWS_REVIEW_IDENTITY_OR_TRANSPORT_UNPROVEN' });
  }
  // This loader is supplied by the independently installed Commander parent,
  // not by the candidate script. No candidate module evaluates before its
  // complete import closure has been authenticated and captured in memory.
  const args = reviewer ? ['--experimental-loader', sovereignExactCommitLoaderV1({
    root: normalizedAbsolutePath(options.repoRoot), head: plan.reviewIdentity.sourceHead,
    files: WINDOWS_CALIBRATION_SOURCE_PATHS,
    git: resolveBattleBridgeGitExecution({ environment: candidateEnvironment }),
  }), ...plan.args] : [...plan.args];
  return frozen({ ok: true, args: frozen(args), environment: candidateEnvironment });
}

function runFixedProcess(plan, options = {}) {
  const launch = prepareFixedProcessLaunch(plan, options);
  if (!launch.ok) return launch;
  const runner = options.spawnSyncFn || spawnSync;
  const result = runner(plan.executable, launch.args, {
    cwd: normalizedAbsolutePath(options.repoRoot) || undefined,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    ...(launch.environment ? { env: launch.environment } : {}),
    timeout: Math.min(safeInteger(plan.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_FIXED_PROCESS_TIMEOUT_MS), MAX_FIXED_PROCESS_TIMEOUT_MS),
    maxBuffer: MAX_RESULT_TEXT * 4,
  });
  const stdout = String(result?.stdout || '').slice(0, MAX_RESULT_TEXT);
  const stderr = String(result?.stderr || '').slice(0, MAX_RESULT_TEXT);
  return frozen({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: text(result?.signal),
    stdout,
    stderr,
    errorCode: text(result?.error?.code || result?.error?.message).slice(0, 160),
  });
}

// Only an actual pre-spawn reviewer failure may release the maintenance owner's
// custody reservation. Public blocker strings or a fabricated result never suffice.
const provenReviewerPreExecution = new WeakSet();
export function isProvenSovereignWindowsReviewerPreExecutionDenialV1(command, result) {
  const execution = result?.structuredContent;
  return command?.plan?.kind === 'fixed-process'
    && command.plan.processId === 'sovereign-windows-reviewer-calibration'
    && result?.ok === false
    && result?.blocker === 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE'
    && result?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
    && execution && typeof execution === 'object'
    && provenReviewerPreExecution.has(execution)
    && execution.ok === false && execution.status === null
    && !execution.signal && execution.stdout === '' && execution.stderr === ''
    && execution.errorCode === 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE';
}

function runOwnedFixedProcess(plan, options = {}) {
  // Source-only executor fixtures inject the synchronous primitive explicitly.
  if (options.spawnSyncFn) return Promise.resolve(runFixedProcess(plan, options));
  const launch = prepareFixedProcessLaunch(plan, options);
  if (!launch.ok) return Promise.resolve(launch);
  return new Promise(resolveResult => {
    let child, timer, settled = false, spawned = false, stdout = '', stderr = '';
    const finish = (status, signal = '', errorCode = '', provenPreSpawn = false) => {
      if (settled) return;
      settled = true;
      if (timer) (options.clearTimeoutFn || clearTimeout)(timer);
      // Unknown/signal/error completion is never a calibration receipt. Apply
      // redaction at the shared terminal boundary, including close and timeout,
      // while preserving known-exit structured HOLD reports and custody state.
      if (plan.processId === 'sovereign-windows-reviewer-calibration'
          && (!Number.isInteger(status) || signal || errorCode)) {
        stdout = ''; stderr = '';
      }
      const execution = frozen({ ok: status === 0 && !signal && !errorCode, status,
        signal, errorCode, stdout, stderr });
      if (provenPreSpawn) provenReviewerPreExecution.add(execution);
      resolveResult(execution);
    };
    const failSpawn = error => {
      if (settled) return;
      if (plan.processId === 'sovereign-windows-reviewer-calibration') {
        // ChildProcess emits 'spawn' only after successful creation. An error
        // after that event cannot exclude surviving Windows descendants.
        // Redact calibration output in either case; never convert a post-spawn
        // error into safe pre-execution evidence.
        stdout = ''; stderr = '';
        finish(null, '', spawned
          ? 'SOVEREIGN_WINDOWS_REVIEW_EXECUTION_CUSTODY_UNPROVEN'
          : 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE', !spawned);
      } else {
        finish(null, '', text(error?.code || 'FIXED_PROCESS_SPAWN_FAILED'));
      }
    };
    try {
      child = (options.spawnFn || spawn)(plan.executable, launch.args, {
        cwd: normalizedAbsolutePath(options.repoRoot) || undefined,
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        ...(launch.environment ? { env: launch.environment } : {}),
      });
      child.stdout?.on('data', bytes => { stdout = (stdout + String(bytes)).slice(0, MAX_RESULT_TEXT); });
      child.stderr?.on('data', bytes => { stderr = (stderr + String(bytes)).slice(0, MAX_RESULT_TEXT); });
      child.once('spawn', () => { spawned = true; });
      child.once('error', failSpawn);
      child.once('close', (code, signal) => finish(Number.isInteger(code) ? code : null, text(signal)));
      timer = (options.setTimeoutFn || setTimeout)(() => {
        if (settled) return;
        // Settle as unknown custody before a synchronous close can look green.
        finish(null, '', 'ETIMEDOUT');
        try { child.kill(); } catch {}
      }, safeInteger(plan.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_FIXED_PROCESS_TIMEOUT_MS));
      timer?.unref?.();
    } catch (error) { failSpawn(error); }
  });
}

function listProcesses(options = {}) {
  if (typeof options.listProcessesFn === 'function') return options.listProcessesFn();
  if (process.platform !== 'win32' && options.allowNonWindowsForTest !== true) {
    return frozen({ ok: false, status: null, stdout: '', stderr: 'WINDOWS_REQUIRED', errorCode: 'WINDOWS_REQUIRED' });
  }
  const runner = options.spawnSyncFn || spawnSync;
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const script = [
    "$ErrorActionPreference='Stop'",
    'Get-Process | Sort-Object ProcessName,Id | Select-Object -First 500 Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runner(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: MAX_RESULT_TEXT * 4,
  });
  return frozen({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || '').slice(0, MAX_RESULT_TEXT),
    stderr: String(result?.stderr || '').slice(0, MAX_RESULT_TEXT),
    errorCode: text(result?.error?.code || result?.error?.message).slice(0, 160),
  });
}

export async function executeSovereignCommanderCommandV1(envelope = {}, options = {}) {
  const command = buildSovereignCommanderCommandV1(envelope, options);
  if (!command.dispatchAllowed) {
    return frozen({
      ok: false,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      blocker: command.blockers[0] || 'sovereign-commander-command-blocked',
      ...(envelope.payload?.actionId === 'repair-core-publication-directories'
        ? { executionCustodyReleased: true } : {}), // rejected before any execution
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
    });
  }

  const run = () => executeAdmittedSovereignCommandV1(command, options);
  if (command.plan.kind === 'fixed-process' && !isSovereignMaintenanceObservationV1(command.plan.processId)) {
    if (typeof options.withMaintenanceOwner === 'function') {
      return options.withMaintenanceOwner(command, run, { signal: options.signal });
    }
    // Local Core/stdio callers never launch beside an independently scheduled
    // guardian. The existing authenticated HTTP owner performs the operation.
    try {
      const callOwner = options.callMaintenanceOwner || (await import('./sovereignCommanderRemoteMailboxV1.mjs')).callSovereignMaintenanceOwnerV1;
      const owned = await callOwner({ actionId: command.plan.processId,
        arguments: envelope.payload, timeoutMs: command.plan.timeoutMs });
      if (!owned || owned.command?.plan?.processId !== command.plan.processId) {
        return frozen({ ok: false, command, blocker: owned?.blocker || 'SOVEREIGN_MAINTENANCE_OWNER_RECEIPT_INVALID',
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' });
      }
      const structuredContent = frozen({ ...owned.structuredContent,
        ownerCommandId: owned.command.commandId, ownerProofHash: owned.proofHash || '' });
      return frozen({ ...owned, command, structuredContent,
        proofHash: hash({ commandId: command.commandId, missionId: command.missionId,
          operation: command.operation, plan: command.plan, contentText: owned.contentText, structuredContent }) });
    } catch { return frozen({ ok: false, command, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE',
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' }); }
  }
  return run();
}

async function executeAdmittedSovereignCommandV1(command, options) {
  try {
    let contentText = '';
    let structuredContent = null;

    if (command.plan.kind === 'config') {
      structuredContent = frozen({
        schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
        implementation: 'stephanos-local-node',
        wholePcCapable: true,
        canEditFiles: true,
        canSearchProject: true,
        canRunFocusedNodeTests: false,
        sourceControlledMaintenanceOnly: true,
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
        arbitraryUnboundedCommandAllowed: false,
        mergeAuthority: false,
        pcRestartAuthority: false,
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'read-file') {
      const raw = await readFile(command.plan.path, 'utf8');
      const lines = raw.split(/\r?\n/);
      const selected = lines.slice(command.plan.offset, command.plan.offset + command.plan.length);
      contentText = selected.join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = frozen({
        path: command.plan.path,
        offset: command.plan.offset,
        length: selected.length,
        totalLines: lines.length,
      });
    } else if (command.plan.kind === 'read-multiple-files') {
      const files = [];
      let remainingCharacters = MAX_RESULT_TEXT;
      for (const path of command.plan.paths) {
        const raw = await readFile(path, 'utf8');
        const lines = raw.split(/\r?\n/);
        const selected = lines.slice(command.plan.offset, command.plan.offset + command.plan.length);
        const fullContent = selected.join('\n');
        const content = fullContent.slice(0, remainingCharacters);
        remainingCharacters -= content.length;
        files.push(frozen({
          path,
          offset: command.plan.offset,
          length: selected.length,
          totalLines: lines.length,
          content,
          truncated: content.length < fullContent.length,
        }));
      }
      structuredContent = frozen({
        files: frozen(files),
        totalFiles: files.length,
        contentBudgetExhausted: remainingCharacters === 0,
      });
      contentText = files.map((file) => `${file.path}\n${file.content}`).join('\n').slice(0, MAX_RESULT_TEXT);
    } else if (command.plan.kind === 'get-file-info') {
      const info = await lstat(command.plan.path);
      structuredContent = frozen({
        path: command.plan.path,
        type: info.isSymbolicLink() ? 'SYMLINK' : info.isFile() ? 'FILE' : info.isDirectory() ? 'DIRECTORY' : 'OTHER',
        bytes: info.size,
        modifiedAtUtc: info.mtime.toISOString(),
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'write-file') {
      if (command.plan.mode === 'append') await appendFile(command.plan.path, command.plan.content, 'utf8');
      else await writeFile(command.plan.path, command.plan.content, 'utf8');
      structuredContent = frozen({
        path: command.plan.path,
        bytesWritten: Buffer.byteLength(command.plan.content, 'utf8'),
        mode: command.plan.mode,
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'edit-file') {
      const raw = await readFile(command.plan.path, 'utf8');
      const first = raw.indexOf(command.plan.oldString);
      const second = first < 0 ? -1 : raw.indexOf(command.plan.oldString, first + command.plan.oldString.length);
      if (first < 0 || second >= 0) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          blocker: first < 0 ? 'sovereign-commander-edit-old-string-not-found' : 'sovereign-commander-edit-old-string-not-unique',
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
        });
      }
      const updated = raw.slice(0, first) + command.plan.newString + raw.slice(first + command.plan.oldString.length);
      await writeFile(command.plan.path, updated, 'utf8');
      structuredContent = frozen({
        path: command.plan.path,
        replacements: 1,
        bytesWritten: Buffer.byteLength(updated, 'utf8'),
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'node-test') {
      const result = runFixedProcess(command.plan, options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || `focused-node-test-exit-${String(result.status)}`,
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    } else if (command.plan.kind === 'list-directory') {
      const entries = await listDirectoryTree(command.plan.path, command.plan.depth, command.plan.maxEntries);
      structuredContent = frozen({
        path: command.plan.path,
        depth: command.plan.depth,
        entries: frozen(entries),
        truncated: entries.length >= command.plan.maxEntries,
      });
      contentText = entries.map((entry) => `${entry.type}\t${entry.path}`).join('\n').slice(0, MAX_RESULT_TEXT);
    } else if (command.plan.kind === 'search-project') {
      const results = await searchProjectTree(
        command.plan.root,
        command.plan.query,
        command.plan.caseSensitive,
        command.plan.maxResults,
        command.plan.maxFileBytes,
      );
      structuredContent = frozen({
        root: command.plan.root,
        query: command.plan.query,
        caseSensitive: command.plan.caseSensitive,
        resultCount: results.length,
        maxResults: command.plan.maxResults,
        results: frozen(results),
        truncated: results.length >= command.plan.maxResults,
      });
      contentText = results
        .map((entry) => `${entry.relativePath}:${entry.line}:${entry.column}\t${entry.preview}`)
        .join('\n')
        .slice(0, MAX_RESULT_TEXT);
    } else if (command.plan.kind === 'list-processes') {
      const result = await listProcesses(options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || 'sovereign-commander-process-list-failed',
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    } else if (command.plan.kind === 'core-publication-repair') {
      const result = await executeCorePublicationDirectoryActionV1(command, options);
      contentText = JSON.stringify(result);
      structuredContent = result;
      if (!result.ok) return frozen({ ok: false, schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
        command, contentText, structuredContent, blocker: result.reason,
        finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' });
    } else if (command.plan.kind === 'fixed-process') {
      const result = isSovereignMaintenanceObservationV1(command.plan.processId)
        ? runFixedProcess(command.plan, options) : await runOwnedFixedProcess(command.plan, options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || fixedProcessStructuredBlocker(result) || `fixed-process-exit-${String(result.status)}`,
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    }

    const proofHash = hash({
      commandId: command.commandId,
      missionId: command.missionId,
      operation: command.operation,
      plan: command.plan,
      contentText,
      structuredContent,
    });

    return frozen({
      ok: true,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      contentText,
      structuredContent,
      proofHash,
      receiptRequired: true,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    });
  } catch (error) {
    // Fixed high-risk reviewer failure may happen before child spawn or before
    // a terminal calibration marker exists. Never expose the raw thrown value,
    // executable paths, Git arguments, model output, or loader implementation.
    // Retain only one closed-world denial for the existing authenticated MCP
    // mailbox, preserving explicit status:null and no authority on exceptions.
    if (command.plan?.kind === 'fixed-process'
      && command.plan.processId === 'sovereign-windows-reviewer-calibration') {
      const errorCode = 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE';
      return frozen({
        ok: false, schemaVersion: SOVEREIGN_COMMANDER_SCHEMA, command,
        contentText: '',
        structuredContent: frozen({ ok: false, status: null,
          stdout: '', stderr: '', errorCode }),
        blocker: errorCode,
        finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      });
    }
    return frozen({
      ok: false,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      blocker: text(error?.code || error?.message, 'sovereign-commander-execution-error').slice(0, 160),
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    });
  }
}
