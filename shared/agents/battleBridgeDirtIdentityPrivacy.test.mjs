import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIRT_ITEM_IDENTITY_SCHEME,
  projectBeaconStatus,
} from '../../scripts/battle-bridge-outbound-health-beacon.mjs';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-08-30T08:20:00.000Z');
const SPEC = { id: 'githubSync', staleAfterMs: 60_000 };

function project(dirtClassification) {
  return projectBeaconStatus({
    timestampUtc: '2026-08-30T08:19:30.000Z',
    classification: 'BLOCKED_DIRTY_SOURCE',
    sourceHead: HEAD,
    dirtClassification,
  }, SPEC, NOW);
}

test('six hidden untracked items remain individually correlatable without publishing raw private paths', () => {
  const privatePaths = [
    'C:/Users/operator/private/alpha-one.json',
    'C:/Users/operator/private/bravo-two.json',
    'C:/Users/operator/private/charlie-three.json',
    'C:/Users/operator/private/delta-four.json',
    'C:/Users/operator/private/echo-five.json',
    'C:/Users/operator/private/foxtrot-six.json',
  ];
  const first = project({
    trackedSourceCount: 0,
    untrackedSourceCount: 6,
    unknownCount: 0,
    runtimeOnlyCount: 1,
    generatedSourceCount: 0,
    blocksSync: true,
    untrackedSource: privatePaths,
    runtimeOnly: ['C:/Users/operator/runtime/session.log'],
  });

  assert.equal(first.dirtFacts.pathValuesPublished, false);
  assert.equal(first.dirtFacts.pathIdentityValuesPublished, true);
  assert.equal(first.dirtFacts.pathIdentityScheme, DIRT_ITEM_IDENTITY_SCHEME);
  assert.equal(first.dirtFacts.blockingCount, 6);
  assert.equal(first.dirtFacts.blockingIdentityCount, 6);
  assert.equal(first.dirtFacts.identityCoverage, 'COMPLETE');
  assert.equal(first.dirtFacts.itemIdentities.length, 7);

  const blocking = first.dirtFacts.itemIdentities.filter((item) => item.classification === 'untracked-source');
  assert.equal(blocking.length, 6);
  assert.equal(new Set(blocking.map((item) => item.id)).size, 6);
  for (const item of first.dirtFacts.itemIdentities) {
    assert.match(item.id, /^[a-f0-9]{64}$/);
    assert.ok(!Object.hasOwn(item, 'path'));
  }

  const published = JSON.stringify(first.dirtFacts);
  for (const path of privatePaths) {
    assert.equal(published.includes(path), false);
    assert.equal(published.includes(path.split('/').at(-1)), false);
  }
  assert.equal(published.includes('C:/Users/operator/runtime/session.log'), false);

  const normalizedVariant = project({
    trackedSourceCount: 0,
    untrackedSourceCount: 6,
    unknownCount: 0,
    runtimeOnlyCount: 1,
    generatedSourceCount: 0,
    blocksSync: true,
    untrackedSource: privatePaths.map((path) => path.toUpperCase().replaceAll('/', '\\')),
    runtimeOnly: ['C:\\USERS\\OPERATOR\\RUNTIME\\SESSION.LOG'],
  });
  assert.deepEqual(normalizedVariant.dirtFacts.itemIdentities, first.dirtFacts.itemIdentities);
});

test('redacted blocking samples can carry complete stable identity while count-only telemetry remains fail-closed', () => {
  const samples = Array.from({ length: 6 }, (_, index) => `private/sample-${index + 1}.tmp`);
  const sampled = project({
    trackedSourceCount: 0,
    untrackedSourceCount: 6,
    unknownCount: 0,
    runtimeOnlyCount: 21,
    generatedSourceCount: 0,
    blocksSync: true,
    blockingSamples: samples,
  });
  assert.equal(sampled.dirtFacts.blockingIdentityCount, 6);
  assert.equal(sampled.dirtFacts.identityCoverage, 'COMPLETE');
  assert.equal(sampled.dirtFacts.itemIdentities.length, 6);
  assert.ok(sampled.dirtFacts.itemIdentities.every((item) => item.classification === 'blocking-sample'));
  assert.doesNotMatch(JSON.stringify(sampled.dirtFacts), /sample-[1-6]\.tmp/);

  const countOnly = project({
    trackedSourceCount: 0,
    untrackedSourceCount: 6,
    unknownCount: 0,
    runtimeOnlyCount: 21,
    generatedSourceCount: 0,
    blocksSync: true,
  });
  assert.equal(countOnly.dirtFacts.blockingIdentityCount, 0);
  assert.equal(countOnly.dirtFacts.identityCoverage, 'UNAVAILABLE');
  assert.equal(countOnly.dirtFacts.pathIdentityValuesPublished, false);
  assert.deepEqual(countOnly.dirtFacts.itemIdentities, []);
});
