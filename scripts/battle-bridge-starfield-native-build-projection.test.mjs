import assert from 'node:assert/strict';
import test from 'node:test';
import { createSanitizedMailboxReceiptProjection, serializeBoundedReceiptJson } from './battle-bridge-github-command-mailbox.mjs';
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
