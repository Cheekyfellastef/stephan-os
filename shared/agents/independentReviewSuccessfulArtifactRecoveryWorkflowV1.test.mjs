import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');

function step(source, name, nextName = null) {
  const suffix = nextName ? `^      - name: ${nextName}` : '$';
  return source.match(new RegExp(`^      - name: ${name}\\n[\\s\\S]*?${suffix}`, 'm'))?.[0] || '';
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

test('successful artifact recovery adds no second review dispatch, reviewer, or direct receipt parser', () => {
  const workflow = readWorkflow();
  assert.equal((workflow.match(/node scripts\/launch-missing-independent-review-v1\.mjs/g) || []).length, 1);
  assert.equal((workflow.match(/node scripts\/recover-successful-independent-review-v1\.mjs/g) || []).length, 1);
  assert.doesNotMatch(workflow, /recover-successful-independent-review[\s\S]*?\/dispatches/);
  assert.doesNotMatch(workflow, /recover-successful-independent-review[\s\S]*?rerun-failed-jobs/);
});
