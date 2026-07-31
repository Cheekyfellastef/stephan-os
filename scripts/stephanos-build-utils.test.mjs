import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  computeStephanosSourceFingerprint,
  getGitCommit,
  getStephanosFingerprintSourceFiles,
  repoRoot,
} from './stephanos-build-utils.mjs';

test('Stephanos dist fingerprint includes every bundled and proof-scenario source tree', () => {
  const files = getStephanosFingerprintSourceFiles()
    .map((absolutePath) => path.relative(repoRoot, absolutePath).replace(/\\/g, '/'));

  assert.ok(files.includes('shared/runtime/runtimeStatusModel.mjs'));
  assert.ok(files.includes('shared/runtime/runtimeGuardrails.mjs'));
  assert.ok(files.includes('shared/runtime/stephanosHomeNode.mjs'));
  assert.ok(files.includes('shared/ai/providerDefaults.mjs'));
  assert.ok(files.includes('shared/agents/agentRegistry.mjs'));
  assert.ok(files.includes('shared/project/projectProgressModel.mjs'));
  assert.ok(files.includes('apps/music-tile/engine/musicMissionContext.js'));
  assert.ok(files.includes('apps/music-tile/main.js'));
  assert.ok(files.includes('apps/music-tile/style.css'));
  assert.ok(files.includes('stephanos-ui/src/App.jsx'));
  assert.ok(files.includes('package.json'));
  assert.equal(files.some((relativePath) => relativePath.startsWith('apps/stephanos/dist/')), false);
});

test('source fingerprint changes when shared-agent or music proof inputs change', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'stephanos-fingerprint-'));
  const files = {
    'stephanos-ui/index.html': '<main>fixture</main>',
    'stephanos-ui/package.json': '{}',
    'stephanos-ui/package-lock.json': '{}',
    'stephanos-ui/vite.config.js': 'export default {};',
    'package.json': '{}',
    'stephanos-ui/src/App.jsx': 'export default function App() {}',
    'shared/agents/agentRegistry.mjs': 'export const agents = [];',
    'apps/music-tile/engine/musicMissionContext.js': 'export const context = {};',
    'apps/music-tile/main.js': 'export const main = true;',
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  const initial = computeStephanosSourceFingerprint({ rootDir: fixtureRoot });
  writeFileSync(
    path.join(fixtureRoot, 'shared/agents/agentRegistry.mjs'),
    'export const agents = ["changed"];',
  );
  const sharedChanged = computeStephanosSourceFingerprint({ rootDir: fixtureRoot });
  assert.notEqual(sharedChanged, initial);

  writeFileSync(
    path.join(fixtureRoot, 'apps/music-tile/main.js'),
    'export const main = "changed";',
  );
  const musicChanged = computeStephanosSourceFingerprint({ rootDir: fixtureRoot });
  assert.notEqual(musicChanged, sharedChanged);

  const generatedPath = path.join(fixtureRoot, 'apps/stephanos/dist/index.html');
  mkdirSync(path.dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, '<main>generated output changed</main>');
  assert.equal(
    computeStephanosSourceFingerprint({ rootDir: fixtureRoot }),
    musicChanged,
  );
});

test('Stephanos build metadata uses the full Git commit needed for exact-head runtime proof', () => {
  assert.match(getGitCommit(), /^[0-9a-f]{40}$/);
});
