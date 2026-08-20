import { createHash } from 'node:crypto';

import {
  CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA,
  currentTruthObservationRecordIsPersistableV1,
} from './codexDependencyCurrentTruthObservationV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const CODEX_DEPENDENCY_CURRENT_TRUTH_PERSISTENCE_SCHEMA = 'stephanos.codex-dependency-current-truth-persistence-plan.v1';
export const CURRENT_TRUTH_PERSISTENCE_STATE = Object.freeze({
  READY: 'CURRENT_TRUTH_PERSISTENCE_READY',
  BLOCKED: 'CURRENT_TRUTH_PERSISTENCE_BLOCKED',
});

const HEX64 = /^[0-9a-f]{64}$/;

function text(value) { return String(value ?? '').trim(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function authorityProjection() {
  return Object.freeze({
    writerExecutionAllowed:false,
    sourceMutation:false,
    dispatch:false,
    providerQualification:false,
    merge:false,
    deployment:false,
    runtimeMutation:false,
    openClawMutation:false,
    spendingOrAccount:false,
    leaseSeizure:false,
  });
}
function dataOnly(value, path='value', depth=0) {
  if (depth > 16) throw new Error(`${path} exceeds maximum depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a plain array`);
    for (let index=0; index<value.length; index+=1) if (!Object.hasOwn(value,index)) throw new Error(`${path} must not be sparse`);
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^\d+$/.test(key) || Number(key) >= value.length) throw new Error(`${path} contains a non-index array property`);
    }
    return value.map((entry,index)=>dataOnly(entry,`${path}[${index}]`,depth+1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path} must contain data-only plain objects`);
  const output={};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${path} contains a symbol key`);
    if (['__proto__','prototype','constructor'].includes(key)) throw new Error(`${path} contains a forbidden key`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor,'value')) throw new Error(`${path}.${key} must be a data property`);
    output[key]=dataOnly(descriptor.value,`${path}.${key}`,depth+1);
  }
  return output;
}
function blocked(reasons) {
  return Object.freeze({ schema:CODEX_DEPENDENCY_CURRENT_TRUTH_PERSISTENCE_SCHEMA,
    state:CURRENT_TRUTH_PERSISTENCE_STATE.BLOCKED, ready:false,
    reasons:Object.freeze([...new Set(reasons)]), writes:Object.freeze([]), authority:authorityProjection() });
}
function exactObservationBindings(observation) {
  const record=observation.record;
  const report=observation.report;
  if (!record || !report) return ['observation-record-or-report-missing'];
  const reasons=[];
  if (observation.repository !== record.repository) reasons.push('repository-binding-mismatch');
  if (observation.sourceBranch !== record.sourceBranch) reasons.push('source-branch-binding-mismatch');
  if (text(observation.sourceHead).toLowerCase() !== text(record.sourceHead).toLowerCase()) reasons.push('source-head-binding-mismatch');
  if (observation.observedAtUtc !== record.observedAtUtc) reasons.push('observation-time-binding-mismatch');
  if (record.reportState !== report.reportState) reasons.push('report-state-binding-mismatch');
  if (record.admissionReady !== (report.admissionReady === true)) reasons.push('admission-ready-binding-mismatch');
  for (const field of ['criticalGapCount','unownedCriticalGapCount','unclassifiedReferenceCount']) {
    if (record[field] !== report[field]) reasons.push(`${field}-binding-mismatch`);
  }
  const digest=sha256(JSON.stringify(report));
  if (record.reportDigest !== digest) reasons.push('report-digest-binding-mismatch');
  return reasons;
}

export function planCodexDependencyCurrentTruthPersistenceV1(input={}) {
  let envelope;
  try { envelope=dataOnly(input,'input'); } catch (error) { return blocked([`input-invalid:${error.message}`]); }
  if (Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope,'observation')) return blocked(['input-shape-invalid']);
  const observation=envelope.observation;
  if (observation?.schema !== CODEX_DEPENDENCY_CURRENT_TRUTH_OBSERVATION_SCHEMA) return blocked(['observation-schema-invalid']);
  if (!currentTruthObservationRecordIsPersistableV1(observation.record)) return blocked(['observation-record-not-persistable']);
  const bindingErrors=exactObservationBindings(observation);
  if (bindingErrors.length) return blocked(bindingErrors);

  const record=observation.record;
  if (!HEX64.test(text(record.observationId)) || !HEX64.test(text(record.reportDigest))) return blocked(['observation-digest-identity-invalid']);
  const proofRefs=[
    `proofs/provider-independence/observations/${record.observationId}`,
    `proofs/provider-independence/reports/${record.reportDigest}`,
  ];
  const summary=`Provider-independence current truth ${record.reportState}; critical gaps ${record.criticalGapCount}; unowned critical gaps ${record.unownedCriticalGapCount}; unclassified references ${record.unclassifiedReferenceCount}.`;
  const statusRecord=createSharedWorkspaceStatusRecord({
    statusId:'provider-independence-current', participantId:'provider-independence-observer',
    timestampUtc:record.observedAtUtc, status:record.reportState, summary, proofRefs,
  });
  const proofRecord=createSharedWorkspaceProofRecord({
    proofId:`pi-${record.observationId.slice(0,32)}`, participantId:'provider-independence-observer',
    timestampUtc:record.observedAtUtc, correlationId:`pi-${record.observationId.slice(0,32)}`,
    relatedIssue:'#1899', status:record.reportState, summary,
    refs:[`main:${record.sourceHead}`,`observation:${record.observationId}`,`report:${record.reportDigest}`], proofRefs,
  });
  const options={ nowMs:Date.parse(record.observedAtUtc), staleAfterMs:Number.MAX_SAFE_INTEGER };
  const statusValidation=validateSharedWorkspaceRecord(statusRecord,options);
  const proofValidation=validateSharedWorkspaceRecord(proofRecord,options);
  if (!statusValidation.valid || !proofValidation.valid) {
    return blocked(['canonical-shared-workspace-record-validation-failed',...statusValidation.errors,...proofValidation.errors]);
  }

  const writes=Object.freeze([
    Object.freeze({ writer:'writeAtomicJson', mode:'UPSERT_CURRENT', segments:Object.freeze(['status','provider-independence-current.json']), record:Object.freeze(statusRecord) }),
    Object.freeze({ writer:'writeAtomicJson', mode:'IMMUTABLE_BY_OBSERVATION_ID', idempotencyKey:record.observationId, segments:Object.freeze(['proof',`${record.observationId}.json`]), record:Object.freeze(proofRecord) }),
  ]);
  return Object.freeze({ schema:CODEX_DEPENDENCY_CURRENT_TRUTH_PERSISTENCE_SCHEMA,
    state:CURRENT_TRUTH_PERSISTENCE_STATE.READY, ready:true, reasons:Object.freeze([]),
    observationId:record.observationId, reportDigest:record.reportDigest,
    reportState:record.reportState, admissionReady:record.admissionReady,
    writes, authority:authorityProjection() });
}
