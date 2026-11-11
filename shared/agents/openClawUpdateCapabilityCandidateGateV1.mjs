import { createHash } from 'node:crypto';
import { OPENCLAW_PRESERVATION_CLASS } from './openClawUpdatePreflightV1.mjs';
import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
  OPENCLAW_STAGED_UPDATE_ACTION,
  OPENCLAW_APPROVED_GATEWAY_ENDPOINT,
  OPENCLAW_UPDATE_POST_PROOF_SCHEMA,
  OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA,
  OPENCLAW_UPDATE_APPROVAL_SCHEMA,
  OPENCLAW_UPDATE_STAGE_SCHEMA,
  OPENCLAW_UPDATE_BACKUP_SCHEMA,
  OPENCLAW_EXPECTED_OPERATOR,
  OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA,
  OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA,
  OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
} from './openClawStagedUpdateV1.mjs';
import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_VERSION,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_CAPABILITIES,
  OPENCLAW_UPDATE_CAPABILITY_ORIGIN,
  OPENCLAW_UPDATE_DISPOSITION,
} from './openClawUpdateCapabilityLedgerV1.mjs';

export const OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_GATE_SCHEMA = 'stephanos.openclaw-update-capability-candidate-gate.v1';
export const OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA = 'stephanos.openclaw-update-qualification-replay.v1';

export const OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS = Object.freeze({
  BLOCK_UPDATE: 'BLOCK_UPDATE',
  PRE_UPDATE_CAPABILITY_GATE_READY: 'PRE_UPDATE_CAPABILITY_GATE_READY',
  POST_UPDATE_CAPABILITY_PROOF_REQUIRED: 'POST_UPDATE_CAPABILITY_PROOF_REQUIRED',
  POST_UPDATE_CAPABILITY_REPLAY_FAILED: 'POST_UPDATE_CAPABILITY_REPLAY_FAILED',
  UPDATED_AND_CAPABILITIES_VERIFIED: 'UPDATED_AND_CAPABILITIES_VERIFIED',
  ROLLED_BACK_AND_CAPABILITIES_PRESERVED: 'ROLLED_BACK_AND_CAPABILITIES_PRESERVED',
});

const FULL_SHA = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const TASK_CLASSES = new Set(Object.values(OPENCLAW_TASK_CLASS));
const VALID_DISPOSITIONS = new Set(Object.values(OPENCLAW_UPDATE_DISPOSITION));
const CHANGED_DISPOSITIONS = new Set([
  OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
  OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
  OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
]);
// Exact authenticated OC9 producer schema: post-update promotion is not a legacy fixture parser.
const PRODUCER_LEDGER_KEYS = Object.freeze([
  'schemaVersion', 'version', 'currentVersion', 'targetVersion', 'verdict',
  'blockers', 'capabilities', 'protectedCapabilityCount', 'dispositionCounts',
  'requiredQualificationReplay', 'updateAllowed', 'authority',
]);
const PRODUCER_CAPABILITY_KEYS = Object.freeze([
  'capabilityId',
  'purpose',
  'currentImplementation',
  'candidateImplementation',
  'origin',
  'candidateOrigin',
  'protected',
  'qualificationRefs',
  'tests',
  'dependencies',
  'migrationPolicy',
  'replacementCriteria',
  'lastQualifiedVersion',
  'updateDisposition',
  'evidenceRefs',
  'affectedTaskClasses',
]);

// Candidate-readiness is narrower than the staged-update state universe.
// Approval/staging/post-update-health gaps must not be reported as PRE_UPDATE_CAPABILITY_GATE_READY.
const CANDIDATE_STAGED_STATUSES = new Set([
  OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY,
  OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED,
  OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED,
  OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH,
  OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED,
]);
const INPUT_KEYS = Object.freeze(['stagedUpdate', 'capabilityLedger', 'qualificationReplay']);
const REPLAY_KEYS = Object.freeze(['schemaVersion', 'taskClass', 'qualificationId', 'sourceHead', 'providerVersion', 'verdict', 'proofRefs']);
const MAX_REPLAY_RECORDS = 16;
const MAX_PROOF_REFS = 32;
// The producer also asserts these source-harness properties. Older accepted
// fixtures omit them, but explicitly contradictory values cannot be trusted.
const OPTIONAL_STAGED_SAFETY = Object.freeze({
  sourceHarnessOnly: true,
  arbitraryShellAllowed: false,
  arbitraryPathAllowed: false,
  battleBridgeAdapterRequired: true,
  secretsIncluded: false,
  absolutePathsPublished: false,
});

// The source ledger producer grants no mutation, approval, merge or qualification
// authority. A self-reported READY verdict cannot override contradictory authority.
const LEDGER_FORBIDDEN_AUTHORITY_FLAGS = Object.freeze([
  'sourceMutationAllowed',
  'runtimeMutationAllowed',
  'updateExecutionAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'providerQualificationAllowed',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plainDataRecord(value, expectedKeys = null) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = ownKeys.map(String).sort();
    if (expectedKeys) {
      const wanted = [...expectedKeys].sort();
      if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) return null;
    }
    // Null-prototype copies prevent an own "__proto__" data field from
    // manufacturing inherited identity or approval fields during validation.
    const snapshot = Object.create(null);
    for (const key of actual) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function denseArray(value, maxItems) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxItems) return null;
    const allowed = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function exactProducerKeys(record, requiredKeys) {
  const supplied = Object.keys(record);
  return supplied.length === requiredKeys.length && supplied.every((key) => requiredKeys.includes(key));
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safeVersion(value) {
  const normalized = text(value);
  return SAFE_VERSION.test(normalized) ? normalized : '';
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : '';
}

function proofRefs(value) {
  const refs = denseArray(value, MAX_PROOF_REFS);
  if (!refs) return null;
  const normalized = refs.map(safeId);
  if (normalized.some((ref) => !ref)) return null;
  const unique = [...new Set(normalized)].sort();
  return unique.length === normalized.length ? unique : null;
}

function normalizeReplay(value) {
  const record = plainDataRecord(value, REPLAY_KEYS);
  if (!record) return null;
  const taskClass = text(record.taskClass);
  const refs = proofRefs(record.proofRefs);
  const normalized = {
    schemaVersion: text(record.schemaVersion),
    taskClass,
    qualificationId: safeId(record.qualificationId),
    sourceHead: exactSha(record.sourceHead),
    providerVersion: safeVersion(record.providerVersion),
    verdict: text(record.verdict),
    proofRefs: refs,
  };
  if (normalized.schemaVersion !== OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA
    || !TASK_CLASSES.has(normalized.taskClass)
    || !normalized.qualificationId
    || !normalized.sourceHead
    || !normalized.providerVersion
    || !['PRODUCTION_ELIGIBLE', 'FAILED'].includes(normalized.verdict)
    || !normalized.proofRefs
    || normalized.proofRefs.length === 0) {
    return null;
  }
  return Object.freeze(normalized);
}

function blocked(blockers, stagedStatus = null) {
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_GATE_SCHEMA,
    status: OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE,
    stagedStatus,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    requiredQualificationReplay: Object.freeze([]),
    acceptedQualificationReplay: Object.freeze([]),
    updatePromotionAllowed: false,
    providerRoutingResumeAllowed: false,
    rollbackRequired: false,
    authority: Object.freeze({
      updateExecutionAllowed: false,
      runtimeMutationAllowed: false,
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      approvalAllowed: false,
      providerQualificationAllowed: false,
    }),
  });
}


const PROTECTED_ENTRY_CLASSES = new Set([
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_SOURCE,
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_CONFIG,
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_RUNTIME,
]);
const UPDATED_HEALTH_CHECKS = Object.freeze([
  'openClawGateway','stephanosBackend','stephanosUi','missionWorker','sharedWorkspaceWrite',
]);
const APPLY_STEPS_PRODUCER = Object.freeze([
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP,
  OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_HEALTH,
  OPENCLAW_STAGED_UPDATE_ACTION.COMPARE_PRESERVATION,
]);
const ROLLBACK_STEPS_PRODUCER = Object.freeze([
  OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE,
  OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK,
]);
// Source-consistency check only. It cannot certify a private native Gateway.

// Compare the actual producer-defined backup-set digest, not merely SHA-256 syntax.
// Source consistency only: this cannot certify a private native backup witness.
function canonicalBackupSetJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalBackupSetJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalBackupSetJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function producerBackupSetDigestMatches(backup, rawEntries) {
  const keys=['pathFingerprintSha256','sourceDigestSha256','backupDigestSha256','backupObjectId'];
  const entries=rawEntries.map((raw)=>plainDataRecord(raw,keys));
  if (entries.some((item)=>!item)) return false;
  const body={schema:backup.schema,backupSetId:backup.backupSetId,
    manifestSha256:backup.manifestSha256,storageClass:backup.storageClass,
    createdAtUtc:backup.createdAtUtc,
    entries:entries.sort((a,b)=>a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256))};
  return createHash('sha256').update(canonicalBackupSetJson(body)).digest('hex') === backup.backupSetSha256;
}

function sourceBoundApprovalStageBackup(e,id,protectedEntries){
  const approval=plainDataRecord(e.approval),stage=plainDataRecord(e.stage),backup=plainDataRecord(e.backupSet);
  if(!approval||!stage||!backup)return false;
  const aKeys=['schema','approvalId','approvedBy','repository','sourceHead','manifestSha256','packetId','packetSha256','targetVersion','mutationScope','singleUse','approvedAtUtc','expiresAtUtc'];
  const sKeys=['schema','stageId','packetId','packetSha256','targetVersion','isolationClass','insideRepository','insideOpenClawInstall','packageEntryCount','executableEntryCount','observedAtUtc'];
  const bKeys=['schema','backupSetId','manifestSha256','storageClass','insideRepository','insideOpenClawInstall','createdAtUtc','entries','backupSetSha256'];
  if(!exactProducerKeys(approval,aKeys)||!exactProducerKeys(stage,sKeys)||!exactProducerKeys(backup,bKeys))return false;
  const now=Date.now();
  function timestamp(v){if(typeof v!=='string'||!v.endsWith('Z'))return null;
    const t=Date.parse(v);return Number.isFinite(t)&&new Date(t).toISOString()===v?t:null;}
  const approved=timestamp(approval.approvedAtUtc),expires=timestamp(approval.expiresAtUtc),
    stagedAt=timestamp(stage.observedAtUtc),backedAt=timestamp(backup.createdAtUtc);
  if(approval.schema!==OPENCLAW_UPDATE_APPROVAL_SCHEMA||!safeId(approval.approvalId)
     ||approval.approvedBy!==OPENCLAW_EXPECTED_OPERATOR
     ||approval.repository!==id.repository||approval.sourceHead!==id.sourceHead
     ||approval.manifestSha256!==id.manifestSha256||approval.packetId!==id.packetId
     ||approval.packetSha256!==id.packetSha256||approval.targetVersion!==id.targetVersion
     ||approval.mutationScope!==OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE
     ||approval.singleUse!==true||approved===null||expires===null
     ||approved>now+60000||expires<=now||expires<=approved)return false;
  if(stage.schema!==OPENCLAW_UPDATE_STAGE_SCHEMA||!safeId(stage.stageId)
     ||stage.packetId!==id.packetId||stage.packetSha256!==id.packetSha256
     ||stage.targetVersion!==id.targetVersion||stage.isolationClass!=='ISOLATED_EXTERNAL_STAGING'
     ||stage.insideRepository!==false||stage.insideOpenClawInstall!==false
     ||!Number.isSafeInteger(stage.packageEntryCount)||stage.packageEntryCount<=0
     ||stage.executableEntryCount!==1||stagedAt===null||stagedAt>now+60000)return false;
  if(backup.schema!==OPENCLAW_UPDATE_BACKUP_SCHEMA||!safeId(backup.backupSetId)
     ||backup.manifestSha256!==id.manifestSha256
     ||backup.storageClass!=='ISOLATED_EXTERNAL_BACKUP'
     ||backup.insideRepository!==false||backup.insideOpenClawInstall!==false
     ||backedAt===null||backedAt>now+60000
     ||!/^[a-f0-9]{64}$/i.test(text(backup.backupSetSha256)))return false;
  const entries=denseArray(backup.entries,512);
  if(!entries||entries.length!==protectedEntries.length||!entries.length)return false;
  const expected=new Map(),seen=new Set();
  for(const raw of protectedEntries){
     const rec=plainDataRecord(raw,['pathFingerprintSha256','sourceDigestSha256','classification']);
     if(!rec||!PROTECTED_ENTRY_CLASSES.has(rec.classification)
       ||expected.has(rec.pathFingerprintSha256))return false;
     expected.set(rec.pathFingerprintSha256,rec.sourceDigestSha256);
  }
  for(const raw of entries){
     const rec=plainDataRecord(raw,['pathFingerprintSha256','sourceDigestSha256','backupDigestSha256','backupObjectId']);
     if(!rec||seen.has(rec.pathFingerprintSha256)
       ||rec.sourceDigestSha256!==expected.get(rec.pathFingerprintSha256)
       ||!/^[a-f0-9]{64}$/i.test(text(rec.backupDigestSha256))
       ||!safeId(rec.backupObjectId))return false;
     seen.add(rec.pathFingerprintSha256);
  }
  return producerBackupSetDigestMatches(backup,entries);
}

function hasPostUpdateProducerEvidence(staged, id) {
  const e = plainDataRecord(staged.evidence, [
    'preflight','approval','stage','backupSet','applyReceipt',
    'postUpdateProof','preservationComparison','rollbackReceipt','rollbackProof','rollbackComparison',
  ]);
  if (!e || e.rollbackReceipt !== null || e.rollbackProof !== null || e.rollbackComparison !== null) return false;
  const pre=plainDataRecord(e.preflight), approval=plainDataRecord(e.approval);
  const stage=plainDataRecord(e.stage), backup=plainDataRecord(e.backupSet);
  const apply=plainDataRecord(e.applyReceipt), post=plainDataRecord(e.postUpdateProof);
  const compare=plainDataRecord(e.preservationComparison);
  if (![pre,approval,stage,backup,apply,post,compare].every(Boolean)) return false;
  for (const key of ['repository','sourceHead','manifestSha256','packetId','packetSha256','currentVersion','targetVersion']) {
    if (pre[key] !== id[key]) return false;
  }
  if (pre.gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT
    || !safeId(approval.approvalId) || approval.singleUse !== true
    || !safeId(stage.stageId) || stage.packetId !== id.packetId || stage.packetSha256 !== id.packetSha256
    || !safeId(backup.backupSetId) || backup.manifestSha256 !== id.manifestSha256
    || apply.schema !== OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA
    || !safeId(apply.receiptId) || apply.mutationAttempted !== true
    || apply.approvalId !== approval.approvalId || apply.stageId !== stage.stageId
    || apply.backupSetId !== backup.backupSetId) return false;
  for (const key of ['repository','sourceHead','manifestSha256','packetId','packetSha256','targetVersion']) {
    if (apply[key] !== id[key]) return false;
  }
  // Apply receipts contain the producer's five executed adapter actions.
  // The seven-step applyPlan is only a source-only, unexecuted template.
  const applyKeys=['schema','receiptId','adapterId','repository','sourceHead','manifestSha256',
    'approvalId','stageId','backupSetId','packetId','packetSha256','beforeVersion',
    'targetVersion','mutationAttempted','observedAtUtc','steps'];
  const postKeys=['schema','proofId','repository','sourceHead','manifestSha256',
    'observedVersion','gatewayEndpoint','observedAtUtc','health'];
  if (!exactProducerKeys(apply,applyKeys) || !exactProducerKeys(post,postKeys)
    || apply.adapterId !== OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID
    || apply.beforeVersion !== id.currentVersion) return false;
  const executedSteps=denseArray(apply.steps,5);
  if (!executedSteps || executedSteps.length !== 5
    || executedSteps.some((step,index)=>step!==APPLY_STEPS_PRODUCER[index])) return false;
  const observedTime=(value)=>{
    if(typeof value!=='string'||!value.endsWith('Z'))return null;
    const parsed=Date.parse(value);
    return Number.isFinite(parsed)&&new Date(parsed).toISOString()===value?parsed:null;
  };
  const appliedAt=observedTime(apply.observedAtUtc);
  const provedAt=observedTime(post.observedAtUtc);
  const stagedAt=observedTime(stage.observedAtUtc);
  const backedAt=observedTime(backup.createdAtUtc);
  // An approval issued after the bounded adapter executed cannot authorize
  // that historical mutation. Clock-skew tolerance is not retroactive consent.
  const approvedAt=observedTime(approval.approvedAtUtc);
  const expiresAt=observedTime(approval.expiresAtUtc);
  if ([appliedAt,provedAt,stagedAt,backedAt,approvedAt,expiresAt].some((value)=>value===null)
    || appliedAt>Date.now()+60000 || provedAt>Date.now()+60000
    || approvedAt>appliedAt || appliedAt>=expiresAt
    || appliedAt<stagedAt || appliedAt<backedAt || provedAt<appliedAt) return false;
  const health=plainDataRecord(post.health,UPDATED_HEALTH_CHECKS);
  if (!health || UPDATED_HEALTH_CHECKS.some((key)=>health[key] !== true)
    || post.schema !== OPENCLAW_UPDATE_POST_PROOF_SCHEMA || !safeId(post.proofId)
    || post.repository !== id.repository || post.sourceHead !== id.sourceHead
    || post.manifestSha256 !== id.manifestSha256 || post.observedVersion !== id.targetVersion
    || post.gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT) return false;
  if (compare.schema !== OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA
    || !safeId(compare.comparisonId) || compare.manifestSha256 !== id.manifestSha256) return false;
  const protectedEntries=denseArray(pre.protectedEntries,512),comparisonEntries=denseArray(compare.entries,512);
  if (!protectedEntries || !comparisonEntries || protectedEntries.length === 0
    || protectedEntries.length !== comparisonEntries.length
    || !sourceBoundApprovalStageBackup(e,id,protectedEntries)) return false;
  const digest=/^[a-f0-9]{64}$/i,expected=new Map();
  for (const raw of protectedEntries) {
    const item=plainDataRecord(raw,['pathFingerprintSha256','sourceDigestSha256','classification']);
    if (!item || !PROTECTED_ENTRY_CLASSES.has(item.classification)
      || !digest.test(text(item.pathFingerprintSha256))
      || !digest.test(text(item.sourceDigestSha256))
      || expected.has(item.pathFingerprintSha256)) return false;
    expected.set(item.pathFingerprintSha256,item.sourceDigestSha256);
  }
  const seen=new Set();
  for (const raw of comparisonEntries) {
    const item=plainDataRecord(raw);
    if (!item || seen.has(item.pathFingerprintSha256)
      || !expected.has(item.pathFingerprintSha256)
      || item.beforeDigestSha256 !== expected.get(item.pathFingerprintSha256)
      || item.afterDigestSha256 !== expected.get(item.pathFingerprintSha256)) return false;
    seen.add(item.pathFingerprintSha256);
  }
  for (const [key,actions] of [['applyPlan',APPLY_STEPS_PRODUCER],['rollbackPlan',ROLLBACK_STEPS_PRODUCER]]) {
    const plan=denseArray(staged[key],actions.length);
    if (!plan || plan.length !== actions.length) return false;
    for (let i=0;i<plan.length;i++) {
      const item=plainDataRecord(plan[i],['step','actionId','mutating','executed']);
      if (!item || item.step !== i+1 || item.actionId !== actions[i]
        || item.mutating !== (key==='applyPlan' ? i===4 : i<2)
        || item.executed !== false) return false;
    }
  }
  return true;
}


/**
 * A rollback status cannot certify restoration without the actual staged
 * producer's rollback receipt, prior-version health and protected-file proof.
 * This is source-consistency validation only; no private adapter is invoked.
 */
function hasRollbackProducerEvidence(staged, id) {
  const evidenceKeys = ['preflight','approval','stage','backupSet','applyReceipt',
    'postUpdateProof','preservationComparison','rollbackReceipt','rollbackProof','rollbackComparison'];
  const e = plainDataRecord(staged.evidence, evidenceKeys);
  if (!e) return false;
  const pre = plainDataRecord(e.preflight, [
    'repository','sourceHead','manifestSha256','packetId','packetSha256',
    'targetVersion','currentVersion','gatewayEndpoint','protectedEntries']);
  const backup = plainDataRecord(e.backupSet, [
    'schema','backupSetId','manifestSha256','storageClass','insideRepository',
    'insideOpenClawInstall','createdAtUtc','entries','backupSetSha256']);
  const receipt = plainDataRecord(e.rollbackReceipt, [
    'schema','receiptId','adapterId','repository','sourceHead','manifestSha256',
    'backupSetId','restoredVersion','mutationAttempted','observedAtUtc','steps']);
  const proof = plainDataRecord(e.rollbackProof, [
    'schema','proofId','repository','sourceHead','manifestSha256',
    'observedVersion','gatewayEndpoint','observedAtUtc','health']);
  const comparison = plainDataRecord(e.rollbackComparison, [
    'schema','comparisonId','manifestSha256','entries']);
  if (![pre,backup,receipt,proof,comparison].every(Boolean)) return false;
  const now = Date.now();
  const timestamp = (value) => {
    if (typeof value !== 'string' || !value.endsWith('Z')) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
  };
  const backedAt=timestamp(backup.createdAtUtc), rolledAt=timestamp(receipt.observedAtUtc),
    provedAt=timestamp(proof.observedAtUtc);
  if ([backedAt,rolledAt,provedAt].some((value)=>value===null || value>now+60000)
    || rolledAt<backedAt || provedAt<rolledAt) return false;
  for (const field of ['repository','sourceHead','manifestSha256','packetId',
    'packetSha256','currentVersion','targetVersion']) {
    if (pre[field] !== id[field]) return false;
  }
  if (pre.gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT
    || backup.schema !== OPENCLAW_UPDATE_BACKUP_SCHEMA
    || !safeId(backup.backupSetId) || backup.manifestSha256 !== id.manifestSha256
    || backup.storageClass !== 'ISOLATED_EXTERNAL_BACKUP'
    || backup.insideRepository !== false || backup.insideOpenClawInstall !== false
    || !/^[a-f0-9]{64}$/i.test(text(backup.backupSetSha256))) return false;
  const protectedEntries=denseArray(pre.protectedEntries,512),
    backupEntries=denseArray(backup.entries,512),
    comparisonEntries=denseArray(comparison.entries,512);
  if (!protectedEntries || !backupEntries || !comparisonEntries
    || !protectedEntries.length || backupEntries.length !== protectedEntries.length
    || comparisonEntries.length !== protectedEntries.length) return false;
  const expected=new Map(),backed=new Set(),compared=new Set(),digest=/^[a-f0-9]{64}$/i;
  for (const raw of protectedEntries) {
    const entry=plainDataRecord(raw,['pathFingerprintSha256','sourceDigestSha256','classification']);
    if (!entry || !PROTECTED_ENTRY_CLASSES.has(entry.classification)
      || !digest.test(text(entry.pathFingerprintSha256))
      || !digest.test(text(entry.sourceDigestSha256))
      || expected.has(entry.pathFingerprintSha256)) return false;
    expected.set(entry.pathFingerprintSha256,entry.sourceDigestSha256);
  }
  for (const raw of backupEntries) {
    const entry=plainDataRecord(raw,['pathFingerprintSha256','sourceDigestSha256',
      'backupDigestSha256','backupObjectId']);
    if (!entry || backed.has(entry.pathFingerprintSha256)
      || expected.get(entry.pathFingerprintSha256)!==entry.sourceDigestSha256
      || !digest.test(text(entry.backupDigestSha256)) || !safeId(entry.backupObjectId)) return false;
    backed.add(entry.pathFingerprintSha256);
  }
  if (receipt.schema !== OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA
    || !safeId(receipt.receiptId)
    || receipt.adapterId !== OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID
    || receipt.repository !== id.repository || receipt.sourceHead !== id.sourceHead
    || receipt.manifestSha256 !== id.manifestSha256
    || receipt.backupSetId !== backup.backupSetId
    || receipt.restoredVersion !== id.currentVersion
    || receipt.mutationAttempted !== true) return false;
  const receiptSteps=denseArray(receipt.steps,ROLLBACK_STEPS_PRODUCER.length);
  if (!receiptSteps || receiptSteps.length !== ROLLBACK_STEPS_PRODUCER.length
    || receiptSteps.some((step,index)=>step!==ROLLBACK_STEPS_PRODUCER[index])) return false;
  const health=plainDataRecord(proof.health,UPDATED_HEALTH_CHECKS);
  if (!health || UPDATED_HEALTH_CHECKS.some((key)=>health[key]!==true)
    || proof.schema !== OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA
    || !safeId(proof.proofId)
    || proof.repository !== id.repository || proof.sourceHead !== id.sourceHead
    || proof.manifestSha256 !== id.manifestSha256
    || proof.observedVersion !== id.currentVersion
    || proof.gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT) return false;
  if (comparison.schema !== OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA
    || !safeId(comparison.comparisonId)
    || comparison.manifestSha256 !== id.manifestSha256) return false;
  for (const raw of comparisonEntries) {
    const entry=plainDataRecord(raw,['pathFingerprintSha256','beforeDigestSha256','afterDigestSha256']);
    if (!entry || compared.has(entry.pathFingerprintSha256)
      || entry.beforeDigestSha256 !== expected.get(entry.pathFingerprintSha256)
      || entry.afterDigestSha256 !== expected.get(entry.pathFingerprintSha256)) return false;
    compared.add(entry.pathFingerprintSha256);
  }
  // Both plans are producer templates, not evidence of execution. The rollback
  // receipt above is the required separate claim of real adapter execution.
  for (const [key,actions] of [['applyPlan',APPLY_STEPS_PRODUCER],
    ['rollbackPlan',ROLLBACK_STEPS_PRODUCER]]) {
    const plan=denseArray(staged[key],actions.length);
    if (!plan || plan.length!==actions.length) return false;
    for(let i=0;i<plan.length;i++){
      const item=plainDataRecord(plan[i],['step','actionId','mutating','executed']);
      if(!item || item.step!==i+1 || item.actionId!==actions[i]
        || item.mutating!==(key==='applyPlan'?i===4:i<2)
        || item.executed!==false) return false;
    }
  }
  return producerBackupSetDigestMatches(backup,backupEntries);
}

export function evaluateOpenClawUpdateCapabilityCandidateV1(input = {}) {
  const snapshot = plainDataRecord(input, INPUT_KEYS);
  if (!snapshot) return blocked(['CANDIDATE_GATE_SCHEMA_INVALID']);

  const staged = plainDataRecord(snapshot.stagedUpdate);
  const ledger = plainDataRecord(snapshot.capabilityLedger);
  if (!staged || !ledger) return blocked(['STAGED_UPDATE_AND_CAPABILITY_LEDGER_REQUIRED']);

  const stagedStatus = text(staged.status);
  const blockers = [];
  // Read-only preflight can inspect older fixtures; post-update promotion must
  // retain both explicit, dense, empty blocker arrays from the trusted producers.
  if (Object.prototype.hasOwnProperty.call(staged, 'blockers')
    || stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    const stagedBlockers = denseArray(staged.blockers, MAX_PROOF_REFS);
    if (!stagedBlockers || stagedBlockers.length !== 0) blockers.push('STAGED_UPDATE_BLOCKERS_NOT_EMPTY');
  }
  if (Object.prototype.hasOwnProperty.call(ledger, 'blockers')
    || stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    const ledgerBlockers = denseArray(ledger.blockers, MAX_PROOF_REFS);
    if (!ledgerBlockers || ledgerBlockers.length !== 0) blockers.push('CAPABILITY_LEDGER_BLOCKERS_NOT_EMPTY');
  }
  if (text(staged.schema) !== OPENCLAW_STAGED_UPDATE_SCHEMA) blockers.push('STAGED_UPDATE_SCHEMA_MISMATCH');
  if (!CANDIDATE_STAGED_STATUSES.has(stagedStatus)) blockers.push('STAGED_UPDATE_STATUS_NOT_CANDIDATE_READY');
  if (text(ledger.schemaVersion) !== OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA) blockers.push('CAPABILITY_LEDGER_SCHEMA_MISMATCH');
  if (ledger.updateAllowed !== true || text(ledger.verdict) !== 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF') {
    blockers.push('CAPABILITY_LEDGER_NOT_READY');
  }
  // A legacy preflight may inspect an old ledger envelope, but a verified
  // update may never promote capability routing without the producer's complete
  // explicit no-authority record. Absence must fail as closed as partial authority.
  if (Object.prototype.hasOwnProperty.call(ledger, 'authority')
    || stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    const ledgerAuthority = plainDataRecord(ledger.authority);
    if (!ledgerAuthority || LEDGER_FORBIDDEN_AUTHORITY_FLAGS.some((key) =>
      !Object.prototype.hasOwnProperty.call(ledgerAuthority, key) || ledgerAuthority[key] !== false)) {
      blockers.push('CAPABILITY_LEDGER_AUTHORITY_WIDENED');
    }
    // A post-update proof must match the producer's closed authority schema.
    // Unknown fields are not inert evidence merely because their values are false.
    if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
      && ledgerAuthority && !exactProducerKeys(ledgerAuthority, [
        ...LEDGER_FORBIDDEN_AUTHORITY_FLAGS, 'qualificationInvalidationRequired',
      ])) blockers.push('CAPABILITY_LEDGER_AUTHORITY_SCHEMA_DRIFT');
    if (!ledgerAuthority || typeof ledgerAuthority.qualificationInvalidationRequired !== 'boolean') {
      blockers.push('CAPABILITY_LEDGER_QUALIFICATION_INVALIDATION_INVALID');
    }
  }

  const safety = plainDataRecord(staged.safety);
  if (!safety) blockers.push('STAGED_UPDATE_SAFETY_INVALID');
  // Absence, non-boolean values and a self-reported 'false' must never imply no authority.
  if (safety && ['mutationAllowed', 'sourceMutationAllowed', 'mergeAuthority', 'deploymentAuthority']
    .some((key) => !Object.prototype.hasOwnProperty.call(safety, key) || safety[key] !== false)) {
    blockers.push('STAGED_UPDATE_AUTHORITY_WIDENED');
  }
  if (safety && (
    Object.entries(OPTIONAL_STAGED_SAFETY).some(([key, expected]) =>
      Object.prototype.hasOwnProperty.call(safety, key) && safety[key] !== expected)
    || (Object.prototype.hasOwnProperty.call(safety, 'operatorApprovalRequired')
      && safety.operatorApprovalRequired !== ![
        OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED,
        OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED,
      ].includes(stagedStatus))
  )) {
    blockers.push('STAGED_UPDATE_SAFETY_CONTRADICTION');
  }
  if (safety && stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
    && !exactProducerKeys(safety, [
      ...Object.keys(OPTIONAL_STAGED_SAFETY),
      'mutationAllowed', 'sourceMutationAllowed', 'mergeAuthority',
      'deploymentAuthority', 'operatorApprovalRequired',
    ])) blockers.push('STAGED_UPDATE_SAFETY_SCHEMA_DRIFT');

  // A positive post-update source projection must retain the full source
  // producer's bounded adapter/no-shell safety envelope. Legacy preflight can
  // still inspect a partial fixture, but must never promote provider routing.
  if (safety && stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
    // Post-update claims must carry the full producer safety envelope, even
    // when all optional legacy-fixture keys are absent together.
    && (Object.keys(OPTIONAL_STAGED_SAFETY).some((key) =>
      !Object.prototype.hasOwnProperty.call(safety, key))
      || !Object.prototype.hasOwnProperty.call(safety, 'operatorApprovalRequired'))) {
    blockers.push('STAGED_UPDATE_SAFETY_PRODUCER_ENVELOPE_MISSING');
  }

  const identity = plainDataRecord(staged.exactIdentity);
  if (!identity) blockers.push('STAGED_UPDATE_IDENTITY_MISSING');
  // The staged producer binds repository, manifest and packet identities. A
  // verified update must retain these pins before routing may resume; preflight
  // legacy fixtures remain read-only until their contract is migrated.
  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
    && (!safeId(identity?.repository).includes('/')
      || !/^[a-f0-9]{64}$/i.test(text(identity?.manifestSha256))
      || !safeId(identity?.packetId)
      || !/^[a-f0-9]{64}$/i.test(text(identity?.packetSha256)))) {
    blockers.push('STAGED_UPDATE_EXACT_IDENTITY_INCOMPLETE');
  }
  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
    && !hasPostUpdateProducerEvidence(staged,identity)) {
    blockers.push('STAGED_UPDATE_POST_PRODUCER_EVIDENCE_UNPROVEN');
  }
  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED
    && !hasRollbackProducerEvidence(staged,identity)) {
    blockers.push('STAGED_UPDATE_ROLLBACK_PRODUCER_EVIDENCE_UNPROVEN');
  }
  const sourceHead = exactSha(identity?.sourceHead);
  const currentVersion = safeVersion(identity?.currentVersion);
  const targetVersion = safeVersion(identity?.targetVersion);
  if (!sourceHead) blockers.push('SOURCE_HEAD_INVALID');
  if (!currentVersion || !targetVersion) blockers.push('STAGED_VERSION_IDENTITY_INVALID');
  if (safeVersion(ledger.currentVersion) !== currentVersion) blockers.push('CURRENT_VERSION_LEDGER_MISMATCH');
  if (safeVersion(ledger.targetVersion) !== targetVersion) blockers.push('TARGET_VERSION_LEDGER_MISMATCH');

  const requiredReplay = denseArray(ledger.requiredQualificationReplay, MAX_REPLAY_RECORDS);
  if (!requiredReplay || requiredReplay.some((taskClass) => !TASK_CLASSES.has(text(taskClass)))) {
    blockers.push('REQUIRED_QUALIFICATION_REPLAY_INVALID');
  }
  const required = [...new Set((requiredReplay || []).map(text))].sort();
  if (requiredReplay && required.length !== requiredReplay.length) blockers.push('REQUIRED_QUALIFICATION_REPLAY_DUPLICATE');
  // The READY ledger producer binds qualification invalidation to its replay set.
  // A self-reported false cannot promote a verified update needing qualification replay.
  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
    && Object.prototype.hasOwnProperty.call(ledger, 'authority')) {
    const replayAuthority = plainDataRecord(ledger.authority);
    if (replayAuthority && typeof replayAuthority.qualificationInvalidationRequired === 'boolean'
      && replayAuthority.qualificationInvalidationRequired !== (required.length > 0)) {
      blockers.push('CAPABILITY_LEDGER_QUALIFICATION_INVALIDATION_MISMATCH');
    }
  }
  // A protected cross-version capability change cannot be approved with zero task-class replay.
  // The ledger producer requires replay for every protected cross-version disposition;
  // enforce that invariant again at the promotion consumer boundary.
  if (currentVersion && targetVersion && currentVersion !== targetVersion && required.length === 0) {
    blockers.push('CROSS_VERSION_QUALIFICATION_REPLAY_REQUIRED');
  }
  // Producer/consumer parity: a same-version protected implementation change also
  // needs its affected task classes replayed. Never infer an empty replay contract
  // solely from currentVersion === targetVersion or an unverified "ready" verdict.
  // Only post-update promotion requires this expanded ledger evidence; earlier
  // preflight/rollback classifications grant no capability-promotion authority.
  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    // A forged/partial READY envelope may never resume provider routing.
    if (!exactProducerKeys(ledger, PRODUCER_LEDGER_KEYS)
      || text(ledger.version) !== OPENCLAW_UPDATE_CAPABILITY_LEDGER_VERSION) {
      blockers.push('CAPABILITY_LEDGER_PRODUCER_SCHEMA_DRIFT');
    }
    const capabilities = denseArray(ledger.capabilities, OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_CAPABILITIES);
    if (!capabilities || capabilities.length === 0) blockers.push('CAPABILITY_LEDGER_CAPABILITIES_UNPROVEN');
    else {
      let protectedCapabilityCount = 0;
      const seenCapabilityIds = new Set();
      let capabilityIdsSupplied = 0;
      const observedDispositionCounts = Object.fromEntries([...VALID_DISPOSITIONS].map((disposition) => [disposition, 0]));
      for (const raw of capabilities) {
        const capability = plainDataRecord(raw);
        if (!capability || typeof capability.protected !== 'boolean'
          || !VALID_DISPOSITIONS.has(text(capability.updateDisposition))) {
          blockers.push('CAPABILITY_LEDGER_CAPABILITY_INVALID');
          continue;
        }
        // Apply the producer's closed capability contract before positive routing promotion.
        if (!exactProducerKeys(capability, PRODUCER_CAPABILITY_KEYS)) {
          blockers.push('CAPABILITY_LEDGER_CAPABILITY_SCHEMA_DRIFT');
        }
        if (['purpose', 'migrationPolicy', 'replacementCriteria'].some((field) =>
          !text(capability[field]) || text(capability[field]).length > 1024)
          || !safeId(capability.currentImplementation)
          || !safeId(capability.candidateImplementation)
          || !safeVersion(capability.lastQualifiedVersion)
          || !Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN).includes(text(capability.origin))
          || !Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN).includes(text(capability.candidateOrigin))
          || ['qualificationRefs', 'tests', 'evidenceRefs', 'dependencies', 'affectedTaskClasses'].some((field) =>
            !proofRefs(capability[field]))) {
          blockers.push('CAPABILITY_LEDGER_CAPABILITY_PRODUCER_FIELDS_INVALID');
        }
        // A READY producer ledger cannot contain two capabilities with one identity,
        // nor mix identity-bearing entries with anonymous ones. Older bounded
        // acceptance fixtures omit all IDs; preserve that legacy source contract.
        if (Object.prototype.hasOwnProperty.call(capability, 'capabilityId')) {
          capabilityIdsSupplied += 1;
          const capabilityId = safeId(capability.capabilityId);
          if (!capabilityId || seenCapabilityIds.has(capabilityId)) {
            blockers.push('CAPABILITY_LEDGER_CAPABILITY_ID_INVALID_OR_DUPLICATE');
          } else {
            seenCapabilityIds.add(capabilityId);
          }
        }
        // The producer validates every supplied affected-task array, even for
        // same-version PRESERVE. A self-reported READY record must not smuggle
        // malformed or duplicate classes simply because replay is not required.
        if (Object.prototype.hasOwnProperty.call(capability, 'affectedTaskClasses')) {
          const affectedClasses = denseArray(capability.affectedTaskClasses, MAX_PROOF_REFS);
          if (!affectedClasses || affectedClasses.some((taskClass) => !TASK_CLASSES.has(text(taskClass)))
            || new Set(affectedClasses.map(text)).size !== affectedClasses.length) {
            blockers.push('CAPABILITY_LEDGER_AFFECTED_TASK_CLASSES_INVALID');
          }
        }
        // PRESERVE must retain implementation and origin, even for same-version
        // updates. Legacy fixtures may omit all four producer identity fields,
        // but partially supplied or contradictory fields are not trustworthy.
        if (text(capability.updateDisposition) === OPENCLAW_UPDATE_DISPOSITION.PRESERVE) {
          const identityKeys = ['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin'];
          if (identityKeys.some((key) => Object.prototype.hasOwnProperty.call(capability, key))) {
            const currentImplementation = safeId(capability.currentImplementation);
            const candidateImplementation = safeId(capability.candidateImplementation);
            const origin = text(capability.origin);
            const candidateOrigin = text(capability.candidateOrigin);
            if (!currentImplementation || !candidateImplementation
              || currentImplementation !== candidateImplementation
              || !Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN).includes(origin)
              || origin !== candidateOrigin) {
              blockers.push('CAPABILITY_LEDGER_PRESERVE_IDENTITY_CONTRADICTION');
            }
          }
        }
        // The original ledger producer refuses no-op MIGRATE/IMPROVE and
        // upstream-to-upstream REPLACE. Promotion must not trust a forged READY
        // verdict that contradicts these disposition/identity constraints.
        // Earlier fixture records with no identity fields remain source-only
        // compatible until the reviewed producer/consumer migration.
        if (CHANGED_DISPOSITIONS.has(text(capability.updateDisposition))) {
          // The original producer requires test and candidate evidence for every
          // changed disposition. A claimed READY ledger must not lose those proofs
          // between production and post-update routing promotion.
          for (const field of ['tests', 'evidenceRefs']) {
            const refs = proofRefs(capability[field]);
            if (!refs || refs.length === 0) blockers.push('CAPABILITY_LEDGER_CHANGED_PROOF_UNPROVEN');
          }
          // The READY producer requires complete implementation/origin identities for
          // every changed capability. A self-declared unprotected flag cannot
          // turn missing identities into a positive routing-promotion proof.
          const currentImplementation = safeId(capability.currentImplementation);
          const candidateImplementation = safeId(capability.candidateImplementation);
          const origin = text(capability.origin);
          const candidateOrigin = text(capability.candidateOrigin);
          const validOrigins = Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN);
          const disposition = text(capability.updateDisposition);
          const identityInvalid = !currentImplementation || !candidateImplementation
            || !validOrigins.includes(origin) || !validOrigins.includes(candidateOrigin);
          const noChange = currentImplementation === candidateImplementation && origin === candidateOrigin;
          const replacementInvalid = disposition === OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM
            && (origin === OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM
              || candidateOrigin !== OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM);
          if (identityInvalid || replacementInvalid
            || (disposition !== OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM && noChange)) {
            blockers.push('CAPABILITY_LEDGER_CHANGED_DISPOSITION_IDENTITY_CONTRADICTION');
          }
        }
        if (capability.protected) {
          // A post-update promotion is not a legacy fixture parser: the original
          // producer requires every protected capability to carry a complete identity.
          // Missing evidence must never grant more authority than an empty field.
          if (!safeId(capability.capabilityId)
            || !safeId(capability.currentImplementation)
            || !safeId(capability.candidateImplementation)
            || !Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN).includes(text(capability.origin))
            || !Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN).includes(text(capability.candidateOrigin))
            || safeVersion(capability.lastQualifiedVersion) !== currentVersion) {
            blockers.push('CAPABILITY_LEDGER_PROTECTED_IDENTITY_UNPROVEN');
          }
          // The source producer rejects stale or future protected qualification versions.
          // Older acceptance fixtures omit this field; explicit contradictions must fail.
          if (Object.prototype.hasOwnProperty.call(capability, 'lastQualifiedVersion')
            && safeVersion(capability.lastQualifiedVersion) !== currentVersion) {
            blockers.push('CAPABILITY_LEDGER_PROTECTED_QUALIFICATION_VERSION_MISMATCH');
          }
          // Post-update cross-version PRESERVE requires actual retained-hook
          // qualifications, tests and evidence. Missing, empty and malformed
          // arrays are equally unproven; a preflight legacy fixture cannot promote.
          if (text(capability.updateDisposition) === OPENCLAW_UPDATE_DISPOSITION.PRESERVE
            && currentVersion !== targetVersion) {
            for (const field of ['qualificationRefs', 'tests', 'evidenceRefs']) {
              const refs = proofRefs(capability[field]);
              if (!refs || refs.length === 0) {
                blockers.push('CAPABILITY_LEDGER_PRESERVE_EVIDENCE_UNPROVEN');
              }
            }
          }
          protectedCapabilityCount += 1;
          observedDispositionCounts[text(capability.updateDisposition)] += 1;
        }
        // A protected BLOCK_UPDATE disposition is a producer-level veto. A
        // fabricated READY verdict must not erase that veto at this consumer.
        if (capability.protected && text(capability.updateDisposition) === OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE) {
          blockers.push('PROTECTED_CAPABILITY_BLOCKS_UPDATE');
        }
        // The source ledger requires affected-task replay for a protected PRESERVE
        // across versions too. Unrelated successful replays cannot satisfy it.
        const requiresProtectedReplay = CHANGED_DISPOSITIONS.has(text(capability.updateDisposition))
          || (text(capability.updateDisposition) === OPENCLAW_UPDATE_DISPOSITION.PRESERVE
            && currentVersion !== targetVersion);
        if (capability.protected && requiresProtectedReplay) {
          const affected = denseArray(capability.affectedTaskClasses, MAX_PROOF_REFS);
          if (!affected || affected.length === 0 || affected.some((taskClass) =>
            !TASK_CLASSES.has(text(taskClass)) || !required.includes(text(taskClass)))) {
            blockers.push('PROTECTED_CAPABILITY_REPLAY_CONTRACT_INVALID');
          }
        }
      }
      if (capabilityIdsSupplied > 0 && capabilityIdsSupplied !== capabilities.length) {
        blockers.push('CAPABILITY_LEDGER_CAPABILITY_ID_INCOMPLETE');
      }
      // The source ledger rejects readiness with no protected capability.
      // Recheck it here so an asserted ready verdict cannot promote an empty protection estate.
      if (!protectedCapabilityCount) blockers.push('CAPABILITY_LEDGER_PROTECTED_INVENTORY_EMPTY');
      // A forged READY envelope must not contradict the producer's exact
      // per-disposition inventory, even if its overall protected count matches.
      // Older accepted source fixtures may omit this optional producer field.
      if (Object.prototype.hasOwnProperty.call(ledger, 'dispositionCounts')) {
        const declared = plainDataRecord(ledger.dispositionCounts, [...VALID_DISPOSITIONS]);
        if (!declared || [...VALID_DISPOSITIONS].some((disposition) =>
          !Number.isSafeInteger(declared[disposition])
          || declared[disposition] !== observedDispositionCounts[disposition])) {
          blockers.push('CAPABILITY_LEDGER_DISPOSITION_COUNTS_MISMATCH');
        }
      }
      // The producer reports the number of protected capabilities. A purported
      // READY ledger with a contradictory explicit count is not an authenticated
      // inventory; retain compatibility with older source fixtures that omit it.
      if (Object.prototype.hasOwnProperty.call(ledger, 'protectedCapabilityCount')
        && (!Number.isSafeInteger(ledger.protectedCapabilityCount)
          || ledger.protectedCapabilityCount !== protectedCapabilityCount)) {
        blockers.push('CAPABILITY_LEDGER_PROTECTED_COUNT_MISMATCH');
      }
    }
  }

  if (blockers.length) return blocked(blockers, stagedStatus || null);

  const replayInput = snapshot.qualificationReplay === null
    ? []
    : denseArray(snapshot.qualificationReplay, MAX_REPLAY_RECORDS);
  if (!replayInput) return blocked(['QUALIFICATION_REPLAY_INPUT_INVALID'], stagedStatus || null);
  const normalizedReplay = [];
  for (const raw of replayInput) {
    const record = normalizeReplay(raw);
    if (!record) return blocked(['QUALIFICATION_REPLAY_RECORD_INVALID'], stagedStatus || null);
    normalizedReplay.push(record);
  }
  const byTaskClass = new Map();
  for (const record of normalizedReplay) {
    if (byTaskClass.has(record.taskClass)) return blocked([`QUALIFICATION_REPLAY_DUPLICATE:${record.taskClass}`], stagedStatus || null);
    byTaskClass.set(record.taskClass, record);
  }
  for (const taskClass of byTaskClass.keys()) {
    if (!required.includes(taskClass)) return blocked([`UNREQUESTED_QUALIFICATION_REPLAY:${taskClass}`], stagedStatus || null);
  }

  const accepted = [];
  const missing = [];
  const failed = [];
  for (const taskClass of required) {
    const record = byTaskClass.get(taskClass);
    if (!record) {
      missing.push(taskClass);
      continue;
    }
    if (record.sourceHead !== sourceHead || record.providerVersion !== targetVersion) {
      failed.push(`${taskClass}:identity-mismatch`);
      continue;
    }
    if (record.verdict !== 'PRODUCTION_ELIGIBLE') {
      failed.push(`${taskClass}:failed`);
      continue;
    }
    accepted.push(record);
  }

  let status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY;
  let rollbackRequired = false;
  let updatePromotionAllowed = false;
  let providerRoutingResumeAllowed = false;
  const outputBlockers = [];

  if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    if (failed.length) {
      status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_REPLAY_FAILED;
      rollbackRequired = true;
      outputBlockers.push(...failed.map((entry) => `QUALIFICATION_REPLAY_FAILED:${entry}`));
    } else if (missing.length) {
      status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_PROOF_REQUIRED;
      outputBlockers.push(...missing.map((taskClass) => `QUALIFICATION_REPLAY_MISSING:${taskClass}`));
    } else {
      status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED;
      updatePromotionAllowed = true;
      providerRoutingResumeAllowed = true;
    }
  } else if (stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED) {
    status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.ROLLED_BACK_AND_CAPABILITIES_PRESERVED;
  } else if ([
    OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH,
    OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED,
  ].includes(stagedStatus)) {
    status = OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.BLOCK_UPDATE;
    rollbackRequired = stagedStatus === OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED;
    outputBlockers.push(`STAGED_UPDATE_${stagedStatus}`);
  }

  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_GATE_SCHEMA,
    status,
    stagedStatus,
    sourceHead,
    currentVersion,
    targetVersion,
    blockers: Object.freeze(outputBlockers),
    requiredQualificationReplay: Object.freeze(required),
    acceptedQualificationReplay: Object.freeze(accepted.sort((a, b) => a.taskClass.localeCompare(b.taskClass))),
    updatePromotionAllowed,
    providerRoutingResumeAllowed,
    rollbackRequired,
    authority: Object.freeze({
      updateExecutionAllowed: false,
      runtimeMutationAllowed: false,
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      approvalAllowed: false,
      providerQualificationAllowed: false,
    }),
  });
}
