import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawDryRunPlan } from './openClawDryRunPlan.mjs';

test('dry-run plan is preview-only and non-executing',()=>{const d=buildOpenClawDryRunPlan({packetId:'p1',implementationPlan:{planId:'i1',planStatus:'ready_for_operator_review',proposedBuildChecks:['npm run stephanos:build']}});assert.equal(d.dryRunStatus,'ready_for_review');assert.equal(d.executionAllowed,false);assert.equal(d.actionExecutionEligible,false);assert.equal(d.operatorApprovalRequired,true);});
