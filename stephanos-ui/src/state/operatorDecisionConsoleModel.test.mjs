import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperatorDecisionQueue } from './operatorDecisionConsoleModel.js';

test('verification blockers create request_codex_fix decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, verificationJudge:{blockers:2} });
  assert.equal(result.decisions.some((d) => d.decisionType === 'request_codex_fix'), true);
});

test('proof pending creates review_proof_of_done decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, verificationJudge:{proofOfDoneStatus:'pending'} });
  assert.equal(result.decisions.some((d) => d.decisionType === 'review_proof_of_done'), true);
});

test('memory approval candidates create approval decisions', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, memoryLibrarianQueue:{queue:[{requiresOperatorApproval:true,memoryCandidateType:'architecture_canon_candidate',summary:'x'}]} });
  assert.equal(result.summary.memoryApprovalRequired, true);
});

test('merge-ready without authority requires merge decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, verificationJudge:{mergeReadyCandidate:true}, finishAuthority:{mergeAuthorityIncluded:false} });
  assert.equal(result.summary.operatorMergeDecisionRequired, true);
});

test('pr merged without authority creates warning decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, prEvidenceIntake:{mergedWithoutRecordedAuthority:true} });
  assert.equal(result.decisions.some((d) => d.decisionType === 'review_pr_evidence_warning'), true);
});

test('openclaw delegation creates review decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, openClawDelegation:{authorityLevel:'research_and_plan'} });
  assert.equal(result.decisions.some((d) => d.decisionType === 'review_openclaw_delegation'), true);
});

test('capability gap creates review decision', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'}, memoryLibrarianQueue:{counts:{capabilityGaps:1}} });
  assert.equal(result.decisions.some((d) => d.decisionType === 'review_capability_gap'), true);
});

test('no action appears when nothing pending', () => {
  const result = buildOperatorDecisionQueue({ missionSpec:{missionId:'m1'} });
  assert.equal(result.decisions[0].decisionType, 'no_action_required');
});
