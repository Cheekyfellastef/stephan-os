import { adjudicateOpenClawLocalAdapter } from './openClawLocalAdapter.mjs';

export const EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA = 'stephanos.execution-surface-routing-policy.v1';
export const CHATGPT_WORK_CAPABILITY_RECEIPT_SCHEMA = 'stephanos.chatgpt-work-capability-receipt.v1';
export const EXECUTION_SURFACE_ROUTE = Object.freeze({
  CHATGPT_GITHUB_FIRST: 'CHATGPT_GITHUB_FIRST',
  CHATGPT_WORK_GITHUB: 'CHATGPT_WORK_GITHUB',
  OPENCLAW_LOCAL_BATTLE_BRIDGE: 'OPENCLAW_LOCAL_BATTLE_BRIDGE',
  REMOTE_CODEX_BATTLE_BRIDGE: 'REMOTE_CODEX_BATTLE_BRIDGE',
  MIXED_WORK_AND_LOCAL: 'MIXED_WORK_AND_LOCAL',
  NONE: 'NONE',
});
export const EXECUTION_SURFACE_BLOCKER = Object.freeze({
  ROUTE_CAPABILITY_MISMATCH: 'BLOCKED_ROUTE_CAPABILITY_MISMATCH',
  BATTLE_BRIDGE_NOT_ATTACHED: 'BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED',
  LOCAL_SUBTASK_PENDING: 'LOCAL_EXECUTION_SUBTASK_PENDING',
});

const WINDOWS = /(?:\bbattle bridge\b|\bwindows\b|\bpowershell\b|\bscheduled task\b|\btask scheduler\b|\bwatchdog\b|\blocalhost\b|127\.0\.0\.1|\b4173\b|\b8787\b|\b18789\b|\bservice control\b|\bregistry\b|\bcanonical checkout\b|\blocal runtime\b|\bserved runtime\b|\bexact runtime head\b)/i;
const REPOSITORY = /(?:\bsource\s+(?:change|repair|work|file|files|code|branch|commit|patch|refactor|implementation)\b|\brepository\b|\brepo\b|\bcodebase\b|\bpull request\b|\bopen\s+(?:a\s+)?pr\b|\b(?:implement|implementation|refactor|patch|branch|commit)\s+(?:source|repository|repo|codebase|source\s+code)\b|\b(?:source|repository|repo|codebase)\s+(?:branch|commit|patch|refactor)\b|\bmodify\s+(?:source|repository|repo|codebase)\b)/i;
const CLOUD_CODEX = /(?:github\s+@codex|plain\s+@codex|default\s+linux|cloud\s+codex|linux\s+workspace)/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const WORK_SURFACE_ID = 'chatgpt-work';
const WORK_CAPABILITY = 'can_write_repo';
const WORK_KEYS = Object.freeze(['schemaVersion', 'receiptId', 'surfaceId', 'status', 'executionEligible', 'capabilities']);
const INVALID = Symbol('invalid-data-only-input');
const LIMITS = Object.freeze({ depth: 12, nodes: 2048, array: 256, keys: 64, string: 4096 });

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function record(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function list(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = '') {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return fallback;
  const normalized = `${value}`.trim();
  return normalized || fallback;
}
function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value).sort(cmp)) === JSON.stringify([...expected].sort(cmp));
}

function dataOnly(value, state = null, depth = 0) {
  const walk = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= LIMITS.string ? value : INVALID;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (!value || typeof value !== 'object' || depth > LIMITS.depth) return INVALID;
  walk.nodes += 1;
  if (walk.nodes > LIMITS.nodes || walk.seen.has(value)) return INVALID;
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return INVALID;
    if (isArray) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > LIMITS.array || descriptors.length?.get || descriptors.length?.set) return INVALID;
      const expected = new Set(['length', ...Array.from({ length }, (_, index) => `${index}`)]);
      if (keys.some((key) => !expected.has(key))) return INVALID;
      walk.seen.add(value);
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[`${index}`];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
        const normalized = dataOnly(descriptor.value, walk, depth + 1);
        if (normalized === INVALID) return INVALID;
        output.push(normalized);
      }
      walk.seen.delete(value);
      return Object.freeze(output);
    }
    if (keys.length > LIMITS.keys) return INVALID;
    walk.seen.add(value);
    const output = Object.create(null);
    for (const key of keys.sort(cmp)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return INVALID;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      const normalized = dataOnly(descriptor.value, walk, depth + 1);
      if (normalized === INVALID) return INVALID;
      Object.defineProperty(output, key, { value: normalized, enumerable: true, configurable: false, writable: false });
    }
    walk.seen.delete(value);
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function invalidRequirement() {
  return Object.freeze({
    inputValid: false,
    requiresLocalWindowsProof: false,
    requiresRepositoryWork: false,
    isMixedMission: false,
    requiredCapability: 'unknown',
    cloudCodexMentionRequested: false,
    evidenceTermsMatched: Object.freeze({ repository: '', localWindows: '' }),
  });
}

function classifySnapshot(snapshot) {
  const goal = record(snapshot.goal) ? snapshot.goal : snapshot;
  const capabilities = list(goal.requiredCapabilities);
  const haystack = [goal.title, goal.intent, goal.task, goal.description, goal.summary, ...capabilities,
    ...list(goal.requiredProofFamilies), ...list(goal.requestedProofCommands)]
    .filter((value) => ['string', 'number'].includes(typeof value)).join('\n');
  const local = WINDOWS.test(haystack) || capabilities.some((value) => text(value).toLowerCase() === 'can_local_windows_proof');
  const source = REPOSITORY.test(haystack) || capabilities.some((value) => text(value).toLowerCase() === WORK_CAPABILITY);
  return Object.freeze({
    inputValid: true,
    requiresLocalWindowsProof: local,
    requiresRepositoryWork: source,
    isMixedMission: local && source,
    requiredCapability: local && source ? 'can_write_repo+can_local_windows_proof' : local ? 'can_local_windows_proof' : 'can_write_repo',
    cloudCodexMentionRequested: CLOUD_CODEX.test(haystack),
    evidenceTermsMatched: Object.freeze({
      repository: source ? haystack.match(REPOSITORY)?.[0] || 'source-work' : '',
      localWindows: local ? haystack.match(WINDOWS)?.[0] || 'windows-runtime' : '',
    }),
  });
}

function windowsSurface(source = {}, defaults = {}) {
  const input = record(source) ? source : {};
  const platform = text(input.platform || input.os || input.executionEnvironment).toLowerCase();
  const receiptCandidate = text(input.surfaceReceipt || input.handshakeReceipt || input.capabilityReceipt || input.receiptId);
  const idCandidate = text(input.surfaceId || input.integrationId, defaults.surfaceId || 'battle-bridge-windows');
  return Object.freeze({
    surfaceId: SAFE_ID.test(idCandidate) ? idCandidate : defaults.surfaceId || 'battle-bridge-windows',
    surfaceClass: defaults.surfaceClass || 'BATTLE_BRIDGE_WINDOWS',
    attached: input.attached === true || input.sessionAttached === true || input.connected === true,
    platform,
    isWindows: platform === 'win32' || platform === 'windows' || platform.startsWith('windows-'),
    canLocalWindowsProof: input.canLocalWindowsProof === true || input.can_local_windows_proof === true || input.localWindowsProofReady === true,
    heartbeatFresh: input.heartbeatFresh === true || input.freshHeartbeat === true,
    surfaceReceipt: SAFE_ID.test(receiptCandidate) ? receiptCandidate : '',
  });
}

function remoteSurface(surfaces) {
  return windowsSurface(surfaces.remoteCodexBattleBridge || surfaces.battleBridgeWindows || surfaces.localWindowsProof || surfaces, {
    surfaceId: 'remote-codex-battle-bridge', surfaceClass: 'REMOTE_CODEX_BATTLE_BRIDGE',
  });
}

function openClawSurface(surfaces) {
  const source = surfaces.openClawLocal || surfaces.openclawLocal || surfaces.openClawBattleBridge || surfaces.openclawBattleBridge || {};
  const handshake = windowsSurface(source, { surfaceId: 'openclaw-local-battle-bridge', surfaceClass: 'OPENCLAW_LOCAL_BATTLE_BRIDGE' });
  let adjudication;
  try { adjudication = adjudicateOpenClawLocalAdapter(record(source) ? source : {}); }
  catch { adjudication = { adapterCanExecute: false, adapterReadiness: 'unknown', adapterBlockers: ['OpenClaw adjudication failed closed.'] }; }
  return Object.freeze({
    ...handshake,
    adapterCanExecute: adjudication?.adapterCanExecute === true,
    adapterReadiness: text(adjudication?.adapterReadiness, 'unknown'),
    adjudication,
  });
}

function workReceipt(receipt) {
  const empty = { structurallyValid: false, receiptId: '', surfaceId: '', status: '', capabilities: Object.freeze([]), executionEligible: false, schemaVersion: '' };
  if (!record(receipt) || !exactKeys(receipt, WORK_KEYS)) return Object.freeze(empty);
  const receiptId = typeof receipt.receiptId === 'string' && receipt.receiptId === receipt.receiptId.trim() ? receipt.receiptId : '';
  const surfaceId = typeof receipt.surfaceId === 'string' && receipt.surfaceId === receipt.surfaceId.trim() ? receipt.surfaceId : '';
  const status = typeof receipt.status === 'string' && receipt.status === receipt.status.trim() ? receipt.status.toUpperCase() : '';
  const capabilities = list(receipt.capabilities).map((value) => typeof value === 'string' && value === value.trim() ? value.toLowerCase() : '').filter(Boolean);
  const structurallyValid = receipt.schemaVersion === CHATGPT_WORK_CAPABILITY_RECEIPT_SCHEMA
    && SAFE_ID.test(receiptId) && surfaceId === WORK_SURFACE_ID && status === 'CURRENT'
    && receipt.executionEligible === true && capabilities.includes(WORK_CAPABILITY)
    && new Set(capabilities).size === capabilities.length;
  return Object.freeze({ structurallyValid, receiptId, surfaceId, status, capabilities: Object.freeze(capabilities), executionEligible: receipt.executionEligible === true, schemaVersion: text(receipt.schemaVersion) });
}

function workSurface(surfaces) {
  const source = record(surfaces.chatgptWork) ? surfaces.chatgptWork : record(surfaces.work) ? surfaces.work : {};
  const claimedSurfaceId = text(source.surfaceId || source.integrationId, WORK_SURFACE_ID);
  const capabilityReceipt = workReceipt(source.capabilityReceipt);
  return Object.freeze({
    surfaceId: WORK_SURFACE_ID,
    claimedSurfaceId,
    available: false,
    canRepositoryWork: false,
    capabilityReceiptId: capabilityReceipt.receiptId,
    capabilityReceipt,
    hostVerified: false,
    authorityStatus: 'CANONICAL_HOST_VERIFIER_UNAVAILABLE',
  });
}

function handshakeValid(surface) {
  return surface.attached && surface.isWindows && surface.canLocalWindowsProof && surface.heartbeatFresh && Boolean(surface.surfaceReceipt);
}
function sourceRoute(surfaces) {
  return Object.freeze({ selectedRoute: EXECUTION_SURFACE_ROUTE.CHATGPT_GITHUB_FIRST, routeReady: true, work: workSurface(surfaces) });
}
function localRoute(surfaces) {
  const openClaw = openClawSurface(surfaces);
  const remoteCodex = remoteSurface(surfaces);
  if (handshakeValid(openClaw) && openClaw.adapterCanExecute) return Object.freeze({ selectedRoute: EXECUTION_SURFACE_ROUTE.OPENCLAW_LOCAL_BATTLE_BRIDGE, routeReady: true, surface: openClaw, openClaw, remoteCodex, blocker: '' });
  if (handshakeValid(remoteCodex)) return Object.freeze({ selectedRoute: EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE, routeReady: true, surface: remoteCodex, openClaw, remoteCodex, blocker: '' });
  return Object.freeze({
    selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
    routeReady: false,
    surface: null,
    openClaw,
    remoteCodex,
    blocker: openClaw.attached || remoteCodex.attached ? EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH : EXECUTION_SURFACE_BLOCKER.BATTLE_BRIDGE_NOT_ATTACHED,
  });
}

function invalidRoute(requirement = invalidRequirement()) {
  return Object.freeze({
    schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
    requirement,
    selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
    selectedRoutes: Object.freeze([]),
    sourceRoute: EXECUTION_SURFACE_ROUTE.NONE,
    localRoute: EXECUTION_SURFACE_ROUTE.NONE,
    routeReady: false,
    missionReady: false,
    sourceSubtaskReady: false,
    localSubtaskReady: false,
    partialProgressAllowed: false,
    dispatchAllowed: false,
    cloudFallbackAllowed: false,
    forbiddenRoutes: Object.freeze([]),
    work: workSurface({}),
    battleBridge: null,
    localSurfaces: Object.freeze({ openClaw: null, remoteCodex: null }),
    blocker: EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH,
    exactNextAction: 'Supply one canonical data-only mission and surface projection before routing.',
    finalVerdict: EXECUTION_SURFACE_BLOCKER.ROUTE_CAPABILITY_MISMATCH,
  });
}

function routeResult(requirement, source, local, overrides) {
  return Object.freeze({
    schemaVersion: EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
    requirement,
    selectedRoute: EXECUTION_SURFACE_ROUTE.NONE,
    selectedRoutes: Object.freeze([]),
    sourceRoute: EXECUTION_SURFACE_ROUTE.NONE,
    localRoute: EXECUTION_SURFACE_ROUTE.NONE,
    routeReady: false,
    missionReady: false,
    sourceSubtaskReady: false,
    localSubtaskReady: false,
    partialProgressAllowed: false,
    dispatchAllowed: false,
    cloudFallbackAllowed: false,
    forbiddenRoutes: requirement.requiresLocalWindowsProof ? Object.freeze(['GITHUB_CODEX_MENTION', 'DEFAULT_LINUX_CODEX_WORKSPACE']) : Object.freeze([]),
    work: source.work,
    battleBridge: null,
    localSurfaces: Object.freeze({ openClaw: local.openClaw, remoteCodex: local.remoteCodex }),
    blocker: '',
    exactNextAction: '',
    finalVerdict: '',
    ...overrides,
  });
}

export function classifyExecutionSurfaceRequirement(input = {}) {
  const snapshot = dataOnly(input);
  return snapshot === INVALID || !record(snapshot) ? invalidRequirement() : classifySnapshot(snapshot);
}

export function buildExecutionSurfaceRouteV1(input = {}, _callerHost = {}) {
  const snapshot = dataOnly(input);
  if (snapshot === INVALID || !record(snapshot)) return invalidRoute();
  const enveloped = Object.hasOwn(snapshot, 'goal') || Object.hasOwn(snapshot, 'surfaces');
  const goal = enveloped ? (record(snapshot.goal) ? snapshot.goal : {}) : snapshot;
  const surfaces = enveloped && record(snapshot.surfaces) ? snapshot.surfaces : {};
  const requirement = classifySnapshot(goal);
  const source = sourceRoute(surfaces);
  const local = localRoute(surfaces);

  if (requirement.isMixedMission && local.routeReady) return routeResult(requirement, source, local, {
    selectedRoute: EXECUTION_SURFACE_ROUTE.MIXED_WORK_AND_LOCAL,
    selectedRoutes: Object.freeze([source.selectedRoute, local.selectedRoute]),
    sourceRoute: source.selectedRoute,
    localRoute: local.selectedRoute,
    routeReady: true,
    missionReady: true,
    sourceSubtaskReady: true,
    localSubtaskReady: true,
    partialProgressAllowed: true,
    dispatchAllowed: true,
    battleBridge: local.surface,
    exactNextAction: `Continue repository work through ${source.selectedRoute}; route only the Windows/runtime subtask through ${local.selectedRoute}. Preserve one mission identity and reconcile both receipts before completion.`,
    finalVerdict: 'EXECUTION_SURFACE_MIXED_ROUTE_READY',
  });

  if (requirement.isMixedMission) return routeResult(requirement, source, local, {
    selectedRoute: source.selectedRoute,
    selectedRoutes: Object.freeze([source.selectedRoute]),
    sourceRoute: source.selectedRoute,
    routeReady: true,
    sourceSubtaskReady: true,
    partialProgressAllowed: true,
    blocker: EXECUTION_SURFACE_BLOCKER.LOCAL_SUBTASK_PENDING,
    localBlocker: local.blocker,
    exactNextAction: `Continue the repository/source phase through ${source.selectedRoute}. Keep the Windows/runtime phase pending and recover an authorised OpenClaw Local or Remote Codex Battle Bridge handshake in parallel; do not report the whole mission as unable to proceed and do not substitute plain GitHub @codex.`,
    finalVerdict: 'EXECUTION_SURFACE_PARTIAL_ROUTE_READY',
  });

  if (requirement.requiresLocalWindowsProof && !local.routeReady) return routeResult(requirement, source, local, {
    blocker: local.blocker,
    exactNextAction: 'Attach a canonically adjudicated OpenClaw Local or verified Remote Codex Battle Bridge Windows surface before dispatch. Do not use a plain GitHub @codex mention.',
    finalVerdict: local.blocker,
  });

  if (requirement.requiresLocalWindowsProof) return routeResult(requirement, source, local, {
    selectedRoute: local.selectedRoute,
    selectedRoutes: Object.freeze([local.selectedRoute]),
    localRoute: local.selectedRoute,
    routeReady: true,
    missionReady: true,
    localSubtaskReady: true,
    dispatchAllowed: true,
    battleBridge: local.surface,
    exactNextAction: `Dispatch exactly one bounded local task through ${local.selectedRoute} and require a real task receipt plus heartbeat.`,
    finalVerdict: 'EXECUTION_SURFACE_ROUTE_READY',
  });

  return routeResult(requirement, source, local, {
    selectedRoute: source.selectedRoute,
    selectedRoutes: Object.freeze([source.selectedRoute]),
    sourceRoute: source.selectedRoute,
    routeReady: true,
    missionReady: true,
    sourceSubtaskReady: true,
    exactNextAction: 'Use ChatGPT plus GitHub for source work. ChatGPT Work evidence remains visible but unadjudicated until a separately governed canonical host verifier exists.',
    finalVerdict: 'EXECUTION_SURFACE_ROUTE_READY',
  });
}

export function assertExecutionSurfaceRouteV1(input = {}, callerHost = {}) {
  const route = buildExecutionSurfaceRouteV1(input, callerHost);
  if (!route.routeReady) {
    const error = new Error(route.blocker);
    error.code = route.blocker;
    error.route = route;
    throw error;
  }
  return route;
}
