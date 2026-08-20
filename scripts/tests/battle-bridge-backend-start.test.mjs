import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const startBackendPs1 = readFileSync(new URL('../windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');

test('battle bridge backend script points to backend server entry', () => {
  assert.equal(packageJson.scripts['stephanos:backend'], 'node stephanos-server/backend-bootstrap.mjs');
});

test('windows backend starter invokes the fixed npm script that enters the immutable bootstrap', () => {
  assert.match(startBackendPs1, /Start-Process -FilePath \$canonicalNpm/);
  assert.match(startBackendPs1, /@\('run', 'stephanos:backend'\)/);
  assert.doesNotMatch(startBackendPs1, /stephanos:serve/);
});
