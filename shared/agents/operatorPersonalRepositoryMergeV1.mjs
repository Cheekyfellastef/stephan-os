import { inflateRawSync } from 'node:zlib';
import {
  OPERATOR_MERGE_ENVIRONMENT,
  OPERATOR_MERGE_REVIEWER,
  validateProtectedEnvironment,
} from './operatorMergeApprovalGate.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const PERSONAL_REPOSITORY_ACTIVE_RUN_STATUSES = new Set(['queued', 'in_progress']);
const PERSONAL_REPOSITORY_RULESET_PROOF_PATHS = Object.freeze([
  /^\/repos\/[^/?]+\/[^/?]+$/,
  /^\/repos\/[^/?]+\/[^/?]+\/rules\/branches\/main\?per_page=100&page=(?:[1-9]|1[0-9]|20)$/,
  /^\/repos\/[^/?]+\/[^/?]+\/rulesets\/[1-9][0-9]*\?includes_parents=true$/,
]);

export const PERSONAL_REPOSITORY_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const PERSONAL_REPOSITORY_WORKFLOW_NAME = 'Protected Operator Merge Queue Boundary';
export const PERSONAL_REPOSITORY_EVIDENCE_JOB = 'personal-repository-evidence';
export const PERSONAL_REPOSITORY_APPROVAL_JOB = 'operator-personal-repository-approval';
export const PERSONAL_REPOSITORY_MERGE_JOB = 'operator-personal-repository-squash-merge';
export const PERSONAL_REPOSITORY_REQUIRED_CHECK = 'protected-merge-source-proof';
export const PERSONAL_REPOSITORY_MODE = 'user-owned-protected-squash';
export const PERSONAL_REPOSITORY_AUTHORITY = 'github-actions-protected-environment-exact-head-squash-only';
export const PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS = 3;
export const PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS = 120_000;
export const PERSONAL_REPOSITORY_CHECK_SNAPSHOT_POLL_INTERVAL_MS = 5_000;
export const PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_MAX_BYTES = 256 * 1024;
export const PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES = 256 * 1024;
export const PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX = 8;

export function validatePersonalRepositoryPriorJobEnvelope(run = {}, job = {}) {
  const blockers = [];
  const repository = workflowRepository(run);
  const runId = strictPositiveInteger(run?.id);
  const runAttempt = strictPositiveInteger(job?.run_attempt);
  const jobId = strictPositiveInteger(job?.id);
  const expectedJobUrl = `https://api.github.com/repos/${repository}/actions/jobs/${jobId}`;
  const expectedRunUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  const expectedCheckRunUrl = `https://api.github.com/repos/${repository}/check-runs/${jobId}`;
  const expectedHtmlUrl = `https://github.com/${repository}/actions/runs/${runId}/job/${jobId}`;
  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('prior-job-repository-invalid');
  if (!runId) blockers.push('prior-run-id-invalid');
  if (!jobId) blockers.push('prior-job-id-invalid');
  if (!runAttempt || runAttempt > strictPositiveInteger(run?.run_attempt)) blockers.push('prior-job-attempt-invalid');
  if (strictPositiveInteger(job?.run_id) !== runId) blockers.push('prior-job-parent-run-mismatch');
  if (text(job?.workflow_name) !== text(run?.name)) blockers.push('prior-job-workflow-name-mismatch');
  if (text(job?.head_branch) !== text(run?.head_branch)) blockers.push('prior-job-head-branch-mismatch');
  if (text(job?.head_sha).toLowerCase() !== text(run?.head_sha).toLowerCase()) blockers.push('prior-job-head-sha-mismatch');
  if (text(job?.url) !== expectedJobUrl) blockers.push('prior-job-api-url-mismatch');
  if (text(job?.run_url) !== expectedRunUrl) blockers.push('prior-job-run-url-mismatch');
  if (text(job?.check_run_url) !== expectedCheckRunUrl) blockers.push('prior-job-check-run-url-mismatch');
  if (text(job?.html_url) !== expectedHtmlUrl) blockers.push('prior-job-html-url-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    receipt: blockers.length === 0 ? Object.freeze({
      id: jobId,
      runId,
      runAttempt,
      workflowName: text(job?.workflow_name),
      headBranch: text(job?.head_branch),
      headSha: text(job?.head_sha).toLowerCase(),
      name: text(job?.name),
      status: text(job?.status).toLowerCase(),
      conclusion: text(job?.conclusion).toLowerCase(),
      url: text(job?.url),
      runUrl: text(job?.run_url),
      checkRunUrl: text(job?.check_run_url),
      htmlUrl: text(job?.html_url),
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_PRIOR_JOB_ENVELOPE_BLOCKED'
      : 'PERSONAL_REPOSITORY_PRIOR_JOB_ENVELOPE_READY',
  });
}

export function validatePersonalRepositoryReadOnlyPriorFailure(run = {}, jobs = []) {
  const blockers = [];
  const runId = strictPositiveInteger(run?.id);
  const runAttempt = strictPositiveInteger(run?.run_attempt);
  if (!runId) blockers.push('prior-run-id-invalid');
  if (!runAttempt) blockers.push('prior-run-attempt-invalid');
  if (runAttempt > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX) {
    blockers.push('prior-run-attempt-limit-exceeded');
  }
  const boundedRunAttempt = runAttempt > 0 && runAttempt <= PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX
    ? runAttempt
    : 0;
  if (text(run?.status).toLowerCase() !== 'completed') blockers.push('prior-run-not-completed');
  if (text(run?.conclusion).toLowerCase() !== 'failure') blockers.push('prior-run-not-failed');
  if (!Array.isArray(jobs)) blockers.push('prior-run-jobs-invalid');
  const jobList = Array.isArray(jobs) ? jobs : [];
  const authorityJobNames = new Set([
    PERSONAL_REPOSITORY_EVIDENCE_JOB,
    PERSONAL_REPOSITORY_APPROVAL_JOB,
    PERSONAL_REPOSITORY_MERGE_JOB,
  ]);
  const authorityJobs = jobList.filter((job) => authorityJobNames.has(text(job?.name)));
  if (boundedRunAttempt && authorityJobs.length !== boundedRunAttempt * authorityJobNames.size) {
    blockers.push('prior-run-authority-job-estate-not-exact');
  }
  const exactJob = (name, attempt) => {
    const matches = authorityJobs.filter((job) => (
      text(job?.name) === name && strictPositiveInteger(job?.run_attempt) === attempt
    ));
    if (matches.length !== 1) blockers.push(`prior-run-job-not-exact:${attempt}:${name}`);
    return matches.length === 1 ? matches[0] : {};
  };
  const selectedJobs = [];
  for (let attempt = 1; attempt <= boundedRunAttempt; attempt += 1) {
    const evidence = exactJob(PERSONAL_REPOSITORY_EVIDENCE_JOB, attempt);
    const approval = exactJob(PERSONAL_REPOSITORY_APPROVAL_JOB, attempt);
    const merge = exactJob(PERSONAL_REPOSITORY_MERGE_JOB, attempt);
    selectedJobs.push(evidence, approval, merge);
    if (text(evidence?.status).toLowerCase() !== 'completed'
      || text(evidence?.conclusion).toLowerCase() !== 'failure') {
      blockers.push(`prior-run-evidence-job-not-failed:${attempt}`);
    }
    if (text(approval?.status).toLowerCase() !== 'completed'
      || text(approval?.conclusion).toLowerCase() !== 'skipped') {
      blockers.push(`prior-run-approval-job-not-skipped:${attempt}`);
    }
    if (text(merge?.status).toLowerCase() !== 'completed'
      || text(merge?.conclusion).toLowerCase() !== 'skipped') {
      blockers.push(`prior-run-merge-job-not-skipped:${attempt}`);
    }
  }
  const jobIds = selectedJobs.map((job) => strictPositiveInteger(job?.id));
  if (jobIds.some((id) => !id) || new Set(jobIds).size !== selectedJobs.length) {
    blockers.push('prior-run-job-id-invalid');
  }
  const jobEnvelopeReceipts = [];
  for (const job of selectedJobs) {
    const envelope = validatePersonalRepositoryPriorJobEnvelope(run, job);
    if (!envelope.valid) {
      blockers.push(...envelope.blockers.map((blocker) => `prior-run-job-envelope:${blocker}`));
    } else jobEnvelopeReceipts.push(envelope.receipt);
  }
  return Object.freeze({
    valid: blockers.length === 0,
    receipt: blockers.length === 0 ? Object.freeze({
      runId,
      runAttempt,
      status: 'completed',
      conclusion: 'failure',
      jobs: Object.freeze(jobEnvelopeReceipts),
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_PRIOR_FAILURE_NOT_RETRYABLE'
      : 'PERSONAL_REPOSITORY_PRIOR_FAILURE_READ_ONLY',
  });
}

const PERSONAL_REPOSITORY_CHECK_SNAPSHOT_TRANSIENT_BLOCKERS = new Set([
  // GitHub exposes check runs and workflow runs through separate eventually-consistent collections.
  'personal-repository-check-runs-invalid',
  'personal-repository-check-workflow-run-missing',
  'personal-repository-check-run-identity-invalid',
  'personal-repository-review-escalation-check-not-exact',
]);

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_LOCAL_FILE_HEADER_BYTES = 30;
const ZIP_CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_DATA_DESCRIPTOR_BYTES = 16;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORED_METHOD = 0;
const ZIP_DEFLATED_METHOD = 8;

const PERSONAL_REPOSITORY_TRANSIENT_READ_STATUSES = new Set([502, 503, 504]);
const PERSONAL_REPOSITORY_READ_RETRY_DELAYS_MS = Object.freeze([250, 1_000]);
const PERSONAL_REPOSITORY_GITHUB_API_ORIGIN = 'https://api.github.com';
const PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_HOST = /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/;
const PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_PATH = /^\/actions-results\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/workflow-job-run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/artifacts\/[a-f0-9]{64}\.zip$/;
const PERSONAL_REPOSITORY_ARTIFACT_API_PATH = /^\/repos\/([^/?]+)\/([^/?]+)\/actions\/artifacts\/([1-9][0-9]*)\/zip$/;
const PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_QUERY_KEYS = Object.freeze([
  'rscd', 'rsct', 'se', 'sig', 'ske', 'skoid', 'sks', 'skt', 'sktid', 'skv', 'sp', 'spr', 'sr', 'st', 'sv',
]);

export const PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS = Object.freeze([
  Object.freeze({ name: 'OpenClaw GitHub Operator', path: '.github/workflows/openclaw-github-operator.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Protected Operator Merge Source Proof', path: '.github/workflows/operator-merge-approval-gate-test.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Exact-Head Review Dispatch', path: '.github/workflows/exact-head-review-dispatch.yml', event: 'pull_request' }),
  Object.freeze({ name: 'PR Clean Guard', path: '.github/workflows/pr-clean.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Build Stephanos UI', path: '.github/workflows/build-stephanos-ui.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Battle Bridge Publisher Proof', path: '.github/workflows/battle-bridge-publisher-proof.yml', event: 'pull_request' }),
  Object.freeze({ name: 'Codex Dispatch Queue Proof', path: '.github/workflows/codex-dispatch-queue-proof.yml', event: 'pull_request' }),
]);

const PERSONAL_REPOSITORY_REVIEW_ESCALATION = Object.freeze({
  workflow: 'Stephanos Exact-Head Review',
  path: '.github/workflows/stephanos-exact-head-review.yml',
  event: 'pull_request_target',
  check: 'exact-head-review',
  conclusion: 'failure',
});

const PERSONAL_REPOSITORY_NEUTRAL_SKIPPED_CHECKS = new Set([
  'Exact-Head Review Dispatch\0coordinate',
]);

function text(value) {
  return String(value ?? '').trim();
}

function boundedTransportCode(error) {
  const candidate = text(error?.cause?.code || error?.code).toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,39}$/.test(candidate) ? candidate : 'UNCLASSIFIED';
}

const ZIP_CRC32_TABLE = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
}));

function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ZIP_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export class PersonalRepositoryArtifactZipError extends Error {
  constructor(reason) {
    super(`Independent review artifact ZIP is invalid (${reason}).`);
    this.name = 'PersonalRepositoryArtifactZipError';
    this.code = 'PERSONAL_REPOSITORY_ARTIFACT_ZIP_INVALID';
    this.reason = reason;
  }
}

function invalidArtifactZip(reason) {
  throw new PersonalRepositoryArtifactZipError(reason);
}

function uint16(bytes, offset, reason) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.length) invalidArtifactZip(reason);
  return bytes.readUInt16LE(offset);
}

function uint32(bytes, offset, reason) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > bytes.length) invalidArtifactZip(reason);
  return bytes.readUInt32LE(offset);
}

function exactArtifactName(bytes, expectedFileName) {
  const expected = Buffer.from(expectedFileName, 'utf8');
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(bytes)) invalidArtifactZip('filename-encoding');
  if (decoded.includes('/')
    || decoded.includes('\\')
    || decoded === '.'
    || decoded === '..'
    || decoded.includes('\0')
    || /[\r\n]/.test(decoded)) {
    invalidArtifactZip('filename-unsafe');
  }
  if (!bytes.equals(expected)) invalidArtifactZip('filename-mismatch');
}

export function extractPersonalRepositoryArtifactZip(archiveBytes, expectedFileName) {
  if (!(Buffer.isBuffer(archiveBytes) || archiveBytes instanceof Uint8Array)) {
    invalidArtifactZip('archive-type');
  }
  if (typeof expectedFileName !== 'string'
    || expectedFileName.length === 0
    || expectedFileName.length > 255
    || !/^[A-Za-z0-9._-]+$/.test(expectedFileName)) {
    invalidArtifactZip('expected-filename');
  }
  const archive = Buffer.from(archiveBytes);
  if (archive.length < ZIP_LOCAL_FILE_HEADER_BYTES
      + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES
      + ZIP_END_OF_CENTRAL_DIRECTORY_BYTES
    || archive.length > PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_MAX_BYTES) {
    invalidArtifactZip('archive-size');
  }

  const endOffset = archive.length - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES;
  if (uint32(archive, endOffset, 'end-record') !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    invalidArtifactZip('end-signature');
  }
  const diskNumber = uint16(archive, endOffset + 4, 'end-record');
  const centralDisk = uint16(archive, endOffset + 6, 'end-record');
  const entriesOnDisk = uint16(archive, endOffset + 8, 'end-record');
  const totalEntries = uint16(archive, endOffset + 10, 'end-record');
  const centralSize = uint32(archive, endOffset + 12, 'end-record');
  const centralOffset = uint32(archive, endOffset + 16, 'end-record');
  const commentLength = uint16(archive, endOffset + 20, 'end-record');
  if (diskNumber !== 0 || centralDisk !== 0) invalidArtifactZip('multi-disk');
  if (entriesOnDisk !== 1 || totalEntries !== 1) invalidArtifactZip('entry-count');
  if (commentLength !== 0) invalidArtifactZip('archive-comment');
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff) invalidArtifactZip('zip64');
  if (centralOffset < ZIP_LOCAL_FILE_HEADER_BYTES
    || centralSize < ZIP_CENTRAL_DIRECTORY_HEADER_BYTES
    || centralOffset + centralSize !== endOffset) {
    invalidArtifactZip('central-boundary');
  }

  if (uint32(archive, centralOffset, 'central-record') !== ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
    invalidArtifactZip('central-signature');
  }
  const centralVersionNeeded = uint16(archive, centralOffset + 6, 'central-record');
  const centralFlags = uint16(archive, centralOffset + 8, 'central-record');
  const centralMethod = uint16(archive, centralOffset + 10, 'central-record');
  const centralModifiedTime = uint16(archive, centralOffset + 12, 'central-record');
  const centralModifiedDate = uint16(archive, centralOffset + 14, 'central-record');
  const centralCrc32 = uint32(archive, centralOffset + 16, 'central-record');
  const centralCompressedSize = uint32(archive, centralOffset + 20, 'central-record');
  const centralUncompressedSize = uint32(archive, centralOffset + 24, 'central-record');
  const centralNameLength = uint16(archive, centralOffset + 28, 'central-record');
  const centralExtraLength = uint16(archive, centralOffset + 30, 'central-record');
  const centralCommentLength = uint16(archive, centralOffset + 32, 'central-record');
  const centralDiskStart = uint16(archive, centralOffset + 34, 'central-record');
  const localOffset = uint32(archive, centralOffset + 42, 'central-record');
  const centralRecordBytes = ZIP_CENTRAL_DIRECTORY_HEADER_BYTES
    + centralNameLength
    + centralExtraLength
    + centralCommentLength;
  if (centralVersionNeeded < 10 || centralVersionNeeded > 20) invalidArtifactZip('version');
  if ((centralFlags & ~(ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG)) !== 0) invalidArtifactZip('flags');
  if (![ZIP_STORED_METHOD, ZIP_DEFLATED_METHOD].includes(centralMethod)) invalidArtifactZip('compression');
  if (centralCompressedSize === 0xffffffff || centralUncompressedSize === 0xffffffff) invalidArtifactZip('zip64');
  if (centralUncompressedSize > PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES) {
    invalidArtifactZip('payload-size');
  }
  if (centralNameLength === 0 || centralExtraLength !== 0 || centralCommentLength !== 0) {
    invalidArtifactZip('central-fields');
  }
  if (centralDiskStart !== 0) invalidArtifactZip('multi-disk');
  if (localOffset !== 0) invalidArtifactZip('archive-prefix');
  if (centralRecordBytes !== centralSize) invalidArtifactZip('central-size');
  const centralNameOffset = centralOffset + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES;
  const centralNameEnd = centralNameOffset + centralNameLength;
  if (centralNameEnd > endOffset) invalidArtifactZip('central-name-boundary');
  const centralName = archive.subarray(centralNameOffset, centralNameEnd);
  exactArtifactName(centralName, expectedFileName);

  if (uint32(archive, 0, 'local-record') !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    invalidArtifactZip('local-signature');
  }
  const localVersionNeeded = uint16(archive, 4, 'local-record');
  const localFlags = uint16(archive, 6, 'local-record');
  const localMethod = uint16(archive, 8, 'local-record');
  const localModifiedTime = uint16(archive, 10, 'local-record');
  const localModifiedDate = uint16(archive, 12, 'local-record');
  const localCrc32 = uint32(archive, 14, 'local-record');
  const localCompressedSize = uint32(archive, 18, 'local-record');
  const localUncompressedSize = uint32(archive, 22, 'local-record');
  const localNameLength = uint16(archive, 26, 'local-record');
  const localExtraLength = uint16(archive, 28, 'local-record');
  const usesDataDescriptor = (centralFlags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0;
  if (localVersionNeeded !== centralVersionNeeded
    || localFlags !== centralFlags
    || localMethod !== centralMethod
    || localModifiedTime !== centralModifiedTime
    || localModifiedDate !== centralModifiedDate
    || localNameLength !== centralNameLength
    || localExtraLength !== 0) {
    invalidArtifactZip('local-central-mismatch');
  }
  if (usesDataDescriptor) {
    if (localCrc32 !== 0 || localCompressedSize !== 0 || localUncompressedSize !== 0) {
      invalidArtifactZip('descriptor-local-fields');
    }
  } else if (localCrc32 !== centralCrc32
    || localCompressedSize !== centralCompressedSize
    || localUncompressedSize !== centralUncompressedSize) {
    invalidArtifactZip('local-central-mismatch');
  }
  const localNameOffset = ZIP_LOCAL_FILE_HEADER_BYTES;
  const localNameEnd = localNameOffset + localNameLength;
  if (localNameEnd > centralOffset) invalidArtifactZip('local-name-boundary');
  const localName = archive.subarray(localNameOffset, localNameEnd);
  if (!localName.equals(centralName)) invalidArtifactZip('local-central-name-mismatch');
  exactArtifactName(localName, expectedFileName);

  const dataOffset = localNameEnd;
  const dataEnd = dataOffset + centralCompressedSize;
  if (usesDataDescriptor) {
    const descriptorEnd = dataEnd + ZIP_DATA_DESCRIPTOR_BYTES;
    if (descriptorEnd !== centralOffset) invalidArtifactZip('descriptor-boundary');
    if (uint32(archive, dataEnd, 'descriptor') !== ZIP_DATA_DESCRIPTOR_SIGNATURE) {
      invalidArtifactZip('descriptor-signature');
    }
    if (uint32(archive, dataEnd + 4, 'descriptor') !== centralCrc32
      || uint32(archive, dataEnd + 8, 'descriptor') !== centralCompressedSize
      || uint32(archive, dataEnd + 12, 'descriptor') !== centralUncompressedSize) {
      invalidArtifactZip('descriptor-mismatch');
    }
  } else if (dataEnd !== centralOffset) {
    invalidArtifactZip('record-overlap-or-gap');
  }
  if (localMethod === ZIP_STORED_METHOD && centralCompressedSize !== centralUncompressedSize) {
    invalidArtifactZip('stored-size');
  }
  const compressed = archive.subarray(dataOffset, dataEnd);
  let payload;
  try {
    payload = localMethod === ZIP_STORED_METHOD
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES });
  } catch {
    invalidArtifactZip('decompression');
  }
  if (payload.length !== centralUncompressedSize
    || payload.length > PERSONAL_REPOSITORY_ARTIFACT_PAYLOAD_MAX_BYTES) {
    invalidArtifactZip('payload-size-mismatch');
  }
  if (zipCrc32(payload) !== centralCrc32) invalidArtifactZip('crc32');
  return Buffer.from(payload);
}

export class PersonalRepositoryReadTransportError extends Error {
  constructor(path, attempts, error) {
    const endpoint = text(path).replace(/[\r\n\t]/g, '').slice(0, 500) || 'unknown-endpoint';
    const transportCode = boundedTransportCode(error);
    super(`GitHub read transport failed for ${endpoint} after ${attempts} attempts (${transportCode}).`);
    this.name = 'PersonalRepositoryReadTransportError';
    this.code = 'PERSONAL_REPOSITORY_READ_TRANSPORT_EXHAUSTED';
    this.endpoint = endpoint;
    this.attempts = attempts;
    this.transportCode = transportCode;
  }
}

export class PersonalRepositoryReadPolicyError extends Error {
  constructor(path, blockers = []) {
    const endpoint = text(path).replace(/[\r\n\t]/g, '').slice(0, 500) || 'unknown-endpoint';
    const boundedBlockers = (Array.isArray(blockers) ? blockers : [])
      .map(text)
      .filter(Boolean)
      .slice(0, 10);
    super(`GitHub read response violated the bounded policy for ${endpoint}.`);
    this.name = 'PersonalRepositoryReadPolicyError';
    this.code = 'PERSONAL_REPOSITORY_READ_POLICY_VIOLATION';
    this.endpoint = endpoint;
    this.blockers = Object.freeze(boundedBlockers);
  }
}

export async function readBoundedPersonalRepositoryResponseBody(response, maxBytes) {
  const boundedMax = strictPositiveInteger(maxBytes);
  const reader = response?.body?.getReader?.();
  if (!boundedMax || !reader || typeof reader.read !== 'function') {
    await response?.body?.cancel?.();
    throw new PersonalRepositoryReadPolicyError('artifact-archive-body', [
      'personal-repository-artifact-archive-body-not-readable',
    ]);
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (!result || result.done === true) break;
      if (!(result.value instanceof Uint8Array) || result.value.length < 1) {
        throw new PersonalRepositoryReadPolicyError('artifact-archive-body', [
          'personal-repository-artifact-archive-body-chunk-invalid',
        ]);
      }
      totalBytes += result.value.length;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > boundedMax) {
        throw new PersonalRepositoryReadPolicyError('artifact-archive-body', [
          'personal-repository-artifact-archive-body-size-exceeded',
        ]);
      }
      chunks.push(Buffer.from(result.value));
    }
  } catch (error) {
    await reader.cancel?.();
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  if (totalBytes < 1) {
    throw new PersonalRepositoryReadPolicyError('artifact-archive-body', [
      'personal-repository-artifact-archive-body-empty',
    ]);
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function executeBoundedPersonalRepositoryRead({
  path,
  method = 'GET',
  body = null,
  request,
  validateResponse = null,
  consume = async (response) => response,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof request !== 'function') throw new TypeError('Personal-repository request function is required.');
  if (validateResponse !== null && typeof validateResponse !== 'function') {
    throw new TypeError('Personal-repository response validator must be a function when supplied.');
  }
  if (typeof consume !== 'function') throw new TypeError('Personal-repository response consumer is required.');
  if (typeof delay !== 'function') throw new TypeError('Personal-repository retry delay function is required.');
  const normalizedMethod = text(method || 'GET').toUpperCase();
  const readOnly = normalizedMethod === 'GET' && body === null;
  const maximumAttempts = readOnly ? PERSONAL_REPOSITORY_READ_MAX_ATTEMPTS : 1;
  let lastTransportError = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await request();
      const transientStatus = PERSONAL_REPOSITORY_TRANSIENT_READ_STATUSES.has(Number(response?.status));
      if (transientStatus && attempt < maximumAttempts) {
        await response?.body?.cancel?.();
      } else {
        if (validateResponse) {
          const validation = await validateResponse(response);
          if (validation?.valid !== true) {
            await response?.body?.cancel?.();
            throw new PersonalRepositoryReadPolicyError(path, validation?.blockers);
          }
        }
        const result = await consume(response);
        return Object.freeze({ response, result, attempts: attempt });
      }
    } catch (error) {
      if (error instanceof PersonalRepositoryReadPolicyError) throw error;
      if (!readOnly) throw error;
      lastTransportError = error;
      if (attempt === maximumAttempts) {
        throw new PersonalRepositoryReadTransportError(path, attempt, error);
      }
    }
    await delay(PERSONAL_REPOSITORY_READ_RETRY_DELAYS_MS[attempt - 1]);
  }

  throw new PersonalRepositoryReadTransportError(path, maximumAttempts, lastTransportError);
}

function strictPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function validatePersonalRepositoryRulesetProofRequest(input = {}) {
  const path = text(input.path);
  const method = text(input.method || 'GET').toUpperCase();
  const body = input.body ?? null;
  const repository = text(input.repository);
  const pathRepository = path.match(/^\/repos\/([^/?]+)\/([^/?]+)(?:$|\/)/);
  const blockers = [];
  if (method !== 'GET') blockers.push('personal-repository-ruleset-proof-method-not-read-only');
  if (body !== null) blockers.push('personal-repository-ruleset-proof-body-not-empty');
  if (!REPOSITORY_PATTERN.test(repository)
    || !pathRepository
    || `${pathRepository[1]}/${pathRepository[2]}` !== repository) {
    blockers.push('personal-repository-ruleset-proof-repository-mismatch');
  }
  if (!PERSONAL_REPOSITORY_RULESET_PROOF_PATHS.some((pattern) => pattern.test(path))) {
    blockers.push('personal-repository-ruleset-proof-path-not-bounded');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_RULESET_PROOF_REQUEST_BLOCKED'
      : 'PERSONAL_REPOSITORY_RULESET_PROOF_REQUEST_READY',
  });
}

export function validatePersonalRepositoryRulesetProofResponse(input = {}) {
  const path = text(input.path);
  const response = input.response;
  const expectedUrl = `${PERSONAL_REPOSITORY_GITHUB_API_ORIGIN}${path}`;
  const responseUrl = text(response?.url);
  const blockers = [];
  if (response?.redirected !== false) {
    blockers.push('personal-repository-ruleset-proof-response-redirected');
  }
  if (responseUrl !== expectedUrl) {
    blockers.push('personal-repository-ruleset-proof-response-url-mismatch');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    expectedUrl,
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_RULESET_PROOF_RESPONSE_BLOCKED'
      : 'PERSONAL_REPOSITORY_RULESET_PROOF_RESPONSE_READY',
  });
}

function responseHeader(response, name) {
  try {
    const value = response?.headers?.get?.(name);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function artifactArchiveUrl(location) {
  const raw = typeof location === 'string' ? location.trim() : '';
  if (!raw || raw.length > 4096 || /[\r\n\t]/.test(raw)) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function artifactArchiveUrlBlockers(location) {
  const url = artifactArchiveUrl(location);
  const blockers = [];
  if (!url) return ['personal-repository-artifact-archive-location-invalid'];
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) {
    blockers.push('personal-repository-artifact-archive-scheme-invalid');
  }
  if (url.username || url.password) blockers.push('personal-repository-artifact-archive-credentials-present');
  if (!PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_HOST.test(url.hostname)) {
    blockers.push('personal-repository-artifact-archive-host-not-allowlisted');
  }
  if (!PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_PATH.test(url.pathname)) {
    blockers.push('personal-repository-artifact-archive-path-not-bounded');
  }
  if (url.hash) blockers.push('personal-repository-artifact-archive-fragment-present');
  const observedKeys = [...new Set(url.searchParams.keys())].sort();
  const expectedKeys = [...PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_QUERY_KEYS].sort();
  if (observedKeys.length !== expectedKeys.length
    || observedKeys.some((key, index) => key !== expectedKeys[index])
    || observedKeys.some((key) => url.searchParams.getAll(key).length !== 1
      || !url.searchParams.get(key)
      || url.searchParams.get(key).length > 1024)) {
    blockers.push('personal-repository-artifact-archive-query-invalid');
  }
  if (url.searchParams.get('spr') !== 'https'
    || url.searchParams.get('sp') !== 'r'
    || url.searchParams.get('sr') !== 'b') {
    blockers.push('personal-repository-artifact-archive-scope-invalid');
  }
  return blockers;
}

export function buildPersonalRepositoryArtifactApiRequest(input = {}) {
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
  const pathMatch = path.match(PERSONAL_REPOSITORY_ARTIFACT_API_PATH);
  const blockers = [];
  if (!pathMatch || `${pathMatch?.[1]}/${pathMatch?.[2]}` !== repository) {
    blockers.push('personal-repository-artifact-api-path-mismatch');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    request: blockers.length
      ? null
      : Object.freeze({
        url: `${PERSONAL_REPOSITORY_GITHUB_API_ORIGIN}${path}`,
        method: 'GET',
        body: null,
        redirect: 'manual',
        headers: Object.freeze({ Accept: 'application/vnd.github+json' }),
      }),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_ARTIFACT_API_REQUEST_BLOCKED'
      : 'PERSONAL_REPOSITORY_ARTIFACT_API_REQUEST_READY',
  });
}

export function validatePersonalRepositoryArtifactArchiveRedirect(input = {}) {
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
  const response = input.response;
  const pathMatch = path.match(PERSONAL_REPOSITORY_ARTIFACT_API_PATH);
  const expectedUrl = `${PERSONAL_REPOSITORY_GITHUB_API_ORIGIN}${path}`;
  const location = responseHeader(response, 'location');
  const blockers = [];
  if (!pathMatch || `${pathMatch?.[1]}/${pathMatch?.[2]}` !== repository) {
    blockers.push('personal-repository-artifact-api-path-mismatch');
  }
  if (Number(response?.status) !== 302) blockers.push('personal-repository-artifact-redirect-status-invalid');
  if (response?.redirected !== false) blockers.push('personal-repository-artifact-api-response-redirected');
  if (typeof response?.url !== 'string' || response.url !== expectedUrl) {
    blockers.push('personal-repository-artifact-api-response-url-mismatch');
  }
  blockers.push(...artifactArchiveUrlBlockers(location));
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    location: blockers.length ? '' : location,
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_REDIRECT_BLOCKED'
      : 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_REDIRECT_READY',
  });
}

export function buildPersonalRepositoryArtifactArchiveRequest(location) {
  const blockers = artifactArchiveUrlBlockers(location);
  if (blockers.length) {
    return Object.freeze({
      valid: false,
      blockers: Object.freeze(blockers),
      request: null,
      finalVerdict: 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_REQUEST_BLOCKED',
    });
  }
  const url = artifactArchiveUrl(location).toString();
  return Object.freeze({
    valid: true,
    blockers: Object.freeze([]),
    request: Object.freeze({
      url,
      method: 'GET',
      body: null,
      redirect: 'manual',
      headers: Object.freeze({ Accept: 'application/zip' }),
    }),
    finalVerdict: 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_REQUEST_READY',
  });
}

export function validatePersonalRepositoryArtifactArchiveResponse(input = {}) {
  const expectedUrl = typeof input.expectedUrl === 'string' ? input.expectedUrl.trim() : '';
  const response = input.response;
  const maxBytes = strictPositiveInteger(input.maxBytes);
  const contentType = responseHeader(response, 'content-type').toLowerCase().split(';', 1)[0];
  const contentLengthRaw = responseHeader(response, 'content-length');
  const contentLength = /^[1-9][0-9]*$/.test(contentLengthRaw) ? Number(contentLengthRaw) : 0;
  const blockers = artifactArchiveUrlBlockers(expectedUrl);
  if (Number(response?.status) !== 200) blockers.push('personal-repository-artifact-archive-status-invalid');
  if (response?.redirected !== false) blockers.push('personal-repository-artifact-archive-response-redirected');
  if (typeof response?.url !== 'string' || response.url !== expectedUrl) {
    blockers.push('personal-repository-artifact-archive-response-url-mismatch');
  }
  if (contentType !== 'application/zip') blockers.push('personal-repository-artifact-archive-content-type-invalid');
  if (!maxBytes || !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxBytes) {
    blockers.push('personal-repository-artifact-archive-content-length-invalid');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    contentLength: blockers.length ? 0 : contentLength,
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_RESPONSE_BLOCKED'
      : 'PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_RESPONSE_READY',
  });
}

export async function executePersonalRepositoryArtifactArchiveTransport(input = {}) {
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
  const maxBytes = strictPositiveInteger(input.maxBytes);
  const requestApiRedirect = input.requestApiRedirect;
  const requestArchive = input.requestArchive;
  const delayOptions = input.delay === undefined ? {} : { delay: input.delay };
  const apiRequest = buildPersonalRepositoryArtifactApiRequest({ path, repository });
  const inputBlockers = [...apiRequest.blockers];
  if (!maxBytes || maxBytes > PERSONAL_REPOSITORY_ARTIFACT_ARCHIVE_MAX_BYTES) {
    inputBlockers.push('personal-repository-artifact-archive-max-bytes-invalid');
  }
  if (typeof requestApiRedirect !== 'function') {
    inputBlockers.push('personal-repository-artifact-api-request-function-invalid');
  }
  if (typeof requestArchive !== 'function') {
    inputBlockers.push('personal-repository-artifact-archive-request-function-invalid');
  }
  if (input.delay !== undefined && typeof input.delay !== 'function') {
    inputBlockers.push('personal-repository-artifact-delay-function-invalid');
  }
  if (inputBlockers.length) throw new PersonalRepositoryReadPolicyError(path, inputBlockers);

  const { response: redirectResponse } = await executeBoundedPersonalRepositoryRead({
    path,
    request: () => requestApiRedirect(apiRequest.request),
    validateResponse: (response) => validatePersonalRepositoryArtifactArchiveRedirect({
      path,
      repository,
      response,
    }),
    ...delayOptions,
  });
  const download = buildPersonalRepositoryArtifactArchiveRequest(
    responseHeader(redirectResponse, 'location'),
  );
  if (!download.valid) throw new PersonalRepositoryReadPolicyError(path, download.blockers);

  let declaredContentLength = 0;
  const { result: bytes } = await executeBoundedPersonalRepositoryRead({
    path: `${path}#credential-free-archive-download`,
    request: () => requestArchive(download.request),
    validateResponse: (response) => {
      const validation = validatePersonalRepositoryArtifactArchiveResponse({
        expectedUrl: download.request.url,
        response,
        maxBytes,
      });
      if (validation.valid) declaredContentLength = validation.contentLength;
      return validation;
    },
    consume: (response) => readBoundedPersonalRepositoryResponseBody(response, maxBytes),
    ...delayOptions,
  });
  if (!Buffer.isBuffer(bytes)
    || bytes.length < 1
    || bytes.length > maxBytes
    || bytes.length !== declaredContentLength) {
    throw new PersonalRepositoryReadPolicyError(path, [
      'personal-repository-artifact-archive-body-length-mismatch',
    ]);
  }
  return Buffer.from(bytes);
}

function parsePositiveInteger(value) {
  const raw = text(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observed = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return observed.length === expected.length
    && observed.every((key, index) => key === expected[index]);
}

function canonicalConfigurationValue(value) {
  if (Array.isArray(value)) return value.map(canonicalConfigurationValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalConfigurationValue(value[key])]
    )));
  }
  return value;
}

export function buildPersonalRepositoryConfigurationEvidence(input = {}) {
  const repository = input.repository && typeof input.repository === 'object' ? input.repository : {};
  const environment = input.environment && typeof input.environment === 'object' ? input.environment : {};
  const activeRules = (Array.isArray(input.activeRules) ? input.activeRules : [])
    .map(canonicalConfigurationValue)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const rulesets = (Array.isArray(input.rulesets) ? input.rulesets : [])
    .map((ruleset) => canonicalConfigurationValue({
      id: ruleset?.id,
      name: ruleset?.name,
      target: ruleset?.target,
      source_type: ruleset?.source_type,
      source: ruleset?.source,
      enforcement: ruleset?.enforcement,
      created_at: ruleset?.created_at,
      updated_at: ruleset?.updated_at,
      conditions: ruleset?.conditions,
      rules: ruleset?.rules,
      bypass_actors: ruleset?.bypass_actors,
    }))
    .sort((left, right) => Number(left.id) - Number(right.id));
  return Object.freeze(canonicalConfigurationValue({
    repository: {
      id: repository?.id,
      owner_type: repository?.owner?.type,
      private: repository?.private,
      visibility: repository?.visibility,
      default_branch: repository?.default_branch,
      allow_squash_merge: repository?.allow_squash_merge,
      delete_branch_on_merge: repository?.delete_branch_on_merge,
    },
    environment: {
      name: environment?.name,
      can_admins_bypass: environment?.can_admins_bypass,
      deployment_branch_policy: environment?.deployment_branch_policy,
      protection_rules: environment?.protection_rules,
    },
    activeRules,
    rulesets,
  }));
}

function workflowRepository(run = {}) {
  return text(run?.repository?.full_name || run?.repository);
}

function canonicalWorkflowPath(run = {}, repository = '') {
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  const suffix = path.slice(at + 1);
  const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  const pullRequest = pullRequests.length === 1 ? pullRequests[0] : null;
  const allowed = new Set([
    text(pullRequest?.head?.ref),
    text(pullRequest?.base?.ref),
    text(pullRequest?.head?.ref) ? `refs/heads/${text(pullRequest.head.ref)}` : '',
    text(pullRequest?.base?.ref) ? `refs/heads/${text(pullRequest.base.ref)}` : '',
    strictPositiveInteger(pullRequest?.number) ? `refs/pull/${pullRequest.number}/merge` : '',
  ].filter(Boolean));
  if (!allowed.has(suffix)) return '';
  return path.slice(0, at);
}

function canonicalPersonalRepositoryDispatchWorkflowPath(run = {}, repository = '') {
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  if (!['main', 'refs/heads/main'].includes(path.slice(at + 1))) return '';
  return path.slice(0, at);
}

function personalRepositoryDispatchActor(run = {}) {
  return text(run?.triggering_actor?.login || run?.actor?.login).toLowerCase();
}

function personalRepositoryDispatchTitle(sourceHead = '') {
  return `Protected operator merge ${text(sourceHead).toLowerCase()}`;
}

export function validatePersonalRepositoryDispatchWorkflowDefinition(definitions = []) {
  const blockers = [];
  if (!Array.isArray(definitions)) {
    blockers.push('personal-repository-workflow-definitions-invalid');
  }
  const matches = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
    text(definition?.path) === PERSONAL_REPOSITORY_WORKFLOW_PATH
  ));
  const definition = matches[0];
  if (matches.length !== 1
    || definition?.name !== PERSONAL_REPOSITORY_WORKFLOW_NAME
    || definition?.state !== 'active'
    || !strictPositiveInteger(definition?.id)) {
    blockers.push('personal-repository-workflow-definition-not-exact');
  }
  const valid = blockers.length === 0;
  return Object.freeze({
    valid,
    definition: valid ? Object.freeze({
      id: definition.id,
      name: definition.name,
      path: definition.path,
      state: definition.state,
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: valid
      ? 'PERSONAL_REPOSITORY_DISPATCH_WORKFLOW_DEFINITION_READY'
      : 'PERSONAL_REPOSITORY_DISPATCH_WORKFLOW_DEFINITION_BLOCKED',
  });
}

export function validatePersonalRepositoryDispatchExecution(input = {}, expected = {}) {
  const definitionValidation = validatePersonalRepositoryDispatchWorkflowDefinition(input.definitions);
  const definition = definitionValidation.definition;
  const run = input?.run && typeof input.run === 'object' && !Array.isArray(input.run)
    ? input.run
    : {};
  const priorRunsValid = Array.isArray(input?.priorRuns);
  const priorRuns = priorRunsValid ? input.priorRuns : [];
  const priorRunJobSetsValid = input?.priorRunJobSets === undefined || Array.isArray(input.priorRunJobSets);
  const priorRunJobSets = Array.isArray(input?.priorRunJobSets) ? input.priorRunJobSets : [];
  const repository = text(expected.repository);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const baseSha = text(expected.baseSha).toLowerCase();
  const workflowRunId = strictPositiveInteger(expected.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(expected.workflowRunAttempt);
  const expectedTitle = personalRepositoryDispatchTitle(sourceHead);
  const nativeOwnerActor = OPERATOR_MERGE_REVIEWER.toLowerCase();
  const mailboxAuthorization = expected?.mailboxAuthorization;
  const mailboxAuthorizationKeys = mailboxAuthorization && typeof mailboxAuthorization === 'object'
    && !Array.isArray(mailboxAuthorization)
    ? Object.keys(mailboxAuthorization).sort()
    : [];
  const expectedMailboxAuthorizationKeys = [
    'authorizedAtUtc',
    'commentId',
    'operatorAuthor',
    'requestId',
    'transportActor',
  ];
  const mailboxAuthorizationSupplied = expected?.mailboxAuthorization !== undefined;
  const mailboxAuthorizationValid = Boolean(
    mailboxAuthorizationSupplied
    && mailboxAuthorization
    && mailboxAuthorizationKeys.length === expectedMailboxAuthorizationKeys.length
    && mailboxAuthorizationKeys.every((key, index) => key === expectedMailboxAuthorizationKeys[index])
    && strictPositiveInteger(mailboxAuthorization.commentId)
    && text(mailboxAuthorization.requestId)
    && text(mailboxAuthorization.operatorAuthor).toLowerCase() === nativeOwnerActor
    && text(mailboxAuthorization.transportActor).toLowerCase() === 'github-actions[bot]'
    && EXPLICIT_TIMEZONE.test(text(mailboxAuthorization.authorizedAtUtc))
    && Number.isFinite(new Date(mailboxAuthorization.authorizedAtUtc).getTime())
  );
  const expectedActor = mailboxAuthorizationValid
    ? 'github-actions[bot]'
    : nativeOwnerActor;
  const currentMismatches = [
    ['run-id', strictPositiveInteger(run?.id) === workflowRunId],
    ['run-attempt', strictPositiveInteger(run?.run_attempt) === workflowRunAttempt],
    ['workflow-id', Boolean(definition) && strictPositiveInteger(run?.workflow_id) === definition.id],
    ['run-name', text(run?.name) === expectedTitle],
    ['event', text(run?.event) === 'workflow_dispatch'],
    ['repository', workflowRepository(run) === repository],
    ['base-head', SHA_PATTERN.test(baseSha) && text(run?.head_sha).toLowerCase() === baseSha],
    ['base-branch', text(run?.head_branch) === 'main'],
    ['display-title', text(run?.display_title) === expectedTitle],
    ['workflow-path', canonicalPersonalRepositoryDispatchWorkflowPath(run, repository) === PERSONAL_REPOSITORY_WORKFLOW_PATH],
    ['triggering-actor', personalRepositoryDispatchActor(run) === expectedActor],
    ['run-status', PERSONAL_REPOSITORY_ACTIVE_RUN_STATUSES.has(text(run?.status).toLowerCase())],
  ].filter(([, matches]) => !matches).map(([field]) => field);

  const malformedPriorRunIds = [];
  const replayRunIds = [];
  const retryablePriorRunIds = [];
  const retryablePriorFailures = [];
  const differentBasePriorRunIds = [];
  let sameBasePriorAttemptCount = 0;
  // GitHub keeps the workflow run ID when a run is retried and increments
  // run_attempt. The current exact run identity therefore proves that an
  // earlier attempt already existed even though the runs listing exposes only
  // the retried record under the current ID.
  if (workflowRunId && workflowRunAttempt > 1 && currentMismatches.length === 0) {
    replayRunIds.push(workflowRunId);
  }
  for (const candidate of priorRuns) {
    const candidateId = strictPositiveInteger(candidate?.id);
    if (candidateId && candidateId === workflowRunId) continue;
    const candidateActor = personalRepositoryDispatchActor(candidate);
    const sourceMatching = text(candidate?.name) === expectedTitle
      || text(candidate?.display_title) === expectedTitle;
    if (!sourceMatching || (candidateActor && candidateActor !== expectedActor)) continue;
    const candidateBase = text(candidate?.head_sha).toLowerCase();
    const exactIdentity = Boolean(
      candidateId
      && strictPositiveInteger(candidate?.run_attempt)
      && definition
      && strictPositiveInteger(candidate?.workflow_id) === definition.id
      && text(candidate?.name) === expectedTitle
      && text(candidate?.display_title) === expectedTitle
      && text(candidate?.event) === 'workflow_dispatch'
      && workflowRepository(candidate) === repository
      && SHA_PATTERN.test(candidateBase)
      && text(candidate?.head_branch) === 'main'
      && canonicalPersonalRepositoryDispatchWorkflowPath(candidate, repository) === PERSONAL_REPOSITORY_WORKFLOW_PATH
      && candidateActor === expectedActor
    );
    if (!exactIdentity) {
      malformedPriorRunIds.push(candidateId || 0);
      continue;
    }
    if (candidateBase === baseSha) {
      sameBasePriorAttemptCount = Math.min(
        PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1,
        sameBasePriorAttemptCount + Math.min(
          strictPositiveInteger(candidate?.run_attempt),
          PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX + 1,
        ),
      );
      const matchingJobSets = priorRunJobSets.filter((item) => strictPositiveInteger(item?.runId) === candidateId);
      const retryValidation = matchingJobSets.length === 1
        ? validatePersonalRepositoryReadOnlyPriorFailure(candidate, matchingJobSets[0]?.jobs)
        : { valid: false };
      if (retryValidation.valid) {
        retryablePriorRunIds.push(candidateId);
        retryablePriorFailures.push(retryValidation.receipt);
      }
      else replayRunIds.push(candidateId);
    } else differentBasePriorRunIds.push(candidateId);
  }

  const retryableJobIds = retryablePriorFailures.flatMap((receipt) => receipt.jobs.map((job) => job.id));
  const retryableProofDuplicate = new Set(retryablePriorRunIds).size !== retryablePriorRunIds.length
    || new Set(retryableJobIds).size !== retryableJobIds.length;
  const priorAttemptLimitExceeded = sameBasePriorAttemptCount > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX;
  if (priorAttemptLimitExceeded || retryableProofDuplicate) {
    replayRunIds.push(...retryablePriorRunIds);
    retryablePriorRunIds.length = 0;
    retryablePriorFailures.length = 0;
  }

  const blockers = [
    ...definitionValidation.blockers,
    ...(!priorRunsValid ? ['personal-repository-prior-runs-invalid'] : []),
    ...(!priorRunJobSetsValid ? ['personal-repository-prior-run-jobs-invalid'] : []),
    ...(priorRunJobSets.length > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX
      ? ['personal-repository-prior-run-jobs-limit-exceeded']
      : []),
    ...(priorAttemptLimitExceeded ? ['personal-repository-prior-run-attempt-limit-exceeded'] : []),
    ...(retryableProofDuplicate ? ['personal-repository-prior-run-proof-duplicate'] : []),
    ...(mailboxAuthorizationSupplied && !mailboxAuthorizationValid
      ? ['personal-repository-mailbox-authorization-provenance-invalid']
      : []),
    ...(currentMismatches.length ? ['personal-repository-workflow-run-identity-mismatch'] : []),
    ...(malformedPriorRunIds.length ? ['personal-repository-prior-attempt-invalid'] : []),
    ...(replayRunIds.length ? ['personal-repository-prior-attempt-exists'] : []),
  ];
  return Object.freeze({
    valid: blockers.length === 0,
    definition,
    currentMismatches: Object.freeze(currentMismatches),
    malformedPriorRunIds: Object.freeze(malformedPriorRunIds.sort((left, right) => left - right)),
    replayRunIds: Object.freeze(unique(replayRunIds).sort((left, right) => left - right)),
    retryablePriorRunIds: Object.freeze(retryablePriorRunIds.sort((left, right) => left - right)),
    retryablePriorFailures: Object.freeze(retryablePriorFailures.sort((left, right) => left.runId - right.runId)),
    sameBasePriorAttemptCount,
    differentBasePriorRunIds: Object.freeze(differentBasePriorRunIds.sort((left, right) => left - right)),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_DISPATCH_EXECUTION_BLOCKED'
      : 'PERSONAL_REPOSITORY_DISPATCH_EXECUTION_READY',
  });
}

export function parsePersonalRepositoryDispatchInputs(inputs = {}) {
  const parsed = Object.freeze({
    mode: text(inputs.mode),
    prNumber: parsePositiveInteger(inputs.pr_number),
    branch: text(inputs.expected_branch),
    sourceHead: text(inputs.expected_head).toLowerCase(),
    sourceTree: text(inputs.expected_head_tree).toLowerCase(),
    baseSha: text(inputs.expected_base).toLowerCase(),
    independentReviewWorkflowRunId: parsePositiveInteger(inputs.independent_review_run_id),
    independentReviewWorkflowRunAttempt: parsePositiveInteger(inputs.independent_review_run_attempt),
    independentReviewArtifactId: parsePositiveInteger(inputs.independent_review_artifact_id),
    independentReviewArtifactDigest: text(inputs.independent_review_artifact_digest).toLowerCase(),
    independentReviewPayloadSha256: text(inputs.independent_review_payload_sha256).toLowerCase(),
  });
  const blockers = [];
  if (parsed.mode !== PERSONAL_REPOSITORY_MODE) blockers.push('personal-repository-mode-not-exact');
  if (!parsed.prNumber) blockers.push('personal-repository-pr-invalid');
  if (!BRANCH_PATTERN.test(parsed.branch) || parsed.branch.includes('..')) blockers.push('personal-repository-branch-invalid');
  for (const [key, blocker] of [
    ['sourceHead', 'personal-repository-head-invalid'],
    ['sourceTree', 'personal-repository-tree-invalid'],
    ['baseSha', 'personal-repository-base-invalid'],
  ]) {
    if (!SHA_PATTERN.test(parsed[key])) blockers.push(blocker);
  }
  if (parsed.sourceHead && parsed.sourceHead === parsed.baseSha) blockers.push('personal-repository-head-equals-base');
  if (!parsed.independentReviewWorkflowRunId) blockers.push('personal-repository-review-run-invalid');
  if (!parsed.independentReviewWorkflowRunAttempt) blockers.push('personal-repository-review-attempt-invalid');
  if (!parsed.independentReviewArtifactId) blockers.push('personal-repository-review-artifact-id-invalid');
  if (!ARTIFACT_DIGEST_PATTERN.test(parsed.independentReviewArtifactDigest)) {
    blockers.push('personal-repository-review-artifact-digest-invalid');
  }
  if (!SHA256_PATTERN.test(parsed.independentReviewPayloadSha256)) {
    blockers.push('personal-repository-review-payload-digest-invalid');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    identity: parsed,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_DISPATCH_BLOCKED'
      : 'PERSONAL_REPOSITORY_DISPATCH_READY',
  });
}

export function validatePersonalRepositoryWorkflowRuns(definitions = [], runs = [], expected = {}) {
  const blockers = [];
  const evidence = [];
  const repository = text(expected.repository);
  const prNumber = strictPositiveInteger(expected.prNumber);
  const branch = text(expected.branch);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const baseSha = text(expected.baseSha).toLowerCase();
  if (!Array.isArray(definitions)) blockers.push('personal-repository-workflow-definitions-invalid');
  if (!Array.isArray(runs)) blockers.push('personal-repository-workflow-runs-invalid');
  for (const required of PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS) {
    const matches = (Array.isArray(definitions) ? definitions : []).filter((definition) => (
      text(definition?.path) === required.path
    ));
    const definition = matches[0];
    if (matches.length !== 1
      || definition?.name !== required.name
      || definition?.state !== 'active'
      || !strictPositiveInteger(definition?.id)) {
      blockers.push(`personal-repository-workflow-definition-not-exact:${required.name}`);
      continue;
    }
    const candidates = (Array.isArray(runs) ? runs : []).filter((run) => (
      strictPositiveInteger(run?.workflow_id) === definition.id
      && text(run?.name) === required.name
      && canonicalWorkflowPath(run, repository) === required.path
      && text(run?.event) === required.event
      && workflowRepository(run) === repository
      && text(run?.head_sha).toLowerCase() === sourceHead
    )).sort((left, right) => (
      strictPositiveInteger(right?.run_number) - strictPositiveInteger(left?.run_number)
      || strictPositiveInteger(right?.id) - strictPositiveInteger(left?.id)
    ));
    const run = candidates[0];
    const bindings = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    const binding = bindings.length === 1 ? bindings[0] : null;
    if (!run
      || text(run?.status).toLowerCase() !== 'completed'
      || text(run?.conclusion).toLowerCase() !== 'success'
      || !strictPositiveInteger(run?.id)
      || !strictPositiveInteger(run?.run_attempt)
      || bindings.length !== 1
      || strictPositiveInteger(binding?.number) !== prNumber
      || text(binding?.head?.sha).toLowerCase() !== sourceHead
      || text(binding?.head?.ref) !== branch
      || text(binding?.base?.sha).toLowerCase() !== baseSha
      || text(binding?.base?.ref) !== 'main') {
      blockers.push(`personal-repository-workflow-run-not-exact-green:${required.name}`);
      continue;
    }
    evidence.push(Object.freeze({
      name: required.name,
      path: required.path,
      workflowId: definition.id,
      runId: run.id,
      runAttempt: run.run_attempt,
      checkSuiteId: strictPositiveInteger(run?.check_suite_id) || null,
    }));
  }
  return Object.freeze({
    valid: blockers.length === 0 && evidence.length === PERSONAL_REPOSITORY_REQUIRED_WORKFLOWS.length,
    evidence: Object.freeze(evidence),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_WORKFLOWS_BLOCKED'
      : 'PERSONAL_REPOSITORY_WORKFLOWS_READY',
  });
}

export function validatePersonalRepositoryWorkflowRunHydration(
  summaries = [],
  details = [],
  expected = {},
) {
  const blockers = [];
  const sourceHead = text(expected.sourceHead).toLowerCase();
  if (!Array.isArray(summaries) || summaries.length === 0) {
    blockers.push('personal-repository-workflow-run-summaries-invalid');
  }
  if (!Array.isArray(details) || details.length === 0) {
    blockers.push('personal-repository-workflow-run-details-invalid');
  }
  if (!SHA_PATTERN.test(sourceHead)) {
    blockers.push('personal-repository-workflow-run-hydration-head-invalid');
  }

  const summaryIds = new Set();
  const detailById = new Map();
  for (const detail of Array.isArray(details) ? details : []) {
    const detailId = strictPositiveInteger(detail?.id);
    if (!detailId || detailById.has(detailId)) {
      blockers.push('personal-repository-workflow-run-detail-identity-invalid');
      continue;
    }
    detailById.set(detailId, detail);
  }

  const hydratedRuns = [];
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    const summaryId = strictPositiveInteger(summary?.id);
    const workflowId = strictPositiveInteger(summary?.workflow_id);
    const checkSuiteId = strictPositiveInteger(summary?.check_suite_id);
    if (!summaryId || !workflowId || !checkSuiteId
      || text(summary?.head_sha).toLowerCase() !== sourceHead
      || summaryIds.has(summaryId)) {
      blockers.push('personal-repository-workflow-run-summary-identity-invalid');
      continue;
    }
    summaryIds.add(summaryId);
    const detail = detailById.get(summaryId);
    if (!detail
      || strictPositiveInteger(detail?.workflow_id) !== workflowId
      || strictPositiveInteger(detail?.check_suite_id) !== checkSuiteId
      || text(detail?.head_sha).toLowerCase() !== sourceHead) {
      blockers.push('personal-repository-workflow-run-detail-mismatch');
      continue;
    }
    hydratedRuns.push(detail);
  }
  if (summaryIds.size !== detailById.size) {
    blockers.push('personal-repository-workflow-run-hydration-cardinality-mismatch');
  }

  const valid = blockers.length === 0 && hydratedRuns.length === summaryIds.size;
  return Object.freeze({
    valid,
    runs: valid ? Object.freeze([...hydratedRuns]) : Object.freeze([]),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: valid
      ? 'PERSONAL_REPOSITORY_WORKFLOW_RUN_HYDRATION_READY'
      : 'PERSONAL_REPOSITORY_WORKFLOW_RUN_HYDRATION_BLOCKED',
  });
}

export function buildPersonalRepositoryCheckExpectation({
  repository = '',
  identity = {},
  mergeStateStatus = '',
} = {}) {
  const expected = Object.freeze({
    repository: text(repository),
    prNumber: strictPositiveInteger(identity?.prNumber),
    branch: text(identity?.branch),
    sourceHead: text(identity?.sourceHead).toLowerCase(),
    baseSha: text(identity?.baseSha).toLowerCase(),
    mergeStateStatus: text(mergeStateStatus).toUpperCase(),
  });
  const blockers = [];
  if (!REPOSITORY_PATTERN.test(expected.repository)) {
    blockers.push('personal-repository-check-expectation-repository-invalid');
  }
  if (!expected.prNumber) blockers.push('personal-repository-check-expectation-pr-invalid');
  if (!BRANCH_PATTERN.test(expected.branch) || expected.branch.includes('..')) {
    blockers.push('personal-repository-check-expectation-branch-invalid');
  }
  if (!SHA_PATTERN.test(expected.sourceHead)) {
    blockers.push('personal-repository-check-expectation-head-invalid');
  }
  if (!SHA_PATTERN.test(expected.baseSha)) {
    blockers.push('personal-repository-check-expectation-base-invalid');
  }
  if (!['CLEAN', 'UNSTABLE'].includes(expected.mergeStateStatus)) {
    blockers.push('personal-repository-check-expectation-merge-state-invalid');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    expected: blockers.length === 0 ? expected : null,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_CHECK_EXPECTATION_BLOCKED'
      : 'PERSONAL_REPOSITORY_CHECK_EXPECTATION_READY',
  });
}

export function validatePersonalRepositoryCheckRuns(
  checkRuns = [],
  workflowRuns = [],
  commitStatuses = [],
  expected = {},
  options = {},
) {
  const blockers = [];
  const evidence = [];
  const repository = text(expected.repository);
  const prNumber = strictPositiveInteger(expected.prNumber);
  const branch = text(expected.branch);
  const sourceHead = text(expected.sourceHead).toLowerCase();
  const baseSha = text(expected.baseSha).toLowerCase();
  const mergeStateStatus = text(expected.mergeStateStatus).toUpperCase();
  const cleanIndependentReviewProved = options.cleanIndependentReviewProved === true;
  let admittedReviewEscalations = 0;

  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    blockers.push('personal-repository-check-runs-invalid');
  }
  if (!Array.isArray(workflowRuns)) blockers.push('personal-repository-check-workflow-runs-invalid');
  if (!Array.isArray(commitStatuses)) blockers.push('personal-repository-commit-statuses-invalid');

  const exactCheckBindings = (Array.isArray(checkRuns) ? checkRuns : []).map((check) => {
    const checkId = strictPositiveInteger(check?.id);
    const checkSuiteId = strictPositiveInteger(check?.check_suite?.id);
    const matchingRuns = (Array.isArray(workflowRuns) ? workflowRuns : []).filter((run) => (
      strictPositiveInteger(run?.check_suite_id) === checkSuiteId
      && text(run?.head_sha).toLowerCase() === sourceHead
    ));
    const run = matchingRuns[0];
    const bindings = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    const binding = bindings.length === 1 ? bindings[0] : null;
    const detailsUrl = `https://github.com/${repository}/actions/runs/${run?.id}/job/${checkId}`;
    const exactRun = matchingRuns.length === 1
      && strictPositiveInteger(run?.id)
      && strictPositiveInteger(run?.run_attempt)
      && workflowRepository(run) === repository
      && bindings.length === 1
      && strictPositiveInteger(binding?.number) === prNumber
      && text(binding?.head?.sha).toLowerCase() === sourceHead
      && text(binding?.head?.ref) === branch
      && text(binding?.base?.sha).toLowerCase() === baseSha
      && text(binding?.base?.ref) === 'main'
      && text(check?.details_url) === detailsUrl;
    return Object.freeze({ check, checkId, checkSuiteId, matchingRuns, run, exactRun });
  });

  for (const status of Array.isArray(commitStatuses) ? commitStatuses : []) {
    if (text(status?.sha).toLowerCase() !== sourceHead
      || text(status?.state).toLowerCase() !== 'success') {
      blockers.push('personal-repository-commit-status-not-exact-green');
    }
  }

  for (const checkBinding of exactCheckBindings) {
    const { check, checkId, checkSuiteId, matchingRuns, run, exactRun } = checkBinding;
    const name = text(check?.name);
    const status = text(check?.status).toLowerCase();
    const conclusion = text(check?.conclusion).toLowerCase();
    const workflow = text(run?.name);
    const path = canonicalWorkflowPath(run, repository);

    if (!checkId || !checkSuiteId || !name
      || text(check?.head_sha).toLowerCase() !== sourceHead
      || text(check?.app?.slug) !== 'github-actions'
      || strictPositiveInteger(check?.app?.id) !== 15368) {
      blockers.push('personal-repository-check-run-identity-invalid');
      continue;
    }
    if (matchingRuns.length === 0) {
      blockers.push('personal-repository-check-workflow-run-missing');
      continue;
    }
    if (!exactRun) {
      blockers.push('personal-repository-check-run-identity-invalid');
      continue;
    }

    const supersededDraftSkip = conclusion === 'skipped'
      && workflow === PERSONAL_REPOSITORY_REVIEW_ESCALATION.workflow
      && path === PERSONAL_REPOSITORY_REVIEW_ESCALATION.path
      && text(run?.event) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.event
      && name === PERSONAL_REPOSITORY_REVIEW_ESCALATION.check
      && exactCheckBindings.some((candidate) => (
        candidate !== checkBinding
        && candidate.exactRun
        && strictPositiveInteger(candidate.run?.id) > strictPositiveInteger(run?.id)
        && text(candidate.check?.head_sha).toLowerCase() === sourceHead
        && text(candidate.check?.status).toLowerCase() === 'completed'
        && text(candidate.check?.conclusion).toLowerCase() === 'success'
        && text(candidate.check?.name) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.check
        && text(candidate.check?.app?.slug) === 'github-actions'
        && strictPositiveInteger(candidate.check?.app?.id) === 15368
        && text(candidate.run?.name) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.workflow
        && canonicalWorkflowPath(candidate.run, repository) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.path
        && text(candidate.run?.event) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.event
      ));

    let disposition = 'green';
    if (status !== 'completed') {
      blockers.push('personal-repository-check-run-not-terminal');
      disposition = 'blocked';
    } else if (conclusion === 'success') {
      // Exact successful check.
    } else if (conclusion === 'skipped'
      && PERSONAL_REPOSITORY_NEUTRAL_SKIPPED_CHECKS.has(`${workflow}\0${name}`)) {
      disposition = 'neutral-skip';
    } else if (supersededDraftSkip) {
      disposition = 'superseded-draft-skip';
    } else if (cleanIndependentReviewProved
      && conclusion === 'skipped'
      && workflow === PERSONAL_REPOSITORY_REVIEW_ESCALATION.workflow
      && path === PERSONAL_REPOSITORY_REVIEW_ESCALATION.path
      && text(run?.event) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.event
      && name === PERSONAL_REPOSITORY_REVIEW_ESCALATION.check) {
      disposition = 'clean-independent-review-superseded-draft-skip';
    } else if (cleanIndependentReviewProved
      && mergeStateStatus === 'UNSTABLE'
      && workflow === PERSONAL_REPOSITORY_REVIEW_ESCALATION.workflow
      && path === PERSONAL_REPOSITORY_REVIEW_ESCALATION.path
      && text(run?.event) === PERSONAL_REPOSITORY_REVIEW_ESCALATION.event
      && name === PERSONAL_REPOSITORY_REVIEW_ESCALATION.check
      && conclusion === PERSONAL_REPOSITORY_REVIEW_ESCALATION.conclusion) {
      admittedReviewEscalations += 1;
      disposition = 'clean-independent-review';
    } else {
      blockers.push('personal-repository-check-run-not-exact-green');
      disposition = 'blocked';
    }

    evidence.push(Object.freeze({
      checkId,
      checkSuiteId,
      name,
      workflow,
      path,
      workflowRunId: run.id,
      workflowRunAttempt: run.run_attempt,
      status,
      conclusion,
      disposition,
    }));
  }

  if (mergeStateStatus === 'UNSTABLE' && admittedReviewEscalations !== 1) {
    blockers.push('personal-repository-review-escalation-check-not-exact');
  }
  if (mergeStateStatus === 'CLEAN' && admittedReviewEscalations !== 0) {
    blockers.push('personal-repository-clean-state-has-review-escalation');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    evidence: Object.freeze(evidence),
    admittedReviewEscalations,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_CHECK_RUNS_BLOCKED'
      : 'PERSONAL_REPOSITORY_CHECK_RUNS_READY',
  });
}

export async function validatePersonalRepositoryCheckRunsWithBoundedReread({
  readSnapshot,
  waitBeforeReread = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  monotonicNow = () => performance.now(),
  expected = {},
  options = {},
} = {}) {
  if (typeof readSnapshot !== 'function'
    || typeof waitBeforeReread !== 'function'
    || typeof monotonicNow !== 'function') {
    return Object.freeze({
      valid: false,
      evidence: Object.freeze([]),
      admittedReviewEscalations: 0,
      blockers: Object.freeze(['personal-repository-check-snapshot-reader-invalid']),
      snapshotAttempt: 0,
      snapshotAttempts: Object.freeze([]),
      selectedSnapshot: null,
      convergenceDeadlineReached: false,
      finalVerdict: 'PERSONAL_REPOSITORY_CHECK_RUNS_BLOCKED',
    });
  }

  const snapshotAttempts = [];
  const startedAtMs = monotonicNow();
  const deadlineMs = startedAtMs + PERSONAL_REPOSITORY_CHECK_SNAPSHOT_CONVERGENCE_TIMEOUT_MS;
  if (!Number.isFinite(startedAtMs)) {
    return Object.freeze({
      valid: false,
      evidence: Object.freeze([]),
      admittedReviewEscalations: 0,
      blockers: Object.freeze(['personal-repository-check-snapshot-clock-invalid']),
      snapshotAttempt: 0,
      snapshotAttempts: Object.freeze([]),
      selectedSnapshot: null,
      convergenceDeadlineReached: false,
      finalVerdict: 'PERSONAL_REPOSITORY_CHECK_RUNS_BLOCKED',
    });
  }
  let validation = null;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const snapshot = await readSnapshot(attempt);
    validation = validatePersonalRepositoryCheckRuns(
      snapshot?.checkRuns,
      snapshot?.workflowRuns,
      snapshot?.commitStatuses,
      expected,
      options,
    );
    const retryable = validation.blockers.length > 0
      && validation.blockers.every((blocker) => (
        PERSONAL_REPOSITORY_CHECK_SNAPSHOT_TRANSIENT_BLOCKERS.has(blocker)
      ));
    snapshotAttempts.push(Object.freeze({
      attempt,
      valid: validation.valid,
      retryable,
      blockers: validation.blockers,
    }));
    if (validation.valid) {
      const selectedSnapshot = Object.freeze({
        checkRuns: Object.freeze([...snapshot.checkRuns]),
        workflowRuns: Object.freeze([...snapshot.workflowRuns]),
        commitStatuses: Object.freeze([...snapshot.commitStatuses]),
      });
      return Object.freeze({
        ...validation,
        snapshotAttempt: attempt,
        snapshotAttempts: Object.freeze(snapshotAttempts),
        selectedSnapshot,
        convergenceDeadlineReached: false,
      });
    }

    const beforeWaitMs = monotonicNow();
    const remainingMs = deadlineMs - beforeWaitMs;
    if (!retryable || !Number.isFinite(beforeWaitMs) || remainingMs <= 0) {
      return Object.freeze({
        ...validation,
        snapshotAttempt: 0,
        snapshotAttempts: Object.freeze(snapshotAttempts),
        selectedSnapshot: null,
        convergenceDeadlineReached: retryable && Number.isFinite(beforeWaitMs) && remainingMs <= 0,
      });
    }
    await waitBeforeReread(Math.min(
      PERSONAL_REPOSITORY_CHECK_SNAPSHOT_POLL_INTERVAL_MS,
      remainingMs,
    ));
    const afterWaitMs = monotonicNow();
    if (!Number.isFinite(afterWaitMs) || afterWaitMs <= beforeWaitMs) {
      return Object.freeze({
        ...validation,
        valid: false,
        blockers: Object.freeze(unique([
          ...validation.blockers,
          'personal-repository-check-snapshot-clock-invalid',
        ])),
        snapshotAttempt: 0,
        snapshotAttempts: Object.freeze(snapshotAttempts),
        selectedSnapshot: null,
        convergenceDeadlineReached: false,
        finalVerdict: 'PERSONAL_REPOSITORY_CHECK_RUNS_BLOCKED',
      });
    }
  }
}

export function validatePersonalRepositoryEvidence(input = {}, expected = {}, options = {}) {
  const blockers = [];
  const repository = text(input.repository);
  const pullRequest = input.pullRequest && typeof input.pullRequest === 'object' ? input.pullRequest : {};
  const liveMainRef = text(input?.liveMainRef?.object?.sha ?? input?.liveMainRef?.sha).toLowerCase();
  const sourceHead = text(pullRequest?.head?.sha).toLowerCase();
  const sourceTree = text(input?.headCommit?.tree?.sha ?? input?.headCommit?.tree).toLowerCase();
  const baseSha = text(pullRequest?.base?.sha).toLowerCase();
  const branch = text(pullRequest?.head?.ref);
  const prNumber = strictPositiveInteger(pullRequest?.number);
  const workflowRunId = strictPositiveInteger(input.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(input.workflowRunAttempt);
  const reviewDecisionObserved = Object.hasOwn(input, 'reviewDecision');
  const reviewDecision = text(input.reviewDecision).toUpperCase();
  const mergeable = text(input.mergeable).toUpperCase();
  const mergeStateStatus = text(input.mergeStateStatus).toUpperCase();
  const cleanIndependentReviewProved = options.cleanIndependentReviewProved === true;
  const reviewEscalationChecksProved = options.reviewEscalationChecksProved === true;
  const comparison = input.comparison && typeof input.comparison === 'object' ? input.comparison : {};

  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('personal-repository-repository-invalid');
  if (input.eventName !== 'workflow_dispatch') blockers.push('personal-repository-event-not-workflow-dispatch');
  if (text(input.repositoryOwnerType).toLowerCase() !== 'user') blockers.push('personal-repository-owner-not-user');
  if (text(input.triggeringActor).toLowerCase() !== OPERATOR_MERGE_REVIEWER.toLowerCase()) {
    blockers.push('personal-repository-triggering-actor-not-operator');
  }
  if (!workflowRunId) blockers.push('personal-repository-workflow-run-invalid');
  if (!workflowRunAttempt) blockers.push('personal-repository-workflow-attempt-invalid');
  if (!prNumber) blockers.push('personal-repository-pr-number-invalid');
  if (text(pullRequest.state).toLowerCase() !== 'open') blockers.push('personal-repository-pr-not-open');
  if (pullRequest.draft !== false) blockers.push('personal-repository-pr-draft');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) blockers.push('personal-repository-pr-branch-invalid');
  if (!SHA_PATTERN.test(sourceHead)) blockers.push('personal-repository-source-head-invalid');
  if (!SHA_PATTERN.test(sourceTree)) blockers.push('personal-repository-source-tree-invalid');
  if (text(input?.headCommit?.sha).toLowerCase() !== sourceHead) blockers.push('personal-repository-head-commit-mismatch');
  if (text(pullRequest?.base?.ref) !== 'main') blockers.push('personal-repository-base-ref-not-main');
  if (!SHA_PATTERN.test(baseSha)) blockers.push('personal-repository-base-sha-invalid');
  if (liveMainRef !== baseSha) blockers.push('personal-repository-live-main-mismatch');
  if (sourceHead && sourceHead === baseSha) blockers.push('personal-repository-head-equals-base');
  if (!reviewDecisionObserved) blockers.push('personal-repository-review-decision-missing');
  if (reviewDecision === 'CHANGES_REQUESTED') blockers.push('personal-repository-changes-requested');
  else if (!['', 'APPROVED'].includes(reviewDecision)) blockers.push('personal-repository-review-decision-unsupported');
  if (mergeable !== 'MERGEABLE') blockers.push('personal-repository-pr-not-mergeable');
  if (mergeStateStatus !== 'CLEAN'
    && !(mergeStateStatus === 'UNSTABLE'
      && cleanIndependentReviewProved
      && reviewEscalationChecksProved)) {
    blockers.push('personal-repository-pr-not-clean');
  }
  if (!Number.isSafeInteger(input.unresolvedThreadCount) || input.unresolvedThreadCount !== 0) {
    blockers.push('personal-repository-conversations-not-resolved');
  }
  if (text(comparison.status).toLowerCase() !== 'ahead'
    || !Number.isSafeInteger(comparison.ahead_by)
    || comparison.ahead_by < 1
    || comparison.behind_by !== 0
    || text(comparison?.base_commit?.sha).toLowerCase() !== baseSha
    || text(comparison?.merge_base_commit?.sha).toLowerCase() !== baseSha) {
    blockers.push('personal-repository-comparison-not-exact-forward');
  }

  for (const [key, observed, normalize, blocker] of [
    ['repository', repository, text(expected.repository), 'personal-repository-expected-repository-mismatch'],
    ['prNumber', prNumber, strictPositiveInteger(expected.prNumber), 'personal-repository-expected-pr-mismatch'],
    ['branch', branch, text(expected.branch), 'personal-repository-expected-branch-mismatch'],
    ['sourceHead', sourceHead, text(expected.sourceHead).toLowerCase(), 'personal-repository-expected-head-mismatch'],
    ['sourceTree', sourceTree, text(expected.sourceTree).toLowerCase(), 'personal-repository-expected-tree-mismatch'],
    ['baseSha', baseSha, text(expected.baseSha).toLowerCase(), 'personal-repository-expected-base-mismatch'],
    ['workflowRunId', workflowRunId, strictPositiveInteger(expected.workflowRunId), 'personal-repository-expected-run-mismatch'],
    ['workflowRunAttempt', workflowRunAttempt, strictPositiveInteger(expected.workflowRunAttempt), 'personal-repository-expected-attempt-mismatch'],
  ]) {
    if (Object.hasOwn(expected, key) && (!normalize || observed !== normalize)) blockers.push(blocker);
  }

  return Object.freeze({
    valid: blockers.length === 0,
    identity: Object.freeze({
      repository,
      prNumber,
      branch,
      sourceHead,
      sourceTree,
      baseSha,
      workflowRunId,
      workflowRunAttempt,
      mergeStateStatus,
      reviewAdjudication: mergeStateStatus === 'UNSTABLE'
        ? 'clean-independent-review'
        : 'native-clean',
    }),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_EVIDENCE_BLOCKED'
      : 'PERSONAL_REPOSITORY_EVIDENCE_READY',
  });
}

function rulesOfType(activeRules, type) {
  return activeRules.filter((rule) => text(rule?.type).toLowerCase() === type);
}

function configurationNotProved(blockers, detail) {
  blockers.push(`CONFIGURATION_NOT_PROVED:${detail}`);
}

export function validatePersonalRepositoryConfiguration(input = {}, options = {}) {
  const blockers = [];
  const repository = input.repository && typeof input.repository === 'object' ? input.repository : {};
  const activeRules = Array.isArray(input.activeRules) ? input.activeRules : null;
  const rulesets = Array.isArray(input.rulesets) ? input.rulesets : null;
  const requiredCheck = text(options.requiredCheck || PERSONAL_REPOSITORY_REQUIRED_CHECK);
  const expectedIntegrationId = strictPositiveInteger(options.expectedIntegrationId);
  const requireBypassProof = options.requireBypassProof !== false;
  const environment = validateProtectedEnvironment(input.environment, {
    expectedName: OPERATOR_MERGE_ENVIRONMENT,
    expectedReviewer: OPERATOR_MERGE_REVIEWER,
  });
  if (!environment.valid) blockers.push(...environment.blockers);
  if (text(repository?.owner?.type).toLowerCase() !== 'user') blockers.push('personal-repository-configuration-owner-not-user');
  if (repository?.private !== false || text(repository?.visibility).toLowerCase() !== 'public') {
    blockers.push('personal-repository-rules-api-not-public');
  }
  if (text(repository.default_branch) !== 'main') blockers.push('personal-repository-default-branch-not-main');
  if (repository.allow_squash_merge !== true) blockers.push('personal-repository-squash-not-enabled');
  if (repository.delete_branch_on_merge !== false) blockers.push('personal-repository-auto-delete-not-disabled');
  if (!activeRules) configurationNotProved(blockers, 'personal-repository-active-main-rules');
  if (!rulesets) configurationNotProved(blockers, 'personal-repository-active-rulesets');
  if (!requiredCheck) configurationNotProved(blockers, 'personal-repository-required-check-identity');
  if (!expectedIntegrationId) configurationNotProved(blockers, 'personal-repository-required-check-integration');

  const rules = activeRules || [];
  const pullRequestRules = rulesOfType(rules, 'pull_request');
  const statusCheckRules = rulesOfType(rules, 'required_status_checks');
  const mergeQueueRules = rulesOfType(rules, 'merge_queue');
  const nonFastForwardRules = rulesOfType(rules, 'non_fast_forward');
  const deletionRules = rulesOfType(rules, 'deletion');
  if (pullRequestRules.length !== 1) configurationNotProved(blockers, 'personal-repository-pull-request-rule-not-exact');
  if (statusCheckRules.length !== 1) configurationNotProved(blockers, 'personal-repository-status-check-rule-not-exact');
  if (mergeQueueRules.length !== 0) blockers.push('personal-repository-unavailable-merge-queue-rule-present');
  if (nonFastForwardRules.length < 1) configurationNotProved(blockers, 'personal-repository-non-fast-forward-rule-missing');
  if (deletionRules.length < 1) configurationNotProved(blockers, 'personal-repository-deletion-rule-missing');

  const pullRequestParameters = pullRequestRules[0]?.parameters || {};
  if (pullRequestParameters.required_approving_review_count !== 0) blockers.push('personal-repository-native-approval-count-not-zero');
  if (pullRequestParameters.required_review_thread_resolution !== true) blockers.push('personal-repository-conversation-resolution-not-enforced');
  if (pullRequestParameters.dismiss_stale_reviews_on_push !== true) blockers.push('personal-repository-stale-review-dismissal-not-enforced');
  if (pullRequestParameters.require_last_push_approval !== false) blockers.push('personal-repository-last-push-approval-not-disabled');
  if (pullRequestParameters.require_code_owner_review !== false) blockers.push('personal-repository-code-owner-review-not-disabled');

  const statusParameters = statusCheckRules[0]?.parameters || {};
  const requiredStatusChecks = Array.isArray(statusParameters.required_status_checks)
    ? statusParameters.required_status_checks
    : null;
  if (!requiredStatusChecks) {
    configurationNotProved(blockers, 'personal-repository-required-status-check-list');
  } else {
    const exactChecks = requiredStatusChecks.filter((check) => (
      text(check?.context) === requiredCheck
      && strictPositiveInteger(check?.integration_id) === expectedIntegrationId
    ));
    if (exactChecks.length !== 1) blockers.push('personal-repository-required-check-not-exact');
  }
  if (statusParameters.strict_required_status_checks_policy !== true) {
    blockers.push('personal-repository-strict-status-policy-not-enforced');
  }

  const activeRulesetIds = unique(rules.map((rule) => strictPositiveInteger(rule?.ruleset_id)).filter(Boolean));
  if (!rules.length || activeRulesetIds.length === 0
    || rules.some((rule) => !strictPositiveInteger(rule?.ruleset_id))) {
    configurationNotProved(blockers, 'personal-repository-active-rule-identities');
  }
  const suppliedRulesets = rulesets || [];
  const suppliedRulesetIds = suppliedRulesets.map((ruleset) => strictPositiveInteger(ruleset?.id));
  if (suppliedRulesetIds.some((id) => !id)
    || suppliedRulesetIds.length !== activeRulesetIds.length
    || activeRulesetIds.some((id) => !suppliedRulesetIds.includes(id))) {
    configurationNotProved(blockers, 'personal-repository-ruleset-evidence-not-exact');
  }
  for (const ruleset of suppliedRulesets) {
    const rulesetId = strictPositiveInteger(ruleset?.id);
    if (text(ruleset?.enforcement).toLowerCase() !== 'active') {
      blockers.push(`personal-repository-ruleset-not-active:${rulesetId || 'unknown'}`);
    }
    if (!EXPLICIT_TIMEZONE.test(text(ruleset?.updated_at))
      || !Number.isFinite(Date.parse(ruleset.updated_at))) {
      configurationNotProved(blockers, `personal-repository-ruleset-updated-at:${rulesetId || 'unknown'}`);
    }
    if (requireBypassProof && !Array.isArray(ruleset?.bypass_actors)) {
      configurationNotProved(blockers, `personal-repository-ruleset-bypass-actors:${rulesetId || 'unknown'}`);
    } else if (Array.isArray(ruleset?.bypass_actors) && ruleset.bypass_actors.length !== 0) {
      blockers.push(`personal-repository-ruleset-bypass-present:${rulesetId || 'unknown'}`);
    }
  }

  return Object.freeze({
    valid: blockers.length === 0,
    environment,
    requiredCheck,
    requiredCheckIntegrationId: expectedIntegrationId,
    activeRulesetIds: Object.freeze(activeRulesetIds),
    bypassProven: requireBypassProof,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_CONFIGURATION_BLOCKED'
      : requireBypassProof
        ? 'PERSONAL_REPOSITORY_CONFIGURATION_READY'
        : 'PERSONAL_REPOSITORY_CONFIGURATION_PARTIAL_PROOF_READY',
  });
}

const APPROVAL_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'repository',
  'prNumber',
  'branch',
  'sourceHead',
  'sourceTree',
  'baseSha',
  'workflowPath',
  'workflowRunId',
  'workflowRunAttempt',
  'environment',
  'requiredReviewer',
  'independentReviewWorkflowRunId',
  'independentReviewWorkflowRunAttempt',
  'independentReviewArtifactId',
  'independentReviewArtifactDigest',
  'independentReviewPayloadSha256',
  'evidenceSha256',
  'approvedAtUtc',
  'authority',
  'mergeMethod',
  'reusableAcrossHeads',
  'reusableAcrossBases',
]);

export function buildPersonalRepositoryApprovalReceipt(input = {}) {
  if (input?.evidence?.finalVerdict !== 'PERSONAL_REPOSITORY_EVIDENCE_READY'
    || input?.configuration?.finalVerdict !== 'PERSONAL_REPOSITORY_CONFIGURATION_READY'
    || input?.workflows?.finalVerdict !== 'PERSONAL_REPOSITORY_WORKFLOWS_READY') {
    throw new Error('Personal-repository approval requires ready identity, workflow and configuration evidence.');
  }
  const identity = input.evidence.identity;
  const receipt = {
    schemaVersion: 'stephanos.personal-repository-approval.v1',
    kind: 'stephanos.personal-repository.protected-squash-approval',
    repository: identity.repository,
    prNumber: identity.prNumber,
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    sourceTree: identity.sourceTree,
    baseSha: identity.baseSha,
    workflowPath: PERSONAL_REPOSITORY_WORKFLOW_PATH,
    workflowRunId: identity.workflowRunId,
    workflowRunAttempt: identity.workflowRunAttempt,
    environment: OPERATOR_MERGE_ENVIRONMENT,
    requiredReviewer: OPERATOR_MERGE_REVIEWER,
    independentReviewWorkflowRunId: strictPositiveInteger(input.independentReviewWorkflowRunId),
    independentReviewWorkflowRunAttempt: strictPositiveInteger(input.independentReviewWorkflowRunAttempt),
    independentReviewArtifactId: strictPositiveInteger(input.independentReviewArtifactId),
    independentReviewArtifactDigest: text(input.independentReviewArtifactDigest).toLowerCase(),
    independentReviewPayloadSha256: text(input.independentReviewPayloadSha256).toLowerCase(),
    evidenceSha256: text(input.evidenceSha256).toLowerCase(),
    approvedAtUtc: text(input.approvedAtUtc),
    authority: PERSONAL_REPOSITORY_AUTHORITY,
    mergeMethod: 'squash',
    reusableAcrossHeads: false,
    reusableAcrossBases: false,
  };
  const validation = validatePersonalRepositoryApprovalReceipt(receipt, receipt);
  if (!validation.valid) throw new Error(`Personal-repository approval is invalid: ${validation.blockers.join(', ')}`);
  return Object.freeze(receipt);
}

export function validatePersonalRepositoryApprovalReceipt(receipt = {}, expected = {}) {
  const blockers = [];
  if (!sameKeys(receipt, APPROVAL_RECEIPT_KEYS)) blockers.push('personal-repository-approval-schema-unbounded');
  if (receipt.schemaVersion !== 'stephanos.personal-repository-approval.v1') blockers.push('personal-repository-approval-schema-mismatch');
  if (receipt.kind !== 'stephanos.personal-repository.protected-squash-approval') blockers.push('personal-repository-approval-kind-mismatch');
  if (!REPOSITORY_PATTERN.test(text(receipt.repository))) blockers.push('personal-repository-approval-repository-invalid');
  if (!strictPositiveInteger(receipt.prNumber)) blockers.push('personal-repository-approval-pr-invalid');
  if (!BRANCH_PATTERN.test(text(receipt.branch)) || text(receipt.branch).includes('..')) blockers.push('personal-repository-approval-branch-invalid');
  for (const [key, blocker] of [
    ['sourceHead', 'personal-repository-approval-head-invalid'],
    ['sourceTree', 'personal-repository-approval-tree-invalid'],
    ['baseSha', 'personal-repository-approval-base-invalid'],
  ]) {
    if (!SHA_PATTERN.test(text(receipt[key]).toLowerCase())) blockers.push(blocker);
  }
  if (receipt.workflowPath !== PERSONAL_REPOSITORY_WORKFLOW_PATH) blockers.push('personal-repository-approval-workflow-path-mismatch');
  if (!strictPositiveInteger(receipt.workflowRunId)) blockers.push('personal-repository-approval-run-invalid');
  if (!strictPositiveInteger(receipt.workflowRunAttempt)) blockers.push('personal-repository-approval-attempt-invalid');
  if (receipt.environment !== OPERATOR_MERGE_ENVIRONMENT) blockers.push('personal-repository-approval-environment-mismatch');
  if (receipt.requiredReviewer !== OPERATOR_MERGE_REVIEWER) blockers.push('personal-repository-approval-reviewer-mismatch');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunId)) blockers.push('personal-repository-approval-review-run-invalid');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunAttempt)) blockers.push('personal-repository-approval-review-attempt-invalid');
  if (!strictPositiveInteger(receipt.independentReviewArtifactId)) blockers.push('personal-repository-approval-artifact-id-invalid');
  if (!ARTIFACT_DIGEST_PATTERN.test(text(receipt.independentReviewArtifactDigest))) blockers.push('personal-repository-approval-artifact-digest-invalid');
  if (!SHA256_PATTERN.test(text(receipt.independentReviewPayloadSha256))) blockers.push('personal-repository-approval-payload-digest-invalid');
  if (!SHA256_PATTERN.test(text(receipt.evidenceSha256))) blockers.push('personal-repository-approval-evidence-digest-invalid');
  if (!EXPLICIT_TIMEZONE.test(text(receipt.approvedAtUtc)) || !Number.isFinite(Date.parse(receipt.approvedAtUtc))) {
    blockers.push('personal-repository-approval-time-invalid');
  }
  if (receipt.authority !== PERSONAL_REPOSITORY_AUTHORITY) blockers.push('personal-repository-approval-authority-mismatch');
  if (receipt.mergeMethod !== 'squash') blockers.push('personal-repository-approval-merge-method-mismatch');
  if (receipt.reusableAcrossHeads !== false) blockers.push('personal-repository-approval-reusable-across-heads');
  if (receipt.reusableAcrossBases !== false) blockers.push('personal-repository-approval-reusable-across-bases');
  for (const [key, blocker] of [
    ['repository', 'personal-repository-approval-repository-mismatch'],
    ['prNumber', 'personal-repository-approval-pr-mismatch'],
    ['branch', 'personal-repository-approval-branch-mismatch'],
    ['sourceHead', 'personal-repository-approval-head-mismatch'],
    ['sourceTree', 'personal-repository-approval-tree-mismatch'],
    ['baseSha', 'personal-repository-approval-base-mismatch'],
    ['workflowRunId', 'personal-repository-approval-run-mismatch'],
    ['workflowRunAttempt', 'personal-repository-approval-attempt-mismatch'],
    ['independentReviewWorkflowRunId', 'personal-repository-approval-review-run-mismatch'],
    ['independentReviewWorkflowRunAttempt', 'personal-repository-approval-review-attempt-mismatch'],
    ['independentReviewArtifactId', 'personal-repository-approval-artifact-id-mismatch'],
    ['independentReviewArtifactDigest', 'personal-repository-approval-artifact-digest-mismatch'],
    ['independentReviewPayloadSha256', 'personal-repository-approval-payload-digest-mismatch'],
    ['evidenceSha256', 'personal-repository-approval-evidence-digest-mismatch'],
  ]) {
    if (Object.hasOwn(expected, key) && receipt[key] !== expected[key]) blockers.push(blocker);
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_APPROVAL_BLOCKED'
      : 'PERSONAL_REPOSITORY_APPROVAL_READY',
  });
}

export function validatePersonalRepositorySquashCompletion(input = {}, expected = {}) {
  const blockers = [];
  const mergeSha = text(input?.mergeResponse?.sha).toLowerCase();
  const mainSha = text(input?.liveMainRef?.object?.sha ?? input?.liveMainRef?.sha).toLowerCase();
  const commitSha = text(input?.mergeCommit?.sha).toLowerCase();
  const commitTree = text(input?.mergeCommit?.tree?.sha ?? input?.mergeCommit?.tree).toLowerCase();
  const parents = Array.isArray(input?.mergeCommit?.parents) ? input.mergeCommit.parents : [];
  const branchSha = text(input?.branchRef?.object?.sha ?? input?.branchRef?.sha).toLowerCase();
  const expectedHead = text(expected.sourceHead).toLowerCase();
  const expectedTree = text(expected.sourceTree).toLowerCase();
  const expectedBase = text(expected.baseSha).toLowerCase();
  if (input?.mergeResponse?.merged !== true || !SHA_PATTERN.test(mergeSha)) blockers.push('personal-repository-merge-response-invalid');
  if (input?.pullRequest?.merged !== true || text(input?.pullRequest?.merge_commit_sha).toLowerCase() !== mergeSha) {
    blockers.push('personal-repository-pr-not-exactly-merged');
  }
  if (!SHA_PATTERN.test(mainSha) || mainSha !== mergeSha) blockers.push('personal-repository-main-not-merge-commit');
  if (commitSha !== mergeSha) blockers.push('personal-repository-merge-commit-sha-mismatch');
  if (!SHA_PATTERN.test(commitTree) || commitTree !== expectedTree) blockers.push('personal-repository-merge-tree-mismatch');
  if (parents.length !== 1 || text(parents[0]?.sha ?? parents[0]).toLowerCase() !== expectedBase) {
    blockers.push('personal-repository-squash-parent-not-exact-base');
  }
  if (branchSha !== expectedHead) blockers.push('personal-repository-source-branch-deleted-or-moved');
  if (mergeSha === expectedHead || mergeSha === expectedBase) blockers.push('personal-repository-merge-commit-not-distinct');
  return Object.freeze({
    valid: blockers.length === 0,
    mergeSha,
    mainSha,
    treeSha: commitTree,
    branchSha,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_SQUASH_COMPLETION_BLOCKED'
      : 'PERSONAL_REPOSITORY_SQUASH_COMPLETION_READY',
  });
}