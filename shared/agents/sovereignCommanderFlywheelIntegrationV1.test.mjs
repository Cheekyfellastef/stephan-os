import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('durable Flywheel reconciles canonical Sovereign gap proof before generic lesson promotion', async () => {
  const source = await readFile(
    new URL('./durableFlywheelControllerVNext.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /reconcileSovereignCommanderCapabilityGapLearningV1/);
  const reconciliationCall = source.indexOf('deps.reconcileSovereignCapabilityGapLearning');
  const genericPromotionCall = source.indexOf('deps.promoteIncidentLessons');

  assert.ok(reconciliationCall >= 0, 'Sovereign capability-gap reconciliation must be wired into production Flywheel');
  assert.ok(genericPromotionCall >= 0, 'generic Flywheel lesson promotion must remain wired');
  assert.ok(
    reconciliationCall < genericPromotionCall,
    'canonical proof reconciliation must run before generic lesson promotion',
  );
});
