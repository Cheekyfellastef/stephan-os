import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const launcherHtml = readFileSync('index.html', 'utf8');
const launcherMain = readFileSync('main.js', 'utf8');

test('root launcher renders visible build proof surface', () => {
  assert.match(launcherHtml, /id="launcher-build-proof"/);
  assert.match(launcherMain, /function renderLauncherBuildProof/);
  assert.match(launcherMain, /hydrateLauncherBuildProof/);
  assert.doesNotMatch(launcherMain, /launcherDiagnostics\.enabled[\s\S]{0,80}launcher-build-proof/);
});

test('tile-first launcher path remains isolated from diagnostics surfaces', () => {
  assert.match(launcherMain, /renderLauncherProjectRegistry\(projects, context, \{ enableSecondaryStatusSurfaces: false \}\)/);
  assert.match(launcherMain, /renderTileFirstLauncher\(projects, fallbackTileContext\)/);
  assert.match(launcherMain, /renderTileFirstLauncher\(projects, context\)/);
  assert.match(launcherHtml, /id="launcher-diagnostics-mount"/);
  assert.match(launcherHtml, /Guardrail: product launcher tiles render first; diagnostics can only appear inside this isolated mount/);
});
