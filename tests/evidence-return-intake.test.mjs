import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveEvidenceReturnIntakeProjection, EVIDENCE_RETURN_INTAKE_PACKET_IDS } from '../stephanos-ui/src/state/evidenceReturnIntakeModel.js';
import { derivePacketBayProjection } from '../stephanos-ui/src/state/packetBayProjection.js';

const base = { missionEvidenceLedgerProjection: { missionId: 'derived-runtime-mission', status: 'blocked', blockerCount: 1, missingProofSummary: 'local-ai-route-proof-needed' }, missionEvidenceContextSummary: { missingProofSummary: 'local-ai-route-proof-needed' }, packetBayProjection: { packets: [{ id: 'packet-evidence-review-local-ai-proof-v1b', status: 'ready-to-copy' }] } };

test('Evidence Return Intake empty intake is idle and locked', () => {
  const r = deriveEvidenceReturnIntakeProjection(base);
  assert.equal(r.status, 'idle');
  assert.equal(r.parsedResultPresent, false);
  assert.equal(r.proofObservedCount, 0);
  assert.equal(r.durableWriteAllowed, false);
  assert.equal(r.mutationAllowed, false);
  assert.equal(r.openClawMutationLocked, true);
  assert.equal(r.codexAutoDispatchAllowed, false);
});

test('local AI review without explicit proof is pending-review not observed', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Local AI read-only review: this looks safe but needs tests.' });
  assert.equal(r.parsedResultStatus, 'pending-review');
  assert.equal(r.proofObservedCount, 0);
});

test('build and verify pass text create observed proof candidates', () => {
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'npm run stephanos:build pass' }).parsedFindings[0].status, 'observed');
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'npm run stephanos:verify success' }).parsedFindings[0].evidenceType, 'verify');
});

test('browser checklist pass and red console classify safely', () => {
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Browser proof checklist: Command Deck visible, no red console errors, pass' }).parsedResultStatus, 'observed');
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Browser checklist: red console error present' }).parsedResultStatus, 'failed');
});

test('PR evidence requires explicit PR/check/commit details', () => {
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'PR #42 checks: pass commit abcdef1' }).parsedResultStatus, 'observed');
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'PR evidence looks okay but no details' }).parsedResultStatus, 'pending-review');
});

test('source pack template leakage is blocked', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'SOURCE_PACK_STATUS: complete\n<your response>\nUSEFUL_FACTS: x' });
  assert.equal(r.parsedResultStatus, 'blocked');
});

test('trust flags and packet IDs stay stable', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'packet-browser-proof-checklist-operator-v1b browser proof checklist pass no red console errors' });
  assert.equal(r.trustedForMerge, false);
  assert.equal(r.trustedForCanon, false);
  assert.equal(r.relatedPacketId, 'packet-browser-proof-checklist-operator-v1b');
  assert.deepEqual(EVIDENCE_RETURN_INTAKE_PACKET_IDS, ['packet-evidence-review-local-ai-proof-v1b','packet-browser-proof-checklist-operator-v1b','packet-pr-evidence-collection-v1b']);
});

test('Packet Bay evidence packet IDs remain stable', () => {
  const bay = derivePacketBayProjection({ missionEvidenceContextSummary: { available: true, nextRequiredEvidence: 'local-ai-route-proof-needed', missingProofSummary: 'browser proof | PR checks', missionId: 'derived-runtime-mission', missionPhase: 'verification', completeness: 'blocked' } });
  assert.ok(bay.packets.some((p) => p.id === 'packet-evidence-review-local-ai-proof-v1b'));
  assert.ok(bay.packets.some((p) => p.id === 'packet-browser-proof-checklist-operator-v1b'));
  assert.ok(bay.packets.some((p) => p.id === 'packet-pr-evidence-collection-v1b'));
});
