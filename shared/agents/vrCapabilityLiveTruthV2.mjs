import { projectVrCapabilityLiveState, VR_CAPABILITY_LIVE_FEED_SCHEMA } from './vrCapabilityLiveProjectionV1.mjs';

const STAGES = Object.freeze(['design', 'implementation', 'automatedProof', 'runtimeProof', 'operatorAcceptance']);
const WEIGHTS = Object.freeze({ design: 10, implementation: 30, automatedProof: 20, runtimeProof: 20, operatorAcceptance: 20 });
const PASS = new Set(['PASS', 'PASSED', 'PROVEN', 'ACCEPTED', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE']);
const FAIL = new Set(['FAIL', 'FAILED', 'BLOCKED', 'REJECTED', 'REVOKED', 'INVALID', 'UNAVAILABLE']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function timestamp(record = {}) {
  return text(record.timestampUtc || record.checkedAtUtc || record.publishedAtUtc || record.updatedAt || record.createdAt);
}

function signalTime(record = {}, index = 0) {
  const parsed = Date.parse(timestamp(record));
  return Number.isFinite(parsed) ? parsed : -index;
}

function verdict(record = {}) {
  let body = {};
  if (record.body && typeof record.body === 'object') body = record.body;
  else if (typeof record.body === 'string') {
    try { body = JSON.parse(record.body); } catch {}
  }
  if ([record.passed, record.proven, record.accepted, body.passed, body.proven, body.accepted].some((value) => value === true)) return 'pass';
  if ([record.passed, record.proven, record.accepted, body.passed, body.proven, body.accepted].some((value) => value === false)) return 'fail';
  const value = text(record.status || record.verdict || record.outcome || body.status || body.verdict || body.outcome).toUpperCase();
  if (PASS.has(value)) return 'pass';
  if (FAIL.has(value)) return 'fail';
  return '';
}

function canonicalSignals(records = {}) {
  const all = [
    ...array(records.proofRecords),
    ...array(records.capabilityRecords),
    ...array(records.statusRecords),
    ...array(records.receiptRecords),
  ];
  const latest = new Map();
  for (const [index, record] of all.entries()) {
    const state = verdict(record);
    if (!state) continue;
    const refs = [...array(record.proofRefs), ...array(record.refs)];
    for (const ref of refs) {
      const match = text(ref).match(/^(?:proof|proofs)\/vr-capability\/([a-z0-9._-]+)\/(design|implementation|automatedProof|runtimeProof|operatorAcceptance)$/i);
      if (!match) continue;
      const id = match[1];
      const stage = STAGES.find((candidate) => candidate.toLowerCase() === match[2].toLowerCase());
      if (!stage) continue;
      const key = `${id}:${stage}`;
      const candidate = { id, stage, state, record, ref: text(ref), ms: signalTime(record, index), timestampUtc: timestamp(record) };
      const previous = latest.get(key);
      if (!previous || candidate.ms > previous.ms) latest.set(key, candidate);
    }
  }
  return [...latest.values()];
}

function score(entry = {}) {
  return STAGES.reduce((total, stage) => total + (text(entry.stages?.[stage]?.status).toLowerCase() === 'proven' ? WEIGHTS[stage] : 0), 0);
}

function truthLabel(percent) {
  if (percent >= 100) return 'OPERATOR-ACCEPTED';
  if (percent >= 80) return 'RUNTIME-PROVEN';
  if (percent >= 60) return 'AUTOMATED-PROOF BACKED';
  if (percent >= 40) return 'IMPLEMENTED PROTOTYPE';
  return 'DESIGN-GROUNDED';
}

export function projectVrCapabilityLiveTruth(input = {}) {
  const projected = projectVrCapabilityLiveState(input);
  const ledger = JSON.parse(JSON.stringify(projected.ledger));
  const byId = new Map(array(ledger.capabilities).map((entry) => [text(entry.id), entry]));
  let revokedStageCount = 0;
  let confirmedPassCount = 0;

  for (const signal of canonicalSignals(input.records || {})) {
    const entry = byId.get(signal.id);
    if (!entry) continue;
    if (signal.state === 'pass') {
      confirmedPassCount += 1;
      continue;
    }
    const existing = entry.stages?.[signal.stage] || {};
    entry.stages[signal.stage] = {
      ...existing,
      status: 'pending',
      evidence: [...new Set([...array(existing.evidence).map(String), signal.ref])],
      note: `Latest canonical proof for ${signal.stage} is ${text(signal.record.status || signal.record.verdict || 'failed').toUpperCase()}; older success is not treated as current proof.`,
    };
    entry.updatedAt = signal.timestampUtc || entry.updatedAt;
    if (['runtimeProof', 'operatorAcceptance'].includes(signal.stage) && entry.visual) {
      delete entry.visual.currentViewUrl;
      delete entry.visual.currentViewSource;
      delete entry.visual.currentViewObservedAt;
      delete entry.visual.currentViewKind;
    }
    revokedStageCount += 1;
  }

  for (const entry of array(ledger.capabilities)) {
    const percent = score(entry);
    entry.visual = { ...(entry.visual || {}), readinessPercent: percent, truthLabel: truthLabel(percent) };
  }
  ledger.liveProjection = {
    ...(ledger.liveProjection || {}),
    schemaVersion: VR_CAPABILITY_LIVE_FEED_SCHEMA,
    revokedStageCount,
    confirmedPassCount,
  };

  return Object.freeze({
    ...projected,
    ledger: Object.freeze(ledger),
    evidenceSummary: Object.freeze({
      ...(projected.evidenceSummary || {}),
      revokedStageCount,
      confirmedPassCount,
    }),
  });
}
