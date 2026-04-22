import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getDefaultRuntimeStatusModel, getPendingRuntimeStatusModel } from './runtimeStatusDefaults.js';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const AISTORE_SOURCE_PATH = path.join(THIS_DIR, 'aiStore.js');

test('runtimeStatusDefaults lazily initializes stable default snapshots', () => {
  const firstDefault = getDefaultRuntimeStatusModel();
  const secondDefault = getDefaultRuntimeStatusModel();
  const firstPending = getPendingRuntimeStatusModel();
  const secondPending = getPendingRuntimeStatusModel();

  assert.equal(firstDefault, secondDefault);
  assert.equal(firstPending, secondPending);
  assert.equal(Object.isFrozen(firstDefault), true);
  assert.equal(Object.isFrozen(firstPending), true);
});

test('aiStore startup diagnostics include all required startup isolation stages', () => {
  const source = fs.readFileSync(AISTORE_SOURCE_PATH, 'utf8');
  const requiredStageLabels = [
    'createInitialMemorySnapshot',
    'normalizeStoredSettings',
    'createDefaultRouterSettings',
    'hostedCloudCognition normalization',
    'runtimeStatusModel initialization',
    'AIStoreProvider first render complete',
  ];

  requiredStageLabels.forEach((stageLabel) => {
    assert.equal(source.includes(stageLabel), true, `missing startup stage diagnostic: ${stageLabel}`);
  });
  assert.equal(source.includes(':start'), true);
  assert.equal(source.includes(':complete'), true);
});
