import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSanitizedMailboxReceiptProjection, serializeBoundedReceiptJson, readMailboxReceipt, createWindowsSafeMailboxReceiptFilename } from './battle-bridge-github-command-mailbox.mjs';
import { STARFIELD_VR_NATIVE_BUILD_OPERATION as OP } from '../shared/agents/starfieldVrNativeBuildV1.mjs';

const HEAD = 'a'.repeat(40);
const REQUEST = 'starfield-native-build-projection-0001';
const artifacts = ['test-scoped-eye-ledger.exe', 'test-paired-scoped-eye-ledger.exe',
  'test-paired-source-observation.exe', 'native-paired-source-observe-test.exe', 'native-paired-source-observe.dll'];
function sample(change = {}) {
  const nativeBuild = { schemaVersion: 'stephanos.starfield-native-build.v1', sourceHead: HEAD, requestId: REQUEST,
    stage: 'paired-source-observe-v1', finalVerdict: 'STARFIELD_VR_NATIVE_BUILD_PASSED', reason: 'FIXED_BUILD_AND_SELF_TESTS_PASSED',
    originalSourceVerified: true, originalSourceUnchanged: true, sourceClosureVerified: true,
    isolatedBuildCreated: true, toolchainObserved: true, buildPassed: true, testsPassed: true,
    allJobsEmpty: true, executionCustodyReleased: true, outputComplete: true, terminalFinalized: true,
    stagesCompleted: 1, sourceClosureSha256: 'b'.repeat(64), recipeSha256: 'c'.repeat(64),
    artifacts: artifacts.map(name => ({ name, bytes: 1024, sha256: 'd'.repeat(64) })),
    arbitraryShellAllowed: false, arbitraryPathAllowed: false, arbitraryExecutableAllowed: false,
    providerMutationAllowed: false, sourceMutationAllowed: false, launchAllowed: false, pixelsCaptured: false,
    gpuCommandsIssued: false, openXrSubmitted: false, headsetPlaytestReady: false,
    rawOutput: 'PRIVATE_SOURCE_OR_LOG', privatePath: 'C:\\private', ...change };
  return { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', requestId: REQUEST,
    operation: OP, repository: 'Cheekyfellastef/stephan-os', issueNumber: 3258, branch: 'main',
    state: 'DONE', expectedHead: HEAD, result: { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: OP, result: { ok: true, expectedHead: HEAD, sourceHead: HEAD,
        finalVerdict: nativeBuild.finalVerdict, launchAllowed: false, nativeBuild } } };
}

test('retained and public mailbox receipts preserve the typed native build proof', () => {
  const receipt = sample(); const retained = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(retained.nativeBuild.buildPassed, true);
  assert.equal(retained.operationResult.nativeBuild.testsPassed, true);
  assert.equal(retained.nativeBuild.headsetPlaytestReady, false);
  const publicJson = serializeBoundedReceiptJson(receipt);
  assert.equal(typeof publicJson, 'string');
  const published = JSON.parse(publicJson);
  assert.equal(published.result.result.nativeBuild.executionCustodyReleased, true);
  assert.equal(published.result.result.nativeBuild.sourceHead, HEAD);
  assert(!JSON.stringify(retained).includes('PRIVATE_SOURCE_OR_LOG'));
  assert(!publicJson.includes('PRIVATE_SOURCE_OR_LOG'));
  assert(!publicJson.includes('C:\\\\private'));
});

test('claimed pixel readiness or missing native zero cannot enter the public build proof', () => {
  for (const change of [{ pixelsCaptured: true }, { allJobsEmpty: false },
    { terminalFinalized: false }, { requestId: 'different-native-build-0001' }, { sourceHead: 'b'.repeat(40) }]) {
    const retained = createSanitizedMailboxReceiptProjection(sample(change));
    assert.equal(retained.nativeBuild, null); assert.equal(retained.operationResult.nativeBuild, null);
    const published = JSON.parse(serializeBoundedReceiptJson(sample(change)));
    assert.equal(published.result.result.nativeBuild, null);
  }
});

test('real receipt readback and bounded publication preserve original native build proof and authority binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'starfield-native-build-readback-'));
  try {
    const raw = sample();
    // Retained owner publication is a real file, not an invented `result`.
    writeFileSync(join(root, createWindowsSafeMailboxReceiptFilename(REQUEST)),
      serializeBoundedReceiptJson(raw, 256 * 1024), 'utf8');
    const observed = await readMailboxReceipt({ targetRequestId: REQUEST, expectedHead: HEAD }, {
      readSourceIdentity: async () => ({ ok: true, sourceHead: HEAD }),
      receiptRoot: root,
    });
    assert.equal(observed.ok, true);
    assert.equal(observed.finalVerdict, 'MAILBOX_RECEIPT_READ_READY');
    assert.equal(observed.targetRequestId, REQUEST);
    assert.equal(observed.receipt.operation, OP);
    assert.equal(observed.receipt.requestId, REQUEST);
    assert.equal(observed.receipt.expectedHead, HEAD);
    assert.equal(observed.receipt.nativeBuild.buildPassed, true);
    assert.equal(observed.receipt.operationResult.nativeBuild.testsPassed, true);
    assert.equal(observed.receipt.nativeBuild.headsetPlaytestReady, false);

    // The operation's selected original has an allowlisted projection without
    // raw `result`. Its second projection and public JSON must not drop proof.
    const secondPass = createSanitizedMailboxReceiptProjection(observed.receipt);
    assert.equal(secondPass.nativeBuild.buildPassed, true);
    assert.equal(secondPass.operationResult.nativeBuild.executionCustodyReleased, true);
    const secondPublished = JSON.parse(serializeBoundedReceiptJson(observed.receipt));
    assert.equal(secondPublished.result.result.nativeBuild.sourceHead, HEAD);
    assert.equal(secondPublished.result.result.nativeBuild.requestId, REQUEST);

    const outer = {
      schemaVersion: raw.schemaVersion, operation: 'READ_MAILBOX_RECEIPT',
      repository: raw.repository, issueNumber: raw.issueNumber, branch: raw.branch,
      requestId: 'starfield-native-build-read-0001', state: 'DONE', expectedHead: HEAD,
      result: { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', operation: 'READ_MAILBOX_RECEIPT',
        result: { ok: true, targetRequestId: REQUEST, receipt: observed.receipt } },
    };
    const publishedJson = serializeBoundedReceiptJson(outer);
    const published = JSON.parse(publishedJson);
    assert.equal(published.result.result.receipt.operation, OP);
    assert.equal(published.result.result.receipt.requestId, REQUEST);
    assert.equal(published.result.result.receipt.expectedHead, HEAD);
    assert.equal(published.result.result.receipt.nativeBuild.buildPassed, true);
    assert.equal(published.result.result.receipt.operationResult.nativeBuild.testsPassed, true);
    assert(!publishedJson.includes('PRIVATE_SOURCE_OR_LOG'));
    assert(!publishedJson.includes('C:\\\\private'));
    assert.equal(published.result.result.receipt.nativeBuild.headsetPlaytestReady, false);

    // No request or source identity can be substituted by the later READ.
    for (const change of [
      row => { row.execution.requestId = 'different-request-0001'; },
      row => { row.expectedHead = 'e'.repeat(40); },
      row => { row.operationResult.nativeBuild.requestId = 'different-request-0001'; },
      row => { row.operationResult.nativeBuild.sourceHead = 'e'.repeat(40); },
    ]) {
      const changed = JSON.parse(JSON.stringify(observed.receipt));
      change(changed);
      const projected = createSanitizedMailboxReceiptProjection(changed);
      assert.equal(projected.nativeBuild, null);
      assert.equal(projected.operationResult.nativeBuild, null);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
