export const VR_CANONICAL_EVIDENCE_FANOUT_SCHEMA_V1 = 'stephanos.vr-canonical-evidence-fanout.v1';

const CORRELATION_TERMS = Object.freeze([
  'aer',
  'alternate-eye',
  'alternate eye',
  'stereo',
  'presenter',
  'sequence',
  'frame',
  'dlss',
  'motion vector',
  'camera',
  'latency',
  'stability',
  'openxr',
  'reprojection',
  'render',
]);

function text(value, fallback = '') {
  const out = value === null || value === undefined ? '' : String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function lower(value) {
  return text(value).toLowerCase();
}

function corpusSource(source = {}) {
  return Object.freeze({
    sourceId: text(source.source_id, 'unknown-source'),
    repository: text(source.repository),
    ref: text(source.ref),
    commit: text(source.commit),
    licence: text(source.licence, 'UNKNOWN'),
    reuseClass: text(source.reuse_class, 'unknown'),
    intakeMode: text(source.intake_mode, 'unknown'),
    localCacheAllowed: source.local_cache_allowed === true,
    codeReuseAllowed: source.code_reuse_allowed === true,
    role: text(source.role),
  });
}

function referenceCorpus(referenceSourceLock = {}) {
  const sources = list(referenceSourceLock.sources).map(corpusSource);
  return Object.freeze({
    schemaVersion: text(referenceSourceLock.schema, 'unknown'),
    sourceCount: sources.length,
    reusableSourceCount: sources.filter((source) => source.codeReuseAllowed).length,
    locallyHydratableCount: sources.filter((source) => source.localCacheAllowed).length,
    permissiveCount: sources.filter((source) => source.reuseClass === 'permissive').length,
    copyleftSeparateCount: sources.filter((source) => source.reuseClass === 'copyleft-separate-component').length,
    analysisOnlyCount: sources.filter((source) => source.reuseClass === 'analysis-only').length,
    sources: Object.freeze(sources),
  });
}

function registrySummary(sourceRegistry = {}) {
  const sources = list(sourceRegistry.sources);
  return Object.freeze({
    schemaVersion: text(sourceRegistry.schema_version || sourceRegistry.schemaVersion, 'unknown'),
    sourceCount: sources.length,
    lastFullSweep: text(sourceRegistry.last_full_sweep),
    referenceSourceLock: text(sourceRegistry.reference_source_lock),
  });
}

function evidenceText(input = {}) {
  return [
    ...list(input?.vrResearchLab?.latest?.reusableFindings),
    text(input?.vrResearchLab?.latest?.techniqueCandidate),
    ...list(input?.starfieldReferenceLab?.latest?.findings),
    text(input?.latest?.flywheel?.improvementCandidate?.title),
    text(input?.latest?.flywheel?.improvementCandidate?.summary),
  ].filter(Boolean).join(' ').toLowerCase();
}

function activeTerms(input = {}) {
  const body = evidenceText(input);
  return CORRELATION_TERMS.filter((term) => body.includes(term));
}

function scoreSource(source, terms) {
  const haystack = [
    source.sourceId,
    source.repository,
    source.role,
    source.intakeMode,
  ].join(' ').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 3;
    const words = term.split(/[ -]+/).filter((word) => word.length >= 4);
    for (const word of words) if (haystack.includes(word)) score += 1;
  }
  if (/starfield|mutar|vrframework/.test(haystack)) score += 2;
  if (/stability|stereo|camera|openxr|render|dlss|frame/.test(haystack)) score += 1;
  return score;
}

function correlations(corpus, input = {}) {
  const terms = activeTerms(input);
  if (!input?.latest || input.latest.current === false) return Object.freeze([]);
  return Object.freeze(corpus.sources
    .map((source) => Object.freeze({ source, score: scoreSource(source, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || left.source.sourceId.localeCompare(right.source.sourceId))
    .slice(0, 8)
    .map((entry) => Object.freeze({
      sourceId: entry.source.sourceId,
      repository: entry.source.repository,
      commit: entry.source.commit,
      licence: entry.source.licence,
      reuseClass: entry.source.reuseClass,
      role: entry.source.role,
      score: entry.score,
      matchedConcerns: Object.freeze(terms.filter((term) => [
        entry.source.sourceId,
        entry.source.repository,
        entry.source.role,
      ].join(' ').toLowerCase().includes(term))),
      provenanceRef: `VR-Research-Lab/reference-source-lock.json#${entry.source.sourceId}`,
    })));
}

function latestEvidence(input = {}) {
  const latest = input.latest;
  if (!latest) return null;
  return Object.freeze({
    current: latest.current === true,
    freshness: text(latest.freshness, 'unknown'),
    sessionId: text(latest.sessionId),
    observedAtUtc: text(latest.observedAtUtc),
    game: text(latest.game),
    route: text(latest.route),
    mode: text(latest.mode),
    sequenceFaultCount: Number(latest?.telemetry?.sequenceFaultCount) || 0,
    protectReady: latest.current === true && latest?.modeProgression?.protectReady === true,
    lessonId: text(latest?.flywheel?.lessonId),
    packetRef: text(latest?.labProjections?.vrResearchLab?.provenanceRef),
  });
}

function proofRefs(input = {}, evidence = null) {
  return Object.freeze([...new Set([
    text(evidence?.packetRef),
    text(input?.vrResearchLab?.latest?.provenanceRef),
    text(input?.starfieldReferenceLab?.latest?.provenanceRef),
  ].filter(Boolean))]);
}

export function buildVrCanonicalEvidenceFanoutV1(input = {}) {
  const corpus = referenceCorpus(input.referenceSourceLock);
  const evidence = latestEvidence(input);
  const correlationCandidates = correlations(corpus, input);
  return Object.freeze({
    schemaVersion: VR_CANONICAL_EVIDENCE_FANOUT_SCHEMA_V1,
    readOnly: true,
    registry: registrySummary(input.sourceRegistry),
    referenceCorpus: corpus,
    latestEvidence: evidence,
    correlationCandidates,
    analysisQuestions: Object.freeze(correlationCandidates.slice(0, 5).map((candidate) =>
      `Compare ${candidate.repository}@${candidate.commit.slice(0, 12)} against the latest ${evidence?.game || 'VR'} ${evidence?.mode || 'playtest'} evidence for transferable ${candidate.role || 'VR'} techniques without promoting unproven runtime claims.`
    )),
    proofRefs: proofRefs(input, evidence),
    authority: Object.freeze({
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      capabilityPromotionAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      arbitraryShellAllowed: false,
    }),
  });
}
