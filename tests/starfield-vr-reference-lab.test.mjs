import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(repoRoot, 'apps', 'starfield-vr-reference-lab');

test('Starfield VR Reference Lab is registered as a launcher workspace tile', () => {
  const appsIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'index.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  assert.ok(appsIndex.includes('starfield-vr-reference-lab'));
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.launcherActionLabel, 'Enter Reference Lab');
  assert.match(manifest.description, /Starfield VR Evolution blueprint/i);
});

test('workspace consumes the canonical shared catalogue and exposes truth and proof surfaces', () => {
  const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(appRoot, 'reference-lab.js'), 'utf8');
  assert.match(source, /shared\/vr\/starfieldVrReferenceCatalogue\.mjs/);
  assert.match(html, /id="truth-summary"/);
  assert.match(html, /id="recipe-tests"/);
  assert.match(html, /id="reference-grid"/);
  assert.match(html, /href="\.\.\/vr-research-lab\/index\.html"/);
  assert.ok(fs.existsSync(path.join(repoRoot, 'VR-Research-Lab', 'knowledge-sources', 'starfield-vr-reference-lab', 'README.md')));
});

test('workspace is responsive, reduced-motion safe and has no remote runtime asset dependency', () => {
  const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(appRoot, 'styles.css'), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('workspace source avoids treating local workbench selection as durable authority', () => {
  const source = fs.readFileSync(path.join(appRoot, 'reference-lab.js'), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.match(source, /Evidence boundary:/);
  assert.match(source, /Clipboard unavailable/);
});
