import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  chooseSelectedConceptId,
  CONCEPT_CATALOG,
  CONCEPT_LIMIT,
  rankConcepts,
} from '../apps/vr-capability-atlas/atlas-concepts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function avifDimensions(filePath) {
  const data = Buffer.from(fs.readFileSync(filePath, 'ascii').replace(/\s+/g, ''), 'base64');
  assert.equal(data.subarray(4, 12).toString('ascii'), 'ftypavif');
  const marker = data.indexOf(Buffer.from('ispe'));
  assert.ok(marker >= 4, `AVIF dimensions unavailable for ${filePath}`);
  return { width: data.readUInt32BE(marker + 8), height: data.readUInt32BE(marker + 12) };
}

test('deluxe atlas exposes ten unique research-linked concept views', () => {
  assert.equal(CONCEPT_LIMIT, 10);
  assert.equal(CONCEPT_CATALOG.length, 10);
  assert.equal(new Set(CONCEPT_CATALOG.map((concept) => concept.id)).size, 10);
  for (const concept of CONCEPT_CATALOG) {
    assert.ok(concept.tags.length >= 8, `${concept.id} should have broad canonical research tags`);
  }
});

test('every concept has separate thumbnail, panel and 4K hero assets', () => {
  const expected = { thumb: [640, 360], panel: [1920, 1080], hero: [3840, 2160] };
  for (const concept of CONCEPT_CATALOG) {
    for (const [variant, dimensions] of Object.entries(expected)) {
      const filePath = path.resolve(root, 'apps/vr-capability-atlas', concept.assets[variant]);
      assert.ok(fs.existsSync(filePath), `${concept.id} ${variant} asset missing`);
      const actual = avifDimensions(filePath);
      assert.deepEqual([actual.width, actual.height], dimensions, `${concept.id} ${variant} dimensions`);
    }
  }
});

test('canonical research changes the strongest current concept', () => {
  const hands = rankConcepts(CONCEPT_CATALOG, [{ name: 'Hand proof', text: 'tracked hands body physics grabbing interaction planck higgs vrik', weight: 3 }]);
  const cinema = rankConcepts(CONCEPT_CATALOG, [{ name: 'Cinema proof', text: 'room fixed stereo theatre cutscene halo cinematic camera comfort 6dof', weight: 3 }]);
  assert.equal(hands[0].id, 'physical-interaction');
  assert.equal(cinema[0].id, 'cinematic-theatre');
});

test('user selection survives reranking while automatic selection follows the strongest match', () => {
  const ranked = rankConcepts(CONCEPT_CATALOG, [{ name: 'Conversion', text: 'flat conversion uevr vorpx depth stereo reconstruction openxr', weight: 3 }]);
  assert.equal(chooseSelectedConceptId(ranked, 'adaptive-dialogue', true), 'adaptive-dialogue');
  assert.equal(chooseSelectedConceptId(ranked, 'adaptive-dialogue', false), ranked[0].id);
  assert.equal(chooseSelectedConceptId(ranked, 'missing-concept', true), ranked[0].id);
});
