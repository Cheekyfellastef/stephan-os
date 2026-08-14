import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UI_AGENT_M2_SHARED_PRIMITIVES,
  UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
  UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION,
  buildUiAgentExperienceInventory,
  createUiAgentM2SeedInventory,
  validateUiAgentExperienceSurface,
  validateUiAgentSharedPrimitive,
} from './uiAgentExperienceInventoryV1.mjs';

const CURRENT_APPS = [
  'galaxians',
  'ideas',
  'vr-research-lab',
  'wealthapp',
  'wealth-simulation-scenarios',
  'music-tile',
  'cockpit',
  'agents',
  'world-workspace',
  'mission-console',
  'openclaw',
  'stephanos',
  'goal-dashboard',
  'experimental',
];

const OBSERVED_AT = '2026-08-14T11:15:00.000Z';

test('M2 seed inventory maps current registered apps plus cross-device surfaces without inventing live proof', () => {
  const inventory = createUiAgentM2SeedInventory({ registeredApps: CURRENT_APPS, observedAtUtc: OBSERVED_AT });
  assert.equal(inventory.valid, true);
  assert.equal(inventory.registeredApps.length, CURRENT_APPS.length);
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'stephanos-landing-page'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'ai-console'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'goal-dashboard'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'music-tile'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'vr-research-lab'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'ipad'));
  assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === 'quest3-spatial'));
  for (const surface of inventory.surfaces) {
    assert.equal(surface.lastVisualProof, '');
    assert.equal(surface.lastInteractionProof, '');
  }
});

test('M2 inventory keeps current gaps explicit rather than claiming complete estate coverage', () => {
  const inventory = createUiAgentM2SeedInventory({ registeredApps: CURRENT_APPS, observedAtUtc: OBSERVED_AT });
  assert.ok(inventory.coverage.missingCanonical.includes('vr-link'));
  assert.ok(inventory.coverage.missingCanonical.includes('sovereignty'));
  assert.ok(inventory.coverage.missingCanonical.includes('privacy'));
  assert.ok(inventory.coverage.missingCanonical.includes('trading-laboratory'));
  assert.equal(inventory.nextMilestone, 'M2_COMPLETE_SOURCE_AND_PRESENTATION_SURFACE_DISCOVERY');
});

test('shared primitives preserve existing workspace, panel and reduced-motion source ownership', () => {
  const ids = UI_AGENT_M2_SHARED_PRIMITIVES.map((primitive) => primitive.primitiveId);
  assert.deepEqual(ids, [
    'workspace-canvas',
    'workspace-lane',
    'workspace-gutter',
    'panel-card-shell',
    'reduced-motion-contract',
  ]);
  for (const primitive of UI_AGENT_M2_SHARED_PRIMITIVES) {
    assert.equal(primitive.schemaVersion, UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION);
    assert.equal(primitive.sourceRef, 'stephanos-ui/src/styles.css');
    assert.equal(validateUiAgentSharedPrimitive(primitive).valid, true);
  }
});

test('explicit surface observations replace inferred app placeholders by stable surface identity', () => {
  const inventory = createUiAgentM2SeedInventory({
    registeredApps: CURRENT_APPS,
    observedAtUtc: OBSERVED_AT,
    explicitSurfaces: [{
      surfaceId:'goal-dashboard',
      surfaceClass:'REGISTERED_APP',
      ownerGoal:'#1282',
      registrationRef:'apps/goal-dashboard',
      inputMethods:['KEYBOARD','POINTER','TOUCH'],
      knownExperienceDebt:['STATE_TRUTH_DEFECT'],
      severity:'MEDIUM',
      recommendedNextImprovement:'Reconcile the current truth projection before visual polish.',
    }],
  });
  const dashboard = inventory.surfaces.find((surface) => surface.surfaceId === 'goal-dashboard');
  assert.equal(dashboard.ownerGoal, '#1282');
  assert.deepEqual(dashboard.knownExperienceDebt, ['STATE_TRUTH_DEFECT']);
});

test('surface validation rejects unknown experience-debt classes', () => {
  const verdict = validateUiAgentExperienceSurface({
    schemaVersion: UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION,
    surfaceId:'test-surface',
    surfaceClass:'REGISTERED_APP',
    ownerGoal:'#1722',
    registrationRef:'apps/test',
    experienceVersion:'UNASSESSED',
    componentVersion:'UNASSESSED',
    responsiveCoverage:'UNKNOWN',
    accessibilityCoverage:'UNKNOWN',
    motionCoverage:'UNKNOWN',
    loadingEmptyErrorCoverage:'UNKNOWN',
    inputMethods:['POINTER'],
    lastVisualProof:'',
    lastInteractionProof:'',
    knownExperienceDebt:['MAGIC_BEAUTY_SCORE'],
    severity:'UNKNOWN',
    recommendedNextImprovement:'AUDIT_REQUIRED',
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('experience-debt-invalid:MAGIC_BEAUTY_SCORE'));
});

test('primitive validation rejects absolute or unsafe source references', () => {
  const verdict = validateUiAgentSharedPrimitive({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId:'rogue-primitive',
    sourceRef:'C:/Users/Stephan/Desktop/private.css',
    selectorOrExport:'.rogue',
    role:'rogue source',
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('sourceRef-invalid'));
});

test('inventory remains advisory and cannot acquire implementation or product authority', () => {
  const inventory = buildUiAgentExperienceInventory({
    registeredApps:['stephanos'],
    observedAtUtc:OBSERVED_AT,
    explicitSurfaces:[{
      surfaceId:'ipad',
      surfaceClass:'DEVICE_PRESENTATION',
      ownerGoal:'#1722',
      registrationRef:'presentation:ipad',
      inputMethods:['TOUCH'],
      knownExperienceDebt:['UNKNOWN'],
    }],
  });
  assert.deepEqual(inventory.authority, {
    sourceMutationAllowed:false,
    implementationAllowed:false,
    mergeAllowed:false,
    deploymentAllowed:false,
    productAuthority:false,
  });
});

test('invalid observation timestamp fails closed', () => {
  const inventory = createUiAgentM2SeedInventory({ registeredApps:CURRENT_APPS, observedAtUtc:'today-ish' });
  assert.equal(inventory.valid, false);
  assert.ok(inventory.validationErrors.includes('observedAtUtc-invalid'));
});
