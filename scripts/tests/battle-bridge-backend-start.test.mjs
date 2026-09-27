import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const startBackendPs1 = readFileSync(new URL('../windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
const backendServerSource = readFileSync(new URL('../../stephanos-server/server.js', import.meta.url), 'utf8');

test('battle bridge backend script points to backend server entry', () => {
  assert.equal(packageJson.scripts['stephanos:backend'], 'node stephanos-server/backend-bootstrap.mjs');
});

test('windows backend starter binds the exact-head bootstrap to fixed Node process creation', () => {
  assert.match(startBackendPs1, /Get-ExactHeadBackendBootstrapBase64/);
  assert.match(startBackendPs1, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(startBackendPs1, /--input-type=module', '--eval'/);
  assert.match(startBackendPs1, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(startBackendPs1, /Start-Process -FilePath \$canonicalNpm/);
  assert.doesNotMatch(startBackendPs1, /stephanos:serve/);
});


test('windows backend starter replaces only a verified stale Stephanos listener', () => {
  assert.match(startBackendPs1, /Get-BackendHealthSnapshot/);
  assert.match(startBackendPs1, /BACKEND_STALE_HEAD_LISTENER_UNVERIFIED/);
  assert.match(startBackendPs1, /Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'stale backend replacement'/);
  assert.match(startBackendPs1, /Stop-Process -Id \$staleListener\.ProcessId -Force/);
  assert.match(startBackendPs1, /Stale verified Stephanos backend stopped; continuing exact-head replacement/);
});

test('backend server refuses exact-head reuse of a stale Stephanos listener', () => {
  assert.match(backendServerSource, /observedSourceHead === backendExpectedHead/);
  assert.match(backendServerSource, /Refusing stale Stephanos backend reuse/);
  assert.match(backendServerSource, /existingServer\.exactHeadCompatible === false/);
});
