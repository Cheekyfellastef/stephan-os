import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewExactHead } from './exact-head-review.mjs';

const base = {
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 42,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  changedFiles: ['shared/runtime/example.mjs'],
  patch: 'diff --git a/shared/runtime/example.mjs b/shared/runtime/example.mjs\n+export const safe = true;\n',
};

const bootstrapPatch = `diff --git a/.github/workflows/stephanos-exact-head-review.yml b/.github/workflows/stephanos-exact-head-review.yml
+permissions:
+  contents: read
+  pull-requests: read
+timeout-minutes: 5
+persist-credentials: false
+authority: Object.freeze({ readOnly: true, mayEdit: false, mayApprove: false, mayMerge: false, mayDeploy: false })
`;

const bootstrapFiles = [
  '.github/workflows/stephanos-exact-head-review.yml',
  'scripts/exact-head-review.mjs',
  'scripts/exact-head-review.test.mjs',
];

test('passes a bounded non-authority exact-head patch', () => {
  const receipt = reviewExactHead(base);
  assert.equal(receipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.deepEqual(receipt.findings, []);
  assert.equal(receipt.headSha, base.headSha);
  assert.equal(receipt.authority.mayMerge, false);
});

test('fails closed when full SHA evidence is absent', () => {
  const receipt = reviewExactHead({ ...base, headSha: 'abc' });
  assert.equal(receipt.verdict, 'STEPHANOS_REVIEW_FINDINGS');
  assert.ok(receipt.findings.some(({ code }) => code === 'INVALID_SHA'));
});

test('escalates authority-sensitive workflow changes', () => {
  const receipt = reviewExactHead({ ...base, changedFiles: ['.github/workflows/merge.yml'] });
  assert.ok(receipt.findings.some(({ code, severity }) => code === 'AUTHORITY_SURFACE_CHANGED' && severity === 'P2'));
});

test('allows only the exact read-only PR 1599 bootstrap surface', () => {
  const receipt = reviewExactHead({
    ...base,
    prNumber: 1599,
    changedFiles: bootstrapFiles,
    patch: bootstrapPatch,
  });
  assert.equal(receipt.verdict, 'STEPHANOS_REVIEW_PASS');
  assert.ok(receipt.findings.some(({ code, severity }) => code === 'BOOTSTRAP_SELF_REVIEW_EXCEPTION' && severity === 'INFO'));
  assert.equal(receipt.findings.some(({ severity }) => severity === 'P2'), false);
});

test('bootstrap exception fails closed for write authority or any extra file', () => {
  const writeReceipt = reviewExactHead({
    ...base,
    prNumber: 1599,
    changedFiles: bootstrapFiles,
    patch: `${bootstrapPatch}\n+contents: write\n`,
  });
  assert.ok(writeReceipt.findings.some(({ code }) => code === 'AUTHORITY_SURFACE_CHANGED'));

  const extraFileReceipt = reviewExactHead({
    ...base,
    prNumber: 1599,
    changedFiles: [...bootstrapFiles, 'shared/runtime/unrelated.mjs'],
    patch: bootstrapPatch,
  });
  assert.ok(extraFileReceipt.findings.some(({ code }) => code === 'AUTHORITY_SURFACE_CHANGED'));
});

test('blocks likely secrets and conflict markers', () => {
  const receipt = reviewExactHead({
    ...base,
    patch: '+<<<<<<< HEAD\n+-----BEGIN PRIVATE KEY-----\n',
  });
  assert.ok(receipt.findings.some(({ code }) => code === 'CONFLICT_MARKER'));
  assert.ok(receipt.findings.some(({ code }) => code === 'SECRET_PATTERN'));
});
