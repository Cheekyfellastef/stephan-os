import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'shared/agents/protectedOpenClawMergeMailboxAdapter.mjs';
const before = "export function protectedOpenClawMergeFields() {\n  return [...COMMAND_FIELDS];\n}";
const after = "export function protectedOpenClawMergeFields() {\n  return COMMAND_FIELDS.filter((field) => field !== 'prNumber');\n}";
const source = readFileSync(path, 'utf8');
if (!source.includes(before)) throw new Error('Protected merge field-overlap anchor is missing.');
if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('Protected merge field-overlap anchor is ambiguous.');
writeFileSync(path, source.replace(before, after), 'utf8');
unlinkSync('scripts/repair-protected-merge-field-overlap.mjs');
