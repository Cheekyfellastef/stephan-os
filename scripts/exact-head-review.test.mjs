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

test('blocks likely secrets and conflict markers', () => {
  const receipt = reviewExactHead({
    ...base,
    patch: '+<<<<<<< HEAD\n+-----BEGIN PRIVATE KEY-----\n',
  });
  assert.ok(receipt.findings.some(({ code }) => code === 'CONFLICT_MARKER'));
  assert.ok(receipt.findings.some(({ code }) => code === 'SECRET_PATTERN'));
});
