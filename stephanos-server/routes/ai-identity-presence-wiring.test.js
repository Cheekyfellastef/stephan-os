import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('./ai.js', import.meta.url);

test('canonical AI chat consumes the governed provider-neutral Stephanos identity kernel', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');
  assert.match(source, /buildStephanosIdentityPresenceKernel/);
  assert.match(source, /buildStephanosIdentityContextBlock/);
  assert.match(source, /const identityPresenceKernel = buildStephanosIdentityPresenceKernel\(\)/);
  assert.match(source, /const identityPresenceContext = buildStephanosIdentityContextBlock\(identityPresenceKernel\)/);
  assert.match(source, /identityPresenceContext,/);
  assert.match(source, /identity_presence_kernel: identityPresenceKernel/);
  assert.match(source, /identity_kernel_version: identityPresenceKernel\.identityVersion/);
  assert.match(source, /identity_presence_status: identityPresenceKernel\.finalVerdict/);
  assert.match(source, /identity_provider_neutral: identityPresenceKernel\.providerNeutral/);
});
