import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionEvidenceLedger, deriveMissionEvidenceLedgerProjection } from './missionEvidenceLedgerModel.js';

test('ledger builds deterministic entries from mission spec and attached systems', () => {
  const missionSpec = { missionId:'m1', generatedAt:'2026-05-01T00:00:00.000Z', rawIntent:'Do x', missionMemoryInfluence:[{id:'a'}], repoArchitectureContext:{affectedSubsystems:['mission-console']}, openClawDelegation:{}, finishAuthority:{finishAuthorityStatus:'not_granted', mergeAuthorityIncluded:false}, codexPrompt:'prompt', taskFinisherPlan:{} };
  const ledger = buildMissionEvidenceLedger({ missionSpec, prEvidenceConnector:{parsed:{}}, verificationReturnText:'ran tests', verificationJudge:{judgment:'needs_fix', blockers:['fail'], warnings:[]}, taskFinisherPlan:{}, memoryLibrarianQueue:{queue:[{id:'c1'}]} });
  const types = ledger.entries.map((e)=>e.eventType);
  ['intent_captured','mission_spec_generated','memory_context_applied','architecture_context_applied','openclaw_delegation_previewed','finish_authority_assessed','codex_handoff_generated','pr_evidence_parsed','verification_return_received','verification_judged','task_finisher_planned','memory_librarian_candidates_created','operator_decision_required'].forEach((t)=>assert.equal(types.includes(t), true));
  assert.equal(ledger.summary.blockerCount > 0, true);
  assert.equal(ledger.summary.nextRequiredEvidence, 'operator_decision_required');
});

test('missing verification return lowers completeness and sets deterministic next evidence', () => {
  const ledger = buildMissionEvidenceLedger({ missionSpec: { missionId:'m2', generatedAt:'2026-05-01T00:00:00.000Z', rawIntent:'Do y', finishAuthority:{mergeAuthorityIncluded:false} }, prEvidenceConnector:{parsed:{}} });
  assert.equal(ledger.summary.evidenceCompleteness, 'partial');
  assert.equal(ledger.summary.nextRequiredEvidence, 'verification_return_received');
  assert.match(ledger.summary.missionReadyNarrative, /PR evidence supplied, but verification return is missing/);
});


test('Mission Evidence Ledger V1A empty truth is unavailable and write/mutation locked', () => {
  const ledger = deriveMissionEvidenceLedgerProjection({});
  assert.equal(ledger.status, 'unavailable');
  assert.equal(ledger.entryCount, 0);
  assert.equal(ledger.durableWriteAllowed, false);
  assert.equal(ledger.mutationAllowed, false);
  assert.equal(ledger.openClawMutationLocked, true);
  assert.equal(ledger.codexAutoDispatchAllowed, false);
});

test('Mission Evidence Ledger V1A derives bounded entries and stable ids from runtime truth', () => {
  const input = {
    projectAwarenessProjection: { status: 'blocked', missionId: 'm-v1a', title: 'Ledger V1A', phase: 'verification', blockers: ['missing proof'] },
    agentRealityLoopProjection: { status: 'blocked', blockers: ['browser proof missing'] },
    packetBayProjection: { packets: [{ id: 'packet-local-ai-proof', status: 'ready', target: 'local-ai' }] },
    builderMeshProjection: { recommendedBuilder: 'local-ai', builderWorkbenchProjection: { openClawWorkspaceHygiene: { status: 'clean' }, openClawSourcePackRunner: { sourcePackStatus: 'needs-output' } } },
    missionVerification: {},
    uiRealityTruth: { status: 'OK' },
    prEvidence: { evidenceTruthStatus: 'unknown-disabled' },
  };
  const first = deriveMissionEvidenceLedgerProjection(input);
  const second = deriveMissionEvidenceLedgerProjection(input);
  const types = first.entries.map((entry) => entry.type);
  ['mission-state-blocker','arl-blocker','packet-ready','local-ai-route-proof-needed','missing-build-proof','missing-verify-proof','ui-reality-observed','openclaw-hygiene-clean','source-pack-output-missing','pr-evidence-missing'].forEach((type) => assert.equal(types.includes(type), true));
  assert.equal(first.trustedForMerge, false);
  assert.equal(first.trustedForCanon, false);
  assert.deepEqual(first.entries.map((entry) => entry.id), second.entries.map((entry) => entry.id));
});
