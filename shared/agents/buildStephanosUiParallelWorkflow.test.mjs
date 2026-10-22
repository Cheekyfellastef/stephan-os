import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/build-stephanos-ui.yml', import.meta.url);
const pagesWorkflowUrl = new URL('../../.github/workflows/deploy-stephanos-pages.yml', import.meta.url);
const proofJobs = ['scheduler-tests', 'runtime-guardrail-tests', 'surface-ignition-tests', 'vr-research-tests', 'build'];

function rootBlock(source, name) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf(`${name}:`);
  assert.notEqual(start, -1, `missing ${name} section`);
  let end = start + 1;
  while (end < lines.length && !/^\S/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join('\n').trimEnd();
}

function childKeys(block) {
  return [...block.matchAll(/^  ([a-z][a-z0-9_-]*):/gm)].map((match) => match[1]);
}

function childBlock(block, name) {
  const lines = block.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing ${name} block`);
  let end = start + 1;
  while (end < lines.length && !/^  \S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n').trimEnd();
}

function assertSeparatedWorkflowAuthority(proof, pages) {
  assert.match(proof, /^name: Build Stephanos UI$/m);
  assert.match(pages, /^name: Deploy Stephanos Pages$/m);
  const proofEvents = rootBlock(proof, 'on');
  const pagesEvents = rootBlock(pages, 'on');
  assert.deepEqual(childKeys(proofEvents), ['push', 'pull_request', 'workflow_dispatch', 'schedule', 'issue_comment']);
  assert.deepEqual(childKeys(pagesEvents), ['push', 'workflow_dispatch', 'schedule', 'issue_comment']);
  // Required proof still runs for every PR, including deployment-workflow-only changes.
  assert.equal(childBlock(proofEvents, 'pull_request').trim(), 'pull_request:');
  for (const event of childKeys(pagesEvents)) {
    assert.equal(childBlock(pagesEvents, event), childBlock(proofEvents, event), `${event} trigger scope must stay identical`);
  }
  assert.deepEqual(childKeys(rootBlock(proof, 'jobs')), proofJobs);
  assert.deepEqual(childKeys(rootBlock(pages, 'jobs')), ['pages-deploy']);
  assert.deepEqual(rootBlock(proof, 'permissions').split('\n').map((line) => line.trim()), ['contents: read']);
  assert.deepEqual(rootBlock(pages, 'permissions').split('\n').map((line) => line.trim()), ['contents: read', 'pages: write', 'id-token: write']);
  assert.doesNotMatch(proof, /actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/);
  assert.doesNotMatch(pages, /pull_request|pull_request_target/);
  assert.equal((pages.match(/uses: actions\/checkout@v4/g) || []).length, 1);
  assert.match(pages, /- name: Checkout current main\n\s+uses: actions\/checkout@v4\n\s+with:\n\s+ref: main\s*\n/);
}

test('PR validation and current-main Pages publication have separate triggers and credential boundaries', async () => {
  const [proof, pages] = await Promise.all([readFile(workflowUrl, 'utf8'), readFile(pagesWorkflowUrl, 'utf8')]);
  assertSeparatedWorkflowAuthority(proof, pages);
  assert.match(proof, /shared\/agents\/buildStephanosUiParallelWorkflow\.test\.mjs/,
    'the separation contract itself must run in required PR CI');
});

test('Pages publication preserves owner-only commands, serialized protected deployment and real artifact proof', async () => {
  const pages = await readFile(pagesWorkflowUrl, 'utf8');
  const job = childBlock(rootBlock(pages, 'jobs'), 'pages-deploy');
  const condition = job.match(/^    if: >-\n([\s\S]*?)(?=^    \S)/m)?.[1].trim();
  assert.equal(condition, [
    "github.event_name == 'schedule' ||",
    "      github.event_name == 'workflow_dispatch' ||",
    "      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||",
    "      (github.event_name == 'issue_comment' &&",
    "       github.event.comment.user.login == 'Cheekyfellastef' &&",
    "       github.event.comment.body == '/stephanos-deploy-pages')",
  ].join('\n'));
  assert.match(job, /concurrency:\n\s+group: stephanos-pages-live\n\s+cancel-in-progress: true/);
  assert.match(job, /environment:\n\s+name: github-pages\n\s+url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  for (const proof of [
    'tests/workspace-hydration-bridge.test.mjs',
    'stephanos-ui/src/components/FlywheelPanel.render.test.mjs',
    'stephanos-ui/src/components/upliftWorkspaceSurfaces.test.mjs',
    'npm run stephanos:build',
    'npm run stephanos:verify',
    'HOSTED_DIST_HEAD_MISMATCH',
    'HOSTED_FLYWHEEL_CONTRACT_MISSING',
    'GOAL_DASHBOARD_REMOTE_LIVE_ADAPTER_MISSING',
  ]) assert.ok(job.includes(proof), `missing existing deployment proof: ${proof}`);
  assert.match(job, /if \(builtCommit !== expectedCommit\)/);
  assert.match(job, /uses: actions\/upload-pages-artifact@v3\n\s+with:\n\s+path: _site/);
  assert.match(job, /id: deployment\n\s+uses: actions\/deploy-pages@v4/);
});

test('workflow separation rejects PR deployment, missing required proof and credential widening', async () => {
  const [proof, pages] = await Promise.all([readFile(workflowUrl, 'utf8'), readFile(pagesWorkflowUrl, 'utf8')]);
  const mutations = [
    [proof, pages.replace('on:\n', 'on:\n  pull_request:\n')],
    [proof, pages.replace('on:\n', 'on:\n  pull_request_target:\n')],
    [proof.replace('  pull_request:\n', "  pull_request:\n    paths: ['stephanos-ui/**']\n"), pages],
    [proof.replace('  scheduler-tests:\n', '  omitted-scheduler-tests:\n'), pages],
    [proof.replace('  contents: read\n', '  contents: read\n  pages: write\n'), pages],
    [proof, pages.replace('ref: main', 'ref: ${{ github.event.pull_request.head.sha }}')],
    [proof, pages.replace('      - main\n', '      - untrusted\n')],
  ];
  for (const [candidateProof, candidatePages] of mutations) {
    assert.throws(() => assertSeparatedWorkflowAuthority(candidateProof, candidatePages));
  }
});

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
