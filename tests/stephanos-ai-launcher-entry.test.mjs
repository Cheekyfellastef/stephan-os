import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(repoRoot, 'apps', 'stephanos-ai');

test('Stephanos AI is registered as a launcher workspace tile', () => {
  const apps = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'index.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  assert.ok(apps.includes('stephanos-ai'));
  assert.equal(manifest.name, 'Stephanos AI');
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.launcherActionLabel, 'Enter Stephanos AI');
});

test('Stephanos AI workspace uses canonical chat client and exposes agent tabs', () => {
  const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(appRoot, 'workspace.js'), 'utf8');
  assert.match(html, /Stephanos AI workspace/);
  assert.match(js, /queryStephanosAI/);
  assert.match(js, /Sovereign Commander/);
  assert.match(js, /Flywheel/);
  assert.match(js, /OpenClaw Local/);
  assert.match(js, /OpenClaw Standalone/);
  assert.match(js, /VR Agent/);
  assert.match(js, /participantTarget/);
  assert.doesNotMatch(js, /fetch\s*\(\s*['"]\/api\/ai\/chat/);
});
