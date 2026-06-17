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

test('cockpit visual dashboard is projection-signed and appears before text on both surfaces', async () => {
  const commandDeck = await readFile(new URL('../shared/runtime/cockpitProjection.mjs', import.meta.url), 'utf8');
  const summary = await readFile(new URL('../stephanos-ui/src/components/CockpitSummaryView.jsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../stephanos-ui/src/components/CockpitDetailView.jsx', import.meta.url), 'utf8');
  assert.match(commandDeck, /data-cockpit-visual="true"[\s\S]*data-cockpit-text="true"/);
  assert.match(summary, /data-cockpit-block="summary-readout"/);
  assert.match(detail, /<CockpitVisualDashboard[\s\S]*<CockpitSummaryView[\s\S]*data-cockpit-block="detail-grid"/);
  assert.match(detail, /data-cockpit-block="proof-chip-list"/);
  assert.match(detail, /data-cockpit-debug-collapsed-default="yes"/);
  assert.match(summary, /data-cockpit-projection-source="canonical cockpit projection"/);
  assert.match(detail, /data-cockpit-projection-source="canonical cockpit projection"/);
});


test('expanded cockpit dashboard is primary visual before compact readouts and route topology is routing-only', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  const visual = await readFile(new URL('../stephanos-ui/src/components/CockpitVisualDashboard.jsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../stephanos-ui/src/components/CockpitDetailView.jsx', import.meta.url), 'utf8');
  assert.match(visual, /data-cockpit-block=\{compact \? 'shortcut-visual' : 'primary-dashboard'\}/);
  assert.match(visual, /data-cockpit-kind="visual"/);
  assert.match(visual, /data-cockpit-animation-truth-impact="none"/);
  assert.ok(detail.indexOf('<CockpitVisualDashboard projection={p} />') < detail.indexOf('<CockpitSummaryView projection={p} />'));
  assert.ok(detail.indexOf('<CockpitSummaryView projection={p} />') < detail.indexOf('data-cockpit-block="detail-grid"'));
  assert.match(panel, /data-cockpit-block="route-topology" data-cockpit-kind="routing"/);
  assert.ok(panel.indexOf('<CockpitDetailView projection={cockpitProjection} />') < panel.indexOf('data-cockpit-block="route-topology"'));
});
