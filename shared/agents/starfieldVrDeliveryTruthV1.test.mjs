import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY,
  STARFIELD_VR_LOCAL_DELIVERY_SCHEMA,
  assessStarfieldVrDeliveryTruth,
} from './starfieldVrDeliveryTruthV1.mjs';

const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const MAIN = 'c'.repeat(40);
const files = [
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
  'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
  'scripts/starfield-vr-launcher-source.test.mjs',
];
const source = (overrides = {}) => ({
  repository: 'Cheekyfellastef/stephan-os', prNumber: 2050,
  branch: 'agent/starfield-vr-launch-splash-v1', headSha: HEAD,
  merged: true, mergeCommitSha: MERGE, currentMainSha: MAIN,
  changedFiles: files, ...overrides,
});
const local = (overrides = {}) => ({
  schemaVersion: STARFIELD_VR_LOCAL_DELIVERY_SCHEMA,
  observedAtUtc: '2026-08-28T20:45:00Z', desktopIconPresent: true,
  splashWrapperPresent: true,
  shortcutTargetPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  shortcutArguments: '-File "C:\\Users\\Test\\Documents\\GitHub\\stephan-os\\scripts\\windows\\launch-starfield-vr-with-splash.ps1"',
  shortcutRoutesThroughSplash: true, installerReceiptPresent: true,
  installerReceiptVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED', installedSourceHead: MAIN,
  ...overrides,
});

test('complete delivery truth lights all four statuses', () => {
  const result = assessStarfieldVrDeliveryTruth({ source: source(), local: local() });
  assert.equal(result.valid, true);
  assert.equal(result.desktopIconPresent, true);
  assert.equal(result.splashSourceBuilt, true);
  assert.equal(result.splashMerged, true);
  assert.equal(result.splashInstalled, true);
  assert.equal(result.blocker, '');
  assert.equal(result.boundary.launchAuthority, false);
  assert.equal(Object.isFrozen(result), true);
});

test('missing local proof preserves unknown icon and install truth', () => {
  const result = assessStarfieldVrDeliveryTruth({ source: source(), local: null });
  assert.equal(result.desktopIconPresent, 'unknown');
  assert.equal(result.splashInstalled, 'unknown');
  assert.equal(result.blocker, 'LOCAL_DELIVERY_PROOF_MISSING');
});

test('unmerged splash can be built without being installed', () => {
  const result = assessStarfieldVrDeliveryTruth({
    source: source({ merged: false, mergeCommitSha: '' }), local: local(),
  });
  assert.equal(result.splashSourceBuilt, true);
  assert.equal(result.splashMerged, false);
  assert.equal(result.splashInstalled, false);
  assert.equal(result.blocker, 'SPLASH_NOT_MERGED');
});

test('shortcut not routed through splash fails installation truth closed', () => {
  const result = assessStarfieldVrDeliveryTruth({ source: source(), local: local({ shortcutRoutesThroughSplash: false }) });
  assert.equal(result.desktopIconPresent, true);
  assert.equal(result.splashInstalled, false);
  assert.equal(result.blocker, 'SHORTCUT_NOT_ROUTED_THROUGH_SPLASH');
});

test('installed source must equal the exact delivered current main', () => {
  const result = assessStarfieldVrDeliveryTruth({ source: source(), local: local({ installedSourceHead: 'd'.repeat(40) }) });
  assert.equal(result.splashInstalled, false);
  assert.equal(result.blocker, 'INSTALLED_SOURCE_HEAD_MISMATCH');
});

test('required source estate is closed-world enough to prove built status', () => {
  const result = assessStarfieldVrDeliveryTruth({ source: source({ changedFiles: files.slice(1) }), local: null });
  assert.equal(result.splashSourceBuilt, false);
  assert.equal(result.splashInstalled, false);
  assert.equal(result.blocker, 'SPLASH_SOURCE_NOT_BUILT');
});

test('accessor-bearing and exotic records fail closed without executing getters', () => {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, 'source', { enumerable: true, get() { calls += 1; throw new Error('no'); } });
  const result = assessStarfieldVrDeliveryTruth(input);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
  assert.equal(assessStarfieldVrDeliveryTruth(Object.create(null)).valid, false);
});

test('delivery boundary cannot claim mutation authority', () => {
  assert.equal(STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY.installAuthority, false);
  assert.equal(STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY.mergeAuthority, false);
  assert.equal(STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY.runtimeMutationAuthority, false);
  assert.equal(Object.isFrozen(STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY), true);
});
