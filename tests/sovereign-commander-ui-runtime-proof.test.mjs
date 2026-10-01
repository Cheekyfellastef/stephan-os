import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVrAtlasStatusPillsObservation,
  parseUiRuntimeProofArgs,
  SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE,
} from '../scripts/sovereign-commander-ui-runtime-proof.mjs';
import {
  classifyPostSyncRefresh,
  POST_SYNC_REFRESH_TARGETS,
} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

function pill(label, overrides = {}) {
  return {
    label,
    compact: true,
    centered: true,
    textCentered: true,
    wrapContract: true,
    overflowFree: true,
    ...overrides,
  };
}

test('VR Atlas runtime proof accepts compact centered overflow-free status pills', () => {
  const result = evaluateVrAtlasStatusPillsObservation({
    pageTitleMatches: true,
    methodsGridVisible: true,
    pills: [
      pill('ACTIVE'),
      pill('NEW-SOURCE-EXTRACTION'),
      pill('REFERENCE-PROVEN'),
      pill('DESIGN-ACTIVE'),
    ],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.pillCount, 4);
  assert.deepEqual(result.blockers, []);
});

test('VR Atlas runtime proof rejects the stretched ellipse regression', () => {
  const result = evaluateVrAtlasStatusPillsObservation({
    pageTitleMatches: true,
    methodsGridVisible: true,
    pills: [
      pill('ACTIVE', { compact: false, centered: false }),
      pill('NEW-SOURCE-EXTRACTION'),
      pill('REFERENCE-PROVEN'),
      pill('DESIGN-ACTIVE'),
    ],
  });
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('VR_ATLAS_STATUS_PILL_NOT_COMPACT:ACTIVE'));
  assert.ok(result.blockers.includes('VR_ATLAS_STATUS_PILL_NOT_CENTERED:ACTIVE'));
});

test('Commander UI proof profile remains closed-world', () => {
  assert.equal(parseUiRuntimeProofArgs([]).profile, SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE);
  assert.equal(parseUiRuntimeProofArgs(['--profile', 'vr-atlas-status-pills']).profile, 'vr-atlas-status-pills');
  assert.throws(
    () => parseUiRuntimeProofArgs(['--profile', 'arbitrary-url']),
    /SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_PROFILE_NOT_ALLOWED/,
  );
  assert.throws(
    () => parseUiRuntimeProofArgs(['--url', 'https://example.com']),
    /SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_ARGUMENT_NOT_ALLOWED/,
  );
});

test('Atlas source changes automatically require UI refresh followed by browser proof', () => {
  const plan = classifyPostSyncRefresh(['apps/vr-capability-atlas/atlas-v2.css']);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.UI_4173));
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF));
  assert.ok(
    plan.targetIds.indexOf(POST_SYNC_REFRESH_TARGETS.UI_4173)
      < plan.targetIds.indexOf(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF),
  );
});
