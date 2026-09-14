import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reviewerSource = readFileSync(new URL('./windowsAuthorityMissionWorkerCleanupReviewV1.mjs', import.meta.url), 'utf8');

test('#2191 self-cleanup profile has an explicit ahead-only lineage path while historical lineage stays strict', () => {
  assert.match(
    reviewerSource,
    /function\s+exactSelfCleanupObservationBudgetLineage\s*\(/,
    '#2191 must use a dedicated ahead-only lineage predicate rather than weakening the historical predicate',
  );
  assert.match(
    reviewerSource,
    /function\s+exactLineage\s*\([\s\S]*?parents\.includes\(baseSha\)/,
    'historical Mission Worker profiles must retain the immediate-parent requirement',
  );
  assert.match(
    reviewerSource,
    /profile\s*===\s*['"]self-cleanup-observation-budget['"][\s\S]{0,320}exactSelfCleanupObservationBudgetLineage/,
    'only the #2191 self-cleanup profile may route through the dedicated ahead-only predicate',
  );
});
