import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);

test('resource-scopes PR-correlated coordination while global scans stay serialized by event', () => {
  const workflow = fs.readFileSync(workflowUrl, 'utf8');
  assert.match(workflow, /github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\)/);
  assert.match(workflow, /github\.event_name == 'issue_comment' && format\('pr-\{0\}', github\.event\.issue\.number\)/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha && format\('head-\{0\}', github\.event\.workflow_run\.head_sha\)/,
  );
  assert.match(workflow, /format\('coordinator-\{0\}', github\.event_name\)/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(workflow, /\|\| 'coordinator' \}\}/);
});
