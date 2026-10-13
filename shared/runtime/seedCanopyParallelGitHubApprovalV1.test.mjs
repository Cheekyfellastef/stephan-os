import test from 'node:test';
import assert from 'node:assert/strict';
import { makeParallelSeedExactApprovalV1 } from './seedCanopyParallelSupervisorV1.mjs';
import {
  SEED_PARALLEL_APPROVAL_REF_SCHEMA, verifySeedParallelOwnerGitHubApprovalV1,
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
test('fixed official GitHub API authenticates owner issue and exact task approval', async () => {
  const result = await verifySeedParallelOwnerGitHubApprovalV1({
    request, manifestSha256: digest, reference: ref, nowMs: NOW, fetchFn: fakeFetch(source),
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.source, 'GITHUB_OWNER_AUTHENTICATED_COMMENT');
});
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
