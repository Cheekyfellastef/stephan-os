import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveEvidenceReturnIntakeProjection, EVIDENCE_RETURN_INTAKE_PACKET_IDS } from '../stephanos-ui/src/state/evidenceReturnIntakeModel.js';
import { derivePacketBayProjection } from '../stephanos-ui/src/state/packetBayProjection.js';

const base = { missionEvidenceLedgerProjection: { missionId: 'derived-runtime-mission', status: 'blocked', blockerCount: 1, missingProofSummary: 'local-ai-route-proof-needed' }, missionEvidenceContextSummary: { missingProofSummary: 'local-ai-route-proof-needed' }, packetBayProjection: { packets: [{ id: 'packet-evidence-review-local-ai-proof-v1b', status: 'ready-to-copy' }] } };

test('deriveEvidenceReturnIntakeProjection exists and is pure/deterministic', () => {
  assert.equal(typeof deriveEvidenceReturnIntakeProjection, 'function');
  const input = { ...base, intakeText: 'npm run stephanos:build pass' };
  assert.deepEqual(deriveEvidenceReturnIntakeProjection(input), deriveEvidenceReturnIntakeProjection(input));
});

test('Evidence Return Intake empty intake is idle/ready and locked', () => {
  const r = deriveEvidenceReturnIntakeProjection(base);
  assert.equal(r.status, 'idle');
  assert.equal(r.intakeAvailable, true);
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
  const build = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'npm run stephanos:build pass' });
  const verify = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'npm run stephanos:verify success' });
  assert.deepEqual(build.parsedFindings[0], {
    evidenceType: 'build',
    status: 'observed',
    summary: 'Explicit build proof text is present.',
    confidence: 'high',
  });
  assert.deepEqual(verify.parsedFindings[0], {
    evidenceType: 'verify',
    status: 'observed',
    summary: 'Explicit verify proof text is present.',
    confidence: 'high',
  });
});

test('browser checklist pass creates observed browser proof candidate', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Browser proof checklist: Command Deck visible, no red console errors, pass' });
  assert.equal(r.parsedResultStatus, 'observed');
  assert.equal(r.parsedFindings[0].evidenceType, 'browser-proof');
  assert.equal(r.parsedFindings[0].status, 'observed');
});

test('browser red console/error text creates failed proof candidate', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Browser checklist: red console error present' });
  assert.equal(r.parsedResultStatus, 'failed');
  assert.equal(r.parsedFindings[0].evidenceType, 'browser-proof');
  assert.equal(r.parsedFindings[0].status, 'failed');
});

test('PR evidence requires explicit PR/check/commit details', () => {
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'PR #42 checks: pass commit abcdef1' }).parsedResultStatus, 'observed');
  assert.equal(deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'PR evidence looks okay but no details' }).parsedResultStatus, 'pending-review');
});

test('source-pack template leakage is blocked/failed', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'SOURCE_PACK_STATUS: complete\n<your response>\nUSEFUL_FACTS: x' });
  assert.equal(r.parsedResultStatus, 'blocked');
  assert.equal(r.parsedFindings[0].status, 'blocked');
});

test('trust flags and related packet IDs stay stable without full explicit proof', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'packet-browser-proof-checklist-operator-v1b browser proof checklist pass no red console errors' });
  assert.equal(r.trustedForMerge, false);
  assert.equal(r.trustedForCanon, false);
  assert.equal(r.relatedPacketId, 'packet-browser-proof-checklist-operator-v1b');
  assert.deepEqual(EVIDENCE_RETURN_INTAKE_PACKET_IDS, ['packet-evidence-review-local-ai-proof-v1b','packet-browser-proof-checklist-operator-v1b','packet-pr-evidence-collection-v1b']);
});

test('trustedForMerge remains false unless all required proof exists and canon remains false without explicit canon proof', () => {
  const r = deriveEvidenceReturnIntakeProjection({
    ...base,
    missionEvidenceLedgerProjection: { missionId: 'derived-runtime-mission', status: 'ready', blockerCount: 0, missingProofSummary: 'none' },
    intakeText: 'npm run stephanos:build pass\nnpm run stephanos:verify pass\nBrowser proof checklist pass no red console errors\nPR #42 checks: pass commit abcdef1',
  });
  assert.equal(r.proofObservedCount, 4);
  assert.equal(r.trustedForMerge, false);
  assert.equal(r.trustedForCanon, false);
});

test('Packet Bay evidence packet IDs remain stable', () => {
  const bay = derivePacketBayProjection({ missionEvidenceContextSummary: { available: true, nextRequiredEvidence: 'local-ai-route-proof-needed', missingProofSummary: 'browser proof | PR checks', missionId: 'derived-runtime-mission', missionPhase: 'verification', completeness: 'blocked' } });
  assert.ok(bay.packets.some((p) => p.id === 'packet-evidence-review-local-ai-proof-v1b'));
  assert.ok(bay.packets.some((p) => p.id === 'packet-browser-proof-checklist-operator-v1b'));
  assert.ok(bay.packets.some((p) => p.id === 'packet-pr-evidence-collection-v1b'));
});
