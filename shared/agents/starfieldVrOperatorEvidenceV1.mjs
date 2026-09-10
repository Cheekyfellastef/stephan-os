export const STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA = 'stephanos.starfield-vr-operator-evidence.v1';

const SAFE_SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MAX_EVIDENCE_ITEMS = 64;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CANONICAL_ASSESSMENTS = new WeakSet();

function deepFreezeOwned(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) deepFreezeOwned(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export const STARFIELD_VR_EVIDENCE_FRONTS = deepFreezeOwned([
  { id: 'source-baseline', evidenceClass: 'source', label: 'Starfield VR source baseline' },
  { id: 'launch-policy', evidenceClass: 'source', label: 'Deterministic launch policy' },
  { id: 'in-game-transition', evidenceClass: 'runtime', label: 'Flat-to-VR in-game transition' },
  { id: 'overlay-dashboard', evidenceClass: 'runtime', label: 'VR overlay and dashboard observability' },
  { id: 'save-rollback', evidenceClass: 'runtime', label: 'Save protection and known-good rollback' },
  { id: 'failure-remediation', evidenceClass: 'runtime', label: 'Failure evidence and remediation path' },
  { id: 'quest3-headset', evidenceClass: 'physical', label: 'Quest 3 physical-headset acceptance' },
  { id: 'controller-anchoring', evidenceClass: 'physical', label: 'Controller mapping and seated anchoring' },
  { id: 'comfort-responsiveness', evidenceClass: 'physical', label: 'Comfort and responsiveness acceptance' },
]);

const FRONT_BY_ID = new Map(STARFIELD_VR_EVIDENCE_FRONTS.map((front) => [front.id, front]));

export const STARFIELD_VR_OPERATOR_EVIDENCE_BOUNDARY = deepFreezeOwned({
  authority: 'read-only-evidence-convergence',
  sourceAuthority: 'exact-head-source-proof-only',
  runtimeAuthority: 'external-runtime-receipt-only',
  physicalAuthority: 'explicit-operator-headset-receipt-only',
  mutations: false,
  launchAuthority: false,
  installAuthority: false,
  deploymentAuthority: false,
  mergeAuthority: false,
  liveClaimAuthority: false,
  summary: 'This contract classifies supplied evidence references. It never launches Starfield, installs software, writes saves, deploys, merges, or turns a source/runtime/headset claim into proof by itself.',
});

function readPlainRecord(input) {
  try {
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function readEvidenceArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_EVIDENCE_ITEMS) return null;
    if (keys.some((key) => typeof key !== 'string') || keys.length !== length + 1) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return null;
  }
}

function strictUtcTimestamp(value, assessmentTimeMs) {
  if (typeof value !== 'string' || !SAFE_TIMESTAMP.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  const observedAtMs = Date.parse(value);
  if (Number.isNaN(observedAtMs) || !Number.isFinite(assessmentTimeMs)) return false;
  return observedAtMs <= assessmentTimeMs + MAX_FUTURE_CLOCK_SKEW_MS;
}

function normalizeEvidenceItem(value, expectedClass, exactHeadSha, assessmentTimeMs) {
  const record = readPlainRecord(value);
  if (!record) return null;
  const allowed = expectedClass === 'physical'
    ? ['frontId', 'evidenceClass', 'verdict', 'proofId', 'headSha', 'observedAt', 'deviceId', 'operatorReceiptId']
    : expectedClass === 'runtime'
      ? ['frontId', 'evidenceClass', 'verdict', 'proofId', 'headSha', 'observedAt', 'runtimeIdentity']
      : ['frontId', 'evidenceClass', 'verdict', 'proofId', 'headSha', 'observedAt'];
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key))) return null;
  if (!SAFE_ID.test(record.frontId || '') || !SAFE_ID.test(record.proofId || '')) return null;
  if (record.evidenceClass !== expectedClass || record.verdict !== 'PASS') return null;
  if (record.headSha !== exactHeadSha || !SAFE_SHA.test(record.headSha || '')) return null;
  if (!strictUtcTimestamp(record.observedAt, assessmentTimeMs)) return null;
  const front = FRONT_BY_ID.get(record.frontId);
  if (!front || front.evidenceClass !== expectedClass) return null;
  if (expectedClass === 'runtime' && !SAFE_ID.test(record.runtimeIdentity || '')) return null;
  if (expectedClass === 'physical') {
    if (record.deviceId !== 'quest-3' || !SAFE_ID.test(record.operatorReceiptId || '')) return null;
  }
  return Object.freeze({ ...record });
}

function collectClassEvidence(value, expectedClass, exactHeadSha, assessmentTimeMs) {
  const array = readEvidenceArray(value);
  if (!array) return { valid: false, items: [] };
  const seenFronts = new Set();
  const items = [];
  for (const candidate of array) {
    const item = normalizeEvidenceItem(candidate, expectedClass, exactHeadSha, assessmentTimeMs);
    if (!item || seenFronts.has(item.frontId)) return { valid: false, items: [] };
    seenFronts.add(item.frontId);
    items.push(item);
  }
  return { valid: true, items };
}

function missingFronts(items, evidenceClass) {
  const present = new Set(items.map((item) => item.frontId));
  return STARFIELD_VR_EVIDENCE_FRONTS
    .filter((front) => front.evidenceClass === evidenceClass && !present.has(front.id))
    .map((front) => front.id);
}

function result(status, blockerClass, exactHeadSha, sourceEvidence, runtimeEvidence, physicalEvidence, missing) {
  const assessment = deepFreezeOwned({
    schema: STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA,
    status,
    blockerClass,
    exactHeadSha,
    evidenceCounts: {
      source: sourceEvidence.length,
      runtime: runtimeEvidence.length,
      physical: physicalEvidence.length,
    },
    missing,
    evidenceRefs: {
      source: sourceEvidence.map(({ frontId, proofId }) => ({ frontId, proofId })),
      runtime: runtimeEvidence.map(({ frontId, proofId, runtimeIdentity }) => ({ frontId, proofId, runtimeIdentity })),
      physical: physicalEvidence.map(({ frontId, proofId, deviceId, operatorReceiptId }) => ({ frontId, proofId, deviceId, operatorReceiptId })),
    },
    boundary: STARFIELD_VR_OPERATOR_EVIDENCE_BOUNDARY,
  });
  CANONICAL_ASSESSMENTS.add(assessment);
  return assessment;
}

export function assessStarfieldVrOperatorEvidence(input) {
  const assessmentTimeMs = Date.now();
  const record = readPlainRecord(input);
  const invalid = () => result('BLOCKED', 'PRODUCT_SOURCE_GAP', '', [], [], [], {
    source: STARFIELD_VR_EVIDENCE_FRONTS.filter((front) => front.evidenceClass === 'source').map((front) => front.id),
    runtime: STARFIELD_VR_EVIDENCE_FRONTS.filter((front) => front.evidenceClass === 'runtime').map((front) => front.id),
    physical: STARFIELD_VR_EVIDENCE_FRONTS.filter((front) => front.evidenceClass === 'physical').map((front) => front.id),
  });
  if (!record) return invalid();
  const allowed = ['exactHeadSha', 'sourceEvidence', 'runtimeEvidence', 'physicalEvidence'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return invalid();
  if (!SAFE_SHA.test(record.exactHeadSha || '') || !Number.isFinite(assessmentTimeMs)) return invalid();

  const source = collectClassEvidence(record.sourceEvidence, 'source', record.exactHeadSha, assessmentTimeMs);
  const runtime = collectClassEvidence(record.runtimeEvidence, 'runtime', record.exactHeadSha, assessmentTimeMs);
  const physical = collectClassEvidence(record.physicalEvidence, 'physical', record.exactHeadSha, assessmentTimeMs);
  if (!source.valid || !runtime.valid || !physical.valid) return invalid();

  const missing = {
    source: missingFronts(source.items, 'source'),
    runtime: missingFronts(runtime.items, 'runtime'),
    physical: missingFronts(physical.items, 'physical'),
  };

  if (missing.source.length > 0) {
    return result('BLOCKED', 'PRODUCT_SOURCE_GAP', record.exactHeadSha, source.items, runtime.items, physical.items, missing);
  }
  if (missing.runtime.length > 0) {
    return result('RUNTIME_PROOF_REQUIRED', 'CONSTRUCTION_RUNTIME_GAP', record.exactHeadSha, source.items, runtime.items, physical.items, missing);
  }
  if (missing.physical.length > 0) {
    return result('PHYSICAL_HEADSET_REQUIRED', 'OPERATOR_PHYSICAL_TEST_REQUIRED', record.exactHeadSha, source.items, runtime.items, physical.items, missing);
  }
  return result('EVIDENCE_COMPLETE', null, record.exactHeadSha, source.items, runtime.items, physical.items, missing);
}

function expectedFrontCount(evidenceClass) {
  return STARFIELD_VR_EVIDENCE_FRONTS.filter((front) => front.evidenceClass === evidenceClass).length;
}

function validatedAssessmentForPlan(assessment) {
  if (!assessment || typeof assessment !== 'object' || !CANONICAL_ASSESSMENTS.has(assessment)) return null;
  const record = readPlainRecord(assessment);
  if (!record || record.schema !== STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA || !SAFE_SHA.test(record.exactHeadSha || '')) return null;

  const missing = readPlainRecord(record.missing);
  const counts = readPlainRecord(record.evidenceCounts);
  if (!missing || !counts) return null;
  const missingSource = readEvidenceArray(missing.source);
  const missingRuntime = readEvidenceArray(missing.runtime);
  const missingPhysical = readEvidenceArray(missing.physical);
  if (!missingSource || !missingRuntime || !missingPhysical) return null;
  if (missingSource.some((id) => typeof id !== 'string')
    || missingRuntime.some((id) => typeof id !== 'string')
    || missingPhysical.some((id) => typeof id !== 'string')) return null;

  const countKeys = Object.keys(counts).sort();
  if (JSON.stringify(countKeys) !== JSON.stringify(['physical', 'runtime', 'source'])) return null;
  if (![counts.source, counts.runtime, counts.physical].every((count) => Number.isSafeInteger(count) && count >= 0)) return null;

  const sourceCount = expectedFrontCount('source');
  const runtimeCount = expectedFrontCount('runtime');
  const physicalCount = expectedFrontCount('physical');

  if (record.status === 'EVIDENCE_COMPLETE') {
    if (record.blockerClass !== null
      || missingSource.length !== 0
      || missingRuntime.length !== 0
      || missingPhysical.length !== 0
      || counts.source !== sourceCount
      || counts.runtime !== runtimeCount
      || counts.physical !== physicalCount) return null;
    return { record, missingPhysical, complete: true };
  }

  const allowedPhysical = new Set(
    STARFIELD_VR_EVIDENCE_FRONTS
      .filter((front) => front.evidenceClass === 'physical')
      .map((front) => front.id),
  );
  if (record.status !== 'PHYSICAL_HEADSET_REQUIRED'
    || record.blockerClass !== 'OPERATOR_PHYSICAL_TEST_REQUIRED'
    || missingSource.length !== 0
    || missingRuntime.length !== 0
    || missingPhysical.length === 0
    || new Set(missingPhysical).size !== missingPhysical.length
    || missingPhysical.some((id) => !allowedPhysical.has(id))
    || counts.source !== sourceCount
    || counts.runtime !== runtimeCount
    || counts.physical !== physicalCount - missingPhysical.length) return null;

  return { record, missingPhysical, complete: false };
}

export function buildStarfieldVrOperatorTestPlan(assessment) {
  const validated = validatedAssessmentForPlan(assessment);
  if (!validated) {
    return deepFreezeOwned({ schema: STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA, status: 'INVALID_ASSESSMENT', steps: [] });
  }
  if (validated.complete) {
    return deepFreezeOwned({ schema: STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA, status: 'NO_PHYSICAL_TEST_PENDING', steps: [] });
  }
  const physicalFronts = new Set(validated.missingPhysical);
  const steps = STARFIELD_VR_EVIDENCE_FRONTS
    .filter((front) => front.evidenceClass === 'physical' && physicalFronts.has(front.id))
    .map((front) => ({
      frontId: front.id,
      label: front.label,
      requires: ['explicit operator action', 'Quest 3', 'approved runtime state'],
      authority: 'observation-only',
    }));
  return deepFreezeOwned({ schema: STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA, status: 'OPERATOR_TEST_REQUIRED', steps });
}
