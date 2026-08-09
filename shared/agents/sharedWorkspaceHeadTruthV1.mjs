import { readFile } from 'node:fs/promises';

import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';

export const SHARED_WORKSPACE_HEAD_TRUTH_SCHEMA = 'stephanos.shared-workspace.head-truth.v1';
export const SHARED_WORKSPACE_HEAD_TRUTH_STALE_AFTER_MS = 35 * 60 * 1000;
export const SHARED_WORKSPACE_HEAD_TRUTH_MAX_FILE_BYTES = 128 * 1024;
export const SHARED_WORKSPACE_HEAD_TRUTH_RECORDS = Object.freeze({
  sync: Object.freeze(['status', 'battle-bridge-github-sync-current.json']),
  refresh: Object.freeze(['status', 'post-sync-runtime-refresh-current.json']),
  supervisor: Object.freeze(['status', 'battle-bridge-ignition-supervisor-current.json']),
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
  ].map(timestamp).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
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
  const observedAtMs = Date.parse(observedAtUtc);
  const ageMs = Number.isFinite(observedAtMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - observedAtMs) : null;
  const freshness = ageMs === null ? 'UNKNOWN' : (ageMs > staleAfterMs ? 'STALE' : 'CURRENT');
  const runtime = runtimeTruth(supervisor);
  const builtRuntimeHead = builtHead(refresh);
  const sourceHeadsAgree = Boolean(githubMainHead && windowsCheckoutHead && githubMainHead === windowsCheckoutHead);
  const servedMatchesCheckout = Boolean(runtime.servedHead && windowsCheckoutHead && runtime.servedHead === windowsCheckoutHead);

  let blocker = '';
  let exactNextAction = 'Continue observing canonical Shared Workspace head truth.';
  if (!sync) {
    blocker = 'HEAD_TRUTH_SYNC_RECORD_MISSING';
    exactNextAction = 'Restore the existing Battle Bridge GitHub Sync task and require a fresh exact-head status receipt.';
  } else if (freshness === 'STALE') {
    blocker = 'HEAD_TRUTH_SYNC_RECORD_STALE';
    exactNextAction = 'Repair the existing Battle Bridge control plane; do not trust the last observed Windows or served head as current.';
  } else if (text(sync.classification).startsWith('BLOCKED_')) {
    blocker = text(sync.classification);
    exactNextAction = text(sync.exactNextAction) || 'Resolve the published sync blocker through the existing recovery lane.';
  } else if (!githubMainHead || !windowsCheckoutHead) {
    blocker = 'HEAD_TRUTH_EXACT_HEAD_MISSING';
    exactNextAction = 'Run the existing bounded GitHub sync observer to publish exact local and origin/main heads.';
  } else if (!sourceHeadsAgree) {
    blocker = 'WINDOWS_CHECKOUT_NOT_AT_GITHUB_MAIN';
    exactNextAction = 'Let the existing fast-forward-only sync and refresh lane converge Windows to the observed GitHub main head.';
  } else if (runtime.expectedHead && !servedMatchesCheckout) {
    blocker = 'SERVED_RUNTIME_NOT_AT_WINDOWS_HEAD';
    exactNextAction = 'Run the existing post-sync runtime refresh and exact served-head proof.';
  }

  const state = blocker ? (freshness === 'STALE' ? 'STALE' : 'BLOCKED') : 'CURRENT';
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_HEAD_TRUTH_SCHEMA,
    projectionKind: 'shared-workspace-head-truth',
    aggregationOk: Boolean(sync),
    aggregationReason: sync ? 'HEAD_TRUTH_EVIDENCE_LOADED' : 'HEAD_TRUTH_SYNC_RECORD_MISSING',
    repository: FIXED_REPOSITORY,
    timestampUtc,
    observedAtUtc,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    freshness,
    state,
    githubMainHead,
    windowsCheckoutHead,
    builtRuntimeHead,
    servedRuntimeHead: runtime.servedHead,
    sourceHeadsAgree,
    servedMatchesCheckout,
    syncClassification: text(sync?.classification) || 'UNKNOWN',
    syncTaskName: text(sync?.taskName) || 'Stephanos Battle Bridge GitHub Sync',
    runtimeExactHeadProofOk: runtime.exactHeadProofOk,
    blocker,
    exactNextAction,
    proofRefs: proofRefs(records),
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
