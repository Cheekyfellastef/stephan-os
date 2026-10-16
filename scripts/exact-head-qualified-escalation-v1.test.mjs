import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  assertQualifiableExactHeadReceiptV1,
  validateOwnerEscalationCommentV1,
  qualifyExactHeadReviewV1,
} from './exact-head-qualified-escalation-v1.mjs';

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40);
const diff = 'diff --git a/.github/workflows/merge.yml b/.github/workflows/merge.yml\n+const authenticated = true;\n';
const input = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os', prNumber: 3086,
  baseSha: SHA_B, headSha: SHA_A, patch: diff,
});
const receipt = Object.freeze({
  verdict: 'STEPHANOS_REVIEW_FINDINGS',
  repository: input.repository, prNumber: input.prNumber,
  baseSha: input.baseSha, headSha: input.headSha,
  findings: [{ severity: 'P2', code: 'AUTHORITY_SURFACE_CHANGED',
    file: '.github/workflows/merge.yml' }],
});
const sha = createHash('sha256').update(diff).digest('hex');
const time = '2026-10-13T11:00:00.000Z';
function comment(changes = {}, ownerChanges = {}) {
  const data = {
    schemaVersion: 'stephanos.exact-head-qualified-escalation.v1',
    operation: 'AUTHORIZE_EXACT_HEAD_REVIEW_ESCALATION',
    repository: input.repository, prNumber: input.prNumber,
    expectedHead: SHA_A, expectedBase: SHA_B, patchSha256: sha,
    reviewRunId: 1234, reviewRunAttempt: 1, reviewArtifactId: 5678,
    reviewArtifactDigest: 'sha256:' + 'c'.repeat(64),
    reviewPayloadSha256: 'd'.repeat(64),
    scope: 'exact-head-review-only', expiresAt: '2026-10-13T11:30:00.000Z',
    ...changes,
  };
  return {
    user: { login: 'Cheekyfellastef' }, author_association: 'OWNER',
    issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3086',
    created_at: time, updated_at: time, id: 999,
    body: '\x60\x60\x60stephanos-exact-head-qualified-review-v1\n'
      + JSON.stringify(data) + '\n\x60\x60\x60',
    ...ownerChanges,
  };
}
const get = () => validateOwnerEscalationCommentV1(comment(), input, sha, Date.parse(time) + 20_000);

test('only P2 authority and dynamic execution findings can request external qualification', () => {
  assert.equal(assertQualifiableExactHeadReceiptV1(input, receipt).patchSha256, sha);
  const dynamic = { ...receipt, findings: [{ severity: 'P2', code: 'DYNAMIC_EXECUTION' }] };
  assert.equal(assertQualifiableExactHeadReceiptV1(input, dynamic).patchSha256, sha);
  for (const finding of [
    { severity: 'P0', code: 'SECRET_PATTERN' },
    { severity: 'P1', code: 'INVALID_SHA' },
    { severity: 'P2', code: 'UNRECOGNISED' },
  ]) {
    assert.throws(() => assertQualifiableExactHeadReceiptV1(
      input, { ...receipt, findings: [receipt.findings[0], finding] },
    ), /UNRELATED_OR_SERIOUS_FINDINGS/);
  }
  assert.throws(() => assertQualifiableExactHeadReceiptV1(
    { ...input, patch: 'not a unified diff' }, receipt,
  ), /REVIEW_TARGET/);
  assert.throws(() => assertQualifiableExactHeadReceiptV1(
    input, { ...receipt, headSha: SHA_B },
  ), /REVIEW_IDENTITY/);
});

test('only a strict owner-authenticated immutable and expiring exact proof matches', () => {
  const p = get();
  assert.equal(p.commentId, 999);
  assert.equal(p.patchSha256, sha);
  assert.equal(p.scope, 'exact-head-review-only');
  for (const c of [
    comment({}, { user: { login: 'chatgpt-codex-connector[bot]' } }),
    comment({}, { author_association: 'NONE' }),
    comment({}, { issue_url: 'https://api.github.com/repos/other/repo/issues/3086' }),
    comment({}, { updated_at: '2026-10-13T11:00:02.000Z' }),
  ]) assert.throws(() => validateOwnerEscalationCommentV1(c, input, sha, Date.parse(time) + 20_000), /OWNER_PROVENANCE/);
  for (const alteration of [
    { expectedHead: SHA_B }, { expectedBase: SHA_A }, { patchSha256: '1'.repeat(64) },
    { scope: 'merge' }, { reviewRunId: 0 }, { extra: 'untrusted' },
    { expiresAt: '2026-10-13T13:00:00.000Z' },
  ]) {
    assert.throws(() => validateOwnerEscalationCommentV1(
      comment(alteration), input, sha, Date.parse(time) + 20_000,
    ));
  }
  assert.throws(() => validateOwnerEscalationCommentV1(
    comment(), input, sha, Date.parse('2026-10-13T12:00:00.000Z'),
  ), /OWNER_EXPIRY/);
});

test('without authenticated GitHub records escalation never becomes approval', async () => {
  let downloaded = false;
  await assert.rejects(() => qualifyExactHeadReviewV1(input, receipt, {
    api: async path => {
      if (path.startsWith('/pulls/')) return {
        state: 'open', draft: false,
        head: { sha: SHA_A, repo: { full_name: input.repository } },
        base: { ref: 'main', sha: SHA_B },
      };
      if (path === '/issues/3086') return { comments: 1 };
      if (path.startsWith('/issues/3086/comments')) return [comment()];
      return { name: 'forged', status: 'completed', conclusion: 'success' };
    },
    download: async () => { downloaded = true; return Buffer.from('forged'); },
    unzip: async () => '{}', nowMs: Date.parse(time) + 20_000,
  }), /REVIEW_RUN_UNBOUND/);
  assert.equal(downloaded, false);
});

test('untrusted PR data can never set review authority by adding a flag', () => {
  assert.equal(get().operation, 'AUTHORIZE_EXACT_HEAD_REVIEW_ESCALATION');
  assert.equal(get().scope, 'exact-head-review-only');
  assert.throws(() => validateOwnerEscalationCommentV1(
    comment({ mergeAuthority: true }), input, sha, Date.parse(time) + 20_000,
  ), /OWNER_SCHEMA/);
  assert.throws(() => assertQualifiableExactHeadReceiptV1(
    input, { ...receipt, verdict: 'STEPHANOS_REVIEW_PASS' },
  ), /REVIEW_IDENTITY/);
});

test('trusted workflow keeps review and qualified P2 in one fail-closed step', () => {
  const workflow = readFileSync(new URL('../.github/workflows/stephanos-exact-head-review.yml', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('./exact-head-qualified-escalation-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /run: node scripts\/exact-head-qualified-escalation-v1\.mjs review-proof\/input\.json review-proof\/receipt\.json/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /name: Gate hosted review on its own GitHub installation API budget/);
  assert.match(adapter, /const receipt = reviewExactHead\(input\)/);
  assert.match(adapter, /flag: 'wx', mode: 0o600/);
  assert.match(adapter, /APPROVAL|mergeAuthority: false/);
});
