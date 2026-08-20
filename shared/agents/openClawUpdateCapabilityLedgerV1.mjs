export const OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA = 'stephanos.openclaw-update-capability-ledger.v1';
export const OPENCLAW_UPDATE_CAPABILITY_LEDGER_VERSION = '1.0.0';
export const OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_CAPABILITIES = 128;
export const OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_REFS = 32;

export const OPENCLAW_UPDATE_CAPABILITY_ORIGIN = Object.freeze({
  UPSTREAM: 'upstream',
  STEPHANOS_EXTENSION: 'stephanos-extension',
  LOCAL_CONFIG: 'local-config',
});

export const OPENCLAW_UPDATE_DISPOSITION = Object.freeze({
  PRESERVE: 'PRESERVE',
  MIGRATE: 'MIGRATE',
  REPLACE_WITH_UPSTREAM: 'REPLACE_WITH_UPSTREAM',
  IMPROVE: 'IMPROVE',
  BLOCK_UPDATE: 'BLOCK_UPDATE',
});

export const OPENCLAW_TASK_CLASS = Object.freeze({
  OC1: 'OC1_REPOSITORY_SCOUT',
  OC2: 'OC2_TEST_BUILD',
  OC3: 'OC3_BOUNDED_REPAIR',
  OC4: 'OC4_DRAFT_PUBLISHER',
  OC5: 'OC5_INDEPENDENT_REVIEWER',
  OC6: 'OC6_BATTLE_BRIDGE_PROVER',
  OC7: 'OC7_DEPLOYMENT_WORKER',
  OC8: 'OC8_PERSISTENT_BUILDER',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const SAFE_TEXT_MAX = 1024;
const ORIGINS = new Set(Object.values(OPENCLAW_UPDATE_CAPABILITY_ORIGIN));
const DISPOSITIONS = new Set(Object.values(OPENCLAW_UPDATE_DISPOSITION));
const TASK_CLASSES = new Set(Object.values(OPENCLAW_TASK_CLASS));
const LEDGER_KEYS = Object.freeze(['currentVersion', 'targetVersion', 'capabilities']);
const CAPABILITY_KEYS = Object.freeze([
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

function text(value) {
  return String(value ?? '').trim();
}

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function safeText(value) {
  const normalized = text(value);
  return normalized.length > 0 && normalized.length <= SAFE_TEXT_MAX && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safeVersion(value) {
  const normalized = text(value);
  return SAFE_VERSION.test(normalized) ? normalized : '';
}

function normalizeRefArray(value, field, capabilityId, blockers, { allowEmpty = true, taskClasses = false } = {}) {
  if (!Array.isArray(value) || value.length > OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_REFS) {
    blockers.push(`${field.toUpperCase()}_INVALID:${capabilityId || 'unknown'}`);
    return [];
  }
  if (!allowEmpty && value.length === 0) blockers.push(`${field.toUpperCase()}_EMPTY:${capabilityId || 'unknown'}`);
  const normalized = [];
  for (const raw of value) {
    const entry = taskClasses ? text(raw) : safeId(raw);
    const valid = taskClasses ? TASK_CLASSES.has(entry) : Boolean(entry);
    if (!valid) {
      blockers.push(`${field.toUpperCase()}_ENTRY_INVALID:${capabilityId || 'unknown'}`);
      continue;
    }
    normalized.push(entry);
  }
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) blockers.push(`${field.toUpperCase()}_DUPLICATE:${capabilityId || 'unknown'}`);
  return unique;
}

function requiresCandidateProof(disposition) {
  return [
    OPENCLAW_UPDATE_DISPOSITION.MIGRATE,
    OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM,
    OPENCLAW_UPDATE_DISPOSITION.IMPROVE,
  ].includes(disposition);
}

function normalizeCapability(raw, blockers) {
  if (!exactKeys(raw, CAPABILITY_KEYS)) {
    blockers.push('CAPABILITY_SCHEMA_INVALID');
    return null;
  }

  const capabilityId = safeId(raw.capabilityId);
  const purpose = safeText(raw.purpose);
  const currentImplementation = safeId(raw.currentImplementation);
  const candidateImplementation = safeId(raw.candidateImplementation);
  const origin = text(raw.origin);
  const candidateOrigin = text(raw.candidateOrigin);
  const protectedCapability = raw.protected === true;
  const lastQualifiedVersion = safeVersion(raw.lastQualifiedVersion);
  const updateDisposition = text(raw.updateDisposition);
  const migrationPolicy = safeText(raw.migrationPolicy);
  const replacementCriteria = safeText(raw.replacementCriteria);

  if (!capabilityId) blockers.push('CAPABILITY_ID_INVALID');
  if (!purpose) blockers.push(`CAPABILITY_PURPOSE_INVALID:${capabilityId || 'unknown'}`);
  if (!currentImplementation) blockers.push(`CURRENT_IMPLEMENTATION_INVALID:${capabilityId || 'unknown'}`);
  if (!ORIGINS.has(origin)) blockers.push(`ORIGIN_INVALID:${capabilityId || 'unknown'}`);
  if (!ORIGINS.has(candidateOrigin)) blockers.push(`CANDIDATE_ORIGIN_INVALID:${capabilityId || 'unknown'}`);
  if (typeof raw.protected !== 'boolean') blockers.push(`PROTECTED_FLAG_INVALID:${capabilityId || 'unknown'}`);
  if (!lastQualifiedVersion) blockers.push(`LAST_QUALIFIED_VERSION_INVALID:${capabilityId || 'unknown'}`);
  if (!DISPOSITIONS.has(updateDisposition)) blockers.push(`UPDATE_DISPOSITION_INVALID:${capabilityId || 'unknown'}`);
  if (!migrationPolicy) blockers.push(`MIGRATION_POLICY_INVALID:${capabilityId || 'unknown'}`);
  if (!replacementCriteria) blockers.push(`REPLACEMENT_CRITERIA_INVALID:${capabilityId || 'unknown'}`);

  const qualificationRefs = normalizeRefArray(raw.qualificationRefs, 'qualificationRefs', capabilityId, blockers);
  const tests = normalizeRefArray(raw.tests, 'tests', capabilityId, blockers);
  const dependencies = normalizeRefArray(raw.dependencies, 'dependencies', capabilityId, blockers);
  const evidenceRefs = normalizeRefArray(raw.evidenceRefs, 'evidenceRefs', capabilityId, blockers);
  const affectedTaskClasses = normalizeRefArray(
    raw.affectedTaskClasses,
    'affectedTaskClasses',
    capabilityId,
    blockers,
    { taskClasses: true },
  );

  if (protectedCapability && updateDisposition === OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE) {
    blockers.push(`PROTECTED_CAPABILITY_BLOCKS_UPDATE:${capabilityId || 'unknown'}`);
  }

  if (requiresCandidateProof(updateDisposition)) {
    if (!candidateImplementation) blockers.push(`CANDIDATE_IMPLEMENTATION_REQUIRED:${capabilityId || 'unknown'}`);
    if (tests.length === 0) blockers.push(`CANDIDATE_TEST_PROOF_REQUIRED:${capabilityId || 'unknown'}`);
    if (evidenceRefs.length === 0) blockers.push(`CANDIDATE_EVIDENCE_REQUIRED:${capabilityId || 'unknown'}`);
  }

  if (updateDisposition === OPENCLAW_UPDATE_DISPOSITION.PRESERVE) {
    if (candidateImplementation !== currentImplementation || candidateOrigin !== origin) {
      blockers.push(`PRESERVE_IDENTITY_CHANGED:${capabilityId || 'unknown'}`);
    }
  }

  if (updateDisposition === OPENCLAW_UPDATE_DISPOSITION.REPLACE_WITH_UPSTREAM) {
    if (origin === OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM) {
      blockers.push(`UPSTREAM_REPLACEMENT_NOT_CUSTOM:${capabilityId || 'unknown'}`);
    }
    if (candidateOrigin !== OPENCLAW_UPDATE_CAPABILITY_ORIGIN.UPSTREAM) {
      blockers.push(`UPSTREAM_REPLACEMENT_ORIGIN_REQUIRED:${capabilityId || 'unknown'}`);
    }
  }

  if (updateDisposition === OPENCLAW_UPDATE_DISPOSITION.MIGRATE
    && candidateImplementation === currentImplementation
    && candidateOrigin === origin) {
    blockers.push(`MIGRATION_HAS_NO_IMPLEMENTATION_CHANGE:${capabilityId || 'unknown'}`);
  }

  if (updateDisposition === OPENCLAW_UPDATE_DISPOSITION.IMPROVE
    && candidateImplementation === currentImplementation
    && candidateOrigin === origin) {
    blockers.push(`IMPROVEMENT_HAS_NO_IMPLEMENTATION_CHANGE:${capabilityId || 'unknown'}`);
  }

  return Object.freeze({
    capabilityId: capabilityId || null,
    purpose: purpose || null,
    currentImplementation: currentImplementation || null,
    candidateImplementation: candidateImplementation || null,
    origin: ORIGINS.has(origin) ? origin : null,
    candidateOrigin: ORIGINS.has(candidateOrigin) ? candidateOrigin : null,
    protected: protectedCapability,
    qualificationRefs: Object.freeze(qualificationRefs),
    tests: Object.freeze(tests),
    dependencies: Object.freeze(dependencies),
    migrationPolicy: migrationPolicy || null,
    replacementCriteria: replacementCriteria || null,
    lastQualifiedVersion: lastQualifiedVersion || null,
    updateDisposition: DISPOSITIONS.has(updateDisposition) ? updateDisposition : null,
    evidenceRefs: Object.freeze(evidenceRefs),
    affectedTaskClasses: Object.freeze(affectedTaskClasses),
  });
}

export function buildOpenClawUpdateCapabilityLedgerV1(input = {}) {
  const blockers = [];
  if (!exactKeys(input, LEDGER_KEYS)) {
    return Object.freeze({
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
      version: OPENCLAW_UPDATE_CAPABILITY_LEDGER_VERSION,
      verdict: 'BLOCK_UPDATE',
      blockers: Object.freeze(['LEDGER_SCHEMA_INVALID']),
      capabilities: Object.freeze([]),
      protectedCapabilityCount: 0,
      dispositionCounts: Object.freeze({}),
      requiredQualificationReplay: Object.freeze([]),
      updateAllowed: false,
    });
  }

  const currentVersion = safeVersion(input.currentVersion);
  const targetVersion = safeVersion(input.targetVersion);
  if (!currentVersion) blockers.push('CURRENT_VERSION_INVALID');
  if (!targetVersion) blockers.push('TARGET_VERSION_INVALID');
  if (!Array.isArray(input.capabilities)) blockers.push('CAPABILITIES_NOT_ARRAY');
  if (Array.isArray(input.capabilities) && input.capabilities.length === 0) blockers.push('CAPABILITIES_EMPTY');
  if (Array.isArray(input.capabilities)
    && input.capabilities.length > OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_CAPABILITIES) {
    blockers.push('CAPABILITY_LIMIT_EXCEEDED');
  }

  const normalized = [];
  const seenIds = new Set();
  if (Array.isArray(input.capabilities)
    && input.capabilities.length <= OPENCLAW_UPDATE_CAPABILITY_LEDGER_MAX_CAPABILITIES) {
    for (const raw of input.capabilities) {
      const capability = normalizeCapability(raw, blockers);
      if (!capability) continue;
      if (capability.capabilityId) {
        if (seenIds.has(capability.capabilityId)) blockers.push(`DUPLICATE_CAPABILITY_ID:${capability.capabilityId}`);
        seenIds.add(capability.capabilityId);
      }
      normalized.push(capability);
    }
  }

  const capabilities = normalized
    .filter((capability) => capability.capabilityId)
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const protectedCapabilities = capabilities.filter((capability) => capability.protected);
  if (protectedCapabilities.length === 0) blockers.push('NO_PROTECTED_CAPABILITIES');

  const replay = new Set();
  for (const capability of protectedCapabilities) {
    if (requiresCandidateProof(capability.updateDisposition)) {
      capability.affectedTaskClasses.forEach((taskClass) => replay.add(taskClass));
    }
  }

  const dispositionCounts = Object.values(OPENCLAW_UPDATE_DISPOSITION).reduce((counts, disposition) => {
    counts[disposition] = protectedCapabilities.filter((capability) => capability.updateDisposition === disposition).length;
    return counts;
  }, {});

  const uniqueBlockers = [...new Set(blockers)].sort();
  const updateAllowed = uniqueBlockers.length === 0;
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
    version: OPENCLAW_UPDATE_CAPABILITY_LEDGER_VERSION,
    currentVersion: currentVersion || null,
    targetVersion: targetVersion || null,
    verdict: updateAllowed ? 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF' : 'BLOCK_UPDATE',
    blockers: Object.freeze(uniqueBlockers),
    capabilities: Object.freeze(capabilities),
    protectedCapabilityCount: protectedCapabilities.length,
    dispositionCounts: Object.freeze(dispositionCounts),
    requiredQualificationReplay: Object.freeze([...replay].sort()),
    updateAllowed,
    authority: Object.freeze({
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      updateExecutionAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      providerQualificationAllowed: false,
      qualificationInvalidationRequired: replay.size > 0,
    }),
  });
}
