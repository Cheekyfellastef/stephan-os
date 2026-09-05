import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
  BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  BATTLE_BRIDGE_RECOVERY_WORKFLOW,
  recoveryRequestSha256,
} from './battleBridgeMobileRecoveryLifeboatV1.mjs';
import {
  BATTLE_BRIDGE_LIFEBOAT_GITHUB_API_URL,
  BATTLE_BRIDGE_LIFEBOAT_GITHUB_ATTESTATION_MARKER,
  BATTLE_BRIDGE_LIFEBOAT_GITHUB_REQUEST_MARKER,
  parseLifeboatRecoveryAttestationComment,
  parseLifeboatRecoveryRequestComment,
  selectAttestedLifeboatGitHubClaim,
} from './battleBridgeRecoveryLifeboatGitHubClaimV1.mjs';

const NOW = Date.parse('2026-08-16T16:40:00.000Z');

function request(action = 'WAKE_CANONICAL_RECOVERY_MESH') {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: `mobile-recovery-${action.toLowerCase().replaceAll('_', '-').slice(0, 40)}-001`,
    nonce: '0123456789abcdef0123456789abcdef',
    action,
    requesterLogin: 'Cheekyfellastef',
    authorAssociation: 'OWNER',
    requestedAtUtc: '2026-08-16T16:39:00.000Z',
    expiresAtUtc: '2026-08-16T16:43:00.000Z',
  };
}

function requestComment(value, id = 7001) {
  return {
    id,
    user: { login: 'Cheekyfellastef' },
    author_association: 'OWNER',
    created_at: value.requestedAtUtc,
    body: `${BATTLE_BRIDGE_LIFEBOAT_GITHUB_REQUEST_MARKER}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
  };
}

function attestationPayload(value, sourceComment) {
  return {
    attestation: {
      schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
      repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
      issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
      requestId: value.requestId,
      requestSha256: recoveryRequestSha256(value),
      action: value.action,
      workflowPath: BATTLE_BRIDGE_RECOVERY_WORKFLOW,
      reviewerLogin: 'github-actions[bot]',
      verdict: 'ATTESTED',
      attestedAtUtc: '2026-08-16T16:39:15.000Z',
      expiresAtUtc: value.expiresAtUtc,
    },
    eventBinding: {
      commentId: sourceComment.id,
      commentCreatedAtUtc: sourceComment.created_at,
      commentAuthor: 'Cheekyfellastef',
      authorAssociation: 'OWNER',
    },
  };
}

function attestationFor(value, sourceComment, id = 7002, payload = attestationPayload(value, sourceComment)) {
  return {
    id,
    user: { login: 'github-actions[bot]' },
    author_association: 'NONE',
    created_at: '2026-08-16T16:39:16.000Z',
    body: [
      BATTLE_BRIDGE_LIFEBOAT_GITHUB_ATTESTATION_MARKER,
      `requestId: ${value.requestId}`,
      `sourceCommentId: ${sourceComment.id}`,
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
    ].join('\n'),
  };
}

test('selects the newest fresh GitHub-hosted attested fixed recovery action', () => {
  const value = request();
  const source = requestComment(value);
  const attestation = attestationFor(value, source);
  const result = selectAttestedLifeboatGitHubClaim([source, attestation], { nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.claim.action, 'WAKE_CANONICAL_RECOVERY_MESH');
  assert.equal(result.claim.requestId, value.requestId);
  assert.equal(result.claim.requestCommentId, source.id);
  assert.equal(result.claim.attestationCommentId, attestation.id);
  assert.equal(result.claim.apiUrl, BATTLE_BRIDGE_LIFEBOAT_GITHUB_API_URL);
  assert.equal(result.claim.claimCreateNewRequired, true);
  assert.equal(result.claim.postActionProofRequired, true);
  assert.equal(result.claim.arbitraryShellAllowed, false);
  assert.equal(result.claim.sourceMutationAllowed, false);
  assert.equal(result.claim.mergeAllowed, false);
  assert.equal(result.claim.pcRestartAllowed, false);
});

test('raw owner request never executes without the GitHub-hosted attestation comment', () => {
  const value = request('WAKE_CANONICAL_MAILBOX');
  const result = selectAttestedLifeboatGitHubClaim([requestComment(value)], { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'no-fresh-executable-attested-recovery-request');
});

test('foreign or owner-authored fake attestation is rejected even when payload bytes look valid', () => {
  const value = request('PROBE_BATTLE_BRIDGE');
  const source = requestComment(value);
  const attestation = attestationFor(value, source);
  attestation.user.login = 'Cheekyfellastef';
  assert.equal(parseLifeboatRecoveryAttestationComment(attestation).ok, false);
  assert.equal(selectAttestedLifeboatGitHubClaim([source, attestation], { nowMs: NOW }).ok, false);
});

test('consumed request IDs cannot be reclaimed', () => {
  const value = request('WAKE_CANONICAL_MAILBOX');
  const source = requestComment(value);
  const attestation = attestationFor(value, source);
  const result = selectAttestedLifeboatGitHubClaim([source, attestation], { nowMs: NOW, consumedRequestIds: [value.requestId] });
  assert.equal(result.ok, false);
});

test('unqualified high-impact actions remain held even with a syntactically valid M1/M2 attestation', () => {
  const value = request('RESTART_CANONICAL_BACKEND');
  const source = requestComment(value);
  const attestation = attestationFor(value, source);
  const result = selectAttestedLifeboatGitHubClaim([source, attestation], { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'no-fresh-executable-attested-recovery-request');
});

test('request and attestation bindings must match the immutable source comment', () => {
  const value = request('PROBE_BATTLE_BRIDGE');
  const source = requestComment(value);
  const payload = attestationPayload(value, source);
  payload.eventBinding.commentId = source.id + 1;
  const attestation = attestationFor(value, source, 7002, payload);
  assert.equal(selectAttestedLifeboatGitHubClaim([source, attestation], { nowMs: NOW }).ok, false);
});

test('malformed HTML and oversized comment windows fail closed without parser leakage', () => {
  const html = {
    id: 1,
    user: { login: 'Cheekyfellastef' },
    author_association: 'OWNER',
    created_at: '2026-08-16T16:39:00.000Z',
    body: '<!doctype html><html>not recovery json</html>',
  };
  const parsed = parseLifeboatRecoveryRequestComment(html);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.blocker, 'request-comment-format-invalid');
  const tooMany = Array.from({ length: 101 }, (_, index) => ({ ...html, id: index + 1 }));
  const result = selectAttestedLifeboatGitHubClaim(tooMany, { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'github-comment-window-invalid');
});
