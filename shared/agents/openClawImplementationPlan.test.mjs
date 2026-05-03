import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawImplementationPlan } from './openClawImplementationPlan.mjs';

test('implementation plan stays unavailable without ready review',()=>{const p=buildOpenClawImplementationPlan();assert.equal(p.planStatus,'unavailable');assert.equal(p.executionAllowed,false);assert.equal(p.actionExecutionEligible,false);});
test('implementation plan ready from review result',()=>{const p=buildOpenClawImplementationPlan({packetId:'p1',reviewResult:{resultId:'r1',resultStatus:'ready_for_implementation_planning',requiredTests:['node --test']}});assert.equal(p.planStatus,'ready_for_operator_review');assert.equal(p.operatorApprovalRequired,true);});
