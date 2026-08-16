#!/usr/bin/env node

import fs from 'node:fs';

import {
  BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_OWNER,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  BATTLE_BRIDGE_RECOVERY_WORKFLOW,
  normalizeMobileRecoveryRequest,
  recoveryRequestSha256,
} from '../shared/agents/battleBridgeMobileRecoveryLifeboatV1.mjs';

export const MOBILE_RECOVERY_REQUEST_MARKER = '<!-- stephanos-battle-bridge-mobile-recovery-request -->';
export const MOBILE_RECOVERY_ATTESTATION_MARKER = '<!-- stephanos-battle-bridge-mobile-recovery-attestation -->';
export const MOBILE_RECOVERY_COMMENT_MAX_BYTES = 8192;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function readJson(path) {
  if (!path || !fs.existsSync(path)) throw new Error('GitHub event payload is unavailable');
  const size = fs.statSync(path).size;
  if (size < 1 || size > 1024 * 1024) throw new Error('GitHub event payload size is outside the bounded envelope');
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function parseMobileRecoveryRequestComment(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MOBILE_RECOVERY_COMMENT_MAX_BYTES) {
    return Object.freeze({ ok: false, blocker: 'recovery-comment-size-invalid', request: null });
  }
  const normalized = body.replace(/\r\n/g, '\n').trim();
  const pattern = new RegExp(`^${MOBILE_RECOVERY_REQUEST_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\u0060\\u0060\\u0060json\\n([\\s\\S]+?)\\n\\u0060\\u0060\\u0060$`);
  const match = normalized.match(pattern);
  if (!match) return Object.freeze({ ok: false, blocker: 'recovery-comment-format-invalid', request: null });
  try {
    const request = JSON.parse(match[1]);
    return Object.freeze({ ok: true, blocker: '', request });
  } catch {
    return Object.freeze({ ok: false, blocker: 'recovery-comment-json-invalid', request: null });
  }
}

function canonicalIssueCommentEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const repository = text(event?.repository?.full_name);
  const issueNumber = positiveInteger(event?.issue?.number);
  const action = text(event?.action);
  const commentId = positiveInteger(event?.comment?.id);
  const commentBody = typeof event?.comment?.body === 'string' ? event.comment.body : '';
  const commentLogin = text(event?.comment?.user?.login);
  const authorAssociation = text(event?.comment?.author_association || event?.comment?.authorAssociation);
  const senderLogin = text(event?.sender?.login);
  const commentCreatedAt = text(event?.comment?.created_at);
  return Object.freeze({
    repository,
    issueNumber,
    action,
    commentId,
    commentBody,
    commentLogin,
    authorAssociation,
    senderLogin,
    commentCreatedAt,
  });
}

export function attestMobileRecoveryIssueComment(event, { nowMs = Date.now() } = {}) {
  const observed = canonicalIssueCommentEvent(event);
  const blockers = [];
  if (!observed) return Object.freeze({ ok: false, blockers: Object.freeze(['github-event-invalid']), request: null, attestation: null });

  if (observed.repository !== BATTLE_BRIDGE_RECOVERY_REPOSITORY) blockers.push('github-event-repository-invalid');
  if (observed.issueNumber !== BATTLE_BRIDGE_RECOVERY_ISSUE) blockers.push('github-event-issue-invalid');
  if (observed.action !== 'created') blockers.push('github-event-action-invalid');
  if (!observed.commentId) blockers.push('github-event-comment-id-invalid');
  if (observed.commentLogin !== BATTLE_BRIDGE_RECOVERY_OWNER) blockers.push('github-event-comment-owner-invalid');
  if (observed.senderLogin !== BATTLE_BRIDGE_RECOVERY_OWNER) blockers.push('github-event-sender-invalid');
  if (observed.authorAssociation !== 'OWNER') blockers.push('github-event-author-association-invalid');

  const parsed = parseMobileRecoveryRequestComment(observed.commentBody);
  if (!parsed.ok) blockers.push(parsed.blocker);
  const normalized = parsed.ok ? normalizeMobileRecoveryRequest(parsed.request, { nowMs }) : null;
  if (normalized && !normalized.ok) blockers.push(...normalized.blockers);

  if (normalized?.request) {
    if (normalized.request.requesterLogin !== observed.commentLogin) blockers.push('request-comment-owner-mismatch');
    if (normalized.request.authorAssociation !== observed.authorAssociation) blockers.push('request-comment-association-mismatch');
    const requestAt = Date.parse(normalized.request.requestedAtUtc);
    const commentAt = Date.parse(observed.commentCreatedAt);
    if (!Number.isFinite(commentAt) || Math.abs(commentAt - requestAt) > 60_000) blockers.push('request-comment-time-mismatch');
  }

  if (blockers.length) {
    return Object.freeze({ ok: false, blockers: Object.freeze([...new Set(blockers)]), request: normalized?.request || null, attestation: null });
  }

  const attestedAtUtc = new Date(nowMs).toISOString();
  const attestation = Object.freeze({
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: normalized.request.requestId,
    requestSha256: recoveryRequestSha256(normalized.request),
    action: normalized.request.action,
    workflowPath: BATTLE_BRIDGE_RECOVERY_WORKFLOW,
    reviewerLogin: 'github-actions[bot]',
    verdict: 'ATTESTED',
    attestedAtUtc,
    expiresAtUtc: normalized.request.expiresAtUtc,
  });

  return Object.freeze({
    ok: true,
    blockers: Object.freeze([]),
    request: normalized.request,
    attestation,
    eventBinding: Object.freeze({
      commentId: observed.commentId,
      commentCreatedAtUtc: observed.commentCreatedAt,
      commentAuthor: observed.commentLogin,
      authorAssociation: observed.authorAssociation,
    }),
  });
}

export function buildMobileRecoveryAttestationComment(result) {
  if (!result?.ok || !result?.attestation || !result?.eventBinding) throw new Error('valid recovery attestation result is required');
  const binding = {
    commentId: result.eventBinding.commentId,
    commentCreatedAtUtc: result.eventBinding.commentCreatedAtUtc,
    commentAuthor: result.eventBinding.commentAuthor,
    authorAssociation: result.eventBinding.authorAssociation,
  };
  return [
    MOBILE_RECOVERY_ATTESTATION_MARKER,
    `requestId: ${result.attestation.requestId}`,
    `sourceCommentId: ${binding.commentId}`,
    '```json',
    JSON.stringify({ attestation: result.attestation, eventBinding: binding }, null, 2),
    '```',
  ].join('\n');
}

async function githubRequest(path, { method = 'GET', body = null, token = '' } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stephanos-mobile-recovery-attestation-v1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`);
  return payload;
}

export async function publishMobileRecoveryAttestation({ event, token, nowMs = Date.now(), githubRequestFn = githubRequest } = {}) {
  const result = attestMobileRecoveryIssueComment(event, { nowMs });
  if (!result.ok) return Object.freeze({ ok: false, blockers: result.blockers, published: false, commentId: 0 });
  if (!token) throw new Error('GH_TOKEN is required to publish the recovery attestation');
  const body = buildMobileRecoveryAttestationComment(result);
  const published = await githubRequestFn(
    `/repos/${encodeURIComponent(BATTLE_BRIDGE_RECOVERY_REPOSITORY.split('/')[0])}/${encodeURIComponent(BATTLE_BRIDGE_RECOVERY_REPOSITORY.split('/')[1])}/issues/${BATTLE_BRIDGE_RECOVERY_ISSUE}/comments`,
    { method: 'POST', body: { body }, token },
  );
  return Object.freeze({
    ok: true,
    blockers: Object.freeze([]),
    published: true,
    commentId: positiveInteger(published?.id),
    requestId: result.request.requestId,
    requestSha256: result.attestation.requestSha256,
  });
}

export async function main() {
  const event = readJson(process.env.GITHUB_EVENT_PATH);
  const token = text(process.env.GH_TOKEN);
  const result = await publishMobileRecoveryAttestation({ event, token });
  if (!result.ok) {
    console.error(`MOBILE_RECOVERY_ATTESTATION_BLOCKED=${result.blockers.join(',')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`MOBILE_RECOVERY_ATTESTATION_PASS=${JSON.stringify(result)}`);
}

if (process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).pathname === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
