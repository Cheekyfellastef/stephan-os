import {
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_OWNER,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  normalizeMobileRecoveryRequest,
  validateMobileRecoveryAttestation,
} from './battleBridgeMobileRecoveryLifeboatV1.mjs';

export const BATTLE_BRIDGE_LIFEBOAT_GITHUB_CLAIM_SCHEMA = 'stephanos.battle-bridge-lifeboat-github-claim.v1';
export const BATTLE_BRIDGE_LIFEBOAT_GITHUB_REQUEST_MARKER = '<!-- stephanos-battle-bridge-mobile-recovery-request -->';
export const BATTLE_BRIDGE_LIFEBOAT_GITHUB_ATTESTATION_MARKER = '<!-- stephanos-battle-bridge-mobile-recovery-attestation -->';
export const BATTLE_BRIDGE_LIFEBOAT_GITHUB_API_URL = `https://api.github.com/repos/${BATTLE_BRIDGE_RECOVERY_REPOSITORY}/issues/${BATTLE_BRIDGE_RECOVERY_ISSUE}/comments?per_page=100&page=1`;
export const BATTLE_BRIDGE_LIFEBOAT_EXECUTABLE_ACTIONS_V1 = Object.freeze([
  'PROBE_BATTLE_BRIDGE',
  'WAKE_CANONICAL_MAILBOX',
  'WAKE_CANONICAL_RECOVERY_MESH',
]);

const EXECUTABLE_ACTION_SET = new Set(BATTLE_BRIDGE_LIFEBOAT_EXECUTABLE_ACTIONS_V1);
const MAX_COMMENT_BYTES = 16 * 1024;
const MAX_COMMENT_COUNT = 100;
const SAFE_REQUEST_ID = /^mobile-recovery-[a-z0-9][a-z0-9-]{7,63}$/;

function ownDataSnapshot(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let descriptors;
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) return null;
  const out = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    out[key] = descriptor.value;
  }
  return out;
}

function safeCommentSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const id = Number(value.id);
    const body = typeof value.body === 'string' ? value.body : '';
    const login = typeof value.user?.login === 'string' ? value.user.login.trim() : '';
    const authorAssociation = typeof value.author_association === 'string' ? value.author_association.trim() : '';
    const createdAt = typeof value.created_at === 'string' ? value.created_at.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !body || Buffer.byteLength(body, 'utf8') > MAX_COMMENT_BYTES) return null;
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs)) return null;
    return Object.freeze({ id, body, login, authorAssociation, createdAt, createdAtMs });
  } catch {
    return null;
  }
}

function parseFencedJson(body, marker) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_COMMENT_BYTES) return null;
  const normalized = body.replace(/\r\n/g, '\n').trim();
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^${escaped}\\n\\u0060\\u0060\\u0060json\\n([\\s\\S]+?)\\n\\u0060\\u0060\\u0060$`));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

export function parseLifeboatRecoveryRequestComment(comment) {
  const snapshot = safeCommentSnapshot(comment);
  if (!snapshot || snapshot.login !== BATTLE_BRIDGE_RECOVERY_OWNER || snapshot.authorAssociation !== 'OWNER') {
    return Object.freeze({ ok: false, blocker: 'request-comment-identity-invalid', comment: snapshot, request: null });
  }
  const request = parseFencedJson(snapshot.body, BATTLE_BRIDGE_LIFEBOAT_GITHUB_REQUEST_MARKER);
  if (!request) return Object.freeze({ ok: false, blocker: 'request-comment-format-invalid', comment: snapshot, request: null });
  return Object.freeze({ ok: true, blocker: '', comment: snapshot, request });
}

export function parseLifeboatRecoveryAttestationComment(comment) {
  const snapshot = safeCommentSnapshot(comment);
  if (!snapshot || snapshot.login !== 'github-actions[bot]') {
    return Object.freeze({ ok: false, blocker: 'attestation-comment-identity-invalid', comment: snapshot, payload: null });
  }
  const normalized = snapshot.body.replace(/\r\n/g, '\n').trim();
  const escaped = BATTLE_BRIDGE_LIFEBOAT_GITHUB_ATTESTATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^${escaped}\\nrequestId: ([a-z0-9-]+)\\nsourceCommentId: ([0-9]+)\\n\\u0060\\u0060\\u0060json\\n([\\s\\S]+?)\\n\\u0060\\u0060\\u0060$`));
  if (!match || !SAFE_REQUEST_ID.test(match[1])) {
    return Object.freeze({ ok: false, blocker: 'attestation-comment-format-invalid', comment: snapshot, payload: null });
  }
  let payload;
  try { payload = JSON.parse(match[3]); } catch {
    return Object.freeze({ ok: false, blocker: 'attestation-comment-json-invalid', comment: snapshot, payload: null });
  }
  const envelope = ownDataSnapshot(payload, ['attestation', 'eventBinding']);
  const binding = envelope ? ownDataSnapshot(envelope.eventBinding, ['commentId', 'commentCreatedAtUtc', 'commentAuthor', 'authorAssociation']) : null;
  if (!envelope || !binding || Number(match[2]) !== Number(binding.commentId) || match[1] !== envelope.attestation?.requestId) {
    return Object.freeze({ ok: false, blocker: 'attestation-comment-binding-invalid', comment: snapshot, payload: null });
  }
  return Object.freeze({
    ok: true,
    blocker: '',
    comment: snapshot,
    payload: Object.freeze({ attestation: envelope.attestation, eventBinding: Object.freeze({ ...binding }) }),
  });
}

export function selectAttestedLifeboatGitHubClaim(comments, { nowMs = Date.now(), consumedRequestIds = [] } = {}) {
  if (!Array.isArray(comments) || comments.length > MAX_COMMENT_COUNT) {
    return Object.freeze({ ok: false, blocker: 'github-comment-window-invalid', claim: null });
  }
  const snapshots = comments.map(safeCommentSnapshot).filter(Boolean).sort((left, right) => right.id - left.id);
  const requestCandidates = snapshots
    .map((comment) => parseLifeboatRecoveryRequestComment(comment))
    .filter((entry) => entry.ok)
    .sort((left, right) => right.comment.id - left.comment.id);
  const attestations = snapshots
    .map((comment) => parseLifeboatRecoveryAttestationComment(comment))
    .filter((entry) => entry.ok);

  for (const requestEntry of requestCandidates) {
    const normalized = normalizeMobileRecoveryRequest(requestEntry.request, { nowMs, consumedRequestIds });
    if (!normalized.ok || !EXECUTABLE_ACTION_SET.has(normalized.request.action)) continue;
    const attestationEntry = attestations.find((entry) => Number(entry.payload.eventBinding.commentId) === requestEntry.comment.id
      && entry.payload.attestation.requestId === normalized.request.requestId);
    if (!attestationEntry) continue;
    const binding = attestationEntry.payload.eventBinding;
    if (binding.commentAuthor !== BATTLE_BRIDGE_RECOVERY_OWNER
      || binding.authorAssociation !== 'OWNER'
      || Number(binding.commentId) !== requestEntry.comment.id
      || binding.commentCreatedAtUtc !== requestEntry.comment.createdAt) continue;
    const attestationResult = validateMobileRecoveryAttestation(attestationEntry.payload.attestation, normalized.request, { nowMs });
    if (!attestationResult.ok) continue;
    return Object.freeze({
      ok: true,
      blocker: '',
      claim: Object.freeze({
        schemaVersion: BATTLE_BRIDGE_LIFEBOAT_GITHUB_CLAIM_SCHEMA,
        repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
        issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
        requestId: normalized.request.requestId,
        action: normalized.request.action,
        requestCommentId: requestEntry.comment.id,
        attestationCommentId: attestationEntry.comment.id,
        expiresAtUtc: normalized.request.expiresAtUtc,
        apiUrl: BATTLE_BRIDGE_LIFEBOAT_GITHUB_API_URL,
        claimCreateNewRequired: true,
        postActionProofRequired: true,
        arbitraryShellAllowed: false,
        callerSelectedUrlAllowed: false,
        callerSelectedPathAllowed: false,
        callerSelectedTaskAllowed: false,
        sourceMutationAllowed: false,
        gitMutationAllowed: false,
        mergeAllowed: false,
        pcRestartAllowed: false,
      }),
    });
  }
  return Object.freeze({ ok: false, blocker: 'no-fresh-executable-attested-recovery-request', claim: null });
}
