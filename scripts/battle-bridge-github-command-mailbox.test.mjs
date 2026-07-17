import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBoundedGitHubJson } from './battle-bridge-github-command-mailbox.mjs';

const runnerPath = new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url);

test('parses a GitHub issue-comment response larger than the diagnostic truncation limit', () => {
  const body = 'x'.repeat(424_551);
  const payload = JSON.stringify([{ id: 4998034338, body, user: { login: 'Cheekyfellastef' } }]);
  const parsed = parseBoundedGitHubJson(payload);
  assert.equal(parsed[0].id, 4998034338);
  assert.equal(parsed[0].body.length, 424_551);
});

test('fails closed when the GitHub response exceeds the bounded intake limit', () => {
  assert.throws(
    () => parseBoundedGitHubJson(JSON.stringify({ body: 'x'.repeat(256) }), 128),
    /GITHUB_RESPONSE_TOO_LARGE/,
  );
});

test('classifies invalid JSON without exposing truncated parser input', () => {
  assert.throws(
    () => parseBoundedGitHubJson('{"comments":'),
    /GITHUB_RESPONSE_JSON_INVALID/,
  );
});

test('runner wires capability registry and sanitized workspace reads without generic execution', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /buildStephanosCapabilityRegistryProjection/);
  assert.match(source, /createSanitizedSharedWorkspaceProjection/);
  assert.match(source, /readCapabilityRegistry/);
  assert.match(source, /readSharedWorkspaceStatus/);
  assert.match(source, /EXPECTED_HEAD_MISMATCH/);
  assert.match(source, /arbitraryFilesystemAccess:\s*false/);
  assert.match(source, /commandExecutionAccess:\s*false/);
  assert.match(source, /sourceMutationAccess:\s*false/);
  assert.match(source, /Documents', 'Stephanos-openclaw-workspace/);
  assert.match(source, /receiptRef/);
  assert.doesNotMatch(source, /postReceipt\(\{ \.\.\.receipt, receiptPath \}\)/);
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});
