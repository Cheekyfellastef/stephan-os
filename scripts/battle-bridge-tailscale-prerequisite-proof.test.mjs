import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/battle-bridge-tailscale-bootstrap-pipe.yml', import.meta.url);
const runnerUrl = new URL('./battle-bridge-tailscale-prerequisite-proof.mjs', import.meta.url);

async function workflowSource() {
  return readFile(workflowUrl, 'utf8');
}

test('prerequisite proof stays inside the existing workflow and is owner-bound to issue 1507', async () => {
  const source = await workflowSource();
  assert.match(source, /prerequisite-proof:/);
  assert.match(source, /github\.event\.issue\.number == 1507/);
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
  const source = await workflowSource();
  assert.match(source, /node --test shared\/agents\/battleBridgeTailscaleBootstrapPipeV1\.test\.mjs/);
  assert.match(source, /node --test scripts\/battle-bridge-tailscale-bootstrap-pipe\.test\.mjs/);
  assert.match(source, /node --test shared\/agents\/battleBridgeTailscalePrerequisiteProofV1\.test\.mjs/);
  assert.match(source, /node --test scripts\/battle-bridge-tailscale-prerequisite-proof\.test\.mjs/);
});

test('prerequisite runner exposes bounded proof modes only and no child-process execution surface', async () => {
  const source = await readFile(runnerUrl, 'utf8');
  for (const mode of ['validate-event', 'settings-proof', 'encoded-command', 'validate-receipt']) {
    assert.match(source, new RegExp(`mode === '${mode}'`));
  }
  assert.doesNotMatch(source, /mode === ['"](?:run|exec|shell|powershell|command)['"]/i);
  assert.doesNotMatch(source, /spawn|execFile|execSync|spawnSync|child_process/);
});
