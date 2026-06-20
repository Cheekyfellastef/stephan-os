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
  assert.equal(routed.executiveVoice.kind, 'proof-accepted');
  assert.match(routed.executiveVoice.text, /I accepted build-proof and kept merge locked/);
  assert.match(routed.executiveVoice.text, /Next missing proof is verify-proof/);
});

test('Command Deck Universal Intake rejects failed build proof and preserves direct chat fallback', () => {
  const failed = routeCommandDeckUniversalIntake({ text: 'npm run stephanos:build failed with exit code 1', evidenceContext: { ...base, missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof'] } } });
  assert.deepEqual(failed.acceptedProofItems, []);
  assert.deepEqual(failed.rejectedProofItems, ['build-proof']);
  assert.equal(failed.evidenceReturnIntakeProjection.remainingMissingProofSummary, 'build-proof | verify-proof');
  assert.equal(failed.executiveVoice.kind, 'proof-rejected');
  assert.match(failed.executiveVoice.text, /I could not accept build-proof/);
  assert.match(failed.executiveVoice.text, /Previously accepted proof remains intact/);
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

test('Command Deck proof session accumulates accepted proof in canonical order and supersedes same-category rejection', () => {
  const failedBuild = routeCommandDeckUniversalIntake({
    text: 'npm run stephanos:build failed with exit code 1',
    evidenceContext: { ...base, missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } },
  });
  assert.deepEqual(failedBuild.cumulativeAcceptedProofItems, []);
  assert.deepEqual(failedBuild.cumulativeRejectedProofItems, ['build-proof']);

  const acceptedBuild = routeCommandDeckUniversalIntake({
    text: 'npm run stephanos:build completed successfully with exit code 0',
    evidenceContext: { ...base, cumulativeRejectedProofItems: failedBuild.cumulativeRejectedProofItems, missionProofReconciliation: { remainingMissingItems: ['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } },
  });
  assert.deepEqual(acceptedBuild.cumulativeAcceptedProofItems, ['build-proof']);
  assert.deepEqual(acceptedBuild.cumulativeRejectedProofItems, []);

  const acceptedVerify = routeCommandDeckUniversalIntake({
    text: 'npm run stephanos:verify completed successfully with exit code 0',
    evidenceContext: { ...base, cumulativeAcceptedProofItems: acceptedBuild.cumulativeAcceptedProofItems, missionProofReconciliation: { remainingMissingItems: ['verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } },
  });
  assert.deepEqual(acceptedVerify.cumulativeAcceptedProofItems, ['build-proof', 'verify-proof']);
  assert.deepEqual(acceptedVerify.cumulativeRejectedProofItems, []);
});

test('Mission reconciliation consumes cumulative Command Deck proof and keeps merge hold after build plus verify', () => {
  const projection = deriveOperatorReliefProjection({
    supportSnapshot: {
      executionMetadata: {
        command_deck_universal_intake_status: 'classified',
        command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
        command_deck_universal_intake_accepted_proof_items: 'verify-proof',
        command_deck_cumulative_accepted_proof_items: 'build-proof|verify-proof',
        command_deck_cumulative_rejected_proof_items: 'none',
        command_deck_universal_intake_echo: 'npm run stephanos:verify completed successfully with exit code 0.',
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
  assert.deepEqual(projection.missionProofReconciliation.acceptedItems, ['mission-console-bridge', 'build-proof', 'verify-proof']);
  assert.deepEqual(projection.missionProofReconciliation.remainingMissingItems, ['browser-proof-checklist', 'pr-evidence', 'source-pack-output']);
  assert.equal(projection.missionProofReconciliation.nextBestAction, 'Collect browser-proof-checklist.');
  assert.equal(projection.evidenceReturnIntakeProjection.trustedForMerge, false);
  assert.equal(projection.evidenceReturnIntakeProjection.codexAutoDispatchAllowed, false);
  assert.equal(projection.evidenceReturnIntakeProjection.openClawMutationLocked, true);
});

test('rejected browser proof does not wipe cumulative accepted build and verify in mission reconciliation', async () => {
  const { deriveOperatorReliefProjection } = await import('../stephanos-ui/src/state/operatorReliefProjection.js');
  const projection = deriveOperatorReliefProjection({ supportSnapshot: { executionMetadata: {
    command_deck_universal_intake_status: 'classified',
    command_deck_universal_intake_routed_to: 'evidence-return-intake|evidence-intake-automation',
    command_deck_universal_intake_rejected_proof_items: 'browser-proof-checklist',
    command_deck_cumulative_accepted_proof_items: 'build-proof|verify-proof',
    command_deck_cumulative_rejected_proof_items: 'browser-proof-checklist',
  }, missionConsoleDiagnostics: {
    operatorReliefBridgeProjectionKeysSeen: ['missionProofReconciliation'], missionConsoleInstanceCount: 1, missionConsoleBridgeParityStatus: 'OK', runtimeDiagnosticsPresent: 'yes', runtimeDiagnosticsDropBoundary: 'none', missionConsoleVisibleInstancePublished: 'yes', operatorReliefBridgePublished: 'yes',
  } } });
  assert.deepEqual(projection.missionProofReconciliation.acceptedItems, ['mission-console-bridge', 'build-proof', 'verify-proof']);
  assert.deepEqual(projection.missionProofReconciliation.remainingMissingItems, ['browser-proof-checklist', 'pr-evidence', 'source-pack-output']);
  assert.equal(projection.missionProofReconciliation.nextBestAction, 'Collect browser-proof-checklist.');
  assert.equal(projection.evidenceReturnIntakeProjection.codexAutoDispatchAllowed, false);
  assert.equal(projection.evidenceReturnIntakeProjection.openClawMutationLocked, true);
});

test('manual browser proof with accepted-with-known-drift caveat is accepted with caveat and advances missing proof', () => {
  const text = `Browser proof accepted: cockpit pane opens/remains visible, primary dashboard visible, Command Deck submit lifecycle works, input clears after accepted proof, submitted proof remains visible in history/echo, action routing focuses Command Deck, no command auto-run, no Codex auto-dispatch, OpenClaw remained locked, merge remained no / hold, no red runtime error overlay, no obvious broken pane/collapse behaviour. Known caveat: cockpit visual/text drift caveat accepted-with-known-drift non-blocking caveat preserved.`;
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: text, missionProofReconciliation: { remainingMissingItems: ['browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } });
  assert.deepEqual(r.acceptedProofItems, ['browser-proof-checklist']);
  assert.deepEqual(r.rejectedProofItems, []);
  assert.equal(r.browserProofIntakeStatus, 'accepted');
  assert.equal(r.browserProofKnownCaveatPresent, true);
  assert.equal(r.browserProofCaveatBlocking, false);
  assert.equal(r.browserProofAcceptedWithCaveat, true);
  assert.equal(r.browserProofRejectionReason, 'none');
  assert.equal(r.remainingMissingProofSummary, 'pr-evidence | source-pack-output');
});

test('explicit blocking browser proof language rejects browser proof', () => {
  const r = deriveEvidenceReturnIntakeProjection({ ...base, intakeText: 'Browser proof failed: pane did not open and command auto-ran.', missionProofReconciliation: { remainingMissingItems: ['browser-proof-checklist', 'pr-evidence'] } });
  assert.deepEqual(r.acceptedProofItems, []);
  assert.deepEqual(r.rejectedProofItems, ['browser-proof-checklist']);
  assert.equal(r.browserProofIntakeStatus, 'rejected');
  assert.notEqual(r.browserProofRejectionReason, 'none');
});

test('same-category later accepted browser proof supersedes prior browser rejection and keeps merge hold', async () => {
  const { routeCommandDeckUniversalIntake } = await import('../stephanos-ui/src/state/commandDeckUniversalIntake.js');
  const r = routeCommandDeckUniversalIntake({ text: 'Browser proof accepted with caveat: command deck visible, no command auto-run, no Codex auto-dispatch, OpenClaw remained locked, merge remained hold, no red runtime error overlay. known caveat accepted-with-known-drift non-blocking caveat preserved.', evidenceContext: { ...base, cumulativeAcceptedProofItems: ['build-proof', 'verify-proof'], cumulativeRejectedProofItems: ['browser-proof-checklist'], missionProofReconciliation: { remainingMissingItems: ['browser-proof-checklist', 'pr-evidence', 'source-pack-output'] } } });
  assert.deepEqual(r.cumulativeAcceptedProofItems, ['build-proof', 'verify-proof', 'browser-proof-checklist']);
  assert.deepEqual(r.cumulativeRejectedProofItems, []);
  assert.equal(r.mergeReadinessChanged, 'no');
  assert.equal(r.codexAutoDispatchAllowed, false);
  assert.equal(r.openClawMutationLocked, true);
});

test('Operator Proof Concierge proof-state diagnostic routes to proof-state-review without evidence mutation', () => {
  const packet = `Proof-state diagnostic packet.

Contradiction detected:
- Merge is hold but missing proof is none; reconcile mission proof state, merge blockers, PR evidence, and source-pack output.

Operator diagnostic checklist:
- Keep merge readiness as no / hold.`;
  const routed = routeCommandDeckUniversalIntake({
    text: packet,
    evidenceContext: {
      ...base,
      cumulativeAcceptedProofItems: ['build-proof', 'verify-proof'],
      cumulativeRejectedProofItems: ['browser-proof-checklist'],
      missionProofReconciliation: {
        acceptedItems: ['mission-console-bridge', 'build-proof', 'verify-proof'],
        remainingMissingItems: ['browser-proof-checklist', 'pr-evidence', 'source-pack-output'],
      },
    },
  });
  assert.deepEqual(routed.kinds, ['operator-proof-concierge-diagnostic', 'proof-state-review', 'operator-guidance', 'operator-hold']);
  assert.ok(routed.routedTo.includes('proof-state-review'));
  assert.equal(routed.routedTo.includes('evidence-return-intake'), false);
  assert.equal(routed.routedTo.includes('packet-bay-source-pack-intake'), false);
  assert.equal(routed.kinds.includes('pr-evidence'), false);
  assert.equal(routed.kinds.includes('source-pack-output'), false);
  assert.deepEqual(routed.acceptedProofItems, []);
  assert.deepEqual(routed.rejectedProofItems, []);
  assert.deepEqual(routed.cumulativeAcceptedProofItems, ['build-proof', 'verify-proof']);
  assert.deepEqual(routed.cumulativeRejectedProofItems, ['browser-proof-checklist']);
  assert.equal(routed.evidenceReturnIntakeProjection, null);
  assert.equal(routed.diagnosticProjection.activeContradiction, 'no');
  assert.equal(routed.executiveVoice.kind, 'diagnostic-stale');
  assert.match(routed.diagnosticProjection.assistantResponse, /I reviewed the proof-state diagnostic packet/i);
  assert.match(routed.diagnosticProjection.assistantResponse, /live canonical state has a valid next move: browser-proof-checklist is missing/i);
  assert.doesNotMatch(routed.diagnosticProjection.assistantResponse.split('\n').slice(0, 4).join('\n'), /Current canonical proof state:/i);
  assert.match(routed.diagnosticProjection.assistantResponse, /No commands were run/);
  assert.equal(routed.mutationAllowed, false);
  assert.equal(routed.codexAutoDispatchAllowed, false);
  assert.equal(routed.openClawMutationLocked, true);
  assert.equal(routed.mergeReadinessChanged, 'no');
});

test('Operator Proof Concierge active contradiction response explains conflict and keeps safety gates closed', () => {
  const routed = routeCommandDeckUniversalIntake({
    text: 'packet kind: proof-state-diagnostic\nMerge is hold but missing proof is none',
    evidenceContext: {
      ...base,
      missionProofReconciliation: { acceptedItems: ['mission-console-bridge', 'build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output'], remainingMissingItems: [] },
      mergeSafety: 'no / hold',
    },
  });
  assert.equal(routed.diagnosticProjection.activeContradiction, 'yes');
  assert.equal(routed.executiveVoice.kind, 'diagnostic-active-contradiction');
  assert.match(routed.diagnosticProjection.assistantResponse, /proof engine and merge gate disagree/i);
  assert.match(routed.diagnosticProjection.assistantResponse, /I am keeping merge locked/i);
  assert.match(routed.diagnosticProjection.assistantResponse, /Prepared repair request:/);
  assert.match(routed.diagnosticProjection.assistantResponse, /No commands were run/);
  assert.deepEqual(routed.acceptedProofItems, []);
  assert.deepEqual(routed.rejectedProofItems, []);
  assert.equal(routed.codexAutoDispatchAllowed, false);
  assert.equal(routed.openClawMutationLocked, true);
  assert.equal(routed.mergeReadinessChanged, 'no');
});
