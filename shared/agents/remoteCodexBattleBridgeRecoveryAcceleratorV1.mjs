import {
  CODEX_CAPACITY_DECISION,
  CODEX_ROUTE,
  CODEX_TASK_CLASS,
} from './codexCapacityGovernorV1.mjs';
import { createMeterAwareDispatchDecision } from './meterAwareCodexDispatcher.mjs';
import {
  EXECUTION_SURFACE_ROUTE,
  buildExecutionSurfaceRouteV1,
} from './executionSurfaceRoutingPolicyV1.mjs';
import { buildRemoteCodexDispatchCall } from './remoteCodexBattleBridgeHandoffV1.mjs';

export const REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA = 'stephanos.remote-codex-battle-bridge-recovery-accelerator.v1';

export const REMOTE_CODEX_RECOVERY_TASK_CLASS = Object.freeze({
  SOURCE_REPAIR: 'SOURCE_REPAIR',
  WINDOWS_RUNTIME_DIAGNOSIS: 'WINDOWS_RUNTIME_DIAGNOSIS',
  WINDOWS_RUNTIME_PROOF: 'WINDOWS_RUNTIME_PROOF',
  RECOVERY_COORDINATION: 'RECOVERY_COORDINATION',
});

export const REMOTE_CODEX_RECOVERY_ROUTE = Object.freeze({
  CHATGPT_GITHUB_FIRST: 'CHATGPT_GITHUB_FIRST',
  REMOTE_CODEX_BATTLE_BRIDGE: 'REMOTE_CODEX_BATTLE_BRIDGE',
  OPENCLAW_OR_LIFEBOAT: 'OPENCLAW_OR_LIFEBOAT',
  BLOCKED: 'BLOCKED',
});

const WINDOWS_TASKS = new Set([
  REMOTE_CODEX_RECOVERY_TASK_CLASS.WINDOWS_RUNTIME_DIAGNOSIS,
  REMOTE_CODEX_RECOVERY_TASK_CLASS.WINDOWS_RUNTIME_PROOF,
  REMOTE_CODEX_RECOVERY_TASK_CLASS.RECOVERY_COORDINATION,
]);
const TOP_LEVEL_FIELDS = new Set([
  'missionId',
  'taskId',
  'taskClass',
  'title',
  'queueRecord',
  'capacityProjection',
  'handoff',
  'attachment',
  'nowUtc',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const MAX_DEPTH = 12;
const MAX_NODES = 2000;
const MAX_STRING = 12000;

function blocked(blocker, details = {}) {
  return Object.freeze({
    schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
    ok: false,
    routeReady: false,
    dispatchAllowed: false,
    selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.BLOCKED,
    blocker,
    remoteCodexOptional: true,
    missionMustSurviveProviderLoss: true,
    duplicateDispatchAllowed: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    credentialAccessAllowed: false,
    pcRestartAllowed: false,
    ...details,
  });
}

function captureData(value, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('RECOVERY_ACCELERATOR_INPUT_BOUNDS_EXCEEDED');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('RECOVERY_ACCELERATOR_INPUT_NONFINITE');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new Error('RECOVERY_ACCELERATOR_INPUT_STRING_TOO_LARGE');
    return value;
  }
  if (typeof value !== 'object') throw new Error('RECOVERY_ACCELERATOR_INPUT_TYPE_INVALID');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('RECOVERY_ACCELERATOR_INPUT_SYMBOL_INVALID');
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype) throw new Error('RECOVERY_ACCELERATOR_INPUT_ARRAY_PROTO_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 256) throw new Error('RECOVERY_ACCELERATOR_INPUT_ARRAY_INVALID');
    const out = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('RECOVERY_ACCELERATOR_INPUT_SPARSE_ARRAY');
      out.push(captureData(descriptor.value, depth + 1, state));
    }
    return out;
  }
  if (proto !== Object.prototype && proto !== null) throw new Error('RECOVERY_ACCELERATOR_INPUT_OBJECT_PROTO_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length > 128) throw new Error('RECOVERY_ACCELERATOR_INPUT_OBJECT_TOO_WIDE');
  const out = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('RECOVERY_ACCELERATOR_INPUT_ACCESSOR_INVALID');
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('RECOVERY_ACCELERATOR_INPUT_RESERVED_KEY');
    out[key] = captureData(descriptor.value, depth + 1, state);
  }
  return out;
}

function normalizeInput(input) {
  let captured;
  try {
    captured = captureData(input);
  } catch (error) {
    return blocked(error instanceof Error ? error.message : 'RECOVERY_ACCELERATOR_INPUT_INVALID');
  }
  const unexpected = Object.keys(captured).find((key) => !TOP_LEVEL_FIELDS.has(key));
  if (unexpected) return blocked('RECOVERY_ACCELERATOR_UNEXPECTED_FIELD', { unexpectedField: unexpected });
  if (!ID.test(String(captured.missionId || '')) || !ID.test(String(captured.taskId || ''))) {
    return blocked('RECOVERY_ACCELERATOR_ID_INVALID');
  }
  if (!Object.values(REMOTE_CODEX_RECOVERY_TASK_CLASS).includes(captured.taskClass)) {
    return blocked('RECOVERY_ACCELERATOR_TASK_CLASS_INVALID');
  }
  if (typeof captured.title !== 'string' || captured.title.trim() !== captured.title || captured.title.length < 12 || captured.title.length > 500) {
    return blocked('RECOVERY_ACCELERATOR_TITLE_INVALID');
  }
  const nowMs = Date.parse(String(captured.nowUtc || ''));
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== captured.nowUtc) {
    return blocked('RECOVERY_ACCELERATOR_NOW_INVALID');
  }
  return Object.freeze({ ok: true, input: captured, now: new Date(nowMs) });
}

function zeroAuthority(base = {}) {
  return Object.freeze({
    ...base,
    remoteCodexOptional: true,
    missionMustSurviveProviderLoss: true,
    duplicateDispatchAllowed: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    credentialAccessAllowed: false,
    pcRestartAllowed: false,
    freshTaskReceiptRequired: true,
    exactHeadProofRequired: true,
  });
}

export function planRemoteCodexBattleBridgeRecoveryAccelerationV1(input = {}) {
  const normalized = normalizeInput(input);
  if (!normalized.ok) return normalized;
  const request = normalized.input;

  if (request.taskClass === REMOTE_CODEX_RECOVERY_TASK_CLASS.SOURCE_REPAIR) {
    return zeroAuthority({
      schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
      ok: true,
      routeReady: true,
      dispatchAllowed: false,
      selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.CHATGPT_GITHUB_FIRST,
      missionId: request.missionId,
      taskId: request.taskId,
      taskClass: request.taskClass,
      blocker: '',
      capacityDecision: null,
      surfaceVerdict: null,
      dispatchCall: null,
      exactNextAction: 'Use the existing GitHub-first source writer for the bounded repair; preserve Remote Codex capacity for Windows/runtime work.',
      finalVerdict: 'RECOVERY_SOURCE_REPAIR_ROUTED_GITHUB_FIRST',
    });
  }

  const meterDecision = createMeterAwareDispatchDecision({
    queueRecord: request.queueRecord || {},
    capacityProjection: request.capacityProjection || {},
    taskProfile: {
      taskClass: CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF,
      capabilityValue: 95,
      complexityMultiplier: request.taskClass === REMOTE_CODEX_RECOVERY_TASK_CLASS.RECOVERY_COORDINATION ? 1.2 : 1,
      urgent: true,
      zeroCostCapable: false,
      battleBridgeCapable: true,
      preferredRoute: CODEX_ROUTE.CODEX,
    },
  });

  if (meterDecision.decision !== CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED
      || meterDecision.state !== 'READY_FOR_CODEX') {
    return zeroAuthority({
      schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
      ok: true,
      routeReady: true,
      dispatchAllowed: false,
      selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT,
      missionId: request.missionId,
      taskId: request.taskId,
      taskClass: request.taskClass,
      blocker: meterDecision.decision || 'CODEX_CAPACITY_UNAVAILABLE',
      capacityDecision: meterDecision,
      surfaceVerdict: null,
      dispatchCall: null,
      exactNextAction: 'Keep the same recovery mission alive through OpenClaw, the independent lifeboat, or another already-qualified route; retry Remote Codex only after fresh capacity evidence.',
      finalVerdict: 'REMOTE_CODEX_RECOVERY_CAPACITY_UNAVAILABLE_FALLBACK_REQUIRED',
    });
  }

  const dispatchCall = buildRemoteCodexDispatchCall(request.handoff, request.attachment, { now: normalized.now });
  if (!dispatchCall.ok) {
    return zeroAuthority({
      schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
      ok: true,
      routeReady: true,
      dispatchAllowed: false,
      selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT,
      missionId: request.missionId,
      taskId: request.taskId,
      taskClass: request.taskClass,
      blocker: dispatchCall.blocker || 'REMOTE_CODEX_BATTLE_BRIDGE_NOT_READY',
      capacityDecision: meterDecision,
      surfaceVerdict: dispatchCall,
      dispatchCall: null,
      exactNextAction: 'Do not dispatch Remote Codex. Continue the same mission through another qualified route and repair or refresh the Remote Codex Windows attachment separately.',
      finalVerdict: 'REMOTE_CODEX_RECOVERY_ATTACHMENT_UNAVAILABLE_FALLBACK_REQUIRED',
    });
  }

  const surfaceRoute = buildExecutionSurfaceRouteV1({
    goal: {
      title: request.title,
      task: request.title,
      requiredCapabilities: ['Battle Bridge Windows runtime proof'],
    },
    surfaces: {
      remoteCodexBattleBridge: {
        surfaceId: request.attachment.surfaceId,
        attached: request.attachment.attached,
        platform: request.attachment.platform,
        canLocalWindowsProof: request.attachment.can_local_windows_proof,
        heartbeatFresh: true,
        surfaceReceipt: request.attachment.surfaceReceipt,
      },
    },
  });
  if (!surfaceRoute.routeReady || surfaceRoute.selectedRoute !== EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE) {
    return zeroAuthority({
      schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
      ok: true,
      routeReady: true,
      dispatchAllowed: false,
      selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.OPENCLAW_OR_LIFEBOAT,
      missionId: request.missionId,
      taskId: request.taskId,
      taskClass: request.taskClass,
      blocker: surfaceRoute.blocker || 'REMOTE_CODEX_SURFACE_POLICY_REJECTED',
      capacityDecision: meterDecision,
      surfaceVerdict: surfaceRoute,
      dispatchCall: null,
      exactNextAction: 'Preserve the mission and use another qualified recovery route; do not substitute GitHub @codex or a default Linux workspace.',
      finalVerdict: 'REMOTE_CODEX_RECOVERY_SURFACE_POLICY_REJECTED',
    });
  }

  return zeroAuthority({
    schemaVersion: REMOTE_CODEX_RECOVERY_ACCELERATOR_SCHEMA,
    ok: true,
    routeReady: true,
    dispatchAllowed: true,
    selectedRoute: REMOTE_CODEX_RECOVERY_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE,
    missionId: request.missionId,
    taskId: request.taskId,
    taskClass: request.taskClass,
    blocker: '',
    capacityDecision: meterDecision,
    surfaceVerdict: surfaceRoute,
    dispatchCall,
    githubAtCodexFallbackAllowed: false,
    defaultLinuxCodexFallbackAllowed: false,
    exactNextAction: 'Invoke the existing automated Codex dispatcher exactly once with the prepared dispatch call, then require canonical accepted/started/heartbeat/terminal receipts before progression.',
    finalVerdict: 'REMOTE_CODEX_BATTLE_BRIDGE_RECOVERY_ACCELERATOR_READY',
  });
}
