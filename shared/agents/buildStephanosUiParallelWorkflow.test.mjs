import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/build-stephanos-ui.yml', import.meta.url);

test('Build Stephanos UI fans independent proof families into seven isolated parallel jobs', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  for (const job of ['scheduler-tests','runtime-guardrail-tests','surface-ignition-tests','vr-research-tests','build',
    'sovereign-reviewer-calibration-contract-tests', 'sovereign-reviewer-native-windows-contract-tests']) {
    assert.match(workflow, new RegExp(`^  ${job}:$`, 'm'));
  }
  assert.doesNotMatch(workflow, /^\s+needs:/m);
  assert.match(workflow, /shared\/agents\/elasticBuildCapacityV1\.test\.mjs/);
  assert.match(workflow, /shared\/agents\/boundedParallelConstructionLanesV1\.test\.mjs/);
  assert.match(workflow, /Run dependency-backed surface render test/);
  assert.match(workflow, /node --test --test-concurrency=1 stephanos-ui\/src\/components\/StatusPanel\.render\.test\.mjs/);
  assert.match(workflow, /npm run stephanos:build/);
  assert.match(workflow, /npm run stephanos:verify/);
  assert.match(workflow, /shared\/agents\/sovereignCalibrationV1\.test\.mjs/);
  assert.match(workflow, /scripts\/sovereign-reviewer-ollama-calibration-v1\.test\.mjs/);
  assert.match(workflow, /scripts\/sovereign-reviewer-wsl-bridge-v1\.test\.mjs/);
  assert.match(workflow, /sovereign-reviewer-native-windows-contract-tests:[\s\S]*?runs-on: windows-latest/);
  assert.match(workflow, /github.event_name == 'pull_request' \|\| github.event_name == 'workflow_dispatch'/);
  assert.equal((workflow.match(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g) || []).length, 7);
});

test('stateful suites remain serial only inside their isolated parallel job', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  // Preserve main's Seed Forge read-only integration expectations alongside reviewer jobs.
  assert.doesNotMatch(workflow, /Run Seed Forge physical Git fixture integration/);
  assert.match(workflow, /shared\/runtime\/upliftWorkspaceProjectionV1\.test\.mjs/);
  assert.equal((workflow.match(/node --test --test-concurrency=1/g) || []).length, 7);
  assert.doesNotMatch(workflow, /# These stateful routing suites share process-global fixtures/);
});

const seedNativeActions = Object.freeze([
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9',
]);

function assertSeedNativeActionIdentity(workflow) {
  const actions = [...workflow.matchAll(/^\s*-\s*uses:\s*([^\s#]+).*$/gm)].map((match) => match[1]);
  assert.deepEqual(actions, seedNativeActions);
}

test('Seed native proof admits only both immutable verified action identities', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/seed-parallel-native-custody-proof.yml', import.meta.url), 'utf8');
  assertSeedNativeActionIdentity(workflow);
  for (const action of seedNativeActions) {
    const [name] = action.split('@');
    for (const ref of ['v4', 'main', '11d5960', '0'.repeat(40)]) {
      assert.throws(() => assertSeedNativeActionIdentity(workflow.replace(action, `${name}@${ref}`)),
        `reject ${name} at mutable, short or wrong ref`);
    }
  }
  assert.throws(() => assertSeedNativeActionIdentity(`${workflow}\n      - uses: actions/checkout@${'0'.repeat(40)}\n`));
  assert.throws(() => assertSeedNativeActionIdentity(workflow.replace('actions/checkout@', 'other/checkout@')));
});
