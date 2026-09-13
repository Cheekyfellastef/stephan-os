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

test('patch escrow validation runs patched code in a networkless constrained digest-pinned container', () => {
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
  assert.match(block, /node:22-bookworm@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(block, /\n\s*node:22-bookworm\\\s*$/m);
});

test('isolated validator runs as the runner workspace owner identity', () => {
  const block = validationBlock();
  assert.match(block, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.doesNotMatch(block, /chmod\s+-R\s+(?:a\+rwX|ugo\+rwX).*\.git/);
});

test('isolated validator trusts only its exact bind-mounted Git workspace', () => {
  const block = validationBlock();
  assert.match(block, /--env GIT_CONFIG_COUNT=1/);
  assert.match(block, /--env GIT_CONFIG_KEY_0=safe\.directory/);
  assert.match(block, /--env GIT_CONFIG_VALUE_0=\/workspace/);
  assert.doesNotMatch(block, /GIT_CONFIG_VALUE_0=\*/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('docker run --rm')), /GIT_CONFIG_(?:COUNT|KEY_0|VALUE_0)/);
  const publishStart = workflow.indexOf('  publish:');
  assert.doesNotMatch(workflow.slice(publishStart), /GIT_CONFIG_(?:COUNT|KEY_0|VALUE_0)|safe\.directory/);
});

test('isolated validator receives only bounded workspace and read-only prepared input mounts', () => {
  const block = validationBlock();
  const mounts = [...block.matchAll(/--mount ([^\\\n]+)/g)].map((match) => match[1]);
  assert.equal(mounts.length, 2);
  assert.equal(mounts.some((mount) => mount.includes('dst=/workspace')), true);
  assert.equal(mounts.some((mount) => mount.includes('dst=/input,readonly')), true);
  assert.equal(mounts.some((mount) => mount.includes('dst=/output')), false);
  assert.doesNotMatch(block, /docker\.sock|podman\.sock/);
});

test('patched code can emit only a captured validation report and trusted host finalization happens after container exit', () => {
  const block = validationBlock();
  const dockerStart = block.indexOf('docker run --rm');
  const reportCapture = block.indexOf('patch-escrow-validation-report/validation-report.json');
  const finalize = block.indexOf('codex-patch-escrow-finalize-validation.mjs');
  assert.ok(dockerStart >= 0);
  assert.ok(reportCapture > dockerStart);
  assert.ok(finalize > reportCapture);
  assert.match(block, /node scripts\/codex-patch-escrow-validate-prepared\.mjs/);
  assert.doesNotMatch(block.slice(dockerStart, finalize), /patch-escrow-validated\.json/);
  assert.match(block.slice(finalize), /patch-escrow-validated\/patch-escrow-validated\.json/);
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
  assert.doesNotMatch(publish, /codex-patch-escrow-validate-prepared\.mjs/);
});

test('workflow verification pins both isolation regression and trusted finalizer syntax', () => {
  const verifyStart = workflow.indexOf('  verify:');
  const prepareStart = workflow.indexOf('\n  prepare-publication:', verifyStart);
  const verify = workflow.slice(verifyStart, prepareStart);
  assert.match(verify, /shared\/agents\/codexPatchEscrowWorkflowIsolation\.test\.mjs/);
  assert.match(verify, /node --check scripts\/codex-patch-escrow-finalize-validation\.mjs/);
});
