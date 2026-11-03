// Goal #2315 Stage 2: classify a prior mailbox-free Actions observation.
// This is an evidence-only consumer, NOT a scheduler, worker or custody authority.
// Input envelopes must come from independently authenticated GitHub readers on a
// trusted host. Cross-field agreement alone never authenticates their provenance.
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const MAILBOX_FREE_GOAL_DISCOVERY_SCHEMA = 'stephanos.mailbox-free-goal-discovery-stage2.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const REPO_ID = 1179385578;
const OWNER_ID = 267490109;
const WORKFLOW_ID = 398609082;
const WORKFLOW_PATH = '.github/workflows/stephanos-mailbox-free-readonly.yml';
const OBSERVATION_SCHEMA = 'stephanos.mailbox-free-dispatch-readonly.v1';
const ARTIFACT_NAME = runId => 'stephanos-mailbox-free-readonly-' + runId;
const PROOF_NAME = 'stephanos-mailbox-free-readonly-proof.json';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_ARCHIVE = 64 * 1024;
const MAX_PROOF = 16 * 1024;
const PROOF_KEYS = Object.freeze([
  'schemaVersion', 'verdict', 'mode', 'requestId', 'runId', 'runAttempt',
  'goalNumber', 'goalState', 'goalCommentCount', 'sourceHead',
  'observedAtUtc', 'goalUrl', 'runUrl', 'independentVerificationPerformed',
  'executionAuthorized', 'nativePickupProven', 'sourceMutationAllowed',
  'protectedMergeAllowed', 'nextGate',
]);
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const exactKeys = (value, keys) => isObject(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const blocked = blocker => Object.freeze({
  schemaVersion: MAILBOX_FREE_GOAL_DISCOVERY_SCHEMA,
  disposition: 'HELD', blocker,
  independentlyAuthenticatedTransport: false,
  originalGoalAdmissionGranted: false, exclusiveClaimGranted: false,
  sourceMutationAllowed: false, nativePickupProven: false,
  executionAuthorized: false, protectedMergeAllowed: false,
});
const exactIso = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const octet of buffer) {
    crc ^= octet;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Bounded, one-entry ZIP reader. No ZIP paths are written or extracted to disk.
// Both GitHub artifact SHA-256 and the central-directory CRC are rechecked.
export function decodeMailboxFreeGoalProofArchiveV1(archive) {
  try {
    if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > MAX_ARCHIVE) return null;
    let end = -1;
    for (let at = archive.length - 22; at >= Math.max(0, archive.length - 65557); at--) {
      if (archive.readUInt32LE(at) === 0x06054b50
        && at + 22 + archive.readUInt16LE(at + 20) === archive.length) {
        end = at; break;
      }
    }
    if (end < 0 || archive.readUInt16LE(end + 4) !== 0
      || archive.readUInt16LE(end + 6) !== 0
      || archive.readUInt16LE(end + 8) !== 1
      || archive.readUInt16LE(end + 10) !== 1) return null;
    const centralSize = archive.readUInt32LE(end + 12);
    const centralOffset = archive.readUInt32LE(end + 16);
    if (centralOffset + centralSize !== end || centralSize < 46
      || centralOffset + 46 > archive.length
      || archive.readUInt32LE(centralOffset) !== 0x02014b50) return null;
    const flag = archive.readUInt16LE(centralOffset + 8);
    const method = archive.readUInt16LE(centralOffset + 10);
    const crc = archive.readUInt32LE(centralOffset + 16);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    if (flag & ~0x0808 || ![0, 8].includes(method) || compressedSize > MAX_ARCHIVE
      || uncompressedSize < 2 || uncompressedSize > MAX_PROOF
      || 46 + nameLength + extraLength + commentLength !== centralSize) return null;
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
    if (name !== PROOF_NAME || localOffset + 30 > centralOffset
      || archive.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const localFlag = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (localFlag !== flag || localMethod !== method
      || archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8') !== name
      || dataOffset + compressedSize > centralOffset) return null;
    // Without a data descriptor, local metadata must match the authenticated
    // central directory; never accept a split-brain ZIP fixture or artifact.
    if (!(flag & 0x0008) && (archive.readUInt32LE(localOffset + 14) !== crc
      || archive.readUInt32LE(localOffset + 18) !== compressedSize
      || archive.readUInt32LE(localOffset + 22) !== uncompressedSize)) return null;
    const data = archive.subarray(dataOffset, dataOffset + compressedSize);
    const bytes = method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_PROOF });
    if (bytes.length !== uncompressedSize || crc32(bytes) !== crc) return null;
    const parsed = JSON.parse(bytes.toString('utf8'));
    return exactKeys(parsed, PROOF_KEYS) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Strictly correlates one already-observed GitHub run, terminal jobs,
 * downloaded immutable artifact ZIP, source main, and the canonical goal.
 * An injected metadata/ZIP packet is NOT independent GitHub authentication.
 * Output is always discovery-only and cannot enter source admission by itself.
 */
export function classifyMailboxFreeGoalDiscoveryV1({
  run, jobs, artifact, archive, mainHead, goal, nowUtc,
} = {}) {
  if (!isObject(run) || !positive(run.id)
    || run.name !== 'Stephanos Control Tower - Mailbox-Free Read-Only Pilot'
    || run.path !== WORKFLOW_PATH || run.workflow_id !== WORKFLOW_ID
    || run.event !== 'workflow_dispatch' || run.run_attempt !== 1
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.head_branch !== 'main' || !SHA.test(run.head_sha)
    || run.repository?.full_name !== REPO || run.repository?.id !== REPO_ID
    || run.actor?.login !== OWNER || run.actor?.id !== OWNER_ID
    || run.triggering_actor?.login !== OWNER) return blocked('RUN_OR_OPERATOR_IDENTITY_UNPROVEN');
  if (typeof mainHead !== 'string' || !SHA.test(mainHead)
    || mainHead !== run.head_sha) return blocked('CURRENT_MAIN_OR_RUN_HEAD_MOVED');
  const list = Array.isArray(jobs?.jobs) ? jobs.jobs : null;
  if (!list || list.length !== 2
    || list.filter(x => x?.name === 'inspect-goal' && x?.run_id === run.id
      && x?.status === 'completed' && x?.conclusion === 'success').length !== 1
    || list.filter(x => x?.name === 'contract-test' && x?.run_id === run.id
      && x?.status === 'completed' && x?.conclusion === 'skipped').length !== 1)
    return blocked('EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  if (!isObject(artifact) || !positive(artifact.id)
    || artifact.name !== ARTIFACT_NAME(run.id)
    || artifact.expired !== false || !DIGEST.test(artifact.digest)
    || !Number.isSafeInteger(artifact.size_in_bytes)
    || artifact.size_in_bytes < 22 || artifact.size_in_bytes > MAX_ARCHIVE
    || artifact.workflow_run?.id !== run.id
    || artifact.workflow_run?.head_sha !== run.head_sha
    || !Buffer.isBuffer(archive) || artifact.size_in_bytes !== archive.length
    || artifact.digest !== 'sha256:' + digest(archive))
    return blocked('IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const proof = decodeMailboxFreeGoalProofArchiveV1(archive);
  if (!proof) return blocked('PROOF_ARCHIVE_INVALID_OR_UNBOUNDED');
  if (proof.schemaVersion !== OBSERVATION_SCHEMA
    || proof.verdict !== 'READ_ONLY_OBSERVED' || proof.mode !== 'READ_GOAL_STATUS'
    || proof.requestId !== 'actions-run-' + run.id + '-1'
    || proof.runId !== run.id || proof.runAttempt !== 1
    || !positive(proof.goalNumber) || proof.goalNumber > 9999999
    || proof.goalState !== 'OPEN'
    || !Number.isSafeInteger(proof.goalCommentCount) || proof.goalCommentCount < 0
    || proof.sourceHead !== mainHead
    || proof.goalUrl !== 'https://github.com/' + REPO + '/issues/' + proof.goalNumber
    || proof.runUrl !== 'https://github.com/' + REPO + '/actions/runs/' + run.id
    || proof.nextGate !== 'EXISTING_GOAL_OWNER_ADMISSION_AND_INDEPENDENT_REVIEW'
    || proof.independentVerificationPerformed !== false
    || proof.executionAuthorized !== false || proof.nativePickupProven !== false
    || proof.sourceMutationAllowed !== false || proof.protectedMergeAllowed !== false)
    return blocked('READ_ONLY_GOAL_PROOF_SCOPE_INVALID');
  if (!isObject(goal) || goal.number !== proof.goalNumber
    || goal.state !== 'open' || goal.pull_request != null)
    return blocked('CURRENT_CANONICAL_GOAL_NOT_OPEN');
  if (!exactIso(run.created_at) || !exactIso(run.updated_at)
    || !exactIso(proof.observedAtUtc) || !exactIso(nowUtc))
    return blocked('OBSERVATION_CLOCK_UNTRUSTED');
  const start = Date.parse(run.created_at);
  const end = Date.parse(run.updated_at);
  const proofTime = Date.parse(proof.observedAtUtc);
  const now = Date.parse(nowUtc);
  if (end < start || proofTime < start - 5000 || proofTime > end + 10000
    || now < proofTime || now - proofTime > 24 * 60 * 60 * 1000)
    return blocked('OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_GOAL_DISCOVERY_SCHEMA,
    disposition: 'DISCOVERY_CANDIDATE_ONLY',
    blocker: '',
    goalNumber: proof.goalNumber,
    goalState: proof.goalState,
    runId: run.id,
    artifactId: artifact.id,
    runUrl: proof.runUrl,
    sourceHead: mainHead,
    proofObservedAtUtc: proof.observedAtUtc,
    archiveSha256: digest(archive),
    independentlyAuthenticatedTransport: false,
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    sourceMutationAllowed: false, nativePickupProven: false,
    executionAuthorized: false, protectedMergeAllowed: false,
    nextGate: 'TRUSTED_GITHUB_READBACK_AND_EXISTING_GOAL_OWNER_ADMISSION',
  });
}
