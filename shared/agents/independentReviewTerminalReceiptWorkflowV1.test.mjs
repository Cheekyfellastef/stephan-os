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

function stepBody(source, name, nextName) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `missing ${name} step`);
  const end = nextName ? source.indexOf(`      - name: ${nextName}\n`, start + 1) : source.length;
  assert.ok(end > start, `missing ${nextName || 'workflow end'} boundary`);
  return source.slice(start, end);
}

test('review job reserves bounded execution time for immutable artifact and terminal receipt publication', () => {
  const source = workflowText();
  assert.match(source, /independent-security-review:\n[\s\S]*?timeout-minutes: 60/);

  const boundedBeforeTerminal = [
    ['Check out trusted exact-base reviewer', 'Check out trusted current-main reviewer', 4],
    ['Check out trusted current-main reviewer', 'Resolve exact immutable coordinator handoff artifact', 4],
    ['Resolve exact immutable coordinator handoff artifact', 'Download exact immutable coordinator handoff receipt', 4],
    ['Download exact immutable coordinator handoff receipt', 'Build exact workflow-dispatch review preflight', 4],
    ['Build exact workflow-dispatch review preflight', 'Prove bounded specialist policy', 4],
    ['Prove bounded specialist policy', 'Review the complete exact-head and exact-base diff without mutation authority', 5],
    ['Review the complete exact-head and exact-base diff without mutation authority', 'Upload the exact-run immutable independent review result', 15],
    ['Upload the exact-run immutable independent review result', 'Surface terminal exact-head findings or pre-artifact failure', 4],
  ];
  for (const [name, nextName, minutes] of boundedBeforeTerminal) {
    assert.match(stepBody(source, name, nextName), new RegExp(`timeout-minutes: ${minutes}`));
  }
  assert.match(source, /- uses: actions\/setup-node@v4\n\s+timeout-minutes: 4/);
  assert.match(stepBody(source, 'Surface terminal exact-head findings or pre-artifact failure'), /timeout-minutes: 4/);

  const workflowDispatchMaximumMinutes = 4 + 4 + 4 + 4 + 4 + 5 + 15 + 4 + 4;
  assert.equal(workflowDispatchMaximumMinutes, 48);
  assert.ok(60 - workflowDispatchMaximumMinutes >= 10);
});

test('trusted review workflow retains the current one-job checkout and least-authority policy shape', () => {
  const source = workflowText();
  assert.doesNotMatch(source, /^  terminal-review-receipt:\s*$/m);
  assert.equal([...source.matchAll(/uses: actions\/checkout@v4/g)].length, 2);
  assert.equal([...source.matchAll(/persist-credentials: false/g)].length, 2);
  assert.equal([...source.matchAll(/^    permissions:\s*$/gm)].length, 1);
});

test('terminal publisher remains after immutable result upload and both remain always-run bounded steps', () => {
  const source = workflowText();
  const upload = stepBody(source, 'Upload the exact-run immutable independent review result', 'Surface terminal exact-head findings or pre-artifact failure');
  const publish = stepBody(source, 'Surface terminal exact-head findings or pre-artifact failure');
  assert.match(upload, /if: \$\{\{ always\(\) \}\}/);
  assert.match(upload, /timeout-minutes: 4/);
  assert.match(publish, /if: \$\{\{ always\(\) \}\}/);
  assert.match(publish, /timeout-minutes: 4/);
  assert.match(publish, /STEPHANOS_TERMINAL_REVIEW_HEAD:/);
  assert.match(publish, /STEPHANOS_TERMINAL_REVIEW_BASE:/);
  assert.match(publish, /publish-independent-review-terminal-findings-v1\.mjs/);
});
