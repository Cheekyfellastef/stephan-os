import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const startBackendPs1 = readFileSync(new URL('../windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');

test('battle bridge backend script points to backend server entry', () => {
  assert.equal(packageJson.scripts['stephanos:backend'], 'node stephanos-server/server.js');
});

test('windows backend starter does not invoke frontend dist serve script', () => {
  assert.match(startBackendPs1, /stephanos:backend/);
  assert.doesNotMatch(startBackendPs1, /stephanos:serve/);
});
