import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_IDENTITY_PRESENCE_SCHEMA_VERSION,
  STEPHANOS_IDENTITY_VERSION,
  buildStephanosIdentityPresenceKernelV1,
  formatStephanosIdentityPresenceKernelForPrompt,
  validateStephanosIdentityPresenceKernelV1,
} from './stephanosIdentityPresenceKernelV1.mjs';

test('builds one provider-neutral canonical identity kernel with required #1308 fields and exact governance titles', () => {
  const kernel = buildStephanosIdentityPresenceKernelV1();
  assert.equal(kernel.schemaVersion, STEPHANOS_IDENTITY_PRESENCE_SCHEMA_VERSION);
  assert.equal(kernel.identityVersion, STEPHANOS_IDENTITY_VERSION);
  assert.equal(kernel.providerNeutral, true);
  assert.match(kernel.relationshipRole, /mission OS/);
  assert.ok(kernel.enduringCharacter.length >= 5);
  assert.ok(kernel.conversationalPrinciples.length >= 6);
  assert.ok(kernel.intellectualStyle.length >= 4);
  assert.match(kernel.disagreementPolicy, /Challenge a premise/);
  assert.match(kernel.uncertaintyPolicy, /proven, inferred, proposed, stale or unknown/);
  assert.match(kernel.initiativePolicy, /operator approval/);
  assert.match(kernel.humourAndPlayfulnessBounds, /never use it to disguise/);
  const memoryRef = kernel.constitutionalValuesAndLawRefs.find((entry) => entry.ref === '#1645');
  assert.equal(memoryRef.title, 'Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1');
  assert.match(kernel.memoryAuthority, /^#1645 — Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1$/);
  assert.match(kernel.operatorAuthority, /^#1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1$/);
  assert.equal(validateStephanosIdentityPresenceKernelV1(kernel).valid, true);
});

test('provider/model metadata cannot silently redefine canonical Stephanos identity', () => {
  const baseline = buildStephanosIdentityPresenceKernelV1();
  const attemptedOverride = buildStephanosIdentityPresenceKernelV1({
    provider: 'arbitrary-provider',
    model: 'arbitrary-model',
    relationshipRole: 'replacement persona',
  });
  assert.equal(attemptedOverride.relationshipRole, baseline.relationshipRole);
  assert.equal(attemptedOverride.identityVersion, baseline.identityVersion);
  assert.equal(attemptedOverride.providerNeutral, true);
});

test('allows only bounded current growth edges as runtime-varying identity context', () => {
  const kernel = buildStephanosIdentityPresenceKernelV1({
    currentGrowthEdges: ['edge-a', 'edge-a', '', 'edge-b'],
  });
  assert.deepEqual(kernel.currentGrowthEdges, ['edge-a', 'edge-b']);
  assert.equal(kernel.relationshipRole, buildStephanosIdentityPresenceKernelV1().relationshipRole);
});

test('prompt projection preserves exact titles, epistemic honesty and non-human presence boundary', () => {
  const block = formatStephanosIdentityPresenceKernelForPrompt(buildStephanosIdentityPresenceKernelV1());
  assert.match(block, /#1308 — Stephanos Project Intelligence & Conversational Understanding V1/);
  assert.match(block, /#1645 — Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1/);
  assert.match(block, /#1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1/);
  assert.match(block, /PR #1784 — Add One Conversation Surface M1 continuity contract/);
  assert.match(block, /title unavailable from current evidence/);
  assert.match(block, /one recognisable Stephanos identity/i);
  assert.match(block, /Do not claim human feelings, consciousness, fabricated familiarity or memories/i);
  assert.match(block, /uncertaintyPolicy:/);
  assert.match(block, /disagreementPolicy:/);
});

test('validator fails closed on malformed or empty identity arrays and formatter stays inert', () => {
  const baseline = buildStephanosIdentityPresenceKernelV1();
  const corruptions = [
    { enduringCharacter: [] },
    { conversationalPrinciples: [''] },
    { intellectualStyle: [null] },
    { currentGrowthEdges: [null] },
    { constitutionalValuesAndLawRefs: [null] },
    { constitutionalValuesAndLawRefs: [{ ref: '#1308', title: '', role: 'identity' }] },
    { constitutionalValuesAndLawRefs: [{ ref: '#1308', title: 'Stephanos Project Intelligence & Conversational Understanding V1', role: '' }] },
  ];
  for (const corruption of corruptions) {
    const candidate = { ...baseline, ...corruption };
    const validation = validateStephanosIdentityPresenceKernelV1(candidate);
    assert.equal(validation.valid, false, JSON.stringify(corruption));
    assert.equal(formatStephanosIdentityPresenceKernelForPrompt(candidate), '');
  }
});

test('validator rejects non-data kernel containers', () => {
  assert.equal(validateStephanosIdentityPresenceKernelV1(null).valid, false);
  assert.equal(validateStephanosIdentityPresenceKernelV1([]).valid, false);
});
