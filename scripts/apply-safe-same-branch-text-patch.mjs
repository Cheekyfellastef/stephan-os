#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const [filePath, oldText, newText] = process.argv.slice(2);
if (!filePath || oldText === undefined || newText === undefined) {
  console.error('usage: node scripts/apply-safe-same-branch-text-patch.mjs <file> <exact-old-text> <replacement-text>');
  process.exit(2);
}
const source = await readFile(filePath, 'utf8');
const first = source.indexOf(oldText);
if (first < 0) {
  console.error('PATCH_REFUSED: exact target not found');
  process.exit(3);
}
if (source.indexOf(oldText, first + oldText.length) >= 0) {
  console.error('PATCH_REFUSED: exact target is not unique');
  process.exit(4);
}
const updated = `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`;
await writeFile(filePath, updated, 'utf8');
console.log('PATCH_APPLIED: exactly one target replaced');
