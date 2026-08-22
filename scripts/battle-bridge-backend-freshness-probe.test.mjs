import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BATTLE_BRIDGE_BACKEND_BASE_URL,
  runBattleBridgeBackendFreshnessProbe,
} from './battle-bridge-backend-freshness-probe.mjs';

const HEAD = 'a'.repeat(40);
const identity = { schemaVersion: 'stephanos.backend-runtime-identity.v1', runtimeId: 'stephanos-battle-bridge-backend', sourceHead: HEAD };

function response(status, body, { location = '' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: (name) => name === 'content-length' ? String(Buffer.byteLength(text)) : name === 'location' ? location : null },
    text: async () => text,
  };
}

function canonicalFetch(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'manual');
    const route = new URL(url).pathname;
    if (overrides[route]) return overrides[route];
    return response(200, route === '/api/health'
      ? { schemaVersion: 'stephanos.backend-health.v1', backendIdentity: identity }
      : { schemaVersion: 'stephanos.mission-operations-feed.v1', backendIdentity: identity });
  };
}

test('valid canonical listener response identity establishes backend freshness', async () => {
  const proof = await runBattleBridgeBackendFreshnessProbe({ expectedSourceHead: HEAD, fetchImpl: canonicalFetch() });
  assert.equal(BATTLE_BRIDGE_BACKEND_BASE_URL, 'http://127.0.0.1:8787');
  assert.equal(proof.backendCurrent, true);
  assert.equal(proof.finalVerdict, 'BACKEND_CURRENT');
});

test('foreign listener returning 2xx on both canonical paths is reachability only', async () => {
  const foreign = response(200, { ok: true });
  const proof = await runBattleBridgeBackendFreshnessProbe({ expectedSourceHead: HEAD, fetchImpl: canonicalFetch({ '/api/health': foreign, '/api/mission-operations': foreign }) });
  assert.equal(proof.backendCurrent, false);
  assert.ok(proof.routeProofs.every((route) => route.error === 'BACKEND_IDENTITY_SCHEMA_MISMATCH'));
});

test('redirect to a 2xx responder is rejected without being followed', async () => {
  const redirect = response(302, '', { location: 'http://127.0.0.1:8787/foreign-ok' });
  const proof = await runBattleBridgeBackendFreshnessProbe({ expectedSourceHead: HEAD, fetchImpl: canonicalFetch({ '/api/health': redirect }) });
  assert.equal(proof.backendCurrent, false);
  assert.equal(proof.routeProofs[0].error, 'BACKEND_IDENTITY_REDIRECT_REJECTED');
});

test('correct-shaped response with wrong immutable source identity fails closed', async () => {
  const wrong = { ...identity, sourceHead: 'b'.repeat(40) };
  const proof = await runBattleBridgeBackendFreshnessProbe({
    expectedSourceHead: HEAD,
    fetchImpl: canonicalFetch({ '/api/health': response(200, { schemaVersion: 'stephanos.backend-health.v1', backendIdentity: wrong }) }),
  });
  assert.equal(proof.backendCurrent, false);
  assert.equal(proof.routeProofs[0].error, 'BACKEND_SOURCE_IDENTITY_MISMATCH');
});

test('missing, malformed, and oversized identity content cannot establish health', async () => {
  for (const hostile of [response(200, '{'), response(200, 'x'.repeat(65537))]) {
    const proof = await runBattleBridgeBackendFreshnessProbe({ expectedSourceHead: HEAD, fetchImpl: canonicalFetch({ '/api/health': hostile }) });
    assert.equal(proof.backendCurrent, false);
  }
});

test('Windows backend recovery authority pins every executable, normalized listener identity, and reuse receipt', async () => {
  const installer = await readFile(new URL('./windows/install-stephanos-backend-autostart.ps1', import.meta.url), 'utf8');
  const starter = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
  assert.match(installer, /\$wscriptExe = 'C:\\Windows\\System32\\wscript\.exe'/);
  assert.doesNotMatch(installer, /env:SystemRoot/);
  assert.match(starter, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/);
  assert.match(starter, /\$canonicalNpm = 'C:\\Program Files\\nodejs\\npm\.cmd'/);
  assert.match(starter, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(starter, /process\.ExecutablePath/);
  assert.match(starter, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(starter, /function Test-CanonicalBackendCommandLine/);
  assert.match(starter, /-replace '\\s\+', ' '/);
  assert.match(starter, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(starter, /Get-ExactHeadBackendBootstrapBase64/);
  assert.match(starter, /--input-type=module', '--eval'/);
  assert.match(starter, /ProcessStartTimeUtc/);
  assert.match(starter, /Publish-VerifiedBackendRuntimeReceipt/);
  assert.match(starter, /\$existingListener[\s\S]*if \(\$existingListener\)[\s\S]*Publish-VerifiedBackendRuntimeReceipt[\s\S]*exit 0/);
  assert.match(starter, /confirmedListener\.ProcessId -ne \$Listener\.ProcessId/);
  assert.match(starter, /confirmedListener\.ProcessStartTimeUtc -ne \$Listener\.ProcessStartTimeUtc/);
  assert.match(starter, /& \$canonicalNpm run --silent openclaw:stub:ensure/);
  assert.match(starter, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(starter, /Get-Command (?:git|npm)/i);
  assert.doesNotMatch(starter, /(^|\r?\n)\s*npm(?:\.cmd)?\s+run/im);
  assert.doesNotMatch(starter, /CommandLine -match|Invoke-Expression|\.Contains\(['"]stephanos-server\/server\.js['"]\)/i);
});
