import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing shrink anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous shrink anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const adapterPath = 'shared/agents/protectedOpenClawMergeMailboxAdapter.mjs';
let adapter = readFileSync(adapterPath, 'utf8');
adapter = replaceOnce(
  adapter,
  "    expectedHeadSha: normalized.expectedHead,\n    requireExactBaseSha: true,\n    expectedBaseSha: normalized.expectedBase,\n    singleUse: true,",
  "    expectedHeadSha: normalized.expectedHead,\n    singleUse: true,",
  'signed claims exact-base fields',
);
writeFileSync(adapterPath, adapter, 'utf8');

const testPath = 'shared/agents/battleBridgeGitHubCommandMailboxProtectedMerge.test.mjs';
let tests = readFileSync(testPath, 'utf8');
tests = replaceOnce(tests, "import { mkdtempSync, readFileSync } from 'node:fs';", "import { mkdtempSync } from 'node:fs';", 'test fs import');
tests = replaceOnce(tests, "import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';\n", '', 'generic operator test import');
tests = replaceOnce(
  tests,
  "  assert.equal(plan.claims.expectedHeadSha, head);\n  assert.equal(plan.claims.expectedBaseSha, base);\n  assert.equal(plan.claims.requireExactBaseSha, true);\n  assert.match(plan.claims.branch, /^openclaw\\//);",
  "  assert.equal(plan.claims.expectedHeadSha, head);\n  assert.equal(Object.hasOwn(plan.claims, 'expectedBaseSha'), false);\n  assert.equal(Object.hasOwn(plan.claims, 'requireExactBaseSha'), false);\n  assert.equal(plan.normalized.expectedBase, base);\n  assert.match(plan.claims.branch, /^openclaw\\//);",
  'plan assertions',
);
const start = tests.indexOf("\ntest('OpenClaw operation fails closed on exact-base movement'");
if (start < 0) throw new Error('Missing generic OpenClaw exact-base test block.');
tests = tests.slice(0, start) + '\n';
writeFileSync(testPath, tests, 'utf8');

unlinkSync('.github/workflows/shrink-protected-openclaw-merge-adapter.yml');
unlinkSync('scripts/shrink-protected-openclaw-merge-adapter.mjs');
