import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionEvidenceLedger } from './missionEvidenceLedgerModel.js';

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
