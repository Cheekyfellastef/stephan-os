import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapperUrl = new URL('./independent-merge-security-review-with-windows-specialist-v1.mjs', import.meta.url);

async function source() {
  return readFile(wrapperUrl, 'utf8');
}

test('eligible specialist plans its complete reviewed source estate before retrieval', async () => {
  const text = await source();
  assert.match(text, /const specialistPlan = analyzeWindowsAuthoritySpecialistReview\(\{/);
  assert.match(text, /sources: \[\]/);
  assert.match(text, /specialistPlan\.eligible/);
  assert.match(text, /Array\.isArray\(specialistPlan\.reviewedPaths\)/);
  assert.match(text, /specialistPlan\.reviewedPaths\.length > 0/);
  assert.match(text, /specialistPlan\.reviewedPaths\.map\(\(path\) => text\(path\)\)/);
  assert.match(text, /const sources = await Promise\.all\(paths\.map\(\(path\) => exactHeadSource\(/);
});

test('unknown or non-eligible surfaces retain generic finding-path fail-closed fallback', async () => {
  const text = await source();
  assert.match(text, /const findingPaths = unique\(findings\.map\(\(item\) => text\(item\?\.path\)\)\.filter\(Boolean\)\)/);
  assert.match(text, /: findingPaths;/);
  assert.match(text, /if \(paths\.length === 0\) process\.exit\(child\.status \|\| 1\);/);
  assert.match(text, /if \(!specialist\.eligible\) process\.exit\(child\.status \|\| 1\);/);
  assert.match(text, /if \(!specialist\.clean\)/);
});

test('lineage remains immutable and is shared by planning and final specialist review', async () => {
  const text = await source();
  assert.match(text, /const lineageEvidence = await exactReconciliationLineage\(/);
  const matches = text.match(/lineageEvidence,/g) ?? [];
  assert.ok(matches.length >= 2, 'planning and final specialist review must share lineage evidence');
  assert.doesNotMatch(text, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});
