import { normalizeIntentResult } from '../../../shared/ai/intentContract.mjs';

const BUILD_VERBS = ['implement', 'add', 'build', 'create', 'upgrade', 'extend', 'wire', 'integrate'];
const APPROVAL_TERMS = ['approve', 'approval', 'accepted', 'promote', 'authorize'];
const AMBIGUITY_TERMS = ['maybe', 'not sure', 'idk', 'whatever', 'something', 'anything'];

const INTENT_RULES = Object.freeze([
  { type: 'proposal-review', patterns: [/proposal/i, /review/i, /mission packet/i] },
  { type: 'roadmap-operation', patterns: [/roadmap/i, /promote/i, /next/i] },
  { type: 'memory-operation', patterns: [/memory/i, /remember/i, /recall/i] },
  { type: 'graph-operation', patterns: [/graph/i, /node/i, /edge/i] },
  { type: 'provider-config', patterns: [/provider/i, /model/i, /api key/i] },
  { type: 'route-config', patterns: [/route/i, /transport/i, /backend/i] },
  { type: 'troubleshoot', patterns: [/debug/i, /fix/i, /broken/i, /blocked/i, /why/i] },
  { type: 'inspect', patterns: [/show/i, /status/i, /diagnostic/i, /inspect/i] },
  { type: 'explain', patterns: [/explain/i, /what is/i, /why does/i] },
  { type: 'build-ui', patterns: [/ui/i, /panel/i, /render/i] },
  { type: 'build-runtime', patterns: [/runtime/i, /execution/i, /truth/i] },
  { type: 'build-tooling', patterns: [/test/i, /verify/i, /tool/i] },
  { type: 'build-agent', patterns: [/agent/i, /role/i] },
  { type: 'build-transport', patterns: [/transport/i, /bridge/i] },
  { type: 'build-surface', patterns: [/surface/i, /layout/i] },
  { type: 'build-integration', patterns: [/integrat/i, /handoff/i] },
  { type: 'build-system', patterns: [/system/i, /architecture/i, /self-build/i] },
]);

function findMatches(prompt = '') {
  return INTENT_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(prompt)));
}

function inferBuildRelevant(prompt = '', matches = []) {
  const normalized = String(prompt || '').toLowerCase();
  const hasBuildVerb = BUILD_VERBS.some((verb) => normalized.includes(verb));
  return hasBuildVerb || matches.some((rule) => rule.type.startsWith('build-'));
}

export function classifyOperatorIntent({ prompt = '', frictionSignals = [], projectContext = {} } = {}) {
  const text = String(prompt || '').trim();
  const lowered = text.toLowerCase();
  const matches = findMatches(text);
  const ambiguityFlags = [];

  if (!text) ambiguityFlags.push('empty-input');
  if (AMBIGUITY_TERMS.some((term) => lowered.includes(term))) ambiguityFlags.push('ambiguous-language');
  if (text.split(' ').length < 3) ambiguityFlags.push('underspecified-scope');

  const buildRelevant = inferBuildRelevant(text, matches);
  const approvalRequested = APPROVAL_TERMS.some((term) => lowered.includes(term));
  const primary = matches[0]?.type || (ambiguityFlags.length ? 'ambiguous' : 'unknown');
  const confidenceBase = matches.length > 0 ? 0.7 : 0.35;
  const confidencePenalty = ambiguityFlags.length * 0.15;
  const confidence = Math.max(0, Math.min(1, confidenceBase - confidencePenalty));

  const extractedSubsystems = [
    ...(Array.isArray(projectContext?.subsystemInventory) ? projectContext.subsystemInventory : []),
  ]
    .map((item) => String(item || '').toLowerCase())
    .filter((item) => lowered.includes(item))
    .slice(0, 6);

  const warnings = [];
  if (frictionSignals?.length) warnings.push('surface-friction-signals-present');
  if (!matches.length) warnings.push('intent-rule-match-missing');

  return normalizeIntentResult({
    intentDetected: primary !== 'unknown' && primary !== 'ambiguous',
    intentType: primary,
    intentFamily: primary,
    confidence,
    reason: matches.length
      ? `rule-first classification from ${matches.map((match) => match.type).join(', ')}`
      : 'No deterministic rule matched; degraded to ambiguous/unknown.',
    ambiguityFlags,
    buildRelevant,
    executionEligible: buildRelevant && ambiguityFlags.length === 0 && approvalRequested,
    approvalRequired: true,
    suggestedNextStage: buildRelevant ? 'proposal-review' : 'analysis',
    extractedTargets: matches.map((match) => match.type).slice(0, 6),
    extractedSubsystems,
    extractedConstraints: approvalRequested ? ['operator-approval-explicit'] : ['operator-approval-required-before-mutation'],
    warnings,
  });
}
