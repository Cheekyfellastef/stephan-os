// Read-only bridge from the backend's signature-checked 23-gate projection
// to Skill Forge review. No client-supplied gate status grants source, tool,
// installation, reviewer, lease or protected-merge authority.
export const GATE_SKILL_INTAKE_SCHEMA_V1 = 'stephanos.gate-skill-intake.v1';
const HEAD = /^[0-9a-f]{40}$/;
const REASON = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const MAX_AGE_MS = 10 * 60_000;
const GATE_COUNT = 23;
const EXTERNAL_AUTHORITY_GATES = new Set([1, 7, 8, 9, 10, 11, 12, 16, 21, 22, 23]);
const MISSING_CAPABILITY = /(?:^|[.:_-])(?:(?:SKILL|CAPABILITY|TOOL|FIXED_VERB)[.:_-](?:MISSING|UNAVAILABLE|UNSUPPORTED|NOT_FOUND)|(?:MISSING|UNAVAILABLE|UNSUPPORTED|NOT_FOUND)[.:_-](?:SKILL|CAPABILITY|TOOL|FIXED_VERB))(?:$|[.:_-])/i;
const text = value => String(value ?? '').trim();

function empty(reason) {
  return Object.freeze({
    schemaVersion: GATE_SKILL_INTAKE_SCHEMA_V1,
    sourceTruth: 'UNVERIFIED',
    reason,
    requests: Object.freeze([]),
    skillCandidates: Object.freeze([]),
    summary: Object.freeze({ failedGateCount: 0, skillReviewDraftCount: 0 }),
    autoInstallAllowed: false, executeAllowed: false,
    approvalAuthority: false, mergeAuthority: false, leaseOverrideAllowed: false,
  });
}

function nextOwnerAction(gate) {
  if (gate.id === 8) return 'Request independent Windows source-custody evidence; never override the original writer lease.';
  if (gate.id === 9) return 'Locate the original terminal execution receipt in the qualified writer ledger.';
  if (gate.id === 10) return 'Obtain an independently commissioned and signed physical Windows exclusion witness.';
  if (gate.id === 11) return 'Request a separately signed protected operator approval after independent custody proof.';
  if (gate.id === 13) return 'Reuse the signed native-capacity readback and independently reviewed publisher recovery route.';
  return 'Ask the existing gate owner for an exact-source bounded repair and physical verification, reusing qualified tools first.';
}

// The backend verifies the pinned Ed25519 gate publisher, immutable proof
// records, source revision and freshness before exposing this projection.
// This consumer additionally fails closed on stale, inconsistent or forged
// projection shape. It never verifies cryptographic authority in the browser.
export function deriveGateSkillIntakeV1(ledger, { feedState = 'unavailable', nowMs = Date.now() } = {}) {
  if (feedState !== 'ready') return empty('SHARED_WORKSPACE_FEED_NOT_READY');
  if (!ledger || ledger.schemaVersion !== 'stephanos.goal-build-gate-observatory.v1'
    || ledger.diagnosticOnly !== true || ledger.approvalAuthority !== false
    || ledger.mergeAuthority !== false || ledger.observationStatus !== 'EVIDENCE_AVAILABLE'
    || !HEAD.test(text(ledger.sourceHead)) || !Array.isArray(ledger.gates)
    || ledger.gates.length !== GATE_COUNT) return empty('SIGNED_GATE_PROJECTION_NOT_VERIFIED');
  const observedMs = Date.parse(text(ledger.observedAtUtc));
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs)
    || nowMs - observedMs > MAX_AGE_MS || observedMs - nowMs > 60_000) {
    return empty('SIGNED_GATE_PROJECTION_STALE');
  }
  const ids = new Set();
  for (const gate of ledger.gates) {
    if (!Number.isInteger(gate?.id) || gate.id < 1 || gate.id > GATE_COUNT || ids.has(gate.id)
      || !['PASS', 'FAIL', 'WAITING_FOR_PREREQUISITE', 'UNVERIFIED', 'STALE'].includes(gate.status)) {
      return empty('SIGNED_GATE_PROJECTION_INCONSISTENT');
    }
    ids.add(gate.id);
  }
  const failures = ledger.gates.filter(gate => gate.status === 'FAIL');
  if (failures.some(gate => !REASON.test(text(gate.typedBlocker))
    || !/^workspace:proof\/[A-Za-z0-9][A-Za-z0-9._-]{1,100}$/.test(text(gate.proofRef)))) {
    return empty('SIGNED_GATE_PROJECTION_INCONSISTENT');
  }
  const requests = failures.map(gate => {
    const externalEvidence = EXTERNAL_AUTHORITY_GATES.has(gate.id);
    const missingCapability = MISSING_CAPABILITY.test(gate.typedBlocker);
    return Object.freeze({
      gateId: gate.id,
      title: text(gate.title).slice(0, 120),
      owner: text(gate.owner).slice(0, 120),
      blocker: gate.typedBlocker,
      proofRef: gate.proofRef,
      sourceHead: ledger.sourceHead,
      route: externalEvidence ? 'EXISTING_AUTHORITY_EVIDENCE_REQUIRED'
        : missingCapability ? 'SKILL_REVIEW_DRAFT'
          : 'REUSE_OR_DIAGNOSE_EXISTING_CAPABILITY',
      nextAction: nextOwnerAction(gate),
      mutationAuthorized: false,
    });
  });
  const skillCandidates = requests
    .filter(item => item.route === 'SKILL_REVIEW_DRAFT')
    .map(item => Object.freeze({
      id: 'gate-' + item.gateId + '-capability-' + item.sourceHead.slice(0, 12),
      name: 'Gate ' + item.gateId + ': review missing capability',
      category: 'Signed Observatory capability-gap review',
      status: 'DRAFT',
      riskLevel: 'HIGH',
      permissionLevel: 'PROPOSE_ONLY',
      plainEnglishSummary: 'Review whether gate ' + item.gateId + ' needs a vetted existing skill or a scoped new capability.',
      whySuggested: item.blocker + ' · Source ' + item.sourceHead + ' · Owner: ' + item.owner,
      allowedTouches: ['Read source-bound gate proof; search existing qualified skills; propose a bounded testable repair'],
      forbiddenTouches: [
        'No auto-install, shell, tool grant, privileged Windows action, lease change or protected merge.',
        'Do not confuse an observed missing capability with an approved or installed skill.',
      ],
      rollbackPath: 'Discard the proposal without changing the canonical gate, lease or runtime.',
      evidence: [{ type: 'verified-gate-projection', summary: item.proofRef }],
      tags: ['troubleshooting', 'needs-approval'],
      provenance: 'GATE_FAILURE_REVIEW_DRAFT_NOT_INSTALLED',
      targetGateId: item.gateId,
      sourceHead: item.sourceHead,
    }));
  return Object.freeze({
    schemaVersion: GATE_SKILL_INTAKE_SCHEMA_V1,
    sourceTruth: 'BACKEND_VERIFIED_GATE_PROJECTION',
    reason: 'Read-only exact-head triage from signed Shared Workspace gate ledger',
    sourceHead: ledger.sourceHead,
    observedAtUtc: ledger.observedAtUtc,
    requests: Object.freeze(requests),
    skillCandidates: Object.freeze(skillCandidates),
    summary: Object.freeze({ failedGateCount: requests.length, skillReviewDraftCount: skillCandidates.length }),
    autoInstallAllowed: false, executeAllowed: false,
    approvalAuthority: false, mergeAuthority: false, leaseOverrideAllowed: false,
  });
}
