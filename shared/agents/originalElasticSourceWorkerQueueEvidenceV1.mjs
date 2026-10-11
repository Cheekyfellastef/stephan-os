import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveMissionWorkerQueueRoot } from '../../stephanos-server/services/missionOrchestratorWorkerService.js';
import { ORIGINAL_SOURCE_QUEUE_ADAPTERS } from '../../stephanos-server/services/elasticPrHeadLeaseService.js';

// Historical original source identity, not current main and not a grant to
// execute or reconcile it. Keep this one probe fixed to #2961/#2962.
export const ORIGINAL_R7_EVIDENCE_IDENTITY = Object.freeze({
  missionId: 'critical-2962-elastic-goal',
  leaseKey: 'critical-2962-elastic-goal-r7-lease',
  issueNumber: 2962,
  prNumber: 2987,
  branch: 'openclaw/elastic-goal-2962',
  headSha: '4e5023eef829b285095db4eeb09d6f2b365e33e4',
  missionRevision: 7,
});
export const ORIGINAL_R7_QUEUE_EVIDENCE_SCHEMA = 'stephanos.original-r7-worker-evidence.v1';
const STATES = Object.freeze(['pending', 'processing', 'completed', 'failed']);
const MAX_ENTRIES_PER_DIRECTORY = 128;
const MAX_FILES_TOTAL = 1024;
const MAX_JSON_BYTES = 256 * 1024;
const ACTION_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,119}$/i;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function lower(value) { return text(value).toLowerCase(); }
function sameOriginalIdentity(binding) {
  const wanted = ORIGINAL_R7_EVIDENCE_IDENTITY;
  return binding?.schemaVersion === 'stephanos.mission-worker-queue-execution-binding.v1'
    && lower(binding.missionId) === wanted.missionId
    && text(binding.leaseKey) === wanted.leaseKey
    && binding.missionRevision === wanted.missionRevision
    && lower(binding.repository) === 'cheekyfellastef/stephan-os'
    && Number(binding.issueNumber) === wanted.issueNumber
    && Number(binding.prNumber) === wanted.prNumber
    && text(binding.branch) === wanted.branch
    && lower(binding.headSha) === wanted.headSha;
}
function isOriginal(record) {
  return lower(record?.missionId) === ORIGINAL_R7_EVIDENCE_IDENTITY.missionId
    || lower(record?.executionBinding?.missionId) === ORIGINAL_R7_EVIDENCE_IDENTITY.missionId
    || text(record?.executionBinding?.leaseKey) === ORIGINAL_R7_EVIDENCE_IDENTITY.leaseKey
    || lower(record?.actionGrant?.missionId) === ORIGINAL_R7_EVIDENCE_IDENTITY.missionId;
}
function safeResultPair(item, result) {
  return result && lower(result.missionId) === ORIGINAL_R7_EVIDENCE_IDENTITY.missionId
    && lower(result.actionId) === lower(item.actionId)
    && result.processed === true
    && typeof result.success === 'boolean'
    && (!text(result.adapter) || lower(result.adapter) === lower(item.adapter));
}
function presentFile(entry) {
  return entry && entry.isFile() && !entry.isSymbolicLink()
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/.test(entry.name);
}
async function parseBoundedFile(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_JSON_BYTES) {
    throw new Error('UNSAFE_OR_OVERSIZED_QUEUE_FILE');
  }
  const record = JSON.parse(await readFile(path, 'utf8'));
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('INVALID_QUEUE_JSON');
  }
  return record;
}
function summary(values = {}) {
  const numeric = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return Object.freeze({
    schemaVersion: ORIGINAL_R7_QUEUE_EVIDENCE_SCHEMA,
    originalOwner: '#2961',
    originalMission: '#2962',
    originalLeaseKey: ORIGINAL_R7_EVIDENCE_IDENTITY.leaseKey,
    originalPrNumber: 2987,
    sourceHead: ORIGINAL_R7_EVIDENCE_IDENTITY.headSha,
    queueObserved: values.queueObserved === true,
    inventoryComplete: values.inventoryComplete === true,
    inspectedAdapterDirectories: numeric(values.inspectedAdapterDirectories),
    missingAdapterDirectories: numeric(values.missingAdapterDirectories),
    scannedFiles: numeric(values.scannedFiles),
    matchingOriginalItems: numeric(values.matchingOriginalItems),
    exactBindingItems: numeric(values.exactBindingItems),
    mismatchedOriginalItems: numeric(values.mismatchedOriginalItems),
    pendingOriginalItems: numeric(values.pendingOriginalItems),
    processingOriginalItems: numeric(values.processingOriginalItems),
    completedOriginalItems: numeric(values.completedOriginalItems),
    failedOriginalItems: numeric(values.failedOriginalItems),
    exactResultPairCandidates: numeric(values.exactResultPairCandidates),
    missingResultPairs: numeric(values.missingResultPairs),
    actionHashes: Object.freeze((Array.isArray(values.actionHashes) ? values.actionHashes : []).slice(0, 8)),
    blocker: ['ORIGINAL_QUEUE_ROOT_UNAVAILABLE', 'ORIGINAL_QUEUE_INVENTORY_UNOBSERVABLE',
      'ORIGINAL_QUEUE_SCAN_LIMIT_REACHED', 'ORIGINAL_QUEUE_IDENTITY_UNVERIFIED',
      'ORIGINAL_QUEUE_RESULT_NOT_PROVEN', ''].includes(values.blocker) ? values.blocker : 'ORIGINAL_QUEUE_INVENTORY_UNOBSERVABLE',
    readOnly: true,
    rawPathsReturned: false,
    rawRecordsReturned: false,
    secretMaterialReturned: false,
    writerInactivityProven: false,
    canonicalTerminalExecutionReceiptProven: false,
    leaseReleaseAuthority: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
  });
}

// Bounded filesystem observation of the existing Mission Worker queue only.
// It never writes, cancels, releases leases, executes code, or treats absence
// as proof no other writer exists. A candidate pair still needs authenticated
// original-owner correlation with mission events and receipt history.
export async function inspectOriginalR7QueueEvidenceV1({ env = process.env } = {}) {
  let root;
  try {
    root = resolveMissionWorkerQueueRoot(env);
    if (!root) return summary({ blocker: 'ORIGINAL_QUEUE_ROOT_UNAVAILABLE' });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return summary({ blocker: 'ORIGINAL_QUEUE_INVENTORY_UNOBSERVABLE' });
    }
  } catch {
    return summary({ blocker: 'ORIGINAL_QUEUE_ROOT_UNAVAILABLE' });
  }
  const counts = {
    queueObserved: true, inventoryComplete: false,
    inspectedAdapterDirectories: 0, missingAdapterDirectories: 0, scannedFiles: 0,
    matchingOriginalItems: 0, exactBindingItems: 0, mismatchedOriginalItems: 0,
    pendingOriginalItems: 0, processingOriginalItems: 0,
    completedOriginalItems: 0, failedOriginalItems: 0,
    exactResultPairCandidates: 0, missingResultPairs: 0,
    actionHashes: [],
  };
  const seenActions = new Set();
  try {
    for (const adapter of ORIGINAL_SOURCE_QUEUE_ADAPTERS) {
      for (const state of STATES) {
        const dir = resolve(root, adapter, state);
        let details;
        try { details = await lstat(dir); }
        catch (error) {
          if (error?.code === 'ENOENT') {
            counts.missingAdapterDirectories += 1;
            continue;
          }
          throw error;
        }
        if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('UNSAFE_QUEUE_DIRECTORY');
        const entries = await readdir(dir, { withFileTypes: true });
        if (entries.length > MAX_ENTRIES_PER_DIRECTORY) {
          return summary({ ...counts, blocker: 'ORIGINAL_QUEUE_SCAN_LIMIT_REACHED' });
        }
        counts.inspectedAdapterDirectories += 1;
        const entrySet = new Set(entries.map((entry) => entry.name));
        for (const entry of entries) {
          if (entry.isDirectory() || entry.isSymbolicLink()) throw new Error('UNSAFE_QUEUE_ENTRY');
          if (!entry.name.endsWith('.json') || entry.name.endsWith('.result.json')) continue;
          if (!presentFile(entry)) throw new Error('UNSAFE_QUEUE_FILENAME');
          counts.scannedFiles += 1;
          if (counts.scannedFiles > MAX_FILES_TOTAL) {
            return summary({ ...counts, blocker: 'ORIGINAL_QUEUE_SCAN_LIMIT_REACHED' });
          }
          const item = await parseBoundedFile(resolve(dir, entry.name));
          if (!isOriginal(item)) continue;
          counts.matchingOriginalItems += 1;
          counts[`${state}OriginalItems`] += 1;
          const exact = sameOriginalIdentity(item.executionBinding)
            && ACTION_PATTERN.test(text(item.actionId))
            && lower(item.actionId) === lower(item.executionBinding.executionId)
            && (!text(item.adapter) || lower(item.adapter) === adapter);
          if (!exact) {
            counts.mismatchedOriginalItems += 1;
            continue;
          }
          counts.exactBindingItems += 1;
          const digest = createHash('sha256').update(lower(item.actionId)).digest('hex');
          if (!seenActions.has(digest)) {
            seenActions.add(digest);
            counts.actionHashes.push(digest);
          }
          if (!['completed', 'failed'].includes(state)) continue;
          const resultFilename = entry.name.replace(/\.json$/, '.result.json');
          if (!entrySet.has(resultFilename)) {
            counts.missingResultPairs += 1;
            continue;
          }
          const result = await parseBoundedFile(resolve(dir, resultFilename));
          if (safeResultPair(item, result)) counts.exactResultPairCandidates += 1;
          else counts.missingResultPairs += 1;
        }
      }
    }
  } catch {
    return summary({ ...counts, inventoryComplete: false, blocker: 'ORIGINAL_QUEUE_INVENTORY_UNOBSERVABLE' });
  }
  return summary({
    ...counts,
    inventoryComplete: true,
    blocker: counts.mismatchedOriginalItems > 0
      ? 'ORIGINAL_QUEUE_IDENTITY_UNVERIFIED'
      : counts.exactResultPairCandidates === 0
        ? 'ORIGINAL_QUEUE_RESULT_NOT_PROVEN' : '',
  });
}
