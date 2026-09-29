export const PROJECT_INTELLIGENCE_SCHEMA_VERSION = 'project-intelligence.v1';

export const KNOWLEDGE_KIND = Object.freeze({
  GOAL: 'GOAL',
  PR: 'PR',
  PROOF: 'PROOF',
  BLOCKER: 'BLOCKER',
  RUNTIME: 'RUNTIME',
  IDEA: 'IDEA',
  SYSTEM: 'SYSTEM',
});

export const ANSWER_MODE = Object.freeze({
  FACT: 'FACT',
  HYPOTHESIS: 'HYPOTHESIS',
  NEXT_ACTION: 'NEXT_ACTION',
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function normalizeKind(kind) {
  const out = text(kind, KNOWLEDGE_KIND.IDEA).toUpperCase();
  return Object.values(KNOWLEDGE_KIND).includes(out) ? out : KNOWLEDGE_KIND.IDEA;
}

function normalizeMode(mode) {
  const out = text(mode, ANSWER_MODE.FACT).toUpperCase();
  return Object.values(ANSWER_MODE).includes(out) ? out : ANSWER_MODE.FACT;
}

export function buildProjectIntelligenceContract() {
  return {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    contractKind: 'stephanos.project_intelligence.contract',
    knowledgeKinds: Object.values(KNOWLEDGE_KIND),
    answerModes: Object.values(ANSWER_MODE),
    finalVerdict: 'PROJECT_INTELLIGENCE_CONTRACT_READY',
  };
}

export function createKnowledgeItem(input = {}) {
  return {
    id: text(input.id, `knowledge-${normalizeKind(input.kind).toLowerCase()}`),
    kind: normalizeKind(input.kind),
    title: text(input.title, 'Untitled knowledge item'),
    summary: text(input.summary, ''),
    status: text(input.status, ''),
    refs: list(input.refs),
    relatedIds: list(input.relatedIds),
    proven: input.proven === true,
    source: text(input.source, input.proven === true ? 'repository' : 'operator'),
  };
}

export function createProjectKnowledgeGraph(input = {}) {
  const items = list(input.items).length ? input.items.map(createKnowledgeItem) : [];
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  const links = [];
  for (const item of items) {
    for (const relatedId of item.relatedIds) {
      if (byId[relatedId]) links.push({ from: item.id, to: relatedId });
    }
  }
  return {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    kind: 'stephanos.project_intelligence.graph',
    items,
    links,
    counts: Object.fromEntries(Object.values(KNOWLEDGE_KIND).map((kind) => [kind, items.filter((item) => item.kind === kind).length])),
    finalVerdict: 'PROJECT_KNOWLEDGE_GRAPH_READY',
  };
}

function tokens(query) {
  return text(query).toLowerCase().split(/[^a-z0-9#]+/).filter((token) => token.length > 2 || token.startsWith('#'));
}

export function searchKnowledgeGraph(graph = {}, query = '') {
  const queryTokens = tokens(query);
  const items = Array.isArray(graph.items) ? graph.items : [];
  return items
    .map((item) => {
      const haystack = `${item.id} ${item.kind} ${item.title} ${item.summary} ${item.status} ${item.refs.join(' ')}`.toLowerCase();
      const score = queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export function createProjectIntelligenceAnswer(input = {}) {
  const graph = input.graph?.kind === 'stephanos.project_intelligence.graph'
    ? input.graph
    : createProjectKnowledgeGraph({ items: input.items || [] });
  const question = text(input.question, 'What is the current project state?');
  const matches = searchKnowledgeGraph(graph, question).slice(0, 5);
  const provenFacts = matches.filter((item) => item.proven).map((item) => `${item.title}: ${item.summary || item.status}`);
  const hypotheses = matches.filter((item) => !item.proven).map((item) => `${item.title}: ${item.summary || item.status}`);
  const nextActions = list(input.nextActions);
  const primary = provenFacts[0] || hypotheses[0] || 'No matching project knowledge found.';

  return {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    kind: 'stephanos.project_intelligence.answer',
    question,
    mode: provenFacts.length ? ANSWER_MODE.FACT : hypotheses.length ? ANSWER_MODE.HYPOTHESIS : ANSWER_MODE.NEXT_ACTION,
    answer: text(input.answer, primary),
    provenFacts,
    hypotheses,
    relatedRefs: [...new Set(matches.flatMap((item) => item.refs))],
    relatedIds: matches.map((item) => item.id),
    nextActions,
    finalVerdict: 'PROJECT_INTELLIGENCE_ANSWER_READY',
  };
}

export function createIdeaFlywheelTurn(input = {}) {
  const idea = createKnowledgeItem({
    id: input.id || 'idea-current',
    kind: KNOWLEDGE_KIND.IDEA,
    title: input.title || 'Operator idea',
    summary: input.summary || input.idea,
    relatedIds: input.relatedIds,
    refs: input.refs,
    proven: false,
    source: 'operator',
  });
  const response = createProjectIntelligenceAnswer({
    items: [...(input.items || []), idea],
    question: input.question || idea.summary,
    nextActions: input.nextActions || ['Turn the strongest idea into a source PR, proof, blocker, or explicit reject decision.'],
  });
  return {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    kind: 'stephanos.project_intelligence.flywheel_turn',
    idea,
    response,
    finalVerdict: 'IDEA_FLYWHEEL_TURN_READY',
  };
}

export function validateProjectIntelligenceAnswer(answer = {}) {
  const errors = [];
  if (answer.schemaVersion !== PROJECT_INTELLIGENCE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (answer.kind !== 'stephanos.project_intelligence.answer') errors.push('invalid-kind');
  if (!text(answer.question)) errors.push('missing-question');
  if (!text(answer.answer)) errors.push('missing-answer');
  if (!Array.isArray(answer.provenFacts)) errors.push('missing-proven-facts');
  if (!Array.isArray(answer.hypotheses)) errors.push('missing-hypotheses');
  if (!Array.isArray(answer.nextActions)) errors.push('missing-next-actions');
  return {
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'PROJECT_INTELLIGENCE_ANSWER_PASS' : 'PROJECT_INTELLIGENCE_ANSWER_BLOCKED',
  };
}
