import { createHash } from 'node:crypto';

import {
  toSharedWorkspaceExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceReceiptRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
} from './openClawProviderPoolQualificationV1.mjs';

export const OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA = 'stephanos.openclaw-task-class-promotion-candidate.v1';
export const OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION = 'OPENCLAW_TASK_CLASS_PRODUCTION_ELIGIBLE_CANDIDATE';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const ISSUE_NUMBER = 1725;
const MAX_QUALIFICATION_LIFETIME_MS = 15 * 60 * 1000;
const MAX_EVIDENCE_NODES = 512;
const MAX_EVIDENCE_DEPTH = 8;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SAFE_PROVIDER_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;
const SAFE_GATEWAY_ID = /^openclaw-gateway:[1-9][0-9]*$/;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;

const MESSAGE_KEYS = Object.freeze([
  'schemaVersion', 'kind', 'messageId', 'participantId', 'timestampUtc', 'correlationId',
  'relatedIssue', 'relatedPr', 'proofRefs', 'channel', 'summary', 'body',
]);

const OC1_RESULT_KEYS = Object.freeze([
  'schemaVersion', 'missionId', 'goalId', 'taskId', 'taskClass', 'repository',
  'requestedSourceHead', 'observedSourceHead', 'exactInputIdentity', 'provider',
  'providerInstance', 'providerIdentitySource', 'providerVersion', 'authorityUsed',
  'commandsOrTestIds', 'artifacts', 'dirt', 'packageScripts', 'relevantFiles',
  'startedAtUtc', 'completedAtUtc', 'blockers', 'finalVerdict',
  'sourceMutationPerformed', 'arbitraryShellAllowed', 'arbitraryCommandAllowed',
  'networkMutationAllowed', 'mergeAllowed', 'deploymentAllowed', 'selfQualificationAllowed',
  'exactOutputIdentity',
]);

const OC2_RESULT_KEYS = Object.freeze([
  'schemaVersion', 'missionId', 'goalId', 'taskId', 'taskClass', 'repository',
  'requestedSourceHead', 'observedSourceHead', 'exactInputIdentity', 'provider',
  'providerInstance', 'providerVersion', 'operation', 'testResults', 'changedFiles',
  'sourceMutationPerformed', 'arbitraryShellAllowed', 'arbitraryCommandAllowed',
  'mergeAllowed', 'deploymentAllowed', 'selfQualificationAllowed', 'finalVerdict',
  'completedAtUtc', 'exactOutputIdentity',
]);

const OC1_AUTHORITY_KEYS = Object.freeze([
  'grantId', 'adapter', 'canonicalMissionWorkerClaim', 'boundedActionCount',
  'mergeAuthority', 'deploymentAuthority', 'sourceMutationAuthority', 'selfQualificationAuthority',
]);

const TASK_CLASS_POLICY = Object.freeze({
  OC1_REPOSITORY_SCOUT: Object.freeze({
    resultSchema: 'stephanos.openclaw-oc1-provider-result.v1',
    resultKeys: OC1_RESULT_KEYS,
    finalVerdict: 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED',
  }),
  OC2_DETERMINISTIC_TEST_BUILD: Object.freeze({
    resultSchema: 'stephanos.openclaw-oc2-provider-result.v1',
    resultKeys: OC2_RESULT_KEYS,
    finalVerdict: 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED',
  }),
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) return false;
  const sorted = actual.sort();
  const wanted = [...expected].sort();
  return sorted.length === wanted.length && sorted.every((key, index) => key === wanted[index]);
}

function inertEvidenceSnapshot(value, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_EVIDENCE_NODES || depth > MAX_EVIDENCE_DEPTH) throw new TypeError('provider-evidence-bounds-exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('provider-evidence-number-invalid');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('provider-evidence-type-invalid');
  if (state.visiting.has(value)) throw new TypeError('provider-evidence-cycle');

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('provider-evidence-prototype-invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('provider-evidence-symbol-key');
  if (isArray) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 128) throw new TypeError('provider-evidence-array-length-invalid');
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
      throw new TypeError('provider-evidence-array-shape-invalid');
    }
  }

  const snapshot = isArray ? [] : {};
  state.visiting.add(value);
  for (const key of keys) {
    if (isArray && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new TypeError('provider-evidence-accessor-or-hidden-field');
    }
    const child = inertEvidenceSnapshot(descriptor.value, state, depth + 1);
    if (isArray) snapshot[Number(key)] = child;
    else snapshot[key] = child;
  }
  state.visiting.delete(value);
  return Object.freeze(snapshot);
}

function evidenceSnapshot(value) {
  try {
    return inertEvidenceSnapshot(value, { nodes: 0, visiting: new WeakSet() });
  } catch {
    return null;
  }
}

function uniqueProofRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return null;
  const refs = value.map(text);
  if (refs.some((ref) => !SAFE_PROOF_REF.test(ref) || ref.includes('..'))) return null;
  return refs.length === new Set(refs).size ? Object.freeze(refs) : null;
}

function sameStringSet(left, right) {
  const a = uniqueProofRefs(left);
  const b = uniqueProofRefs(right);
  if (!a || !b || a.length !== b.length) return false;
  return [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

function canonicalResultDigest(result) {
  const core = {};
  for (const key of Object.keys(result)) {
    if (key !== 'exactOutputIdentity') core[key] = result[key];
  }
  return sha256(JSON.stringify(core));
}

function qualificationSummary(receipt) {
  return `Stephanos qualifies ${receipt.providerInstance} ${receipt.providerVersion} for ${receipt.taskClass} at ${receipt.sourceHead} from OpenClaw execution ${receipt.realWorkReceiptId}.`;
}

function blocked(reason) {
  return Object.freeze({
    schemaVersion: OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA,
    ok: false,
    disposition: 'BLOCKED',
    reason,
    qualificationReceipt: null,
    qualificationAuthorityReceipt: null,
    realWorkWorkspaceReceipt: null,
    providerPoolAdmissionAllowed: false,
    providerQualificationAuthority: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}

function validateOc1Result(result) {
  return exactKeys(result.authorityUsed, OC1_AUTHORITY_KEYS)
    && result.authorityUsed.canonicalMissionWorkerClaim === true
    && result.authorityUsed.boundedActionCount === 1
    && text(result.authorityUsed.adapter) === 'openclaw-readonly'
    && result.authorityUsed.mergeAuthority === false
    && result.authorityUsed.deploymentAuthority === false
    && result.authorityUsed.sourceMutationAuthority === false
    && result.authorityUsed.selfQualificationAuthority === false
    && Array.isArray(result.blockers)
    && result.blockers.length === 0
    && result.networkMutationAllowed === false;
}

function validateOc2Result(result) {
  if (text(result.operation) !== 'oc2-provider-regression-v1'
    || !Array.isArray(result.changedFiles)
    || result.changedFiles.length !== 0
    || !Array.isArray(result.testResults)
    || result.testResults.length !== 2) return false;
  const expectedIds = ['OC2_PROVIDER_SOURCE_PARSE_V1', 'OC2_PROVIDER_REGRESSION_V1'];
  return result.testResults.every((entry, index) => (
    exactKeys(entry, ['testId', 'status', 'outputSha256'])
    && text(entry.testId) === expectedIds[index]
    && entry.status === 0
    && SHA256.test(text(entry.outputSha256))
  ));
}

function parseProviderProofRecord(rawRecord, observedAtMs) {
  const record = evidenceSnapshot(rawRecord);
  if (!record || !exactKeys(record, MESSAGE_KEYS)) return null;
  const validation = validateSharedWorkspaceRecord(record, { nowMs: observedAtMs, staleAfterMs: 10 * 60 * 1000 });
  if (!validation.valid || validation.stale
    || record.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE
    || record.participantId !== 'openclaw'
    || record.relatedIssue !== String(ISSUE_NUMBER)
    || record.relatedPr !== ''
    || record.channel !== 'openclaw-provider-qualification') return null;
  let parsed;
  try {
    parsed = JSON.parse(record.body);
  } catch {
    return null;
  }
  const result = evidenceSnapshot(parsed);
  if (!result) return null;
  return Object.freeze({ record, result });
}

export function adjudicateOpenClawTaskClassPromotionCandidateV1(input = {}) {
  const execution = input.executionReceipt;
  const observedAtUtc = text(input.observedAtUtc);
  const observedAtMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(observedAtMs)) return blocked('OPENCLAW_PROMOTION_OBSERVED_TIME_INVALID');

  const proof = parseProviderProofRecord(input.providerProofRecord, observedAtMs);
  if (!proof) return blocked('OPENCLAW_PROMOTION_PROVIDER_PROOF_INVALID');
  const result = proof.result;
  const policy = TASK_CLASS_POLICY[text(result.taskClass)];
  if (!policy || !exactKeys(result, policy.resultKeys) || text(result.schemaVersion) !== policy.resultSchema) {
    return blocked('OPENCLAW_PROMOTION_PROVIDER_RESULT_SCHEMA_INVALID');
  }

  const executionValidation = validateExecutionReceipt(execution, {
    repository: REPOSITORY,
    issueNumber: ISSUE_NUMBER,
    expectedHead: text(result.observedSourceHead).toLowerCase(),
    executionId: proof.record.messageId,
  });
  if (!executionValidation.valid
    || execution?.state !== 'completed'
    || execution?.workerType !== 'openclaw'
    || execution?.operatorActionRequired !== false
    || text(execution?.blocker) !== ''
    || text(execution?.phase) !== text(result.taskClass)) {
    return blocked('OPENCLAW_PROMOTION_REAL_WORK_EXECUTION_INVALID');
  }

  const executionProofRefs = uniqueProofRefs(execution.proofRefs);
  if (!executionProofRefs || !sameStringSet(proof.record.proofRefs, executionProofRefs)) {
    return blocked('OPENCLAW_PROMOTION_PROOF_REFS_INVALID');
  }

  const expectedWorkerId = `openclaw-${sha256(result.providerInstance).slice(0, 24)}`;
  if (result.repository !== REPOSITORY
    || text(result.provider) !== 'openclaw-standalone'
    || !SAFE_GATEWAY_ID.test(text(result.providerInstance))
    || !SAFE_PROVIDER_VERSION.test(text(result.providerVersion))
    || !FULL_SHA.test(text(result.requestedSourceHead))
    || text(result.requestedSourceHead).toLowerCase() !== text(result.observedSourceHead).toLowerCase()
    || text(result.observedSourceHead).toLowerCase() !== text(execution.sourceHead).toLowerCase()
    || text(execution.workerId) !== expectedWorkerId
    || !SAFE_WORKER_ID.test(expectedWorkerId)
    || text(result.taskId) !== text(proof.record.correlationId)
    || text(result.goalId) !== '#1725'
    || text(result.finalVerdict) !== policy.finalVerdict
    || text(result.completedAtUtc) !== text(execution.timestampUtc)
    || !SHA256.test(text(result.exactInputIdentity))
    || !SHA256.test(text(result.exactOutputIdentity))
    || canonicalResultDigest(result) !== text(result.exactOutputIdentity).toLowerCase()
    || result.sourceMutationPerformed !== false
    || result.arbitraryShellAllowed !== false
    || result.arbitraryCommandAllowed !== false
    || result.mergeAllowed !== false
    || result.deploymentAllowed !== false
    || result.selfQualificationAllowed !== false
    || (result.taskClass === 'OC1_REPOSITORY_SCOUT' ? !validateOc1Result(result) : !validateOc2Result(result))) {
    return blocked('OPENCLAW_PROMOTION_PROVIDER_RESULT_NOT_QUALIFYING');
  }

  if (proof.record.timestampUtc !== execution.timestampUtc
    || proof.record.messageId !== execution.executionId) {
    return blocked('OPENCLAW_PROMOTION_PROVIDER_PROOF_LINEAGE_INVALID');
  }
  const executionAtMs = Date.parse(text(execution.timestampUtc));
  if (!Number.isFinite(executionAtMs)
    || observedAtMs < executionAtMs
    || observedAtMs - executionAtMs > 10 * 60 * 1000) {
    return blocked('OPENCLAW_PROMOTION_TIME_BINDING_INVALID');
  }

  const identitySeed = [
    execution.receiptId,
    execution.executionId,
    execution.sourceHead,
    result.taskClass,
    execution.workerId,
    result.providerVersion,
    result.exactOutputIdentity,
  ].join('\n');
  const identity = sha256(identitySeed).slice(0, 32);
  const qualificationId = `openclaw-qualification-${identity}`;
  const authorityReceiptId = `openclaw-authority-${identity}`;
  const expiresAtUtc = new Date(observedAtMs + MAX_QUALIFICATION_LIFETIME_MS).toISOString();

  const qualificationReceipt = Object.freeze({
    schemaVersion: OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
    qualificationId,
    authorityReceiptId,
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    taskClass: result.taskClass,
    state: 'PRODUCTION_ELIGIBLE',
    providerInstance: execution.workerId,
    providerVersion: result.providerVersion,
    sourceHead: text(execution.sourceHead).toLowerCase(),
    realWorkTaskId: execution.executionId,
    realWorkReceiptId: execution.receiptId,
    observedAtUtc,
    expiresAtUtc,
    codexRequired: false,
    proofRefs: executionProofRefs,
  });

  const workspaceProjection = toSharedWorkspaceExecutionReceipt(execution);
  if (!workspaceProjection.ok) return blocked('OPENCLAW_PROMOTION_WORKSPACE_PROJECTION_INVALID');

  const qualificationAuthorityReceipt = createSharedWorkspaceReceiptRecord({
    receiptId: authorityReceiptId,
    participantId: 'stephanos',
    timestampUtc: observedAtUtc,
    correlationId: qualificationId,
    relatedIssue: String(ISSUE_NUMBER),
    relatedPr: '',
    proofRefs: executionProofRefs,
    receivedRecordId: execution.receiptId,
    disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
    summary: qualificationSummary(qualificationReceipt),
  });

  return Object.freeze({
    schemaVersion: OPENCLAW_TASK_CLASS_PROMOTION_CANDIDATE_SCHEMA,
    ok: true,
    disposition: OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION,
    qualificationReceipt,
    qualificationAuthorityReceipt,
    realWorkWorkspaceReceipt: workspaceProjection.record,
    providerProofRecord: proof.record,
    providerPoolAdmissionAllowed: false,
    providerQualificationAuthority: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
  });
}
