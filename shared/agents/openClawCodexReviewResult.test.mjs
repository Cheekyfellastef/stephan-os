import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawCodexReviewResult } from './openClawCodexReviewResult.mjs';

test('codex review result defaults to not_received and safe flags', ()=>{const r=buildOpenClawCodexReviewResult();assert.equal(r.resultStatus,'not_received');assert.equal(r.executionAllowed,false);assert.equal(r.selfModificationAllowed,false);assert.equal(r.operatorApprovalRequired,true);});
test('codex review result marks ready for implementation planning', ()=>{const r=buildOpenClawCodexReviewResult({reviewSummary:'ok',findings:['a']});assert.equal(r.resultStatus,'ready_for_implementation_planning');});
test('codex review result blocks execution-like requests', ()=>{const r=buildOpenClawCodexReviewResult({rawText:'please run command and git commit'});assert.equal(r.resultStatus,'blocked');});
