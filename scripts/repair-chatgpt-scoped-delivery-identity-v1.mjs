#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs';
const testPath = 'shared/agents/sharedWorkspaceScopedDeliveryStatusV1.test.mjs';
const relayTestPath = 'scripts/chatgpt-shared-workspace-github-relay.test.mjs';

async function replaceExact(path, before, after) {
  const current = await readFile(path, 'utf8');
  if (!current.includes(before)) throw new Error(`EXPECTED_SEAM_MISSING:${path}`);
  const updated = current.replace(before, after);
  if (updated === current) throw new Error(`REPLACEMENT_NOOP:${path}`);
  await writeFile(path, updated, 'utf8');
}

await replaceExact(
  sourcePath,
`function identityMatches(record, subject) {
  const json = boundedJson(record).toLowerCase();
  if (!json) return false;
  const mergeCommitMatch = json.includes(subject.mergeCommit);
  const deploymentMatch = subject.deploymentRequestId && json.includes(subject.deploymentRequestId.toLowerCase());
  const prMatch = relatedPrMatches(record, subject.prNumber);
  return mergeCommitMatch || deploymentMatch || prMatch;
}`,
`const IDENTITY_KEYS = Object.freeze({
  repository: new Set(['repository', 'repositoryfullname', 'repofullname']),
  pr: new Set(['relatedpr', 'prnumber', 'pullrequestnumber']),
  merge: new Set([
    'mergecommit', 'expectedhead', 'localheadafter', 'sourcehead', 'checkouthead', 'servedsourcehead',
    'builtdisthead', 'buildhead', 'distcommit', 'distgitcommit',
    'servedbrowserhead', 'servedhead', 'servedcommit', 'runtimecommit', 'servedgitcommit',
  ]),
  deployment: new Set(['deploymentrequestid', 'correlationid', 'requestid']),
  feature: new Set(['featureid']),
});

function exactTextForKeys(record, keys, expected) {
  const normalizedExpected = text(expected).toLowerCase();
  return Boolean(normalizedExpected) && valueForKeys(record, keys)
    .some((value) => text(value).toLowerCase() === normalizedExpected);
}

function exactPrForKeys(record, expectedPr) {
  return valueForKeys(record, IDENTITY_KEYS.pr)
    .some((value) => normalizePrNumber(value) === expectedPr);
}

function identityMatches(record, subject) {
  return exactTextForKeys(record, IDENTITY_KEYS.repository, subject.repository)
    && exactPrForKeys(record, subject.prNumber)
    && exactTextForKeys(record, IDENTITY_KEYS.merge, subject.mergeCommit)
    && exactTextForKeys(record, IDENTITY_KEYS.deployment, subject.deploymentRequestId)
    && exactTextForKeys(record, IDENTITY_KEYS.feature, subject.featureId);
}`,
);

await replaceExact(
  testPath,
`    timestampUtc: '2026-08-06T15:50:00.000Z',
    relatedPr: '#1668',
    correlationId: SUBJECT.deploymentRequestId,
    proofRefs: ['proof/music-tile-live.json'],`,
`    timestampUtc: '2026-08-06T15:50:00.000Z',
    repository: SUBJECT.repository,
    relatedPr: '#1668',
    mergeCommit: SUBJECT.mergeCommit,
    correlationId: SUBJECT.deploymentRequestId,
    featureId: SUBJECT.featureId,
    proofRefs: ['proof/music-tile-live.json'],`,
);

await replaceExact(
  testPath,
`test('delivery stages advance only from exact subject evidence', () => {`,
`test('scoped evidence requires exact repository, PR, merge, deployment and feature identity', () => {
  const mismatches = [
    record({ repository: 'Other/example' }),
    record({ relatedPr: '#1667' }),
    record({ mergeCommit: '1111111111111111111111111111111111111111' }),
    record({ correlationId: 'req-1507-other-deployment' }),
    record({ featureId: 'another-feature' }),
  ];

  for (const evidence of mismatches) {
    const result = projection([evidence]);
    assert.equal(result.overallStatus, 'NO_MATCHING_RUNTIME_EVIDENCE');
    assert.equal(result.matchedRecordCount, 0);
    assert.equal(result.live, false);
  }
});

test('records cannot splice matching identity dimensions across separate evidence', () => {
  const result = projection([
    record({ repository: 'Other/example', status: 'PASS', updatedMusicTileServed: true }),
    record({ relatedPr: '#1667', status: 'PASS', playbackContinuedAfterRating: true }),
    record({ featureId: 'another-feature', status: 'PASS', autoUrlAndArtworkRuntimeProof: true }),
    record({ correlationId: 'req-1507-other-deployment', finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD', servedBrowserHead: SUBJECT.mergeCommit }),
  ]);
  assert.equal(result.matchedRecordCount, 0);
  assert.equal(result.overallStatus, 'NO_MATCHING_RUNTIME_EVIDENCE');
  assert.equal(result.live, false);
});

test('delivery stages advance only from exact subject evidence', () => {`,
);

await replaceExact(
  relayTestPath,
`        timestampUtc: '2026-07-16T19:09:00.000Z',
        relatedPr: '#1668',
        correlationId: statusSubject.deploymentRequestId,
        servedBrowserHead: statusSubject.mergeCommit,`,
`        timestampUtc: '2026-07-16T19:09:00.000Z',
        repository: statusSubject.repository,
        relatedPr: '#1668',
        correlationId: statusSubject.deploymentRequestId,
        featureId: statusSubject.featureId,
        servedBrowserHead: statusSubject.mergeCommit,`,
);

console.log('SCOPED_DELIVERY_EXACT_IDENTITY_REPAIR_APPLIED');
