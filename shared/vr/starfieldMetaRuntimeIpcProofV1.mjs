// Source-only forensic classifier for original Starfield VR issue #2907.
// It does not read the machine, launch tools, or authorise a runtime workaround.
export const STARFIELD_META_RUNTIME_IPC_PROOF_SCHEMA = 'stephanos.starfield-meta-runtime-ipc-proof.v1';
const SIGNATURE_MODULE = 'runtimeipcserviceclient_64.dll';
const SIGNATURE_EXCEPTION = '0xc0000409';
const SIGNATURE_OFFSET = '0x0000000000248571';

function value(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function fromEvent(input, key, pattern) {
  const supplied = value(input?.[key]);
  if (supplied) return supplied;
  const match = value(input?.message).match(pattern);
  return value(match?.[1]);
}

function normalizeExe(input) {
  return value(input).replace(/^.*[\\/]/, '').toLowerCase();
}

function normalizeHex(input) {
  const cleaned = value(input).toLowerCase();
  return /^0x[0-9a-f]+$/.test(cleaned) ? cleaned : '';
}

function withinSession(eventTime, startedAt, stoppedAt) {
  const observed = Date.parse(value(eventTime));
  const started = Date.parse(value(startedAt));
  const stopped = Date.parse(value(stoppedAt));
  return Number.isFinite(observed) && Number.isFinite(started) && Number.isFinite(stopped)
    && started <= stopped && observed >= started && observed <= stopped + 60_000;
}

export function classifyStarfieldMetaRuntimeIpcFaultV1(event = {}, session = {}) {
  const application = normalizeExe(value(event?.applicationName) || value(event?.processName)
    || fromEvent(event, 'applicationName', /Faulting application name:\s*([^,\r\n]+)/i));
  const moduleName = normalizeExe(fromEvent(event, 'moduleName', /Faulting module name:\s*([^,\r\n]+)/i));
  const exceptionCode = normalizeHex(fromEvent(event, 'exceptionCode', /Exception code:\s*(0x[0-9a-f]+)/i));
  const faultOffset = normalizeHex(fromEvent(event, 'faultOffset', /Fault offset:\s*(0x[0-9a-f]+)/i));
  const applicationMatch = application === 'starfield.exe';
  const familyMatch = applicationMatch
    && moduleName === SIGNATURE_MODULE
    && exceptionCode === SIGNATURE_EXCEPTION;
  const exactSignatureMatch = familyMatch && faultOffset === SIGNATURE_OFFSET;
  const sessionCorrelated = withinSession(
    event?.timeCreatedUtc, session?.startedAtUtc, session?.stoppedAtUtc,
  );
  // A reference is not a verified physical witness; callers must authenticate it.
  const referenced = value(session?.sessionId).length > 0
    && value(session?.evidenceRef).length > 0;
  return Object.freeze({
    schemaVersion: STARFIELD_META_RUNTIME_IPC_PROOF_SCHEMA,
    familyMatch,
    exactSignatureMatch,
    sessionCorrelated,
    evidenceCandidate: exactSignatureMatch && sessionCorrelated && referenced,
    physicallyVerified: false,
    // A repeat of this fingerprint is evidence to investigate, not causal proof.
    aerCausationEstablished: false,
    workaroundAuthorized: false,
    physicalHostMutationAllowed: false,
  });
}

export function assessStarfieldMetaRuntimeIpcRecurrenceV1(observations = []) {
  const sessions = new Set();
  let familyObservationCount = 0;
  for (const row of Array.isArray(observations) ? observations.slice(0, 100) : []) {
    const session = row?.session || {};
    const result = classifyStarfieldMetaRuntimeIpcFaultV1(row?.event || {}, session);
    if (result.familyMatch) familyObservationCount += 1;
    if (result.evidenceCandidate) sessions.add(value(session.sessionId));
  }
  return Object.freeze({
    schemaVersion: STARFIELD_META_RUNTIME_IPC_PROOF_SCHEMA,
    familyObservationCount,
    distinctExactSignatureSessionCount: sessions.size,
    recurrenceCandidate: sessions.size >= 2,
    physicalRecurrenceProven: false,
    aerCausationEstablished: false,
    workaroundAuthorized: false,
    physicalHostMutationAllowed: false,
  });
}
