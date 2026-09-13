import {
  readCodexBankedResetStatusOnBattleBridge,
} from './codexBankedResetStatusBattleBridgeReader.mjs';
import {
  publishCodexCapacityToSharedWorkspace,
} from './codexCapacitySharedWorkspace.mjs';

export const BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA =
  'stephanos.battle-bridge-codex-capacity-refresh.v1';
export const BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
export const BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_REQUEST_TTL_MS = 2 * 60 * 1000;

const SHA_40 = /^[0-9a-f]{40}$/i;
const SAFE_REASON = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;
const SAFE_PROOF_REF = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const TRUTH_STATES = new Set(['CURRENT', 'STALE', 'UNKNOWN']);

function ownValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(value) {
  const milliseconds = Date.parse(typeof value === 'string' ? value : '');
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function reason(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return SAFE_REASON.test(normalized) ? normalized : fallback;
}

function proofRefs(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const refs = [];
  const length = Number(ownValue(value, 'length'));
  for (let index = 0; index < Math.min(Number.isSafeInteger(length) && length >= 0 ? length : 0, 24); index += 1) {
    const item = ownValue(value, String(index));
    const normalized = typeof item === 'string' ? item.trim() : '';
    if (SAFE_PROOF_REF.test(normalized) && !normalized.split('/').includes('..')) refs.push(normalized);
  }
  return Object.freeze([...new Set(refs)].slice(0, 12));
}

function fixedRequestId(nowUtc) {
  return `codex-capacity-refresh-${nowUtc.replace(/[^0-9]/g, '')}`;
}

function checkpoint({
  nowUtc,
  nextEligibleAtUtc,
  sourceHead,
  finalVerdict,
  blocker = '',
  published = false,
  truthState = 'UNKNOWN',
  capacityUsable = false,
}) {
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
    lastAttemptAtUtc: nowUtc,
    nextEligibleAtUtc,
    sourceHead,
    finalVerdict,
    blocker,
    published,
    truthState,
    capacityUsable,
    readOnly: true,
    resetAuthority: false,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
}

function blocked(blocker, additions = {}) {
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
    ok: false,
    attempted: additions.attempted === true,
    publicationAttempted: additions.publicationAttempted === true,
    blocker,
    finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_BLOCKED',
    capacityUsable: false,
    truthState: 'UNKNOWN',
    checkpoint: additions.checkpoint ?? null,
    readOnly: true,
    resetAuthority: false,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
}

function usablePriorCheckpoint(value, nowMs) {
  if (ownValue(value, 'schemaVersion') !== BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA) return null;
  const lastAttemptAtUtc = timestamp(ownValue(value, 'lastAttemptAtUtc'));
  const nextEligibleAtUtc = timestamp(ownValue(value, 'nextEligibleAtUtc'));
  const sourceHead = stringValue(ownValue(value, 'sourceHead')).toLowerCase();
  const lastAttemptMs = Date.parse(lastAttemptAtUtc);
  const nextEligibleMs = Date.parse(nextEligibleAtUtc);
  if (!lastAttemptAtUtc || !nextEligibleAtUtc || !SHA_40.test(sourceHead)
    || lastAttemptMs > nowMs || nextEligibleMs < lastAttemptMs) return null;
  return Object.freeze({ lastAttemptAtUtc, nextEligibleAtUtc, nextEligibleMs, sourceHead });
}

function resolveDependency(deps, key, fallback) {
  const injected = ownValue(deps, key);
  if (injected === undefined) return fallback;
  return typeof injected === 'function' ? injected : null;
}

export async function refreshBattleBridgeCodexCapacity(input = {}, deps = {}) {
  const nowUtc = timestamp(ownValue(input, 'nowUtc'));
  const nowMs = Date.parse(nowUtc);
  if (!nowUtc) return blocked('CODEX_CAPACITY_REFRESH_TIME_INVALID');
  const sourceIdentity = ownValue(input, 'sourceIdentity');
  const sourceHead = stringValue(ownValue(sourceIdentity, 'sourceHead')).toLowerCase();
  if (ownValue(sourceIdentity, 'ok') !== true
    || ownValue(sourceIdentity, 'branch') !== 'main'
    || !SHA_40.test(sourceHead)) {
    return blocked('CODEX_CAPACITY_REFRESH_SOURCE_IDENTITY_INVALID');
  }
  const prior = usablePriorCheckpoint(ownValue(input, 'checkpoint'), nowMs);
  if (prior && prior.sourceHead === sourceHead && prior.nextEligibleMs > nowMs) {
    const normalizedCheckpoint = checkpoint({
      nowUtc: prior.lastAttemptAtUtc,
      nextEligibleAtUtc: prior.nextEligibleAtUtc,
      sourceHead,
      finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_COOLDOWN',
    });
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
      ok: true,
      attempted: false,
      publicationAttempted: false,
      blocker: '',
      finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_COOLDOWN',
      capacityUsable: false,
      truthState: 'UNKNOWN',
      nextEligibleAtUtc: prior.nextEligibleAtUtc,
      checkpoint: normalizedCheckpoint,
      readOnly: true,
      resetAuthority: false,
      dispatchAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
    });
  }
  const readStatus = resolveDependency(deps, 'readStatus', readCodexBankedResetStatusOnBattleBridge);
  const publishCapacity = resolveDependency(deps, 'publishCapacity', publishCodexCapacityToSharedWorkspace);
  if (!readStatus || !publishCapacity) return blocked('CODEX_CAPACITY_REFRESH_DEPENDENCY_INVALID');
  const nextEligibleAtUtc = new Date(nowMs + BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_INTERVAL_MS).toISOString();
  const requestId = fixedRequestId(nowUtc);
  const command = Object.freeze({
    operation: 'READ_CODEX_BANKED_RESET_STATUS',
    requestId,
    expectedHead: sourceHead,
    expiresAt: new Date(nowMs + BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_REQUEST_TTL_MS).toISOString(),
  });
  let status;
  try {
    status = await readStatus(command, {
      now: new Date(nowMs),
      repoRoot: stringValue(ownValue(input, 'repoRoot')),
    });
  } catch {
    status = null;
  }
  const statusBlocker = reason(ownValue(status, 'blocker'), 'CODEX_CAPACITY_REFRESH_READER_INVALID');
  const observedAtUtc = timestamp(ownValue(status, 'observedAtUtc'));
  const readerValid = ownValue(status, 'ok') === true
    && ownValue(status, 'finalVerdict') === 'CODEX_BANKED_RESET_STATUS_READY'
    && ownValue(status, 'requestId') === requestId
    && Boolean(observedAtUtc)
    && ownValue(status, 'usageSurfaceMatched') === true
    && ownValue(status, 'readOnly') === true
    && ownValue(status, 'pressAttempted') === false
    && ownValue(status, 'pressCount') === 0
    && ownValue(status, 'arbitraryShellAllowed') === false
    && ownValue(status, 'arbitraryBrowserAutomationAllowed') === false
    && ownValue(status, 'credentialsMayBeReadOrExported') === false;
  if (!readerValid) {
    const refreshCheckpoint = checkpoint({
      nowUtc,
      nextEligibleAtUtc,
      sourceHead,
      finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_READER_BLOCKED',
      blocker: statusBlocker,
    });
    return blocked(statusBlocker, { attempted: true, checkpoint: refreshCheckpoint });
  }
  const rawRemainingPercent = ownValue(status, 'remainingPercent');
  const remainingPercent = typeof rawRemainingPercent === 'number'
    && Number.isFinite(rawRemainingPercent)
    && rawRemainingPercent >= 0
    && rawRemainingPercent <= 100
    ? rawRemainingPercent
    : undefined;
  const safeStatusResult = Object.freeze({
    ok: true,
    blocker: '',
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
    requestId,
    observedAtUtc,
    meterSummary: typeof ownValue(status, 'meterSummary') === 'string'
      ? ownValue(status, 'meterSummary').slice(0, 300)
      : '',
    remainingPercent,
    usageSurfaceMatched: true,
    activeCodexTask: ownValue(status, 'activeCodexTask') === true,
    readOnly: true,
    pressAttempted: false,
    pressCount: 0,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    proofRefs: proofRefs(ownValue(status, 'proofRefs')),
  });
  let publication;
  try {
    publication = await publishCapacity(stringValue(ownValue(input, 'workspaceRoot')), {
      statusResult: safeStatusResult,
      timestampUtc: nowUtc,
      proofRefs: safeStatusResult.proofRefs,
    }, {
      repoRoot: stringValue(ownValue(input, 'repoRoot')),
      nowMs,
    });
  } catch {
    publication = null;
  }
  const slice = ownValue(publication, 'slice');
  const truthState = stringValue(ownValue(slice, 'truthState')).toUpperCase();
  const publicationValid = ownValue(publication, 'ok') === true
    && ownValue(publication, 'finalVerdict') === 'CODEX_CAPACITY_WORKSPACE_PUBLISH_PASS'
    && ownValue(slice, 'schemaVersion') === 'stephanos.codex-capacity-workspace.v1'
    && ownValue(slice, 'timestampUtc') === nowUtc
    && TRUTH_STATES.has(truthState)
    && ownValue(slice, 'rawUiTextPublished') === false
    && ownValue(slice, 'dispatchAllowed') === false
    && ownValue(slice, 'sourceMutationAllowed') === false
    && ownValue(slice, 'mergeAuthority') === false;
  if (!publicationValid) {
    const publicationBlocker = ownValue(publication, 'ok') === true
      ? 'CODEX_CAPACITY_REFRESH_PUBLICATION_INVALID'
      : reason(ownValue(publication, 'reason'), 'CODEX_CAPACITY_REFRESH_PUBLICATION_INVALID');
    const refreshCheckpoint = checkpoint({
      nowUtc,
      nextEligibleAtUtc,
      sourceHead,
      finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_PUBLICATION_BLOCKED',
      blocker: publicationBlocker,
    });
    return blocked(publicationBlocker, {
      attempted: true,
      publicationAttempted: true,
      checkpoint: refreshCheckpoint,
    });
  }
  const capacityUsable = truthState === 'CURRENT' && ownValue(slice, 'capacityUsable') === true;
  const refreshCheckpoint = checkpoint({
    nowUtc,
    nextEligibleAtUtc,
    sourceHead,
    finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_PUBLISHED',
    published: true,
    truthState,
    capacityUsable,
  });
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_SCHEMA,
    ok: true,
    attempted: true,
    publicationAttempted: true,
    blocker: '',
    finalVerdict: 'BATTLE_BRIDGE_CODEX_CAPACITY_REFRESH_PUBLISHED',
    sourceHead,
    truthState,
    capacityUsable,
    nextEligibleAtUtc,
    checkpoint: refreshCheckpoint,
    readOnly: true,
    resetAuthority: false,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
}
