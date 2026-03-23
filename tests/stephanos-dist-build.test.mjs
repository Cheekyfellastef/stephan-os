import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getDistAssetReferences,
  resolveDistAssetPath,
  stephanosDistIndexPath,
} from '../scripts/stephanos-build-utils.mjs';
import { STEPHANOS_DIST_ROUTE_MARKERS } from '../shared/runtime/stephanosRouteMarkers.mjs';

test('built Stephanos dist contains the latest route-adoption markers in generated JS assets', () => {
  const indexHtml = readFileSync(stephanosDistIndexPath, 'utf8');
  const jsAssets = getDistAssetReferences(indexHtml).filter((assetPath) => assetPath.endsWith('.js'));
  const jsContents = jsAssets.map((assetPath) => readFileSync(resolveDistAssetPath(assetPath), 'utf8'));

  assert.ok(jsAssets.length > 0);
  for (const marker of STEPHANOS_DIST_ROUTE_MARKERS) {
    assert.equal(
      jsContents.some((content) => content.includes(marker)),
      true,
      `Expected built JS assets to include marker ${marker}`,
    );
  }
});
