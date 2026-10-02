import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const startBackendPs1 = readFileSync(new URL('../windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
const repairBattleBridgePs1 = readFileSync(new URL('../windows/repair-stephanos-battle-bridge.ps1', import.meta.url), 'utf8');
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


test('battle bridge repair delegates proven stale backends to the approved exact-head restart primitive', () => {
  assert.doesNotMatch(startBackendPs1, /Stop-Process|taskkill|wmic\s+process/i);
  assert.match(repairBattleBridgePs1, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(repairBattleBridgePs1, /-Target', 'backend'/);
  assert.match(repairBattleBridgePs1, /Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'approved stale backend restart'/);
  assert.match(repairBattleBridgePs1, /Proven stale canonical backend .* delegating to approved exact-head restart primitive/);
});

test('backend server refuses exact-head reuse of a stale Stephanos listener', () => {
  assert.match(backendServerSource, /observedSourceHead === backendExpectedHead/);
  assert.match(backendServerSource, /Refusing stale Stephanos backend reuse/);
  assert.match(backendServerSource, /existingServer\.exactHeadCompatible === false/);
});
