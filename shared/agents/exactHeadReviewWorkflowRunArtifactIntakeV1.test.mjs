import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');
const INDEPENDENT_REVIEW_WORKFLOW_ID = 318073448;

test('workflow_run receipt intake keys the independent review by immutable workflow id, not lossy path metadata', () => {
  const workflow = readWorkflow();
  const identityGates = workflow.match(new RegExp(
    `github\\.event\\.workflow_run\\.workflow_id == ${INDEPENDENT_REVIEW_WORKFLOW_ID}`,
    'g',
  )) || [];
  const workflowRunRequiredBindings = workflow
    .split('\n')
    .filter((line) => line.includes('STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED:')
      && line.includes(`github.event.workflow_run.workflow_id == ${INDEPENDENT_REVIEW_WORKFLOW_ID}`));

  // The workflow_run webhook/list summary can omit `path`; the run's immutable
  // workflow_id is present and is later revalidated by the exact artifact/run
  // admission code. All four intake gates (plan download, plan requirement,
  // coordinate download, coordinate requirement) must use the same identity.
  assert.equal(identityGates.length, 4);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.path/);
  assert.equal(
    [...workflow.matchAll(/- name: Download the exact triggering independent-review artifact/g)].length,
    2,
  );
  assert.equal(workflowRunRequiredBindings.length, 2);
  // Preserve the existing recovered-successful-review consumer. It is a
  // separate already-downloaded artifact path and intentionally binds true.
  assert.match(workflow, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED:\s*'true'/);
  assert.match(workflow, /- Independent Merge Security Review/);
  assert.match(workflow, /contains\(fromJSON\('\["success","failure"\]'\), github\.event\.workflow_run\.conclusion\)/);
});
