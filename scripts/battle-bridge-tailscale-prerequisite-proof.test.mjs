import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/battle-bridge-tailscale-bootstrap-pipe.yml', import.meta.url);
const proofWorkflowUrl = new URL('../.github/workflows/battle-bridge-tailscale-bootstrap-proof.yml', import.meta.url);
const runnerUrl = new URL('./battle-bridge-tailscale-prerequisite-proof.mjs', import.meta.url);

async function workflowSource() {
  return readFile(workflowUrl, 'utf8');
}

const requiredProofPaths = [
  '.github/workflows/battle-bridge-tailscale-bootstrap-pipe.yml',
  '.github/workflows/battle-bridge-tailscale-bootstrap-proof.yml',
  'scripts/battle-bridge-exact-head-preservation-sync.mjs',
  'scripts/battle-bridge-exact-head-preservation-sync.test.mjs',
  'scripts/battle-bridge-tailscale-bootstrap-pipe.mjs',
  'scripts/battle-bridge-tailscale-bootstrap-pipe.test.mjs',
  'scripts/battle-bridge-tailscale-prerequisite-proof.mjs',
  'scripts/battle-bridge-tailscale-prerequisite-proof.test.mjs',
  'shared/agents/battleBridgeTailscaleBootstrapPipeV1.mjs',
  'shared/agents/battleBridgeTailscaleBootstrapPipeV1.test.mjs',
  'shared/agents/battleBridgeTailscalePrerequisiteProofV1.mjs',
  'shared/agents/battleBridgeTailscalePrerequisiteProofV1.test.mjs',
  'docs/architecture/battle-bridge-tailscale-bootstrap-pipe-v1.md',
  'docs/architecture/battle-bridge-tailscale-prerequisite-proof-v1.md',
];

function topLevelBlock(source, key) {
  const prefix = `\n${key}:\n`;
  const start = (`\n${source}`).indexOf(prefix);
  assert.ok(start >= 0, `${key} must remain an explicit workflow block`);
  const remainder = (`\n${source}`).slice(start + prefix.length);
  const end = remainder.search(/^\S/m);
  return end < 0 ? remainder : remainder.slice(0, end);
}

function blockKeys(source, key) {
  return [...topLevelBlock(source, key).matchAll(/^  ([a-z][a-z0-9_-]*):\s*$/gm)]
    .map((match) => match[1]);
}

function assertWorkflowSeparation(command, proof) {
  assert.deepEqual(blockKeys(command, 'on'), ['issue_comment']);
  assert.deepEqual(blockKeys(command, 'jobs'), ['bootstrap-canonical-github-sync', 'prerequisite-proof']);
  assert.deepEqual(blockKeys(proof, 'on'), ['pull_request']);
  assert.deepEqual(blockKeys(proof, 'jobs'), ['contract-proof']);
  assert.equal(topLevelBlock(proof, 'permissions').trim(), 'contents: read');
  const commandGroup = [...topLevelBlock(command, 'concurrency').matchAll(/^  group: (.+)$/gm)].map((match) => match[1]);
  const proofGroup = [...topLevelBlock(proof, 'concurrency').matchAll(/^  group: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(proofGroup, ['battle-bridge-tailscale-bootstrap-proof-pr-${{ github.event.pull_request.number || github.run_id }}']);
  assert.notDeepEqual(proofGroup, commandGroup, 'PR proof must not share the command event queue');
  assert.match(topLevelBlock(proof, 'concurrency'), /^  cancel-in-progress: false$/m);
  assert.doesNotMatch(proof, /^[ \t]+permissions:/m);
  assert.doesNotMatch(proof, /\b(?:secrets|vars)\.|id-token:|github\.token|GITHUB_TOKEN|GH_TOKEN|tailscale\/github-action@|\bssh\b|encoded-command/);
  const paths = [...topLevelBlock(proof, 'on').matchAll(/^      - '([^']+)'$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(paths, requiredProofPaths);
  assert.match(proof, /^    if: github\.event_name == 'pull_request'$/m);
  assert.equal((proof.match(/uses: actions\/checkout@v4/g) || []).length, 1);
  assert.deepEqual([...proof.matchAll(/^          ref: (.+)$/gm)].map((match) => match[1]), [
    '${{ github.event.pull_request.head.sha }}',
  ]);
  assert.match(proof, /^          fetch-depth: 0$/m);
  assert.match(proof, /^          node-version: '22'$/m);
}

test('PR proof has a separate event queue from command-only jobs and covers both workflows and preservation adapter changes', async () => {
  const [command, proof] = await Promise.all([workflowSource(), readFile(proofWorkflowUrl, 'utf8')]);
  assertWorkflowSeparation(command, proof);
});

test('workflow separation rejects mixed triggers, misplaced command jobs, unbound checkout and privileged proof', async (t) => {
  const [command, proof] = await Promise.all([workflowSource(), readFile(proofWorkflowUrl, 'utf8')]);
  const cases = [
    ['PR trigger on command workflow', command.replace('on:\n', 'on:\n  pull_request:\n'), proof],
    ['command trigger on PR proof', command, proof.replace('on:\n', 'on:\n  issue_comment:\n')],
    ['command job on PR proof', command, proof.replace('jobs:\n', 'jobs:\n  bootstrap-canonical-github-sync:\n    runs-on: ubuntu-latest\n')],
    ['shared command concurrency group', command, proof.replace('battle-bridge-tailscale-bootstrap-proof-pr-${{ github.event.pull_request.number || github.run_id }}', 'battle-bridge-tailscale-bootstrap-${{ github.event.issue.number || github.event.pull_request.number || github.run_id }}')],
    ['canceling an in-progress proof', command, proof.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
    ['checkout main instead of exact head', command, proof.replace('${{ github.event.pull_request.head.sha }}', 'main')],
    ['checkout base instead of exact head', command, proof.replace('pull_request.head.sha', 'pull_request.base.sha')],
    ['writable proof token', command, proof.replace('contents: read', 'contents: write')],
    ['job permission override', command, proof.replace('  contract-proof:\n', '  contract-proof:\n    permissions:\n      contents: write\n')],
    ['OIDC on PR proof', command, proof.replace('  contents: read\n', '  contents: read\n  id-token: write\n')],
    ['secret on PR proof', command, proof.replace('    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    env:\n      KEY: ${{ secrets.SSH_KEY }}\n')],
  ];
  for (const [name, changedCommand, changedProof] of cases) {
    await t.test(name, () => assert.throws(() => assertWorkflowSeparation(changedCommand, changedProof)));
  }
  for (const path of requiredProofPaths) {
    await t.test(`missing trigger path: ${path}`, () => {
      const changedProof = proof.replace(`      - '${path}'\n`, '');
      assert.throws(() => assertWorkflowSeparation(command, changedProof));
    });
  }
});

test('prerequisite proof stays inside the existing workflow and is owner-bound to canonical source authority', async () => {
  const source = await workflowSource();
  assert.match(source, /prerequisite-proof:/);
  assert.match(source, /github\.event\.issue\.number > 0/);
  assert.match(source, /canonical-mailbox-workflow-event-gate/);
  assert.doesNotMatch(source, /github\.event\.issue\.number == 1507/);
  assert.match(source, /github\.actor == 'Cheekyfellastef'/);
  assert.match(source, /```stephanos-battle-bridge-tailscale-bootstrap-prerequisites/);
  assert.doesNotMatch(source, /workflow_dispatch|repository_dispatch/);
});

test('read-only prerequisite marker cannot trigger the mutation job', async () => {
  const source = await workflowSource();
  const bootstrap = source.match(/  bootstrap-canonical-github-sync:[\s\S]*?\n  prerequisite-proof:/)?.[0] || '';
  assert.match(bootstrap, /contains\(github\.event\.comment\.body, '```stephanos-battle-bridge-tailscale-bootstrap'\)/);
  assert.match(bootstrap, /!contains\(github\.event\.comment\.body, '```stephanos-battle-bridge-tailscale-bootstrap-prerequisites'\)/);
  assert.match(bootstrap, /battle-bridge-tailscale-prerequisite-proof\.mjs settings-proof/);
  assert.match(bootstrap, /battle-bridge-tailscale-bootstrap-pipe\.mjs encoded-command/);
});

test('workflow keeps only the permissions needed for read-only content plus Tailscale OIDC', async () => {
  const source = await workflowSource();
  assert.match(source, /^permissions:\n  contents: read/m);
  assert.match(source, /bootstrap-canonical-github-sync:[\s\S]*?permissions:\n      contents: read\n      id-token: write/);
  assert.match(source, /prerequisite-proof:[\s\S]*?permissions:\n      contents: read\n      id-token: write/);
  assert.doesNotMatch(source, /issues:\s*write|pull-requests:\s*write|contents:\s*write|actions:\s*write/);
});

test('settings proof is uploaded before fail-closed and tailnet join', async () => {
  const source = await workflowSource();
  const job = source.match(/  prerequisite-proof:[\s\S]*$/)?.[0] || '';
  const settingsIndex = job.indexOf('Build redacted GitHub settings presence proof');
  const uploadIndex = job.indexOf('Upload redacted settings proof');
  const failIndex = job.indexOf('Fail closed if prerequisite settings are absent or unsafe');
  const joinIndex = job.indexOf('Join tailnet as fixed ephemeral recovery identity');
  assert.ok(settingsIndex >= 0 && uploadIndex > settingsIndex && failIndex > uploadIndex && joinIndex > failIndex);
  assert.match(job, /if: steps\.settings\.outputs\.ready == 'true'[\s\S]*uses: tailscale\/github-action@v4/);
});

test('prerequisite SSH hop retains the fixed Battle Bridge host and user bindings', async () => {
  const source = await workflowSource();
  const job = source.match(/  prerequisite-proof:[\s\S]*$/)?.[0] || '';
  assert.match(job, /BOOTSTRAP_HOST: \$\{\{ vars\.STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST \}\}/);
  assert.match(job, /BOOTSTRAP_USER: \$\{\{ vars\.STEPHANOS_BATTLE_BRIDGE_SSH_USER \}\}/);
  assert.match(job, /-l "\$BOOTSTRAP_USER"[\s\S]*"\$BOOTSTRAP_HOST"/);
});

test('both remote hops use strict SSH and fixed Tailscale recovery identity', async () => {
  const source = await workflowSource();
  assert.equal((source.match(/tags: tag:stephanos-github-recovery/g) || []).length, 2);
  assert.equal((source.match(/BatchMode=yes/g) || []).length, 2);
  assert.equal((source.match(/IdentitiesOnly=yes/g) || []).length, 2);
  assert.equal((source.match(/StrictHostKeyChecking=yes/g) || []).length, 2);
  assert.equal((source.match(/UserKnownHostsFile=/g) || []).length, 2);
  assert.doesNotMatch(source, /\$\{\{\s*github\.event\.comment\.body\s*\}\}[^\n]*ssh/);
});

test('contract proof exercises existing bootstrap code plus new prerequisite proof code', async () => {
  const source = await readFile(proofWorkflowUrl, 'utf8');
  assert.match(source, /node --test shared\/agents\/battleBridgeTailscaleBootstrapPipeV1\.test\.mjs/);
  assert.match(source, /node --test scripts\/battle-bridge-tailscale-bootstrap-pipe\.test\.mjs/);
  assert.match(source, /node --test shared\/agents\/battleBridgeTailscalePrerequisiteProofV1\.test\.mjs/);
  assert.match(source, /node --test scripts\/battle-bridge-tailscale-prerequisite-proof\.test\.mjs/);
  for (const path of [
    'scripts/battle-bridge-tailscale-bootstrap-pipe.mjs',
    'shared/agents/battleBridgeTailscaleBootstrapPipeV1.mjs',
    'scripts/battle-bridge-tailscale-prerequisite-proof.mjs',
    'shared/agents/battleBridgeTailscalePrerequisiteProofV1.mjs',
  ]) {
    assert.ok(source.includes(`node --check ${path}`), `missing syntax proof for ${path}`);
  }
  assert.match(source, /git diff --check origin\/main\.\.\.HEAD/);
});

test('prerequisite runner exposes bounded proof modes only and no child-process execution surface', async () => {
  const source = await readFile(runnerUrl, 'utf8');
  for (const mode of ['validate-event', 'settings-proof', 'encoded-command', 'validate-receipt']) {
    assert.match(source, new RegExp(`mode === '${mode}'`));
  }
  assert.doesNotMatch(source, /mode === ['"](?:run|exec|shell|powershell|command)['"]/i);
  assert.doesNotMatch(source, /spawn|execFile|execSync|spawnSync|child_process/);
});
