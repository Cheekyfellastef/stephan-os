import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseBoundedGitHubJson,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';

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

test('oversized GitHub receipt becomes valid structured JSON rather than a sliced document', () => {
  const json = serializeBoundedReceiptJson({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-large-receipt',
    operation: 'READ_CAPABILITY_REGISTRY',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    state: 'DONE',
    proofRefs: ['receipts/github-command-mailbox/req-1507-large-receipt.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'STEPHANOS_CAPABILITY_REGISTRY_PASS',
        sourceHead: '704f64a1662de33bfd3ac2ff6531ad296bf5e846',
        payload: 'x'.repeat(20_000),
      },
    },
  }, 4096);
  const parsed = JSON.parse(json);
  assert.equal(parsed.githubProjectionTruncated, true);
  assert.equal(parsed.result.result.finalVerdict, 'STEPHANOS_CAPABILITY_REGISTRY_PASS');
  assert.ok(Buffer.byteLength(json, 'utf8') <= 4096);
});

test('runner wires capability registry and sanitized workspace reads without generic execution', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /buildStephanosCapabilityRegistrySummary/);
  assert.match(source, /createSanitizedSharedWorkspaceProjection/);
  assert.match(source, /readCapabilityRegistry/);
  assert.match(source, /readSharedWorkspaceStatus/);
  assert.match(source, /EXPECTED_HEAD_MISMATCH/);
  assert.match(source, /SHARED_WORKSPACE_LATEST_STATUS_READY/);
  assert.match(source, /projection\.currentStatus !== null/);
  assert.match(source, /arbitraryFilesystemAccess:\s*false/);
  assert.match(source, /commandExecutionAccess:\s*false/);
  assert.match(source, /sourceMutationAccess:\s*false/);
  assert.match(source, /Documents', 'Stephanos-openclaw-workspace/);
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});

test('published receipt reference maps to the canonical Shared Workspace receipt file', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /canonicalReceiptRoot = join\(sharedWorkspaceRoot, 'receipts', 'github-command-mailbox'\)/);
  assert.match(source, /writeFileSync\(canonicalPath, payload, 'utf8'\)/);
  assert.match(source, /ref: `receipts\/github-command-mailbox\/\$\{filename\}`/);
  assert.match(source, /writeFileSync\(legacyPath, payload, 'utf8'\)/);
  assert.doesNotMatch(source, /postReceipt\(\{ \.\.\.receipt, receiptPath \}\)/);
});
