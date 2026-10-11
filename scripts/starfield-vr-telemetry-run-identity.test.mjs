import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveStarfieldVrTelemetryRunIdentity } from './report-starfield-vr-telemetry.mjs';

const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const launcher = await readFile(new URL('./windows/launch-starfield-vr.ps1', import.meta.url), 'utf8');
const diagnosis = await readFile(new URL('./windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url), 'utf8');

const mutar = {
  provider: 'mutar-openxr',
  profilePath: 'C:\\vr\\mutar.json',
  profileSha256: 'abc',
  launchSessionId: 'launch-mutar',
  sourceHead: '1234',
  telemetrySessionId: 'starfield-vr-performance-20261002-000000-000',
};

test('a MutaR telemetry session stays MutaR even when current launch state is VorpX', () => {
  const result = resolveStarfieldVrTelemetryRunIdentity({
    sessionId: mutar.telemetrySessionId,
    session: { routeIdentity: mutar },
    summary: { routeIdentity: mutar },
    launch: {
      routeIdentity: {
        provider: 'vorpx',
        launchSessionId: 'later-vorpx-launch',
        telemetrySessionId: '',
      },
    },
  });
  assert.equal(result.status, 'VERIFIED_PROVIDER');
  assert.equal(result.provider, 'mutar-openxr');
  assert.equal(result.launchReceiptMatched, false);
});

test('conflicting telemetry-bound providers fail closed', () => {
  const result = resolveStarfieldVrTelemetryRunIdentity({
    sessionId: mutar.telemetrySessionId,
    session: { routeIdentity: mutar },
    summary: { routeIdentity: { ...mutar, provider: 'vorpx' } },
  });
  assert.equal(result.status, 'PROVIDER_IDENTITY_CONFLICT');
  assert.equal(result.provider, 'UNKNOWN');
  assert.equal(result.providerSpecificRecommendationsAllowed, false);
});

test('matching launch session with conflicting provider fails closed', () => {
  const result = resolveStarfieldVrTelemetryRunIdentity({
    sessionId: mutar.telemetrySessionId,
    session: { routeIdentity: mutar },
    summary: { routeIdentity: mutar },
    launch: {
      routeIdentity: {
        ...mutar,
        provider: 'vorpx',
      },
    },
  });
  assert.equal(result.status, 'PROVIDER_IDENTITY_CONFLICT');
});

test('legacy telemetry without bound provider is explicitly unknown', () => {
  const result = resolveStarfieldVrTelemetryRunIdentity({
    sessionId: 'starfield-vr-performance-legacy',
    session: {},
    summary: {},
  });
  assert.equal(result.status, 'UNKNOWN_PROVIDER');
  assert.equal(result.provider, 'UNKNOWN');
});

test('launcher stamps route identity and performance mode persists it through samples and summary', () => {
  assert.match(launcher, /launchSessionId/);
  assert.match(launcher, /profileSha256/);
  assert.match(launcher, /sourceHead/);
  assert.match(launcher, /-Provider \$selectedProvider/);
  assert.match(performance, /telemetrySessionId/);
  assert.match(performance, /routeProvider/);
  assert.match(performance, /routeLaunchSessionId/);
  assert.match(performance, /routeProfileSha256/);
  assert.match(performance, /routeSourceHead/);
  assert.match(performance, /routeIdentity = \$session\.routeIdentity/);
});

test('diagnosis no longer treats current provider slot as telemetry provider truth', () => {
  assert.match(diagnosis, /providerIdentityStatus/);
  assert.match(diagnosis, /providerSlotProvider/);
  assert.match(diagnosis, /provider = \$telemetryProvider/);
  assert.match(diagnosis, /provider-identity-conflict/);
  assert.match(diagnosis, /provider-identity-missing/);
});
