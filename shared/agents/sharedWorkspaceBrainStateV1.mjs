import {
  createSharedWorkspaceStatusRecord,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig } from './sharedWorkspaceRuntimeConfig.mjs';

export const SHARED_WORKSPACE_BRAIN_STATE_SCHEMA = 'stephanos.shared-workspace.brain-state.v1';
export const SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID = 'brain-state-current';
export const SHARED_WORKSPACE_BRAIN_STATE_FILE = 'brain-state-current.json';
export const SHARED_WORKSPACE_BRAIN_STATE_RELATED_ISSUE = '#1556';
export const DEFAULT_BRAIN_STATE_STALE_AFTER_MS = 5 * 60 * 1000;
export const DEFAULT_BRAIN_STATE_MAX_FUTURE_SKEW_MS = 60 * 1000;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function boolOrUnknown(value) {
  return typeof value === 'boolean' ? value : 'UNKNOWN';
}

function timestamp(value) {
  const normalized = text(value);
  return Number.isFinite(Date.parse(normalized)) ? normalized : '';
}

function zeroAuthority() {
  return Object.freeze({
    providerSelectionAuthorityAdded: false,
    sourceMutationAllowed: false,
    runtimeMutationAllowed: false,
    mergeAuthority: false,
  });
}

export function buildSharedWorkspaceBrainStateV1({
  executionMetadata = {},
  timestampUtc = new Date().toISOString(),
  taskRoute = 'assistant',
  participantTarget = 'everyone',
} = {}) {
  const observedAtUtc = timestamp(timestampUtc);
  if (!observedAtUtc) throw new Error('Brain state requires a valid timestampUtc.');

  const executedBrain = text(
    executionMetadata.executed_model
      || executionMetadata.model_used
      || executionMetadata.ollama_model_selected,
    'UNKNOWN',
  );
  const provider = text(
    executionMetadata.actual_provider_used
      || executionMetadata.selected_provider,
    'UNKNOWN',
  );
  const providerAnswered = executionMetadata.provider_answered === true;
  const status = executedBrain === 'UNKNOWN'
    ? 'UNKNOWN'
    : (providerAnswered ? 'READY' : 'DEGRADED');
  const escalationActive = executionMetadata.ollama_escalation_active === true;
  const fallbackUsed = executionMetadata.fallback_used === true
    || executionMetadata.ollama_fallback_model_used === true;

  return Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
      participantId: 'stephanos-brain-router',
      timestampUtc: observedAtUtc,
      relatedIssue: SHARED_WORKSPACE_BRAIN_STATE_RELATED_ISSUE,
      status,
      summary: `Stephanos brain state: ${executedBrain} via ${provider}; reasoning=${text(executionMetadata.ollama_reasoning_mode, 'unknown')}; escalation=${escalationActive ? 'active' : 'inactive'}.`,
      proofRefs: ['proof/brain-state-current'],
    }),
    brainStateSchemaVersion: SHARED_WORKSPACE_BRAIN_STATE_SCHEMA,
    observedAtUtc,
    provider,
    defaultBrain: text(executionMetadata.ollama_model_default, 'UNKNOWN'),
    preferredBrain: text(executionMetadata.ollama_model_preferred, 'UNKNOWN'),
    requestedBrain: text(executionMetadata.requested_model || executionMetadata.ollama_model_requested, 'UNKNOWN'),
    selectedBrain: text(executionMetadata.selected_model || executionMetadata.ollama_model_selected, 'UNKNOWN'),
    executedBrain,
    reasoningMode: text(executionMetadata.ollama_reasoning_mode, 'unknown'),
    modelSelectionReason: text(executionMetadata.model_selection_reason, 'unknown'),
    escalationActive,
    escalationBrain: text(executionMetadata.ollama_escalation_model || executionMetadata.escalation_model, 'NONE'),
    escalationReason: text(executionMetadata.ollama_escalation_reason || executionMetadata.escalation_reason, 'none'),
    fallbackUsed,
    fallbackBrain: text(executionMetadata.ollama_fallback_model || executionMetadata.fallback_provider_used, 'NONE'),
    fallbackReason: text(executionMetadata.ollama_fallback_reason || executionMetadata.fallback_reason, 'none'),
    loadMode: text(executionMetadata.ollama_load_mode, 'unknown'),
    loadPolicyApplied: executionMetadata.ollama_load_policy_applied === true,
    loadPolicyReason: text(executionMetadata.ollama_load_policy_reason, 'none'),
    heavyModelRequested: boolOrUnknown(executionMetadata.ollama_heavy_model_requested),
    heavyModelAllowed: boolOrUnknown(executionMetadata.ollama_heavy_model_allowed),
    providerAnswered,
    taskRoute: text(taskRoute, 'assistant'),
    participantTarget: text(participantTarget, 'everyone'),
    health: status,
    readOnly: true,
    authority: zeroAuthority(),
  });
}

export function projectSharedWorkspaceBrainStateV1({
  statusRecords = [],
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_BRAIN_STATE_STALE_AFTER_MS,
  maxFutureSkewMs = DEFAULT_BRAIN_STATE_MAX_FUTURE_SKEW_MS,
} = {}) {
  const candidates = (Array.isArray(statusRecords) ? statusRecords : [])
    .filter((record) => (
      record?.brainStateSchemaVersion === SHARED_WORKSPACE_BRAIN_STATE_SCHEMA
      && record?.statusId === SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID
      && record?.participantId === 'stephanos-brain-router'
    ))
    .filter((record) => validateSharedWorkspaceRecord(record, {
      nowMs,
      staleAfterMs: Number.MAX_SAFE_INTEGER,
    }).valid)
    .sort((left, right) => Date.parse(right.timestampUtc) - Date.parse(left.timestampUtc));

  const record = candidates[0] || null;
  if (!record) {
    return Object.freeze({
      schemaVersion: SHARED_WORKSPACE_BRAIN_STATE_SCHEMA,
      state: 'UNKNOWN',
      reason: 'BRAIN_STATE_NOT_PUBLISHED',
      record: null,
      activeBrain: 'UNKNOWN',
      authority: zeroAuthority(),
    });
  }

  const observedMs = Date.parse(record.timestampUtc);
  const futureDated = Number.isFinite(observedMs) && observedMs - nowMs > maxFutureSkewMs;
  const stale = !Number.isFinite(observedMs)
    || futureDated
    || Math.max(0, nowMs - observedMs) > staleAfterMs;
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_BRAIN_STATE_SCHEMA,
    state: stale ? 'STALE' : 'CURRENT',
    reason: futureDated
      ? 'BRAIN_STATE_FUTURE_DATED'
      : (stale ? 'BRAIN_STATE_STALE' : 'BRAIN_STATE_CURRENT'),
    record: stale && futureDated ? null : record,
    activeBrain: stale && futureDated ? 'UNKNOWN' : text(record.executedBrain, 'UNKNOWN'),
    provider: stale && futureDated ? 'UNKNOWN' : text(record.provider, 'UNKNOWN'),
    reasoningMode: stale && futureDated ? 'unknown' : text(record.reasoningMode, 'unknown'),
    escalationActive: stale && futureDated ? false : record.escalationActive === true,
    fallbackUsed: stale && futureDated ? false : record.fallbackUsed === true,
    loadMode: stale && futureDated ? 'unknown' : text(record.loadMode, 'unknown'),
    heavyModelAllowed: stale && futureDated ? 'UNKNOWN' : record.heavyModelAllowed,
    authority: zeroAuthority(),
  });
}

export async function publishSharedWorkspaceBrainStateV1({
  executionMetadata = {},
  timestampUtc = new Date().toISOString(),
  taskRoute = 'assistant',
  participantTarget = 'everyone',
  repoRoot = process.cwd(),
  env = process.env,
  validateWorkspaceFn = validateExistingSharedWorkspaceRuntimeConfig,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const runtime = await validateWorkspaceFn({ repoRoot, env });
  if (!runtime?.ok || !runtime.root) {
    return Object.freeze({
      ok: false,
      reason: runtime?.reason || 'SHARED_WORKSPACE_UNAVAILABLE',
      statusId: SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
      record: null,
    });
  }

  let record;
  try {
    record = buildSharedWorkspaceBrainStateV1({
      executionMetadata,
      timestampUtc,
      taskRoute,
      participantTarget,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.message || 'BRAIN_STATE_BUILD_FAILED',
      statusId: SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
      record: null,
    });
  }

  try {
    const write = await writeAtomicJsonFn(
      runtime.root,
      ['status', SHARED_WORKSPACE_BRAIN_STATE_FILE],
      record,
      {
        repoRoot,
        nowMs: Date.parse(timestampUtc),
        staleAfterMs: Number.MAX_SAFE_INTEGER,
      },
    );
    return Object.freeze({
      ok: write?.ok === true,
      reason: write?.reason || 'BRAIN_STATE_PUBLICATION_FAILED',
      statusId: SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
      path: write?.path || '',
      record,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error?.code || error?.message || 'BRAIN_STATE_PUBLICATION_FAILED',
      statusId: SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
      path: '',
      record,
    });
  }
}
