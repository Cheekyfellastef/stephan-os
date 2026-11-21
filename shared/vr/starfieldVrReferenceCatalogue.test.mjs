import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STARFIELD_VR_EVIDENCE_BOUNDARY,
  STARFIELD_VR_REFERENCES,
  STARFIELD_VR_REFERENCE_DOMAINS,
  STARFIELD_VR_RECOMMENDED_RECIPE,
  buildStarfieldVrRecipe,
  filterStarfieldVrReferences,
  validateStarfieldVrReferenceCatalogue,
} from './starfieldVrReferenceCatalogue.mjs';

test('Starfield VR reference catalogue is complete and internally valid', () => {
  const verdict = validateStarfieldVrReferenceCatalogue();
  assert.equal(verdict.ok, true, verdict.issues.join('; '));
  assert.ok(STARFIELD_VR_REFERENCES.length >= 10);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(Object.isFrozen(verdict.issues), true);
});

test('recommended recipe resolves only registered references and returns measurable tests', () => {
  const recipe = buildStarfieldVrRecipe();
  assert.equal(recipe.status, 'READY');
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
  assert.equal(Object.isFrozen(filterStarfieldVrReferences('all')), true);
});

test('catalogue never promotes a reference into implementation proof', () => {
  assert.match(STARFIELD_VR_EVIDENCE_BOUNDARY.summary, /do not prove implementation/i);
  for (const reference of STARFIELD_VR_REFERENCES) {
    assert.notEqual(reference.evidenceClass, 'runtime-proof');
    assert.match(reference.reusePosture, /(proprietary|licen|MIT|reuse)/i);
  }
});

test('canonical reference evidence is recursively immutable', () => {
  assert.equal(Object.isFrozen(STARFIELD_VR_EVIDENCE_BOUNDARY), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_EVIDENCE_BOUNDARY.requiredPromotionEvidence), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCE_DOMAINS), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCE_DOMAINS[0]), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCES), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCES[0]), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCES[0].acceptanceTests), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCES[0].sources), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_REFERENCES[0].sources[0]), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_RECOMMENDED_RECIPE.referenceIds), true);
  assert.throws(() => {
    STARFIELD_VR_REFERENCES[0].sources[0].url = 'https://example.invalid/';
  }, TypeError);
});

test('recipe output is detached and recursively immutable', () => {
  const requested = ['mutar-starfield2vr', 'starfield-creation-engine-2'];
  const recipe = buildStarfieldVrRecipe(requested);
  requested[0] = 'cyberpunk-visual-language';
  assert.deepEqual(recipe.referenceIds, ['mutar-starfield2vr', 'starfield-creation-engine-2']);
  assert.equal(Object.isFrozen(recipe), true);
  assert.equal(Object.isFrozen(recipe.referenceIds), true);
  assert.equal(Object.isFrozen(recipe.acceptanceTests), true);
  assert.throws(() => recipe.referenceIds.push('cyberpunk-visual-language'), TypeError);
});

test('malformed recipe inputs fail closed without throwing', () => {
  for (const value of [null, {}, 'mutar-starfield2vr', new Set(['mutar-starfield2vr'])]) {
    assert.doesNotThrow(() => buildStarfieldVrRecipe(value));
    const recipe = buildStarfieldVrRecipe(value);
    assert.equal(recipe.status, 'INVALID_INPUT');
    assert.deepEqual(recipe.referenceIds, []);
  }

  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  assert.doesNotThrow(() => buildStarfieldVrRecipe(proxy));
  assert.equal(buildStarfieldVrRecipe(proxy).status, 'INVALID_INPUT');
});

test('accessor-bearing, sparse, exotic and oversized arrays fail closed', () => {
  let getterCalls = 0;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  assert.equal(buildStarfieldVrRecipe(accessorArray).status, 'INVALID_INPUT');
  assert.equal(getterCalls, 0);

  const sparse = new Array(2);
  sparse[1] = 'mutar-starfield2vr';
  assert.equal(buildStarfieldVrRecipe(sparse).status, 'INVALID_INPUT');

  const exotic = ['mutar-starfield2vr'];
  Object.setPrototypeOf(exotic, null);
  assert.equal(buildStarfieldVrRecipe(exotic).status, 'INVALID_INPUT');

  const oversized = Array.from({ length: 65 }, () => 'mutar-starfield2vr');
  assert.equal(buildStarfieldVrRecipe(oversized).status, 'INVALID_INPUT');
});

test('valid empty, unknown and duplicate recipe inputs remain deterministic', () => {
  const empty = buildStarfieldVrRecipe([]);
  assert.equal(empty.status, 'EMPTY');
  assert.deepEqual(empty.referenceIds, []);

  const unknown = buildStarfieldVrRecipe(['unknown-reference']);
  assert.equal(unknown.status, 'EMPTY');
  assert.deepEqual(unknown.referenceIds, []);

  const duplicate = buildStarfieldVrRecipe(['mutar-starfield2vr', 'mutar-starfield2vr']);
  assert.equal(duplicate.status, 'READY');
  assert.deepEqual(duplicate.referenceIds, ['mutar-starfield2vr']);
});
