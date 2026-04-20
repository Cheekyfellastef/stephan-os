const APP_ID = 'ideas';
const STORAGE_VERSION = 1;
const LEGACY_STORAGE_KEY = 'stephanos.simulationNodes.v1.ideas';
const LOCAL_UI_STORAGE_KEY = 'stephanos.ideas.ui.local.v1';
const LOG_PREFIX = '[IDEAS TILE DATA]';
const IDEA_RELATION_TYPES = new Set([
  'supports',
  'depends_on',
  'derived_from',
  'contradicts',
  'expands',
  'similar_to',
  'part_of',
  'promotes_to',
  'evidence_for',
  'evidence_against',
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
}

function normalizeConfidence(value) {
  const normalized = normalizeString(value, 'unknown');
  return normalized || 'unknown';
}

function sanitizeEvidenceItems(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((evidence) => isRecord(evidence))
    .map((evidence) => ({
      id: normalizeString(evidence.id, `${normalizeString(evidence.type, 'reference')}:${normalizeString(evidence.title, 'untitled')}`),
      type: normalizeString(evidence.type, 'reference'),
      title: normalizeString(evidence.title),
      source: normalizeString(evidence.source),
      notes: normalizeString(evidence.notes),
      provenance: normalizeString(evidence.provenance),
      confidence: normalizeConfidence(evidence.confidence),
      linkedArtifactIds: normalizeStringList(evidence.linkedArtifactIds),
      linkedPaths: normalizeStringList(evidence.linkedPaths),
      linkedUrls: normalizeStringList(evidence.linkedUrls),
      snapshotRef: normalizeString(evidence.snapshotRef),
    }))
    .filter((evidence) => evidence.title && evidence.source);
}

function sanitizeIdeaRelations(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((relation) => isRecord(relation))
    .map((relation) => ({
      targetId: normalizeString(relation.targetId),
      relationType: normalizeRelationType(relation.relationType),
      notes: normalizeString(relation.notes),
      confidence: normalizeConfidence(relation.confidence),
    }))
    .filter((relation) => relation.targetId);
}

function normalizeRelationType(value) {
  const normalized = normalizeString(value, 'supports')
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  return IDEA_RELATION_TYPES.has(normalized) ? normalized : 'supports';
}

function sanitizeContextHints(value = {}) {
  const source = isRecord(value) ? value : {};
  const includeRelated = Math.max(0, Math.min(8, Number(source.includeRelated) || 3));
  const includeEvidence = Math.max(0, Math.min(8, Number(source.includeEvidence) || 2));
  const includeRetrieval = Math.max(0, Math.min(6, Number(source.includeRetrieval) || 2));
  return {
    brief: normalizeString(source.brief),
    includeRelated,
    includeEvidence,
    includeRetrieval,
    focusTerms: normalizeStringList(source.focusTerms),
    includePromotionState: source.includePromotionState !== false,
  };
}

function sanitizeCollectionIds(record = {}, knowledge = {}) {
  const topLevel = Array.isArray(record.collectionIds) ? record.collectionIds : [];
  const knowledgeIds = Array.isArray(knowledge.collectionIds) ? knowledge.collectionIds : [];
  const singletons = [
    record.collectionId,
    knowledge.collectionId,
  ].filter(Boolean);
  return normalizeStringList([...topLevel, ...knowledgeIds, ...singletons]);
}

function sanitizePromotionState(value = {}) {
  const source = isRecord(value) ? value : {};
  const memorySource = isRecord(source.memory) ? source.memory : { state: source.memory };
  const retrievalSource = isRecord(source.retrieval) ? source.retrieval : { state: source.retrieval };
  const roadmapSource = isRecord(source.roadmap) ? source.roadmap : { state: source.roadmap };
  const codexSource = isRecord(source.codex) ? source.codex : { state: source.codex };
  const simulationSource = isRecord(source.simulation) ? source.simulation : { state: source.simulation };
  const continuitySource = isRecord(source.continuity) ? source.continuity : { state: source.continuity };
  const memoryLinkSource = isRecord(source.memoryLink) ? source.memoryLink : {};
  const retrievalLinkSource = isRecord(source.retrievalLink) ? source.retrievalLink : {};

  return {
    memory: normalizeString(memorySource.state, 'not-submitted'),
    retrieval: normalizeString(retrievalSource.state, 'not-submitted'),
    codex: normalizeString(codexSource.state, 'not-prepared'),
    roadmap: normalizeString(roadmapSource.state, 'not-promoted'),
    simulation: normalizeString(simulationSource.state, 'not-targeted'),
    continuity: normalizeString(continuitySource.state, 'not-submitted'),
    memoryLink: normalizeString(memoryLinkSource.state, 'not-linked'),
    retrievalLink: normalizeString(retrievalLinkSource.state, 'not-linked'),
    lastTransitionAt: normalizeString(source.lastTransitionAt),
    lastActor: normalizeString(source.lastActor),
    provenance: normalizeString(source.provenance),
    trace: Array.isArray(source.trace)
      ? source.trace
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          target: normalizeString(entry.target),
          state: normalizeString(entry.state),
          at: normalizeString(entry.at),
          notes: normalizeString(entry.notes),
        }))
        .filter((entry) => entry.target && entry.state)
      : [],
  };
}

function sanitizeIdeaKnowledge(record = {}) {
  const legacyEvidence = sanitizeEvidenceItems(record.media);
  const knowledge = isRecord(record.knowledge) ? record.knowledge : {};
  const relations = sanitizeIdeaRelations(knowledge.relations);
  const relatedIdeas = normalizeStringList(record.relatedIdeas?.length ? record.relatedIdeas : relations.map((relation) => relation.targetId));
  const collectionIds = sanitizeCollectionIds(record, knowledge);
  const promotionState = sanitizePromotionState(
    isRecord(record.promotionState) || isRecord(knowledge.promotionState)
      ? { ...knowledge.promotionState, ...record.promotionState }
      : {},
  );
  const memoryLinks = normalizeStringList(record.memoryLinks);
  const retrievalLinks = normalizeStringList(record.retrievalLinks);
  const roadmapLinks = normalizeStringList(record.roadmapLinks);
  const simulationLinks = normalizeStringList(record.simulationLinks);
  const sourceArtifacts = normalizeStringList(record.sourceArtifacts);
  const nodeType = normalizeString(knowledge.nodeType || record.nodeType, 'idea-node');
  const status = normalizeString(knowledge.status || record.status, 'spark');
  const priority = normalizeString(record.priority, 'normal');
  const operatorNotes = normalizeString(knowledge.operatorNotes || record.notes || record.operatorNotes);
  const evidence = sanitizeEvidenceItems(knowledge.evidence?.length ? knowledge.evidence : legacyEvidence);
  const primaryCollectionId = collectionIds[0] || '';
  const memoryPromotionStatus = normalizeString(knowledge.promotionStatus || record.promotionStatus, promotionState.memory === 'promoted' ? 'promoted' : 'draft');
  const aiContextHints = sanitizeContextHints(knowledge.aiContextHints || record.aiContextHints);

  return {
    nodeType,
    status,
    priority,
    collectionId: normalizeString(primaryCollectionId),
    collectionIds,
    actionTarget: normalizeString(knowledge.actionTarget || record.actionTarget),
    promotionStatus: memoryPromotionStatus,
    promotionState,
    relatedIdeas,
    relations,
    evidence,
    sourceTile: normalizeString(record.sourceTile),
    sourceArtifacts,
    memoryLinks,
    retrievalLinks,
    roadmapLinks,
    simulationLinks,
    operatorNotes,
    aiContextHints,
  };
}

function sanitizeIdeaRecord(record) {
  if (!isRecord(record)) {
    return null;
  }

  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!title || !id) {
    return null;
  }

  const knowledge = sanitizeIdeaKnowledge(record);

  return {
    id,
    title,
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    tags: normalizeStringList(record.tags),
    media: knowledge.evidence,
    knowledge,
    nodeType: knowledge.nodeType,
    status: knowledge.status,
    priority: knowledge.priority,
    collectionIds: knowledge.collectionIds,
    relatedIdeas: knowledge.relatedIdeas,
    sourceTile: knowledge.sourceTile,
    sourceArtifacts: knowledge.sourceArtifacts,
    promotionState: knowledge.promotionState,
    memoryLinks: knowledge.memoryLinks,
    retrievalLinks: knowledge.retrievalLinks,
    roadmapLinks: knowledge.roadmapLinks,
    simulationLinks: knowledge.simulationLinks,
    aiContextHints: knowledge.aiContextHints,
    notes: knowledge.operatorNotes,
    createdAt: normalizeString(record.createdAt),
    updatedAt: normalizeString(record.updatedAt),
  };
}

function sanitizeIdeasState(value) {
  if (!isRecord(value)) {
    return { records: [] };
  }

  if (Array.isArray(value.records)) {
    return {
      records: value.records.map(sanitizeIdeaRecord).filter(Boolean),
    };
  }

  if (value.category === APP_ID && Array.isArray(value.records)) {
    return {
      records: value.records.map(sanitizeIdeaRecord).filter(Boolean),
    };
  }

  return { records: [] };
}

function sanitizeLocalUiState(value) {
  return isRecord(value) ? value : {};
}

function createDefaultState() {
  return { records: [] };
}

function summarizeRecords(state) {
  const records = Array.isArray(state?.records) ? state.records : [];
  return {
    recordCount: records.length,
    ids: records.slice(0, 5).map((record) => record.id),
  };
}

function parseJson(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persistLegacyLocalState(globalObj, sanitizedState) {
  const storage = globalObj.localStorage;
  if (!storage || typeof storage.setItem !== 'function') {
    return {
      ok: false,
      source: 'no-local-storage',
    };
  }

  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
    schemaVersion: STORAGE_VERSION,
    category: APP_ID,
    records: sanitizedState.records,
  }));
  return {
    ok: true,
    source: 'legacy-local-fallback',
  };
}

function createIdeasPersistence(globalObj = globalThis) {
  const logger = globalObj.console || console;

  function log(event, payload = {}) {
    const target = logger && typeof logger.info === 'function' ? logger : console;
    target.info(LOG_PREFIX, event, payload);
  }

  function readLocalUiState() {
    const storage = globalObj.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      return {};
    }

    return sanitizeLocalUiState(parseJson(storage.getItem(LOCAL_UI_STORAGE_KEY)));
  }

  function writeLocalUiState(uiState) {
    const storage = globalObj.localStorage;
    if (!storage || typeof storage.setItem !== 'function') {
      return false;
    }

    storage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify(sanitizeLocalUiState(uiState)));
    return true;
  }

  async function loadStateWithMeta() {
    const tileDataClient = globalObj.StephanosTileDataContract?.client;
    if (tileDataClient?.loadDurableState) {
      const response = await tileDataClient.loadDurableState({
        appId: APP_ID,
        schemaVersion: STORAGE_VERSION,
        defaultState: createDefaultState(),
        sanitizeState: sanitizeIdeasState,
        legacyKeys: [LEGACY_STORAGE_KEY],
      });

      const hydratedState = sanitizeIdeasState(response?.state || createDefaultState());
      const uiState = readLocalUiState();
      const source = response?.source || 'unknown';
      log('load', {
        appId: APP_ID,
        backendUrlResolved: tileDataClient.apiBaseUrl || '',
        sourceUsedOnLoad: source,
        backendLoadSucceeded: source === 'shared-backend',
        hydrationCompleted: true,
        localFallbackUsed: source !== 'shared-backend',
        localFallbackIgnored: source === 'shared-backend',
        localFallbackReason: source === 'shared-backend' ? '' : source,
        payloadSummary: summarizeRecords(hydratedState),
      });

      return {
        state: hydratedState,
        ui: uiState,
        meta: {
          source,
          diagnostics: response?.diagnostics || null,
        },
      };
    }

    const storage = globalObj.localStorage;
    const legacyParsed = sanitizeIdeasState(parseJson(storage?.getItem?.(LEGACY_STORAGE_KEY)) || createDefaultState());
    const source = legacyParsed.records.length ? 'legacy-local-fallback' : 'default-state';
    log('load', {
      appId: APP_ID,
      backendUrlResolved: '',
      sourceUsedOnLoad: source,
      backendLoadSucceeded: false,
      hydrationCompleted: true,
      localFallbackUsed: true,
      localFallbackIgnored: false,
      localFallbackReason: source,
      payloadSummary: summarizeRecords(legacyParsed),
    });

    return {
      state: legacyParsed,
      ui: readLocalUiState(),
      meta: {
        source,
        diagnostics: null,
      },
    };
  }

  async function saveState({ state, ui = {}, hydrationCompleted = false } = {}) {
    const sanitizedState = sanitizeIdeasState(state);
    writeLocalUiState(ui);

    if (!hydrationCompleted) {
      log('save-skipped', {
        appId: APP_ID,
        hydrationCompleted: false,
        reason: 'hydration-incomplete',
        payloadSummary: summarizeRecords(sanitizedState),
      });
      return {
        ok: false,
        skipped: true,
        reason: 'hydration-incomplete',
      };
    }

    const tileDataClient = globalObj.StephanosTileDataContract?.client;
    if (tileDataClient?.saveDurableState) {
      const response = await tileDataClient.saveDurableState({
        appId: APP_ID,
        schemaVersion: STORAGE_VERSION,
        state: sanitizedState,
        sanitizeState: sanitizeIdeasState,
      });

      log('save', {
        appId: APP_ID,
        backendUrlResolved: tileDataClient.apiBaseUrl || '',
        sourceUsedOnSave: response?.source || 'unknown',
        backendSaveSucceeded: Boolean(response?.ok),
        hydrationCompleted,
        payloadSummary: summarizeRecords(sanitizedState),
      });

      if (!response?.ok) {
        const fallbackResult = persistLegacyLocalState(globalObj, sanitizedState);
        log('save-fallback', {
          appId: APP_ID,
          backendUrlResolved: tileDataClient.apiBaseUrl || '',
          sourceUsedOnSave: fallbackResult.source,
          backendSaveSucceeded: false,
          hydrationCompleted,
          payloadSummary: summarizeRecords(sanitizedState),
          fallbackReason: response?.diagnostics?.error || `http-${response?.status || 0}`,
        });
        return {
          ok: fallbackResult.ok,
          skipped: false,
          source: fallbackResult.ok ? 'legacy-local-fallback' : 'save-failed',
          reason: fallbackResult.ok ? 'backend-save-failed-local-fallback' : 'save-failed',
        };
      }

      return {
        ok: Boolean(response?.ok),
        skipped: false,
        source: response?.source || 'unknown',
      };
    }

    const fallbackResult = persistLegacyLocalState(globalObj, sanitizedState);
    if (fallbackResult.ok) {
      log('save', {
        appId: APP_ID,
        backendUrlResolved: '',
        sourceUsedOnSave: 'legacy-local-fallback',
        backendSaveSucceeded: false,
        hydrationCompleted,
        payloadSummary: summarizeRecords(sanitizedState),
      });
      return {
        ok: true,
        skipped: false,
        source: 'legacy-local-fallback',
      };
    }

    return {
      ok: false,
      skipped: false,
      source: 'unavailable',
    };
  }

  return {
    APP_ID,
    LEGACY_STORAGE_KEY,
    LOCAL_UI_STORAGE_KEY,
    createDefaultState,
    sanitizeIdeasState,
    loadStateWithMeta,
    saveState,
  };
}

export {
  APP_ID,
  LEGACY_STORAGE_KEY,
  LOCAL_UI_STORAGE_KEY,
  STORAGE_VERSION,
  createIdeasPersistence,
  sanitizeIdeasState,
};
