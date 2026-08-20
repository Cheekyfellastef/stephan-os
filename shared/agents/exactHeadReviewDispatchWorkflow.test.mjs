import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');

function workflowJob(source, name, nextName) {
  return source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?^  ${nextName}:`, 'm'))?.[0] || '';
}

function workflowStep(job, name, nextName) {
  return job.match(new RegExp(`^      - name: ${name}\\n[\\s\\S]*?^      - name: ${nextName}`, 'm'))?.[0] || '';
}

test('serializes every mutating coordinator trigger through one PR-scoped authority lock', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /\n  plan:\n[\s\S]*STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY:\s*'true'/);
  assert.match(workflow, /targets:\s*\$\{\{ steps\.plan\.outputs\.targets \}\}/);
  assert.match(workflow, /target:\s*\$\{\{ fromJSON\(needs\.plan\.outputs\.targets\) \}\}/);
  assert.match(
    workflow,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /STEPHANOS_EXACT_HEAD_REVIEW_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(
    workflow,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/,
  );
  assert.doesNotMatch(workflow, /format\('review-run-/);
  assert.doesNotMatch(workflow, /format\('head-/);
  assert.doesNotMatch(workflow, /format\('coordinator-/);
});

test('keeps verification read-only and plans global scans before per-PR mutation', () => {
  const workflow = readWorkflow();
  assert.match(workflow, /verify:\n[\s\S]*Progress: `VERIFIED_ONLY`/);
  assert.match(workflow, /plan:\n[\s\S]*Discover canonical PR targets without mutation/);
  assert.match(workflow, /coordinate:\n\s+needs: plan/);
  assert.match(workflow, /max-parallel:\s*4/);
});

test('pull-request planning succeeds neutrally without entering the real planner', () => {
  const workflow = readWorkflow();
  const plan = workflowJob(workflow, 'plan', 'coordinate');
  const neutral = workflowStep(
    plan,
    'Publish pull-request neutral planning truth',
    'Check out trusted default-branch planner',
  );
  const discovery = plan.match(
    /^      - name: Discover canonical PR targets without mutation\n[\s\S]*$/m,
  )?.[0] || '';

  assert.match(plan, /^  plan:\n    runs-on: ubuntu-latest/m);
  assert.match(neutral, /if: github\.event_name == 'pull_request'/);
  assert.match(neutral, /Progress: `PULL_REQUEST_PLAN_NEUTRAL`/);
  assert.doesNotMatch(neutral, /uses:|GITHUB_TOKEN|STEPHANOS_|node |gh |curl |workflow_dispatch|pull-requests: write|issues: write/);
  assert.match(
    discovery,
    /if: >-\n          github\.event_name != 'pull_request' &&\n          \(github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request != null\)/,
  );
  assert.match(discovery, /STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY:\s*'true'/);
});

test('every real planning dependency is gated away from pull-request verification', () => {
  const workflow = readWorkflow();
  const plan = workflowJob(workflow, 'plan', 'coordinate');
  const admitted = /if: >-\n          github\.event_name != 'pull_request' &&\n          \(github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request != null\)/g;
  assert.equal([...plan.matchAll(admitted)].length, 3);
  assert.match(plan, /permissions:\n      actions: read\n      contents: read\n      issues: read\n      pull-requests: read/);
  assert.match(workflow, /coordinate:\n    needs: plan\n    if: >-\n      needs\.plan\.outputs\.targets != ''/);
});

test('publishes an immutable exact-run artifact only after the handoff provenance binder succeeds', () => {
  const workflow = readWorkflow();
  const coordinate = workflow.match(/^  coordinate:\n[\s\S]*$/m)?.[0] || '';
  const bind = workflowStep(
    coordinate,
    'Bind exact coordinator-run provenance to a new review handoff',
    'Upload immutable coordinator-to-handoff run receipt',
  );
  const upload = workflowStep(
    coordinate,
    'Upload immutable coordinator-to-handoff run receipt',
    'Retry one exact failed canonical independent review',
  );

  assert.match(bind, /STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH:\s*\$\{\{ runner\.temp \}\}\/independent-review-handoff-run-receipt\.json/);
  assert.match(bind, /node scripts\/bind-independent-review-handoff-provenance-v1\.mjs/);
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /name: stephanos-independent-review-handoff-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}-comment-\$\{\{ steps\.coordinate\.outputs\.comment_id \}\}/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/independent-review-handoff-run-receipt\.json/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /overwrite: false/);
});
