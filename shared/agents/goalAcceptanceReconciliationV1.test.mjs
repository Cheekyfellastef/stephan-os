import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileGoalAcceptance} from './goalAcceptanceReconciliationV1.mjs';
test('parked goal cannot be declared complete without evidence',()=>{const r=reconcileGoalAcceptance({goalNumber:1646,mission:{missionId:'critical-1646-elastic-goal',currentPhase:'BLOCKED'},sourceHead:'a'.repeat(40)});assert.equal(r.completionAllowed,false);assert.ok(r.missing.length>0)});
