const FAST_LANE_BLOCKING_PATTERNS = [
  /\b(today|latest|breaking|current events?|as of now|live update)\b/i,
  /\b(mission packet|codex handoff|operator packet|execution plan)\b/i,
  /\b(system design|architecture|refactor|implement|debug|root cause|traceback|stack trace)\b/i,
  /\bmulti[- ]step|step[- ]by[- ]step|deep reasoning|chain[- ]of[- ]thought|analy[sz]e\b/i,
  /\bwrite code|fix bug|run command|execute|deploy|compile|build pipeline\b/i,
];

const FAST_LANE_POSITIVE_PATTERNS = [
  /\bwho am i talking to\b/i,
  /\bquick\b/i,
  /\bbrief\b/i,
  /\bshort answer\b/i,
];

function getPromptText(prompt = '', context = {}) {
  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt.trim();
  }
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const latestUser = [...messages].reverse().find((entry) => String(entry?.role || '').toLowerCase() === 'user');
  return String(latestUser?.content || '').trim();
}

export function determineFastLaneEligibility(prompt = '', context = {}, routeTruth = {}) {
  const promptText = getPromptText(prompt, context);
  const promptWordCount = promptText ? promptText.split(/\s+/).filter(Boolean).length : 0;
  const freshnessNeed = String(
    context?.freshnessContext?.freshnessNeed
    || context?.routeDecision?.freshnessNeed
    || routeTruth?.freshnessNeed
    || 'low',
  ).trim().toLowerCase();
  if (freshnessNeed === 'high') {
    return { eligible: false, reason: 'high-freshness-request' };
  }

  if (!promptText) {
    return { eligible: true, reason: 'empty-or-implicit-short-prompt' };
  }

  const hasBlockingIntent = FAST_LANE_BLOCKING_PATTERNS.some((pattern) => pattern.test(promptText));
  if (hasBlockingIntent) {
    return { eligible: false, reason: 'complex-or-execution-heavy-request' };
  }

  const explicitDeepReasoning = context?.routeDecision?.operatorDeepReasoning === true
    || context?.routeDecision?.selectedAnswerMode === 'deep-local'
    || /\bdeep reasoning|think hard|thorough analysis\b/i.test(promptText);
  if (explicitDeepReasoning) {
    return { eligible: false, reason: 'operator-requested-deep-reasoning' };
  }

  const multiline = (promptText.match(/\n/g) || []).length >= 3;
  const complexityScore = [
    promptWordCount > 50,
    promptText.length > 320,
    multiline,
    /[:;]/.test(promptText) && promptWordCount > 30,
  ].filter(Boolean).length;

  if (complexityScore >= 2) {
    return { eligible: false, reason: 'prompt-complexity-threshold-exceeded' };
  }

  const positiveSignal = FAST_LANE_POSITIVE_PATTERNS.some((pattern) => pattern.test(promptText));
  if (positiveSignal || promptWordCount <= 18) {
    return { eligible: true, reason: positiveSignal ? 'explicit-quick-intent' : 'short-local-private-prompt' };
  }

  return { eligible: false, reason: 'default-standard-lane' };
}

