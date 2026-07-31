import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const independentWorkflow = new URL('../.github/workflows/independent-merge-security-review.yml', import.meta.url);
const operatorWorkflow = new URL('../.github/workflows/operator-merge-approval-gate.yml', import.meta.url);
const independentScript = new URL('./independent-merge-security-review-v2.mjs', import.meta.url);
const operatorScript = new URL('./operator-protected-merge-gate-v2.mjs', import.meta.url);

test('independent review publishes one exact-run immutable result artifact', async () => {
  const [workflow, script] = await Promise.all([
    readFile(independentWorkflow, 'utf8'),
    readFile(independentScript, 'utf8'),
  ]);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /name: stephanos-independent-review-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/independent-review-result\.json/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /overwrite: false/);
  assert.match(script, /buildIndependentReviewArtifact/);
  assert.match(script, /flag: 'wx'/);
  assert.match(script, /contents\/\$\{encodedPath\}\?ref=\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(script, /PROTECTED_WORKFLOW_SOURCE_MAX_BYTES/);
  assert.match(script, /new TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(script, /previous_filename/);
  assert.match(script, /protectedWorkflowSources/);
  assert.doesNotMatch(script, /node:child_process|\bspawnSync\b|\bexecSync\b|\beval\s*\(/);
  assert.match(script, /const artifactPath = writeReviewArtifact\(artifact\);[\s\S]*const comment = await postDisplayComment/);
});

test('operator review authority comes from the exact artifact, never a bot review comment', async () => {
  const [workflow, script] = await Promise.all([
    readFile(operatorWorkflow, 'utf8'),
    readFile(operatorScript, 'utf8'),
  ]);
  assert.match(workflow, /merge-group-evidence:/);
  assert.match(workflow, /needs: \[merge-group-evidence\]/);
  assert.equal(
    [...workflow.matchAll(/ref: \$\{\{ github\.event\.merge_group\.base_sha \}\}/g)].length,
    2,
  );
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(script, /validateIndependentReviewArtifactSet/);
  assert.match(script, /validateIndependentReviewArtifact/);
  assert.match(script, /actions\/runs\/\$\{[^}]+\}\/artifacts/);
  assert.match(script, /actions\/artifacts\/\$\{[^}]+\}\/zip/);
  assert.doesNotMatch(script, /function independentReviewCandidate\(/);
});
