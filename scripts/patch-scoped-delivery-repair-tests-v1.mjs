import { read, write, replaceOnce, replaceAllExact } from './patch-scoped-delivery-repair-lib-v1.mjs';

const scopedTestPath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.test.mjs';
let scopedTest = read(scopedTestPath);

scopedTest = replaceOnce(
  scopedTest,
`  mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
  deploymentRequestId:`,
`  mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
  deploymentHead: 'c094260434fbe7cf35b9472f69ed07099216da0c',
  deploymentRequestId:`,
  'scoped-test-subject-head',
);

scopedTest = replaceOnce(
  scopedTest,
`    mergeCommit: SUBJECT.mergeCommit,
    correlationId:`,
`    mergeCommit: SUBJECT.mergeCommit,
    deploymentHead: SUBJECT.deploymentHead,
    correlationId:`,
  'scoped-test-record-head',
);

scopedTest = replaceOnce(
  scopedTest,
`  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, mergeCommit: 'short' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, command: 'dir' }).ok, false);`,
`  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, mergeCommit: 'short' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentHead: 'short' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentHead: undefined }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, command: 'dir' }).ok, false);`,
  'scoped-test-subject-validation',
);

scopedTest = replaceOnce(
  scopedTest,
`    record({ mergeCommit: '1111111111111111111111111111111111111111' }),
    record({ correlationId:`,
`    record({ mergeCommit: '1111111111111111111111111111111111111111' }),
    record({ deploymentHead: '1111111111111111111111111111111111111111' }),
    record({ result: { mergeCommit: '1111111111111111111111111111111111111111' } }),
    record({ result: { deploymentHead: '1111111111111111111111111111111111111111' } }),
    record({ result: { featureId: 'another-feature' } }),
    record({ correlationId:`,
  'scoped-test-identity-mismatch',
);

scopedTest = replaceAllExact(
  scopedTest,
`localHeadAfter: SUBJECT.mergeCommit`,
`localHeadAfter: SUBJECT.deploymentHead`,
  2,
  'scoped-test-sync-stage-heads',
);

scopedTest = replaceAllExact(
  scopedTest,
`builtDistHead: SUBJECT.mergeCommit`,
`builtDistHead: SUBJECT.deploymentHead`,
  2,
  'scoped-test-build-stage-heads',
);

scopedTest = replaceAllExact(
  scopedTest,
`servedBrowserHead: SUBJECT.mergeCommit`,
`servedBrowserHead: SUBJECT.deploymentHead`,
  4,
  'scoped-test-served-stage-heads',
);

scopedTest = replaceOnce(
  scopedTest,
`test('wrong served head, stale proof and current blockers fail closed', () => {`,
`test('conflicting feature booleans fail closed inside one otherwise matching record', () => {
  const result = projection([
    record({
      finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
      servedBrowserHead: SUBJECT.deploymentHead,
      updatedMusicTileServed: true,
      playbackContinuedAfterRating: true,
      autoUrlAndArtworkRuntimeProof: true,
      result: { playbackContinuedAfterRating: false },
    }),
  ]);
  assert.equal(result.live, false);
  assert.equal(result.overallStatus, 'SERVED_NOT_FEATURE_PROVEN');
  assert.equal(result.stages.featureProof.playbackContinuedAfterRating, false);
});

test('wrong served head, stale proof and current blockers fail closed', () => {`,
  'scoped-test-conflicting-feature-proof',
);

scopedTest = replaceOnce(
  scopedTest,
`test('wrong served head, stale proof and current blockers fail closed', () => {`,
`test('feature merge identity cannot substitute for the exact deployment head', () => {
  const result = projection([
    record({ state: 'ACCEPTED', requestId: SUBJECT.deploymentRequestId }),
    record({ classification: 'SYNC_FAST_FORWARD_APPLIED', localHeadAfter: SUBJECT.deploymentHead }),
    record({ status: 'BUILD_PASS', builtDistHead: SUBJECT.deploymentHead }),
    record({
      finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
      servedBrowserHead: SUBJECT.mergeCommit,
      updatedMusicTileServed: true,
      playbackContinuedAfterRating: true,
      autoUrlAndArtworkRuntimeProof: true,
    }),
  ]);
  assert.equal(result.live, false);
  assert.equal(result.overallStatus, 'BUILT_NOT_SERVED');
});

test('wrong served head, stale proof and current blockers fail closed', () => {`,
  'scoped-test-distinct-head-regression',
);

write(scopedTestPath, scopedTest);

const bridgeTestPath = 'shared/agents/chatGptParticipantBridgeV1.test.mjs';
let bridgeTest = read(bridgeTestPath);
bridgeTest = replaceOnce(
  bridgeTest,
`    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentRequestId:`,
`    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentHead: 'c094260434fbe7cf35b9472f69ed07099216da0c',
    deploymentRequestId:`,
  'bridge-test-status-subject-head',
);
bridgeTest = replaceOnce(
  bridgeTest,
`  const rejected = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',`,
`  const missingDeploymentHead = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',
    recordKind: CHATGPT_BRIDGE_RECORD_KINDS.DELIVERY_STATUS,
    boundedPayload: { statusSubject: { ...statusSubject, deploymentHead: undefined } },
  }));
  assert.equal(missingDeploymentHead.responseStatus, 'BLOCKED_PAYLOAD_UNSAFE');

  const rejected = verify(validRequest({
    operation: 'READ_DELIVERY_STATUS',`,
  'bridge-test-missing-deployment-head',
);
write(bridgeTestPath, bridgeTest);

const relayTestPath = 'scripts/chatgpt-shared-workspace-github-relay.test.mjs';
let relayTest = read(relayTestPath);
relayTest = replaceOnce(
  relayTest,
`    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentRequestId:`,
`    mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
    deploymentHead: 'c094260434fbe7cf35b9472f69ed07099216da0c',
    deploymentRequestId:`,
  'relay-test-status-subject-head',
);
relayTest = replaceOnce(
  relayTest,
`        correlationId: statusSubject.deploymentRequestId,
        featureId: statusSubject.featureId,
        servedBrowserHead: statusSubject.mergeCommit,`,
`        mergeCommit: statusSubject.mergeCommit,
        deploymentHead: statusSubject.deploymentHead,
        correlationId: statusSubject.deploymentRequestId,
        featureId: statusSubject.featureId,
        servedBrowserHead: statusSubject.deploymentHead,`,
  'relay-test-evidence-identity',
);
write(relayTestPath, relayTest);
