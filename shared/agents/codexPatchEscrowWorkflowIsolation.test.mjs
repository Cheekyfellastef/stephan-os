import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflowPath = new URL('../../.github/workflows/codex-patch-escrow-publisher.yml', import.meta.url);
const workflow = readFileSync(workflowPath, 'utf8');

function validationBlock() {
  const start = workflow.indexOf('  validate-publication:');
  const end = workflow.indexOf('\n  publish:', start);
  assert.notEqual(start, -1, 'validate-publication job must exist');
  assert.notEqual(end, -1, 'publish job must remain separate from validation');
  return workflow.slice(start, end);
}

test('patch escrow validation runs patched code in a networkless constrained container', () => {
  const block = validationBlock();
  assert.match(block, /docker run --rm/);
  assert.match(block, /--network none/);
  assert.match(block, /--read-only/);
  assert.match(block, /--cap-drop ALL/);
  assert.match(block, /--security-opt no-new-privileges/);
  assert.match(block, /--pids-limit 256/);
  assert.match(block, /--memory 2g/);
  assert.match(block, /--cpus 2/);
  assert.match(block, /--tmpfs \/tmp:rw,nosuid,nodev,size=512m/);
  assert.match(block, /node:22-bookworm/);
});

test('isolated validator receives only bounded workspace input and output mounts', () => {
  const block = validationBlock();
  const mounts = [...block.matchAll(/--mount ([^\\\n]+)/g)].map((match) => match[1]);
  assert.equal(mounts.length, 3);
  assert.equal(mounts.some((mount) => mount.includes('dst=/workspace')), true);
  assert.equal(mounts.some((mount) => mount.includes('dst=/input,readonly')), true);
  assert.equal(mounts.some((mount) => mount.includes('dst=/output')), true);
  assert.doesNotMatch(block, /docker\.sock|podman\.sock/);
});

test('validation container is not passed GitHub credentials and publication remains separate', () => {
  const block = validationBlock();
  assert.doesNotMatch(block, /secrets\.GITHUB_TOKEN/);
  assert.doesNotMatch(block, /(?:^|\s)-e\s+(?:GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)/m);
  assert.match(block, /persist-credentials: false/);

  const publishStart = workflow.indexOf('  publish:');
  assert.notEqual(publishStart, -1);
  const publish = workflow.slice(publishStart);
  assert.match(publish, /contents: write/);
  assert.match(publish, /Publish only the attested patch and tree without rerunning patched code/);
  assert.doesNotMatch(publish, /codex-patch-escrow-attest\.mjs/);
});

test('workflow verification itself pins the isolation regression', () => {
  const verifyStart = workflow.indexOf('  verify:');
  const prepareStart = workflow.indexOf('\n  prepare-publication:', verifyStart);
  const verify = workflow.slice(verifyStart, prepareStart);
  assert.match(verify, /shared\/agents\/codexPatchEscrowWorkflowIsolation\.test\.mjs/);
});
