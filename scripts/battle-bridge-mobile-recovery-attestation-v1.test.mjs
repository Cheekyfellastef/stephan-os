import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_OWNER,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  validateMobileRecoveryAttestation,
} from '../shared/agents/battleBridgeMobileRecoveryLifeboatV1.mjs';
import {
  MOBILE_RECOVERY_ATTESTATION_MARKER,
  MOBILE_RECOVERY_REQUEST_MARKER,
  attestMobileRecoveryIssueComment,
  buildMobileRecoveryAttestationComment,
  parseMobileRecoveryRequestComment,
  publishMobileRecoveryAttestation,
} from './battle-bridge-mobile-recovery-attestation-v1.mjs';

const NOW = Date.parse('2026-08-16T14:40:10.000Z');

function request(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: 'mobile-recovery-20260816-1440',
    nonce: 'abcdef0123456789abcdef0123456789',
    action: 'PROBE_BATTLE_BRIDGE',
    requesterLogin: BATTLE_BRIDGE_RECOVERY_OWNER,
    authorAssociation: 'OWNER',
    requestedAtUtc: '2026-08-16T14:40:00.000Z',
    expiresAtUtc: '2026-08-16T14:45:00.000Z',
    ...overrides,
  };
}

function commentBody(req = request()) {
  return [MOBILE_RECOVERY_REQUEST_MARKER, '```json', JSON.stringify(req, null, 2), '```'].join('\n');
}

function event(overrides = {}) {
  return {
    action: 'created',
    repository: { full_name: BATTLE_BRIDGE_RECOVERY_REPOSITORY },
    issue: { number: BATTLE_BRIDGE_RECOVERY_ISSUE },
    comment: {
      id: 5308000000,
      body: commentBody(),
      created_at: '2026-08-16T14:40:05.000Z',
      author_association: 'OWNER',
      user: { login: BATTLE_BRIDGE_RECOVERY_OWNER },
    },
    sender: { login: BATTLE_BRIDGE_RECOVERY_OWNER },
    ...overrides,
  };
}

test('strict request comment parser accepts only marker plus one json block', () => {
  assert.equal(parseMobileRecoveryRequestComment(commentBody()).ok, true);
  assert.equal(parseMobileRecoveryRequestComment(`hello\n${commentBody()}`).ok, false);
  assert.equal(parseMobileRecoveryRequestComment(`${commentBody()}\nextra`).ok, false);
  assert.equal(parseMobileRecoveryRequestComment(`${MOBILE_RECOVERY_REQUEST_MARKER}\n\`\`\`json\n{\n\`\`\``).ok, false);
});

test('trusted owner issue_comment mints an attestation bound to the exact request', () => {
  const observed = event();
  const result = attestMobileRecoveryIssueComment(observed, { nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.eventBinding.commentId, observed.comment.id);
  assert.equal(result.eventBinding.commentAuthor, BATTLE_BRIDGE_RECOVERY_OWNER);
  assert.match(result.attestation.requestSha256, /^[a-f0-9]{64}$/);
  assert.equal(validateMobileRecoveryAttestation(result.attestation, result.request, { nowMs: NOW }).ok, true);
});

test('foreign sender, foreign comment author, wrong association, wrong issue and edited event fail closed', () => {
  assert.equal(attestMobileRecoveryIssueComment(event({ sender: { login: 'other' } }), { nowMs: NOW }).ok, false);
  assert.equal(attestMobileRecoveryIssueComment(event({ comment: { ...event().comment, user: { login: 'other' } } }), { nowMs: NOW }).ok, false);
  assert.equal(attestMobileRecoveryIssueComment(event({ comment: { ...event().comment, author_association: 'CONTRIBUTOR' } }), { nowMs: NOW }).ok, false);
  assert.equal(attestMobileRecoveryIssueComment(event({ issue: { number: 1507 } }), { nowMs: NOW }).ok, false);
  assert.equal(attestMobileRecoveryIssueComment(event({ action: 'edited' }), { nowMs: NOW }).ok, false);
});

test('request fields must agree with authenticated GitHub event evidence', () => {
  const badOwner = request({ requesterLogin: 'other' });
  assert.equal(attestMobileRecoveryIssueComment(event({ comment: { ...event().comment, body: commentBody(badOwner) } }), { nowMs: NOW }).ok, false);
  const badAssociation = request({ authorAssociation: 'MEMBER' });
  assert.equal(attestMobileRecoveryIssueComment(event({ comment: { ...event().comment, body: commentBody(badAssociation) } }), { nowMs: NOW }).ok, false);
});

test('request timestamp must be close to immutable GitHub comment creation time', () => {
  const oldRequest = request({ requestedAtUtc: '2026-08-16T14:30:00.000Z', expiresAtUtc: '2026-08-16T14:35:00.000Z' });
  const result = attestMobileRecoveryIssueComment(event({ comment: { ...event().comment, body: commentBody(oldRequest) } }), { nowMs: Date.parse('2026-08-16T14:30:10.000Z') });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('request-comment-time-mismatch'));
});

test('attestation comment exposes bounded request identity and event binding only', () => {
  const result = attestMobileRecoveryIssueComment(event(), { nowMs: NOW });
  const body = buildMobileRecoveryAttestationComment(result);
  assert.match(body, new RegExp(MOBILE_RECOVERY_ATTESTATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /sourceCommentId: 5308000000/);
  assert.doesNotMatch(body, /powershell|cmd\.exe|token|credential/i);
});

test('publisher posts exactly one attestation comment to fixed recovery issue', async () => {
  const calls = [];
  const result = await publishMobileRecoveryAttestation({
    event: event(),
    token: 'test-token',
    nowMs: NOW,
    githubRequestFn: async (path, options) => {
      calls.push({ path, options });
      return { id: 5308000001 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(result.commentId, 5308000001);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/repos/Cheekyfellastef/stephan-os/issues/${BATTLE_BRIDGE_RECOVERY_ISSUE}/comments`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(Object.keys(calls[0].options.body), ['body']);
});

test('blocked request publishes nothing', async () => {
  let called = false;
  const result = await publishMobileRecoveryAttestation({
    event: event({ sender: { login: 'other' } }),
    token: 'test-token',
    nowMs: NOW,
    githubRequestFn: async () => { called = true; return { id: 1 }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.published, false);
  assert.equal(called, false);
});
