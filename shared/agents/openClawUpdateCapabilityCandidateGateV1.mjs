import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';
import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
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
const INPUT_KEYS = Object.freeze(['stagedUpdate', 'capabilityLedger', 'qualificationReplay']);
const REPLAY_KEYS = Object.freeze(['schemaVersion', 'taskClass', 'qualificationId', 'sourceHead', 'providerVersion', 'verdict', 'proofRefs']);
const MAX_REPLAY_RECORDS = 16;
const MAX_PROOF_REFS = 32;

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
    const snapshot = {};
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

export function evaluateOpenClawUpdateCapabilityCandidateV1(input = {}) {
  const snapshot = plainDataRecord(input, INPUT_KEYS);
  if (!snapshot) return blocked(['CANDIDATE_GATE_SCHEMA_INVALID']);

  const staged = plainDataRecord(snapshot.stagedUpdate);
  const ledger = plainDataRecord(snapshot.capabilityLedger);
  if (!staged || !ledger) return blocked(['STAGED_UPDATE_AND_CAPABILITY_LEDGER_REQUIRED']);

  const stagedStatus = text(staged.status);
  const blockers = [];
  if (text(staged.schema) !== OPENCLAW_STAGED_UPDATE_SCHEMA) blockers.push('STAGED_UPDATE_SCHEMA_MISMATCH');
  if (text(ledger.schemaVersion) !== OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA) blockers.push('CAPABILITY_LEDGER_SCHEMA_MISMATCH');
  if (ledger.updateAllowed !== true || text(ledger.verdict) !== 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF') {
    blockers.push('CAPABILITY_LEDGER_NOT_READY');
  }

  const safety = plainDataRecord(staged.safety);
  if (!safety) blockers.push('STAGED_UPDATE_SAFETY_INVALID');
  if (safety && (safety.mutationAllowed === true || safety.sourceMutationAllowed === true
    || safety.mergeAuthority === true || safety.deploymentAuthority === true)) {
    blockers.push('STAGED_UPDATE_AUTHORITY_WIDENED');
  }

  const identity = plainDataRecord(staged.exactIdentity);
  if (!identity) blockers.push('STAGED_UPDATE_IDENTITY_MISSING');
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
