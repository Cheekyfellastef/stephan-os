import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_IDENTITY_PRESENCE_SCHEMA_VERSION,
  STEPHANOS_IDENTITY_VERSION,
  buildStephanosIdentityContextBlock,
  buildStephanosIdentityPresenceKernel,
  projectStephanosIdentityEmbodiment,
  validateStephanosIdentityPresenceKernel,
} from './stephanosIdentityPresenceKernelV1.mjs';

test('builds one valid provider-neutral identity kernel', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  assert.equal(kernel.schemaVersion, STEPHANOS_IDENTITY_PRESENCE_SCHEMA_VERSION);
  assert.equal(kernel.identityVersion, STEPHANOS_IDENTITY_VERSION);
  assert.equal(kernel.providerNeutral, true);
  assert.equal(kernel.modelOwnsIdentity, false);
  assert.equal(kernel.deviceOwnsIdentity, false);
  assert.equal(kernel.silentIdentityRewriteAllowed, false);
  assert.equal(validateStephanosIdentityPresenceKernel(kernel).valid, true);
  assert.equal(
    kernel.finalVerdict,
    'STEPHANOS_IDENTITY_RELATIONSHIP_AND_PRESENCE_KERNEL_READY',
  );
});

test('kernel references active canonical Stephanos Laws', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  assert.ok(kernel.constitutionalValuesAndLawRefs.length >= 4);
  assert.ok(kernel.constitutionalValuesAndLawRefs.every((law) => law.id.startsWith('law-')));
  assert.ok(kernel.constitutionalValuesAndLawRefs.every((law) => law.title.length > 0));
});

test('provider, model and device changes preserve the same identity', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  const local = projectStephanosIdentityEmbodiment({
    kernel,
    provider: 'ollama',
    model: 'qwen:14b',
    surface: 'ai-console',
    deviceClass: 'desktop',
  });
  const hosted = projectStephanosIdentityEmbodiment({
    kernel,
    provider: 'groq',
    model: 'hosted-model',
    surface: 'shared-workspace',
    deviceClass: 'phone',
  });

  assert.equal(local.ok, true);
  assert.equal(hosted.ok, true);
  assert.equal(local.identityVersion, hosted.identityVersion);
  assert.equal(local.identitySource, hosted.identitySource);
  assert.equal(local.relationshipRole, hosted.relationshipRole);
  assert.equal(local.providerMayRedefineIdentity, false);
  assert.equal(hosted.modelMayRedefineIdentity, false);
  assert.equal(hosted.surfaceMayRedefineIdentity, false);
});

test('validation rejects model-owned or silently rewritten identity', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  const invalid = {
    ...kernel,
    modelOwnsIdentity: true,
    silentIdentityRewriteAllowed: true,
  };
  const result = validateStephanosIdentityPresenceKernel(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('model-must-not-own-identity'));
  assert.ok(result.errors.includes('silent-rewrite-must-be-disabled'));
});

test('context projection is compact and keeps epistemic and authority boundaries', () => {
  const block = buildStephanosIdentityContextBlock(buildStephanosIdentityPresenceKernel());
  assert.match(block, /Canonical Stephanos Identity/);
  assert.match(block, /uncertaintyPolicy:/);
  assert.match(block, /disagreementPolicy:/);
  assert.match(block, /provider\/model\/surface is an embodiment/i);
  assert.match(block, /Never silently rewrite this kernel/);
});

test('growth edges can evolve without redefining enduring identity', () => {
  const baseline = buildStephanosIdentityPresenceKernel();
  const evolved = buildStephanosIdentityPresenceKernel({
    currentGrowthEdges: ['Improve open-thread resumption proof.'],
  });
  assert.equal(evolved.identityVersion, baseline.identityVersion);
  assert.deepEqual(evolved.enduringCharacter, baseline.enduringCharacter);
  assert.deepEqual(evolved.conversationalPrinciples, baseline.conversationalPrinciples);
  assert.deepEqual(evolved.currentGrowthEdges, ['Improve open-thread resumption proof.']);
});
