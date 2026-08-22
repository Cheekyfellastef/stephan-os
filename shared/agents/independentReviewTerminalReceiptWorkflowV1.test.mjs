import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'independent-merge-security-review.yml');

function workflowText() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

test('independent review terminal receipt survives primary job timeout boundary', () => {
  const source = workflowText();
  assert.match(source, /independent-security-review:\n[\s\S]*?timeout-minutes: 15/);
  assert.match(source, /terminal-review-receipt:\n\s+name: terminal-review-receipt\n\s+needs: independent-security-review\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(source, /terminal-review-receipt:[\s\S]*?actions\/download-artifact@v4[\s\S]*?continue-on-error: true|terminal-review-receipt:[\s\S]*?continue-on-error: true[\s\S]*?actions\/download-artifact@v4/);
  assert.match(source, /terminal-review-receipt:[\s\S]*?publish-independent-review-terminal-findings-v1\.mjs/);
});

test('primary review job no longer owns terminal publication', () => {
  const source = workflowText();
  const primaryStart = source.indexOf('  independent-security-review:');
  const terminalStart = source.indexOf('  terminal-review-receipt:');
  assert.ok(primaryStart >= 0 && terminalStart > primaryStart);
  const primary = source.slice(primaryStart, terminalStart);
  assert.doesNotMatch(primary, /publish-independent-review-terminal-findings-v1\.mjs/);
  assert.match(primary, /Upload the exact-run immutable independent review result/);
});

test('terminal publisher retains trusted source and exact run identity inputs', () => {
  const source = workflowText();
  const terminal = source.slice(source.indexOf('  terminal-review-receipt:'));
  assert.match(terminal, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(terminal, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(terminal, /stephanos-independent-review-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(terminal, /STEPHANOS_TERMINAL_REVIEW_HEAD:/);
  assert.match(terminal, /STEPHANOS_TERMINAL_REVIEW_BASE:/);
});
