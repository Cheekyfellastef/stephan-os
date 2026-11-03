export const CAPABILITY_READINESS_SCHEMA = 'stephanos.vr-capability-readiness.v1';

export const CAPABILITY_READINESS_STAGES = Object.freeze([
  Object.freeze({ id: 'design', label: 'design/spec', weight: 10 }),
  Object.freeze({ id: 'implementation', label: 'implementation', weight: 30 }),
  Object.freeze({ id: 'automatedProof', label: 'automated proof', weight: 20 }),
  Object.freeze({ id: 'runtimeProof', label: 'runtime proof', weight: 20 }),
  Object.freeze({ id: 'operatorAcceptance', label: 'operator acceptance', weight: 20 }),
]);

const TOTAL_WEIGHT = CAPABILITY_READINESS_STAGES.reduce((sum, stage) => sum + stage.weight, 0);

function safeDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function scoreCapabilityEntry(entry = {}) {
  const stages = entry?.stages && typeof entry.stages === 'object' ? entry.stages : {};
  const evaluated = CAPABILITY_READINESS_STAGES.map((definition) => {
    const record = stages[definition.id] && typeof stages[definition.id] === 'object' ? stages[definition.id] : {};
    const proven = String(record.status || 'pending').toLowerCase() === 'proven';
    return Object.freeze({
      ...definition,
      status: proven ? 'proven' : 'pending',
      proven,
      earned: proven ? definition.weight : 0,
      evidence: Object.freeze(Array.isArray(record.evidence) ? record.evidence.map(String) : []),
      note: String(record.note || ''),
    });
  });
  const percent = evaluated.reduce((sum, stage) => sum + stage.earned, 0);
  return Object.freeze({ percent, total: TOTAL_WEIGHT, gates: Object.freeze(evaluated), complete: percent === TOTAL_WEIGHT && evaluated.every((stage) => stage.proven) });
}

export function capabilityReadinessForConcept(ledger, conceptId, { nowMs = Date.now() } = {}) {
  if (!ledger || ledger.schemaVersion !== CAPABILITY_READINESS_SCHEMA) {
    return Object.freeze({ available: false, stale: false, reason: 'ledger-unavailable', percent: null, gates: Object.freeze([]) });
  }
  const entry = Array.isArray(ledger.capabilities) ? ledger.capabilities.find((candidate) => String(candidate?.id || '') === String(conceptId || '')) : null;
  if (!entry) {
    return Object.freeze({ available: false, stale: false, reason: 'capability-unregistered', percent: null, gates: Object.freeze([]), updatedAt: String(ledger.updatedAt || ''), sourceHead: String(ledger.sourceHead || '') });
  }
  const evidenceUpdatedAt = String(entry.updatedAt || ledger.updatedAt || '');
  const updatedAtMs = safeDateMs(evidenceUpdatedAt);
  const staleAfterHours = Math.max(1, Number(entry.staleAfterHours ?? ledger.staleAfterHours) || 336);
  const ageHours = updatedAtMs ? Math.max(0, (Number(nowMs) - updatedAtMs) / 3_600_000) : Number.POSITIVE_INFINITY;
  if (!updatedAtMs || ageHours > staleAfterHours) {
    return Object.freeze({ available: false, stale: true, reason: 'capability-evidence-stale', percent: null, gates: Object.freeze([]), updatedAt: evidenceUpdatedAt, sourceHead: String(ledger.sourceHead || ''), ageHours });
  }
  const scored = scoreCapabilityEntry(entry);
  return Object.freeze({
    available: true,
    stale: false,
    reason: '',
    id: String(entry.id || ''),
    percent: scored.percent,
    complete: scored.complete,
    gates: scored.gates,
    visual: Object.freeze({ ...(entry.visual || {}) }),
    updatedAt: evidenceUpdatedAt,
    sourceHead: String(ledger.sourceHead || ''),
    ageHours,
  });
}

export function capabilityReadinessSummary(result = {}) {
  if (!result.available) return result.stale ? 'Capability evidence is stale, so Stephanos is refusing to guess.' : 'Capability evidence is unavailable, so Stephanos is refusing to guess.';
  const proven = result.gates.filter((gate) => gate.proven).map((gate) => gate.label);
  const pending = result.gates.filter((gate) => !gate.proven).map((gate) => gate.label);
  return `${result.percent}% capability readiness · ${proven.length ? `${proven.join(', ')} proven` : 'no proof stages proven'} · ${pending.length ? `${pending.join(', ')} still unproven` : 'all stages proven'}.`;
}

export function maturityBandForPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 'unavailable';
  if (value >= 100) return 'accepted';
  if (value >= 80) return 'runtime-like';
  if (value >= 60) return 'proof-backed';
  if (value >= 40) return 'prototype';
  return 'design-grounded';
}
