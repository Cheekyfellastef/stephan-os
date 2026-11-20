import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalElasticSourceRevision } from './criticalBacklogConveyorService.js';

const HEAD = 'a'.repeat(40);

test('canonical elastic source truth remains fail closed', () => {
  assert.equal(canonicalElasticSourceRevision({ machineryInventory: { sourceHead: HEAD } }), HEAD);
  assert.equal(canonicalElasticSourceRevision({ machineryInventory: { sourceHead: '' } }), '');
  assert.equal(canonicalElasticSourceRevision({ machineryInventory: { sourceHead: 'not-a-sha' } }), '');
  assert.equal(canonicalElasticSourceRevision({}), '');
});
