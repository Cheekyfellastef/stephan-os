import { readFile } from 'node:fs/promises';

import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';

export const SHARED_WORKSPACE_HEAD_TRUTH_SCHEMA = 'stephanos.shared-workspace.head-truth.v1';
export const SHARED_WORKSPACE_HEAD_TRUTH_STALE_AFTER_MS = 35 * 60 * 1000;
export const SHARED_WORKSPACE_HEAD_TRUTH_MAX_FILE_BYTES = 128 * 1024;
export const SHARED_WORKSPACE_HEAD_TRUTH_RECORDS = Object.freeze({
  sync: Object.freeze(['status', 'battle-bridge-github-sync-current.json']),
  refresh: Object.freeze(['status', 'post-sync-runtime-refresh-current.json']),
  supervisor: Object.freeze(['status', 'battle-bridge-ignition-supervisor-current.json']),
  publisher: Object.freeze(['status', 'battle-bridge-current.json']),
  recoveryMesh: Object.freeze(['status', 'battle-bridge-recovery-mesh-current.json']),
  mailbox: Object.freeze(['status', 'battle-bridge-mailbox-receipt-index.json']),
  worker: Object.freeze(['status', 'mission-orchestrator-worker-heartbeat.json']),
  attachment: Object.freeze(['codex-dispatch', 'surface-attachment-latest.json']),
});

const FIXED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function head(value) {
  const candidate = text(value).toLowerCase();
  return SHA.test(candidate) ? candidate : '';
}

function timestamp(value) {
  const candidate = text(value);
  return Number.isFinite(Date.parse(candidate)) ? candidate : '';
}

function latestTimestamp(records = {}) {
  return [
    records.sync?.timestampUtc,
    records.refresh?.timestampUtc,
    records.supervisor?.generatedAt,
    records.supervisor?.timestampUtc,
    records.publisher?.timestampUtc,
    records.recoveryMesh?.timestampUtc,
    records.mailbox?.timestampUtc,
    records.worker?.timestampUtc,
    records.attachment?.observedAt,
  ].map(timestamp).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
}

function evidenceAge(timestampUtc, nowMs) {
  const observedMs = Date.parse(timestampUtc);
  return Number.isFinite(observedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - observedMs) : null;
}

function evidenceState({ timestampUtc, nowMs, staleAfterMs, proven }) {
  const ageMs = evidenceAge(timestampUtc, nowMs);
  if (ageMs === null) return Object.freeze({ state: 'UNPROVEN', observedAtUtc: '', ageSeconds: null });
  if (ageMs > staleAfterMs) return Object.freeze({ state: 'STALE', observedAtUtc: timestampUtc, ageSeconds: Math.floor(ageMs / 1000) });
  return Object.freeze({ state: proven ? 'PROVEN' : 'BLOCKED', observedAtUtc: timestampUtc, ageSeconds: Math.floor(ageMs / 1000) });
}

function serviceCoverage(publisher, serviceId, nowMs) {
  const timestampUtc = timestamp(publisher?.timestampUtc);
  const service = publisher?.observedServiceFacts?.[serviceId] || null;
  return Object.freeze({
    ...evidenceState({ timestampUtc, nowMs, staleAfterMs: 5 * 60 * 1000, proven: service?.ready === true }),
    ready: service?.ready === true,
  });
}

function buildWindowsProofCoverage({ records, nowMs, githubMainHead, windowsCheckoutHead, builtRuntimeHead, servedRuntimeHead }) {
  const syncTimestamp = timestamp(records.sync?.timestampUtc);
  const refreshTimestamp = timestamp(records.refresh?.timestampUtc);
  const supervisorTimestamp = timestamp(records.supervisor?.generatedAt || records.supervisor?.timestampUtc);
  const recoveryTimestamp = timestamp(records.recoveryMesh?.timestampUtc);
  const mailboxTimestamp = timestamp(records.mailbox?.timestampUtc);
  const workerTimestamp = timestamp(records.worker?.timestampUtc);
  const attachmentTimestamp = timestamp(records.attachment?.observedAt);
  const source = evidenceState({
    timestampUtc: syncTimestamp,
    nowMs,
    staleAfterMs: SHARED_WORKSPACE_HEAD_TRUTH_STALE_AFTER_MS,
    proven: Boolean(githubMainHead && windowsCheckoutHead && githubMainHead === windowsCheckoutHead),
  });
  const built = evidenceState({
    timestampUtc: refreshTimestamp,
    nowMs,
    staleAfterMs: SHARED_WORKSPACE_HEAD_TRUTH_STALE_AFTER_MS,
    proven: Boolean(builtRuntimeHead && builtRuntimeHead === windowsCheckoutHead),
  });
  const served = evidenceState({
    timestampUtc: supervisorTimestamp,
    nowMs,
    staleAfterMs: 5 * 60 * 1000,
    proven: Boolean(servedRuntimeHead && servedRuntimeHead === windowsCheckoutHead),
  });
  const recoveryMesh = evidenceState({
    timestampUtc: recoveryTimestamp,
    nowMs,
    staleAfterMs: 10 * 60 * 1000,
    proven: records.recoveryMesh?.classification === 'RECOVERY_MESH_ALL_SERVICES_HEALTHY',
  });
  const mailbox = evidenceState({
    timestampUtc: mailboxTimestamp,
    nowMs,
    staleAfterMs: 5 * 60 * 1000,
    proven: ['MAILBOX_RECEIPT_INDEX_READY', 'MAILBOX_RECEIPT_INDEX_ACTIVE'].includes(text(records.mailbox?.finalVerdict)),
  });
  const workerHead = head(records.worker?.headSha);
  const worker = evidenceState({
    timestampUtc: workerTimestamp,
    nowMs,
    staleAfterMs: 2 * 60 * 1000,
    proven: records.worker?.taskName === 'Stephanos Mission Orchestrator Worker'
      && records.worker?.branch === 'main'
      && workerHead === windowsCheckoutHead
      && ['MISSION_WORKER_RUNNING', 'MISSION_WORKER_TICK_RUNNING', 'MISSION_WORKER_TICK_PASS'].includes(text(records.worker?.lastTickVerdict)),
  });
  const attachmentHead = head(records.attachment?.sourceHead);
  const executionSurface = evidenceState({
    timestampUtc: attachmentTimestamp,
    nowMs,
    staleAfterMs: 10 * 60 * 1000,
    proven: records.attachment?.attached === true
      && records.attachment?.can_local_windows_proof === true
      && records.attachment?.requiredDispatchToolsPresent === true
      && attachmentHead === windowsCheckoutHead,
  });
  const checks = Object.freeze({
    source: Object.freeze({ ...source, githubMainHead, windowsCheckoutHead }),
    builtRuntime: Object.freeze({ ...built, head: builtRuntimeHead }),
    servedRuntime: Object.freeze({ ...served, head: servedRuntimeHead }),
    ui4173: serviceCoverage(records.publisher, 'stephanos-ui', nowMs),
    backend8787: serviceCoverage(records.publisher, 'backend', nowMs),
    openClaw18789: serviceCoverage(records.publisher, 'openclaw-gateway', nowMs),
    sharedWorkspace: serviceCoverage(records.publisher, 'shared-workspace', nowMs),
    recoveryMesh: Object.freeze({ ...recoveryMesh, classification: text(records.recoveryMesh?.classification) }),
    commandMailbox: Object.freeze({ ...mailbox, finalVerdict: text(records.mailbox?.finalVerdict) }),
    missionWorker: Object.freeze({ ...worker, head: workerHead }),
    windowsExecutionSurface: Object.freeze({ ...executionSurface, head: attachmentHead, canLocalWindowsProof: records.attachment?.can_local_windows_proof === true }),
  });
  const blockers = Object.entries(checks)
    .filter(([, value]) => value.state !== 'PROVEN')
    .map(([key, value]) => `${key.toUpperCase()}_${value.state}`);
  return Object.freeze({
    complete: blockers.length === 0,
    finalVerdict: blockers.length === 0 ? 'WINDOWS_PROOF_COVERAGE_COMPLETE' : 'WINDOWS_PROOF_COVERAGE_INCOMPLETE',
    blockers: Object.freeze(blockers),
    checks,
  });
}

function proofRefs(records = {}) {
  const refs = [];
  for (const record of Object.values(records)) {
    if (!record || typeof record !== 'object') continue;
    for (const ref of Array.isArray(record.proofRefs) ? record.proofRefs : []) {
      const candidate = text(ref).replace(/\\/g, '/');
      if (/^(?:proof|proofs|receipts|evidence\/receipts)\/[a-z0-9][a-z0-9._\/-]{0,240}$/i.test(candidate)) refs.push(candidate);
    }
  }
  return [...new Set(refs)].slice(0, 20);
}

function runtimeTruth(supervisor = {}) {
  const served = supervisor?.services?.stephanosUi4173?.servedRuntimeProof || {};
  const expectedHead = head(served.currentHead);
  const servedHead = served.ready === true && served.gitCommitMatches === true && served.runtimeMarkerMatches === true
    ? expectedHead
    : '';
  return Object.freeze({
    expectedHead,
    servedHead,
    exactHeadProofOk: Boolean(servedHead),
    healthOk: served.healthOk === true,
    distOk: served.distOk === true,
  });
}

function builtHead(refresh = {}) {
  if (!refresh || typeof refresh !== 'object') return '';
  const afterHead = head(refresh.afterHead);
  if (!afterHead || refresh.exactHeadProofOk !== true) return '';
  const ui = Array.isArray(refresh.resultTargets)
    ? refresh.resultTargets.find((entry) => entry?.targetId === 'stephanos-ui-4173')
    : null;
  return ui?.ok === true && ui?.exactHeadProofOk === true && head(ui?.sourceHead) === afterHead ? afterHead : '';
}

export function buildSharedWorkspaceHeadTruthProjection({
  records = {},
  timestampUtc = new Date().toISOString(),
  nowMs = Date.parse(timestampUtc),
  staleAfterMs = SHARED_WORKSPACE_HEAD_TRUTH_STALE_AFTER_MS,
} = {}) {
  const sync = records.sync || null;
  const refresh = records.refresh || null;
  const supervisor = records.supervisor || null;
  const githubMainHead = head(sync?.remoteHeadObserved);
  const windowsCheckoutHead = head(sync?.localHeadAfter || sync?.localHeadBefore);
  const observedAtUtc = latestTimestamp(records);
  const syncObservedAtUtc = timestamp(sync?.timestampUtc);
  const ageMs = evidenceAge(syncObservedAtUtc, nowMs);
  const freshness = ageMs === null ? 'UNKNOWN' : (ageMs > staleAfterMs ? 'STALE' : 'CURRENT');
  const runtime = runtimeTruth(supervisor);
  const builtRuntimeHead = builtHead(refresh);
  const sourceHeadsAgree = Boolean(githubMainHead && windowsCheckoutHead && githubMainHead === windowsCheckoutHead);
  const servedMatchesCheckout = Boolean(runtime.servedHead && windowsCheckoutHead && runtime.servedHead === windowsCheckoutHead);
  const builtMatchesCheckout = Boolean(builtRuntimeHead && windowsCheckoutHead && builtRuntimeHead === windowsCheckoutHead);
  const syncClassification = text(sync?.classification) || 'UNKNOWN';
  const syncTaskHealth = !sync
    ? 'UNPROVEN'
    : freshness === 'STALE'
      ? 'STALE_OR_NOT_RUNNING'
      : syncClassification.startsWith('BLOCKED_')
        ? 'RUNNING_BLOCKED'
        : 'HEALTHY';

  let blocker = '';
  let exactNextAction = 'Continue observing canonical Shared Workspace head truth.';
  if (!sync) {
    blocker = 'HEAD_TRUTH_SYNC_RECORD_MISSING';
    exactNextAction = 'Restore the existing Battle Bridge GitHub Sync task and require a fresh exact-head status receipt.';
  } else if (freshness === 'STALE') {
    blocker = 'HEAD_TRUTH_SYNC_RECORD_STALE';
    exactNextAction = 'Repair the existing Battle Bridge control plane; do not trust the last observed Windows or served head as current.';
  } else if (syncClassification.startsWith('BLOCKED_')) {
    blocker = syncClassification;
    exactNextAction = text(sync.exactNextAction) || 'Resolve the published sync blocker through the existing recovery lane.';
  } else if (!githubMainHead || !windowsCheckoutHead) {
    blocker = 'HEAD_TRUTH_EXACT_HEAD_MISSING';
    exactNextAction = 'Run the existing bounded GitHub sync observer to publish exact local and origin/main heads.';
  } else if (!sourceHeadsAgree) {
    blocker = 'WINDOWS_CHECKOUT_NOT_AT_GITHUB_MAIN';
    exactNextAction = 'Let the existing fast-forward-only sync and refresh lane converge Windows to the observed GitHub main head.';
  } else if (!builtMatchesCheckout) {
    blocker = 'BUILT_RUNTIME_HEAD_UNPROVEN';
    exactNextAction = 'Run the existing post-sync runtime refresh and publish its exact built-head receipt.';
  } else if (!servedMatchesCheckout) {
    blocker = 'SERVED_RUNTIME_NOT_AT_WINDOWS_HEAD';
    exactNextAction = 'Run the existing post-sync runtime refresh and exact served-head proof.';
  }

  const windowsProofCoverage = buildWindowsProofCoverage({
    records,
    nowMs,
    githubMainHead,
    windowsCheckoutHead,
    builtRuntimeHead,
    servedRuntimeHead: runtime.servedHead,
  });
  const state = blocker ? (freshness === 'STALE' ? 'STALE' : 'BLOCKED') : 'CURRENT';
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_HEAD_TRUTH_SCHEMA,
    projectionKind: 'shared-workspace-head-truth',
    aggregationOk: Boolean(sync),
    aggregationReason: sync ? 'HEAD_TRUTH_EVIDENCE_LOADED' : 'HEAD_TRUTH_SYNC_RECORD_MISSING',
    repository: FIXED_REPOSITORY,
    timestampUtc,
    observedAtUtc,
    syncObservedAtUtc,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    freshness,
    state,
    githubMainHead,
    windowsCheckoutHead,
    builtRuntimeHead,
    servedRuntimeHead: runtime.servedHead,
    sourceHeadsAgree,
    builtMatchesCheckout,
    servedMatchesCheckout,
    syncClassification,
    syncTaskName: text(sync?.taskName) || 'Stephanos Battle Bridge GitHub Sync',
    syncTaskExpectedIntervalMinutes: 15,
    syncTaskLastObservedUtc: timestamp(sync?.timestampUtc),
    syncTaskHealth,
    runtimeExactHeadProofOk: runtime.exactHeadProofOk,
    blocker,
    exactNextAction,
    proofRefs: proofRefs(records),
    windowsProofCoverage,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

async function readFixedRecord({ workspaceRoot, repoRoot, segments, readFileFn = readFile }) {
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments });
  if (!resolved.ok) return { ok: false, reason: resolved.reason, record: null };
  try {
    const raw = await readFileFn(resolved.path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > SHARED_WORKSPACE_HEAD_TRUTH_MAX_FILE_BYTES) {
      return { ok: false, reason: 'HEAD_TRUTH_RECORD_TOO_LARGE', record: null };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'HEAD_TRUTH_RECORD_INVALID', record: null };
    return { ok: true, reason: 'HEAD_TRUTH_RECORD_LOADED', record: parsed };
  } catch (error) {
    return { ok: false, reason: error?.code === 'ENOENT' ? 'HEAD_TRUTH_RECORD_MISSING' : 'HEAD_TRUTH_RECORD_READ_FAILED', record: null };
  }
}

export async function loadSharedWorkspaceHeadTruthEvidence({ workspaceRoot, repoRoot, readFileFn = readFile } = {}) {
  const entries = await Promise.all(Object.entries(SHARED_WORKSPACE_HEAD_TRUTH_RECORDS).map(async ([key, segments]) => [
    key,
    await readFixedRecord({ workspaceRoot, repoRoot, segments, readFileFn }),
  ]));
  const loads = Object.fromEntries(entries);
  return Object.freeze({
    ok: loads.sync?.ok === true,
    reason: loads.sync?.ok === true ? 'HEAD_TRUTH_EVIDENCE_LOADED' : loads.sync?.reason || 'HEAD_TRUTH_SYNC_RECORD_MISSING',
    records: Object.freeze(Object.fromEntries(entries.map(([key, result]) => [key, result.record]))),
    loads: Object.freeze(loads),
  });
}
