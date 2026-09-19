import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/build-stephanos-ui.yml', import.meta.url);

test('Build Stephanos UI fans independent proof families into five parallel jobs', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  for (const job of ['scheduler-tests','runtime-guardrail-tests','surface-ignition-tests','vr-research-tests','build']) {
    assert.match(workflow, new RegExp(`^  ${job}:$`, 'm'));
  }
  assert.doesNotMatch(workflow, /^\s+needs:/m);
  assert.match(workflow, /shared\/agents\/elasticBuildCapacityV1\.test\.mjs/);
  assert.match(workflow, /shared\/agents\/boundedParallelConstructionLanesV1\.test\.mjs/);
  assert.match(workflow, /Run dependency-backed surface render test/);
  assert.match(workflow, /node --test --test-concurrency=1 stephanos-ui\/src\/components\/StatusPanel\.render\.test\.mjs/);
  assert.match(workflow, /npm run stephanos:build/);
  assert.match(workflow, /npm run stephanos:verify/);
  assert.equal((workflow.match(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g) || []).length, 5);
});

test('stateful suites remain serial only inside their isolated parallel job', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.equal((workflow.match(/node --test --test-concurrency=1/g) || []).length, 5);
  assert.doesNotMatch(workflow, /# These stateful routing suites share process-global fixtures/);
});
