const MAX_MESSAGE_LENGTH = 320;

const MODIFIER_PATTERNS = [
  'darker',
  'stranger',
  'older',
  'newer',
  'more vocal',
  'less vocal',
  'more pressure',
  'less cheesy',
  'more atmospheric',
  'further outside my comfort zone',
];

export function normalizeMusicConversationMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

function normalizedLower(value) {
  return normalizeMusicConversationMessage(value).toLowerCase();
}

function extractQuotedText(value) {
  const match = String(value || '').match(/[“\"]([^”\"]+)[”\"]/);
  return String(match?.[1] || '').trim();
}

function stripIntentLead(value, pattern) {
  return normalizeMusicConversationMessage(value)
    .replace(pattern, '')
    .replace(/^(?:that|how|about|me|music|songs?|tracks?)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

export function deriveTasteTeachingCandidate(message) {
  const normalized = normalizeMusicConversationMessage(message);
  const lower = normalized.toLowerCase();
  const teachingLead = /\b(?:remember|teach|learn)\b/.test(lower);
  const negative = /\b(?:i|we)\s+(?:really\s+)?(?:dislike|hate|avoid|do not like|don't like)\b/.test(lower)
    || /^(?:please\s+)?(?:avoid|never recommend)\b/.test(lower)
    || (teachingLead && /\b(?:dislike|hate|avoid|do not like|don't like|never recommend|less of)\b/.test(lower));
  const positive = /\b(?:i|we)\s+(?:really\s+)?(?:like|love|enjoy|respond to)\b/.test(lower)
    || /\b(?:want more of|more of)\b/.test(lower)
    || (teachingLead && /\b(?:like|love|enjoy|more of|respond to)\b/.test(lower));
  if (!negative && !positive) return null;
  const quoted = extractQuotedText(normalized);
  const trait = quoted || stripIntentLead(normalized, /^(?:please\s+)?(?:remember|teach(?:\s+the\s+tile)?|learn)\s+(?:that\s+)?/i)
    .replace(/^(?:i\s+)?(?:really\s+)?(?:do not like|don't like|dislike|hate|avoid|never recommend|like|love|enjoy|want more of|want less of|more of|less of|respond to)\s+/i, '')
    .trim();
  if (!trait || trait.length < 2) return null;
  return {
    trait: trait.slice(0, 120),
    polarity: negative ? 'negative' : 'positive',
    weightDelta: negative ? 0.8 : 0.6,
    source: 'explicit-conversation',
  };
}

export function classifyMusicConversationIntent(message) {
  const normalized = normalizeMusicConversationMessage(message);
  const lower = normalized.toLowerCase();
  if (!normalized) return 'empty';
  if (/^(?:please\s+)?(?:forget|unlearn|remove|undo)\b/.test(lower) || /\b(?:forget|unlearn|remove|undo)\b.*\b(?:taste|preference|remember|learned|teaching)\b/.test(lower)) return 'forget';
  if (/\b(?:taste changing|changed my taste|learned about my taste|taste dna|reflect|reflection)\b/.test(lower)) return 'reflect';
  if (/\b(?:remember|teach)\b/.test(lower) || deriveTasteTeachingCandidate(normalized)) return 'teach';
  if (/\b(?:why|explain|reason)\b/.test(lower)) return 'explain';
  if (/\b(?:journey|session|set|arc|playlist)\b/.test(lower) && /\b(?:build|make|create|start|give|two.hour|hour|journey|session|arc)\b/.test(lower)) return 'journey';
  if (/\b(?:more like|similar to|same .* but|darker|stranger|less cheesy|more pressure|more atmospheric)\b/.test(lower)) return 'more-like';
  if (/^(?:help|what can (?:you|this) do)\??$/i.test(normalized)) return 'help';
  return 'discover';
}

export function buildMusicConversationPlan(message, context = {}) {
  const normalized = normalizeMusicConversationMessage(message);
  const intent = classifyMusicConversationIntent(normalized);
  const currentTrack = context.currentTrack && typeof context.currentTrack === 'object' ? context.currentTrack : null;
  const modifiers = MODIFIER_PATTERNS.filter((modifier) => normalizedLower(normalized).includes(modifier));
  const teachingCandidate = intent === 'teach' ? deriveTasteTeachingCandidate(normalized) : null;
  const anchor = currentTrack
    ? `${String(currentTrack.artist || '').trim()} ${String(currentTrack.title || currentTrack.name || '').trim()}`.trim()
    : '';
  const searchQuery = intent === 'more-like'
    ? [anchor, modifiers.join(' '), stripIntentLead(normalized, /^(?:find|give|show|play)?\s*(?:me\s+)?(?:something\s+)?(?:more like this|similar to this|same .*? but)\s*/i)].filter(Boolean).join(' ').slice(0, 160)
    : normalized.slice(0, 160);

  return {
    schemaVersion: 'music-conversation-plan.v1',
    message: normalized,
    intent,
    modifiers,
    searchQuery,
    teachingCandidate,
    durableMutationRequested: intent === 'teach' || intent === 'forget',
    requiresConfirmation: intent === 'teach' || intent === 'forget',
    mayUseCatalog: intent === 'discover' || intent === 'more-like',
    mayUseAi: !['empty', 'help', 'teach', 'forget'].includes(intent),
  };
}

export function buildConversationAiPayload(plan, context = {}) {
  const tasteDNA = context.tasteDNA && typeof context.tasteDNA === 'object' ? context.tasteDNA : {};
  const explicitTeachings = Array.isArray(context.explicitTeachings) ? context.explicitTeachings : [];
  return {
    operatorRequest: plan.message,
    intent: plan.intent,
    modifiers: plan.modifiers,
    tasteDNA,
    ratingsSummary: {
      ratedTrackCount: Number(context.ratedTrackCount || 0),
    },
    explicitTeachings: explicitTeachings.map((entry) => ({
      trait: String(entry?.trait || ''),
      polarity: String(entry?.polarity || ''),
      status: String(entry?.status || ''),
    })).filter((entry) => entry.trait),
    catalogueContentIncluded: false,
    personalSpotifyDataIncluded: false,
    promptInstructions: 'Return strict JSON with answer and optional nextPrompts. Use only the supplied operator-owned Taste DNA, ratings summary and explicit teachings. Do not claim catalogue, playback, listening-history or verification facts. Label inferences as inferences.',
  };
}

export function summarizeTasteEvidence(tasteDNA = {}, ratedTrackCount = 0) {
  const entries = Object.entries(tasteDNA || {})
    .map(([name, value]) => [name, signedTraitWeight(value)])
    .filter(([, signedWeight]) => Math.abs(signedWeight) > 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const positive = entries.filter(([, signedWeight]) => signedWeight > 0).slice(0, 3).map(([name]) => name);
  const negative = entries.filter(([, signedWeight]) => signedWeight < 0).slice(0, 2).map(([name]) => name);
  return {
    positive,
    negative,
    ratedTrackCount: Number(ratedTrackCount || 0),
    evidenceAvailable: positive.length > 0 || negative.length > 0 || Number(ratedTrackCount || 0) > 0,
  };
}

function signedTraitWeight(trait = null) {
  const weight = Number(trait?.weight || 0);
  if (!Number.isFinite(weight)) return 0;
  if (weight < 0) return weight;
  return trait?.polarity === 'negative' ? -weight : weight;
}

function signedTeachingDelta(teaching = {}) {
  const delta = Math.max(0, Number(teaching?.weightDelta || 0));
  return teaching?.polarity === 'negative' ? -delta : delta;
}

function cloneTrait(trait) {
  return trait && typeof trait === 'object' ? { ...trait } : null;
}

function teachingBaseline(teaching = {}, activeTeachings = []) {
  const earliest = (Array.isArray(activeTeachings) ? activeTeachings : [])
    .filter((entry) => entry?.status === 'active' && entry?.trait === teaching?.trait)
    .sort((left, right) => String(left?.createdAt || '').localeCompare(String(right?.createdAt || '')))[0];
  if (earliest && Object.hasOwn(earliest, 'baselineTrait')) return cloneTrait(earliest.baselineTrait);
  if (earliest && Object.hasOwn(earliest, 'previousTrait')) return cloneTrait(earliest.previousTrait);
  if (Object.hasOwn(teaching, 'baselineTrait')) return cloneTrait(teaching.baselineTrait);
  return cloneTrait(teaching.previousTrait);
}

function projectTeachingSet(tasteDNA, trait, beforeTeachings, afterTeachings, baselineTrait, now) {
  const nextTasteDNA = { ...(tasteDNA || {}) };
  const current = cloneTrait(nextTasteDNA[trait]);
  const baselineSigned = signedTraitWeight(baselineTrait);
  const expectedBefore = baselineSigned + beforeTeachings.reduce((total, entry) => total + signedTeachingDelta(entry), 0);
  const manualAdjustment = current ? signedTraitWeight(current) - expectedBefore : 0;
  const projectedSigned = baselineSigned
    + afterTeachings.reduce((total, entry) => total + signedTeachingDelta(entry), 0)
    + manualAdjustment;
  const roundedSigned = Number(projectedSigned.toFixed(2));
  const baselineContributions = Math.max(0, Number(baselineTrait?.contributions || 0));
  const currentContributions = Math.max(0, Number(current?.contributions || 0));
  const hasSeparateTeachingCount = current && Object.hasOwn(current, 'teachingContributions');
  const trackContributions = current
    ? hasSeparateTeachingCount
      ? currentContributions
      : Math.max(baselineContributions, currentContributions - beforeTeachings.length)
    : baselineContributions;

  if (!baselineTrait && !afterTeachings.length && Math.abs(roundedSigned) < 0.005) {
    delete nextTasteDNA[trait];
    return { tasteDNA: nextTasteDNA, record: null, deletedTrait: true, manualAdjustment };
  }

  const polarity = roundedSigned < 0
    ? 'negative'
    : roundedSigned > 0
      ? 'positive'
      : (baselineTrait?.polarity || current?.polarity || 'positive');
  const inheritedCategory = baselineTrait?.polarity === polarity
    ? baselineTrait.category
    : current?.polarity === polarity
      ? current.category
      : '';
  const record = {
    ...(baselineTrait || current || {}),
    weight: Math.abs(roundedSigned),
    polarity,
    category: inheritedCategory || (polarity === 'negative' ? 'avoid' : 'core'),
    contributions: trackContributions,
    teachingContributions: afterTeachings.length,
    custom: baselineTrait?.custom ?? current?.custom ?? true,
    updatedAt: now,
  };
  nextTasteDNA[trait] = record;
  return { tasteDNA: nextTasteDNA, record, deletedTrait: false, manualAdjustment };
}

export function applyTasteTeachingContribution(tasteDNA = {}, teaching = {}, activeTeachings = [], now = new Date().toISOString()) {
  const trait = String(teaching?.trait || '').trim();
  if (!trait) return { tasteDNA: { ...(tasteDNA || {}) }, applied: false, baselineTrait: null, record: null };
  const before = (Array.isArray(activeTeachings) ? activeTeachings : [])
    .filter((entry) => entry?.status === 'active' && entry?.trait === trait);
  const baselineTrait = teachingBaseline(teaching, before);
  const projection = projectTeachingSet(tasteDNA, trait, before, [...before, teaching], baselineTrait, now);
  return { ...projection, applied: true, baselineTrait };
}

export function removeTasteTeachingContribution(tasteDNA = {}, teaching = {}, activeTeachings = [], now = new Date().toISOString()) {
  const trait = String(teaching?.trait || '').trim();
  if (!trait || !tasteDNA?.[trait]) return { tasteDNA: { ...(tasteDNA || {}) }, removed: false };
  const before = (Array.isArray(activeTeachings) ? activeTeachings : [])
    .filter((entry) => entry?.status === 'active' && entry?.trait === trait);
  const remaining = before.filter((entry) => entry?.id !== teaching?.id);
  const baselineTrait = teachingBaseline(teaching, before);
  const projection = projectTeachingSet(tasteDNA, trait, before, remaining, baselineTrait, now);
  return { ...projection, removed: true, baselineTrait };
}

export function retainConversationTeachingHistory(entries = [], maxInactive = 100) {
  const list = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : [];
  const inactiveLimit = Math.max(0, Number(maxInactive || 0));
  const retainedInactive = new Set(inactiveLimit
    ? list.filter((entry) => entry.status !== 'active').slice(-inactiveLimit)
    : []);
  return list.filter((entry) => entry.status === 'active' || retainedInactive.has(entry));
}
