import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';
import {
  OPENCLAW_TASK_CLASS,
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
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
  // New producer records carry blockers; reject contradictions when that field is supplied.
  // Older acceptance fixtures omit it, and still use the established verdict/updateAllowed
  // contract. Making the field mandatory needs a separately reviewed consumer migration.
  if (Object.prototype.hasOwnProperty.call(staged, 'blockers')) {
    const stagedBlockers = denseArray(staged.blockers, MAX_PROOF_REFS);
    if (!stagedBlockers || stagedBlockers.length !== 0) blockers.push('STAGED_UPDATE_BLOCKERS_NOT_EMPTY');
  }
  if (Object.prototype.hasOwnProperty.call(ledger, 'blockers')) {
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
          const identityKeys = ['currentImplementation', 'candidateImplementation', 'origin', 'candidateOrigin'];
          if (capability.protected || identityKeys.some((key) => Object.prototype.hasOwnProperty.call(capability, key))) {
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
