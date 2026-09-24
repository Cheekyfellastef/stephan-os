import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('./ai.js', import.meta.url);

test('canonical AI chat consumes the provider-neutral Stephanos identity and presence kernel', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');
  assert.match(source, /buildStephanosIdentityPresenceKernelV1/);
  assert.match(source, /formatStephanosIdentityPresenceKernelForPrompt/);
  assert.match(source, /const identityPresenceKernel = buildStephanosIdentityPresenceKernelV1\(\)/);
  assert.match(source, /const identityPresenceContext = formatStephanosIdentityPresenceKernelForPrompt\(identityPresenceKernel\)/);
  assert.match(source, /identityPresenceContext,/);
  assert.match(source, /identity_presence_kernel: identityPresenceKernel/);
  assert.match(source, /identity_kernel_version: identityPresenceKernel\.identityVersion/);
  assert.match(source, /identity_provider_neutral: identityPresenceKernel\.providerNeutral/);
});
