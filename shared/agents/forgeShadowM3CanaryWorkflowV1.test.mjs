import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../.forgejo/workflows/forge-shadow-m3-isolation-canary-v1.yml', import.meta.url);

test('canary workflow is manual, permissionless, exact-source bound and has both fixed isolated jobs', async () => {
  const source = await readFile(workflowUrl, 'utf8');

  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.match(source, /^permissions: \{\}$/m);
  assert.match(source, /^  linux-isolation:/m);
  assert.match(source, /^    if: inputs\.runner_class == 'linux-isolated'$/m);
  assert.match(source, /^    runs-on: \[self-hosted, linux, x64, stephanos-forge, ephemeral, "\$\{\{ inputs\.runner_id \}\}"\]$/m);
  assert.match(source, /^  windows-isolation:/m);
  assert.match(source, /^    if: inputs\.runner_class == 'windows-proof-isolated'$/m);
  assert.match(source, /^    runs-on: \[self-hosted, windows, x64, stephanos-forge, proof-only, ephemeral, "\$\{\{ inputs\.runner_id \}\}"\]$/m);
  assert.equal((source.match(/runner_id:/g) || []).length, 1);
  assert.match(source, /RUNNER_NAME:-/);
  assert.match(source, /CANARY_RUNNER_ID_MISMATCH/);
  assert.match(source, /GITHUB_SHA:-.*EXPECTED_HEAD/);
  assert.match(source, /\$env:GITHUB_SHA -ne \$env:EXPECTED_HEAD/);
  assert.match(source, /CANONICAL_CHECKOUT_VISIBLE/);
  assert.match(source, /CONTAINER_SOCKET_VISIBLE/);
  assert.match(source, /GITHUB_CREDENTIAL_VISIBLE/);
});

test('canary workflow cannot fetch source, consume secrets, widen authority or run an unbounded job', async () => {
  const source = await readFile(workflowUrl, 'utf8');

  assert.doesNotMatch(source, /actions\/checkout/i);
  assert.doesNotMatch(source, /secrets\./i);
  assert.doesNotMatch(source, /pull_request|push:|schedule:|repository_dispatch/i);
  assert.doesNotMatch(source, /permissions:\s*\n\s+contents:\s*write/i);
  assert.doesNotMatch(source, /docker_engine.*Write|podman\.sock.*Write/i);
  assert.equal((source.match(/timeout-minutes: 10/g) || []).length, 2);
  assert.equal((source.match(/FORGE_M3_CANARY_OK/g) || []).length, 2);
});
