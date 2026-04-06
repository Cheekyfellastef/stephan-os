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
  assert.match(clientSource, /resolveAdminAuthorityUrl\(runtimeConfig\)/);
  assert.match(clientSource, /baseUrl:\s*authority\.target/);
});

test('clearLocalProviderSecret uses DELETE /api/ai-admin/provider-secrets/:provider', () => {
  assert.match(clientSource, /requestJson\(`\/api\/ai-admin\/provider-secrets\/\$\{encodeURIComponent\(provider\)\}`,[\s\S]*method:\s*'DELETE'/m);
  assert.match(clientSource, /Local admin access required\./);
});

test('sendPrompt strips provider secrets from chat payloads', () => {
  assert.match(clientSource, /stripSecretsFromProviderConfigs\(providerConfigs\)/);
  assert.match(clientSource, /providerConfigs:\s*safeProviderConfigs/);
});

test('sendPrompt derives timeout from shared timeout policy before request dispatch', () => {
  assert.match(clientSource, /resolveUiRequestTimeoutPolicy\(/);
  assert.match(clientSource, /timeoutPolicy:\s*\{/);
  assert.match(clientSource, /requestJson\('\/api\/ai\/chat'[\s\S]*timeoutPolicy\)/m);
});

test('transport timeout diagnostics are labeled as ui_request_timeout_ms', () => {
  assert.match(clientSource, /timeoutLabel:\s*'ui_request_timeout_ms'/);
  assert.doesNotMatch(clientSource, /vite_api_timeout_ms/);
});



test('getLocalGitRitualState queries /api/local/git-ritual-state', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/git-ritual-state'/m);
});

test('openRepoPowerShell uses POST /api/local/open-repo-powershell', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/open-repo-powershell',[\s\S]*method:\s*'POST'/m);
  assert.match(clientSource, /pid:\s*Number\.isFinite\(Number\(result\.data\?\.pid\)\)/);
  assert.match(clientSource, /focusApplied:\s*result\.data\?\.focusApplied === true/);
});

test('focusRepoPowerShell uses POST /api/local/focus-repo-powershell', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/focus-repo-powershell',[\s\S]*method:\s*'POST'/m);
});

test('getLocalRepoShellConfig queries /api/local/repo-shell-config', () => {
  assert.match(clientSource, /requestJson\('\/api\/local\/repo-shell-config'/m);
});
