const GATE_SEGMENT_SPLIT_PATTERN = /(?<=[.!?])\s+|\n+|\s*;\s*|\s+(?:while|whereas|but|and)\s+/i;
const HISTORICAL_GATE_PATTERN = /\b(?:prior|previous|earlier)\b/i;

const ACCEPTANCE_GATE_TERMS = [
  /\bacceptance\b/i,
  /\blive\s+proof\b/i,
  /\bbrowser\s+proof\b/i,
];
const APPROVAL_GATE_TERMS = [
  /\bapproval\b/i,
  /\bmerge\s+gate\b/i,
];

function aroundTerm(term, statusSource) {
  return new RegExp(
    `(?:${term.source})[^\\n.!?]{0,120}(?:${statusSource})|(?:${statusSource})[^\\n.!?]{0,120}(?:${term.source})`,
    'i',
  );
}

function hasSameGateReference(segment, term) {
  return new RegExp(
    `\\b(?:this|that|the\\s+same|same|aforementioned)\\s+(?:${term.source})`,
    'i',
  ).test(segment);
}

function gateDefinitions(terms, {
  pendingStatus,
  completedStatus,
  negatedCompletedStatus,
  specialPending = null,
}) {
  return terms.map((term, index) => ({
    term,
    pending: aroundTerm(term, pendingStatus),
    completed: aroundTerm(term, completedStatus),
    negatedCompleted: aroundTerm(term, negatedCompletedStatus),
    specialPending: index === 0 ? specialPending : null,
  }));
}

const NEGATION_PREFIX = String.raw`\b(?:hasn['’]t|haven['’]t|hadn['’]t|isn['’]t|wasn['’]t|weren['’]t|didn['’]t|doesn['’]t|don['’]t|not|never)\s+(?:yet\s+)?(?:been\s+)?`;

const ACCEPTANCE_GATE_DEFINITIONS = gateDefinitions(ACCEPTANCE_GATE_TERMS, {
  pendingStatus: String.raw`\b(?:required|pending|remain(?:s|ing)?|needed|outstanding|awaiting|not\s+yet)\b`,
  completedStatus: String.raw`\b(?:passed|complete(?:d)?|satisfied|verified|done)\b`,
  negatedCompletedStatus: `${NEGATION_PREFIX}(?:passed|complete(?:d)?|satisfied|verified|done)\\b`,
});

const APPROVAL_GATE_DEFINITIONS = gateDefinitions(APPROVAL_GATE_TERMS, {
  pendingStatus: String.raw`\b(?:required|pending|remain(?:s|ing)?|needed|outstanding|awaiting|not\s+yet)\b`,
  completedStatus: String.raw`\b(?:granted|approved|complete(?:d)?|satisfied|done)\b`,
  negatedCompletedStatus: `${NEGATION_PREFIX}(?:granted|approved|complete(?:d)?|satisfied|done)\\b`,
  specialPending: /do not merge without[^\n.!?]{0,120}approval/i,
});

function isExplicitSameGateCompletion(segment, definition, { specialPending = false } = {}) {
  if (definition.negatedCompleted.test(segment) || !definition.completed.test(segment)) return false;
  if (hasSameGateReference(segment, definition.term)) return true;
  return specialPending && HISTORICAL_GATE_PATTERN.test(segment);
}

function gateIsPending(text, definitions) {
  const segments = String(text || '')
    .split(GATE_SEGMENT_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const definition of definitions) {
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const mentionsTerm = definition.term.test(segment);
      const specialPending = definition.specialPending?.test(segment) === true;
      if (!mentionsTerm && !specialPending) continue;

      const negatedCompletion = definition.negatedCompleted.test(segment);
      const pending = specialPending || negatedCompletion || definition.pending.test(segment);
      if (!pending) continue;

      if (isExplicitSameGateCompletion(segment, definition, { specialPending })) continue;

      const nextSegment = segments[index + 1] || '';
      const completedNext = hasSameGateReference(nextSegment, definition.term)
        && definition.term.test(nextSegment)
        && isExplicitSameGateCompletion(nextSegment, definition);
      if (!completedNext) return true;
    }
  }
  return false;
}

export function acceptanceGateIsPending(text) {
  return gateIsPending(text, ACCEPTANCE_GATE_DEFINITIONS);
}

export function approvalGateIsPending(text) {
  return gateIsPending(text, APPROVAL_GATE_DEFINITIONS);
}
