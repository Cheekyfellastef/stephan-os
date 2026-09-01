import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');
const INDEPENDENT_REVIEW_WORKFLOW_ID = 318073448;

function step(source, name, nextName = null) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  if (!nextName) return source.slice(start);
  const nextMarker = `      - name: ${nextName}\n`;
  const end = source.indexOf(nextMarker, start + marker.length);
  return end < 0 ? '' : source.slice(start, end);
}

test('recovers one already-successful workflow-dispatch artifact through the existing receipt consumer', () => {
  const workflow = readWorkflow();
  const launch = step(workflow, 'Launch one exact missing canonical independent review', 'Discover successful review result for receipt recovery');
  const discover = step(workflow, 'Discover successful review result for receipt recovery', 'Download recovered successful independent review result');
  const download = step(workflow, 'Download recovered successful independent review result', 'Consume recovered successful independent review result');
  const consume = step(workflow, 'Consume recovered successful independent review result');

  assert.match(launch, /id: launch_missing/);
  assert.match(launch, /node scripts\/launch-missing-independent-review-v1\.mjs/);

  assert.match(discover, /always\(\)/);
  assert.match(discover, /steps\.launch_missing\.outcome == 'success'/);
  assert.match(discover, /STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(discover, /STEPHANOS_INDEPENDENT_REVIEW_RECOVERY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/);
  assert.match(discover, /node scripts\/recover-successful-independent-review-v1\.mjs/);

  assert.match(download, /steps\.recover_successful\.outputs\.recovery_required == 'true'/);
  assert.match(download, /uses: actions\/download-artifact@v4/);
  assert.match(download, /name: \$\{\{ steps\.recover_successful\.outputs\.artifact_name \}\}/);
  assert.match(download, /run-id: \$\{\{ steps\.recover_successful\.outputs\.run_id \}\}/);
  assert.match(download, /path: \$\{\{ runner\.temp \}\}\/recovered-independent-review/);

  assert.match(consume, /steps\.download_recovered_review\.outcome == 'success'/);
  assert.match(consume, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED:\s*'true'/);
  assert.match(consume, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_PATH:\s*\$\{\{ runner\.temp \}\}\/recovered-independent-review\/independent-review-result\.json/);
  assert.match(consume, /STEPHANOS_TRIGGER_REVIEW_RUN_ID:\s*\$\{\{ steps\.recover_successful\.outputs\.run_id \}\}/);
  assert.match(consume, /STEPHANOS_TRIGGER_REVIEW_RUN_ATTEMPT:\s*\$\{\{ steps\.recover_successful\.outputs\.run_attempt \}\}/);
  assert.match(consume, /node scripts\/exact-head-review-dispatch\.mjs/);
});

test('defers stale-receipt escalation until successful artifact recovery has been attempted', () => {
  const workflow = readWorkflow();
  const coordinate = step(workflow, 'Evaluate and advance one PR-scoped exact-head review state', 'Bind exact coordinator-run provenance to the exact review handoff');
  const consume = step(workflow, 'Consume recovered successful independent review result', 'Finalize a genuinely unrecoverable missing receipt');
  const finalize = step(workflow, 'Finalize a genuinely unrecoverable missing receipt');

  assert.match(coordinate, /STEPHANOS_DEFER_MISSING_RECEIPT_ESCALATION:\s*'true'/);
  assert.doesNotMatch(consume, /STEPHANOS_DEFER_MISSING_RECEIPT_ESCALATION/);
  assert.match(finalize, /steps\.coordinate\.outputs\.recovery_deferred == 'true'/);
  assert.match(finalize, /steps\.retry\.outputs\.decision == 'ALREADY_SUCCESSFUL'/);
  assert.match(finalize, /steps\.launch_missing\.outputs\.decision == 'ALREADY_SUCCESSFUL'/);
  assert.match(finalize, /steps\.consume_recovered_review\.outcome != 'success'/);
  assert.match(finalize, /STEPHANOS_TRIGGER_REVIEW_ARTIFACT_REQUIRED:\s*'false'/);
  assert.equal((workflow.match(/Finalize a genuinely unrecoverable missing receipt/g) || []).length, 1);
});

test('successful artifact recovery adds no second review dispatch, reviewer, or direct receipt parser', () => {
  const workflow = readWorkflow();
  assert.equal((workflow.match(/node scripts\/launch-missing-independent-review-v1\.mjs/g) || []).length, 1);
  assert.equal((workflow.match(/node scripts\/recover-successful-independent-review-v1\.mjs/g) || []).length, 1);
  assert.doesNotMatch(workflow, /recover-successful-independent-review[\s\S]*?\/dispatches/);
  assert.doesNotMatch(workflow, /recover-successful-independent-review[\s\S]*?rerun-failed-jobs/);
});

test('workflow-run artifact consumption binds the immutable canonical workflow id instead of lossy path or run-name metadata', () => {
  const workflow = readWorkflow();
  const canonicalWorkflowIdCheck = `github.event.workflow_run.workflow_id == ${INDEPENDENT_REVIEW_WORKFLOW_ID}`;
  const staticRunNameCheck = "github.event.workflow_run.name == 'Independent Merge Security Review'";

  assert.equal(workflow.split(canonicalWorkflowIdCheck).length - 1, 4);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.path/);
  assert.equal(workflow.split(staticRunNameCheck).length - 1, 0);
});

test('workflow-run artifact intake recovers terminal artifacts from both success and failure conclusions', () => {
  const workflow = readWorkflow();
  const recoverableConclusionCheck = 'contains(fromJSON(\'["success","failure"]\'), github.event.workflow_run.conclusion)';

  assert.equal(workflow.split(recoverableConclusionCheck).length - 1, 4);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.doesNotMatch(workflow, /contains\(fromJSON\('\["success","failure","cancelled"\]'\)/);
});
