import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const srcRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const filesToGuard = [
  path.join(srcRoot, 'App.jsx'),
  path.join(srcRoot, 'components', 'AIConsole.jsx'),
  path.join(srcRoot, 'components', 'StatusPanel.jsx'),
];

const bannedReads = [
  'runtimeStatus.routeKind',
  'runtimeStatus.activeProvider',
  'runtimeStatus.selectedProvider',
  'runtimeStatus.preferredTarget',
  'runtimeStatus.actualTargetUsed',
];

const finalRouteTruthViewPath = path.join(srcRoot, 'state', 'finalRouteTruthView.js');
const bannedCanonicalBypassReads = [
  'runtimeStatus.runtimeTruth',
  'runtimeStatus.finalRouteTruth',
  'runtimeStatus.finalRoute',
];

test('UI route/provider labels are sourced through finalRouteTruth view helper', async () => {
  for (const filePath of filesToGuard) {
    const source = await fs.readFile(filePath, 'utf8');
    for (const banned of bannedReads) {
      assert.equal(
        source.includes(banned),
        false,
        `${path.basename(filePath)} should not read ${banned} directly`,
      );
    }
  }
});

test('finalRouteTruthView uses canonicalRouteRuntimeTruth and does not re-adjudicate via compatibility objects', async () => {
  const source = await fs.readFile(finalRouteTruthViewPath, 'utf8');
  for (const banned of bannedCanonicalBypassReads) {
    assert.equal(
      source.includes(banned),
      false,
      `finalRouteTruthView should not read ${banned} directly`,
    );
  }
  assert.equal(
    source.includes('runtimeStatus.canonicalRouteRuntimeTruth'),
    true,
    'finalRouteTruthView must read canonicalRouteRuntimeTruth',
  );
});
