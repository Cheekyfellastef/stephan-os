export const STEPHANOS_CAPABILITY_REGISTRY_SCHEMA = 'stephanos.capability-registry.v1';
export const STEPHANOS_CAPABILITY_REGISTRY_VERSION = '1.2.0';
export const STEPHANOS_CAPABILITY_REGISTRY_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SAFE_CAPABILITY_ID = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ABSOLUTE_PATH_PATTERN = /(?:^|["'\s])(?:[a-z]:[\\/]|\\\\|\/(?:users|home|workspace|tmp)\/)/i;

function descriptor(input) {
  return Object.freeze({
    capabilityId: input.capabilityId,
    category: input.category,
    purpose: input.purpose,
    ownerIssue: Number(input.ownerIssue),
    discoveryRoute: input.discoveryRoute,
    statusSource: input.statusSource,
    operations: Object.freeze([...(input.operations || [])]),
    requiresOperatorApproval: input.requiresOperatorApproval === true,
    runtimeMutationAllowed: input.runtimeMutationAllowed === true,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
  });
}

function compactDescriptor(capability) {
  return Object.freeze({
    capabilityId: capability.capabilityId,
    category: capability.category,
    ownerIssue: capability.ownerIssue,
    discoveryRoute: capability.discoveryRoute,
    statusSource: capability.statusSource,
    operations: capability.operations,
    requiresOperatorApproval: capability.requiresOperatorApproval,
    runtimeMutationAllowed: capability.runtimeMutationAllowed,
  });
}

export const STEPHANOS_CAPABILITIES = Object.freeze([
  descriptor({
    capabilityId: 'shared-agent-workspace',
    category: 'live-state-store',
    purpose: 'Durable status, proof, event, receipt and participant state outside the source tree.',
    ownerIssue: 1290,
    discoveryRoute: 'mailbox:READ_SHARED_WORKSPACE_STATUS',
    statusSource: 'shared-agent-workspace',
    operations: ['READ_CURRENT_STATUS', 'READ_LATEST_PROOF', 'READ_OPERATOR_ATTENTION'],
  }),
  descriptor({
    capabilityId: 'chatgpt-participant-bridge',
    category: 'bounded-control-plane',
    purpose: 'Sanitized Shared Workspace reads and bounded next-action or attention writes through fixed GitHub relay comments.',
    ownerIssue: 1506,
    discoveryRoute: 'github-fixed-comment-relay',
    statusSource: 'shared-agent-workspace',
    operations: [
      'READ_CURRENT_STATUS',
      'READ_LATEST_PROOF',
      'READ_OPERATOR_ATTENTION',
      'WRITE_GOAL_INTENT_PROPOSAL',
      'WRITE_NEXT_ACTION_PACKET',
      'WRITE_BLOCKER_CLASSIFICATION',
      'WRITE_OPERATOR_ATTENTION_REQUEST',
      'WRITE_APPROVAL_REQUEST',
    ],
    requiresOperatorApproval: true,
  }),
  descriptor({
    capabilityId: 'battle-bridge-github-command-mailbox',
    category: 'bounded-windows-transport',
    purpose: 'Owner-authored expiring allowlisted commands from GitHub to the real Windows Battle Bridge with accepted and terminal receipts.',
    ownerIssue: 1507,
    discoveryRoute: 'github-issue-1507',
    statusSource: 'github-command-receipts',
    operations: [
      'UPDATE_STEPHANOS_FROM_CHAT',
      'INSTALL_UNATTENDED_GITHUB_SYNC',
      'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
      'READ_DEPLOYMENT_STATUS',
      'READ_CAPABILITY_REGISTRY',
      'READ_SHARED_WORKSPACE_STATUS',
      'READ_MAILBOX_RECEIPT',
      'RUN_WORKER_WATCHDOG_ACCEPTANCE',
    ],
    requiresOperatorApproval: true,
    runtimeMutationAllowed: true,
  }),
  descriptor({
    capabilityId: 'unattended-github-sync',
    category: 'source-deployment',
    purpose: 'Fetch and fast-forward canonical main only when source state is safe and unambiguous.',
    ownerIssue: 1507,
    discoveryRoute: 'mailbox:READ_DEPLOYMENT_STATUS',
    statusSource: 'shared-agent-workspace',
    operations: ['FETCH_ORIGIN_MAIN', 'FAST_FORWARD_ONLY'],
    runtimeMutationAllowed: true,
  }),
  descriptor({
    capabilityId: 'post-sync-runtime-refresh-coordinator',
    category: 'runtime-deployment',
    purpose: 'Loads the newly deployed checkout in a fresh process, refreshes only affected registered runtimes, and requires exact-head proof before sync completion.',
    ownerIssue: 1507,
    discoveryRoute: 'shared-workspace:post-sync-runtime-refresh-current',
    statusSource: 'shared-agent-workspace',
    operations: ['CLASSIFY_CHANGED_PATHS', 'REFRESH_UI_4173', 'RESTART_BACKEND_8787', 'RESTART_MISSION_WORKER', 'NATURAL_RELOAD_PROOF'],
    runtimeMutationAllowed: true,
  }),
  descriptor({
    capabilityId: 'mission-orchestrator-worker',
    category: 'programme-orchestration',
    purpose: 'Advances goals, proof requests and next-action packets while preserving operator approval boundaries.',
    ownerIssue: 1291,
    discoveryRoute: 'shared-workspace:participant-status',
    statusSource: 'shared-agent-workspace',
    operations: ['ADVANCE_GOAL', 'PUBLISH_HEARTBEAT', 'WRITE_NEXT_ACTION_PACKET'],
  }),
  descriptor({
    capabilityId: 'battle-bridge-worker-watchdog',
    category: 'runtime-supervision',
    purpose: 'Keeps the Mission Orchestrator Worker available through one fixed canonical task identity.',
    ownerIssue: 1291,
    discoveryRoute: 'shared-workspace:participant-status',
    statusSource: 'shared-agent-workspace',
    operations: ['INSPECT_WORKER', 'START_APPROVED_WORKER_TASK'],
    runtimeMutationAllowed: true,
  }),
  descriptor({
    capabilityId: 'programme-stall-monitor',
    category: 'programme-monitoring',
    purpose: 'Deterministically diagnoses durable programme stalls and publishes through the existing Monitor Multiplexer without scheduling or mutation.',
    ownerIssue: 1497,
    discoveryRoute: 'shared-workspace:monitor-programme-stall-monitor',
    statusSource: 'monitor-multiplexer',
    operations: ['DIAGNOSE_PROGRAMME_STALL', 'PUBLISH_MONITOR_RESULT'],
  }),
  descriptor({
    capabilityId: 'verification-harness',
    category: 'evidence',
    purpose: 'Produces deterministic source, runtime, endpoint and policy verification results.',
    ownerIssue: 1287,
    discoveryRoute: 'shared-workspace:latest-proof',
    statusSource: 'shared-agent-workspace',
    operations: ['RUN_ALLOWLISTED_VERIFIER', 'READ_LATEST_PROOF'],
  }),
  descriptor({
    capabilityId: 'openclaw-gateway',
    category: 'local-agent-runtime',
    purpose: 'Approved executable OpenClaw gateway surface, independently verified from the read-only adapter.',
    ownerIssue: 1291,
    discoveryRoute: 'verification-harness:openclaw-gateway',
    statusSource: 'shared-agent-workspace',
    operations: ['READ_STATUS'],
  }),
  descriptor({
    capabilityId: 'operator-proxy',
    category: 'approval-routing',
    purpose: 'Keeps Stephan at intent, judgment and approval level while deterministic routine work remains automated.',
    ownerIssue: 1505,
    discoveryRoute: 'shared-workspace:operator-attention',
    statusSource: 'shared-agent-workspace',
    operations: ['REQUEST_APPROVAL', 'READ_OPERATOR_ATTENTION'],
    requiresOperatorApproval: true,
  }),
  descriptor({
    capabilityId: 'remote-codex-battle-bridge',
    category: 'specialist-execution',
    purpose: 'Single active specialist Windows execution lane for work that cannot be completed through bounded machinery.',
    ownerIssue: 1291,
    discoveryRoute: 'shared-workspace:active-execution-lane',
    statusSource: 'shared-agent-workspace',
    operations: ['SPECIALIST_WINDOWS_EXECUTION'],
    requiresOperatorApproval: true,
    runtimeMutationAllowed: true,
  }),
]);

export function validateStephanosCapabilityRegistry(capabilities = STEPHANOS_CAPABILITIES) {
  const errors = [];
  const seen = new Set();
  for (const capability of capabilities) {
    const capabilityId = String(capability?.capabilityId || '');
    if (!SAFE_CAPABILITY_ID.test(capabilityId)) errors.push('invalid-capability-id');
    if (seen.has(capabilityId)) errors.push(`duplicate-capability-id:${capabilityId}`);
    seen.add(capabilityId);
    if (!Number.isInteger(capability?.ownerIssue) || capability.ownerIssue <= 0) errors.push(`invalid-owner-issue:${capabilityId || 'unknown'}`);
    if (!String(capability?.purpose || '').trim()) errors.push(`missing-purpose:${capabilityId || 'unknown'}`);
    if (!String(capability?.discoveryRoute || '').trim()) errors.push(`missing-discovery-route:${capabilityId || 'unknown'}`);
    if (!Array.isArray(capability?.operations)) errors.push(`invalid-operations:${capabilityId || 'unknown'}`);
    if (capability?.arbitraryShellAllowed !== false) errors.push(`arbitrary-shell-forbidden:${capabilityId || 'unknown'}`);
    if (capability?.destructiveGitAllowed !== false) errors.push(`destructive-git-forbidden:${capabilityId || 'unknown'}`);
    if (capability?.liveOpenClawUpdateAllowed !== false) errors.push(`live-openclaw-update-forbidden:${capabilityId || 'unknown'}`);
    if (ABSOLUTE_PATH_PATTERN.test(JSON.stringify(capability))) errors.push(`absolute-path-forbidden:${capabilityId || 'unknown'}`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    capabilityCount: capabilities.length,
    finalVerdict: errors.length === 0 ? 'STEPHANOS_CAPABILITY_REGISTRY_PASS' : 'STEPHANOS_CAPABILITY_REGISTRY_BLOCKED',
  });
}

function bootstrapProjection() {
  return Object.freeze({
    requiredBeforeCapabilityDenial: true,
    sequence: Object.freeze(['READ_CAPABILITY_REGISTRY', 'READ_SHARED_WORKSPACE_STATUS', 'CHECK_ACTIVE_EXECUTION_LANE', 'SELECT_ALLOWLISTED_ROUTE']),
    failClosedWhenDiscoveryUnavailable: true,
    duplicateActiveExecutionAllowed: false,
  });
}

function safetyProjection() {
  return Object.freeze({
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    secretOrAbsolutePathPublicationAllowed: false,
  });
}

export function buildStephanosCapabilityRegistryProjection({ sourceHead = '', generatedAtUtc = new Date(0).toISOString() } = {}) {
  const validation = validateStephanosCapabilityRegistry();
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_REGISTRY_SCHEMA,
    registryVersion: STEPHANOS_CAPABILITY_REGISTRY_VERSION,
    repository: STEPHANOS_CAPABILITY_REGISTRY_REPOSITORY,
    branch: 'main',
    sourceHead: SHA_PATTERN.test(String(sourceHead || '')) ? String(sourceHead).toLowerCase() : '',
    generatedAtUtc: String(generatedAtUtc || ''),
    bootstrap: bootstrapProjection(),
    capabilities: STEPHANOS_CAPABILITIES,
    safety: safetyProjection(),
    validation,
    finalVerdict: validation.finalVerdict,
  });
}

export function buildStephanosCapabilityRegistrySummary({ sourceHead = '', generatedAtUtc = new Date(0).toISOString() } = {}) {
  const validation = validateStephanosCapabilityRegistry();
  return Object.freeze({
    schemaVersion: STEPHANOS_CAPABILITY_REGISTRY_SCHEMA,
    registryVersion: STEPHANOS_CAPABILITY_REGISTRY_VERSION,
    repository: STEPHANOS_CAPABILITY_REGISTRY_REPOSITORY,
    branch: 'main',
    sourceHead: SHA_PATTERN.test(String(sourceHead || '')) ? String(sourceHead).toLowerCase() : '',
    generatedAtUtc: String(generatedAtUtc || ''),
    bootstrap: bootstrapProjection(),
    capabilities: Object.freeze(STEPHANOS_CAPABILITIES.map(compactDescriptor)),
    safety: safetyProjection(),
    capabilityCount: validation.capabilityCount,
    finalVerdict: validation.finalVerdict,
  });
}

export function findStephanosCapability(capabilityId) {
  return STEPHANOS_CAPABILITIES.find((capability) => capability.capabilityId === capabilityId) || null;
}
