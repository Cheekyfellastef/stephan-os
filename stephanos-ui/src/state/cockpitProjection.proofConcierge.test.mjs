import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCockpitProjection } from './cockpitProjection.js';

test('operator-facing Proof Concierge uses canonical build-proof when stale reconciliation is empty but missing proof sources include build-proof', () => {
  const projection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge'],
        remainingMissingItems: [],
        nextBestAction: 'Collect build-proof',
      },
      missionEvidenceLedgerProjection: {
        acceptedProof: ['mission-console-bridge'],
        missingProof: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
      },
    },
  });

  assert.equal(projection.operatorProofConcierge.nextProof, 'build-proof');
  assert.equal(projection.operatorProofConcierge.packetKind, 'build-proof');
  assert.equal(projection.operatorProofConcierge.nextActionLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.equal(projection.operatorProofConcierge.packetText.split('\n')[0], 'Proof Packet V1');
  assert.equal(projection.operatorProofConcierge.packetText.includes('Packet Kind: build-proof'), true);
  assert.equal(projection.operatorProofConcierge.copyPacket.label, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.packetKind, 'build-proof');
  assert.equal(projection.operatorProofConcierge.copyPacket.source, 'OperatorProofConcierge.copyPacket');
});

test('Proof Concierge diagnostic primary action is not shown when contradiction is false', () => {
  const projection = buildCockpitProjection({
    runtimeStatusModel: {
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge'],
        remainingMissingItems: ['build-proof'],
      },
    },
  });

  assert.equal(projection.operatorProofConcierge.proofStateContradictionDetected, 'no');
  assert.notEqual(projection.operatorProofConcierge.nextActionLabel, 'Copy proof-state diagnostic packet');
  assert.equal(projection.operatorProofConcierge.nextActionLabel, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.label, 'Copy build-proof packet');
  assert.equal(projection.operatorProofConcierge.copyPacket.source, 'OperatorProofConcierge.copyPacket');
});

test('CockpitPanel visible Concierge primary button is wired to canonical Concierge projection copy action', () => {
  const source = readFileSync(new URL('../components/CockpitPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /data-testid="operator-proof-concierge-copy"/);
  assert.match(source, /onClick=\{handleCopyConciergePacket\}/);
  assert.match(source, /cockpitProjection\.operatorProofConcierge\.copyPacket\?\.label/);
  assert.match(source, /copyDiagnosticPacket\?\.available === 'yes' \? <details/);
  assert.doesNotMatch(source, /Copy proof-state diagnostic packet<\/button>/);
});
