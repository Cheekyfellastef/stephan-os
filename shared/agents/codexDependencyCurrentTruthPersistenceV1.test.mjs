import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA, CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA } from './codexDependencyCurrentTruthObservationV1.mjs';
import { CURRENT_TRUTH_PERSISTENCE_STATE, planCodexDependencyCurrentTruthPersistenceV1 } from './codexDependencyCurrentTruthPersistenceV1.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const sourceHead='a8a513eaf65922eee2311b10bb3c934c45f8ef47';
const observedAtUtc='2026-08-20T08:30:00.000Z';
function digest(value){ return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function authority(){ return { sourceMutation:false, dispatch:false, providerQualification:false, merge:false, deployment:false, runtimeMutation:false, openClawMutation:false, spendingOrAccount:false, leaseSeizure:false }; }
function observation(overrides={}) {
  const report={ reportState:'CURRENT_PROVIDER_INDEPENDENT', admissionReady:true, criticalGapCount:0, unownedCriticalGapCount:0, unclassifiedReferenceCount:0, authority:authority(), ...(overrides.report||{}) };
  const record={ schema:CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_RECORD_SCHEMA, observationId:'1'.repeat(64), reportDigest:digest(report), repository:'Cheekyfellastef/stephan-os', sourceBranch:'main', sourceHead, observedAtUtc, observerId:'provider-independence-observer', observerExecutionId:'observer-run-1', observationComplete:true, coverageRefs:['proofs/provider-independence/coverage/current'], reportState:report.reportState, admissionReady:report.admissionReady===true, criticalGapCount:report.criticalGapCount, unownedCriticalGapCount:report.unownedCriticalGapCount, unclassifiedReferenceCount:report.unclassifiedReferenceCount, authority:authority(), ...(overrides.record||{}) };
  return { schema:CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA, repository:record.repository, sourceBranch:record.sourceBranch, sourceHead:record.sourceHead, observedAtUtc:record.observedAtUtc, observationComplete:record.observationComplete, report, record, authority:authority(), ...(overrides.top||{}) };
}

test('plans canonical current status plus observation-addressed proof writes',()=>{
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:observation()});
  assert.equal(out.state,CURRENT_TRUTH_PERSISTENCE_STATE.READY);
  assert.equal(out.writes.length,2);
  assert.deepEqual(out.writes[0].segments,['status','provider-independence-current.json']);
  assert.deepEqual(out.writes[1].segments,['proof',`${'1'.repeat(64)}.json`]);
  assert.equal(out.writes[1].idempotencyKey,'1'.repeat(64));
});
test('both planned records pass the existing canonical Shared Workspace validator',()=>{
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:observation()});
  for (const write of out.writes) assert.equal(validateSharedWorkspaceRecord(write.record,{nowMs:Date.parse(observedAtUtc),staleAfterMs:Number.MAX_SAFE_INTEGER}).valid,true);
});
test('real parity gaps are persisted as truth rather than hidden',()=>{
  const obs=observation({report:{reportState:'CURRENT_PARITY_GAPS',admissionReady:false,criticalGapCount:2,unownedCriticalGapCount:1}});
  obs.record={...obs.record,reportDigest:digest(obs.report),reportState:obs.report.reportState,admissionReady:false,criticalGapCount:2,unownedCriticalGapCount:1};
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:obs});
  assert.equal(out.state,CURRENT_TRUTH_PERSISTENCE_STATE.READY);
  assert.equal(out.reportState,'CURRENT_PARITY_GAPS');
  assert.equal(out.admissionReady,false);
});
test('an incomplete but structurally persistable observation remains durable blocked truth',()=>{
  const obs=observation({record:{observationComplete:false},top:{observationComplete:false}});
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:obs});
  assert.equal(out.state,CURRENT_TRUTH_PERSISTENCE_STATE.READY);
});
test('report mutation after observation creation fails the digest binding',()=>{
  const obs=observation(); obs.report={...obs.report,criticalGapCount:1};
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:obs});
  assert.equal(out.state,CURRENT_TRUTH_PERSISTENCE_STATE.BLOCKED);
  assert.ok(out.reasons.includes('criticalGapCount-binding-mismatch') || out.reasons.includes('report-digest-binding-mismatch'));
});
test('source identity drift between observation and persistable record fails closed',()=>{
  const obs=observation(); obs.sourceHead='b'.repeat(40);
  const out=planCodexDependencyCurrentTruthPersistenceV1({observation:obs});
  assert.equal(out.state,CURRENT_TRUTH_PERSISTENCE_STATE.BLOCKED);
  assert.ok(out.reasons.includes('source-head-binding-mismatch'));
});
test('the same observation deterministically targets the same status and evidence paths',()=>{
  const left=planCodexDependencyCurrentTruthPersistenceV1({observation:observation()});
  const right=planCodexDependencyCurrentTruthPersistenceV1({observation:observation()});
  assert.deepEqual(left,right);
});
test('widened or hostile input fails closed and grants no writer or mutation authority',()=>{
  const widened=planCodexDependencyCurrentTruthPersistenceV1({observation:observation(),execute:true});
  assert.equal(widened.state,CURRENT_TRUTH_PERSISTENCE_STATE.BLOCKED);
  assert.equal(widened.authority.writerExecutionAllowed,false);
  assert.equal(widened.authority.sourceMutation,false);
  assert.equal(widened.authority.merge,false);

  const hostile={observation:observation()};
  Object.defineProperty(hostile.observation,'record',{get(){return {};},enumerable:true});
  const blocked=planCodexDependencyCurrentTruthPersistenceV1(hostile);
  assert.equal(blocked.state,CURRENT_TRUTH_PERSISTENCE_STATE.BLOCKED);
});
