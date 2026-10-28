// Original Goal #2315 -> #2961: one-way, read-only nomination from the
// existing Stage-4 Control Tower proof. This is NEVER a Mission Worker intake,
// scheduler, task claim, native source admission, queue or execution authority.
// Inputs MUST be fetched/authenticated by an independent trusted GitHub host;
// matching attacker-controlled fields are not independent authentication.
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const MAILBOX_FREE_GOAL_NOMINATION_SCHEMA =
  'stephanos.mailbox-free-goal-nomination-stage5.v1';

const REPO = 'Cheekyfellastef/stephan-os';
const REPO_ID = 1179385578;
const OWNER = 'Cheekyfellastef';
const OWNER_ID = 267490109;
const DISPATCH_WORKFLOW = 398609082;
const DISPATCH_PATH = '.github/workflows/stephanos-mailbox-free-readonly.yml';
const READBACK_WORKFLOW = 398829071;
const READBACK_PATH = '.github/workflows/stephanos-mailbox-free-auto-readback.yml';
const READBACK_NAME = 'Stephanos Control Tower - Automatic Read-Only Proof Readback';
const READBACK_SCHEMA = 'stephanos.mailbox-free-auto-readback-stage4.v1';
const PROOF_FILE = 'mailbox-free-goal-readback.json';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_ZIP_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
const PROOF_KEYS = Object.freeze([
  'schemaVersion', 'verdict', 'blocker', 'originRunId', 'goalNumber',
  'sourceHead', 'originatingArtifactId', 'artifactSha256', 'sourceProofKind',
  'originalGoalAdmissionGranted', 'exclusiveClaimGranted', 'executionAuthorized',
  'sourceMutationAllowed', 'protectedMergeAllowed', 'nativePickupProven',
  'independentlyAuthenticatedNativeCustody', 'nextGate',
]);

const sha256 = input => createHash('sha256').update(input).digest('hex');
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const trustedClock = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));

function readonly(blocker) {
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_GOAL_NOMINATION_SCHEMA,
    disposition: 'HELD', blocker,
    schedulerEligible: false,
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    executionAuthorized: false,
    nativePickupProven: false,
    independentlyAuthenticatedNativeCustody: false,
    independentlyAuthenticatedTransport: false,
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Exactly one in-memory ZIP entry, fixed basename, bounded inflation, no
// filesystem extraction, extra entries, descriptors with unknown sizes or ZIP64.
export function decodeMailboxFreeReadbackArchiveV1(zip) {
  try {
    if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ZIP_BYTES) return null;
    const e = zip.length - 22;
    if (zip.readUInt32LE(e) !== 0x06054b50 || zip.readUInt16LE(e + 20) !== 0
      || zip.readUInt16LE(e + 4) !== 0 || zip.readUInt16LE(e + 6) !== 0
      || zip.readUInt16LE(e + 8) !== 1 || zip.readUInt16LE(e + 10) !== 1) return null;
    const centralLength = zip.readUInt32LE(e + 12);
    const centralOffset = zip.readUInt32LE(e + 16);
    if (centralLength < 46 || centralOffset + centralLength !== e
      || centralOffset + 46 > e || zip.readUInt32LE(centralOffset) !== 0x02014b50) return null;
    const flags = zip.readUInt16LE(centralOffset + 8);
    const method = zip.readUInt16LE(centralOffset + 10);
    const expectedCrc = zip.readUInt32LE(centralOffset + 16);
    const compressed = zip.readUInt32LE(centralOffset + 20);
    const inflated = zip.readUInt32LE(centralOffset + 24);
    const nameLen = zip.readUInt16LE(centralOffset + 28);
    const extraLen = zip.readUInt16LE(centralOffset + 30);
    const commentLen = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method)
      || compressed < 2 || compressed > MAX_ZIP_BYTES
      || inflated < 2 || inflated > MAX_JSON_BYTES
      || centralLength !== 46 + nameLen + extraLen + commentLen
      || localOffset !== 0 || localOffset + 30 > centralOffset) return null;
    const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLen).toString('utf8');
    if (name !== PROOF_FILE || zip.readUInt32LE(localOffset) !== 0x04034b50
      || zip.readUInt16LE(localOffset + 6) !== flags
      || zip.readUInt16LE(localOffset + 8) !== method) return null;
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLen + localExtraLen;
    if (dataAt + compressed > centralOffset
      || zip.subarray(localOffset + 30, localOffset + 30 + localNameLen).toString('utf8') !== name) return null;
    const descriptorAt = dataAt + compressed;
    if (flags & 8) {
      const descriptorLength = centralOffset - descriptorAt;
      if (![12, 16].includes(descriptorLength)) return null;
      const signed = descriptorLength === 16;
      if (signed && zip.readUInt32LE(descriptorAt) !== 0x08074b50) return null;
      const offset = descriptorAt + (signed ? 4 : 0);
      if (zip.readUInt32LE(offset) !== expectedCrc
        || zip.readUInt32LE(offset + 4) !== compressed
        || zip.readUInt32LE(offset + 8) !== inflated) return null;
    } else if (zip.readUInt32LE(localOffset + 14) !== expectedCrc
      || zip.readUInt32LE(localOffset + 18) !== compressed
      || zip.readUInt32LE(localOffset + 22) !== inflated
      || descriptorAt !== centralOffset) return null;
    const bytes = zip.subarray(dataAt, dataAt + compressed);
    const plain = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: MAX_JSON_BYTES });
    if (plain.length !== inflated || crc32(plain) !== expectedCrc) return null;
    const parsed = JSON.parse(plain.toString('utf8'));
    return exactKeys(parsed, PROOF_KEYS) ? parsed : null;
  } catch {
    return null;
  }
}

function ownerRun(run, workflowId, path, event, name) {
  return object(run) && positive(run.id)
    && run.workflow_id === workflowId
    && run.path === path && run.event === event
    && (name === null || run.name === name)
    && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success'
    && run.head_branch === 'main' && typeof run.head_sha === 'string' && SHA.test(run.head_sha)
    && run.repository?.full_name === REPO && run.repository?.id === REPO_ID
    && run.actor?.login === OWNER && run.actor?.id === OWNER_ID
    && run.triggering_actor?.login === OWNER
    && trustedClock(run.created_at) && trustedClock(run.updated_at);
}

/**
 * Produces only a bounded, frozen, explicitly ineligible nomination from
 * independently retrieved GitHub Stage-4 run, artifact ZIP and current goal.
 * This is NOT an authenticated source-admission function or a live host fetcher.
 */
export function projectMailboxFreeGoalNominationV1({
  readbackRun, originRun, artifact, archive, mainHead, goal, nowUtc,
} = {}) {
  if (!ownerRun(readbackRun, READBACK_WORKFLOW, READBACK_PATH, 'workflow_run', READBACK_NAME)
    || !ownerRun(originRun, DISPATCH_WORKFLOW, DISPATCH_PATH, 'workflow_dispatch', null))
    return readonly('ORIGIN_OR_READBACK_RUN_IDENTITY_UNPROVEN');
  if (!SHA.test(String(mainHead || '')) || readbackRun.head_sha !== mainHead
    || originRun.head_sha !== mainHead)
    return readonly('CURRENT_MAIN_NOT_EXACTLY_BOUND');
  if (!trustedClock(nowUtc)
    || Date.parse(readbackRun.updated_at) < Date.parse(readbackRun.created_at)
    || Date.parse(originRun.updated_at) < Date.parse(originRun.created_at)
    || Date.parse(readbackRun.created_at) < Date.parse(originRun.created_at)
    || Date.parse(readbackRun.created_at) < Date.parse(originRun.updated_at) - 10000
    || Date.parse(readbackRun.updated_at) > Date.parse(nowUtc) + 5000
    || Date.parse(nowUtc) - Date.parse(readbackRun.updated_at) > AGE_LIMIT_MS)
    return readonly('RUN_FRESHNESS_OR_CLOCK_UNPROVEN');
  if (!object(artifact) || !positive(artifact.id) || artifact.expired !== false
    || artifact.name !== 'stephanos-mailbox-free-auto-readback-' + originRun.id + '-' + readbackRun.id
    || !DIGEST.test(artifact.digest)
    || !Number.isSafeInteger(artifact.size_in_bytes)
    || artifact.size_in_bytes < 22 || artifact.size_in_bytes > MAX_ZIP_BYTES
    || artifact.workflow_run?.id !== readbackRun.id
    || artifact.workflow_run?.repository_id !== REPO_ID
    || artifact.workflow_run?.head_sha !== mainHead
    || artifact.workflow_run?.head_branch !== 'main'
    || !Buffer.isBuffer(archive) || archive.length !== artifact.size_in_bytes
    || 'sha256:' + sha256(archive) !== artifact.digest)
    return readonly('READBACK_ARTIFACT_ID_OR_DIGEST_UNPROVEN');
  const proof = decodeMailboxFreeReadbackArchiveV1(archive);
  if (!proof) return readonly('READBACK_ARCHIVE_INVALID_OR_UNBOUNDED');
  if (proof.schemaVersion !== READBACK_SCHEMA
    || proof.verdict !== 'READ_ONLY_GITHUB_EVIDENCE_CORRELATED'
    || proof.blocker !== ''
    || proof.originRunId !== originRun.id
    || !positive(proof.goalNumber)
    || proof.sourceHead !== mainHead
    || !positive(proof.originatingArtifactId)
    || typeof proof.artifactSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(proof.artifactSha256)
    || proof.sourceProofKind !== 'GITHUB_RUN_ARTIFACT_AND_GOAL_GET_VERIFIED'
    || proof.originalGoalAdmissionGranted !== false
    || proof.exclusiveClaimGranted !== false || proof.executionAuthorized !== false
    || proof.sourceMutationAllowed !== false || proof.protectedMergeAllowed !== false
    || proof.nativePickupProven !== false || proof.independentlyAuthenticatedNativeCustody !== false
    || proof.nextGate !== 'ORIGINAL_MISSION_OWNER_SOURCE_LEASE_AND_PICKUP_PROOF')
    return readonly('READBACK_SCOPE_OR_DENIAL_INVALID');
  if (!object(goal) || goal.number !== proof.goalNumber || goal.state !== 'open' || goal.pull_request != null)
    return readonly('ORIGINAL_GOAL_NOT_CURRENTLY_OPEN');
  return Object.freeze({
    schemaVersion: MAILBOX_FREE_GOAL_NOMINATION_SCHEMA,
    disposition: 'DISCOVERY_ONLY_NOT_ADMITTED',
    blocker: '',
    goalIssueNumber: proof.goalNumber,
    sourceHead: mainHead,
    originRunId: originRun.id,
    readbackRunId: readbackRun.id,
    readbackArtifactId: artifact.id,
    readbackArtifactSha256: sha256(archive),
    originArtifactId: proof.originatingArtifactId,
    originArtifactSha256: proof.artifactSha256,
    evidenceUrl: 'https://github.com/' + REPO + '/actions/runs/' + readbackRun.id,
    schedulerEligible: false,
    originalGoalAdmissionGranted: false,
    exclusiveClaimGranted: false,
    sourceMutationAllowed: false,
    protectedMergeAllowed: false,
    executionAuthorized: false,
    nativePickupProven: false,
    independentlyAuthenticatedNativeCustody: false,
    independentlyAuthenticatedTransport: false,
    nextGate: 'ORIGINAL_GOAL_OWNER_ADMISSION_AND_INDEPENDENT_NATIVE_CUSTODY',
  });
}
