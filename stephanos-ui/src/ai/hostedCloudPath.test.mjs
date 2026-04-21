import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHostedCloudPathCapability } from './hostedCloudPath.js';

test('prefers hosted proxy secret path when configured', () => {
  const result = resolveHostedCloudPathCapability({
    providerKey: 'groq',
    hostedCloudConfig: { proxyUrl: 'https://proxy.example.com' },
    providerConfigs: { groq: { apiKey: 'gsk_live' } },
  });

  assert.equal(result.available, true);
  assert.equal(result.secretPathKind, 'hosted-proxy');
  assert.equal(result.providerExecutionPath, 'groq-hosted-cloud');
  assert.equal(result.authorityLevel, 'cloud-cognition-only');
});

test('falls back to hosted provider credentials when proxy is absent', () => {
  const result = resolveHostedCloudPathCapability({
    providerKey: 'gemini',
    hostedCloudConfig: {},
    providerConfigs: { gemini: { apiKey: 'gm_live' } },
  });

  assert.equal(result.available, true);
  assert.equal(result.secretPathKind, 'hosted-provider-credentials');
});

test('returns clean backend-only posture when no hosted secret path exists', () => {
  const result = resolveHostedCloudPathCapability({
    providerKey: 'groq',
    hostedCloudConfig: { backendOnlySecrets: true },
    providerConfigs: { groq: {} },
  });

  assert.equal(result.available, false);
  assert.equal(result.secretPathKind, 'backend-only');
  assert.equal(result.providerExecutionPath, 'none');
});
