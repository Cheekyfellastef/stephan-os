import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelfExplainingStephanos } from './selfExplainingStephanos.mjs';

test('G19 answers captain briefing questions from guarded projections', () => {
  const p = projectSelfExplainingStephanos({ buildOrchestration:{ phase:'BUILDING_NOW', exactNextAction:'Publish proof.' }, mergePipeline:{ phase:'PROOF', missingEvidence:['PASSED_PROOF'] }, runtimeHealth:{ overallTrafficLight:'GREEN', services:[{ serviceId:'backend', trafficLight:'GREEN' }] }, workspaceDiscovery:{ workspaces:[] }, timeline:{ events:[{ proofRefs:['node://proof'] }] } });
  assert.equal(p.readOnly, true);
  assert.equal(p.fakeProofAllowed, false);
  assert.equal(p.questions.whatProofDoIHave.includes('node://proof'), true);
  assert.match(p.questions.ifStoppedNow, /merge=PROOF/);
});
