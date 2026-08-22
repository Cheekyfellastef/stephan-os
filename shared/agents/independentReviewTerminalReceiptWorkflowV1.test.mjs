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

test('review execution timeout cannot kill terminal receipt publication', () => {
  const source = workflowText();
  const reviewStep = source.match(/- name: Review the complete exact-head and exact-base diff without mutation authority\n([\s\S]*?)\n\s+- name: Upload the exact-run immutable independent review result/);
  assert.ok(reviewStep);
  assert.match(source, /independent-security-review:\n[\s\S]*?timeout-minutes: 25/);
  assert.match(reviewStep[1], /timeout-minutes: 15/);
  assert.match(source, /- name: Surface terminal exact-head findings or pre-artifact failure\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(source, /publish-independent-review-terminal-findings-v1\.mjs/);
});

test('trusted review workflow retains one job and exact checkout-policy shape', () => {
  const source = workflowText();
  assert.doesNotMatch(source, /^  terminal-review-receipt:\s*$/m);
  assert.equal([...source.matchAll(/uses: actions\/checkout@v4/g)].length, 2);
  assert.equal([...source.matchAll(/persist-credentials: false/g)].length, 2);
  assert.equal([...source.matchAll(/^    permissions:\s*$/gm)].length, 1);
});

test('terminal publisher remains after immutable result upload in the same trusted job', () => {
  const source = workflowText();
  const upload = source.indexOf('      - name: Upload the exact-run immutable independent review result');
  const publish = source.indexOf('      - name: Surface terminal exact-head findings or pre-artifact failure');
  assert.ok(upload >= 0);
  assert.ok(publish > upload);
  assert.match(source.slice(publish), /STEPHANOS_TERMINAL_REVIEW_HEAD:/);
  assert.match(source.slice(publish), /STEPHANOS_TERMINAL_REVIEW_BASE:/);
});
