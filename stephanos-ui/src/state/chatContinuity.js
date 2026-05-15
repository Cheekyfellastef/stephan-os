const CHAT_CONTINUITY_STORAGE_KEY = 'stephanos.chat.continuity.v1';
const CHAT_CONTINUITY_VERSION = 'chat-continuity.v1';
const MAX_SUMMARIES = 8;

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function sanitizeText(value, max = 280) {
  const text = asText(value).replace(/\s+/g, ' ').slice(0, max);
  if (!text) return '';
  if (/api[_-]?key|token|password|secret|bearer\s+[a-z0-9._-]+/i.test(text)) return '[redacted-secret-like-value]';
  return text;
}

function asList(value, max = 5) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeText(item, 180)).filter(Boolean).slice(0, max);
}

export function createEmptyChatContinuity({ sessionId = 'unknown' } = {}) {
  return {
    version: CHAT_CONTINUITY_VERSION,
    updatedAt: new Date().toISOString(),
    sessionId,
    recentTopic: 'unknown',
    activeMission: 'unknown',
    recentDecisions: [],
    openQuestions: [],
    activeRepairTarget: 'unknown',
    lastKnownGoodState: 'unknown',
    currentBlockedState: 'unknown',
    recentOperatorPreferences: [],
    recentCodexLoopState: 'unknown',
    nextAction: 'Answer directly with bounded confidence.',
    warnings: [],
    summaries: [],
    rehydrated: false,
    storageKey: CHAT_CONTINUITY_STORAGE_KEY,
    seededFromExistingHistory: false,
    continuitySource: 'none',
    rawTranscriptStored: 'no',
  };
}

export function buildChatContinuitySummary(input = {}) {
  const previous = input.previousContinuity && typeof input.previousContinuity === 'object' ? input.previousContinuity : createEmptyChatContinuity({ sessionId: input.sessionId });
  const summaryItem = {
    id: asText(input.sourceCommandId, `sum_${Date.now()}`),
    timestamp: new Date().toISOString(),
    kind: asText(input.responseMode, 'direct-answer'),
    summary: sanitizeText(input.operatorMessage || input.responsePlanner?.recommendedNextAction || input.chatContextPack?.recommendedNextAction, 220),
    sourceCommandId: asText(input.sourceCommandId, 'unknown'),
    relatedSubsystems: asList(input.chatContextPack?.affectedSubsystems, 4),
    confidence: asText(input.responsePlanner?.riskLevel === 'low' ? 'high' : 'medium', 'unknown'),
  };
  return {
    ...previous,
    version: CHAT_CONTINUITY_VERSION,
    updatedAt: new Date().toISOString(),
    sessionId: asText(input.sessionId, previous.sessionId || 'unknown'),
    recentTopic: sanitizeText(input.chatContextPack?.recommendedResponseMode || input.operatorMessage, 80) || previous.recentTopic,
    activeMission: sanitizeText(input.missionState?.status || input.missionState?.mode, 120) || previous.activeMission,
    recentDecisions: asList([input.responsePlanner?.mergeDecision, ...(previous.recentDecisions || [])], 4),
    openQuestions: asList(input.openQuestions || previous.openQuestions, 4),
    activeRepairTarget: sanitizeText(input.chatContextPack?.affectedSubsystems?.[0], 80) || previous.activeRepairTarget,
    lastKnownGoodState: sanitizeText(input.uiRealityStatus?.severity === 'OK' ? 'ui-reality-ok' : previous.lastKnownGoodState, 120),
    currentBlockedState: sanitizeText(input.responsePlanner?.warnings?.[0] || previous.currentBlockedState, 160),
    recentOperatorPreferences: asList(input.operatorPreferences || previous.recentOperatorPreferences, 4),
    recentCodexLoopState: sanitizeText(input.missionState?.codexHandoffReadiness || previous.recentCodexLoopState, 120),
    nextAction: sanitizeText(input.responsePlanner?.recommendedNextAction || previous.nextAction, 180),
    warnings: asList(input.responsePlanner?.warnings || previous.warnings, 6),
    summaries: [summaryItem, ...(Array.isArray(previous.summaries) ? previous.summaries : [])].slice(0, MAX_SUMMARIES),
    rehydrated: Boolean(previous.rehydrated),
    seededFromExistingHistory: Boolean(previous.seededFromExistingHistory),
    continuitySource: asText(previous.continuitySource, 'none'),
    rawTranscriptStored: 'no',
    storageKey: CHAT_CONTINUITY_STORAGE_KEY,
    seededFromExistingHistory: false,
    continuitySource: 'none',
    rawTranscriptStored: 'no',
  };
}

export function persistChatContinuity(continuity = {}, storage = globalThis.localStorage) {
  if (!storage?.setItem) return false;
  storage.setItem(CHAT_CONTINUITY_STORAGE_KEY, JSON.stringify(continuity));
  return true;
}

export function readChatContinuity(storage = globalThis.localStorage) {
  if (!storage?.getItem) return createEmptyChatContinuity();
  const raw = storage.getItem(CHAT_CONTINUITY_STORAGE_KEY);
  if (!raw) return createEmptyChatContinuity();
  try {
    const parsed = JSON.parse(raw);
    return {
      ...createEmptyChatContinuity({ sessionId: parsed.sessionId || 'unknown' }),
      ...parsed,
      rehydrated: true,
      storageKey: CHAT_CONTINUITY_STORAGE_KEY,
    seededFromExistingHistory: false,
    continuitySource: 'none',
    rawTranscriptStored: 'no',
    };
  } catch {
    return createEmptyChatContinuity();
  }
}



export function seedChatContinuityFromExistingHistory({ commandHistory = [], sessionId = 'unknown' } = {}) {
  const entries = Array.isArray(commandHistory) ? commandHistory.slice(-6) : [];
  if (!entries.length) {
    const empty = createEmptyChatContinuity({ sessionId });
    return { ...empty, seededFromExistingHistory: false, continuitySource: 'none', rawTranscriptStored: 'no' };
  }
  const recentCommands = entries.map((entry) => sanitizeText(entry?.raw_input || '', 120)).filter(Boolean);
  const recentOutputs = entries.map((entry) => sanitizeText(entry?.output_text || '', 140)).filter(Boolean);
  const topic = recentCommands[recentCommands.length - 1] || 'unknown';
  const openQuestions = recentCommands.filter((text) => /\?$/.test(text)).slice(-3);
  const decisions = recentOutputs.filter((text) => /(wait|yes|no|merge|proof|verify)/i.test(text)).slice(-3);
  const seededSummary = {
    id: `seed_${Date.now()}`,
    timestamp: new Date().toISOString(),
    kind: 'seeded-history',
    summary: sanitizeText(`${topic} | ${recentOutputs[recentOutputs.length - 1] || 'history seeded'}`, 220),
    sourceCommandId: asText(entries[entries.length - 1]?.id, 'unknown'),
    relatedSubsystems: ['chat-continuity', 'command-history'],
    confidence: 'medium',
  };
  return {
    ...createEmptyChatContinuity({ sessionId }),
    recentTopic: topic,
    activeMission: sanitizeText(entries[entries.length - 1]?.route || 'assistant', 80),
    recentDecisions: asList(decisions, 4),
    openQuestions: asList(openQuestions, 4),
    nextAction: sanitizeText(recentOutputs[recentOutputs.length - 1] || 'continue current mission thread', 180),
    summaries: [seededSummary],
    seededFromExistingHistory: true,
    continuitySource: 'command-history',
    rawTranscriptStored: 'no',
  };
}

export { CHAT_CONTINUITY_STORAGE_KEY, CHAT_CONTINUITY_VERSION };
