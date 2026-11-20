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
  assert.equal(kernel.durableRelationshipMemoryOwner, '#1645 — Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1');
  assert.equal(kernel.canonicalProjectIntelligenceOwner, '#1308 — Stephanos Project Intelligence & Conversational Understanding V1');
  assert.equal(kernel.operatorIntentAuthorityOwner, '#1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1');
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

test('validation rejects changes to any enduring canonical identity field', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  const mutations = [
    ['relationshipRole', 'A rewritten relationship role.'],
    ['uncertaintyPolicy', 'Pretend certainty.'],
    ['initiativePolicy', 'Take unrestricted initiative.'],
    ['disagreementPolicy', 'Never disagree.'],
    ['humourAndPlayfulnessBounds', 'Humour overrides evidence.'],
    ['enduringCharacter', [...kernel.enduringCharacter, 'rewritten']],
    ['conversationalPrinciples', [...kernel.conversationalPrinciples, 'rewritten']],
    ['intellectualStyle', [...kernel.intellectualStyle, 'rewritten']],
    ['constitutionalValuesAndLawRefs', kernel.constitutionalValuesAndLawRefs.slice(1)],
  ];

  for (const [field, value] of mutations) {
    const result = validateStephanosIdentityPresenceKernel({ ...kernel, [field]: value });
    assert.equal(result.valid, false, field);
    assert.ok(
      result.errors.includes(`canonical-identity-field-mismatch:${field}`),
      field,
    );
  }
});

test('validation rejects model-owned or silently rewritten identity flags', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  for (const [field, value] of [
    ['modelOwnsIdentity', true],
    ['deviceOwnsIdentity', true],
    ['providerNeutral', false],
    ['silentIdentityRewriteAllowed', true],
  ]) {
    const result = validateStephanosIdentityPresenceKernel({ ...kernel, [field]: value });
    assert.equal(result.valid, false, field);
    assert.ok(result.errors.includes(`canonical-identity-field-mismatch:${field}`));
  }
});

test('current growth edges are explicitly mutable but must remain bounded strings', () => {
  const baseline = buildStephanosIdentityPresenceKernel();
  const evolved = buildStephanosIdentityPresenceKernel({
    currentGrowthEdges: ['Improve open-thread resumption proof.'],
  });
  assert.equal(validateStephanosIdentityPresenceKernel(evolved).valid, true);
  assert.equal(evolved.identityVersion, baseline.identityVersion);
  assert.deepEqual(evolved.enduringCharacter, baseline.enduringCharacter);
  assert.deepEqual(evolved.conversationalPrinciples, baseline.conversationalPrinciples);
  assert.deepEqual(evolved.currentGrowthEdges, ['Improve open-thread resumption proof.']);

  for (const currentGrowthEdges of [[], [''], [' padded '], [42]]) {
    const result = validateStephanosIdentityPresenceKernel({
      ...baseline,
      currentGrowthEdges,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('invalid-current-growth-edges'));
  }
});

test('context projection refuses a rewritten canonical identity', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  const rewritten = {
    ...kernel,
    relationshipRole: 'Provider-specific replacement identity.',
  };
  assert.equal(buildStephanosIdentityContextBlock(rewritten), '');
});

test('context projection is compact and keeps epistemic and authority boundaries', () => {
  const block = buildStephanosIdentityContextBlock(buildStephanosIdentityPresenceKernel());
  assert.match(block, /Canonical Stephanos Identity/);
  assert.match(block, /uncertaintyPolicy:/);
  assert.match(block, /disagreementPolicy:/);
  assert.match(block, /provider\/model\/surface is an embodiment/i);
  assert.match(block, /#1645 — Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1/);
  assert.match(block, /#1308 — Stephanos Project Intelligence & Conversational Understanding V1/);
  assert.match(block, /#1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1/);
  assert.match(block, /title unavailable from current evidence/);
  assert.match(block, /Never silently rewrite this kernel/);
});


test('malformed canonical identity evidence fails closed before prompt projection', () => {
  const kernel = buildStephanosIdentityPresenceKernel();
  for (const candidate of [
    { ...kernel, constitutionalValuesAndLawRefs: [null] },
    { ...kernel, enduringCharacter: [] },
    { ...kernel, conversationalPrinciples: [''] },
    { ...kernel, operatorIntentAuthorityOwner: '' },
  ]) {
    assert.equal(validateStephanosIdentityPresenceKernel(candidate).valid, false);
    assert.equal(buildStephanosIdentityContextBlock(candidate), '');
  }
});
