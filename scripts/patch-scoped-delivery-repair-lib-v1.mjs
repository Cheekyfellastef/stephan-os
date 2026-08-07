import fs from 'node:fs';
import path from 'node:path';

export const root = process.cwd();

export function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

export function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`PATCH_ANCHOR_NOT_UNIQUE:${label}`);
  return content.slice(0, first) + to + content.slice(first + from.length);
}

export function replaceAllExact(content, from, to, expectedCount, label) {
  const parts = content.split(from);
  const count = parts.length - 1;
  if (count !== expectedCount) throw new Error(`PATCH_COUNT_MISMATCH:${label}:${count}:${expectedCount}`);
  return parts.join(to);
}
