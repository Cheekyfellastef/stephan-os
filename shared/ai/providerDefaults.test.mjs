import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('providerDefaults keeps provider definitions initialized before hosted cloud defaults helper', async () => {
  const sourcePath = new URL('./providerDefaults.mjs', import.meta.url);
  const source = await readFile(sourcePath, 'utf8');
  const definitionsIndex = source.indexOf('export const PROVIDER_DEFINITIONS =');
  const helperIndex = source.indexOf('export function createDefaultHostedCloudCognitionSettings()');

  assert.ok(definitionsIndex >= 0, 'provider definitions constant must exist');
  assert.ok(helperIndex >= 0, 'hosted cloud defaults helper must exist');
  assert.ok(
    definitionsIndex < helperIndex,
    'PROVIDER_DEFINITIONS must be initialized before createDefaultHostedCloudCognitionSettings is declared',
  );
});
