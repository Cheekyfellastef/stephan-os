import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from './seedGardenProjectionV1.mjs';
import {
  buildSeedCanopyCanonicalInventoryV1,
  serializeSeedCanopyCanonicalInventoryV1,
} from './seedCanopyCanonicalInventoryV1.mjs';
import {
  buildSeedCanopyInventoryGoldenVectorsV1,
  serializeSeedCanopyInventoryGoldenVectorsV1,
} from './fixtures/seedCanopyCanonicalInventoryV1.vectors.mjs';
import { renderParallelSeedCanonicalInventoryV1 } from '../runtime/seedCanopyParallelForgeV1.mjs';

const inventoryPath = new URL('./seedCanopyCanonicalInventoryV1.json', import.meta.url);
const vectorsPath = new URL('./fixtures/seedCanopyCanonicalInventoryV1.vectors.json', import.meta.url);

test('committed closed inventory is byte-exact derivative of actual canonical imports', () => {
  const expected = serializeSeedCanopyCanonicalInventoryV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
  assert.deepEqual(readFileSync(inventoryPath), Buffer.from(expected, 'utf8'));
  const projection = JSON.parse(expected);
  assert.deepEqual(Object.keys(projection), ['schemaVersion', 'seeds']);
  assert.equal(projection.seeds.length, HIGH_LEVEL_FLYWHEEL_SEEDS_V1.length);
  for (const row of projection.seeds)
    assert.deepEqual(Object.keys(row), ['seedId', 'title', 'issue', 'source', 'firstRung']);
});

test('native golden vectors are byte-exact output of the existing canonical renderer', () => {
  const expected = serializeSeedCanopyInventoryGoldenVectorsV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
  assert.deepEqual(readFileSync(vectorsPath), Buffer.from(expected, 'utf8'));
  const vectors = JSON.parse(expected);
  assert.equal(vectors.cases.length, HIGH_LEVEL_FLYWHEEL_SEEDS_V1.length + 7);
  assert.equal(new Set(vectors.cases.map((item) => item.name)).size, vectors.cases.length);
  for (const item of vectors.cases) {
    const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find((value) => value.seedId === item.manifest.seedId);
    assert.ok(seed);
    assert.equal(item.expectedContent, renderParallelSeedCanonicalInventoryV1(item.manifest, seed).content);
    assert.ok(item.expectedContent.endsWith('\n'));
    assert.ok(!item.expectedContent.includes('\r'));
    assert.ok(!item.expectedContent.startsWith('\uFEFF'));
  }
});

test('projection preserves canonical order and raw scalars without retaining mutable seed objects', () => {
  const seed = { ...HIGH_LEVEL_FLYWHEEL_SEEDS_V1[0], title: '  raw title  ', growthRungs: ['FIRST_RUNG'] };
  const projection = buildSeedCanopyCanonicalInventoryV1([seed]);
  assert.equal(projection.seeds[0].title, '  raw title  ');
  seed.title = 'Changed after projection';
  seed.growthRungs[0] = 'SECOND_RUNG';
  assert.equal(projection.seeds[0].title, '  raw title  ');
  assert.equal(projection.seeds[0].firstRung, 'FIRST_RUNG');
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.seeds));
  assert.ok(Object.isFrozen(projection.seeds[0]));
  const reversed = [...HIGH_LEVEL_FLYWHEEL_SEEDS_V1].reverse();
  assert.deepEqual(buildSeedCanopyCanonicalInventoryV1(reversed).seeds.map((row) => row.seedId),
    reversed.map((row) => row.seedId));
});

test('first-rung projection matches the renderer fallback without promoting a later rung', () => {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1[0];
  for (const growthRungs of [undefined, [], ['bad-rung', 'VALID_LATER'], [' PADDED_RUNG '], [null],
    ['VALID_RUNG\n'], ['VALID_RUNG\r'], ['VALID_RUNG\u2028'], ['VALID_RUNG\u2029']]) {
    const row = buildSeedCanopyCanonicalInventoryV1([{ ...seed, growthRungs }]).seeds[0];
    assert.equal(row.firstRung, 'INVENTORY');
  }
  assert.equal(buildSeedCanopyCanonicalInventoryV1([{ ...seed, growthRungs: ['VALID_RUNG'] }])
    .seeds[0].firstRung, 'VALID_RUNG');
  assert.throws(() => buildSeedCanopyCanonicalInventoryV1([{ ...seed, growthRungs: [123] }]),
    /RUNG_TYPE_INVALID/);
});

test('canonical field changes invalidate derived bytes rather than silently preserving a stale registry', () => {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1[0];
  const before = serializeSeedCanopyCanonicalInventoryV1([seed]);
  for (const change of [
    { seedId: 'changed-canonical-seed' },
    { title: seed.title + ' changed' },
    { issue: '#999999' },
    { source: 'shared/runtime/changedCanonicalSeed.mjs' },
    { growthRungs: ['CHANGED_RUNG'] },
  ]) {
    assert.notEqual(serializeSeedCanopyCanonicalInventoryV1([{ ...seed, ...change }]), before);
  }
});

test('closed projection rejects ambiguous identities and unsupported unbounded canonical data', () => {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1[0];
  assert.throws(() => buildSeedCanopyCanonicalInventoryV1([]), /COUNT_INVALID/);
  assert.throws(() => buildSeedCanopyCanonicalInventoryV1(Array(65).fill(seed)), /COUNT_INVALID/);
  assert.throws(() => buildSeedCanopyCanonicalInventoryV1([seed, seed]), /SEED_INVALID/);
  for (const change of [
    { seedId: ' Bad-ID ' },
    { seedId: 'valid-id\n' },
    { seedId: 'valid-id\u2028' },
    { title: '' },
    { title: 12 },
    { title: 'x'.repeat(2401) },
    { title: '\uD800' },
    { title: 'unmatched\uDC00' },
    { title: 'embedded\0title' },
    { issue: '123' },
    { issue: '#' + '1'.repeat(80) },
    { issue: '#123\n' },
    { issue: '#123\u2029' },
    { source: '../shared/runtime/seed.mjs' },
    { source: '/shared/runtime/seed.mjs' },
    { source: 'shared\\runtime\\seed.mjs' },
    { source: 'shared/runtime/seed.mjs:alternate' },
    { source: 'shared/runtime/unmatched\uD800.mjs' },
    { source: ' shared/runtime/seed.mjs' },
    { source: 'shared/runtime/seed.mjs\uFEFF' },
  ]) assert.throws(() => buildSeedCanopyCanonicalInventoryV1([{ ...seed, ...change }]), /SEED_INVALID/);
});

test('golden cases distinguish ECMAScript trim and UTF-16 length from platform defaults', () => {
  const vectors = buildSeedCanopyInventoryGoldenVectorsV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1);
  const byName = (name) => vectors.cases.find((item) => item.name === name);
  assert.match(byName('replace-cr-lf-tab-and-angle-brackets').expectedContent, /First  second  third  fourth/);
  assert.match(byName('ecmascript-trim-includes-bom').expectedContent, /\nInventory with ECMAScript whitespace\.\n/);
  assert.match(byName('ecmascript-trim-preserves-nel').expectedContent,
    /\n\u0085Inventory preserves NEXT LINE as text\.\u0085\n/);
  for (const name of ['maximum-intent-ascii', 'maximum-intent-astral-pair-at-boundary',
    'maximum-intent-astral-pairs']) assert.equal(byName(name).manifest.intent.length, 2400);
});

test('untrusted rung objects cannot execute coercion during canonical projection', () => {
  const seed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1[0];
  let calls = 0;
  const attacker = Object.freeze({
    toString() { calls++; return 'VALID_RUNG'; },
    valueOf() { calls++; return 123; },
  });
  for (const invalid of [attacker, new String('VALID_RUNG'), 0, 123, Symbol('VALID_RUNG')]) {
    assert.throws(() => buildSeedCanopyCanonicalInventoryV1([{ ...seed, growthRungs: [invalid] }]),
      /RUNG_TYPE_INVALID/);
  }
  assert.equal(calls, 0, 'untrusted rung toString and valueOf must never execute');
  const fallback = buildSeedCanopyCanonicalInventoryV1([{ ...seed, growthRungs: [null] }]);
  assert.equal(fallback.seeds[0].firstRung, 'INVENTORY');
});
