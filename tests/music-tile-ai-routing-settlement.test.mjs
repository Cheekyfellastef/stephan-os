import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeMusicAiResponse,
  testMusicAiRoute,
} from '../apps/music-tile/engine/musicAiBridge.js';
import { sanitizeStephanosProviderConfigsForTransport } from '../shared/ai/stephanosClient.mjs';

test('nested canonical router errors survive route_unavailable normalization', () => {
  const normalized = normalizeMusicAiResponse({
    raw: { router: { status: 'route_unavailable', error: 'No approved provider route is ready.' } },
  });
  assert.equal(normalized.routeStatus, 'route_unavailable');
  assert.equal(normalized.routeError, 'No approved provider route is ready.');
});

test('route probe reports a reached backend separately from route availability', async () => {
  const result = await testMusicAiRoute({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        raw: { router: { status: 'route_unavailable', error: 'Fallback disabled and requested provider is unavailable.' } },
      }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.diagnostics.requestReachedBackend, true);
  assert.equal(result.diagnostics.routeStatus, 'route_unavailable');
  assert.equal(result.failureReason, 'Fallback disabled and requested provider is unavailable.');
});

test('provider config transport strips credentials and unknown draft fields', () => {
  assert.deepEqual(sanitizeStephanosProviderConfigsForTransport({
    groq: { apiKey: 'secret', baseURL: 'https://api.groq.com', model: 'test', surprise: 'drop-me' },
  }), {
    groq: { baseURL: 'https://api.groq.com', model: 'test' },
  });
});

test('Music Tile route action treats reached non-route-unavailable responses as transport-ready', () => {
  const source = fs.readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
  assert.match(source, /const routeReachable = result\.diagnostics\?\.requestReachedBackend === true && !routeUnavailable/);
  assert.match(source, /music\.ai_transport_ready/);
  assert.match(source, /escapeHtml\(lineText\)/);
});

test('standalone routing preferences merge persisted truth before runtime overrides', () => {
  const source = fs.readFileSync(new URL('../apps/music-tile/engine/musicAiBridge.js', import.meta.url), 'utf8');
  assert.match(source, /const preferences = \{\s*\.\.\.persistedPreferences/);
  assert.match(source, /sanitizeStephanosProviderConfigsForTransport/);
});
