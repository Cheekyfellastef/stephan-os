import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  issueOpenClawGitHubAuthorization,
  verifyOpenClawGitHubAuthorization,
} from './openClawGitHubAuthorization.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const now = new Date('2026-06-24T18:30:00.000Z');

function claims(overrides = {}) {
  return {
    authorizationId: 'auth-github-operator-0001',
    missionId: 'github-operator-v1',
    operation: 'commit',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os-worktrees\\mission-1',
    defaultBranch: 'main',
    baseBranch: 'main',
    branch: 'openclaw/mission-1',
    allowedFiles: ['shared/agents/**'],
    changedFiles: ['shared/agents/example.mjs'],
    commitMessage: 'Add bounded example',
    issuedAt: '2026-06-24T18:29:00.000Z',
    expiresAt: '2026-06-24T19:29:00.000Z',
    singleUse: true,
    ...overrides,
  };
}

test('Stephanos-issued Ed25519 authorization verifies', () => {
  const envelope = issueOpenClawGitHubAuthorization(claims(), privateKeyPem, { now });
  assert.equal(envelope.finalVerdict, 'STEPHANOS_AUTHORIZATION_ISSUED');
  const result = verifyOpenClawGitHubAuthorization(envelope, publicKeyPem, { now });
  assert.equal(result.finalVerdict, 'STEPHANOS_AUTHORIZATION_VERIFIED');
  assert.equal(result.claims.operation, 'commit');
});

test('modified claims invalidate signature and claims hash', () => {
  const envelope = issueOpenClawGitHubAuthorization(claims(), privateKeyPem, { now });
  envelope.claims.allowedFiles = ['**'];
  const result = verifyOpenClawGitHubAuthorization(envelope, publicKeyPem, { now });
  assert.equal(result.finalVerdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /hash|signature/i);
});

test('forged signature and wrong public key block', () => {
  const envelope = issueOpenClawGitHubAuthorization(claims(), privateKeyPem, { now });
  envelope.signature = Buffer.from('forged').toString('base64');
  assert.equal(verifyOpenClawGitHubAuthorization(envelope, publicKeyPem, { now }).finalVerdict, 'BLOCKED');

  const wrongKeys = generateKeyPairSync('ed25519');
  const wrongPublic = wrongKeys.publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(verifyOpenClawGitHubAuthorization(
    issueOpenClawGitHubAuthorization(claims(), privateKeyPem, { now }),
    wrongPublic,
    { now },
  ).finalVerdict, 'BLOCKED');
});

test('expired future-dated and overlong authorizations block', () => {
  const invalidClaims = [
    claims({ expiresAt: '2026-06-24T18:29:59.000Z' }),
    claims({ issuedAt: '2026-06-24T18:32:00.000Z' }),
    claims({ expiresAt: '2026-06-26T18:29:00.000Z' }),
  ];
  for (const item of invalidClaims) {
    const issued = issueOpenClawGitHubAuthorization(item, privateKeyPem, { now });
    assert.equal(issued.finalVerdict, 'BLOCKED');
  }
});

test('reusable authorizations are forbidden', () => {
  const result = issueOpenClawGitHubAuthorization(claims({ singleUse: false }), privateKeyPem, { now });
  assert.equal(result.finalVerdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /single-use/i);
});
