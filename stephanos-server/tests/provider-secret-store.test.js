import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProviderSecretStore } from '../services/providerSecretStore.js';

test('provider secret store persists backend-owned secrets and returns masked status only', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-secret-store-'));
  const secretFile = path.join(tempDir, 'provider-secrets.json');
  const store = new ProviderSecretStore(secretFile);

  const status = store.setSecret('groq', 'gsk_test_secret_12345678');
  assert.equal(status.provider, 'groq');
  assert.equal(status.configured, true);
  assert.match(status.masked, /••••••••5678$/);

  const overlay = store.buildProviderConfigOverlay();
  assert.equal(overlay.groq.apiKey, 'gsk_test_secret_12345678');
  assert.equal(overlay.gemini.apiKey, '');

  const raw = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
  assert.equal(raw.providers.groq.apiKey, 'gsk_test_secret_12345678');
  assert.equal(store.clearSecret('groq'), true);
  assert.equal(store.getSecret('groq'), '');
});
