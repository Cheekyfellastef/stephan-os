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

test('Evidence Intake Automation accepts only successful reconciled proof items', () => {
  const r = deriveEvidenceReturnIntakeProjection({
    ...base,
    missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] },
    intakeText: 'npm run stephanos:build completed successfully with exit code 0',
  });
  assert.deepEqual(r.acceptedProofItems, ['build-proof']);
  assert.deepEqual(r.rejectedProofItems, []);
  assert.equal(r.remainingMissingProofSummary, 'verify-proof | browser-proof-checklist | pr-evidence | source-pack-output');
  assert.equal(r.recommendedNextAction, 'Collect verify-proof.');
  assert.equal(r.trustedForMerge, false);
});

test('Evidence Intake Automation rejects failed build proof and keeps it missing', () => {
  const r = deriveEvidenceReturnIntakeProjection({
    ...base,
    missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof'] },
    intakeText: 'npm run stephanos:build failed with exit code 1',
  });
  assert.deepEqual(r.acceptedProofItems, []);
  assert.deepEqual(r.rejectedProofItems, ['build-proof']);
  assert.equal(r.remainingMissingProofSummary, 'build-proof | verify-proof');
  assert.equal(r.trustedForMerge, false);
});

import { classifyCommandDeckUniversalIntake, routeCommandDeckUniversalIntake } from '../stephanos-ui/src/state/commandDeckUniversalIntake.js';

test('Command Deck Universal Intake classifies and routes build proof without merge readiness', () => {
  const routed = routeCommandDeckUniversalIntake({
    text: 'npm run stephanos:build completed successfully with exit code 0.\nGenerated dist artifacts were not committed.\nFinal git status --short --branch was clean.',
    evidenceContext: { ...base, missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } },
  });
  assert.ok(routed.kinds.includes('build-proof'));
  assert.ok(routed.routedTo.includes('evidence-return-intake'));
  assert.deepEqual(routed.acceptedProofItems, ['build-proof']);
  assert.deepEqual(routed.rejectedProofItems, []);
  assert.equal(routed.evidenceReturnIntakeProjection.remainingMissingProofSummary, 'verify-proof | browser-proof-checklist | pr-evidence | source-pack-output');
  assert.equal(routed.mergeReadinessChanged, 'no');
});

test('Command Deck Universal Intake rejects failed build proof and preserves direct chat fallback', () => {
  const failed = routeCommandDeckUniversalIntake({ text: 'npm run stephanos:build failed with exit code 1', evidenceContext: { ...base, missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof'] } } });
  assert.deepEqual(failed.acceptedProofItems, []);
  assert.deepEqual(failed.rejectedProofItems, ['build-proof']);
  assert.equal(failed.evidenceReturnIntakeProjection.remainingMissingProofSummary, 'build-proof | verify-proof');
  const chat = classifyCommandDeckUniversalIntake('What is the next best action?');
  assert.deepEqual(chat.kinds, ['direct-chat']);
});

test('Command Deck Universal Intake supports multi-kind Codex result, browser checklist, PR, source-pack, and mission intent', () => {
  const multi = classifyCommandDeckUniversalIntake('Codex summary\nTesting: npm run stephanos:build pass\nnpm run stephanos:verify success');
  assert.ok(multi.kinds.includes('codex-result'));
  assert.ok(multi.kinds.includes('build-proof'));
  assert.ok(multi.kinds.includes('verify-proof'));
  assert.ok(classifyCommandDeckUniversalIntake('Browser proof checklist: Command Deck visible and no red console errors pass').kinds.includes('browser-proof-checklist'));
  assert.ok(classifyCommandDeckUniversalIntake('PR #42 checks: pass commit abcdef1').kinds.includes('pr-evidence'));
  assert.ok(classifyCommandDeckUniversalIntake('SOURCE_PACK_STATUS complete\nUSEFUL_FACTS: x').kinds.includes('source-pack-output'));
  assert.ok(routeCommandDeckUniversalIntake({ text: '/mission Implement a better proof loop' }).routedTo.includes('mission-intent-draft'));
});

import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

test('Command Deck accepted build proof propagates into mission proof reconciliation and summaries', () => {
  const projection = deriveOperatorReliefProjection({
    supportSnapshot: {
      executionMetadata: {
        command_deck_universal_intake_status: 'classified',
        command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
        command_deck_universal_intake_accepted_proof_items: 'build-proof',
        command_deck_universal_intake_rejected_proof_items: 'none',
        command_deck_universal_intake_echo: 'npm run stephanos:build completed successfully with exit code 0.',
      },
      missionConsoleDiagnostics: {
        operatorReliefBridgeProjectionKeysSeen: ['missionProofReconciliation'],
        missionConsoleInstanceCount: 1,
        missionConsoleBridgeParityStatus: 'OK',
        runtimeDiagnosticsPresent: 'yes',
        runtimeDiagnosticsDropBoundary: 'none',
        missionConsoleVisibleInstancePublished: 'yes',
        operatorReliefBridgePublished: 'yes',
      },
    },
  });
  assert.ok(projection.missionProofReconciliation.acceptedItems.includes('build-proof'));
  assert.equal(projection.missionProofReconciliation.remainingMissingItems.includes('build-proof'), false);
  assert.equal(projection.missionProofReconciliation.nextBestAction, 'Collect verify-proof.');
  assert.deepEqual(projection.evidenceReturnIntakeProjection.acceptedProofItems, ['build-proof']);
  assert.equal(projection.evidenceReturnIntakeProjection.trustedForMerge, false);
  assert.equal(projection.missionEvidenceLedgerProjection.missingProofSummary.includes('build-proof'), false);
  assert.equal(projection.packetBayProjection.missingProofSummary.includes('build-proof'), false);
});
