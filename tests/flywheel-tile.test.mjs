import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'apps', 'flywheel', 'app.json'), 'utf8'));
const html = readFileSync(path.join(root, 'apps', 'flywheel', 'index.html'), 'utf8');
const appIndex = JSON.parse(readFileSync(path.join(root, 'apps', 'index.json'), 'utf8'));

test('Flywheel is a canonical landing-page app', () => {
  assert.equal(manifest.name, 'Flywheel');
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.role, 'FLYWHEEL_LANDING_TILE');
  assert.ok(appIndex.includes('flywheel'));
  assert.match(html, /data-role="FLYWHEEL_LANDING_TILE"/);
});

test('Flywheel tile communicates through the read-only Shared Workspace feed', () => {
  assert.match(html, /\/api\/shared-workspace\/dashboard-feed/);
  assert.match(html, /flywheel-repair-patrol-current/);
  assert.match(html, /capability-gap-scout-current/);
  assert.match(html, /method:'GET'/);
  assert.doesNotMatch(html, /method:'POST'/);
  assert.doesNotMatch(html, /method:'PUT'/);
  assert.doesNotMatch(html, /method:'DELETE'/);
});
