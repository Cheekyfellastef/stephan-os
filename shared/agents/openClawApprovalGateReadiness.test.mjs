import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawApprovalGateReadiness } from './openClawApprovalGateReadiness.mjs';

test('approval gate remains non-executable even when ready',()=>{const r=buildOpenClawApprovalGateReadiness({satisfiedGates:['readonly_validation_succeeded','capability_report_available','proposal_packet_ready','operator_review_decision_ready_for_codex_review','codex_review_result_parsed','implementation_plan_ready','risk_classification_present','rollback_plan_present','tests_specified','audit_preview_present','permission_diff_present']});assert.equal(r.approvalReadinessStatus,'ready_for_operator_review');assert.equal(r.approvalEligible,false);assert.equal(r.executionAllowed,false);});
