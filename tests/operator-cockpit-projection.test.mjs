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

test('cockpit action model routes canonical missing build proof without mutation or rendered text', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof'] } } });
  assert.equal(p.cockpitActionSource, 'canonical cockpit projection');
  assert.equal(p.cockpitPrimaryActionLabel, 'Collect build-proof');
  assert.equal(p.cockpitPrimaryActionKind, 'focus-proof-intake');
  assert.equal(p.cockpitActionMutationAllowed, 'no');
});

test('cockpit action model advances to verify proof after build proof accepted', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof'], remainingMissingItems: ['verify-proof', 'browser-proof-checklist'] } } });
  assert.equal(p.cockpitPrimaryActionLabel, 'Collect verify-proof');
  assert.equal(p.cockpitPrimaryActionKind, 'focus-proof-intake');
});

test('cockpit action model never exposes merge as primary during merge hold', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { prEvidenceMergeReadiness: 'hold', missionProofReconciliation: { remainingMissingItems: [] } } });
  assert.doesNotMatch(p.cockpitPrimaryActionLabel, /merge/i);
  assert.equal(p.cockpitActionMutationAllowed, 'no');
});

test('cockpit UI routing source is explicit and landing tile remains shortcut only', async () => {
  const detail = await readFile(new URL('../stephanos-ui/src/components/CockpitDetailView.jsx', import.meta.url), 'utf8');
  const tile = await readFile(new URL('../stephanos-ui/src/components/CockpitTile.jsx', import.meta.url), 'utf8');
  assert.match(detail, /data-cockpit-rendered-text-used-for-routing="no"/);
  assert.match(detail, /data-testid="cockpit-primary-action"/);
  assert.doesNotMatch(tile, /cockpit-primary-action|action-routing/);
});

test('cockpit primary action button exposes DOM proof attributes and invokes canonical handler path', async () => {
  const detail = await readFile(new URL('../stephanos-ui/src/components/CockpitDetailView.jsx', import.meta.url), 'utf8');
  assert.match(detail, /data-cockpit-action-button="primary"/);
  assert.match(detail, /data-cockpit-action-target-packet-id=\{p\.cockpitPrimaryActionTargetPacketId/);
  assert.match(detail, /data-cockpit-action-source="canonical cockpit projection"/);
  assert.match(detail, /data-cockpit-rendered-text-used-for-routing="no"/);
  assert.match(detail, /data-cockpit-mutation-allowed="no"/);
  assert.match(detail, /onClick=\{\(\) => onPrimaryAction\?\.\(p, 'primary'\)\}/);
});

test('cockpit action handler opens and focuses commandDeck proof intake without mutation', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /setPanelState\(resolved\.targetPaneId, true, 'cockpit-action-routing-v1'\)/);
  assert.match(panel, /'focus-proof-intake': \[[\s\S]*'\[data-panel-id="commandDeck"\] \[data-testid="command-deck-input"\]'/);
  assert.match(panel, /target\.scrollIntoView\?\.\(\{ behavior: 'smooth', block: 'center' \}\)/);
  assert.match(panel, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(panel, /data-cockpit-action-highlight/);
  assert.match(panel, /mutationAttempted: 'no'/);
  const handlerSegment = panel.slice(panel.indexOf('const routeCockpitPrimaryAction'), panel.indexOf('return (', panel.indexOf('const routeCockpitPrimaryAction')));
  assert.doesNotMatch(handlerSegment, /submitPrompt\(|runAiButlerAction\(|unlockOpenClaw|autoDispatch|merge\(/i);
});

test('cockpit action support snapshot records click, handler, target, scroll, highlight, and failures', async () => {
  const snapshot = await readFile(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url), 'utf8');
  for (const label of [
    'Cockpit Last Action Clicked At:',
    'Cockpit Last Action Source Button:',
    'Cockpit Last Action Handler Invoked:',
    'Cockpit Last Action Handler Owner:',
    'Cockpit Last Action Target Pane ID:',
    'Cockpit Last Action Target Selector:',
    'Cockpit Last Action Scroll Applied:',
    'Cockpit Last Action Mutation Attempted:',
    'Cockpit Last Action Failure Reason:',
  ]) {
    assert.match(snapshot, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('cockpit resolver records unsupported and missing target failure reasons', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /failureReason: 'unsupported-action-kind'/);
  assert.match(panel, /failureReason: 'target-pane-not-found'/);
  assert.match(panel, /failureReason: 'target-field-not-found'/);
  assert.match(panel, /failureReason: 'pane-open-failed'/);
});

test('cockpit projection uses cumulative mission proof after rejected browser proof', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { operatorReliefProjection: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge', 'build-proof', 'verify-proof'], remainingMissingItems: ['browser-proof-checklist', 'pr-evidence', 'source-pack-output'], nextBestAction: 'Collect browser-proof-checklist.' }, missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, agentRealityLoopProjection: { mergeRecommendation: 'hold', openClawMutationLocked: true } } } });
  assert.deepEqual(p.acceptedProof, ['mission-console-bridge', 'build-proof', 'verify-proof']);
  assert.deepEqual(p.missingProof, ['browser-proof-checklist', 'pr-evidence', 'source-pack-output']);
  assert.equal(p.nextBestAction, 'Collect browser-proof-checklist.');
  assert.equal(p.cockpitPrimaryActionLabel, 'Copy browser proof checklist');
  assert.equal(p.mergeSafety, 'no / hold');
});

test('cockpit action advances to PR evidence after accepted browser proof while merge stays hold', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { operatorReliefProjection: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge', 'build-proof', 'verify-proof', 'browser-proof-checklist'], remainingMissingItems: ['pr-evidence', 'source-pack-output'], nextBestAction: 'Collect pr-evidence.' }, missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, agentRealityLoopProjection: { mergeRecommendation: 'hold', openClawMutationLocked: true } } } });
  assert.equal(p.cockpitPrimaryActionLabel, 'Copy PR evidence packet');
  assert.deepEqual(p.missingProof, ['pr-evidence', 'source-pack-output']);
  assert.equal(p.mergeSafety, 'no / hold');
  assert.equal(p.openClawMutationLockState, 'locked');
});

test('Operator Proof Concierge reads canonical Mission Proof Reconciliation and generates build packet', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof'] } } });
  assert.equal(p.operatorProofConcierge.usesCanonicalProofState, 'yes');
  assert.equal(p.operatorProofConcierge.nextProof, 'build-proof');
  assert.match(p.operatorProofConcierge.packetText, /Build proof completed manually/);
  assert.equal(p.operatorProofConcierge.mutationAllowed, 'no');
});

test('Operator Proof Concierge generates verify packet after build proof', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof'], remainingMissingItems: ['verify-proof', 'browser-proof-checklist'] } } });
  assert.equal(p.operatorProofConcierge.nextProof, 'verify-proof');
  assert.match(p.operatorProofConcierge.packetText, /Verify proof completed manually/);
});

test('Operator Proof Concierge generates browser checklist with known drift caveat after build and verify', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof'], remainingMissingItems: ['browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } } });
  assert.equal(p.operatorProofConcierge.nextProof, 'browser-proof-checklist');
  assert.match(p.operatorProofConcierge.packetText, /Browser proof checklist completed manually/);
  assert.match(p.operatorProofConcierge.packetText, /visual\/text readouts may still drift/);
  assert.equal(p.operatorProofConcierge.mergeSafety, 'no / hold');
});

test('Operator Proof Concierge generates PR evidence packet after browser proof', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof', 'browser-proof-checklist'], remainingMissingItems: ['pr-evidence', 'source-pack-output'] } } });
  assert.equal(p.operatorProofConcierge.nextProof, 'pr-evidence');
  assert.match(p.operatorProofConcierge.packetText, /PR URL or PR number/);
  assert.match(p.operatorProofConcierge.packetText, /Merge still held until source-pack-output exists/);
});

test('Operator Proof Concierge generates source-pack packet after PR evidence', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence'], remainingMissingItems: ['source-pack-output'] } } });
  assert.equal(p.operatorProofConcierge.nextProof, 'source-pack-output');
  assert.match(p.operatorProofConcierge.packetText, /Changed files summary/);
  assert.match(p.operatorProofConcierge.packetText, /Final clean git status/);
});



test('Operator Proof Concierge generates diagnostic packet when merge hold has no missing proof', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], remainingMissingItems: [] }, missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, prEvidenceModel: { mergeReadiness: 'hold' } } });
  assert.equal(p.operatorProofConcierge.status, 'blocked');
  assert.equal(p.operatorProofConcierge.nextProof, 'proof-state-reconciliation');
  assert.equal(p.operatorProofConcierge.nextActionLabel, 'Copy proof-state diagnostic packet');
  assert.equal(p.operatorProofConcierge.copyPacketAvailable, 'yes');
  assert.equal(p.operatorProofConcierge.packetKind, 'proof-state-reconciliation');
  assert.equal(p.operatorProofConcierge.proofStateContradictionDetected, 'yes');
  assert.match(p.operatorProofConcierge.packetText, /Merge is hold but missing proof is none; reconcile mission proof state, merge blockers, PR evidence, and source-pack output\./);
  assert.equal(p.mergeSafety, 'no / hold');
  assert.equal(p.openClawMutationLockState, 'locked');
  assert.equal(p.codexMutationLockState, 'locked');
});

test('Operator Proof Concierge can complete with no packet when no missing proof and merge is ready', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], remainingMissingItems: [] }, missionEvidenceLedgerProjection: { trustedForMerge: true, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, prEvidenceModel: { mergeReadiness: 'ready' } } });
  assert.equal(p.operatorProofConcierge.status, 'complete');
  assert.equal(p.operatorProofConcierge.nextProof, 'none');
  assert.equal(p.operatorProofConcierge.copyPacketAvailable, 'no');
  assert.equal(p.operatorProofConcierge.packetText, '');
  assert.equal(p.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.equal(p.mergeSafety, 'yes / candidate');
});

test('Operator Proof Concierge routing and copy affordance are operator-assist only', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="operator-proof-concierge-copy"/);
  assert.match(panel, /operatorProofConcierge\.copyPacketAvailable === 'yes' \? <textarea/);
  assert.match(panel, /writeTextToClipboard\(packetText\)/);
  assert.match(panel, /setConciergeCopyState\(success \? COPY_STATE\.SUCCESS : COPY_STATE\.FAILURE\)/);
  const handler = panel.slice(panel.indexOf('const handleCopyConciergePacket'), panel.indexOf('return (', panel.indexOf('const handleCopyConciergePacket')));
  assert.doesNotMatch(handler, /submitPrompt|Execute|runAiButlerAction|autoDispatch|unlockOpenClaw|setPanelState|merge/i);
  assert.match(panel, /'focus-concierge-packet': \[/);
});

test('Operator Proof Concierge support snapshot exposes safety and packet fields', async () => {
  const snapshot = await readFile(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url), 'utf8');
  for (const label of [
    'Operator Proof Concierge Status:',
    'Operator Proof Concierge Next Proof:',
    'Operator Proof Concierge Next Action Label:',
    'Operator Proof Concierge Why:',
    'Operator Proof Concierge Copy Packet Available:',
    'Operator Proof Concierge Packet Kind:',
    'Operator Proof Concierge Packet Length:',
    'Operator Proof Concierge Proof State Contradiction Detected:',
    'Operator Proof Concierge Contradiction Reason:',
    'Operator Proof Concierge Uses Canonical Proof State:',
    'Operator Proof Concierge Mutation Allowed:',
    'Operator Proof Concierge Codex Auto Dispatch Allowed:',
    'Operator Proof Concierge OpenClaw Mutation Locked:',
    'Operator Proof Concierge Merge Safety:',
    'Operator Proof Concierge Last Copy Result:',
  ]) assert.match(snapshot, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
