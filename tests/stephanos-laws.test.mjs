import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  stephanosLaws,
  STEPHANOS_LAW_IDS,
  STEPHANOS_LAWS_VERSION,
  validateStephanosLawShape,
  getStephanosLawById,
} from '../shared/runtime/stephanosLaws.mjs';

const REQUIRED_LAWS = [
  STEPHANOS_LAW_IDS.UNIVERSAL_ENTRY,
  STEPHANOS_LAW_IDS.RUNTIME_TARGET_DISTINCT,
  STEPHANOS_LAW_IDS.ENTRY_SEPARATION,
  STEPHANOS_LAW_IDS.ENTRY_COMPATIBILITY_ONLY,
  STEPHANOS_LAW_IDS.BUILD_TRUTH_PARITY,
  STEPHANOS_LAW_IDS.PROCESS_REUSE_GATES,
  STEPHANOS_LAW_IDS.DIAGNOSTICS_BOUNDARY,
  STEPHANOS_LAW_IDS.ROOT_VS_TILE_ACTION,
  STEPHANOS_LAW_IDS.SHARED_STATE_LAYER,
  STEPHANOS_LAW_IDS.DEVICE_EMBODIMENT,
  STEPHANOS_LAW_IDS.REALITY_SYNC,
];

test('Stephanos laws source loads and has active version marker', () => {
  assert.ok(Array.isArray(stephanosLaws));
  assert.ok(stephanosLaws.length >= REQUIRED_LAWS.length);
  assert.match(STEPHANOS_LAWS_VERSION, /^\d{4}-\d{2}-\d{2}\./);
});

test('required Stephanos law IDs exist', () => {
  REQUIRED_LAWS.forEach((lawId) => {
    const law = getStephanosLawById(lawId);
    assert.ok(law, `Expected required law ${lawId} to exist.`);
  });
});

test('each law has required runtime-render fields', () => {
  stephanosLaws.forEach((law) => {
    const validation = validateStephanosLawShape(law);
    assert.equal(validation.valid, true, `Law ${law?.id || 'unknown'} missing: ${validation.missingFields.join(', ')}`);
  });
});

test('law related file mappings remain valid enough to catch drift', () => {
  stephanosLaws.forEach((law) => {
    law.relatedFiles.forEach((filePath) => {
      assert.equal(existsSync(filePath), true, `Law ${law.id} references missing path: ${filePath}`);
    });
  });
});
