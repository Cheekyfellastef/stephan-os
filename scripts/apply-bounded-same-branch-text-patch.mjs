#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [filePath, expectedSha256, oldText, newText] = process.argv.slice(2);

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

if (!filePath || !expectedSha256 || oldText === undefined || newText === undefined) {
  fail(2, 'usage: node scripts/apply-bounded-same-branch-text-patch.mjs <file> <expected-sha256> <exact-old-text> <replacement-text>');
}
if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
  fail(2, 'PATCH_REFUSED: expected sha256 must be exactly 64 hex characters');
}
if (oldText.length === 0) {
  fail(2, 'PATCH_REFUSED: exact old text must not be empty');
}

const source = await readFile(filePath, 'utf8');
const actualSha256 = createHash('sha256').update(source, 'utf8').digest('hex');
if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
  fail(5, `PATCH_REFUSED: file identity changed expected=${expectedSha256.toLowerCase()} actual=${actualSha256}`);
}

const first = source.indexOf(oldText);
if (first < 0) {
  fail(3, 'PATCH_REFUSED: exact target not found');
}
if (source.indexOf(oldText, first + oldText.length) >= 0) {
  fail(4, 'PATCH_REFUSED: exact target is not unique');
}

const updated = `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`;
await writeFile(filePath, updated, 'utf8');
const resultSha256 = createHash('sha256').update(updated, 'utf8').digest('hex');
console.log(JSON.stringify({
  verdict: 'BOUNDED_SAME_BRANCH_PATCH_APPLIED',
  filePath,
  expectedSha256: expectedSha256.toLowerCase(),
  resultSha256,
  replacements: 1,
  mergeAuthority: false,
  deploymentAuthority: false,
  runtimeMutationAuthority: false,
  branchCreationAuthority: false,
  pullRequestCreationAuthority: false,
}));