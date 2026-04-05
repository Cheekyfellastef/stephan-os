const INTENT_TYPES = new Set([
  'diagnose',
  'build',
  'refactor',
  'summarize',
  'retrieve',
  'promote-memory',
  'tile-action',
  'unknown',
]);

const RULES = [
  { type: 'diagnose', confidence: 'high', patterns: [/\b(debug|diagnose|diagnostic|root cause|why .* fail|investigate|fix error)\b/i] },
  { type: 'build', confidence: 'high', patterns: [/\b(build|implement|create|add|ship|deliver|introduce)\b/i] },
  { type: 'refactor', confidence: 'high', patterns: [/\b(refactor|restructure|cleanup|simplify|rename|extract)\b/i] },
  { type: 'summarize', confidence: 'high', patterns: [/\b(summarize|summary|tl;dr|recap|brief)\b/i] },
  { type: 'retrieve', confidence: 'high', patterns: [/\b(find|retrieve|search|lookup|look up|show me|where is)\b/i] },
  { type: 'promote-memory', confidence: 'high', patterns: [/\b(promote memory|save memory|remember this|store this|durable memory)\b/i] },
  { type: 'tile-action', confidence: 'high', patterns: [/\b(tile|panel|workspace|command deck|open panel|close panel)\b/i] },
];

export function detectIntent(requestText = '') {
  const input = String(requestText || '').trim();
  if (!input) {
    return {
      intentDetected: false,
      intentType: 'unknown',
      intentConfidence: 'low',
      intentReason: 'empty-request',
    };
  }

  const matched = RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(input)));
  if (!matched) {
    return {
      intentDetected: false,
      intentType: 'unknown',
      intentConfidence: 'low',
      intentReason: 'no-rule-match',
    };
  }

  const conservativeConfidence = input.length < 20 && matched.confidence === 'high'
    ? 'medium'
    : matched.confidence;

  return {
    intentDetected: matched.type !== 'unknown',
    intentType: INTENT_TYPES.has(matched.type) ? matched.type : 'unknown',
    intentConfidence: conservativeConfidence,
    intentReason: `matched:${matched.type}`,
  };
}
