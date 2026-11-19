import { createHash, createPublicKey, verify } from 'node:crypto';
// Read-only diagnostic display. Never grants a lease, source writer,
// worker action, signed capacity, protected review or merge authority.
export const GOAL_BUILD_GATE_SCHEMA_V1 = 'stephanos.goal-build-gate-observation.v1';
export const GOAL_GATE_SIGNATURE_DOMAIN = 'stephanos.goal-build-gate-observation.v1\\0';
export const GOAL_BUILD_GATE_OBSERVATORY_SCHEMA_V1 = 'stephanos.goal-build-gate-observatory.v1';

const define = (id, group, title, owner, prerequisites = []) =>
  Object.freeze({ id, group, title, owner, prerequisites: Object.freeze(prerequisites) });

export const GOAL_BUILD_GATE_DEFINITIONS_V1 = Object.freeze([
  define(1, 'Identity & selection', 'Authenticated command and terminal receipt', 'Sovereign Commander mailbox'),
  define(2, 'Identity & selection', 'Exact canonical main and runtime source', 'Battle Bridge source watcher', [1]),
  define(3, 'Identity & selection', 'Core singleton and worker heartbeat', 'Core daemon supervisor', [2]),
  define(4, 'Identity & selection', 'Durable goal and unique mission identity', 'Mission store', [2]),
  define(5, 'Identity & selection', 'Source, phase and parked eligibility', 'Goal admission service', [4]),
  define(6, 'Identity & selection', 'Scheduler selection and capacity readiness', 'Programme scheduler', [4]),
  define(7, 'Programme & custody', 'Authoritative Programme Authority admission', 'Programme Authority', [5, 6]),
  define(8, 'Programme & custody', 'Exclusive original source lease', 'Source mutation lease authority', [4]),
  define(9, 'Programme & custody', 'Original execution and terminal receipt', 'Original writer execution ledger', [8]),
  define(10, 'Programme & custody', 'Independent physical Windows exclusion witness', 'Windows OS custody witness', [9]),
  define(11, 'Programme & custody', 'Separately signed operator quarantine approval', 'Protected operator approval', [10]),
  define(12, 'Programme & custody', 'Safe original writer quarantine and readmission', 'Original source attempt fence', [8, 10, 11]),
  define(13, 'Capacity & dispatch', 'Signed native capacity and exact source head', 'Native capacity publisher', [2]),
  define(14, 'Capacity & dispatch', 'Disjoint resource scopes', 'Capacity router', [5]),
  define(15, 'Capacity & dispatch', 'Available admitted provider capacity', 'Provider and model router', [13]),
  define(16, 'Capacity & dispatch', 'Distinct worker identity and scoped action grant', 'Mission Worker grant authority', [7, 13, 14, 15]),
  define(17, 'Capacity & dispatch', 'Durable dispatch and publication acknowledgement', 'Mission Worker queue', [16]),
  define(18, 'Physical execution', 'Atomic CLAIM and exclusive writer', 'Mission Worker lease/claim', [12, 17]),
  define(19, 'Physical execution', 'Physical PICKUP and STARTED receipt', 'Battle Bridge worker', [18]),
  define(20, 'Physical execution', 'Source diff, tests and terminal execution proof', 'Builder execution proof', [19]),
  define(21, 'Review & completion', 'Exact PR, tests and independent qualified review', 'Independent review', [20]),
  define(22, 'Review & completion', 'Owner-authorised protected merge and rulesets', 'Protected merge authority', [21]),
  define(23, 'Review & completion', 'Exact-main deployment and two unattended refills', 'Core and Mission completion', [22]),
]);

const SHA = /^[a-f0-9]{40}$/;
const SAFE_REF = /^(?:workspace:|receipt:|github:|https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/)[^\s\x00-\x1f]{1,480}$/;
const SAFE_BLOCKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const MAX_CLOCK_SKEW_MS = 60_000;
const DEFAULT_MAX_AGE_MS = 10 * 60_000;
const VALID = new Set(['PASS', 'FAIL']);

function time(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function projectGoalBuildGateObservatoryV1({
  statusRecords = [], proofRecords = [], expectedSourceHead = '',
  trustedPublicKeyPem = '', trustedPublicKeySha256 = '',
  nowMs = Date.now(), staleAfterMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const maxAge = Math.min(Math.max(1000, Number(staleAfterMs) || DEFAULT_MAX_AGE_MS), DEFAULT_MAX_AGE_MS);
  // A generic workspace status is NOT a security witness. Authenticate the
  // protected publisher's Ed25519 signature, externally pinned key and
  // canonical head, then resolve every exact immutable proof record. Neither
  // a status-record flag nor a plausible-looking receipt: URL is sufficient.
  const trustedHead = String(expectedSourceHead || '').toLowerCase();
  let key = null;
  try {
    if (SHA.test(trustedHead) && typeof trustedPublicKeyPem === 'string'
      && /^[a-f0-9]{64}$/.test(String(trustedPublicKeySha256 || ''))
      && createHash('sha256').update(trustedPublicKeyPem).digest('hex') === trustedPublicKeySha256) {
      key = createPublicKey(trustedPublicKeyPem);
      if (key.asymmetricKeyType !== 'ed25519') key = null;
    }
  } catch { key = null; }
  const knownProofs = Array.isArray(proofRecords) ? proofRecords : [];
  const evidence = key
    ? (Array.isArray(statusRecords) ? statusRecords : [])
      .filter(record => ['status', 'stephanos.shared_workspace.status'].includes(record?.kind)
        && record?.statusId === 'goal-build-gates-current'
        && record?.participantId === 'stephanos-core')
      .map(record => record.goalBuildGateEvidence)
      .filter(e => e?.schemaVersion === GOAL_BUILD_GATE_SCHEMA_V1
        && e?.publisherId === 'stephanos-core'
        && e?.signingKeyId === 'stephanos-goal-build-gates-v1'
        && e?.sourceHead === trustedHead
        && Array.isArray(e?.gates) && e.gates.length <= GOAL_BUILD_GATE_DEFINITIONS_V1.length
        && Number.isFinite(time(e.observedAtUtc))
        && time(e.observedAtUtc) <= nowMs + MAX_CLOCK_SKEW_MS
        && typeof e.signatureBase64 === 'string')
      .filter(e => {
        const signed = Object.freeze({
          schemaVersion: e.schemaVersion, publisherId: e.publisherId,
          signingKeyId: e.signingKeyId, sourceHead: e.sourceHead,
          observedAtUtc: e.observedAtUtc, gates: e.gates,
        });
        try {
          const sig = Buffer.from(e.signatureBase64, 'base64');
          if (sig.length !== 64 || sig.toString('base64') !== e.signatureBase64
            || !verify(null, Buffer.from(GOAL_GATE_SIGNATURE_DOMAIN + JSON.stringify(signed)), key, sig)) return false;
        } catch { return false; }
        return e.gates.every(g => {
          const id = /^workspace:proof\/([A-Za-z0-9][A-Za-z0-9._-]{1,100})$/.exec(String(g?.proofRef || ''))?.[1];
          const proofDigest = String(g?.proofRecordSha256 || '');
          if (!id || !/^[a-f0-9]{64}$/.test(proofDigest)) return false;
          const matches = knownProofs.filter(p => ['proof', 'stephanos.shared_workspace.proof'].includes(p?.kind)
            && p?.proofId === id && p?.sourceHead === trustedHead
            && time(p.timestampUtc) <= time(e.observedAtUtc) + MAX_CLOCK_SKEW_MS
            && nowMs - time(p.timestampUtc) <= maxAge
            && createHash('sha256').update(JSON.stringify(p)).digest('hex') === proofDigest);
          return matches.length === 1;
        });
      })
      .sort((a, b) => time(b.observedAtUtc) - time(a.observedAtUtc))[0] || null
    : null;
  const observedAtUtc = evidence?.observedAtUtc || '';
  const sourceHead = evidence?.sourceHead || '';
  const expired = evidence ? nowMs - time(observedAtUtc) > maxAge : false;
  const byId = new Map();
  for (const raw of evidence?.gates || []) {
    if (!GOAL_BUILD_GATE_DEFINITIONS_V1.some(item => item.id === raw?.id)
      || byId.has(raw.id)) continue;
    const state = String(raw.status || '').toUpperCase();
    const proofRef = String(raw.proofRef || '');
    const blocker = String(raw.typedBlocker || '');
    const sampledAtMs = time(raw.observedAtUtc);
    if (!VALID.has(state)
      || raw.sourceHead !== sourceHead
      || !SAFE_REF.test(proofRef)
      || !Number.isFinite(sampledAtMs)
      || sampledAtMs > nowMs + MAX_CLOCK_SKEW_MS
      || sampledAtMs > time(observedAtUtc) + MAX_CLOCK_SKEW_MS
      || state === 'FAIL' && !SAFE_BLOCKER.test(blocker)) continue;
    byId.set(raw.id, Object.freeze({
      status: expired || nowMs - sampledAtMs > maxAge ? 'STALE' : state,
      proofRef, observedAtUtc: raw.observedAtUtc,
      typedBlocker: state === 'FAIL' ? blocker : '',
    }));
  }
  const all = new Map();
  const gates = GOAL_BUILD_GATE_DEFINITIONS_V1.map(def => {
    const observed = byId.get(def.id);
    const priorFail = def.prerequisites.find(id =>
      ['FAIL', 'WAITING_FOR_PREREQUISITE'].includes(all.get(id)?.status));
    const status = observed?.status || (priorFail ? 'WAITING_FOR_PREREQUISITE' : 'UNVERIFIED');
    const gate = Object.freeze({
      ...def, status,
      proofRef: observed?.proofRef || '',
      observedAtUtc: observed?.observedAtUtc || '',
      typedBlocker: observed?.typedBlocker || '',
      waitingOnGate: observed ? null : priorFail || null,
    });
    all.set(def.id, gate);
    return gate;
  });
  const firstActionable = gates.find(gate => gate.status === 'FAIL') || null;
  const allFailures = gates.filter(gate => gate.status === 'FAIL');
  return Object.freeze({
    schemaVersion: GOAL_BUILD_GATE_OBSERVATORY_SCHEMA_V1,
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead, observedAtUtc,
    observationStatus: !evidence ? 'UNVERIFIED' : expired ? 'STALE' : 'EVIDENCE_AVAILABLE',
    firstActionableGate: firstActionable?.id || null,
    simultaneousVetoes: Object.freeze(allFailures.map(gate => gate.id)),
    counts: Object.freeze(Object.fromEntries(
      ['PASS', 'FAIL', 'WAITING_FOR_PREREQUISITE', 'UNVERIFIED', 'STALE']
        .map(status => [status, gates.filter(g => g.status === status).length]),
    )),
    gates: Object.freeze(gates),
    exactNextAction: firstActionable
      ? 'Resolve gate ' + firstActionable.id + ' with its responsible authority and independent proof.'
      : 'Acquire fresh, exact-source per-gate proof without changing any authority.',
  });
}
