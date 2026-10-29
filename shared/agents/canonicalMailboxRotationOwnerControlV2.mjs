import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { decodeMailboxRotationOwnerControlV2, encodeMailboxRotationOwnerControlV2 } from './canonicalMailboxNativeEvidenceCodecV2.mjs';

export const MAILBOX_ROTATION_OWNER_CONTROL_MARKER_V2 = '<!-- stephanos-canonical-mailbox-owner-control:v2 -->';
export const MAILBOX_ROTATION_OWNER_CONTROL_MAX_AGE_MS_V2 = 15 * 60 * 1000;
const prefix = MAILBOX_ROTATION_OWNER_CONTROL_MARKER_V2 + '\n```json\n';
const suffix = '\n```\n';
const repository = 'Cheekyfellastef/stephan-os';
const ownerLogin = 'Cheekyfellastef';
const ownerNumericId = 267490109;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function field(object, name) {
  if (!object || typeof object !== 'object' || types.isProxy(object)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(object))) throw Error('OWNER_CONTROL_METADATA_INVALID');
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('OWNER_CONTROL_METADATA_INVALID');
  return descriptor.value;
}
function githubInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) return NaN;
  return milliseconds;
}
function held(blocker) {
  return Object.freeze({ ok: false, candidate: false, blocker, ownerConsentAuthenticated: false,
    nativeExecutionAuthorized: false, freezeCertified: false, protectedMergeAuthorized: false,
    sourceSyncAuthorized: false, epochAdoptionAuthorized: false });
}
export function formatMailboxRotationOwnerControlV2(consent) {
  return prefix + encodeMailboxRotationOwnerControlV2(consent).toString('utf8') + suffix;
}

/** Parse a REST issue-comment candidate; this does NOT authenticate an API read.
 * The original native adapter must independently fetch/re-fetch this immutable
 * owner comment on the existing activation PR, adjudicate actual source/epoch/
 * state, and acquire the original guard/ledger before any effect. A returned
 * candidate is not an execution token and cannot qualify a native producer.
 */
export function parseMailboxRotationOwnerControlCandidateV2(comment) {
  try {
    const user = field(comment, 'user');
    if (field(user, 'login') !== ownerLogin || field(user, 'id') !== ownerNumericId
      || field(user, 'type') !== 'User' || field(comment, 'author_association') !== 'OWNER') return held('OWNER_CONTROL_OWNER_IDENTITY_MISMATCH');
    const commentId = field(comment, 'id'), body = field(comment, 'body');
    if (!Number.isSafeInteger(commentId) || commentId <= 0 || typeof body !== 'string'
      || Buffer.byteLength(body, 'utf8') > 16 * 1024 + Buffer.byteLength(prefix + suffix)
      || !body.startsWith(prefix) || !body.endsWith(suffix)) return held('OWNER_CONTROL_COMMENT_SHAPE_INVALID');
    const created = field(comment, 'created_at'), updated = field(comment, 'updated_at');
    if (created !== updated) return held('OWNER_CONTROL_EDITED_COMMENT');
    const createdMs = githubInstant(created), nowMs = Date.now();
    if (!Number.isFinite(createdMs) || createdMs > nowMs || nowMs - createdMs > MAILBOX_ROTATION_OWNER_CONTROL_MAX_AGE_MS_V2) return held('OWNER_CONTROL_COMMENT_NOT_FRESH');
    const consent = decodeMailboxRotationOwnerControlV2(Buffer.from(body.slice(prefix.length, -suffix.length), 'utf8'));
    const prNumber = consent.activation.prNumber;
    if (field(comment, 'issue_url') !== `https://api.github.com/repos/${repository}/issues/${prNumber}`
      || field(comment, 'html_url') !== `https://github.com/${repository}/pull/${prNumber}#issuecomment-${commentId}`) return held('OWNER_CONTROL_ACTIVATION_PR_ORIGIN_MISMATCH');
    const expiresMs = Date.parse(consent.expiresAtUtc);
    if (expiresMs <= nowMs || expiresMs <= createdMs || expiresMs - createdMs > MAILBOX_ROTATION_OWNER_CONTROL_MAX_AGE_MS_V2) return held('OWNER_CONTROL_CONSENT_EXPIRED_OR_TOO_LONG');
    const origin = Object.freeze({ kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber, commentId,
      commentBodySha256: hash(Buffer.from(body, 'utf8')), createdAtUtc: new Date(createdMs).toISOString() });
    const requestId = 'rotation-v2-' + hash(Buffer.from([repository, prNumber, commentId,
      origin.commentBodySha256, consent.transitionId, consent.rotationAction].join('\0'), 'utf8'));
    return Object.freeze({ ok: true, candidate: true, blocker: 'ORIGINAL_NATIVE_ADMISSION_REQUIRED',
      origin, requestId, consent, ownerIdentityFieldsMatch: true, ownerConsentAuthenticated: false,
      nativeExecutionAuthorized: false, freezeCertified: false, protectedMergeAuthorized: false,
      sourceSyncAuthorized: false, epochAdoptionAuthorized: false });
  } catch { return held('OWNER_CONTROL_METADATA_OR_ENCODING_INVALID'); }
}
