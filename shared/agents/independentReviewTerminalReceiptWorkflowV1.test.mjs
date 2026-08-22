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

function jobBody(source, jobName, nextJobName = null) {
  const start = source.indexOf(`  ${jobName}:\n`);
  assert.ok(start >= 0, `missing ${jobName} job`);
  const end = nextJobName ? source.indexOf(`  ${nextJobName}:\n`, start + 1) : source.length;
  assert.ok(end > start, `missing ${nextJobName || 'workflow end'} boundary`);
  return source.slice(start, end);
}

test('review execution timeout cannot consume terminal receipt publication budget', () => {
  const source = workflowText();
  const reviewJob = jobBody(source, 'independent-security-review', 'terminal-review-receipt');
  const terminalJob = jobBody(source, 'terminal-review-receipt');

  assert.match(reviewJob, /timeout-minutes: 25/);
  assert.match(reviewJob, /- name: Review the complete exact-head and exact-base diff without mutation authority\n\s+timeout-minutes: 15/);
  assert.doesNotMatch(reviewJob, /publish-independent-review-terminal-findings-v1\.mjs/);

  assert.match(terminalJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(terminalJob, /needs: independent-security-review/);
  assert.match(terminalJob, /timeout-minutes: 5/);
  assert.match(terminalJob, /publish-independent-review-terminal-findings-v1\.mjs/);
});

test('terminal receipt job uses trusted event-specific checkout and exact same-run artifact identity', () => {
  const source = workflowText();
  const terminalJob = jobBody(source, 'terminal-review-receipt');

  assert.match(terminalJob, /if: github\.event_name == 'pull_request_target'[\s\S]*?ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(terminalJob, /if: github\.event_name == 'workflow_dispatch'[\s\S]*?ref: \$\{\{ github\.sha \}\}/);
  assert.equal([...terminalJob.matchAll(/persist-credentials: false/g)].length, 2);
  assert.match(terminalJob, /continue-on-error: true/);
  assert.match(terminalJob, /name: stephanos-independent-review-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(terminalJob, /run-id: \$\{\{ github\.run_id \}\}/);
});

test('terminal publisher retains exact head/base bindings and pre-artifact fallback', () => {
  const source = workflowText();
  const terminalJob = jobBody(source, 'terminal-review-receipt');

  const download = terminalJob.indexOf('      - name: Download exact-run immutable independent review result when present');
  const publish = terminalJob.indexOf('      - name: Surface terminal exact-head findings or pre-artifact failure');
  assert.ok(download >= 0);
  assert.ok(publish > download);
  assert.match(terminalJob.slice(publish), /if: \$\{\{ always\(\) \}\}/);
  assert.match(terminalJob.slice(publish), /STEPHANOS_TERMINAL_REVIEW_PR:/);
  assert.match(terminalJob.slice(publish), /STEPHANOS_TERMINAL_REVIEW_BRANCH:/);
  assert.match(terminalJob.slice(publish), /STEPHANOS_TERMINAL_REVIEW_HEAD:/);
  assert.match(terminalJob.slice(publish), /STEPHANOS_TERMINAL_REVIEW_BASE:/);
});
