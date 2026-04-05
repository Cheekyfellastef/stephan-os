import { normalizeMemoryCandidate } from './memorySchema.js';

const ELIGIBLE_HINTS = [
  'north star',
  'policy',
  'routing rule',
  'provider behavior',
  'guardrail',
  'canonical',
  'constraint',
  'stable decision',
  'long-lived',
  'memory law',
];

const INELIGIBLE_HINTS = [
  'log',
  'debug session',
  'trace',
  'transient',
  'temporary',
  'one-off',
  'latest',
  'today',
  'breaking',
  'score',
  'weather',
  'stock',
];

function asComparableText(value) {
  if (typeof value === 'string') return value.toLowerCase();
  if (value && typeof value === 'object') return JSON.stringify(value).toLowerCase();
  return String(value || '').toLowerCase();
}

export function evaluateMemoryEligibility(candidate = {}) {
  const normalized = normalizeMemoryCandidate(candidate);
  if (!normalized.key) {
    return {
      eligible: false,
      reason: 'Candidate missing canonical key; durable memory requires explicit identifier.',
      confidence: normalized.memoryConfidence,
      memoryClass: 'durable',
      candidate: normalized,
    };
  }

  if (!normalized.sourceRef) {
    return {
      eligible: false,
      reason: 'Candidate missing sourceRef; memory promotion requires inspectable provenance.',
      confidence: normalized.memoryConfidence,
      memoryClass: 'durable',
      candidate: normalized,
    };
  }

  if (normalized.sourceType === 'snapshot' && normalized.sourceRef.startsWith('retrieval:')) {
    return {
      eligible: false,
      reason: 'Retrieval evidence is never auto-promoted to durable memory.',
      confidence: normalized.memoryConfidence,
      memoryClass: 'durable',
      candidate: normalized,
    };
  }

  const combinedText = [normalized.key, normalized.memoryReason, asComparableText(normalized.value)].join(' ').toLowerCase();

  if (INELIGIBLE_HINTS.some((term) => combinedText.includes(term))) {
    return {
      eligible: false,
      reason: 'Candidate appears transient/freshness-sensitive; defaulting to no promotion.',
      confidence: normalized.memoryConfidence,
      memoryClass: 'durable',
      candidate: normalized,
    };
  }

  if (ELIGIBLE_HINTS.some((term) => combinedText.includes(term))) {
    return {
      eligible: true,
      reason: normalized.memoryReason || 'Canonical stable rule candidate matched durable-memory policy hints.',
      confidence: normalized.memoryConfidence,
      memoryClass: 'durable',
      candidate: normalized,
    };
  }

  return {
    eligible: false,
    reason: 'Candidate did not match durable-memory eligibility rules; default deny to prevent implicit learning.',
    confidence: normalized.memoryConfidence,
    memoryClass: 'durable',
    candidate: normalized,
  };
}
