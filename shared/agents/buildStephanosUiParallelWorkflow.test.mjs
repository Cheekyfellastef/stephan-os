import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/build-stephanos-ui.yml', import.meta.url);

test('Build Stephanos UI fans independent proof families into five parallel jobs with reviewer suites in separate custody lanes', async () => {
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
  // Preserve main's Seed Forge read-only integration expectations alongside reviewer jobs.
  assert.doesNotMatch(workflow, /Run Seed Forge physical Git fixture integration/);
  assert.match(workflow, /shared\/runtime\/upliftWorkspaceProjectionV1\.test\.mjs/);
  assert.equal((workflow.match(/node --test --test-concurrency=1/g) || []).length, 5);
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

// Source candidates must never grant themselves protected CI authority.
// The new, read-only custody workflows independently run the reviewer suites
// on both GitHub-hosted operating systems and have separate exact-head checks.
test('Sovereign reviewer qualification suites remain in exact-head custody jobs', async () => {
  const highRisk = await readFile(new URL('../../.github/workflows/sovereign-high-risk-review-custody.yml', import.meta.url), 'utf8');
  const execution = await readFile(new URL('../../.github/workflows/sovereign-reviewer-execution-custody.yml', import.meta.url), 'utf8');
  for (const source of [highRisk, execution]) {
    assert.match(source, /os: \[ubuntu-latest, windows-latest\]/);
    assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    assert.match(source, /persist-credentials: false/);
    assert.match(source, /'scripts\/\*\*'/);
    assert.match(source, /'shared\/agents\/\*\*'/);
  }
  assert.match(highRisk, /shared\/agents\/sovereignHighRiskReviewCandidateV1\.test\.mjs/);
  assert.match(highRisk, /scripts\/sovereign-high-risk-advisory-v1\.test\.mjs/);
  assert.match(execution, /scripts\/sovereign-reviewer-wsl-bridge-v1\.test\.mjs/);
  assert.match(execution, /scripts\/sovereign-reviewer-ollama-calibration-v1\.test\.mjs/);
  assert.match(execution, /shared\/agents\/sovereignCalibrationV1\.test\.mjs/);
  assert.match(execution, /shared\/agents\/localReviewCapabilityExamV1\.test\.mjs/);
  assert.match(execution, /scripts\/sovereign-windows-review-calibration-v1\.test\.mjs/);
});
