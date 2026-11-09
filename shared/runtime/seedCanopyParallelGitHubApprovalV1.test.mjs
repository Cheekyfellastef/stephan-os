import test from 'node:test';
import assert from 'node:assert/strict';
import { makeParallelSeedExactApprovalV1 } from './seedCanopyParallelSupervisorV1.mjs';
import {
  SEED_PARALLEL_APPROVAL_REF_SCHEMA, resolveSeedParallelOwnerIssueLabelV1,
  validateSeedParallelApprovalReferenceV1, verifySeedParallelOwnerGitHubApprovalV1,
} from './seedCanopyParallelGitHubApprovalV1.mjs';

const NOW = Date.parse('2026-10-13T18:00:00.000Z');
const request = { taskId: 'secure-seed-proposal', seedId: 'seed-foo', ownerIssue: '#3094',
  targetPath: 'docs/architecture/secure-seed.md', baseSha: 'a'.repeat(40) };
const digest = 'e'.repeat(64);
const approval = makeParallelSeedExactApprovalV1({
  request, manifestSha256: digest,
  nowUtc: new Date(NOW - 5000).toISOString(),
  expiryUtc: new Date(NOW + 300000).toISOString(),
});
const ref = { schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 7654321 };
const source = {
  id: 7654321, user: { login: 'Cheekyfellastef' }, author_association: 'OWNER',
  issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3096',
  created_at: new Date(NOW - 4000).toISOString(),
  updated_at: new Date(NOW - 4000).toISOString(),
  body: '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify(approval) + '\n```',
};
function fakeFetch(comment, status = 200) {
  return async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/7654321');
    assert.equal(options.redirect, 'error');
    return { status, text: async () => JSON.stringify(comment) };
  };
}
test('fixed official GitHub API authenticates numeric and decimal-string owner references', async () => {
  for (const commentId of [7654321, '7654321']) {
    const reference = { ...ref, commentId };
    assert.equal(validateSeedParallelApprovalReferenceV1(reference), true);
    const result = await verifySeedParallelOwnerGitHubApprovalV1({
      request, manifestSha256: digest, reference, nowMs: NOW, fetchFn: fakeFetch(source),
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.source, 'GITHUB_OWNER_AUTHENTICATED_COMMENT');
    assert.equal(result.commentId, source.id);
  }
});

async function assertRejectedCommentId(commentId) {
  let fetches = 0;
  const reference = { ...ref, commentId };
  const result = await verifySeedParallelOwnerGitHubApprovalV1({
    request, manifestSha256: digest, reference, nowMs: NOW,
    fetchFn: async (...args) => { fetches++; return fakeFetch(source)(...args); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_OWNER_COMMENT_REFERENCE');
  assert.equal(validateSeedParallelApprovalReferenceV1(reference), false);
  assert.equal(fetches, 0);
}

test('invalid reference schema is rejected before reading its comment ID', async () => {
  let reads = 0;
  let fetches = 0;
  const reference = {
    schemaVersion: 'not-an-approval-reference',
    get commentId() { reads++; throw new Error('COMMENT_ID_READ'); },
  };
  assert.equal(validateSeedParallelApprovalReferenceV1(reference), false);
  const result = await verifySeedParallelOwnerGitHubApprovalV1({
    request, manifestSha256: digest, reference, nowMs: NOW,
    fetchFn: async (...args) => { fetches++; return fakeFetch(source)(...args); },
  });
  assert.equal(result.reason, 'NO_OWNER_COMMENT_REFERENCE');
  assert.equal(reads, 0);
  assert.equal(fetches, 0);
});

for (const [label, commentId] of [
  ['numeric array', [7654321]], ['string array', ['7654321']],
  ['empty array', []], ['multiple IDs', [7654321, 7654322]],
  ['boxed number', Object(7654321)], ['boxed string', Object('7654321')],
  ['plain object', {}], ['null', null], ['undefined', undefined],
  ['true', true], ['false', false], ['symbol', Symbol('7654321')],
  ['bigint', 7654321n], ['NaN', NaN], ['infinity', Infinity],
  ['negative infinity', -Infinity], ['fraction', 7654321.5],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['zero', 0], ['negative', -1],
  ['overlong number', 10000000000000], ['overlong string', '10000000000000'],
  ['leading zero', '07654321'], ['leading plus', '+7654321'],
  ['leading space', ' 7654321'], ['trailing space', '7654321 '], ['empty string', ''],
]) {
  test('noncanonical comment ID is rejected before lookup: ' + label, async () => {
    await assertRejectedCommentId(commentId);
  });
}

test('canonical comment ID bounds preserve existing numeric and string semantics', () => {
  for (const commentId of [1, '1', 9999999999999, '9999999999999']) {
    assert.equal(validateSeedParallelApprovalReferenceV1({ ...ref, commentId }), true);
  }
});

for (const [label, makeCommentId] of [
  ['object primitive hook', (convert) => ({ [Symbol.toPrimitive]: convert })],
  ['object string/value hooks', (convert) => ({ toString: convert, valueOf: convert })],
  ['array primitive hook', (convert) => Object.assign([7654321], { [Symbol.toPrimitive]: convert })],
]) {
  test('comment ID conversion is never invoked: ' + label, async () => {
    let conversions = 0;
    const commentId = makeCommentId(() => { conversions++; throw new Error('COMMENT_ID_COERCION'); });
    await assertRejectedCommentId(commentId);
    assert.equal(conversions, 0);
  });
}
test('same-account local pointer forgery cannot stand in for GitHub owner signature', async () => {
  for (const changed of [
    { user: { login: 'untrusted-agent' } },
    { author_association: 'CONTRIBUTOR' },
    { issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/999' },
    { id: 7654322 },
    { body: JSON.stringify(approval) },
    { body: '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify({
      ...approval, targetPath: 'docs/architecture/another.md',
    }) + '\n```' },
    { created_at: new Date(NOW - 2 * 86400000).toISOString() },
  ]) {
    const result = await verifySeedParallelOwnerGitHubApprovalV1({
      request, manifestSha256: digest, reference: ref, nowMs: NOW,
      fetchFn: fakeFetch({ ...source, ...changed }),
    });
    assert.equal(result.ok, false, JSON.stringify(changed));
  }
});
test('missing owner proof, malformed reference and exhausted GitHub are fail-closed', async () => {
  const cases = [
    { reference: { schemaVersion: SEED_PARALLEL_APPROVAL_REF_SCHEMA, commentId: 0 } },
    { reference: { ...ref, injected: true } },
    { reference: { ...ref, commentId: 1 } },
  ];
  for (const params of cases) {
    const r = await verifySeedParallelOwnerGitHubApprovalV1({
      request, manifestSha256: digest, nowMs: NOW, fetchFn: fakeFetch(source), ...params,
    });
    assert.equal(r.ok, false);
  }
  const r = await verifySeedParallelOwnerGitHubApprovalV1({
    request, manifestSha256: digest, reference: ref, nowMs: NOW, fetchFn: fakeFetch(source, 403),
  });
  assert.equal(r.ok, false);
});

test('one owner comment cannot be edited into a different exact task grant', async () => {
  const verify = (req, manifest, comment) => verifySeedParallelOwnerGitHubApprovalV1({
    request: req, manifestSha256: manifest, reference: ref, nowMs: NOW,
    fetchFn: fakeFetch(comment),
  });
  assert.equal((await verify(request, digest, source)).ok, true);
  const substitutions = [
    ['taskId', 'another-approved-task'], ['seedId', 'seed-other'],
    ['ownerIssue', '#3096'], ['targetPath', 'docs/architecture/other-seed.md'],
    ['baseSha', 'b'.repeat(40)], ['manifestSha256', 'f'.repeat(64)],
  ];
  for (const [field, value] of substitutions) {
    const changed = field === 'manifestSha256' ? request : { ...request, [field]: value };
    const manifest = field === 'manifestSha256' ? value : digest;
    const grant = makeParallelSeedExactApprovalV1({ request: changed,
      manifestSha256: manifest, nowUtc: new Date(NOW - 1000).toISOString(),
      expiryUtc: new Date(NOW + 300000).toISOString() });
    const edited = { ...source, updated_at: new Date(NOW - 500).toISOString(),
      body: '```stephanos-seed-parallel-owner-approval\n' + JSON.stringify(grant) + '\n```' };
    const result = await verify(changed, manifest, edited);
    assert.equal(result.ok, false, field);
    assert.equal(result.reason, 'GITHUB_APPROVAL_NOT_FRESH', field);
  }
  // Restoring an old body does not make an observably edited comment immutable.
  assert.equal((await verify(request, digest, { ...source,
    updated_at: new Date(NOW - 500).toISOString() })).ok, false);
  assert.equal((await verify(request, digest, source)).ok, true);
});

test('seed approval and execution titles use exact canonical issue data, never a fabricated title', async () => {
  let requests = 0;
  const valid = await resolveSeedParallelOwnerIssueLabelV1('#3026', {
    fetchFn: async (url, options) => {
      requests++;
      assert.equal(url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3026');
      assert.equal(options.redirect, 'error');
      return { status: 200, text: async () => JSON.stringify({
        number: 3026, title: 'Stephanos Full Sovereignty: Every Function, Zero External Critical Dependencies',
      }) };
    },
  });
  assert.equal(requests, 1);
  assert.equal(valid.issueTitleTruth, 'CURRENT_CANONICAL_GITHUB');
  assert.equal(valid.label, '#3026 — Stephanos Full Sovereignty: Every Function, Zero External Critical Dependencies');
  for (const response of [
    { status: 403 },
    { status: 200, body: { number: 3027, title: 'wrong issue' } },
    { status: 200, body: { number: 3026, title: '' } },
    { status: 200, body: { number: 3026, title: 'bad\ncontrol' } },
  ]) {
    const result = await resolveSeedParallelOwnerIssueLabelV1('#3026', {
      fetchFn: async () => ({
        status: response.status, text: async () => JSON.stringify(response.body || {}),
      }),
    });
    assert.equal(result.issueTitleTruth, 'UNAVAILABLE');
    assert.equal(result.label, '#3026 — title unavailable from current evidence');
  }
  const invalid = await resolveSeedParallelOwnerIssueLabelV1('#3026/../../../secrets', {
    fetchFn: async () => { throw Error('must never request a bad URL'); },
  });
  assert.equal(invalid.issueTitleTruth, 'UNAVAILABLE');
});

test('supervisor uses canonical title truth in both approval and run-once packets', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../scripts/seed-canopy-parallel-supervisor.mjs', import.meta.url), 'utf8');
  assert.match(source, /resolveSeedParallelOwnerIssueLabelV1\(entry\.request\.ownerIssue\)/);
  assert.match(source, /resolveSeedParallelOwnerIssueLabelV1\(selected\.request\.ownerIssue\)/);
  assert.match(source, /owner: issueLabel\.label/);
  assert.match(source, /issueTitleTruth: issueLabel\.issueTitleTruth/);
});
