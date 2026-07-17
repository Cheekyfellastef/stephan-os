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
    operation: 'RUN_WORKER_WATCHDOG_ACCEPTANCE',
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
        finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS',
        sourceHead: '704f64a1662de33bfd3ac2ff6531ad296bf5e846',
        initialPid: 101,
        recoveredPid: 202,
        workerKilledObserved: true,
        supervisorDetectedWorkerDown: true,
        supervisorRestartedWorker: true,
        workerRecovered: true,
        workerFromMain: true,
        proofWrittenToSharedWorkspace: true,
        payload: 'x'.repeat(20_000),
      },
    },
  }, 4096);
  const parsed = JSON.parse(json);
  assert.equal(parsed.githubProjectionTruncated, true);
  assert.equal(parsed.result.result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(parsed.result.result.initialPid, 101);
  assert.equal(parsed.result.result.recoveredPid, 202);
  assert.equal(parsed.result.result.workerKilledObserved, true);
  assert.equal(parsed.result.result.supervisorDetectedWorkerDown, true);
  assert.equal(parsed.result.result.supervisorRestartedWorker, true);
  assert.equal(parsed.result.result.workerRecovered, true);
  assert.equal(parsed.result.result.workerFromMain, true);
  assert.equal(parsed.result.result.proofWrittenToSharedWorkspace, true);
  assert.ok(Buffer.byteLength(json, 'utf8') <= 4096);
});

test('runner wires capability registry, sanitized workspace reads and bounded watchdog acceptance', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /buildStephanosCapabilityRegistrySummary/);
  assert.match(source, /createSanitizedSharedWorkspaceProjection/);
  assert.match(source, /runBattleBridgeWorkerWatchdogAcceptance/);
  assert.match(source, /readCapabilityRegistry/);
  assert.match(source, /readSharedWorkspaceStatus/);
  assert.match(source, /runWorkerWatchdogAcceptance/);
  assert.match(source, /expectedHead: command\.expectedHead/);
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
