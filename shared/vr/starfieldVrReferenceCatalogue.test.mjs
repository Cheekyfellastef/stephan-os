import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STARFIELD_VR_EVIDENCE_BOUNDARY,
  STARFIELD_VR_REFERENCES,
  STARFIELD_VR_RECOMMENDED_RECIPE,
  buildStarfieldVrRecipe,
  filterStarfieldVrReferences,
  validateStarfieldVrReferenceCatalogue,
} from './starfieldVrReferenceCatalogue.mjs';

test('Starfield VR reference catalogue is complete and internally valid', () => {
  const verdict = validateStarfieldVrReferenceCatalogue();
  assert.equal(verdict.ok, true, verdict.issues.join('; '));
  assert.ok(STARFIELD_VR_REFERENCES.length >= 10);
});

test('recommended recipe resolves only registered references and returns measurable tests', () => {
  const recipe = buildStarfieldVrRecipe();
  assert.deepEqual(recipe.referenceIds, STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds);
  assert.ok(recipe.acceptanceTests.length >= recipe.referenceIds.length);
  assert.match(recipe.capabilityLine, /Starfield/i);
  assert.equal(recipe.evidenceBoundary.authority, 'reference-only');
});

test('domain filtering exposes physical, cockpit and atmosphere reference families', () => {
  assert.ok(filterStarfieldVrReferences('embodiment').length >= 3);
  assert.ok(filterStarfieldVrReferences('cockpit').length >= 3);
  assert.ok(filterStarfieldVrReferences('atmosphere').length >= 2);
  assert.equal(filterStarfieldVrReferences('not-a-domain').length, 0);
});

test('catalogue never promotes a reference into implementation proof', () => {
  assert.match(STARFIELD_VR_EVIDENCE_BOUNDARY.summary, /do not prove implementation/i);
  for (const reference of STARFIELD_VR_REFERENCES) {
    assert.notEqual(reference.evidenceClass, 'runtime-proof');
    assert.match(reference.reusePosture, /(proprietary|licen|MIT|reuse)/i);
  }
});
