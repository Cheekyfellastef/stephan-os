import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const retryExecutorUrl = new URL('../../scripts/retry-independent-review.mjs', import.meta.url);

test('resource-scopes PR-correlated coordination while global scans stay serialized by event', () => {
  const workflow = fs.readFileSync(workflowUrl, 'utf8');
  assert.match(workflow, /github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\)/);
  assert.match(workflow, /github\.event_name == 'issue_comment' && format\('pr-\{0\}', github\.event\.issue\.number\)/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.pr_number && format\('pr-\{0\}', inputs\.pr_number\)/,
  );
  assert.match(
    workflow,
    /github\.event_name == 'workflow_run' && github\.event\.workflow_run\.name == 'Independent Merge Security Review' && github\.event\.workflow_run\.id && format\('review-run-\{0\}', github\.event\.workflow_run\.id\)/,
  );
  assert.match(
    workflow,
    /github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha && format\('head-\{0\}', github\.event\.workflow_run\.head_sha\)/,
  );
  assert.match(workflow, /format\('coordinator-\{0\}', github\.event_name\)/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(workflow, /\|\| 'coordinator' \}\}/);
});

test('discovers pull_request_target review runs by trusted base while preserving exact PR-head binding', () => {
  const retryExecutor = fs.readFileSync(retryExecutorUrl, 'utf8');
  assert.match(
    retryExecutor,
    /head_sha=\$\{encodedBase\}/,
  );
  assert.match(
    retryExecutor,
    /text\(run\?\.head_sha\)\.toLowerCase\(\) === expectedBase/,
  );
  assert.match(
    retryExecutor,
    /positiveInteger\(pr\?\.number\) === prNumber[\s\S]*text\(pr\?\.head\?\.sha\)\.toLowerCase\(\) === expectedHead[\s\S]*text\(pr\?\.base\?\.ref\) === 'main'[\s\S]*text\(pr\?\.base\?\.sha\)\.toLowerCase\(\) === expectedBase/,
  );
  assert.doesNotMatch(retryExecutor, /head_sha=\$\{encodedHead\}/);
});
