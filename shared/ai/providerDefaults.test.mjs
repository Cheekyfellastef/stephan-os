import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_DEFINITIONS,
  createDefaultHostedCloudCognitionSettings,
  createDefaultRouterSettings,
} from './providerDefaults.mjs';

test('createDefaultHostedCloudCognitionSettings keeps hosted cloud defaults aligned to provider definitions', () => {
  const hostedDefaults = createDefaultHostedCloudCognitionSettings();

  assert.equal(hostedDefaults.providers.groq.model, PROVIDER_DEFINITIONS.groq.defaults.model);
  assert.equal(hostedDefaults.providers.gemini.model, PROVIDER_DEFINITIONS.gemini.defaults.model);
  assert.equal(hostedDefaults.selectedProvider, 'groq');
  assert.equal(hostedDefaults.enabled, false);
});

test('createDefaultRouterSettings includes hosted cloud cognition defaults without mutating route semantics', () => {
  const routerDefaults = createDefaultRouterSettings();

  assert.equal(routerDefaults.provider, 'ollama');
  assert.equal(routerDefaults.routeMode, 'auto');
  assert.deepEqual(routerDefaults.hostedCloudCognition, createDefaultHostedCloudCognitionSettings());
});

test('providerDefaults module can be imported and initialized without startup TDZ crashes', async () => {
  const moduleUrl = new URL(`./providerDefaults.mjs?startup-init=${Date.now()}`, import.meta.url);
  const mod = await import(moduleUrl.href);

  assert.doesNotThrow(() => mod.createDefaultHostedCloudCognitionSettings());
  assert.doesNotThrow(() => mod.createDefaultRouterSettings());
});
