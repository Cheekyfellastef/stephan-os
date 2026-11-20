export const VR_CAPABILITY_LIVE_FEED_SCHEMA = 'stephanos.vr-capability-live-feed.v1';

const READINESS_STAGES = Object.freeze(['design', 'implementation', 'automatedProof', 'runtimeProof', 'operatorAcceptance']);
const STAGE_WEIGHT = Object.freeze({ design: 10, implementation: 30, automatedProof: 20, runtimeProof: 20, operatorAcceptance: 20 });
const PASS_WORDS = new Set(['PROVEN', 'PASS', 'PASSED', 'ACCEPTED', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE']);
const CONCEPT_VISIBLE_STATES = new Set(['ACTIVE', 'ACCEPTED', 'PUBLISHED']);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function parseBody(record = {}) {
  if (record.body && typeof record.body === 'object') return record.body;
  if (typeof record.body !== 'string') return {};
  try { return JSON.parse(record.body); } catch { return {}; }
}

function timestamp(record = {}) {
  return text(record.timestampUtc || record.checkedAtUtc || record.publishedAtUtc || record.updatedAt || record.createdAt);
}

function maxTimestamp(...values) {
  return values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
}

function recordRef(record = {}, index = 0) {
  return text(
    record.proofId
      || record.capabilityRecordId
      || record.participantStatusId
      || record.recordId
      || record.receiptId
      || record.id
      || array(record.proofRefs)[0],
    `shared-workspace-record-${index}`,
  );
}

function normaliseStage(value) {
  const raw = text(value).replace(/[\s_-]+/g, '').toLowerCase();
  const match = READINESS_STAGES.find((stage) => stage.toLowerCase() === raw);
  return match || '';
}

function explicitPass(record = {}, body = {}) {
  if ([record.proven, record.passed, record.accepted, record.operatorAccepted, body.proven, body.passed, body.accepted, body.operatorAccepted].some((value) => value === true)) return true;
  const verdict = text(record.verdict || record.outcome || record.status || body.verdict || body.outcome || body.status).toUpperCase();
  return PASS_WORDS.has(verdict);
}

function idsFromRecord(record = {}, body = {}) {
  const ids = new Set();
  for (const value of [record.vrCapabilityId, record.capabilityId, body.vrCapabilityId, body.capabilityId, record?.vrCapability?.id, body?.vrCapability?.id]) {
    const id = text(value);
    if (SAFE_ID.test(id)) ids.add(id);
  }
  for (const list of [record.vrCapabilityIds, record.capabilityIds, body.vrCapabilityIds, body.capabilityIds]) {
    for (const value of array(list)) {
      const id = text(value);
      if (SAFE_ID.test(id)) ids.add(id);
    }
  }
  for (const ref of [...array(record.proofRefs), ...array(body.proofRefs)]) {
    const match = text(ref).match(/vr-capability[:/]([a-z0-9._-]+)(?:[:/]([a-zA-Z_-]+))?/i);
    if (match?.[1] && SAFE_ID.test(match[1])) ids.add(match[1]);
  }
  return [...ids];
}

function stageFromRecord(record = {}, body = {}) {
  const direct = normaliseStage(record.vrReadinessStage || record.readinessStage || record.proofStage || body.vrReadinessStage || body.readinessStage || body.proofStage || record?.vrCapability?.stage || body?.vrCapability?.stage);
  if (direct) return direct;
  for (const ref of [...array(record.proofRefs), ...array(body.proofRefs)]) {
    const match = text(ref).match(/vr-capability[:/][a-z0-9._-]+[:/]([a-zA-Z_-]+)/i);
    const stage = normaliseStage(match?.[1]);
    if (stage) return stage;
  }
  return '';
}

function visualEvidenceFromRecord(record = {}, body = {}) {
  const candidates = [record.visualEvidence, body.visualEvidence, record.spatialWorkspaceVisual, body.spatialWorkspaceVisual, record?.vrCapability?.visualEvidence, body?.vrCapability?.visualEvidence].filter((value) => value && typeof value === 'object');
  for (const visual of candidates) {
    const verified = visual.verified === true || visual.observed === true || ['VERIFIED', 'OBSERVED', 'ACCEPTED'].includes(text(visual.truth || visual.state).toUpperCase());
    const url = text(visual.url || visual.snapshotUrl || visual.imageUrl || visual.artifactUrl);
    if (!verified || !url) continue;
    return {
      url,
      source: text(visual.source, 'spatial-workspace'),
      observedAt: text(visual.observedAt || visual.timestampUtc || timestamp(record)),
      kind: text(visual.kind, 'observed-workspace-capture'),
    };
  }
  return null;
}

function scoreStages(stages = {}) {
  return READINESS_STAGES.reduce((sum, stage) => sum + (text(stages?.[stage]?.status).toLowerCase() === 'proven' ? STAGE_WEIGHT[stage] : 0), 0);
}

function maturityLabel(percent) {
  if (percent >= 100) return 'OPERATOR-ACCEPTED';
  if (percent >= 80) return 'RUNTIME-PROVEN';
  if (percent >= 60) return 'AUTOMATED-PROOF BACKED';
  if (percent >= 40) return 'IMPLEMENTED PROTOTYPE';
  return 'DESIGN-GROUNDED';
}

function conceptCandidatesFromValue(value) {
  return array(value).map((candidate) => {
    if (!candidate || typeof candidate !== 'object') return null;
    const id = text(candidate.id || candidate.conceptId);
    const title = text(candidate.title || candidate.name);
    if (!SAFE_ID.test(id) || !title) return null;
    const state = text(candidate.status || candidate.state, candidate.atlasVisible === true ? 'ACTIVE' : '').toUpperCase();
    if (candidate.atlasVisible !== true && !CONCEPT_VISIBLE_STATES.has(state)) return null;
    return {
      id,
      title,
      description: text(candidate.description || candidate.summary, 'Emerging VR concept from the canonical Stephanos workspace.'),
      alt: text(candidate.alt, `${title} concept projection.`),
      tags: [...new Set(array(candidate.tags).map((tag) => text(tag)).filter(Boolean))],
      visual: {
        conceptViewUrl: text(candidate.conceptViewUrl || candidate?.visual?.conceptViewUrl),
        source: text(candidate?.visual?.source || candidate.source, 'shared-workspace'),
      },
      dynamic: true,
      designProven: candidate.designProven === true,
      evidence: array(candidate.evidence || candidate.proofRefs).map(String),
    };
  }).filter(Boolean);
}

function mergeConcepts(baseConcepts = [], records = [], workspaceConceptCandidates = []) {
  const merged = new Map(array(baseConcepts).map((concept) => [text(concept.id), clone(concept)]));
  const candidates = [...conceptCandidatesFromValue(workspaceConceptCandidates)];
  for (const record of records) {
    const body = parseBody(record);
    candidates.push(...conceptCandidatesFromValue(record.vrConceptCandidates));
    candidates.push(...conceptCandidatesFromValue(body.vrConceptCandidates));
    candidates.push(...conceptCandidatesFromValue(record.conceptCandidates));
    candidates.push(...conceptCandidatesFromValue(body.conceptCandidates));
  }
  for (const candidate of candidates) {
    const previous = merged.get(candidate.id) || {};
    merged.set(candidate.id, {
      ...previous,
      ...candidate,
      tags: [...new Set([...(previous.tags || []), ...(candidate.tags || [])])],
      visual: { ...(previous.visual || {}), ...(candidate.visual || {}) },
    });
  }
  return [...merged.values()].map((concept, index) => ({ ...concept, catalogIndex: index }));
}

export function projectVrCapabilityLiveState({ baseLedger, baseConcepts = [], records = {}, workspaceConceptCandidates = [], nowMs = Date.now() } = {}) {
  const ledger = clone(baseLedger) || {};
  ledger.capabilities = array(ledger.capabilities).map((entry) => ({
    ...entry,
    updatedAt: text(entry.updatedAt || ledger.updatedAt),
    stages: clone(entry.stages) || {},
    visual: clone(entry.visual) || {},
  }));
  const allRecords = [
    ...array(records.proofRecords),
    ...array(records.capabilityRecords),
    ...array(records.statusRecords),
    ...array(records.receiptRecords),
  ];
  const byId = new Map(ledger.capabilities.map((entry) => [text(entry.id), entry]));
  let acceptedPromotionCount = 0;
  let ignoredAmbiguousCount = 0;
  let spatialVisualCount = 0;

  for (const [index, record] of allRecords.entries()) {
    const body = parseBody(record);
    const ids = idsFromRecord(record, body);
    const stage = stageFromRecord(record, body);
    const passed = explicitPass(record, body);
    if (!ids.length || !stage || !passed) {
      if (ids.length || stage) ignoredAmbiguousCount += 1;
      continue;
    }
    const ref = recordRef(record, index);
    const seenAt = timestamp(record) || new Date(nowMs).toISOString();
    const visual = visualEvidenceFromRecord(record, body);
    for (const id of ids) {
      const entry = byId.get(id);
      if (!entry) continue;
      const existing = entry.stages?.[stage] || {};
      entry.stages[stage] = {
        ...existing,
        status: 'proven',
        evidence: [...new Set([...array(existing.evidence).map(String), ref])],
        note: text(body.note || record.summary || existing.note, `Live Shared Workspace evidence proved ${stage}.`),
      };
      entry.updatedAt = maxTimestamp(seenAt, entry.updatedAt);
      acceptedPromotionCount += 1;
      if (visual) {
        entry.visual = {
          ...(entry.visual || {}),
          currentViewUrl: visual.url,
          currentViewSource: visual.source,
          currentViewObservedAt: visual.observedAt || seenAt,
          currentViewKind: visual.kind,
        };
        spatialVisualCount += 1;
      }
    }
  }

  const concepts = mergeConcepts(baseConcepts, allRecords, workspaceConceptCandidates);
  for (const concept of concepts) {
    if (byId.has(concept.id) || !concept.designProven) continue;
    const entry = {
      id: concept.id,
      updatedAt: new Date(nowMs).toISOString(),
      visual: {
        truthLabel: 'DESIGN-GROUNDED',
        deltaSummary: 'This newly promoted concept has canonical design evidence but no implementation or runtime proof yet.',
        ...(concept.visual?.conceptViewUrl ? { conceptViewUrl: concept.visual.conceptViewUrl } : {}),
      },
      stages: {
        design: { status: 'proven', evidence: concept.evidence || [], note: 'Canonical concept candidate explicitly promoted with design proof.' },
        implementation: { status: 'pending', evidence: [], note: 'No implementation proof recorded yet.' },
        automatedProof: { status: 'pending', evidence: [], note: 'No automated proof recorded yet.' },
        runtimeProof: { status: 'pending', evidence: [], note: 'No runtime proof recorded yet.' },
        operatorAcceptance: { status: 'pending', evidence: [], note: 'No operator acceptance recorded yet.' },
      },
    };
    ledger.capabilities.push(entry);
    byId.set(concept.id, entry);
  }

  for (const entry of ledger.capabilities) {
    const percent = scoreStages(entry.stages);
    entry.visual = {
      ...(entry.visual || {}),
      truthLabel: maturityLabel(percent),
      readinessPercent: percent,
    };
  }

  const newestEntryTimestamp = ledger.capabilities.reduce((latest, entry) => maxTimestamp(latest, entry.updatedAt), text(ledger.updatedAt));
  ledger.updatedAt = newestEntryTimestamp || text(ledger.updatedAt);
  ledger.liveProjection = {
    schemaVersion: VR_CAPABILITY_LIVE_FEED_SCHEMA,
    generatedAt: new Date(nowMs).toISOString(),
    acceptedPromotionCount,
    ignoredAmbiguousCount,
    spatialVisualCount,
  };

  return Object.freeze({
    schemaVersion: VR_CAPABILITY_LIVE_FEED_SCHEMA,
    generatedAt: new Date(nowMs).toISOString(),
    state: acceptedPromotionCount || spatialVisualCount ? 'live-evidence' : 'base-plus-workspace',
    ledger: Object.freeze(ledger),
    concepts: Object.freeze(concepts),
    evidenceSummary: Object.freeze({
      recordCount: allRecords.length,
      acceptedPromotionCount,
      ignoredAmbiguousCount,
      spatialVisualCount,
      conceptCount: concepts.length,
    }),
  });
}
