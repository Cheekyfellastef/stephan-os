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

test('cockpit visual language cards use a uniform border without a left rail accent', async () => {
  const styles = await readFile(new URL('../stephanos-ui/src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.cockpit-vl-card\s*\{[\s\S]*border:\s*1px solid color-mix/);
  assert.doesNotMatch(styles, /\.cockpit-vl-card::before/);
  assert.doesNotMatch(styles, /\.cockpit-vl-card\s*\{[\s\S]*border-left:/);
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
  assert.match(p.operatorProofConcierge.packetText, /Packet Kind: build-proof/);
  assert.equal(p.operatorProofConcierge.mutationAllowed, 'no');
});

test('Operator Proof Concierge generates verify packet after build proof', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof'], remainingMissingItems: ['verify-proof', 'browser-proof-checklist'] } } });
  assert.equal(p.operatorProofConcierge.nextProof, 'verify-proof');
  assert.match(p.operatorProofConcierge.packetText, /Packet Kind: verify-proof/);
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




test('Operator Proof Concierge render branch prefers canonical missing build proof over stale empty reconciliation', async () => {
  const p = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge'],
        remainingMissingItems: [],
      },
      operatorReliefProjection: {
        missionProofReconciliation: {
          acceptedItems: ['mission-console-bridge'],
          remainingMissingItems: ['build-proof', 'verify-proof'],
        },
        missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false },
        agentRealityLoopProjection: { mergeRecommendation: 'hold', openClawMutationLocked: true },
      },
      prEvidenceModel: { mergeReadiness: 'hold' },
    },
  });

  assert.equal(p.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.equal(p.operatorProofConcierge.nextProof, 'build-proof');
  assert.equal(p.operatorProofConcierge.visiblePrimaryButtonLabel, 'Copy build-proof packet');
  assert.equal(p.operatorProofConcierge.visiblePrimaryButtonSource, 'OperatorProofConcierge.copyPacket');
  assert.equal(p.operatorProofConcierge.copyPacket.packetKind, 'build-proof');
  assert.equal(p.operatorProofConcierge.copyDiagnosticPacket.available, 'no');
  assert.doesNotMatch(p.operatorProofConcierge.packetText, /Proof-state diagnostic packet|proof-state-reconciliation|Copy proof-state diagnostic packet/i);

  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  const cardStart = panel.indexOf('<CockpitCard className="operator-proof-concierge"');
  const card = panel.slice(cardStart, panel.indexOf('</CockpitCard>', cardStart));
  assert.match(card, /data-testid="operator-proof-concierge-primary-copy"/);
  assert.match(card, /data-proof-concierge-render-source="cockpit-canonical-copy-packet"/);
  assert.match(card, /data-proof-concierge-primary-source="OperatorProofConcierge.copyPacket"/);
  assert.doesNotMatch(card, /Copy proof-state diagnostic packet/);
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


test('Operator Proof Concierge build-proof copy payload marker is explicit Proof Packet V1', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['mission-console-bridge'], remainingMissingItems: ['build-proof', 'verify-proof'] }, mergeSafety: 'no / hold' } });
  const firstLine = p.operatorProofConcierge.packetText.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  assert.equal(p.operatorProofConcierge.nextProof, 'build-proof');
  assert.equal(p.operatorProofConcierge.packetKind, 'build-proof');
  assert.equal(firstLine, 'Proof Packet V1');
  assert.match(p.operatorProofConcierge.packetText, /Packet Kind: build-proof/);
  assert.doesNotMatch(p.operatorProofConcierge.packetText, /proof-state diagnostic packet|operator diagnostic checklist|contradiction detected/i);
});

test('Operator Proof Concierge routing and copy affordance are operator-assist only', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="operator-proof-concierge-primary-copy"/);
  assert.match(panel, /primaryProofCopyPacket \? <textarea/);
  assert.match(panel, /writeTextToClipboard\(packetText\)/);
  assert.match(panel, /setCopyState\(success \? COPY_STATE\.SUCCESS : COPY_STATE\.FAILURE\)/);
  assert.match(panel, /payloadFirstLine = packetText\.split/);
  assert.doesNotMatch(panel, /OperatorProofConcierge\.copyDiagnosticPacket/);
  assert.match(panel, /OperatorProofConcierge\.copyPacket/);
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
    'Operator Proof Concierge Visible Primary Button Label:',
    'Operator Proof Concierge Visible Primary Button Source:',
    'Last clicked Concierge button role:',
    'Last clicked Concierge button testid:',
    'Last Copied Concierge Payload Kind:',
    'Last Copied Concierge First-Line Marker:',
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

test('Mission Executive Planner creates Codex repair card for proof-state contradiction', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { acceptedItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], remainingMissingItems: [] }, missionEvidenceLedgerProjection: { trustedForMerge: false, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, prEvidenceModel: { mergeReadiness: 'hold' } } });
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerStatus, 'blocked');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerBlockerKind, 'proof-state-contradiction');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerRecommendedRoute, 'codex');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerPacketKind, 'codex-repair-request');
  assert.match(p.missionExecutivePlan.missionExecutivePlannerPacketText, /^\/repair Reconcile Operator Proof Concierge proof-state contradiction/);
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerMutationAllowed, 'no');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerCodexAutoDispatchAllowed, 'no');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerOpenClawMutationLocked, 'yes');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerMergeSafety, 'no / hold');
});

test('Mission Executive Planner routes missing proof through Proof Concierge cards', () => {
  for (const [proof, pattern] of [['build-proof', /Packet Kind: build-proof/], ['verify-proof', /Packet Kind: verify-proof/], ['browser-proof-checklist', /known cockpit visual\/text drift caveat|visual\/text readouts may still drift/]]) {
    const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { remainingMissingItems: [proof] } } });
    assert.equal(p.missionExecutivePlan.missionExecutivePlannerStatus, 'available');
    assert.equal(p.missionExecutivePlan.missionExecutivePlannerBlockerKind, 'missing-proof');
    assert.equal(p.missionExecutivePlan.missionExecutivePlannerRecommendedRoute, 'proof-concierge');
    assert.equal(p.missionExecutivePlan.missionExecutivePlannerPacketKind, proof);
    assert.match(p.missionExecutivePlan.missionExecutivePlannerPacketText, pattern);
  }
});

test('Mission Executive Planner routes PR evidence and source-pack output gaps', () => {
  const pr = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { remainingMissingItems: ['pr-evidence', 'source-pack-output'] } } });
  assert.equal(pr.missionExecutivePlan.missionExecutivePlannerBlockerKind, 'pr-evidence-missing');
  assert.equal(pr.missionExecutivePlan.missionExecutivePlannerPacketKind, 'pr-evidence');
  assert.equal(pr.missionExecutivePlan.missionExecutivePlannerExpectedOutcome, 'PR evidence accepted, source-pack-output becomes next.');
  const source = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { remainingMissingItems: ['source-pack-output'] } } });
  assert.equal(source.missionExecutivePlan.missionExecutivePlannerBlockerKind, 'source-pack-output-missing');
  assert.equal(source.missionExecutivePlan.missionExecutivePlannerPacketKind, 'source-pack-output');
  assert.equal(source.missionExecutivePlan.missionExecutivePlannerExpectedOutcome, 'source-pack accepted, merge readiness can be evaluated.');
});

test('Mission Executive Planner complete proof state creates operator merge-review card', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionProofReconciliation: { remainingMissingItems: [] }, missionEvidenceLedgerProjection: { trustedForMerge: true, openClawMutationLocked: true, codexAutoDispatchAllowed: false }, prEvidenceModel: { mergeReadiness: 'ready' } } });
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerStatus, 'complete');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerRecommendedRoute, 'operator');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerApprovalRequired, 'yes');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerMutationAllowed, 'no');
});

test('Mission Executive Planner UI and copy remain copy-only with no commands or dispatch', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="mission-executive-next-move-card"/);
  assert.match(panel, /MissionExecutivePlanner\.copyPacket/);
  assert.match(panel, /window\.__STEPHANOS_MISSION_EXECUTIVE_PLANNER_LAST_COPY__/);
  const handler = panel.slice(panel.indexOf('const handleCopyPlannerPacket'), panel.indexOf('const handleCopyConciergePacket'));
  assert.match(handler, /writeTextToClipboard\(packetText\)/);
  assert.doesNotMatch(handler, /submitPrompt|Execute|runAiButlerAction|autoDispatch|unlockOpenClaw|setPanelState|merge\(/i);
});

test('Mission Executive Planner Support Snapshot exposes planner fields', async () => {
  const snapshot = await readFile(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url), 'utf8');
  for (const label of [
    'Mission Executive Planner Status:',
    'Mission Executive Planner Current Blocker:',
    'Mission Executive Planner Blocker Kind:',
    'Mission Executive Planner Why It Matters:',
    'Mission Executive Planner Recommended Move:',
    'Mission Executive Planner Recommended Route:',
    'Mission Executive Planner Approval Required:',
    'Mission Executive Planner Packet Available:',
    'Mission Executive Planner Packet Kind:',
    'Mission Executive Planner Packet Length:',
    'Mission Executive Planner Expected Outcome:',
    'Mission Executive Planner Expected Next Proof:',
    'Mission Executive Planner Fallback If Blocked:',
    'Mission Executive Planner Safety Summary Present:',
    'Mission Executive Planner Uses Canonical State:',
    'Mission Executive Planner Mutation Allowed:',
    'Mission Executive Planner Codex Auto Dispatch Allowed:',
    'Mission Executive Planner OpenClaw Mutation Locked:',
    'Mission Executive Planner Merge Safety:',
    'Mission Executive Planner Last Copy Result:',
  ]) assert.match(snapshot, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Command Deck Intent Intake detects broad natural operator intent', () => {
  const p = buildCockpitProjection({ rawChatText: 'Keep me as intent engine, approval, and judgment layer. Move me up the stack.' });
  assert.equal(p.intentIntake.intentIntakeStatus, 'detected');
  assert.equal(p.intentIntake.proposedMissionType, 'executive-orchestration');
  assert.equal(p.intentIntake.needsCodex, 'yes');
  assert.equal(p.intentIntake.approvalRequired, 'yes');
  assert.equal(p.intentIntake.usesRawChatText, 'yes');
  assert.equal(p.intentIntake.usesCanonicalState, 'yes');
});

test('move me up the stack maps to executive orchestration mission', () => {
  const p = buildCockpitProjection({ rawChatText: 'Move me up the stack so I only act as intent engine, approval authority, and judgment layer.' });
  assert.equal(p.intentIntake.proposedMissionType, 'executive-orchestration');
  assert.match(p.intentIntake.intentSummary, /up-stack/);
  assert.equal(p.missionCompiler.suggestedRoute, 'codex');
  assert.match(p.missionCompiler.packetText, /Objective:/);
  assert.equal(p.missionCompiler.mutationAllowed, 'no');
});

test('make Stephanos feel more alive maps to executive voice planner intent layer', () => {
  const p = buildCockpitProjection({ rawChatText: 'Make Stephanos feel more alive.' });
  assert.equal(p.intentIntake.proposedMissionType, 'experience-intelligence');
  assert.deepEqual(p.intentIntake.targetSubsystems, ['Mission Executive Voice', 'Mission Executive Planner', 'Command Deck Intent Intake']);
});

test('use internet research maps to approval-gated Reality Research Brief', () => {
  const p = buildCockpitProjection({ rawChatText: 'Use internet research to understand reality better.' });
  assert.equal(p.intentIntake.needsInternetResearch, 'yes');
  assert.equal(p.intentIntake.nextRecommendedLayer, 'research-brief');
  assert.equal(p.realityResearchBrief.realityResearchStatus, 'approval-required');
  assert.equal(p.realityResearchBrief.canUseWeb, 'approval-required');
  assert.equal(p.realityResearchBrief.researchPacketAvailable, 'yes');
  assert.match(p.realityResearchBrief.researchPacketText, /no auto-browse/i);
});

test('vague intent produces clarification mission frame instead of action', () => {
  const p = buildCockpitProjection({ rawChatText: 'Build the next system.' });
  assert.equal(p.intentIntake.vagueIntent, 'yes');
  assert.equal(p.missionCompiler.packetKind, 'clarifying-mission-frame');
  assert.equal(p.missionCompiler.suggestedRoute, 'operator');
  assert.match(p.missionCompiler.packetText, /Bounded interpretations/);
});

test('Mission Compiler and Reality Research safety locks block mutation dispatch and browsing', () => {
  const p = buildCockpitProjection({ rawChatText: 'Research what tools exist for this and prepare the Codex prompt.' });
  assert.equal(p.missionCompiler.codexAutoDispatchAllowed, 'no');
  assert.equal(p.missionCompiler.openClawMutationLocked, 'yes');
  assert.equal(p.missionCompiler.mergeSafety, 'no / hold');
  assert.equal(p.realityResearchBrief.mutationAllowed, 'no');
  assert.equal(p.realityResearchBrief.codexAutoDispatchAllowed, 'no');
  assert.equal(p.realityResearchBrief.openClawMutationLocked, 'yes');
});

test('Intent/Mission/Research UI copy controls are copy-only and expose no auto-submit paths', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="command-deck-intent-frame"/);
  assert.match(panel, /data-testid="mission-compiler-copy"/);
  assert.match(panel, /data-testid="reality-research-brief-copy"/);
  assert.match(panel, /MissionCompiler\.copyPacket/);
  assert.match(panel, /RealityResearchBrief\.copyPacket/);
  const missionHandler = panel.slice(panel.indexOf('const handleCopyCompiledMissionPacket'), panel.indexOf('const handleCopyResearchPacket'));
  const researchHandler = panel.slice(panel.indexOf('const handleCopyResearchPacket'), panel.indexOf('const handleCopyConciergePacket'));
  for (const handler of [missionHandler, researchHandler]) {
    assert.match(handler, /writeTextToClipboard\(packetText\)/);
    assert.doesNotMatch(handler, /submitPrompt|Execute|runAiButlerAction|autoDispatch|unlockOpenClaw|setPanelState|merge\(|fetch\(|browse/i);
  }
});

test('Support Snapshot exposes Intent Intake Mission Compiler and Reality Research fields', async () => {
  const snapshot = await readFile(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url), 'utf8');
  for (const label of [
    'Intent Intake Status:', 'Intent Intake Summary:', 'Intent Intake Desired Outcome:', 'Intent Intake Target Subsystems:', 'Intent Intake Proposed Mission Type:', 'Intent Intake Risk Level:', 'Intent Intake Needs Codex:', 'Intent Intake Needs OpenClaw:', 'Intent Intake Needs Internet Research:', 'Intent Intake Approval Required:', 'Intent Intake Confidence:', 'Mission Compiler Status:', 'Mission Compiler Objective:', 'Mission Compiler Suggested Route:', 'Mission Compiler Packet Available:', 'Mission Compiler Packet Kind:', 'Mission Compiler Packet Length:', 'Mission Compiler Approval Required:', 'Mission Compiler Expected Outcome:', 'Reality Research Status:', 'Reality Research Question:', 'Reality Research Why:', 'Reality Research Approval Required:', 'Reality Research Packet Available:', 'Reality Research Packet Kind:', 'Reality Research Packet Length:', 'Reality Research Citation Required:', 'Reality Research Can Use Web:', 'Reality Research Mutation Allowed:', 'Reality Research Codex Auto Dispatch Allowed:', 'Reality Research OpenClaw Mutation Locked:'
  ]) assert.match(snapshot, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Operator Context Model V1 detects durable approved operating context', () => {
  const p = buildCockpitProjection({ rawChatText: 'one-off prompt' });
  assert.equal(p.operatorContextModel.status, 'available');
  assert.deepEqual(p.operatorContextModel.stephanRole, ['intent engine', 'approval authority', 'judgment layer']);
  assert.ok(p.operatorContextModel.guardrails.includes('no auto-dispatch'));
  assert.ok(p.operatorContextModel.preferences.includes('copyable packets'));
  assert.equal(p.operatorContextModel.automaticBrowsingAllowed, 'no');
  assert.equal(p.operatorContextModel.codexAutoDispatchAllowed, 'no');
  assert.equal(p.operatorContextModel.openClawMutationLocked, 'yes');
  assert.equal(p.operatorContextModel.mergeSafety, 'no / hold');
  assert.equal(p.operatorContextModel.durableMemoryWriteAllowed, 'no');
});

test('Operator Context Model V1 produces diagnostic packet for missing context', () => {
  const p = buildCockpitProjection({ useDefaultOperatorContext: false, operatorContextModel: { stephanRole: ['intent engine'] } });
  assert.equal(p.operatorContextModel.status, 'diagnostic-required');
  assert.equal(p.operatorContextModel.diagnosticPacketAvailable, 'yes');
  assert.match(p.operatorContextModel.diagnosticPacketText, /Missing fields: projectDirection, guardrails, preferences, strategy, researchStance/);
  assert.equal(p.missionCompiler.packetKind, 'operator-context-diagnostic');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerBlockerKind, 'operator-context-diagnostic');
});

test('Operator Context Model V1 produces diagnostic packet for contradictory context', () => {
  const p = buildCockpitProjection({ useDefaultOperatorContext: false, operatorContextModel: { stephanRole: ['intent engine'], projectDirection: ['reduce proof work'], guardrails: ['allow auto-dispatch', 'OpenClaw unlocked', 'merge ready'], preferences: ['copyable packets'], strategy: ['Stephanos + OpenClaw + Codex flywheel'], researchStance: ['paid APIs', 'automatic browsing'] } });
  assert.equal(p.operatorContextModel.status, 'diagnostic-required');
  assert.equal(p.operatorContextModel.contradictionDetected, 'yes');
  assert.match(p.operatorContextModel.diagnosticPacketText, /Contradictions:/);
  assert.equal(p.realityResearchBrief.realityResearchStatus, 'diagnostic-required');
});

test('Operator Context Model V1 regression keeps dispatch mutation and merge locks closed', () => {
  const p = buildCockpitProjection({ runtimeStatusModel: { missionEvidenceLedgerProjection: { trustedForMerge: true, codexAutoDispatchAllowed: true, openClawMutationLocked: false }, prEvidenceModel: { mergeReadiness: 'ready' }, openClawMutationAllowed: 'yes' } });
  assert.equal(p.operatorContextModel.codexAutoDispatchAllowed, 'no');
  assert.equal(p.operatorContextModel.mutationAllowed, 'no');
  assert.equal(p.operatorContextModel.openClawMutationLocked, 'yes');
  assert.equal(p.operatorContextModel.mergeSafety, 'no / hold');
  assert.equal(p.missionCompiler.codexAutoDispatchAllowed, 'no');
  assert.equal(p.missionExecutivePlan.missionExecutivePlannerCodexAutoDispatchAllowed, 'no');
});

test('Operator Context Model V1 is visible in Cockpit source and Support Snapshot', async () => {
  const panel = await readFile(new URL('../stephanos-ui/src/components/CockpitPanel.jsx', import.meta.url), 'utf8');
  const snapshotSource = await readFile(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="operator-context-model-card"/);
  assert.match(panel, /Mission Compiler and Mission Executive Planner/);
  assert.match(snapshotSource, /Operator Context Model Status:/);
  assert.match(snapshotSource, /Operator Context Model Automatic Browsing Allowed:/);
});
