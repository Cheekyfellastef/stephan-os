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
  'galaxians','ideas','vr-research-lab','wealthapp','wealth-simulation-scenarios','music-tile','cockpit','agents','world-workspace','mission-console','openclaw','stephanos','goal-dashboard','experimental',
];
const OBSERVED_AT = '2026-08-14T11:15:00.000Z';
const NOW_MS = Date.parse('2026-08-14T12:00:00.000Z');
function seed(overrides = {}) { return createUiAgentM2SeedInventory({ registeredApps:CURRENT_APPS, observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, ...overrides }); }

test('M2 seed inventory maps current registered apps plus cross-device surfaces without inventing live proof', () => {
  const inventory = seed();
  assert.equal(inventory.valid, true, inventory.validationErrors.join(', '));
  assert.equal(inventory.registeredApps.length, CURRENT_APPS.length);
  for (const id of ['stephanos-landing-page','ai-console','goal-dashboard','music-tile','vr-research-lab','ipad','quest3-spatial']) assert.ok(inventory.surfaces.some((surface) => surface.surfaceId === id));
  for (const surface of inventory.surfaces) { assert.equal(surface.lastVisualProof, ''); assert.equal(surface.lastInteractionProof, ''); }
});

test('M2 inventory keeps current gaps explicit rather than claiming complete estate coverage', () => {
  const inventory = seed();
  for (const id of ['vr-link','sovereignty','privacy','trading-laboratory']) assert.ok(inventory.coverage.missingCanonical.includes(id));
  assert.equal(inventory.nextMilestone, 'M2_COMPLETE_SOURCE_AND_PRESENTATION_SURFACE_DISCOVERY');
});

test('shared primitives preserve existing workspace, panel and reduced-motion source ownership', () => {
  assert.deepEqual(UI_AGENT_M2_SHARED_PRIMITIVES.map((primitive) => primitive.primitiveId), ['workspace-canvas','workspace-lane','workspace-gutter','panel-card-shell','reduced-motion-contract']);
  for (const primitive of UI_AGENT_M2_SHARED_PRIMITIVES) {
    assert.equal(primitive.schemaVersion, UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION);
    assert.equal(primitive.sourceRef, 'stephanos-ui/src/styles.css');
    assert.equal(validateUiAgentSharedPrimitive(primitive).valid, true);
  }
});

test('explicit surface observations replace inferred app placeholders by stable surface identity', () => {
  const inventory = seed({ explicitSurfaces:[{ surfaceId:'goal-dashboard', surfaceClass:'REGISTERED_APP', ownerGoal:'#1282', registrationRef:'apps/goal-dashboard', inputMethods:['KEYBOARD','POINTER','TOUCH'], knownExperienceDebt:['STATE_TRUTH_DEFECT'], severity:'MEDIUM', recommendedNextImprovement:'Reconcile the current truth projection before visual polish.' }] });
  const dashboard = inventory.surfaces.find((surface) => surface.surfaceId === 'goal-dashboard');
  assert.equal(inventory.valid, true, inventory.validationErrors.join(', '));
  assert.equal(dashboard.ownerGoal, '#1282');
  assert.deepEqual(dashboard.knownExperienceDebt, ['STATE_TRUTH_DEFECT']);
});

test('surface validation rejects unknown experience-debt classes', () => {
  const verdict = validateUiAgentExperienceSurface({ schemaVersion:UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION, surfaceId:'test-surface', surfaceClass:'REGISTERED_APP', ownerGoal:'#1722', registrationRef:'apps/test', experienceVersion:'UNASSESSED', componentVersion:'UNASSESSED', responsiveCoverage:'UNKNOWN', accessibilityCoverage:'UNKNOWN', motionCoverage:'UNKNOWN', loadingEmptyErrorCoverage:'UNKNOWN', inputMethods:['POINTER'], lastVisualProof:'', lastInteractionProof:'', knownExperienceDebt:['MAGIC_BEAUTY_SCORE'], severity:'UNKNOWN', recommendedNextImprovement:'AUDIT_REQUIRED' });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('experience-debt-invalid:MAGIC_BEAUTY_SCORE'));
});

test('surface validation returns invalid instead of throwing on non-array debt', () => {
  for (const knownExperienceDebt of [{}, 1]) {
    let verdict;
    assert.doesNotThrow(() => { verdict = validateUiAgentExperienceSurface({ schemaVersion:UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION, surfaceId:'malformed-debt-surface', surfaceClass:'REGISTERED_APP', ownerGoal:'#1722', registrationRef:'apps/test', experienceVersion:'UNASSESSED', componentVersion:'UNASSESSED', responsiveCoverage:'UNKNOWN', accessibilityCoverage:'UNKNOWN', motionCoverage:'UNKNOWN', loadingEmptyErrorCoverage:'UNKNOWN', inputMethods:['POINTER'], lastVisualProof:'', lastInteractionProof:'', knownExperienceDebt, severity:'UNKNOWN', recommendedNextImprovement:'AUDIT_REQUIRED' }); });
    assert.equal(verdict.valid, false);
    assert.ok(verdict.errors.includes('knownExperienceDebt-must-be-array'));
  }
});

test('surface registration references reject absolute and traversal paths but allow bounded presentation refs', () => {
  for (const badRef of ['/etc/passwd','../secret','C:\\Users\\Stephan\\secret','apps/../secret']) {
    const inventory = buildUiAgentExperienceInventory({ registeredApps:[], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, explicitSurfaces:[{ surfaceId:'test-surface', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:badRef, inputMethods:['TOUCH'], knownExperienceDebt:['UNKNOWN'] }] });
    assert.equal(inventory.valid, false, `${badRef} must fail closed`);
    assert.ok(inventory.validationErrors.includes('test-surface:registrationRef-invalid'));
  }
  const presentation = buildUiAgentExperienceInventory({ registeredApps:[], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, explicitSurfaces:[{ surfaceId:'test-surface', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:ipad', inputMethods:['TOUCH'], knownExperienceDebt:['UNKNOWN'] }] });
  assert.equal(presentation.valid, true, presentation.validationErrors.join(', '));
});

test('omitted, empty or non-array experience debt remains visibly UNKNOWN', () => {
  for (const debt of [undefined, [], 'not-assessed']) {
    const inventory = buildUiAgentExperienceInventory({ registeredApps:[], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, explicitSurfaces:[{ surfaceId:'unassessed-surface', surfaceClass:'FUTURE_PRODUCT_SURFACE', ownerGoal:'#1722', registrationRef:'presentation:unassessed', inputMethods:['POINTER'], knownExperienceDebt:debt }] });
    assert.equal(inventory.valid, true, inventory.validationErrors.join(', '));
    assert.deepEqual(inventory.surfaces[0].knownExperienceDebt, ['UNKNOWN']);
  }
});

test('primitive validation rejects absolute or unsafe source references', () => {
  const verdict = validateUiAgentSharedPrimitive({ schemaVersion:UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION, primitiveId:'rogue-primitive', sourceRef:'C:/Users/Stephan/Desktop/private.css', selectorOrExport:'.rogue', role:'rogue source' });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('sourceRef-invalid'));
});

test('inventory remains advisory and cannot acquire implementation or product authority', () => {
  const inventory = buildUiAgentExperienceInventory({ registeredApps:['stephanos'], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, explicitSurfaces:[{ surfaceId:'ipad', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:ipad', inputMethods:['TOUCH'], knownExperienceDebt:['UNKNOWN'] }] });
  assert.deepEqual(inventory.authority, { sourceMutationAllowed:false, implementationAllowed:false, mergeAllowed:false, deploymentAllowed:false, productAuthority:false });
});

test('invalid or future observation timestamps fail closed against trusted clock', () => {
  const invalid = seed({ observedAtUtc:'today-ish' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.validationErrors.includes('observedAtUtc-invalid'));
  for (const observedAtUtc of ['2026-08-14T12:00:00.001Z','2099-01-01T00:00:00.000Z']) {
    const future = seed({ observedAtUtc });
    assert.equal(future.valid, false, `${observedAtUtc} must fail closed`);
    assert.ok(future.validationErrors.includes('observedAtUtc-future-dated'));
  }
});

test('invalid canonical surfaces remain missing rather than inflating coverage', () => {
  const inventory = buildUiAgentExperienceInventory({ registeredApps:[], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, explicitSurfaces:[{ surfaceId:'privacy', surfaceClass:'REGISTERED_APP', ownerGoal:'#1722', registrationRef:'../secret', inputMethods:['POINTER'], knownExperienceDebt:['UNKNOWN'] }] });
  assert.equal(inventory.valid, false);
  assert.ok(inventory.validationErrors.includes('privacy:registrationRef-invalid'));
  assert.equal(inventory.coverage.coveredCanonical.includes('privacy'), false);
  assert.ok(inventory.coverage.missingCanonical.includes('privacy'));
  assert.equal(inventory.coverage.coveredCanonicalCount, 0);
});

test('malformed shared-primitives evidence fails closed without throwing', () => {
  for (const sharedPrimitives of [{}, 1]) {
    let inventory;
    assert.doesNotThrow(() => {
      inventory = buildUiAgentExperienceInventory({ registeredApps:['stephanos'], observedAtUtc:OBSERVED_AT, validationOptions:{ nowMs:NOW_MS }, sharedPrimitives });
    });
    assert.equal(inventory.valid, false);
    assert.ok(inventory.validationErrors.includes('sharedPrimitives-must-be-array'));
    assert.deepEqual(inventory.sharedPrimitives, []);
  }
});
