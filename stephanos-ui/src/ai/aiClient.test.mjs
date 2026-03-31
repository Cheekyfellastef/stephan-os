import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientSource = fs.readFileSync(path.join(__dirname, 'aiClient.js'), 'utf8');

test('setLocalProviderSecret uses PUT /api/ai-admin/provider-secrets/:provider', () => {
  assert.match(clientSource, /requestJson\(`\/api\/ai-admin\/provider-secrets\/\$\{encodeURIComponent\(provider\)\}`,[\s\S]*method:\s*'PUT'/m);
});

test('clearLocalProviderSecret uses DELETE /api/ai-admin/provider-secrets/:provider', () => {
  assert.match(clientSource, /requestJson\(`\/api\/ai-admin\/provider-secrets\/\$\{encodeURIComponent\(provider\)\}`,[\s\S]*method:\s*'DELETE'/m);
});

test('sendPrompt strips provider secrets from chat payloads', () => {
  assert.match(clientSource, /stripSecretsFromProviderConfigs\(providerConfigs\)/);
  assert.match(clientSource, /providerConfigs:\s*safeProviderConfigs/);
});
