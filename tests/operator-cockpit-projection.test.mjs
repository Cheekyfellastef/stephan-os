import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCockpitProjection } from '../shared/runtime/cockpitProjection.mjs';

const runtimeStatusModel = {
  operatorReliefProjection: {
    missionProofReconciliation: {
      status: 'active',
      acceptedItems: ['mission-console-bridge', 'build-proof'],
      remainingMissingItems: ['verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
      nextBestAction: 'Collect verify-proof.',
    },
    projectAwarenessProjection: { title: 'Operator Cockpit View V1', status: 'active' },
    missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false },
    packetBayProjection: { recommendation: 'Use proof collection packet.' },
    agentRealityLoopProjection: { mergeRecommendation: 'hold', openClawMutationLocked: true },
  },
};

test('canonical cockpit projection produces accepted build proof and acceptance missing proof contract', () => {
  const p = buildCockpitProjection({ runtimeStatusModel });
  assert.deepEqual(p.acceptedProof, ['mission-console-bridge', 'build-proof']);
  assert.deepEqual(p.missingProof, ['verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output']);
  assert.equal(p.missingProofCount, 4);
  assert.equal(p.nextBestAction, 'Collect verify-proof.');
  assert.equal(p.mergeSafety, 'no / hold');
  assert.equal(p.openClawMutationLockState, 'locked');
});

test('landing tile and cockpit pane both import the same canonical cockpit projection and shared renderers', async () => {
  const commandDeck = await readFile(new URL('../modules/command-deck/command-deck.js', import.meta.url), 'utf8');
  const cockpitPanel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(commandDeck, /buildCockpitProjection/);
  assert.match(commandDeck, /renderCockpitSummaryMarkup/);
  assert.match(cockpitPanel, /buildCockpitProjection/);
  assert.match(cockpitPanel, /CockpitDetailView/);
});

test('cockpit-specific proof and merge truth are centralized in projection', async () => {
  const commandDeck = await readFile(new URL('../modules/command-deck/command-deck.js', import.meta.url), 'utf8');
  const summary = await readFile(new URL('../stephanos-ui/src/components/CockpitSummaryView.jsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../stephanos-ui/src/components/CockpitDetailView.jsx', import.meta.url), 'utf8');
  for (const source of [commandDeck, summary, detail]) {
    assert.doesNotMatch(source, /remainingMissingItems|trustedForMerge|mergeReadiness\s*=|missingProof\s*=/);
  }
});
